import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ImageJobProcessor } from '../imageJobProcessor';
import { getTestStorage } from './setup/db';
import { cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState, createTestUser } from './setup/helpers';
import type { ImageJob } from '@shared/schema';
import type { Server as SocketIOServer } from 'socket.io';

// Mock the AI service functions
vi.mock('../aiService', async () => {
  const actual = await vi.importActual('../aiService');
  return {
    ...actual,
    checkImageCache: vi.fn(),
    generateImage: vi.fn(),
  };
});

// Mock metrics to avoid import issues
vi.mock('../metrics', () => ({
  dbOperationDuration: {
    startTimer: () => () => {},
  },
  imageJobDuration: {
    startTimer: () => () => {},
  },
  imageJobsCompleted: {
    inc: vi.fn(),
  },
  imageJobsFailed: {
    inc: vi.fn(),
  },
  queueDepthImage: {
    set: vi.fn(),
  },
  imageCacheHits: {
    inc: vi.fn(),
  },
  imageCacheMisses: {
    inc: vi.fn(),
  },
}));

// Mock image URL conversion
vi.mock('../imageUrl', () => ({
  convertImageUrlToStaticPath: vi.fn((input: any) => Promise.resolve(input.imageUrl)),
}));

import { checkImageCache, generateImage } from '../aiService';

describe('ImageJobProcessor - Failure Handling', () => {
  const storage = getTestStorage();
  let mockIo: Partial<SocketIOServer>;
  let processor: ImageJobProcessor;
  
  beforeEach(async () => {
    await cleanupTestTables();
    
    // Create test user
    await createTestUser('testuser');
    
    // Mock Socket.IO server
    mockIo = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
      // The processor logs how many sockets are in the game's room
      sockets: { adapter: { rooms: new Map() } } as any,
    };
    
    processor = new ImageJobProcessor(mockIo as SocketIOServer);
    
    // Reset mocks
    vi.clearAllMocks();
  });
  
  afterAll(async () => {
    await closeTestPool();
  });

  it('should set turn imageStatus to "failed" when image job fails', async () => {
    // Create game state with a turn that has an image job
    const gameState = await createTestGameState({ username: 'testuser' });
    
    // Add a turn with imageJobId
    const turnNumber = 0;
    const updatedState = await storage.processTurnWithTransaction(gameState.id, async (state) => {
      state.turns.push({
        turnNumber,
        narrative: 'Test turn',
        checks: [],
        delta: [],
        timestamp: Date.now(),
        imageJobId: 'test-job-id',
        imageStatus: 'pending',
      });
      return state;
    });

    // Create an image job
    const imageJob = await storage.createImageJob({
      gameId: gameState.id,
      turnNumber,
      templateName: 'test-template',
      status: 'pending',
    });

    // Update the turn to reference the actual image job ID
    await storage.processTurnWithTransaction(gameState.id, async (state) => {
      const turn = state.turns.find(t => t.turnNumber === turnNumber);
      if (turn) {
        (turn as any).imageJobId = imageJob.id;
        (turn as any).imageStatus = 'pending';
      }
      return state;
    });

    // Mock image generation to fail
    vi.mocked(checkImageCache).mockResolvedValue(null);
    vi.mocked(generateImage).mockRejectedValue(new Error('Image generation service unavailable'));

    // Claim the job (set status to processing)
    const claimedJobs = await storage.claimPendingImageJobs(1);
    expect(claimedJobs.length).toBe(1);

    // Process the job (will fail)
    await (processor as any).processJob(claimedJobs[0]);

    // Verify image job was updated to failed
    const updatedJob = await storage.getImageJob(imageJob.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.error).toContain('Image generation service unavailable');

    // Verify turn imageStatus was set to 'failed'
    const finalState = await storage.getGameState(gameState.id);
    const turn = finalState?.turns.find(t => t.turnNumber === turnNumber);
    expect(turn).toBeDefined();
    expect((turn as any)?.imageStatus).toBe('failed');

    // Verify Socket.IO emit was called
    expect(mockIo.to).toHaveBeenCalledWith(gameState.id);
    const emitMock = (mockIo.to as any)(gameState.id).emit;
    expect(emitMock).toHaveBeenCalledWith('imageFailed', expect.objectContaining({
      jobId: imageJob.id,
      gameId: gameState.id,
      turnNumber,
    }));
  });

  it('should handle failure when game state is missing', async () => {
    const gameId = 'non-existent-game';
    
    // Create an image job with non-existent game
    const imageJob = await storage.createImageJob({
      gameId,
      turnNumber: 0,
      templateName: 'test-template',
      status: 'pending',
    });

    // Claim the job
    const claimedJobs = await storage.claimPendingImageJobs(1);
    expect(claimedJobs.length).toBe(1);
    expect(claimedJobs[0].id).toBe(imageJob.id);

    // Process the job (will fail due to missing game)
    await (processor as any).processJob(claimedJobs[0]);

    // Verify job was marked as failed
    const updatedJob = await storage.getImageJob(imageJob.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.error).toContain('not found');
  });

  it('should still mark job as failed even if turn update fails', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    const turnNumber = 0;

    // Create image job
    const imageJob = await storage.createImageJob({
      gameId: gameState.id,
      turnNumber: turnNumber + 1, // Use non-existent turn number
      templateName: 'test-template',
      status: 'pending',
    });

    // Mock image generation to fail
    vi.mocked(checkImageCache).mockResolvedValue(null);
    vi.mocked(generateImage).mockRejectedValue(new Error('Test error'));

    // Claim and process job
    const claimedJobs = await storage.claimPendingImageJobs(1);
    await (processor as any).processJob(claimedJobs[0]);

    // Job should still be marked as failed even though turn doesn't exist
    const updatedJob = await storage.getImageJob(imageJob.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.error).toBe('Test error');
  });

  it('should update imageStatus on the correct turn when multiple turns exist', async () => {
    const gameState = await createTestGameState({ username: 'testuser' });
    
    // Add multiple turns
    await storage.processTurnWithTransaction(gameState.id, async (state) => {
      state.turns.push({
        turnNumber: 0,
        narrative: 'Turn 0',
        checks: [],
        delta: [],
        timestamp: Date.now(),
        imageJobId: 'job-0',
        imageStatus: 'pending',
      });
      state.turns.push({
        turnNumber: 1,
        narrative: 'Turn 1',
        checks: [],
        delta: [],
        timestamp: Date.now(),
        imageJobId: 'job-1',
        imageStatus: 'pending',
      });
      return state;
    });

    // Create image job for turn 1
    const imageJob = await storage.createImageJob({
      gameId: gameState.id,
      turnNumber: 1,
      templateName: 'test-template',
      status: 'pending',
    });

    // Update turn 1 to reference the job
    await storage.processTurnWithTransaction(gameState.id, async (state) => {
      const turn = state.turns.find(t => t.turnNumber === 1);
      if (turn) {
        (turn as any).imageJobId = imageJob.id;
        (turn as any).imageStatus = 'pending';
      }
      return state;
    });

    // Mock failure
    vi.mocked(checkImageCache).mockResolvedValue(null);
    vi.mocked(generateImage).mockRejectedValue(new Error('Test failure'));

    // Process job
    const claimedJobs = await storage.claimPendingImageJobs(1);
    await (processor as any).processJob(claimedJobs[0]);

    // Verify only turn 1's imageStatus was updated
    const finalState = await storage.getGameState(gameState.id);
    const turn0 = finalState?.turns.find(t => t.turnNumber === 0);
    const turn1 = finalState?.turns.find(t => t.turnNumber === 1);
    
    expect((turn0 as any)?.imageStatus).toBe('pending'); // Unchanged
    expect((turn1 as any)?.imageStatus).toBe('failed'); // Updated
  });
});

