import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestStorage, cleanupTestTables, closeTestPool } from './setup/db';
import { createTestUser } from './setup/helpers';

const storage = getTestStorage();

describe('game state concurrency safeguards', () => {
  beforeEach(async () => {
    await cleanupTestTables();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('preserves a concurrent mutation and interview update within one game row', async () => {
    const username = `concurrent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await createTestUser(username);

    const gameId = 'game-concurrency-check';
    await storage.createGameState({
      id: gameId,
      username,
      seed: 'seed-1',
      day: 1,
      turnNumber: 1,
      segment: 'Launch from Earth',
      absurdity: 2,
      stats: {},
      npcs: [],
      equippedItems: [],
      turns: [],
      currentActions: [],
      runningGags: [],
      eventHistory: [],
      interviewResponses: {},
      isComplete: false,
      failureReason: undefined,
    });

    await Promise.all([
      storage.processTurnWithTransaction(gameId, async state => {
        state.absurdity = 1;
        return state;
      }),
      storage.processTurnWithTransaction(gameId, async state => {
        state.interviewResponses = { mood: 'curious', favoriteStar: 'Uranus' };
        return state;
      }),
    ]);

    const updated = await storage.getGameState(gameId);
    expect(updated).toBeDefined();
    expect(updated!.absurdity).toBe(1);
    expect(updated!.interviewResponses).toEqual({ mood: 'curious', favoriteStar: 'Uranus' });
  });
});
