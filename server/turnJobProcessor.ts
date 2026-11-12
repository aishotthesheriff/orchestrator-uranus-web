import { storage } from './storage';
import type { Server as SocketIOServer } from 'socket.io';
import type { TurnJob, ActionInput, GameState } from '@shared/schema';
import { processTurnLogic, processTurnImage, prepareTurnImageMetadata, computeTurnChecks, computePostTurnState } from './gameLogic';
import { getItemById } from './gameEngine';
import { generateTurnContentWithFlag, generateActions } from './aiService';

export class TurnJobProcessor {
  private io: SocketIOServer;
  private processing = false;
  private interval: NodeJS.Timeout | null = null;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  start(intervalMs = 500) {
    if (this.interval) return;
    this.interval = setInterval(() => this.processPendingJobs(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async processPendingJobs() {
    if (this.processing) return;
    this.processing = true;
    try {
      const jobs = await storage.claimPendingTurnJobs(5);
      for (const job of jobs) {
        await this.processJob(job);
      }
    } catch (err) {
      console.error('TurnJobProcessor error:', err);
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: TurnJob) {
    try {
      // Job status is already set to 'processing' by claimPendingTurnJobs

      // PRECOMPUTE PHASE: Compute checks, generate LLM content, and check image cache OUTSIDE transaction
      const currentState = await storage.getGameState(job.gameId);
      if (!currentState) {
        throw new Error(`Game ${job.gameId} not found`);
      }
      
      const action = job.actionPayload as ActionInput;
      const userPreferences = await storage.getUserPreferences(currentState.username);
      
      // Skip precomputation for intro turns (handled by processIntroTurn)
      if (action.action === '__intro_turn__') {
        // APPLY PHASE: Intro turn processes itself (handles image processing internally)
        const updatedState: GameState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
          return await processTurnLogic(state, action);
        });
        
        await storage.updateTurnJob(job.id, { status: 'completed', completedAt: new Date() });
        this.io.to(job.gameId).emit('turnComplete', { gameId: job.gameId, turnNumber: updatedState.turnNumber });
        return;
      }
      
      console.log('[TURN_JOB] Precomputing turn content (outside transaction)', {
        gameId: job.gameId,
        action: action.action,
        turnNumber: currentState.turnNumber
      });
      
      // Step 1: Compute turn checks (deterministic, no LLM calls)
      const computed = await computeTurnChecks(currentState, action);
      
      // Step 2: Generate turn content (LLM call - OUTSIDE transaction)
      const turnContent = await generateTurnContentWithFlag(
        currentState,
        computed.selectedAction.action,
        computed.checks,
        userPreferences,
        {},
        computed.event ? { name: computed.event.name, segment: computed.event.segment, skill: computed.event.skill } : null
      );
      
      // Step 3: Generate next actions (LLM call - OUTSIDE transaction)
      // Load equipped items for state computation
      const equippedItems = await Promise.all(
        currentState.equippedItems.map(async (id: string) => getItemById(id))
      );
      const validEquippedItems = equippedItems.filter((item: Awaited<ReturnType<typeof getItemById>>): item is NonNullable<Awaited<ReturnType<typeof getItemById>>> => item !== undefined);
      
      // Compute what the state will be after the turn (for accurate action generation)
      // This includes stat changes, day progression, event history updates, etc.
      const postTurnState = computePostTurnState(currentState, {
        selectedAction: computed.selectedAction,
        event: computed.event,
        success: computed.success,
        nextTurnNumber: computed.nextTurnNumber
      }, validEquippedItems);
      
      // Add the turn we're about to create to the state (for narrative context in action generation)
      // generateActions uses lastTurn.narrative, so we need to include it
      postTurnState.turns = [
        ...currentState.turns,
        {
          turnNumber: computed.nextTurnNumber,
          action: computed.selectedAction.action,
          narrative: turnContent.narration, // Use the narrative we just generated
          checks: computed.checks,
          delta: [], // Will be filled in processTurnLogic
          timestamp: Date.now()
        } as any
      ];
      
      // Use actions from PCE pipeline (already generated, no additional LLM calls)
      // The PCE pipeline always generates actions, so they should always be present
      if (!turnContent.actions || !Array.isArray(turnContent.actions) || turnContent.actions.length === 0) {
        throw new Error(`PCE pipeline failed to generate actions for turn ${computed.nextTurnNumber}. Actions missing from turnContent.`);
      }
      
      const nextActions = turnContent.actions;
      console.log('[TURN_JOB] Using actions from PCE pipeline', {
        actionsCount: nextActions.length
      });
      
      // Step 4: Prepare image metadata (cache check - OUTSIDE transaction)
      const tempTurn: any = {
        turnNumber: computed.nextTurnNumber,
        imagePrompt: turnContent.imagePrompt || undefined
      };
      const precomputedImageMetadata = await prepareTurnImageMetadata(
        currentState,
        tempTurn,
        userPreferences,
        computed.nextTurnNumber
      );
      
      console.log('[TURN_JOB] Precomputation complete', {
        gameId: job.gameId,
        hasTurnContent: !!turnContent.narration,
        hasActions: nextActions.length > 0,
        hasImageMetadata: precomputedImageMetadata !== null
      });

      // APPLY PHASE: Process turn and apply precomputed content atomically INSIDE transaction
      const updatedState: GameState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
        // Use precomputed content (no LLM calls inside transaction)
        const newState = await processTurnLogic(state, action, {
          turnContent,
          actions: nextActions,
          checks: computed.checks,
          selectedAction: computed.selectedAction,
          event: computed.event,
          skill: computed.skill,
          success: computed.success
        });
        
        // Apply precomputed image metadata (fast, no I/O - just setting turn properties)
        const finalTurn = newState.turns[newState.turns.length - 1];
        if (finalTurn) {
          await processTurnImage(newState, finalTurn, userPreferences, newState.turnNumber, precomputedImageMetadata);
        }
        
        return newState;
      });

      await storage.updateTurnJob(job.id, { status: 'completed', completedAt: new Date() });

      // Notify clients turn complete
      this.io.to(job.gameId).emit('turnComplete', { gameId: job.gameId, turnNumber: updatedState.turnNumber });
    } catch (error) {
      console.error('Failed to process turn job:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        gameId: job.gameId,
        error: error
      });
      await storage.updateTurnJob(job.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
}

