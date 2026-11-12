/**
 * Turn Precompute Worker
 * Claims jobs from turn-precompute queue, runs deterministic checks + LLM calls,
 * and enqueues to turn-apply queue
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.2
 */

import { getOrchestrator } from '../index';
import { getQueueConfig } from '../../config/queues';
import { storage } from '../../storage';
import { computeTurnChecks, computePostTurnState } from '../../gameLogic';
import { getItemById } from '../../gameEngine';
import { generateTurnContentWithFlag, generateActions } from '../../aiService';
import { prepareTurnImageMetadata } from '../../gameLogic';
import { createProvisionalManifest, updatePrecomputeSection, updateRequestSection } from '../manifest/writer';
import { createHash } from 'crypto';
import { log } from '../../logger';
import { turnPrecomputePhaseDuration } from '../../metrics';
import type { ActionInput, GameState, TurnJob } from '@shared/schema';
import type { JobLease } from '../types';
import type { PrecomputeSection } from '../manifest/types';
import type { StageMetadata } from '../../pce/contentRouter';
import { annotateSpan, currentRootTraceRef, withSpan } from '../../observability/langsmith';
import { HandledJobFailure, runTracedJob } from './jobTracing';

export class TurnPrecomputeWorker {
  private workerId: string;
  private processing = false;
  private interval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private activeLeases: Map<string, { lease: JobLease<TurnJob>; heartbeatTimer: NodeJS.Timeout }> = new Map();

  constructor() {
    // Generate unique worker ID
    const hostname = process.env.HOSTNAME || 'unknown';
    const pid = process.pid;
    this.workerId = `turn-precompute-${hostname}-${pid}`;
  }

  start(pollIntervalMs = 5000) {
    if (this.interval) return;

    const config = getQueueConfig('turn-precompute');
    
    // Main polling loop
    this.interval = setInterval(() => {
      this.processPendingJobs().catch((error: unknown) => {
        log(`[TurnPrecomputeWorker] Error in processPendingJobs: ${String(error)}`);
      });
    }, config.pollFallbackMs || pollIntervalMs);

    // Heartbeat loop for active leases
    this.heartbeatInterval = setInterval(() => {
      this.heartbeatActiveLeases().catch((error: unknown) => {
        log(`[TurnPrecomputeWorker] Error in heartbeatActiveLeases: ${String(error)}`);
      });
    }, config.heartbeatIntervalMs);

    log(`[TurnPrecomputeWorker] Started with workerId: ${this.workerId}`);
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
        log(`[TurnPrecomputeWorker] Error releasing lease ${leaseId}: ${String(error)}`);
      });
    }
    this.activeLeases.clear();
    
    log('[TurnPrecomputeWorker] Stopped');
  }

  private async processPendingJobs() {
    if (this.processing) return;
    this.processing = true;

    try {
      const orchestrator = getOrchestrator();
      const leases = await orchestrator.claim('turn-precompute', this.workerId, { batchSize: 5 });

      for (const lease of leases) {
        // Track lease for heartbeat
        const config = getQueueConfig('turn-precompute');
        const heartbeatTimer = setTimeout(() => {
        this.heartbeatLease(lease).catch((error: unknown) => {
          log(`[TurnPrecomputeWorker] Error heartbeating lease ${lease.leaseId}: ${String(error)}`);
        });
        }, config.heartbeatIntervalMs);
        
        this.activeLeases.set(lease.leaseId, { lease, heartbeatTimer });

        // Process job asynchronously (don't await)
      this.processJob(lease).finally(() => {
        this.activeLeases.delete(lease.leaseId);
        clearTimeout(heartbeatTimer);
      }).catch((error: unknown) => {
        log(`[TurnPrecomputeWorker] Error processing job ${lease.job.id}: ${String(error)}`);
      });
      }
    } catch (error) {
      log(`[TurnPrecomputeWorker] Error claiming jobs: ${String(error)}`);
    } finally {
      this.processing = false;
    }
  }

  private async heartbeatActiveLeases() {
    const now = Date.now();
    const config = getQueueConfig('turn-precompute');

    for (const [leaseId, { lease }] of this.activeLeases.entries()) {
      const timeUntilExpiry = lease.leaseExpiresAt.getTime() - now;
      const extensionNeeded = config.leaseDurationMs * 0.5; // Extend when 50% of lease time remaining

      if (timeUntilExpiry < extensionNeeded) {
        await this.heartbeatLease(lease);
      }
    }
  }

  private async heartbeatLease(lease: JobLease<TurnJob>) {
    const config = getQueueConfig('turn-precompute');
    await lease.extend(config.leaseDurationMs);
  }

  /** One trace per turn starts here; the apply and image workers continue it. */
  private async processJob(lease: JobLease<TurnJob>) {
    const payload = lease.job.payload as { id: string };
    await runTracedJob(
      lease,
      {
        rootName: 'turn',
        childName: 'turn.precompute',
        inputs: { turnJobId: payload.id },
        metadata: { turnJobId: payload.id },
        tags: ['turn']
      },
      () => this.processJobTraced(lease)
    );
  }

  private async processJobTraced(lease: JobLease<TurnJob>) {
    const payload = lease.job.payload as { id: string };
    const startedAt = new Date();
    const totalTimer = turnPrecomputePhaseDuration.startTimer({ phase: 'total' });

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

      log(`[TurnPrecomputeWorker] Processing job ${job.id} for game ${job.gameId}`);

      // Load game state
      const currentState = await storage.getGameState(job.gameId);
      if (!currentState) {
        throw new Error(`Game ${job.gameId} not found`);
      }

      const action = job.actionPayload as ActionInput;
      const userPreferences = await storage.getUserPreferences(currentState.username);

      // thread_id groups every turn of one game into a single thread in LangSmith.
      annotateSpan({
        gameId: job.gameId,
        thread_id: job.gameId,
        turnNumber: currentState.turnNumber,
        action: action.action
      });

      // Skip precomputation for intro turns (they process themselves)
      if (action.action === '__intro_turn__') {
        // For intro turns, we skip precompute and go straight to apply
        // Enqueue directly to turn-apply
        const orchestrator = getOrchestrator();
        await orchestrator.enqueue({
          queue: 'turn-apply',
          payload: { id: job.id },
          traceId: lease.job.traceId,
          requestId: lease.job.requestId,
          metadata: { ...lease.job.metadata, skipPrecompute: true },
        });
        await lease.complete();
        totalTimer();
        return;
      }

      // Create provisional manifest
      const manifestId = await createProvisionalManifest(
        job.gameId,
        currentState.turnNumber,
        lease.job.id,
        lease.job.attempts,
        lease.job.traceId,
        lease.job.requestId
      );

      // Compute source state digest
      const sourceStateDigest = this.computeStateDigest(currentState);

      // Store sourceStateDigest and preconditions in manifest request section
      await updateRequestSection(manifestId, {
        langsmith: currentRootTraceRef(),
        sourceStateDigest,
        preconditions: {
          turnNumber: currentState.turnNumber,
          day: currentState.day,
          segment: currentState.segment,
        },
        action: {
          type: action.action,
          params: action as Record<string, unknown>,
        },
      });

      // Step 1: Compute turn checks (deterministic, no LLM calls)
      const checksTimer = turnPrecomputePhaseDuration.startTimer({ phase: 'compute_checks' });
      const checksStart = Date.now();
      const computed = await withSpan(
        'turn.checks',
        {
          inputs: { action: action.action, customText: (action as any).customText },
          outputs: (r) => ({
            selectedAction: r.selectedAction?.action,
            skill: r.skill,
            success: r.success,
            event: r.event?.name ?? null,
            checks: r.checks
          })
        },
        () => computeTurnChecks(currentState, action)
      );
      const checksDuration = Date.now() - checksStart;
      checksTimer();

      // Step 2: Generate turn content (LLM call - OUTSIDE transaction)
      const llmCalls: PrecomputeSection['llmCalls'] = [];
      const contentTimer = turnPrecomputePhaseDuration.startTimer({ phase: 'generate_content' });
      const turnContentStart = Date.now();
      const turnContent = await generateTurnContentWithFlag(
        currentState,
        computed.selectedAction.action,
        computed.checks,
        userPreferences,
        {},
        computed.event ? { name: computed.event.name, segment: computed.event.segment, skill: computed.event.skill } : null
      );
      const turnContentDuration = Date.now() - turnContentStart;
      contentTimer();
      
      // One entry per model call, in the order they were made (retries and fallbacks included).
      for (const call of (turnContent.promptChain ?? []) as StageMetadata[]) {
        llmCalls.push({
          model: call.model ?? 'unknown',
          promptTemplate: `pce_${call.template}`,
          promptHash: call.promptHash ?? '',
          latencyMs: call.durationMs ?? 0,
          cache: 'miss', // story stages are never cached
          stage: call.stage,
          modelKey: call.modelKey ?? null,
          provider: call.provider,
          templateHash: call.templateHash,
          templateSource: call.templateSource,
          recovery: call.recovery,
          usage: call.usage,
          error: call.error,
        });
      }

      // Step 3: Generate next actions (LLM call - OUTSIDE transaction)
      // Note: Must run sequentially after narrative generation since actions need the narrative
      const equippedItems = await Promise.all(
        currentState.equippedItems.map(async (id: string) => getItemById(id))
      );
      const validEquippedItems = equippedItems.filter((item: Awaited<ReturnType<typeof getItemById>>): item is NonNullable<Awaited<ReturnType<typeof getItemById>>> => item !== undefined);

      const postTurnState = computePostTurnState(currentState, {
        selectedAction: computed.selectedAction,
        event: computed.event,
        success: computed.success,
        nextTurnNumber: computed.nextTurnNumber
      }, validEquippedItems);

      // Add the turn we're about to create to the state
      postTurnState.turns = [
        ...currentState.turns,
        {
          turnNumber: computed.nextTurnNumber,
          action: computed.selectedAction.action,
          narrative: turnContent.narration,
          checks: computed.checks,
          delta: [],
          timestamp: Date.now()
        } as any
      ];

      // Step 3: Use actions from PCE pipeline (already generated, no additional LLM calls)
      // The PCE pipeline always generates actions, so they should always be present
      if (!turnContent.actions || !Array.isArray(turnContent.actions) || turnContent.actions.length === 0) {
        throw new Error(`PCE pipeline failed to generate actions for turn ${computed.nextTurnNumber}. Actions missing from turnContent.`);
      }
      
      const nextActions = turnContent.actions;
      console.log('[TurnPrecomputeWorker] Using actions from PCE pipeline', {
        actionsCount: nextActions.length
      });

      // Step 4: Prepare image metadata (cache check - OUTSIDE transaction)
      const imageTimer = turnPrecomputePhaseDuration.startTimer({ phase: 'prepare_image' });
      const imageStart = Date.now();
      const tempTurn: any = {
        turnNumber: computed.nextTurnNumber,
        imagePrompt: turnContent.imagePrompt || undefined
      };
      const precomputedImageMetadata = await withSpan(
        'turn.image_plan',
        {
          inputs: { turnNumber: computed.nextTurnNumber, hasImagePrompt: !!tempTurn.imagePrompt },
          outputs: (r) => ({ cacheHit: !!r?.imageUrl, template: r?.templateName ?? null })
        },
        () => prepareTurnImageMetadata(currentState, tempTurn, userPreferences, computed.nextTurnNumber)
      );
      const imageDuration = Date.now() - imageStart;
      imageTimer();

      // Calculate deterministic and LLM durations
      // Note: actionsDuration is included in turnContentDuration since actions are generated
      // by the PCE pipeline as part of generateTurnContentWithFlag
      const deterministicDurationMs = checksDuration + imageDuration;
      const llmDurationMs = turnContentDuration;

      // Build precompute section
      const completedAt = new Date();
      const precomputeSection: PrecomputeSection = {
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        deterministicDurationMs,
        llmDurationMs,
        deterministic: {
          checks: computed.checks,
          selectedAction: computed.selectedAction,
          event: computed.event,
          skill: computed.skill,
          success: computed.success,
          nextTurnNumber: computed.nextTurnNumber,
          rng: {
            seed: currentState.seed,
            rolls: [computed.checks[0]?.roll || 0], // Extract roll from checks
          },
        },
        llmCalls,
        turnContent: {
          narration: turnContent.narration,
          imagePrompt: turnContent.imagePrompt,
          imageModelKey: turnContent.imageModelKey,
          imageMetadata: turnContent.imageMetadata,
          imagePromptSource: turnContent.imagePromptSource,
          theme: turnContent.theme,
          style: turnContent.style,
          toneHints: turnContent.toneHints,
          promptChain: turnContent.promptChain,
          masterEnrichment: turnContent.masterEnrichment,
          fallbackUsed: turnContent.fallbackUsed,
        },
        actions: nextActions,
        imagePlan: precomputedImageMetadata ? {
          cacheKey: '', // TODO: Extract from precomputedImageMetadata
          template: precomputedImageMetadata.templateName || '',
          cacheHit: !!precomputedImageMetadata.imageUrl,
          imageUrl: precomputedImageMetadata.imageUrl,
        } : undefined,
        warnings: [],
        userPreferences: {
          theme: userPreferences.theme,
          style: userPreferences.style,
          imageModelKey: userPreferences.imageModelKey,
          llmModelKey: userPreferences.llmModelKey,
          skipImageCache: userPreferences.skipImageCache,
        },
      };

      // Update manifest with precompute section
      await updatePrecomputeSection(manifestId, precomputeSection);

      // Enqueue to turn-apply queue
      const orchestrator = getOrchestrator();
      await orchestrator.enqueue({
        queue: 'turn-apply',
        payload: { id: job.id },
        traceId: lease.job.traceId,
        requestId: lease.job.requestId,
        metadata: {
          ...lease.job.metadata,
          manifestId,
          precomputeHash: precomputeSection.precomputeHash,
        },
      });

      // Complete lease
      await lease.complete({ manifestId, precomputeHash: precomputeSection.precomputeHash });

      totalTimer();
      log(`[TurnPrecomputeWorker] Completed job ${job.id} for game ${job.gameId}`);
    } catch (error) {
      totalTimer();
      const jobId = payload.id;
      log(`[TurnPrecomputeWorker] Failed to process job ${jobId}: ${String(error)}`);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTransient = this.isTransientError(error);
      
      await lease.fail({
        reason: isTransient ? 'transient' : 'permanent',
        message: errorMessage,
        details: { stack: error instanceof Error ? error.stack : undefined },
      });
      throw new HandledJobFailure(errorMessage);
    }
  }

  private computeStateDigest(state: GameState): string {
    // Create a deterministic projection of game state for hashing
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

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Consider network errors, rate limits, timeouts as transient
      return message.includes('timeout') ||
             message.includes('network') ||
             message.includes('rate limit') ||
             message.includes('econnreset') ||
             message.includes('enotfound');
    }
    return false;
  }
}
