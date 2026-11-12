import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { applyPrecomputedIntroTurn } from '../gameLogic';
import { getTestStorage } from './setup/db';
import { cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState, createTestPrecomputedIntroTurn } from './setup/helpers';

describe('applyPrecomputedIntroTurn - Concurrent Duplicate Prevention', () => {
  const storage = getTestStorage();
  
  beforeEach(async () => {
    await cleanupTestTables();
  });
  
  afterAll(async () => {
    await closeTestPool();
  });

  it('should prevent duplicate intro turns under concurrent starts', async () => {
    // Create initial game state (no intro turn yet)
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    // Create precomputed content
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};

    // Spawn 10 concurrent calls to applyPrecomputedIntroTurn
    const concurrentCalls = 10;
    const promises = Array.from({ length: concurrentCalls }, () =>
      applyPrecomputedIntroTurn(gameId, precomputed, userPreferences)
    );

    // Execute all concurrently
    const results = await Promise.all(promises);

    // All calls should succeed (no errors)
    expect(results.length).toBe(concurrentCalls);

    // Get the final game state
    const finalState = await storage.getGameState(gameId);
    expect(finalState).toBeDefined();

    // Critical assertion: only one intro turn (turnNumber=0) should exist
    const introTurns = finalState!.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);

    // Verify the intro turn has expected content
    const introTurn = introTurns[0];
    expect(introTurn.narrative).toBe(precomputed.turnContent.narration);
    expect(introTurn.imagePrompt).toBe(precomputed.turnContent.imagePrompt);
  });

  it('should handle concurrent calls when intro turn already exists', async () => {
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};

    // First call - creates intro turn
    await applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);

    // Verify intro turn exists
    let state = await storage.getGameState(gameId);
    expect(state!.turns.filter(t => t.turnNumber === 0).length).toBe(1);

    // Now spawn 5 concurrent calls - all should skip due to CAS check
    const concurrentCalls = 5;
    const promises = Array.from({ length: concurrentCalls }, () =>
      applyPrecomputedIntroTurn(gameId, precomputed, userPreferences)
    );

    await Promise.all(promises);

    // Verify still only one intro turn
    state = await storage.getGameState(gameId);
    const introTurns = state!.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);
  });

  it('should handle mixed success: some concurrent, one succeeds', async () => {
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};

    // Simulate race condition: multiple calls starting at nearly the same time
    // First, start all calls without awaiting
    const promise1 = applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    const promise2 = applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    const promise3 = applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);

    // Wait for all to complete
    await Promise.all([promise1, promise2, promise3]);

    // Verify only one intro turn
    const finalState = await storage.getGameState(gameId);
    const introTurns = finalState!.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);
  });

  it('should maintain CAS check integrity under transaction isolation', async () => {
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};

    // Create many concurrent transactions
    const concurrentTransactions = 20;
    const promises = Array.from({ length: concurrentTransactions }, async () => {
      // Each transaction should see the locked state and check for existing turn
      return await applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    });

    await Promise.all(promises);

    // Verify exactly one intro turn despite 20 concurrent transactions
    const finalState = await storage.getGameState(gameId);
    const introTurns = finalState!.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);

    // Verify currentActions were set
    expect(finalState!.currentActions.length).toBeGreaterThan(0);
  });
});

