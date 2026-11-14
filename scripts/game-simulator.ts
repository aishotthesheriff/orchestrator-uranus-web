#!/usr/bin/env tsx
/**
 * Game and Turn Simulator
 * 
 * A CLI tool for testing Quest to Uranus game flow without the UI.
 * Simulates player actions, listens for WebSocket events, and displays game state.
 * 
 * Usage:
 *   tsx scripts/game-simulator.ts [options]
 * 
 * Options:
 *   --username <name>    Username to use (default: "simulator")
 *   --server <url>       Server URL (default: "http://localhost:5001")
 *   --game-id <id>       Resume existing game instead of starting new
 *   --actions <count>    Number of actions to take (default: 5)
 *   --auto                Auto-play without prompting
 *   --wait <seconds>     Wait between actions in auto mode (default: 10)
 */

import { io, Socket } from 'socket.io-client';
import type { GameState, ActionInput } from '@shared/schema';

interface SimulatorOptions {
  username: string;
  serverUrl: string;
  gameId?: string;
  actions: number;
  auto: boolean;
  waitSeconds: number;
  absurdity?: number;
  seed?: string;
}

interface CookieJar {
  cookies: Map<string, string>;
  setCookie(cookie: string): void;
  getCookieHeader(): string;
}

class Simulator {
  private options: SimulatorOptions;
  private cookieJar: CookieJar;
  private csrfToken: string | null = null;
  private socket: Socket | null = null;
  private gameId: string | null = null;
  private gameState: GameState | null = null;

  constructor(options: SimulatorOptions) {
    this.options = options;
    this.cookieJar = {
      cookies: new Map(),
      setCookie(cookie: string) {
        // Extract cookie name and value (everything before first semicolon)
        const cookiePart = cookie.split(';')[0].trim();
        const [name, ...valueParts] = cookiePart.split('=');
        if (name && valueParts.length > 0) {
          this.cookies.set(name, valueParts.join('='));
        }
      },
      getCookieHeader() {
        const cookiePairs: string[] = [];
        this.cookies.forEach((value, name) => {
          cookiePairs.push(`${name}=${value}`);
        });
        return cookiePairs.join('; ');
      }
    };
  }

  private async fetchCSRFToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;

    const response = await fetch(`${this.options.serverUrl}/api/csrf-token`, {
      credentials: 'include',
      headers: {
        'Cookie': this.cookieJar.getCookieHeader()
      }
    });

    if (response.ok) {
      const data = await response.json();
      this.csrfToken = data.csrfToken || '';
    } else {
      this.csrfToken = '';
    }

    // Extract cookies from response (handle multiple Set-Cookie headers)
    const setCookieHeaders = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (setCookieHeaders.length === 0) {
      // Fallback for environments that don't support getSetCookie()
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Handle comma-separated cookies (RFC 6265)
        setCookie.split(',').forEach(cookie => {
          this.cookieJar.setCookie(cookie.trim());
        });
      }
    } else {
      setCookieHeaders.forEach(cookie => {
        this.cookieJar.setCookie(cookie);
      });
    }

    return this.csrfToken || '';
  }

  private async apiRequest(
    method: string,
    path: string,
    data?: unknown
  ): Promise<Response> {
    const url = `${this.options.serverUrl}${path}`;
    const headers: Record<string, string> = {};

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const token = await this.fetchCSRFToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    }

    // Read the cookies after the token fetch: that fetch sets the cookie the token is checked against.
    headers['Cookie'] = this.cookieJar.getCookieHeader();

    if (data) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: data ? JSON.stringify(data) : undefined
    });

    // Extract cookies from response (handle multiple Set-Cookie headers)
    const setCookieHeaders = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (setCookieHeaders.length === 0) {
      // Fallback for environments that don't support getSetCookie()
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Handle comma-separated cookies (RFC 6265)
        setCookie.split(',').forEach(cookie => {
          this.cookieJar.setCookie(cookie.trim());
        });
      }
    } else {
      setCookieHeaders.forEach(cookie => {
        this.cookieJar.setCookie(cookie);
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response;
  }

  private async authenticateUser(): Promise<void> {
    console.log(`🔐 Authenticating as "${this.options.username}"...`);
    
    const response = await this.apiRequest('PUT', '/api/user', {
      username: this.options.username
    });

    const user = await response.json();
    console.log(`✅ Authenticated as ${user.username} (ID: ${user.id})`);
  }

  private async startGame(): Promise<GameState> {
    console.log('🎮 Starting new game...');
    
    const gameParams: Record<string, unknown> = {
      username: this.options.username
    };
    
    if (this.options.absurdity !== undefined) {
      gameParams.absurdity = this.options.absurdity;
      console.log(`   Setting absurdity level: ${this.options.absurdity}`);
    }
    
    if (this.options.seed) {
      gameParams.seed = this.options.seed;
      console.log(`   Using seed: ${this.options.seed}`);
    }
    
    const response = await this.apiRequest('POST', '/api/game/start', gameParams);

    const gameState = await response.json() as GameState;
    this.gameId = gameState.id;
    this.gameState = gameState;
    
    console.log(`✅ Game started: ${gameState.id}`);
    console.log(`   Turn: ${gameState.turnNumber}, Day: ${gameState.day}, Segment: ${gameState.segment}`);
    console.log(`   Absurdity: ${gameState.absurdity}, Seed: ${gameState.seed}`);
    
    return gameState;
  }

  private async loadGame(gameId: string): Promise<GameState> {
    console.log(`📂 Loading game: ${gameId}...`);
    
    const response = await this.apiRequest('GET', `/api/game/${gameId}`);
    const gameState = await response.json() as GameState;
    
    this.gameId = gameId;
    this.gameState = gameState;
    
    console.log(`✅ Game loaded: ${gameState.id}`);
    console.log(`   Turn: ${gameState.turnNumber}, Day: ${gameState.day}, Segment: ${gameState.segment}`);
    
    return gameState;
  }

  private connectSocket(): void {
    if (!this.gameId) {
      throw new Error('Cannot connect socket without game ID');
    }

    console.log('🔌 Connecting to WebSocket...');
    
    this.socket = io(this.options.serverUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      // Joining a game room requires the same sign-in cookie as the REST routes
      extraHeaders: { Cookie: this.cookieJar.getCookieHeader() }
    });

    this.socket.on('connect', () => {
      console.log('✅ WebSocket connected');
      this.socket?.emit('joinGame', this.gameId);
    });

    this.socket.on('disconnect', () => {
      console.log('⚠️  WebSocket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
    });

    this.socket.on('turnComplete', async (data: { gameId: string; turnNumber: number }) => {
      console.log(`\n🎉 Turn Complete Event Received!`);
      console.log(`   Game ID: ${data.gameId}`);
      console.log(`   Turn Number: ${data.turnNumber}`);
      
      // Refresh game state
      await this.refreshGameState();
    });

    this.socket.on('imageReady', async (data: {
      jobId: string;
      gameId: string;
      turnNumber: number;
      imageUrl: string;
      imageTemplate: string;
    }) => {
      console.log(`\n🖼️  Image Ready Event Received!`);
      console.log(`   Turn: ${data.turnNumber}`);
      console.log(`   Template: ${data.imageTemplate}`);
      console.log(`   URL: ${data.imageUrl}`);
      
      // Refresh game state
      await this.refreshGameState();
    });

    this.socket.on('imageFailed', (data: {
      jobId: string;
      gameId: string;
      turnNumber: number;
      error: string;
    }) => {
      console.log(`\n❌ Image Failed Event Received!`);
      console.log(`   Turn: ${data.turnNumber}`);
      console.log(`   Error: ${data.error}`);
    });

    this.socket.connect();
  }

  private async refreshGameState(): Promise<void> {
    if (!this.gameId) return;
    
    try {
      const response = await this.apiRequest('GET', `/api/game/${this.gameId}`);
      this.gameState = await response.json() as GameState;
      this.displayGameState();
    } catch (error) {
      console.error('Failed to refresh game state:', error);
    }
  }

  private displayGameState(): void {
    if (!this.gameState) return;

    const { stats, turnNumber, day, segment, currentActions, turns } = this.gameState;
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;

    console.log('\n' + '='.repeat(80));
    console.log('📊 GAME STATE');
    console.log('='.repeat(80));
    console.log(`Turn: ${turnNumber} | Day: ${day} | Segment: ${segment}`);
    console.log(`\n📈 Stats:`);
    console.log(`   Hull: ${stats.hull} | Oxygen: ${stats.oxygen} | Fuel: ${stats.fuel}`);
    console.log(`   Food: ${stats.food} | Morale: ${stats.morale} | Weirdness: ${stats.weirdness}`);
    
    if (lastTurn) {
      console.log(`\n📖 Last Turn Narrative:`);
      console.log(`   ${lastTurn.narrative.substring(0, 200)}${lastTurn.narrative.length > 200 ? '...' : ''}`);
      
      if (lastTurn.checks && lastTurn.checks.length > 0) {
        console.log(`\n🎲 Skill Checks:`);
        lastTurn.checks.forEach(check => {
          const icon = check.success ? '✅' : '❌';
          console.log(`   ${icon} ${check.skill}: ${check.roll}/${check.dc} ${check.success ? 'SUCCESS' : 'FAILURE'}`);
        });
      }
    }

    if (currentActions && currentActions.length > 0) {
      console.log(`\n🎯 Available Actions:`);
      currentActions.forEach((action, idx) => {
        console.log(`   ${idx + 1}. ${action.summary} [${action.risk}]`);
      });
    }

    console.log('='.repeat(80) + '\n');
  }

  private async takeAction(action: string): Promise<void> {
    if (!this.gameId) {
      throw new Error('No game ID available');
    }

    console.log(`\n🎬 Taking action: "${action}"...`);
    
    const actionInput: ActionInput = {
      gameId: this.gameId,
      action
    };

    try {
      const response = await this.apiRequest('POST', '/api/game/action', actionInput);
      const result = await response.json();
      
      if (result.status === 'processing') {
        console.log(`✅ Action submitted (Job ID: ${result.turnJobId})`);
        console.log(`   Waiting for turn processing to complete...`);
      } else {
        console.log(`✅ Action response:`, result);
      }
    } catch (error) {
      console.error('❌ Failed to take action:', error);
      throw error;
    }
  }

  private async waitForTurnCompletion(timeoutSeconds: number = 60): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for turn completion after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      const handler = async (data: { gameId: string; turnNumber: number }) => {
        if (data.gameId === this.gameId) {
          clearTimeout(timeout);
          this.socket?.off('turnComplete', handler);
          await this.refreshGameState();
          resolve();
        }
      };

      this.socket.on('turnComplete', handler);
    });
  }

  private async selectAction(): Promise<string> {
    if (!this.gameState || !this.gameState.currentActions || this.gameState.currentActions.length === 0) {
      throw new Error('No actions available');
    }

    const actions = this.gameState.currentActions;
    
    console.log('\n📋 Select an action:');
    actions.forEach((action, idx) => {
      console.log(`   ${idx + 1}. ${action.summary} [${action.risk}]`);
    });

    if (this.options.auto) {
      // Auto-select first action
      const selected = actions[0];
      console.log(`\n🤖 Auto-selecting: ${selected.summary}`);
      return selected.action;
    }

    // In interactive mode, we'd use readline, but for simplicity, auto-select first
    const selected = actions[0];
    console.log(`\n🤖 Auto-selecting: ${selected.summary} (interactive mode not implemented)`);
    return selected.action;
  }

  async run(): Promise<void> {
    try {
      // Step 1: Authenticate
      await this.authenticateUser();

      // Step 2: Start or load game
      if (this.options.gameId) {
        await this.loadGame(this.options.gameId);
      } else {
        await this.startGame();
      }

      // Step 3: Connect WebSocket
      if (this.gameId) {
        this.connectSocket();
      }

      // Step 4: Display initial state
      this.displayGameState();

      // Step 5: Take actions
      for (let i = 0; i < this.options.actions; i++) {
        if (this.gameState?.isComplete) {
          console.log('\n🏁 Game is complete!');
          break;
        }

        if (!this.gameState?.currentActions || this.gameState.currentActions.length === 0) {
          console.log('\n⚠️  No actions available');
          break;
        }

        try {
          // Select and take action
          const action = await this.selectAction();
          await this.takeAction(action);

          // Wait for turn completion
          if (!this.options.auto) {
            console.log('⏳ Waiting for turn completion...');
          }
          
          await this.waitForTurnCompletion(120); // 2 minute timeout

          // Wait before next action (if auto mode)
          if (this.options.auto && i < this.options.actions - 1) {
            console.log(`\n⏸️  Waiting ${this.options.waitSeconds}s before next action...`);
            await new Promise(resolve => setTimeout(resolve, this.options.waitSeconds * 1000));
          }
        } catch (error) {
          console.error(`❌ Error during action ${i + 1}:`, error);
          if (!this.options.auto) {
            break; // Stop on error in interactive mode
          }
        }
      }

      console.log('\n✅ Simulator completed');
      
    } catch (error) {
      console.error('❌ Simulator error:', error);
      process.exit(1);
    } finally {
      if (this.socket) {
        if (this.gameId) {
          this.socket.emit('leaveGame', this.gameId);
        }
        this.socket.disconnect();
      }
    }
  }
}

// Parse command line arguments
function parseArgs(): SimulatorOptions {
  const args = process.argv.slice(2);
  const options: SimulatorOptions = {
    username: 'simulator',
    serverUrl: 'http://localhost:5001',
    actions: 5,
    auto: false,
    waitSeconds: 10
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--username' && args[i + 1]) {
      options.username = args[++i];
    } else if (arg === '--server' && args[i + 1]) {
      options.serverUrl = args[++i];
    } else if (arg === '--game-id' && args[i + 1]) {
      options.gameId = args[++i];
    } else if (arg === '--actions' && args[i + 1]) {
      options.actions = parseInt(args[++i], 10) || 5;
    } else if (arg === '--auto') {
      options.auto = true;
    } else if (arg === '--wait' && args[i + 1]) {
      options.waitSeconds = parseInt(args[++i], 10) || 10;
    } else if (arg === '--absurdity' && args[i + 1]) {
      options.absurdity = parseInt(args[++i], 10);
      if (isNaN(options.absurdity) || options.absurdity < 0 || options.absurdity > 3) {
        console.error('❌ Absurdity must be between 0 and 3');
        process.exit(1);
      }
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Game and Turn Simulator

Usage:
  tsx scripts/game-simulator.ts [options]

Options:
  --username <name>    Username to use (default: "simulator")
  --server <url>       Server URL (default: "http://localhost:5001")
  --game-id <id>       Resume existing game instead of starting new
  --actions <count>    Number of actions to take (default: 5)
  --auto               Auto-play without prompting
  --wait <seconds>     Wait between actions in auto mode (default: 10)
  --absurdity <0-3>    Set absurdity level for new game (0-3, default: 2)
  --seed <string>      Set seed for new game (for reproducible games)
  --help, -h           Show this help message

Examples:
  # Start new game and take 5 actions
  tsx scripts/game-simulator.ts --username testuser --actions 5

  # Start new game with custom absurdity and seed
  tsx scripts/game-simulator.ts --username testuser --absurdity 3 --seed "my-seed"

  # Resume existing game and auto-play 10 turns
  tsx scripts/game-simulator.ts --game-id <uuid> --auto --actions 10 --wait 15
      `);
      process.exit(0);
    }
  }

  return options;
}

// Run simulator
const options = parseArgs();
const simulator = new Simulator(options);
simulator.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

