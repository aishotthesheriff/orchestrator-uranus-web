import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { GameState, ActionInput, InsertGameState, Intent } from "@shared/schema";
import { insertGameStateSchema, actionInputSchema, NPC_SKILL_MAPPINGS } from "@shared/schema";
import { generateImage, testGenerateImage, generateInterviewAnswer } from "./aiService";
import { getCurrentReference } from "./reference/referenceLoader";
import { processTurnWithTransaction } from "./gameLogic";
import { publishReference, activateReferenceRelease, getAllReferenceReleases, getCurrentReferenceRelease } from "./reference/publishReference";
import { referenceSyncStatus, verifyRelease } from "./reference/importRelease";
import type { Request, Response } from "express";
import { 
  gameReadRateLimit, 
  gameStartRateLimit, 
  gameActionRateLimit, 
  imageGenerationRateLimit 
} from "./middleware/rateLimiting";
import { e2eLatency, metricsRegister } from "./metrics";
import { requireAdmin } from "./middleware/adminAuth";
import { isMissingTable, missingTableName } from "./db/errors";
import { generateToken, requireAuth } from "./middleware/jwt";
import { authenticateSocket, handleJoinGame } from "./socketAuth";
import { resolvePceSelections, getPceDefaults } from "./pce/settings.js";
import { buildMetaPrompt, buildPcePrompt } from "./pce/promptBuilder.js";
import { buildModelInstructionSet } from "./pce/modelInstructions.js";
import OpenAI from "openai";
import { getCreativeSelections, initializeNewGame } from "./gameInitialization";
import { getOrchestrator } from "./orchestrator";
import { randomUUID } from "crypto";
import { 
  buildTurnGenerationContext, 
  buildMasterVariables, 
  buildNarrativeVariables, 
  buildImageVariables, 
  buildActionsVariables,
  getIngredients
} from "./aiService";
const ORCHESTRATOR_DISABLED = process.env.DISABLE_ORCHESTRATOR_ENQUEUE === 'true' || process.env.NODE_ENV === 'test';

export async function registerRoutes(app: Express): Promise<Server> {

  // Start a new game (requires auth - uses session username)
  app.post("/api/game/start", requireAuth, gameStartRateLimit, async (req, res) => {
    const startTime = Date.now();
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Validate that user record exists in database
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Override username from session - user cannot start games for other users
      const validated = insertGameStateSchema.parse({ ...req.body, username });
      const readyState = await initializeNewGame(validated);
      
      // Record end-to-end latency
      const e2eDuration = Date.now() - startTime;
      e2eLatency.observe({ operation: 'game_init' }, e2eDuration);
      
      // Include an explicit introApplied flag for clients to gate navigation
      res.json({ ...readyState, introApplied: true });
    } catch (error) {
      console.error("Error starting game:", error);
      res.status(400).json({ error: "Failed to start game" });
    }
  });

  // Get game state (requires auth - verify game belongs to user)
  app.get("/api/game/:id", requireAuth, gameReadRateLimit, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const state = await storage.getGameState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: "Game not found" });
      }

      // Verify game belongs to authenticated user
      if (state.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(state);
    } catch (error) {
      console.error("Error getting game:", error);
      res.status(500).json({ error: "Failed to get game" });
    }
  });

  // Take an action (enqueue async turn job) - requires auth and ownership verification
  app.post("/api/game/action", requireAuth, gameActionRateLimit, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const validated = actionInputSchema.parse(req.body);
      
      // Check if game exists, is not complete, and belongs to user
      const existingState = await storage.getGameState(validated.gameId);
      if (!existingState) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (existingState.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (existingState.isComplete) {
        return res.status(400).json({ error: "Game is already complete" });
      }

      // Enqueue turn job and return immediately
      const job = await storage.createTurnJob({
        gameId: validated.gameId,
        actionPayload: validated,
        status: 'pending'
      }, (req as any).traceId, (req as any).requestId);

      res.json({ turnJobId: job.id, status: 'processing' });
    } catch (error) {
      console.error("Error processing action:", error);
      res.status(500).json({ error: "Failed to process action" });
    }
  });

  // Update equipped items for a game (requires auth and ownership verification)
  app.patch("/api/games/:id/equipped-items", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const gameId = req.params.id;
      const body = req.body as { equippedItems?: unknown };

      // Verify game exists and belongs to user
      const existingState = await storage.getGameState(gameId);
      if (!existingState) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (existingState.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!Array.isArray(body.equippedItems)) {
        return res.status(400).json({ error: "equippedItems must be an array of item IDs" });
      }

      const equippedItems = Array.from(
        new Set(
          body.equippedItems
            .map(item => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        )
      );

      if (equippedItems.length > 3) {
        return res.status(400).json({ error: "You can only equip up to 3 items" });
      }

      const reference = await getCurrentReference();
      const activeItems = new Set(
        reference.data.items.filter(item => item.active === 1).map(item => item.id)
      );

      const invalidItems = equippedItems.filter(id => !activeItems.has(id));
      if (invalidItems.length > 0) {
        return res.status(400).json({
          error: "One or more items are invalid or inactive",
          invalidItems,
        });
      }

      try {
        const updatedState = await storage.processTurnWithTransaction(
          gameId,
          async state => {
            state.equippedItems = equippedItems;
            return state;
          }
        );

        res.json(updatedState);
      } catch (error) {
        if (error instanceof Error && error.message === "Game not found") {
          return res.status(404).json({ error: "Game not found" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error updating equipped items:", error);
      res.status(500).json({ error: "Failed to update equipped items" });
    }
  });

  // Delete game (new voyage) - requires auth and ownership verification
  app.delete("/api/game/:id", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const gameId = req.params.id;
      
      // Verify game exists and belongs to user
      const existingState = await storage.getGameState(gameId);
      if (!existingState) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (existingState.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteGameState(gameId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting game:", error);
      res.status(500).json({ error: "Failed to delete game" });
    }
  });

  // Get all games for authenticated user (requires auth - uses session username)
  app.get("/api/games/user/:username", requireAuth, gameReadRateLimit, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Users can only access their own games
      if (req.params.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      const games = await storage.getGamesByUsername(username);
      res.json(games);
    } catch (error) {
      console.error("Error fetching user games:", error);
      res.status(500).json({ error: "Failed to fetch user games" });
    }
  });

  // Interview question management endpoints
  app.get("/api/interview-questions", requireAdmin, async (req, res) => {
    try {
      const questions = await storage.getInterviewQuestions();
      res.json(questions);
    } catch (error) {
      console.error("Error fetching interview questions:", error);
      res.status(500).json({ error: "Failed to fetch interview questions" });
    }
  });

  app.get("/api/interview-questions/active", async (req, res) => {
    try {
      const questions = await storage.getActiveInterviewQuestions();
      res.json(questions);
    } catch (error) {
      console.error("Error fetching active interview questions:", error);
      res.status(500).json({ error: "Failed to fetch active interview questions" });
    }
  });

  app.post("/api/interview-questions", requireAdmin, async (req, res) => {
    try {
      const newQuestion = await storage.createInterviewQuestion(req.body);
      res.json(newQuestion);
    } catch (error) {
      console.error("Error creating interview question:", error);
      res.status(500).json({ error: "Failed to create interview question" });
    }
  });

  app.put("/api/interview-questions/:id", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateInterviewQuestion(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating interview question:", error);
      res.status(500).json({ error: "Failed to update interview question" });
    }
  });

  // Interview responses endpoint
  // Update interview responses (requires auth and ownership verification)
  app.patch("/api/games/:id/interview-responses", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const gameId = req.params.id;
      const responses = req.body;

      const game = await storage.getGameState(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (game.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      game.interviewResponses = responses;
      const updated = await storage.updateGameState(gameId, game);
      res.json(updated);
    } catch (error) {
      console.error("Error updating interview responses:", error);
      res.status(500).json({ error: "Failed to update interview responses" });
    }
  });

  // Generate AI answer for interview question (requires auth)
  app.post("/api/interview/generate-answer", requireAuth, async (req, res) => {
    try {
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "question is required" });
      }

      const answer = await generateInterviewAnswer(question);
      res.json({ answer });
    } catch (error) {
      console.error("Error generating interview answer:", error);
      res.status(500).json({ error: "Failed to generate interview answer" });
    }
  });

  // Generate or retrieve cached image (requires auth and ownership verification)
  app.post("/api/generate-image", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { templateName: templateNameOverride, gameId, turnNumber } = req.body as {
        templateName?: string;
        gameId?: string;
        turnNumber?: number;
      };

      if (!gameId) {
        return res.status(400).json({ error: "gameId is required" });
      }

      const game = await storage.getGameState(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (game.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Load user preferences once for reuse (uses cache)
      const userPreferences = await storage.getUserPreferences(game.username);

      // Require imagePrompt from request body or from turn
      const targetTurn = game.turns.find(t => t.turnNumber === turnNumber) ?? game.turns.at(-1);
      const imagePrompt = req.body.imagePrompt || targetTurn?.imagePrompt;
      
      if (!imagePrompt || typeof imagePrompt !== 'string' || imagePrompt.trim().length === 0) {
        return res.status(400).json({ 
          error: "imagePrompt is required",
          message: "Image prompt must be provided in request body or available on the target turn from PCE"
        });
      }

      const result = await generateImage(imagePrompt.trim(), game, userPreferences, {
        turnNumber
      });

      if (!result) {
        return res.status(500).json({ error: "Failed to generate image" });
      }

      res.json(result);
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });

  app.post("/api/test-generate-image", process.env.RATE_LIMIT_ENABLED !== 'false' ? imageGenerationRateLimit : [], async (req: Request, res: Response) => {
    try {
      const { templateName, variables } = req.body;

      if (!templateName) {
        return res.status(400).json({ error: "templateName is required" });
      }

      if (!variables || typeof variables !== 'object') {
        return res.status(400).json({ error: "variables must be an object" });
      }

      const result = await testGenerateImage(templateName, variables);

      if (!result) {
        return res.status(500).json({ error: "Failed to generate image" });
      }

      res.json(result);
    } catch (error) {
      console.error("Error testing image generation:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ 
        error: "Failed to generate image",
        details: errorMessage
      });
    }
  });

  // Queue admin endpoints
  app.get("/api/admin/queues/:queue/metrics", requireAdmin, async (req, res) => {
    try {
      const queue = req.params.queue;
      const orchestrator = getOrchestrator();
      const metrics = await orchestrator.getQueueMetrics(queue);
      res.json(metrics);
    } catch (error) {
      console.error("Error getting queue metrics:", error);
      res.status(500).json({ error: "Failed to get queue metrics" });
    }
  });

  // Telemetry metrics endpoint (returns JSON for dashboard)
  app.get("/api/admin/telemetry/metrics", requireAdmin, async (req, res) => {
    try {
      const metricsText = await metricsRegister.metrics();
      const metrics: Record<string, any> = {};
      
      // Parse Prometheus format into structured JSON
      // Handle both simple metrics and histograms (which have _bucket, _sum, _count suffixes)
      const lines = metricsText.split('\n');
      
      for (const line of lines) {
        if (line.trim() === '' || line.startsWith('#')) continue;
        
        // Match metric format: metric_name{labels} value or metric_name value
        // Also handle histogram buckets: metric_name_bucket{le="value"} count
        const metricMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s*({[^}]*})?\s+([\d.]+)$/);
        if (metricMatch) {
          const [, name, labelsStr, value] = metricMatch;
          const labels: Record<string, string> = {};
          
          if (labelsStr) {
            // Parse labels: {label1="value1",label2="value2"}
            const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)=["']([^"']+)["']/g;
            let match;
            while ((match = labelPattern.exec(labelsStr)) !== null) {
              labels[match[1]] = match[2];
            }
          }
          
          // Skip histogram buckets for now - we'll aggregate them
          if (name.endsWith('_bucket')) {
            const baseName = name.replace('_bucket', '');
            if (!metrics[baseName]) {
              metrics[baseName] = { buckets: [], sum: 0, count: 0 };
            }
            const le = labels.le ? parseFloat(labels.le) : null;
            if (le !== null) {
              metrics[baseName].buckets.push({
                le,
                count: parseFloat(value),
                labels: Object.fromEntries(Object.entries(labels).filter(([k]) => k !== 'le'))
              });
            }
            continue;
          }
          
          if (name.endsWith('_sum')) {
            const baseName = name.replace('_sum', '');
            if (!metrics[baseName]) {
              metrics[baseName] = { buckets: [], sum: 0, count: 0 };
            }
            metrics[baseName].sum = parseFloat(value);
            continue;
          }
          
          if (name.endsWith('_count')) {
            const baseName = name.replace('_count', '');
            if (!metrics[baseName]) {
              metrics[baseName] = { buckets: [], sum: 0, count: 0 };
            }
            metrics[baseName].count = parseFloat(value);
            continue;
          }
          
          // Regular metric
          if (!metrics[name]) {
            metrics[name] = [];
          }
          metrics[name].push({
            labels,
            value: parseFloat(value)
          });
        }
      }
      
      // Calculate percentiles from histograms
      for (const [metricName, data] of Object.entries(metrics)) {
        if (data && typeof data === 'object' && 'buckets' in data) {
          const histogram = data as { buckets: Array<{ le: number; count: number; labels: Record<string, string> }>; sum: number; count: number };
          // Group buckets by labels (excluding 'le')
          const byLabels: Record<string, Array<{ le: number; count: number }>> = {};
          histogram.buckets.forEach(bucket => {
            const labelKey = JSON.stringify(bucket.labels);
            if (!byLabels[labelKey]) {
              byLabels[labelKey] = [];
            }
            byLabels[labelKey].push({ le: bucket.le, count: bucket.count });
          });
          
          // Calculate percentiles for each label group
          const calculated: Array<{ labels: Record<string, string>; p50: number; p95: number; p99: number; avg: number }> = [];
          Object.entries(byLabels).forEach(([labelKey, buckets]) => {
            const labels = JSON.parse(labelKey);
            const sorted = buckets.sort((a, b) => a.le - b.le);
            const total = histogram.count;
            if (total > 0) {
              const p50Bucket = sorted.find(b => b.count >= total * 0.5) || sorted[sorted.length - 1];
              const p95Bucket = sorted.find(b => b.count >= total * 0.95) || sorted[sorted.length - 1];
              const p99Bucket = sorted.find(b => b.count >= total * 0.99) || sorted[sorted.length - 1];
              calculated.push({
                labels,
                p50: p50Bucket.le,
                p95: p95Bucket.le,
                p99: p99Bucket.le,
                avg: histogram.sum / total
              });
            }
          });
          
          metrics[metricName] = calculated.length > 0 ? calculated : [{ labels: {}, p50: 0, p95: 0, p99: 0, avg: 0 }];
        }
      }
      
      res.json(metrics);
    } catch (error) {
      console.error("Error getting telemetry metrics:", error);
      res.status(500).json({ error: "Failed to get telemetry metrics" });
    }
  });

  // Game telemetry endpoint (returns manifest timing data for a specific game)
  app.get("/api/admin/telemetry/game/:gameId", requireAdmin, async (req, res) => {
    try {
      const gameId = req.params.gameId;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      
      // Verify game exists
      const gameState = await storage.getGameState(gameId);
      if (!gameState) {
        return res.status(404).json({ error: "Game not found" });
      }
      
      // Get all manifests for this game with queue entry creation times
      const manifests = await storage.getGameManifests(gameId, limit);
      const { pool } = await import("./db");
      
      // Transform manifests into telemetry data with timing breakdown
      const telemetry = await Promise.all(manifests.map(async (m) => {
        const manifest = m.manifest as any;
        const job = manifest.job || {};
        const precompute = manifest.precompute || {};
        const apply = manifest.apply || {};
        
        // Get queue entry creation time (when job was actually enqueued)
        let queueEntryCreatedAt: Date | null = null;
        try {
          const queueEntryResult = await pool.query(
            'SELECT created_at FROM queue_entries WHERE id = $1',
            [m.queueEntryId]
          );
          if (queueEntryResult.rows.length > 0) {
            queueEntryCreatedAt = queueEntryResult.rows[0].created_at;
          }
        } catch (error) {
          console.warn(`Failed to get queue entry creation time for ${m.queueEntryId}:`, error);
        }
        
        // Calculate timing breakdown
        const timings: any = {
          turnNumber: m.turnNumber,
          createdAt: queueEntryCreatedAt?.toISOString() || m.createdAt.toISOString(),
          totalDurationMs: 0,
          queueWaitMs: 0,
          precomputeMs: 0,
          precomputeDeterministicMs: 0,
          precomputeLlmMs: 0,
          applyMs: 0,
          llmCalls: [],
        };
        
        // Queue wait time (from queue entry creation to claim)
        if (job.claimedAt && queueEntryCreatedAt) {
          const claimedAt = new Date(job.claimedAt).getTime();
          const queueCreatedAt = queueEntryCreatedAt.getTime();
          timings.queueWaitMs = Math.max(0, claimedAt - queueCreatedAt);
        } else if (job.claimedAt && precompute.startedAt) {
          // Fallback: queue entry creation time is unavailable.
          // We cannot accurately compute queue wait (creation → claim),
          // so set to 0 to avoid inflating totals with claim→start lag.
          timings.queueWaitMs = 0;
        }
        
        // Precompute duration (total)
        if (precompute.durationMs) {
          timings.precomputeMs = precompute.durationMs;
        } else if (precompute.startedAt && precompute.completedAt) {
          const started = new Date(precompute.startedAt).getTime();
          const completed = new Date(precompute.completedAt).getTime();
          timings.precomputeMs = completed - started;
        }
        
        // Precompute deterministic duration (excludes LLM calls)
        if (precompute.deterministicDurationMs !== undefined) {
          timings.precomputeDeterministicMs = precompute.deterministicDurationMs;
        }
        
        // Precompute LLM duration (sum of all LLM calls)
        if (precompute.llmDurationMs !== undefined) {
          timings.precomputeLlmMs = precompute.llmDurationMs;
        } else if (Array.isArray(precompute.llmCalls)) {
          // Fallback: calculate from individual LLM call latencies
          timings.precomputeLlmMs = precompute.llmCalls.reduce((sum: number, call: any) => sum + (call.latencyMs || 0), 0);
        }
        
        // Apply duration
        if (apply.durationMs) {
          timings.applyMs = apply.durationMs;
        } else if (apply.startedAt && apply.completedAt) {
          const started = new Date(apply.startedAt).getTime();
          const completed = new Date(apply.completedAt).getTime();
          timings.applyMs = completed - started;
        }
        
        // LLM call details
        if (Array.isArray(precompute.llmCalls)) {
          timings.llmCalls = precompute.llmCalls.map((call: any) => ({
            model: call.model,
            template: call.promptTemplate,
            latencyMs: call.latencyMs,
            cache: call.cache,
            stage: call.stage,
            recovery: call.recovery,
            error: call.error,
          }));
        }

        // Where this turn is in LangSmith, and its scores if it was sampled
        timings.langsmith = manifest.request?.langsmith ?? null;
        timings.evals = manifest.evals ?? null;
        
        // Total duration (from queue entry creation to completion)
        if (apply.completedAt && queueEntryCreatedAt) {
          const completed = new Date(apply.completedAt).getTime();
          const created = queueEntryCreatedAt.getTime();
          timings.totalDurationMs = completed - created;
        } else if (precompute.completedAt && queueEntryCreatedAt) {
          const completed = new Date(precompute.completedAt).getTime();
          const created = queueEntryCreatedAt.getTime();
          timings.totalDurationMs = completed - created;
        } else if (apply.completedAt && precompute.startedAt) {
          // Fallback: use precompute start to apply end if queue entry not available
          const completed = new Date(apply.completedAt).getTime();
          const started = new Date(precompute.startedAt).getTime();
          timings.totalDurationMs = completed - started + timings.queueWaitMs;
        }
        
        return timings;
      }));
      
      res.json({
        gameId,
        username: gameState.username,
        turnNumber: gameState.turnNumber,
        totalTurns: telemetry.length,
        turns: telemetry,
      });
    } catch (error) {
      console.error("Error getting game telemetry:", error);
      res.status(500).json({ error: "Failed to get game telemetry" });
    }
  });

  app.get("/api/admin/queues/:queue/dead-letter", requireAdmin, async (req, res) => {
    try {
      const queue = req.params.queue;
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT * FROM queue_entries 
         WHERE queue = $1 AND status = 'dead_letter' 
         ORDER BY updated_at DESC 
         LIMIT 100`,
        [queue]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error getting dead-letter jobs:", error);
      res.status(500).json({ error: "Failed to get dead-letter jobs" });
    }
  });

  app.post("/api/admin/queues/:queue/dead-letter/:jobId/replay", requireAdmin, async (req, res) => {
    try {
      const queue = req.params.queue;
      const jobId = req.params.jobId;
      const { pool } = await import("./db");
      
      // Get dead-letter job
      const jobResult = await pool.query(
        `SELECT * FROM queue_entries WHERE id = $1 AND status = 'dead_letter'`,
        [jobId]
      );
      
      if (jobResult.rows.length === 0) {
        return res.status(404).json({ error: "Dead-letter job not found" });
      }

      const job = jobResult.rows[0];
      
      // Re-enqueue with new idempotency key (add :replay suffix)
      const orchestrator = getOrchestrator();
      const newJobId = await orchestrator.enqueue({
        queue: queue as any,
        payload: { id: job.payload_id },
        idempotencyKey: job.idempotency_key ? `${job.idempotency_key}:replay` : undefined,
        traceId: job.trace_id || undefined,
        requestId: job.request_id || undefined,
        metadata: { ...job.metadata, replayedFrom: jobId },
      });

      res.json({ jobId: newJobId, status: "re-enqueued" });
    } catch (error) {
      console.error("Error replaying dead-letter job:", error);
      res.status(500).json({ error: "Failed to replay dead-letter job" });
    }
  });

  app.post("/api/admin/queues/:queue/command", requireAdmin, async (req, res) => {
    try {
      const queue = req.params.queue;
      const { command } = req.body as { command: 'wake' | 'drain' | 'pause' };
      
      if (!['wake', 'drain', 'pause'].includes(command)) {
        return res.status(400).json({ error: "Invalid command. Must be 'wake', 'drain', or 'pause'" });
      }

      const orchestrator = getOrchestrator();
      await orchestrator.publishCommand(queue as any, command);
      
      res.json({ queue, command, status: "published" });
    } catch (error) {
      console.error("Error publishing queue command:", error);
      res.status(500).json({ error: "Failed to publish command" });
    }
  });

  app.post("/api/admin/queues/:queue/mark-stuck", requireAdmin, async (req, res) => {
    try {
      const queue = req.params.queue;
      const orchestrator = getOrchestrator();
      const olderThan = new Date();
      const stuckJobIds = await orchestrator.markStuck({ queue: queue as any, olderThan });
      
      res.json({ queue, stuckJobIds, count: stuckJobIds.length });
    } catch (error) {
      console.error("Error marking stuck jobs:", error);
      res.status(500).json({ error: "Failed to mark stuck jobs" });
    }
  });

  app.get("/api/settings", requireAdmin, async (_req, res) => {
    try {
      const settings = await storage.getAllSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings/:key", requireAdmin, async (req, res) => {
    try {
      const key = req.params.key;
      const { value, description, active } = req.body as { value: string; description?: string; active?: number };
      if (typeof value !== 'string') {
        return res.status(400).json({ error: "value must be a string (stringified JSON allowed)" });
      }
      const setting = await storage.upsertSetting(key, value, description, typeof active === 'number' ? active : 1);
      res.json(setting);
    } catch (error) {
      console.error("Error upserting setting:", error);
      res.status(500).json({ error: "Failed to upsert setting" });
    }
  });

  // Update per-game settings (absurdity only - preferences moved to user level)
  // Update game settings (requires auth and ownership verification)
  app.patch("/api/games/:id/settings", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const gameId = req.params.id;
      const { absurdity } = req.body as {
        absurdity?: number | string;
      };

      const game = await storage.getGameState(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      if (game.username !== username) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (absurdity !== undefined) {
        const parsed = Number(absurdity);
        if (!Number.isNaN(parsed)) {
          const clamped = Math.min(3, Math.max(0, Math.round(parsed)));
          game.absurdity = clamped;
        }
      }

      const updated = await storage.updateGameState(gameId, game);
      res.json(updated);
    } catch (error) {
      console.error("Error updating game settings:", error);
      res.status(500).json({ error: "Failed to update game settings" });
    }
  });

  // User preferences endpoints
  // Get user preferences (requires auth - uses session username)
  app.get("/api/user/preferences", requireAuth, async (req, res) => {
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const preferences = await storage.getUserPreferences(username);
      res.json(preferences);
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      res.status(500).json({ error: "Failed to fetch user preferences" });
    }
  });

  // Search users by username pattern (public - for welcome page user selection)
  app.get("/api/user/search", async (req, res) => {
    try {
      const pattern = req.query.pattern as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      if (!pattern || pattern.trim() === "") {
        return res.status(400).json({ error: "Search pattern is required" });
      }

      // Minimum 2 characters for search
      if (pattern.trim().length < 2) {
        return res.json([]);
      }

      const users = await storage.searchUsersByUsername(pattern.trim(), limit);
      // Only return username and id (no password)
      const safeUsers = users.map(u => ({ id: u.id, username: u.username }));
      res.json(safeUsers);
    } catch (error) {
      console.error("Error searching users:", error);
      res.status(500).json({ error: "Failed to search users" });
    }
  });

  // User endpoints (public - accessible without auth)
  // PUT /api/user - Create user record and set JWT cookie
  app.put("/api/user", async (req, res) => {
    try {
      const { username } = req.body as { username?: string };
      if (typeof username !== "string" || username.trim() === "") {
        return res.status(400).json({ error: "Username is required" });
      }

      const trimmedUsername = username.trim();
      // The username column holds 64 characters; say so instead of failing in the database
      if (trimmedUsername.length > 64) {
        return res.status(400).json({ error: "Username must be 64 characters or fewer" });
      }

      const user = await storage.ensureUser(trimmedUsername);

      const token = generateToken(user.id, user.username);

      res.cookie("auth_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.json({ id: user.id, username: user.username });
    } catch (error: any) {
      console.error("Error creating user:", error);
      
      // The schema has not been created in this database
      if (isMissingTable(error)) {
        const tableName = missingTableName(error) || "unknown";
        console.error(`Database table "${tableName}" missing. Please run: npm run db:init`);
        return res.status(500).json({ 
          error: `Database table "${tableName}" not found. Please initialize the database schema.`,
          code: "DATABASE_SCHEMA_MISSING",
          table: tableName
        });
      }
      
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Get current authenticated user (requires auth)
  app.get("/api/user/me", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUserByUsername(req.user!.username);
      if (!user) {
        res.clearCookie("auth_token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
        return res.status(401).json({ error: "User not found" });
      }

      res.json({ 
        id: user.id, 
        username: user.username,
        theme: user.theme,
        style: user.style,
        imageModelKey: user.imageModelKey,
        llmModelKey: user.llmModelKey ?? null
      });
    } catch (error) {
      console.error("Error getting current user:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // Logout endpoint (requires auth)
  app.post("/api/user/logout", requireAuth, async (req, res) => {
    try {
      res.clearCookie("auth_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  // Update user preferences (requires auth - uses session username)
  app.patch("/api/user/preferences", requireAuth, async (req, res) => {
    console.log('[PATCH /api/user/preferences] Route hit', { 
      path: req.path, 
      url: req.url,
      method: req.method,
      hasBody: !!req.body 
    });
    try {
      const username = req.user!.username;
      if (!username) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { theme, style, imageModelKey, llmModelKey, skipImageCache, typewriterEnabled } = req.body as {
        theme?: string;
        style?: string;
        imageModelKey?: string;
        llmModelKey?: string;
        skipImageCache?: boolean;
        typewriterEnabled?: boolean;
      };

      // Validate preferences exist in mod tables if provided
      if (theme || style) {
        const themesData = await storage.listStoryThemes();
        const stylesData = await storage.listVisualStyles();
        const activeThemes = themesData.filter(t => t.active === 1);
        const activeStyles = stylesData.filter(s => s.active === 1);
        
        console.log('[PATCH /api/user/preferences] Validation check', {
          theme,
          style,
          activeThemesCount: activeThemes.length,
          activeStylesCount: activeStyles.length,
          activeThemeLabels: activeThemes.map(t => t.label),
          activeThemeKeys: activeThemes.map(t => t.storyThemeKey),
          activeStyleLabels: activeStyles.map(s => s.label),
          activeStyleKeys: activeStyles.map(s => s.visualStyleKey)
        });
        
        if (theme && theme.trim() !== '') {
          const themeExists = activeThemes.some(
            t => t.label.toLowerCase() === theme.toLowerCase() || 
                 t.storyThemeKey.toLowerCase() === theme.toLowerCase()
          );
          if (!themeExists) {
            console.error('[PATCH /api/user/preferences] Theme validation failed', {
              receivedTheme: theme,
              availableThemes: activeThemes.map(t => ({ label: t.label, storyThemeKey: t.storyThemeKey }))
            });
            return res.status(400).json({ error: `Invalid theme: ${theme}` });
          }
        }
        
        if (style && style.trim() !== '') {
          const styleExists = activeStyles.some(
            s => s.label.toLowerCase() === style.toLowerCase() || 
                 s.visualStyleKey.toLowerCase() === style.toLowerCase()
          );
          if (!styleExists) {
            console.error('[PATCH /api/user/preferences] Style validation failed', {
              receivedStyle: style,
              availableStyles: activeStyles.map(s => ({ label: s.label, visualStyleKey: s.visualStyleKey }))
            });
            return res.status(400).json({ error: `Invalid style: ${style}` });
          }
        }
      }

      // Story model: only models in the published catalog may be chosen, so a player cannot
      // point the game at an arbitrary (or expensive) model. Empty string clears the choice.
      if (llmModelKey !== undefined && llmModelKey !== '') {
        const { listSelectableLlmModels } = await import("./llm/models");
        const selectable = await listSelectableLlmModels();
        const allowed = typeof llmModelKey === 'string' &&
          selectable.some((m: any) => (m.modelKey ?? m.model_key) === llmModelKey);
        if (!allowed) {
          return res.status(400).json({ error: `Invalid story model: ${llmModelKey}` });
        }
      }

      const updated = await storage.updateUserPreferences(username, {
        theme,
        style,
        imageModelKey,
        llmModelKey,
        skipImageCache,
        typewriterEnabled,
      });

      const preferences = {
        theme: updated.theme ?? undefined,
        style: updated.style ?? undefined,
        imageModelKey: updated.imageModelKey ?? undefined,
        llmModelKey: updated.llmModelKey ?? undefined,
        skipImageCache: updated.skipImageCache ?? undefined,
        typewriterEnabled: updated.typewriterEnabled ?? undefined,
      };

      res.json(preferences);
    } catch (error) {
      console.error("Error updating user preferences:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        username: req.body?.username
      });
      if (error instanceof Error && error.message.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to update user preferences" });
    }
  });

  // LLM log endpoints
  app.get("/api/llm-logs", requireAdmin, async (req, res) => {
    try {
      const gameId = req.query.gameId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const logs = await storage.getLlmLogs({ gameId, limit });
      res.json(logs);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  app.delete("/api/llm-logs", requireAdmin, async (req, res) => {
    try {
      await storage.clearAllLlmLogs();
      res.json({ success: true, message: "All logs cleared" });
    } catch (error) {
      console.error("Error clearing logs:", error);
      res.status(500).json({ error: "Failed to clear logs" });
    }
  });

  // Cache management endpoints
  app.get("/api/cache/images", requireAdmin, async (req, res) => {
    try {
      const templateName = req.query.templateName as string | undefined;
      const gameId = req.query.gameId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      let images;
      if (templateName) {
        images = await storage.getGeneratedImagesByTemplate(templateName);
      } else {
        images = await storage.getAllGeneratedImages();
      }

      // Apply additional filters
      if (gameId) {
        images = images.filter(img => img.gameId === gameId);
      }

      // Apply limit
      images = images.slice(0, limit);

      res.json(images);
    } catch (error) {
      console.error("Error fetching cached images:", error);
      res.status(500).json({ error: "Failed to fetch cached images" });
    }
  });

  app.get("/api/cache/images/:id", requireAdmin, async (req, res) => {
    try {
      const image = await storage.getGeneratedImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }
      res.json(image);
    } catch (error) {
      console.error("Error fetching image:", error);
      res.status(500).json({ error: "Failed to fetch image" });
    }
  });

  app.get("/api/cache/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getImageCacheStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching cache stats:", error);
      res.status(500).json({ error: "Failed to fetch cache stats" });
    }
  });

  app.delete("/api/cache/images/:id", requireAdmin, async (req, res) => {
    try {
      const image = await storage.getGeneratedImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      // Delete file from disk
      const { deleteImageFile } = await import("./imageStorage.js");
      await deleteImageFile(image.filePath);

      // Delete from database
      await storage.deleteGeneratedImage(req.params.id);

      res.json({ success: true, message: "Image deleted" });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  app.delete("/api/cache/images", requireAdmin, async (req, res) => {
    try {
      const { templateName, gameId, before, maxAccessCount } = req.body;

      const filters: any = {};
      if (templateName) filters.templateName = templateName;
      if (gameId) filters.gameId = gameId;
      if (before) filters.before = new Date(before);
      if (maxAccessCount !== undefined) filters.maxAccessCount = parseInt(maxAccessCount);

      const deletedCount = await storage.deleteGeneratedImages(filters);

      // Clean up orphaned files
      const { cleanupOrphanedFiles } = await import("./imageStorage.js");
      const remainingImages = await storage.getAllGeneratedImages();
      const validFilePaths = remainingImages.map(img => img.filePath);
      const orphanedCount = await cleanupOrphanedFiles(validFilePaths);

      res.json({ 
        success: true, 
        message: `Deleted ${deletedCount} images and ${orphanedCount} orphaned files`,
        deletedCount,
        orphanedCount
      });
    } catch (error) {
      console.error("Error bulk deleting images:", error);
      res.status(500).json({ error: "Failed to delete images" });
    }
  });

  app.post("/api/cache/clear", requireAdmin, async (req, res) => {
    try {
      const deletedCount = await storage.deleteGeneratedImages();

      // Clean up all files
      const { cleanupOrphanedFiles } = await import("./imageStorage.js");
      const orphanedCount = await cleanupOrphanedFiles([]);

      res.json({ 
        success: true, 
        message: `Cleared entire cache: ${deletedCount} database records and ${orphanedCount} files deleted`,
        deletedCount,
        orphanedCount
      });
    } catch (error) {
      console.error("Error clearing cache:", error);
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  app.get("/api/cache/similar/:id", requireAdmin, async (req, res) => {
    try {
      const image = await storage.getGeneratedImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      const threshold = parseFloat(req.query.threshold as string) || 0.7;
      const templateImages = await storage.getGeneratedImagesByTemplate(image.templateName);
      const candidateFingerprints = templateImages
        .filter(img => img.id !== image.id)
        .map(img => img.sceneFingerprint);

      const { findSimilarScenes } = await import("./cacheUtils.js");
      const similarScenes = findSimilarScenes(
        image.sceneFingerprint as any,
        candidateFingerprints as any,
        threshold
      );

      const similarImages = similarScenes.map(({ fingerprint, similarity }) => {
        const similarImage = templateImages.find(img => 
          JSON.stringify(img.sceneFingerprint) === JSON.stringify(fingerprint)
        );
        return {
          image: similarImage,
          similarity
        };
      }).filter(({ image }) => image !== undefined);

      res.json(similarImages);
    } catch (error) {
      console.error("Error finding similar images:", error);
      res.status(500).json({ error: "Failed to find similar images" });
    }
  });

  // Manual cache cleanup endpoint
  app.post("/api/admin/cache/cleanup", requireAdmin, async (req, res) => {
    try {
      const { ImageCacheCleanup } = await import('./imageCacheCleanup');
      const cleanup = new ImageCacheCleanup();
      const deleted = await cleanup.cleanupOldImages();
      
      res.json({ 
        success: true, 
        deletedCount: deleted,
        message: `Cleaned up ${deleted} images`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Cache cleanup error:", error);
      res.status(500).json({ 
        success: false,
        error: "Failed to cleanup cache",
        timestamp: new Date().toISOString()
      });
    }
  });

  // Reference publishing endpoints
  app.post("/api/admin/reference/publish/:version", requireAdmin, async (req, res) => {
    try {
      const { version } = req.params;
      const { author, notes, makeCurrent = false } = req.body;

      if (!author) {
        return res.status(400).json({ error: "author is required" });
      }

      const result = await publishReference({
        version,
        author,
        notes,
        makeCurrent,
      });

      res.json({
        success: true,
        message: `Reference ${version} published successfully`,
        ...result,
      });
    } catch (error) {
      console.error("Error publishing reference:", error);
      res.status(500).json({ 
        error: "Failed to publish reference",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/admin/reference/:version/activate", requireAdmin, async (req, res) => {
    try {
      const { version } = req.params;
      
      await activateReferenceRelease(version);
      
      res.json({
        success: true,
        message: `Reference ${version} activated successfully`,
        version,
        isCurrent: true,
      });
    } catch (error) {
      console.error("Error activating reference:", error);
      res.status(500).json({ 
        error: "Failed to activate reference",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/admin/reference/releases", requireAdmin, async (req, res) => {
    try {
      const releases = await getAllReferenceReleases();
      res.json({
        success: true,
        releases,
      });
    } catch (error) {
      console.error("Error fetching reference releases:", error);
      res.status(500).json({ 
        error: "Failed to fetch reference releases",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/admin/reference/current", requireAdmin, async (req, res) => {
    try {
      const current = await getCurrentReferenceRelease();
      res.json({
        success: true,
        current,
      });
    } catch (error) {
      console.error("Error fetching current reference:", error);
      res.status(500).json({ 
        error: "Failed to fetch current reference",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Compares the database with its current release, value by value. Read-only.
  app.get("/api/admin/reference/verify", requireAdmin, async (_req, res) => {
    try {
      res.json({ success: true, ...(await verifyRelease()) });
    } catch (error) {
      console.error("Error verifying reference:", error);
      res.status(500).json({
        error: "Failed to verify reference",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // GET /api/admin/games/search - Search games by username or game ID
  app.get("/api/admin/games/search", requireAdmin, async (req, res) => {
    try {
      const { q, limit } = req.query;
      const searchQuery = typeof q === "string" ? q.trim() : "";
      const resultLimit = limit ? parseInt(String(limit), 10) : 20;

      if (!searchQuery || searchQuery.length < 2) {
        return res.json({ games: [] });
      }

      // Search by username
      const users = await storage.searchUsersByUsername(searchQuery, resultLimit);
      const gamesByUsername: any[] = [];

      for (const user of users) {
        const userGames = await storage.getGamesByUsername(user.username);
        for (const game of userGames) {
          gamesByUsername.push({
            id: game.id,
            username: game.username,
            turnNumber: game.turnNumber,
            day: game.day,
            segment: game.segment,
            isComplete: game.isComplete,
          });
        }
      }

      // Also search by game ID if it looks like a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let gamesById: any[] = [];
      if (uuidRegex.test(searchQuery)) {
        const game = await storage.getGameState(searchQuery);
        if (game) {
          gamesById.push({
            id: game.id,
            username: game.username,
            turnNumber: game.turnNumber,
            day: game.day,
            segment: game.segment,
            isComplete: game.isComplete,
          });
        }
      }

      // Combine and deduplicate
      const allGames = [...gamesById, ...gamesByUsername];
      const uniqueGames = Array.from(
        new Map(allGames.map((g) => [g.id, g])).values()
      ).slice(0, resultLimit);

      res.json({ games: uniqueGames });
    } catch (error) {
      console.error("Error searching games:", error);
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  const httpServer = createServer(app);
  
  // Set up Socket.IO with configurable CORS
  let corsOrigin: boolean | string | string[] = false;
  if (process.env.ALLOWED_ORIGINS) {
    const origins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
    // Handle wildcard for allowing all origins
    if (origins.length === 1 && origins[0] === '*') {
      corsOrigin = true; // Socket.IO accepts true for all origins
    } else {
      corsOrigin = origins;
    }
  } else if (process.env.NODE_ENV === 'development') {
    corsOrigin = true; // Allow all origins in development
  }
  
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true // Allow credentials (cookies, etc.)
    }
  });
  
  // Register Socket.IO instance for use in other modules (e.g., LLM logging)
  const { setSocketIO } = await import('./socketManager');
  setSocketIO(io);
  
  // Handle WebSocket connections
  // Who is signed in (same auth_token cookie as the REST routes); room access is checked below
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join game room: only the signed-in owner of the game may
    socket.on('joinGame', async (gameId: string, ack?: unknown) => {
      await handleJoinGame(socket, gameId, ack, (id) => storage.getGameState(id));
    });

    // Leave game room
    socket.on('leaveGame', (gameId: string) => {
      if (typeof gameId !== 'string') return;
      socket.leave(gameId);
    });
  });
  
  // Start orchestrator workers
  if (!ORCHESTRATOR_DISABLED) {
    const { TurnPrecomputeWorker, TurnApplyWorker, ImageWorker } = await import('./orchestrator/workers');
    const turnPrecomputeWorker = new TurnPrecomputeWorker();
    turnPrecomputeWorker.start();
    const turnApplyWorker = new TurnApplyWorker(io);
    turnApplyWorker.start();
    const imageWorker = new ImageWorker(io);
    imageWorker.start();
  }
  
  // Start cleanup service
  const { ImageCacheCleanup } = await import('./imageCacheCleanup');
  const cleanupService = new ImageCacheCleanup();
  cleanupService.start();
  
  // Pre-warm reference cache to avoid loading delay on first game start
  try {
    await getCurrentReference();
    const sync = await referenceSyncStatus();
    if (!sync.inSync) {
      console.warn(
        `[reference] The game loads release ${sync.version ?? "(none)"} from releases/current, ` +
          `but the database's current release is ${sync.dbVersion ?? "(none)"}. ` +
          `Dev Tools would publish from a database that does not match. Run: npm run db:init`
      );
    }
    console.log('Reference cache pre-warmed successfully');
  } catch (error) {
    console.warn('Failed to pre-warm reference cache:', error);
    // Don't fail server startup if reference loading fails
  }
  
  return httpServer;
}

// Helper functions
function selectFallbackImageTemplate(state: GameState, event?: any): string {
  // Segment-based selection
  if (state.segment === 'Launch from Earth') {
    return 'day_launch';
  }
  if (state.segment === 'Arrival on Uranus') {
    return 'day_arrival';
  }

  // Event-based selection
  if (event) {
    const tags = event.tags || [];
    if (tags.includes('technical')) return 'technical_problem';
    if (tags.includes('cosmic')) return 'cosmic_encounter';
    if (tags.includes('crisis')) return 'crisis_moment';
  }
  
  // Content-based selection (check last narrative)
  if (state.turns.length > 0) {
    const lastNarrative = state.turns[state.turns.length - 1].narrative.toLowerCase();
    if (lastNarrative.includes('crew') && lastNarrative.includes('yell')) {
      return 'character_interaction';
    }
  }
  
  // Default fallback
  return 'general_scene';
}

function mapIntentToSkill(intent: Intent): any {
  const mapping = {
    repair: 'Engineering',
    negotiate: 'Diplomacy',
    cook: 'Culinary',
    explore: 'Piloting',
    improvise: 'Vibes',
    research: 'Bureaucracy',
    command: 'Deception',
    other: 'Vibes'
  };
  return mapping[intent] || 'Vibes';
}

function getBaseDC(risk: string): number {
  switch (risk) {
    case 'Safe': return 10;
    case 'Risky': return 14;
    case 'Wild': return 18;
    default: return 12;
  }
}

function getActionConsequences(action: any, success: boolean): string {
  const risk = action.risk;

  if (success) {
    switch (risk) {
      case 'Safe': return 'hull+2,morale+1';
      case 'Risky': return 'hull+3,morale+2';
      case 'Wild': return 'hull+5,morale+3,weirdness+1';
      default: return 'morale+1';
    }
  } else {
    switch (risk) {
      case 'Safe': return 'hull-1';
      case 'Risky': return 'hull-2,morale-1';
      case 'Wild': return 'hull-3,morale-2,weirdness+1';
      default: return 'morale-1';
    }
  }
}

function getActionTags(intent: Intent): string[] {
  const tags = {
    repair: ['technical'],
    negotiate: ['crew', 'authority'],
    cook: ['crew', 'gross'],
    explore: ['travel'],
    improvise: ['absurd'],
    research: ['bureaucracy'],
    command: ['authority'],
    other: []
  };
  return tags[intent] || [];
}

function updateNPCAffinities(state: GameState, skill: any, success: boolean) {
  // Update NPC affinity when their specialist skills are checked
  for (const npc of state.npcs) {
    const relevantSkills = NPC_SKILL_MAPPINGS[npc.name] || [];
    if (relevantSkills.includes(skill)) {
      const change = success ? 1 : -1;
      npc.affinity = Math.max(-3, Math.min(3, npc.affinity + change));

      // Update status based on affinity
      if (npc.affinity >= 2) {
        npc.status = Math.random() > 0.5 ? 'Crush' : 'Indifferent';
      } else if (npc.affinity <= -2) {
        npc.status = 'Rivalry';
      } else {
        npc.status = 'Indifferent';
      }
    }
  }
}
