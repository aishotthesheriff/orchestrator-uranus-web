import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool, createLimiter, poolLimit, type DbClient } from '../db';
import { BaseRepository } from './baseRepository';
import { dbOperationDuration } from '../metrics';
/** Turn transactions reserve only half the pool for follow-up queries. */
const turnTransactionSlots = createLimiter(Math.max(1, Math.floor(poolLimit() / 2)));

export class GameRepository extends BaseRepository {
  async getGameState(id: string): Promise<GameState | undefined> {
    const timer = dbOperationDuration.startTimer({ operation: 'query', table: 'games' });
    try {
      const result = await this.query('SELECT * FROM games WHERE id = $1', [id]);
      timer();
      return this.mapGameRow(result.rows[0]);
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getGamesByUsername(username: string): Promise<GameState[]> {
    const result = await this.query(
      'SELECT * FROM games WHERE username = $1 ORDER BY updated_at DESC',
      [username]
    );
  
    return result.rows.map((game: any) => this.mapGameRow(game)!).filter(Boolean);
  }

  async getGameSummariesByUsername(username: string): Promise<GameSummary[]> {
    return this.getGameSummariesByUsernames([username]);
  }

  async getGameSummariesByUsernames(usernames: string[]): Promise<GameSummary[]> {
    if (usernames.length === 0) return [];
  
    const placeholders = usernames.map((_, index) => `$${index + 1}`).join(', ');
    const result = await this.query(
      `SELECT id, username, day, turn_number, segment, is_complete, failure_reason
       FROM games
       WHERE username IN (${placeholders})
       ORDER BY updated_at DESC`,
      usernames,
    );
  
    return result.rows.map(row => ({
      id: row.id,
      username: row.username,
      day: row.day,
      turnNumber: row.turn_number,
      segment: row.segment,
      isComplete: Number(row.is_complete) === 1,
      failureReason: row.failure_reason || undefined,
    }));
  }

  async createGameState(state: GameState): Promise<GameState> {
    await this.query(
      `INSERT INTO games (id, username, seed, day, turn_number, segment, absurdity, stats, npcs, equipped_items, turns, current_actions, running_gags, event_history, interview_responses, is_complete, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        state.id,
        state.username,
        state.seed,
        state.day,
        state.turnNumber,
        state.segment,
        state.absurdity,
        JSON.stringify(state.stats),
        JSON.stringify(state.npcs),
        JSON.stringify(state.equippedItems),
        JSON.stringify(state.turns),
        JSON.stringify(state.currentActions),
        JSON.stringify(state.runningGags),
        JSON.stringify(state.eventHistory),
        JSON.stringify(state.interviewResponses),
        state.isComplete ? 1 : 0,
        state.failureReason || null,
      ]
    );
    return state;
  }

  async deleteGameState(id: string): Promise<void> {
    await this.query('DELETE FROM games WHERE id = $1', [id]);
  }

  async processTurnWithTransaction(
    gameId: string,
    processor: (state: GameState, client: DbClient) => Promise<GameState>
  ): Promise<GameState> {
    // The processor runs while this transaction holds a connection, and it makes further
    // queries on other connections. Without a cap, enough simultaneous turns would take
    // every connection and leave none for the work that lets any of them finish.
    const releaseSlot = await turnTransactionSlots.acquire();
    try {
      return await this.runTurnTransaction(gameId, processor);
    } finally {
      releaseSlot();
    }
  }

  private async runTurnTransaction(
    gameId: string,
    processor: (state: GameState, client: DbClient) => Promise<GameState>
  ): Promise<GameState> {
    const timer = dbOperationDuration.startTimer({ operation: 'transaction', table: 'games' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the game state row for update to prevent race conditions
      const result = await client.query(
        'SELECT * FROM games WHERE id = $1 FOR UPDATE',
        [gameId]
      );
      
      const state = result.rows[0];
      if (!state) {
        throw new Error('Game not found');
      }
  
      const gameState = this.mapGameRow(state)!;
  
      // Process turn logic with the locked state
      const updatedState = await processor(gameState, client);
  
      // Update the game state within the transaction
      await client.query(
        `UPDATE games SET 
          username = $1, seed = $2, day = $3, turn_number = $4, segment = $5, absurdity = $6,
          stats = $7, npcs = $8, equipped_items = $9, turns = $10, current_actions = $11,
          running_gags = $12, event_history = $13, interview_responses = $14, is_complete = $15,
          failure_reason = $16, updated_at = NOW(3)
         WHERE id = $17`,
        [
          updatedState.username,
          updatedState.seed,
          updatedState.day,
          updatedState.turnNumber,
          updatedState.segment,
          updatedState.absurdity,
          JSON.stringify(updatedState.stats),
          JSON.stringify(updatedState.npcs),
          JSON.stringify(updatedState.equippedItems),
          JSON.stringify(updatedState.turns),
          JSON.stringify(updatedState.currentActions),
          JSON.stringify(updatedState.runningGags),
          JSON.stringify(updatedState.eventHistory),
          JSON.stringify(updatedState.interviewResponses),
          updatedState.isComplete ? 1 : 0,
          updatedState.failureReason || null,
          gameId,
        ]
      );
  
      await client.query('COMMIT');
      timer();
      return updatedState;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      timer();
      throw error;
    } finally {
      client.release();
    }
  }
}

/** The GameRepository methods the storage facade exposes. */
export interface IGameRepository extends Pick<GameRepository,
  | 'getGameState'
  | 'getGamesByUsername'
  | 'getGameSummariesByUsername'
  | 'getGameSummariesByUsernames'
  | 'createGameState'
  | 'deleteGameState'
  | 'processTurnWithTransaction'
> {}
