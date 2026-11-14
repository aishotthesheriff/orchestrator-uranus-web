/**
 * Turn Apply Worker
 * Claims jobs from turn-apply queue, applies precomputed turn logic in transaction,
 * and updates manifest
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.3
 */

import { getOrchestrator } from '../index';
import { getQueueConfig } from '../../config/queues';
import { storage } from '../../storage';
import { processTurnLogic, processTurnImage } from '../../gameLogic';
import { updateApplySection } from '../manifest/writer';
import { log } from '../../logger';
import { turnApplyPhaseDuration, e2eLatency } from '../../metrics';
import type { ActionInput, GameState, TurnJob } from '@shared/schema';
import type { JobLease } from '../types';
import type { ApplySection, PrecomputedTurnData } from '../manifest/types';
import { Server as SocketIOServer } from 'socket.io';
import { createHash } from 'crypto';
import { annotateSpan } from '../../observability/langsmith';
import { HandledJobFailure, runTracedJob } from './jobTracing';
import { maybeSampleTurn, sampledTurnFromManifest } from '../../evals/liveSampler';
import { emitToRoom } from "../../socketRelay";

export class TurnApplyWorker {
  private workerId: string;
  private io: SocketIOServer;
  private processing = false;
  private interval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private activeLeases: Map<string, { lease: JobLease<TurnJob>; heartbeatTimer: NodeJS.Timeout }> = new Map();

  constructor(io: SocketIOServer) {
    const hostname = process.env.HOSTNAME || 'unknown';
    const pid = process.pid;
    this.workerId = `turn-apply-${hostname}-${pid}`;
    this.io = io;
  }

  start(pollIntervalMs = 5000) {
    if (this.interval) return;

    const config = getQueueConfig('turn-apply');
    
    // Main polling loop
    this.interval = setInterval(() => {
      this.processPendingJobs().catch((error: unknown) => {
        log(`[TurnApplyWorker] Error in processPendingJobs: ${String(error)}`);
      });
    }, config.pollFallbackMs || pollIntervalMs);

    // Heartbeat loop for active leases
    this.heartbeatInterval = setInterval(() => {
      this.heartbeatActiveLeases().catch((error: unknown) => {
        log(`[TurnApplyWorker] Error in heartbeatActiveLeases: ${String(error)}`);
      });
    }, config.heartbeatIntervalMs);

    log(`[TurnApplyWorker] Started with workerId: ${this.workerId}`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Release all active leases
    for (const [leaseId, { lease, heartbeatTimer }] of this.activeLeases.entries()) {
      clearTimeout(heartbeatTimer);
      lease.release().catch((error: unknown) => {
        log(`[TurnApplyWorker] Error releasing lease ${leaseId}: ${String(error)}`);
      });
    }
    this.activeLeases.clear();
    
    log('[TurnApplyWorker] Stopped');
  }

  private async processPendingJobs() {
    if (this.processing) return;
    this.processing = true;

    try {
      const orchestrator = getOrchestrator();
      const leases = await orchestrator.claim('turn-apply', this.workerId, { batchSize: 5 });

      for (const lease of leases) {
        // Track lease for heartbeat
        const config = getQueueConfig('turn-apply');
        const heartbeatTimer = setTimeout(() => {
          this.heartbeatLease(lease).catch((error: unknown) => {
            log(`[TurnApplyWorker] Error heartbeating lease ${lease.leaseId}: ${String(error)}`);
          });
        }, config.heartbeatIntervalMs);
        
        this.activeLeases.set(lease.leaseId, { lease, heartbeatTimer });

        // Process job asynchronously (don't await)
        this.processJob(lease).finally(() => {
          this.activeLeases.delete(lease.leaseId);
          clearTimeout(heartbeatTimer);
        }).catch((error: unknown) => {
          log(`[TurnApplyWorker] Error processing job ${lease.job.id}: ${String(error)}`);
        });
      }
    } catch (error) {
      log(`[TurnApplyWorker] Error claiming jobs: ${String(error)}`);
    } finally {
      this.processing = false;
    }
  }

  private async heartbeatActiveLeases() {
    const now = Date.now();
    const config = getQueueConfig('turn-apply');

    for (const [leaseId, { lease }] of this.activeLeases.entries()) {
      const timeUntilExpiry = lease.leaseExpiresAt.getTime() - now;
      const extensionNeeded = config.leaseDurationMs * 0.5;

      if (timeUntilExpiry < extensionNeeded) {
        await this.heartbeatLease(lease);
      }
    }
  }

  private async heartbeatLease(lease: JobLease<TurnJob>) {
    const config = getQueueConfig('turn-apply');
    await lease.extend(config.leaseDurationMs);
  }

  /** Continues the turn's trace when the precompute worker passed its headers along. */
  private async processJob(lease: JobLease<TurnJob>) {
    const payload = lease.job.payload as { id: string };
    await runTracedJob(
      lease,
      {
        rootName: 'turn',
        childName: 'turn.apply',
        inputs: { turnJobId: payload.id, manifestId: lease.job.metadata?.manifestId ?? null },
        metadata: { turnJobId: payload.id },
        tags: ['turn']
      },
      () => this.processJobTraced(lease)
    );
  }

  private async processJobTraced(lease: JobLease<TurnJob>) {
    const payload = lease.job.payload as { id: string };
    const startedAt = new Date();
    const manifestId = lease.job.metadata?.manifestId as string | undefined;
    const totalTimer = turnApplyPhaseDuration.startTimer({ phase: 'total' });

    try {
      // Load full job from database (payload only contains id)
      const job = await storage.getTurnJob(payload.id);
      if (!job) {
        await lease.fail({
          reason: 'permanent',
          message: `Turn job ${payload.id} not found in database`,
        });
        totalTimer();
        return;
      }

      log(`[TurnApplyWorker] Processing job ${job.id} for game ${job.gameId}`);

      // Track job creation time for end-to-end latency
      const jobCreatedAt = job.createdAt ? new Date(job.createdAt).getTime() : null;

      // Load game state
      const currentState = await storage.getGameState(job.gameId);
      if (!currentState) {
        throw new Error(`Game ${job.gameId} not found`);
      }

      const action = job.actionPayload as ActionInput;

      annotateSpan({
        gameId: job.gameId,
        thread_id: job.gameId,
        turnNumber: currentState.turnNumber,
        action: action.action
      });

      // For intro turns or skip-precompute, handle directly
      if (action.action === '__intro_turn__' || lease.job.metadata?.skipPrecompute) {
        // Load user preferences for intro turns (they don't use manifest)
        const userPreferences = await storage.getUserPreferences(currentState.username);
        const transactionTimer = turnApplyPhaseDuration.startTimer({ phase: 'transaction' });
        const processTimer = turnApplyPhaseDuration.startTimer({ phase: 'process_logic' });
        const updatedState: GameState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
          processTimer();
          return await processTurnLogic(state, action);
        });
        transactionTimer();

        await lease.complete();
        emitToRoom(this.io, job.gameId, 'turnComplete', { gameId: job.gameId, turnNumber: updatedState.turnNumber });
        totalTimer();
        return;
      }

      // Load manifest if available
      let manifest: any = null;
      if (manifestId) {
        manifest = await storage.getTurnExecutionManifest(job.gameId, currentState.turnNumber, lease.job.attempts);
        
        if (!manifest) {
          throw new Error(`Manifest ${manifestId} not found`);
        }

        // Verify precompute hash matches (idempotency check)
        const expectedPrecomputeHash = lease.job.metadata?.precomputeHash as string | undefined;
        if (expectedPrecomputeHash && manifest.precomputeHash.toString('hex') !== expectedPrecomputeHash) {
          throw new Error(`Precompute hash mismatch for manifest ${manifestId}`);
        }

        // Verify state hasn't changed since precompute
        const manifestData = manifest.manifest as any;
        const requestSection = manifestData?.request;
        
        if (requestSection?.sourceStateDigest) {
          const currentStateDigest = this.computeStateDigest(currentState);
          if (currentStateDigest !== requestSection.sourceStateDigest) {
            // State changed - fail with transient to force re-precompute
            log(`[TurnApplyWorker] State digest mismatch - state changed since precompute: ${JSON.stringify({
              expected: requestSection.sourceStateDigest,
              actual: currentStateDigest,
              gameId: job.gameId,
              turnNumber: currentState.turnNumber,
            })}`);
            
            await lease.fail({
              reason: 'transient',
              message: `Game state changed between precompute and apply. State digest mismatch.`,
              details: {
                expectedDigest: requestSection.sourceStateDigest,
                actualDigest: currentStateDigest,
              },
            });
            totalTimer();
            return;
          }
        }
      }

      // Extract precomputed data from manifest
      const manifestData = manifest?.manifest as any;
      const precomputeSection = manifestData?.precompute;
      
      if (!precomputeSection) {
        throw new Error('Precompute section not found in manifest');
      }

      // Extract user preferences from manifest (with fallback for backward compatibility)
      const userPreferences = precomputeSection.userPreferences 
        ? precomputeSection.userPreferences
        : await storage.getUserPreferences(currentState.username);

      // Build precomputed data for processTurnLogic
      const precomputed: PrecomputedTurnData = {
        turnContent: precomputeSection.turnContent ? {
          narration: precomputeSection.turnContent.narration || '',
          imagePrompt: precomputeSection.turnContent.imagePrompt || '',
          imageModelKey: precomputeSection.turnContent.imageModelKey || '',
          imageMetadata: precomputeSection.turnContent.imageMetadata || null,
          imagePromptSource: precomputeSection.turnContent.imagePromptSource || 'template',
          theme: precomputeSection.turnContent.theme || '',
          style: precomputeSection.turnContent.style || '',
          toneHints: precomputeSection.turnContent.toneHints || [],
          promptChain: precomputeSection.turnContent.promptChain || [],
          masterEnrichment: precomputeSection.turnContent.masterEnrichment || null,
          fallbackUsed: precomputeSection.turnContent.fallbackUsed || false,
        } : {
          narration: '',
          imagePrompt: '',
          imageModelKey: '',
          imageMetadata: null,
          imagePromptSource: 'template' as const,
          theme: '',
          style: '',
          toneHints: [],
          promptChain: [],
          masterEnrichment: null,
          fallbackUsed: false,
        },
        actions: precomputeSection.actions || [],
        checks: precomputeSection.deterministic?.checks || [],
        selectedAction: precomputeSection.deterministic?.selectedAction,
        event: precomputeSection.deterministic?.event || null,
        skill: precomputeSection.deterministic?.skill || '',
        success: precomputeSection.deterministic?.success ?? precomputeSection.deterministic?.checks?.[0]?.success ?? false,
        userPreferences: userPreferences,
      };

      // Apply turn logic in transaction
      const applyStartedAt = new Date();
      let transactionId = '';
      let rowsWritten = 0;
      let stateDiff: any = null;
      let imageJobQueueEntryId: string | undefined;

      const transactionTimer = turnApplyPhaseDuration.startTimer({ phase: 'transaction' });
      const updatedState: GameState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
        // A label for this apply, recorded in the manifest (not a database transaction id)
        const txResult = await storage.getGameState(state.id); // This will be within the transaction
        transactionId = `xact-${Date.now()}`;

        // Compute previous state digest
        const previousDigest = this.computeStateDigest(state);

        // Process turn with precomputed data
        const processTimer = turnApplyPhaseDuration.startTimer({ phase: 'process_logic' });
        const newState = await processTurnLogic(state, action, precomputed as any);
        processTimer();

        // Apply precomputed image metadata
        const finalTurn = newState.turns[newState.turns.length - 1];
        if (finalTurn) {
          const precomputedImageMetadata = precomputeSection.imagePlan ? {
            imageUrl: precomputeSection.imagePlan.imageUrl,
            templateName: precomputeSection.imagePlan.template,
            promptSource: (precomputed.turnContent.imagePromptSource || 'template') as 'pce' | 'template',
          } : null;

          const imageTimer = turnApplyPhaseDuration.startTimer({ phase: 'process_image' });
          await processTurnImage(newState, finalTurn, userPreferences, newState.turnNumber, precomputedImageMetadata);
          imageTimer();

          // Note: processTurnImage already handles image job creation if needed.
          // It sets turn.imageJobId when a job is created, so we don't need to create another one here.
          // The duplicate job creation logic has been removed to prevent duplicate image generation.
          // Use the imageJobId from the turn if it was set by processTurnImage
          if ((finalTurn as any).imageJobId) {
            imageJobQueueEntryId = (finalTurn as any).imageJobId;
          }
        }

        // Compute next state digest
        const nextDigest = this.computeStateDigest(newState);

        // Compute stat changes
        const statChanges: Record<string, number> = {};
        if (newState.stats && state.stats) {
          Object.keys(newState.stats).forEach(key => {
            const oldVal = (state.stats as any)[key] || 0;
            const newVal = (newState.stats as any)[key] || 0;
            if (oldVal !== newVal) {
              statChanges[key] = newVal - oldVal;
            }
          });
        }

        stateDiff = {
          previousDigest,
          nextDigest,
          statChanges,
          turnRecordId: finalTurn?.turnNumber?.toString(),
        };

        rowsWritten = 1; // games table + turns array update

        return newState;
      });
      transactionTimer();

      const applyCompletedAt = new Date();

      // Build apply section
      const applySection: ApplySection = {
        startedAt: applyStartedAt.toISOString(),
        completedAt: applyCompletedAt.toISOString(),
        durationMs: applyCompletedAt.getTime() - applyStartedAt.getTime(),
        transaction: {
          id: transactionId,
          tablesTouched: ['games', 'turns'],
          rowsWritten,
        },
        stateDiff,
        imageJob: imageJobQueueEntryId ? {
          queueEntryId: imageJobQueueEntryId,
          status: 'enqueued',
        } : undefined,
        socket: {
          emitted: true,
          namespace: '/game',
          room: job.gameId,
        },
        errors: [],
      };

      // Update manifest with apply section
      if (manifestId) {
        await updateApplySection(manifestId, applySection);
      }

      // Update legacy turn job status
      await storage.updateTurnJob(job.id, { status: 'completed', completedAt: new Date() });

      // Complete lease
      await lease.complete({ manifestId, turnNumber: updatedState.turnNumber });

      // Notify clients
      emitToRoom(this.io, job.gameId, 'turnComplete', { gameId: job.gameId, turnNumber: updatedState.turnNumber });

      // A fraction of turns is scored in the background (off unless a sample rate is set).
      if (manifestId) {
        maybeSampleTurn(() => sampledTurnFromManifest(manifestId, job.gameId, updatedState.turnNumber, manifestData));
      }

      // Record end-to-end latency
      if (jobCreatedAt) {
        const e2eDuration = Date.now() - jobCreatedAt;
        e2eLatency.observe({ operation: 'turn' }, e2eDuration);
      }

      totalTimer();
      log(`[TurnApplyWorker] Completed job ${job.id} for game ${job.gameId}`);
    } catch (error) {
      totalTimer();
      const jobId = payload.id;
      log(`[TurnApplyWorker] Failed to process job ${jobId}: ${String(error)}`);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Try to load job to get gameId for error reporting
      const job = await storage.getTurnJob(jobId).catch(() => null);
      
      // Update manifest with error if available
      let currentState: GameState | undefined;
      if (job) {
        try {
          currentState = await storage.getGameState(job.gameId);
        } catch (e) {
          // Ignore - game might not exist
        }
      }
      
      if (manifestId && currentState && job) {
        try {
          const manifest = await storage.getTurnExecutionManifest(job.gameId, currentState.turnNumber, lease.job.attempts);
          if (manifest) {
            const manifestData = manifest.manifest as any;
            const applySection: ApplySection = {
              startedAt: startedAt.toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startedAt.getTime(),
              errors: [errorMessage],
            };
            await updateApplySection(manifestId, applySection);
          }
        } catch (manifestError) {
          log(`[TurnApplyWorker] Failed to update manifest with error: ${String(manifestError)}`);
        }
      }

      const isStateMismatch = this.isStateMismatchError(error);
      const isTransient = isStateMismatch || this.isTransientError(error);
      
      await lease.fail({
        reason: isTransient ? 'transient' : 'permanent',
        message: errorMessage,
        details: { 
          stack: error instanceof Error ? error.stack : undefined,
          isStateMismatch,
        },
      });
      throw new HandledJobFailure(errorMessage);
    }
  }

  private computeStateDigest(state: GameState): string {
    const projection = {
      id: state.id,
      turnNumber: state.turnNumber,
      day: state.day,
      segment: state.segment,
      stats: state.stats,
      npcs: state.npcs.map(npc => ({ name: npc.name, affinity: npc.affinity })),
      equippedItems: state.equippedItems,
      seed: state.seed,
    };
    
    const json = JSON.stringify(projection, Object.keys(projection).sort());
    return createHash('sha256').update(json).digest('hex');
  }

  private isStateMismatchError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('State digest mismatch') || 
             error.message.includes('state changed between precompute');
    }
    return false;
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('timeout') ||
             message.includes('network') ||
             message.includes('rate limit') ||
             message.includes('econnreset') ||
             message.includes('enotfound');
    }
    return false;
  }
}
