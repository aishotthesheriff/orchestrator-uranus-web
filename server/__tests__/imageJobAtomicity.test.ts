import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { applyPrecomputedIntroTurn, processTurnImage } from '../gameLogic';
import { pool } from '../db';
import { getTestStorage } from './setup/db';
import { cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState, createTestPrecomputedIntroTurn, createTestUser } from './setup/helpers';

// Mock the AI service functions
vi.mock('../aiService', async () => {
  const actual = await vi.importActual('../aiService');
  return {
    ...actual,
    checkImageCache: vi.fn(),
  };
});

// Mock image URL conversion
vi.mock('../imageUrl', () => ({
  convertImageUrlToStaticPath: vi.fn((input: any) => Promise.resolve(input.imageUrl)),
}));

import { checkImageCache } from '../aiService';

describe('Image Job Atomicity', () => {
  const storage = getTestStorage();
  
  beforeEach(async () => {
    await cleanupTestTables();
    await createTestUser('testuser');
    vi.clearAllMocks();
  });
  
  afterAll(async () => {
    await closeTestPool();
  });

  it('should create image job atomically with turn in applyPrecomputedIntroTurn', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const gameId = gameState.id;
    
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = { skipImageCache: false };
    
    // Mock no cache hit, so image job should be created
    vi.mocked(checkImageCache).mockResolvedValue(null);
    
    // Apply precomputed intro turn (inside transaction)
    await applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    
    // Get the final game state
    const finalState = await storage.getGameState(gameId);
    expect(finalState).toBeDefined();
    
    // Verify turn was created
    const introTurn = finalState!.turns.find(t => t.turnNumber === 0);
    expect(introTurn).toBeDefined();
    
    // Verify image job was created and attached atomically
    expect(introTurn!.imageJobId).toBeDefined();
    expect(introTurn!.imageStatus).toBe('pending');
    
    // Verify image job exists in database
    if (introTurn!.imageJobId) {
      const imageJob = await storage.getImageJob(introTurn!.imageJobId);
      expect(imageJob).toBeDefined();
      expect(imageJob!.gameId).toBe(gameId);
      expect(imageJob!.turnNumber).toBe(0);
      expect(imageJob!.status).toBe('pending');
    }
  });

  it('should handle cached image atomically with turn', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const gameId = gameState.id;
    
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = { skipImageCache: false };
    
    // Mock cache hit
    vi.mocked(checkImageCache).mockResolvedValue({
      imageUrl: 'data:image/png;base64,test',
      promptSource: 'cache',
      templateName: 'test-template',
    });
    
    // Apply precomputed intro turn
    await applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    
    // Get the final game state
    const finalState = await storage.getGameState(gameId);
    const introTurn = finalState!.turns.find(t => t.turnNumber === 0);
    
    // Verify image was set atomically with turn
    expect(introTurn!.imageUrl).toBeDefined();
    expect(introTurn!.imageStatus).toBe('completed');
    expect(introTurn!.imageTemplate).toBeDefined();
    
    // No image job should be created for cached images
    expect(introTurn!.imageJobId).toBeUndefined();
  });

  it('should ensure image job and turn are created in same transaction', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const gameId = gameState.id;
    
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};
    
    // Mock no cache hit
    vi.mocked(checkImageCache).mockResolvedValue(null);
    
    // Spawn concurrent calls to test transaction isolation
    const concurrentCalls = 5;
    const promises = Array.from({ length: concurrentCalls }, () =>
      applyPrecomputedIntroTurn(gameId, precomputed, userPreferences)
    );
    
    await Promise.all(promises);
    
    // Get final state
    const finalState = await storage.getGameState(gameId);
    
    // Should have exactly one intro turn (CAS check prevents duplicates)
    const introTurns = finalState!.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);
    
    const introTurn = introTurns[0];
    
    // Verify image job was created atomically
    // Either imageJobId exists (job created) or imageUrl exists (cached)
    // Since we mocked no cache, imageJobId should exist
    expect(introTurn.imageJobId).toBeDefined();
    expect(introTurn.imageStatus).toBe('pending');
    
    // Verify image job exists and is linked correctly
    if (introTurn.imageJobId) {
      const imageJob = await storage.getImageJob(introTurn.imageJobId);
      expect(imageJob).toBeDefined();
      expect(imageJob!.gameId).toBe(gameId);
      expect(imageJob!.turnNumber).toBe(0);
    }
  });

  it('should not create orphaned image jobs', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const gameId = gameState.id;
    
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};
    
    // Mock no cache hit
    vi.mocked(checkImageCache).mockResolvedValue(null);
    
    // Apply precomputed intro turn
    await applyPrecomputedIntroTurn(gameId, precomputed, userPreferences);
    
    // Get all image jobs for this game
    const gameImageJobs = (await pool.query(
      'SELECT id, turn_number FROM image_jobs WHERE game_id = $1 AND status = $2',
      [gameId, 'pending'],
    )).rows;
    
    // Get the turn
    const finalState = await storage.getGameState(gameId);
    const introTurn = finalState!.turns.find(t => t.turnNumber === 0);
    
    // Verify image job exists and is referenced by turn
    if (introTurn!.imageJobId) {
      const imageJobIds = gameImageJobs.map(job => job.id);
      expect(imageJobIds).toContain(introTurn!.imageJobId);
      
      // Verify only one image job for this turn
      const jobsForTurn = gameImageJobs.filter(job => job.turn_number === 0);
      expect(jobsForTurn.length).toBe(1);
      expect(jobsForTurn[0].id).toBe(introTurn!.imageJobId);
    }
  });

  it('rolls back image job creation with the enclosing game transaction', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const turn = { imagePrompt: 'transactional image prompt' };

    await expect(storage.processTurnWithTransaction(gameState.id, async (state, client) => {
      state.day = 2;
      await processTurnImage(state, turn, {}, 1, null, client);
      throw new Error('simulated transaction failure');
    })).rejects.toThrow('simulated transaction failure');

    expect((await storage.getGameState(gameState.id))?.day).toBe(1);
    expect((await pool.query(
      'SELECT id FROM image_jobs WHERE game_id = $1 AND turn_number = 1',
      [gameState.id],
    )).rows).toHaveLength(0);
  });

  it('should handle image processing errors gracefully', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const gameId = gameState.id;
    
    const precomputed = createTestPrecomputedIntroTurn();
    const userPreferences = {};
    
    // Mock image cache check to throw error
    vi.mocked(checkImageCache).mockRejectedValue(new Error('Image cache service unavailable'));
    
    // Should not throw - image processing errors should be handled gracefully
    await expect(
      applyPrecomputedIntroTurn(gameId, precomputed, userPreferences)
    ).resolves.toBeDefined();
    
    // Get final state
    const finalState = await storage.getGameState(gameId);
    const introTurn = finalState!.turns.find(t => t.turnNumber === 0);
    
    // Turn should still be created, even if image processing failed
    expect(introTurn).toBeDefined();
    expect(introTurn!.narrative).toBeTruthy();
    
    // Image metadata may or may not be set depending on error handling
    // But the turn should exist
  });
});
