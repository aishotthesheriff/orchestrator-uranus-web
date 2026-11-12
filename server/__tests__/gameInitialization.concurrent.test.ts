import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { initializeNewGame } from '../gameInitialization';
import { getTestStorage } from './setup/db';
import { cleanupTestTables, closeTestPool } from './setup/db';
import { createTestUser } from './setup/helpers';
import type { InsertGameState } from '@shared/schema';

// Mock the AI service functions to avoid slow LLM calls
vi.mock('../aiService', async () => {
  const actual = await vi.importActual('../aiService');
  return {
    ...actual,
    generateTurnContentWithFlag: vi.fn(),
    generateActions: vi.fn(),
    checkImageCache: vi.fn(),
  };
});

// Mock image URL conversion
vi.mock('../imageUrl', () => ({
  convertImageUrlToStaticPath: vi.fn((input: any) => Promise.resolve(input.imageUrl)),
}));

// Mock Socket.IO
vi.mock('../socketManager', () => ({
  getSocketIO: vi.fn(() => ({
    to: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  })),
}));

import { generateTurnContentWithFlag, generateActions, checkImageCache } from '../aiService';
import { createTestPrecomputedIntroTurn } from './setup/helpers';

describe('initializeNewGame - Concurrent Initialization', () => {
  const storage = getTestStorage();

  beforeAll(async () => {
    await cleanupTestTables();
  });

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup default mocks
    const precomputed = createTestPrecomputedIntroTurn();
    vi.mocked(generateTurnContentWithFlag).mockResolvedValue(precomputed.turnContent);
    vi.mocked(generateActions).mockResolvedValue(precomputed.actions);
    vi.mocked(checkImageCache).mockResolvedValue(null); // No cache hit
  });
  
  afterAll(async () => {
    await closeTestPool();
  });

  it('should prevent duplicate intro turns under concurrent initialization', async () => {
    const username = `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await createTestUser(username);

    const validated: InsertGameState = {
      username,
      absurdity: 2,
    };

    // Spawn 10 concurrent calls to initializeNewGame
    const concurrentCalls = 10;
    const promises = Array.from({ length: concurrentCalls }, () =>
      initializeNewGame(validated)
    );

    // Execute all concurrently
    const results = await Promise.all(promises);

    // All calls should succeed (no errors)
    expect(results.length).toBe(concurrentCalls);
    
    // All should return the same game ID (since username is the same, might create same game or different)
    // Actually, each call creates a new game, so we should get different game IDs
    // But each game should have exactly one intro turn
    
    // Check that each game has exactly one intro turn
    for (const result of results) {
      const gameState = await storage.getGameState(result.id);
      expect(gameState).toBeDefined();
      
      const introTurns = gameState!.turns.filter(t => t.turnNumber === 0);
      expect(introTurns.length).toBe(1);
      
      // Verify intro turn has content
      const introTurn = introTurns[0];
      expect(introTurn.narrative).toBeTruthy();
      expect(introTurn.narrative.length).toBeGreaterThan(0);
      
      // Verify actions are set
      expect(gameState!.currentActions.length).toBeGreaterThan(0);
    }
  });

  it('should handle concurrent calls for different users', async () => {
    const usernames = Array.from({ length: 5 }, (_, i) => `user${i + 1}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    
    // Create users
    for (const username of usernames) {
      await createTestUser(username);
    }

    // Spawn concurrent calls for different users
    const promises = usernames.map(username =>
      initializeNewGame({
        username,
        absurdity: 2,
      })
    );

    const results = await Promise.all(promises);

    // Each user should get their own game
    expect(results.length).toBe(usernames.length);
    
    // Each game should have exactly one intro turn
    for (const result of results) {
      const gameState = await storage.getGameState(result.id);
      expect(gameState).toBeDefined();
      
      const introTurns = gameState!.turns.filter(t => t.turnNumber === 0);
      expect(introTurns.length).toBe(1);
    }
  });

  it('should handle race condition where multiple calls happen simultaneously', async () => {
    const username = `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await createTestUser(username);

    const validated: InsertGameState = {
      username,
      absurdity: 2,
    };

    // Simulate race condition: start multiple calls at nearly the same time
    const promise1 = initializeNewGame(validated);
    const promise2 = initializeNewGame(validated);
    const promise3 = initializeNewGame(validated);

    // Wait for all to complete
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // Each should create a separate game (different game IDs)
    const gameIds = [result1.id, result2.id, result3.id];
    const uniqueGameIds = new Set(gameIds);
    expect(uniqueGameIds.size).toBe(3); // All should be different

    // Each game should have exactly one intro turn
    for (const gameId of gameIds) {
      const gameState = await storage.getGameState(gameId);
      const introTurns = gameState!.turns.filter(t => t.turnNumber === 0);
      expect(introTurns.length).toBe(1);
    }
  });

  it('should maintain transaction integrity under high concurrency', async () => {
    const username = `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await createTestUser(username);

    const validated: InsertGameState = {
      username,
      absurdity: 2,
    };

    // Create many concurrent transactions
    const concurrentTransactions = 20;
    const promises = Array.from({ length: concurrentTransactions }, () =>
      initializeNewGame(validated)
    );

    await Promise.all(promises);

    // Verify all games were created and each has exactly one intro turn
    // We'll sample a few to verify correctness
    const sampleSize = Math.min(5, concurrentTransactions);
    for (let i = 0; i < sampleSize; i++) {
      // We can't directly access results, but we can query for games
      // For this test, we verify the pattern works correctly
    }
    
    // Get all games for the user
    const allGames = await storage.getGamesByUsername(username);
    expect(allGames.length).toBe(concurrentTransactions);
    
    // Verify each game has exactly one intro turn
    for (const game of allGames) {
      const introTurns = game.turns.filter(t => t.turnNumber === 0);
      expect(introTurns.length).toBe(1);
    }
  });
});
