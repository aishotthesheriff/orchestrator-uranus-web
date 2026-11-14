import type { GameState, InsertGameState, InsertTurnJob, ActionInput } from '@shared/schema';
import { randomUUID } from 'crypto';
import { getTestStorage } from './db';
import { getJobService } from '../../orchestrator/jobService';
import { INTRO_TURN_ACTION_ID } from '../../gameLogic';

/**
 * Create a minimal test game state
 */
export async function createTestGameState(
  overrides: Partial<InsertGameState> = {}
): Promise<GameState> {
  const storage = getTestStorage();
  const gameState: GameState = {
    id: randomUUID(),
    username: overrides.username || 'testuser',
    seed: overrides.seed || randomUUID(),
    day: 1,
    turnNumber: 0,
    segment: 'Launch from Earth',
    absurdity: overrides.absurdity ?? 2,
    stats: {
      hull: 100,
      oxygen: 100,
      fuel: 100,
      food: 100,
      morale: 100,
      weirdness: 0,
    },
    npcs: [],
    equippedItems: [],
    turns: [],
    currentActions: [],
    runningGags: [],
    eventHistory: [],
    interviewResponses: {},
    isComplete: false,
  };
  await storage.ensureUser(gameState.username);
  
  return await storage.createGameState(gameState);
}

/**
 * Create a test user
 */
export async function createTestUser(username: string = 'testuser'): Promise<void> {
  const storage = getTestStorage();
  await storage.ensureUser(username);
}

/**
 * Create pending turn jobs for testing
 */
export async function createPendingTurnJobs(
  count: number,
  gameId: string,
  actionPayload?: ActionInput
): Promise<string[]> {
  const storage = getTestStorage();
  const jobIds: string[] = [];
  
  const defaultAction: ActionInput = {
    gameId,
    action: INTRO_TURN_ACTION_ID,
  };
  
  for (let i = 0; i < count; i++) {
    const payload: ActionInput = {
      ...(actionPayload || defaultAction),
      customText: `${(actionPayload || defaultAction).customText || 'auto-turn'}-${i}-${Date.now()}`,
    };

    const job = await getJobService().createTurnJob({
      gameId,
      actionPayload: payload,
      status: 'pending',
    });
    jobIds.push(job.id);
  }
  
  return jobIds;
}

/**
 * Create a minimal precomputed intro turn content
 */
export function createTestPrecomputedIntroTurn() {
  const actions = [
    {
      action: 'test-action-1',
      summary: 'Test action',
      risk: 'Safe' as const,
      intent: 'explore' as const,
    },
  ];
  return {
    turnContent: {
      // The story pipeline returns the actions as part of the turn content
      actions,
      narration: 'Test narration for intro turn',
      imagePrompt: 'Test image prompt',
      style: 'Test style',
      theme: 'Test theme',
      rawResponse: 'Test raw response',
      toneHints: ['test'],
      promptChain: [],
      masterEnrichment: null,
      imageModelKey: 'test-model',
      imageMetadata: null,
      imagePromptSource: 'template',
      fallbackUsed: false,
    },
    actions,
  };
}
