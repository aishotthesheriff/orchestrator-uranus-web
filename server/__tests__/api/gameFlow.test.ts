import { describe, it, expect, beforeEach, afterAll, vi, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { registerRoutes } from '../../routes';
import { pool } from '../../db';
import { getTestStorage, cleanupTestTables, closeTestPool } from '../setup/db';
import { createTestUser, createTestPrecomputedIntroTurn } from '../setup/helpers';
import { storage } from '../../storage';
import type { GameState, ActionInput } from '@shared/schema';
import { INTRO_TURN_ACTION_ID } from '../../gameLogic';
import type { AddressInfo } from 'net';
import { jwtMiddleware } from '../../middleware/jwt';

// Mock AI service functions to avoid slow LLM calls
vi.mock('../../aiService', async () => {
  const actual = await vi.importActual('../../aiService');
  return {
    ...actual,
    generateTurnContentWithFlag: vi.fn(),
    generateActions: vi.fn(),
    checkImageCache: vi.fn(),
  };
});

// Mock image URL conversion
vi.mock('../../imageUrl', () => ({
  convertImageUrlToStaticPath: vi.fn((input: any) => Promise.resolve(input?.imageUrl || '')),
}));

// Mock Socket.IO
vi.mock('../../socketManager', () => ({
  getSocketIO: vi.fn(() => ({
    to: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  })),
  setSocketIO: vi.fn(),
}));

import { generateTurnContentWithFlag, generateActions, checkImageCache } from '../../aiService';

describe('API Game Flow Integration Test', () => {
  let app: Express;
  let testServer: Server | null = null;
  let testPort: number;
  let testBaseUrl: string;
  let testUsername: string;
  let authCookie: string = '';
  let testUserId: string = '';

  const storage = getTestStorage();

  beforeAll(async () => {
    // Create a minimal Express app for testing
    app = express();
    
    // Environment setup - use test values if not set
    const originalSessionSecret = process.env.SESSION_SECRET;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    if (!process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = 'test-secret-key-for-api-tests';
    }
    const resolvedDatabaseUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
    if (!resolvedDatabaseUrl) {
      throw new Error("DATABASE_URL_TEST or DATABASE_URL must be set for API integration tests");
    }
    process.env.DATABASE_URL = resolvedDatabaseUrl;
    process.env.CSRF_ENABLED = 'false'; // Disable CSRF for testing
    process.env.RATE_LIMIT_ENABLED = 'false'; // Disable rate limiting for testing
    
    // Required middleware for routes
    app.use(cookieParser());
    app.use(jwtMiddleware);
    
    // JSON body parser
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    
    // Register all routes
    const server = await registerRoutes(app);
    testServer = server;
    
    // Start server on a random port
    await new Promise<void>((resolve) => {
      testServer!.listen(0, () => {
        const address = testServer!.address() as AddressInfo;
        testPort = address.port;
        testBaseUrl = `http://localhost:${testPort}`;
        resolve();
      });
    });
    
    // Restore original env vars
    if (originalSessionSecret) process.env.SESSION_SECRET = originalSessionSecret;
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  beforeEach(async () => {
    await cleanupTestTables();
    
    // Create a unique test user for each test
    testUsername = `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await createTestUser(testUsername);
    const userRecord = await storage.getUserByUsername(testUsername);
    if (!userRecord) {
      throw new Error('Failed to load test user');
    }
    testUserId = userRecord.id;
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Setup default mocks
    const precomputed = createTestPrecomputedIntroTurn();
    vi.mocked(generateTurnContentWithFlag).mockResolvedValue(precomputed.turnContent);
    vi.mocked(generateActions).mockResolvedValue(precomputed.actions);
    vi.mocked(checkImageCache).mockResolvedValue(null); // No cache hit
    
    // Clear auth cookie
    authCookie = '';
  });

  afterAll(async () => {
    await closeTestPool();
    if (testServer) {
      await new Promise<void>((resolve) => {
        testServer!.close(() => resolve());
      });
    }
  });

  /**
   * Helper to create a signed JWT cookie for authenticated requests
   */
  async function createAuthCookie(): Promise<string> {
    const response = await fetch(`${testBaseUrl}/api/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create auth cookie: ${response.status} ${response.statusText}`);
    }
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('Missing Set-Cookie header from /api/user');
    }
    const authCookieMatch = setCookie.match(/auth_token=[^;]+/);
    if (!authCookieMatch) {
      throw new Error('auth_token cookie not found in Set-Cookie');
    }
    return authCookieMatch[0];
  }

  /**
   * Helper to make authenticated API requests
   */
  async function apiRequest(
    method: string,
    path: string,
    body?: any
  ): Promise<Response> {
    const url = `${testBaseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (authCookie) {
      headers['Cookie'] = authCookie;
    }
    
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Helper to wait for a turn job to complete by polling game state
   */
  async function waitForTurnJob(
    gameId: string, 
    expectedTurnNumber: number,
    maxWaitMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 200; // Check every 200ms
    
    while (Date.now() - startTime < maxWaitMs) {
      const gameState = await storage.getGameState(gameId);
      if (gameState && gameState.turnNumber >= expectedTurnNumber) {
        // Turn has been processed
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Turn ${expectedTurnNumber} did not complete within ${maxWaitMs}ms`);
  }

  /**
   * Helper to process pending turn jobs (simulate background processor)
   */
  async function processPendingJobs(): Promise<void> {
    // Simulate background processing for the queued turn jobs.
    const pending = await pool.query(
      "SELECT id FROM turn_jobs WHERE status = 'pending' ORDER BY created_at LIMIT $1",
      [10],
    );

    for (const row of pending.rows) {
      const job = await storage.getTurnJob(row.id);
      if (!job) {
        throw new Error(`Turn job ${row.id} disappeared before test processing`);
      }

      try {
        // Import here to avoid circular dependency issues
        const { processTurnLogic, processTurnImage } = await import('../../gameLogic');
        
        // Execute turn and create image job atomically inside transaction
        const updatedState = await storage.processTurnWithTransaction(job.gameId, async (state, client) => {
          const action = job.actionPayload as ActionInput;
          const newState = await processTurnLogic(state, action, undefined, client);
          
          // Get user preferences for image processing
          const userPreferences = await storage.getUserPreferences(state.username);
          
          // Process image INSIDE transaction for atomicity
          const lastTurn = newState.turns[newState.turns.length - 1];
          if (lastTurn) {
            await processTurnImage(newState, lastTurn, userPreferences, newState.turnNumber, undefined, client);
          }
          
          return newState;
        });
        
        await storage.updateTurnJob(job.id, { status: 'completed', completedAt: new Date() });
      } catch (error) {
        console.error('Failed to process turn job:', error);
        await storage.updateTurnJob(job.id, { 
          status: 'failed', 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
  }

  it('should create a game, process turn 0 (intro), and process turn 1 via API', async () => {
    // Step 1: Create authenticated session cookie
    authCookie = await createAuthCookie();
    expect(authCookie).toBeTruthy();
    
    // Step 2: Create a new game via API
    const createGameResponse = await apiRequest('POST', '/api/game/start', {
      absurdity: 2
    });
    
    expect(createGameResponse.status).toBe(200);
    const gameState: GameState = await createGameResponse.json();
    expect(gameState).toBeDefined();
    expect(gameState.id).toBeTruthy();
    expect(gameState.username).toBe(testUsername);
    expect(gameState.turnNumber).toBe(0);
    expect(gameState.turns).toBeDefined();
    
    // Step 3: Verify turn 0 (intro turn) was created
    const introTurns = gameState.turns.filter(t => t.turnNumber === 0);
    expect(introTurns.length).toBe(1);
    
    const introTurn = introTurns[0];
    expect(introTurn.narrative).toBeTruthy();
    expect(introTurn.narrative.length).toBeGreaterThan(0);
    
    // Step 4: Verify actions were generated
    expect(gameState.currentActions).toBeDefined();
    expect(gameState.currentActions.length).toBeGreaterThan(0);
    
    // Step 5: Get game state via API to verify persistence
    const getGameResponse = await apiRequest('GET', `/api/game/${gameState.id}`);
    expect(getGameResponse.status).toBe(200);
    const retrievedGame: GameState = await getGameResponse.json();
    expect(retrievedGame.id).toBe(gameState.id);
    expect(retrievedGame.turnNumber).toBe(0);
    expect(retrievedGame.turns.length).toBe(1);
    
    // Step 6: Submit an action for turn 1
    // Pick the first action from the generated actions
    const firstAction = retrievedGame.currentActions[0];
    expect(firstAction).toBeDefined();
    expect(firstAction.action).toBeTruthy();
    
    // Mock turn 1 content generation
    const turn1Content = {
      narration: 'Turn 1 narrative: The journey continues through the asteroid belt.',
      imagePrompt: 'Turn 1 image prompt',
      style: 'sci-fi',
      theme: 'space adventure',
      rawResponse: '{}',
    };
    vi.mocked(generateTurnContentWithFlag).mockResolvedValueOnce(turn1Content);
    
    // Submit action
    const actionResponse = await apiRequest('POST', '/api/game/action', {
      gameId: gameState.id,
      action: firstAction.action,
    });
    expect(actionResponse.status).toBe(200);
    const actionResult = await actionResponse.json();
    expect(actionResult.turnJobId).toBeTruthy();
    expect(actionResult.status).toBe('processing');
    
    // Step 7: Process the pending turn job (simulate background processor)
    await processPendingJobs();
    
    // Step 8: Wait for job to complete and verify
    await waitForTurnJob(gameState.id, 1, 10000);
    
    // Step 9: Get updated game state and verify turn 1
    const updatedGameResponse = await apiRequest('GET', `/api/game/${gameState.id}`);
    expect(updatedGameResponse.status).toBe(200);
    const updatedGame: GameState = await updatedGameResponse.json();
    expect(updatedGame.turnNumber).toBe(1);
    expect(updatedGame.turns.length).toBe(2); // Turn 0 and turn 1
    
    // Verify turn 1
    const turn1Turns = updatedGame.turns.filter(t => t.turnNumber === 1);
    expect(turn1Turns.length).toBe(1);
    
    const turn1 = turn1Turns[0];
    expect(turn1.narrative).toBeTruthy();
    expect(turn1.narrative).toContain('Turn 1 narrative');
    
    // Verify new actions were generated for next turn
    expect(updatedGame.currentActions.length).toBeGreaterThan(0);
    
    // Verify stats may have changed (daily consumption applied)
    expect(updatedGame.stats).toBeDefined();
  });

  it('should handle custom action text via API', async () => {
    authCookie = await createAuthCookie();
    
    // Create game
    const createGameResponse = await apiRequest('POST', '/api/game/start', { absurdity: 2 });
    expect(createGameResponse.status).toBe(200);
    const gameState: GameState = await createGameResponse.json();
    
    // Note: mapCustomActionToIntent is already mocked in the top-level mock
    
    // Mock turn content
    const turn1Content = {
      narration: 'Custom action narrative',
      imagePrompt: 'Custom action image',
      style: 'sci-fi',
      theme: 'space adventure',
      rawResponse: '{}',
    };
    vi.mocked(generateTurnContentWithFlag).mockResolvedValueOnce(turn1Content);
    
    // Submit custom action
    const actionResponse = await apiRequest('POST', '/api/game/action', {
      gameId: gameState.id,
      action: 'custom-action-id',
      customText: 'Explore the mysterious space anomaly',
    });
    expect(actionResponse.status).toBe(200);
    const actionResult = await actionResponse.json();
    expect(actionResult.turnJobId).toBeTruthy();
    
    // Process and verify
    await processPendingJobs();
    await waitForTurnJob(gameState.id, 1);
    
    const updatedGameResponse = await apiRequest('GET', `/api/game/${gameState.id}`);
    expect(updatedGameResponse.status).toBe(200);
    const updatedGame: GameState = await updatedGameResponse.json();
    expect(updatedGame.turnNumber).toBe(1);
    expect(updatedGame.turns.length).toBe(2);
  });

  it('should enforce authentication on protected endpoints', async () => {
    // Try to create game without authentication
    const unauthenticatedResponse = await apiRequest('POST', '/api/game/start', { absurdity: 2 });
    expect(unauthenticatedResponse.status).toBe(401); // Unauthorized
    
    // Create auth cookie and verify authenticated request works
    authCookie = await createAuthCookie();
    
    const createGameResponse = await apiRequest('POST', '/api/game/start', { absurdity: 2 });
    expect(createGameResponse.status).toBe(200);
    const gameState: GameState = await createGameResponse.json();
    
    // Try to access without cookie - should fail
    const tempCookie = authCookie;
    authCookie = ''; // Clear cookie
    const unauthenticatedGetResponse = await apiRequest('GET', `/api/game/${gameState.id}`);
    expect(unauthenticatedGetResponse.status).toBe(401);
    
    // Restore cookie
    authCookie = tempCookie;
  });

  it('should handle game not found errors', async () => {
    authCookie = await createAuthCookie();
    
    const fakeGameId = '00000000-0000-0000-0000-000000000000';
    
    const response = await apiRequest('GET', `/api/game/${fakeGameId}`);
    expect(response.status).toBe(404);
  });
});
