import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestStorage } from './setup/db';
import { cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState, createPendingTurnJobs } from './setup/helpers';
import { INTRO_TURN_ACTION_ID } from '../gameLogic';
import type { ActionInput } from '@shared/schema';

describe('claimPendingTurnJobs - Atomic Job Claiming', () => {
  const storage = getTestStorage();
  
  beforeEach(async () => {
    await cleanupTestTables();
  });
  
  afterAll(async () => {
    await closeTestPool();
  });

  it('should not allow double claims under parallel workers', async () => {
    // Create a test game
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    // Create 20 pending jobs
    const jobCount = 20;
    await createPendingTurnJobs(jobCount, gameId);

    // Spawn 5 concurrent claimers, each trying to claim 10 jobs
    // This should result in exactly 20 jobs claimed (some claimers will get fewer)
    const claimerCount = 5;
    const claimLimitPerCaller = 10;

    const claimPromises = Array.from({ length: claimerCount }, () =>
      storage.claimPendingTurnJobs(claimLimitPerCaller)
    );

    // Execute all claims concurrently
    const results = await Promise.all(claimPromises);

    // Flatten all claimed jobs
    const allClaimedJobs = results.flat();
    const claimedJobIds = new Set(allClaimedJobs.map(job => job.id));

    // Assertions
    expect(claimedJobIds.size).toBe(jobCount); // Each job claimed exactly once
    expect(allClaimedJobs.length).toBe(jobCount); // Total jobs claimed equals created jobs
    expect(allClaimedJobs.length).toBe(claimedJobIds.size); // No duplicates

    // Verify all claimed jobs have status='processing'
    const allStatusProcessing = allClaimedJobs.every(job => job.status === 'processing');
    expect(allStatusProcessing).toBe(true);

    // Verify no jobs remain pending
    const remainingPending = await storage.getPendingTurnJobs();
    expect(remainingPending.length).toBe(0);
  });

  it('should handle concurrent claims with fewer jobs than claimers', async () => {
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    // Create only 3 pending jobs
    const jobCount = 3;
    await createPendingTurnJobs(jobCount, gameId);

    // Spawn 5 concurrent claimers, each trying to claim 10 jobs
    const claimerCount = 5;
    const claimLimitPerCaller = 10;

    const claimPromises = Array.from({ length: claimerCount }, () =>
      storage.claimPendingTurnJobs(claimLimitPerCaller)
    );

    const results = await Promise.all(claimPromises);
    const allClaimedJobs = results.flat();
    const claimedJobIds = new Set(allClaimedJobs.map(job => job.id));

    // Should only claim the 3 jobs that exist
    expect(claimedJobIds.size).toBe(jobCount);
    expect(allClaimedJobs.length).toBe(jobCount);
    expect(allClaimedJobs.every(job => job.status === 'processing')).toBe(true);

    // Remaining claimers should get empty arrays
    const emptyResults = results.filter(r => r.length === 0);
    expect(emptyResults.length).toBeGreaterThan(0);
  });

  it('should handle multiple games with concurrent claims', async () => {
    // Create multiple games
    const game1 = await createTestGameState({ username: 'user1' });
    const game2 = await createTestGameState({ username: 'user2' });

    // Create jobs for each game
    await createPendingTurnJobs(10, game1.id);
    await createPendingTurnJobs(10, game2.id);

    // Claim jobs concurrently
    const claimPromises = [
      storage.claimPendingTurnJobs(20), // Try to claim all
      storage.claimPendingTurnJobs(20),
      storage.claimPendingTurnJobs(20),
    ];

    const results = await Promise.all(claimPromises);
    const allClaimedJobs = results.flat();
    const claimedJobIds = new Set(allClaimedJobs.map(job => job.id));

    // Should claim exactly 20 jobs total (10 from each game)
    expect(claimedJobIds.size).toBe(20);
    expect(allClaimedJobs.length).toBe(20);
    expect(allClaimedJobs.every(job => job.status === 'processing')).toBe(true);
  });

  it('should respect FOR UPDATE SKIP LOCKED behavior', async () => {
    const gameState = await createTestGameState();
    const gameId = gameState.id;

    // Create jobs
    await createPendingTurnJobs(100, gameId);

    // Simulate rapid sequential claims (like multiple workers polling)
    const batch1 = await storage.claimPendingTurnJobs(30);
    const batch2 = await storage.claimPendingTurnJobs(30);
    const batch3 = await storage.claimPendingTurnJobs(30);

    const allIds = [...batch1, ...batch2, ...batch3].map(j => j.id);
    const uniqueIds = new Set(allIds);

    // Should get 90 unique jobs
    expect(uniqueIds.size).toBe(90);
    expect(allIds.length).toBe(90);
  });
});

