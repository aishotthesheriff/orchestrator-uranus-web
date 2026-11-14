import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';
import { randomUUID } from 'crypto';
import { isUniqueViolation as isUniqueViolationError } from '../db/errors';


export type UserPreferences = {
  theme?: string;
  style?: string;
  imageModelKey?: string;
  llmModelKey?: string;
  skipImageCache?: boolean;
  typewriterEnabled?: boolean;
};

function toUserPreferences(user?: Pick<User, 'theme' | 'style' | 'imageModelKey' | 'llmModelKey' | 'skipImageCache' | 'typewriterEnabled'> | null): UserPreferences {
  if (!user) {
    return { skipImageCache: true, typewriterEnabled: true };
  }

  return {
    theme: user.theme ?? undefined,
    style: user.style ?? undefined,
    imageModelKey: user.imageModelKey ?? undefined,
    llmModelKey: user.llmModelKey ?? undefined,
    skipImageCache: user.skipImageCache ?? true,
    typewriterEnabled: user.typewriterEnabled ?? true,
  };
}

export class UserRepository extends BaseRepository {
  async getUser(id: string): Promise<User | undefined> {
    const result = await this.query('SELECT * FROM users WHERE id = $1', [id]);
    return this.mapUser(result.rows[0]);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await this.query('SELECT * FROM users WHERE username = $1', [username]);
    return this.mapUser(result.rows[0]);
  }

  async searchUsersByUsername(pattern: string, limit: number = 20): Promise<User[]> {
    const escapedPattern = pattern.replace(/[\\%_]/g, '\\$&');
    const searchPattern = `${escapedPattern}%`;
    const cappedLimit = Math.min(limit, 50);
    const result = await this.query(
      'SELECT * FROM users WHERE LOWER(username) LIKE LOWER($1) LIMIT $2',
      [searchPattern, cappedLimit]
    );
    return result.rows.map(row => this.mapUser(row)!).filter(Boolean);
  }

  async ensureUser(username: string): Promise<User> {
    const existing = await this.getUserByUsername(username);
    if (existing) {
      return existing;
    }
  
    try {
      return await this.createUser({
        username,
        password: randomUUID(),
      });
    } catch (error: any) {
      const isUniqueViolation = isUniqueViolationError(error);
      if (!isUniqueViolation) {
        throw error;
      }
  
      const user = await this.getUserByUsername(username);
      if (user) {
        return user;
      }
  
      throw error;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const result = await this.query(
      'INSERT INTO users (id, username, password) VALUES ($1, $2, $3) RETURNING *',
      [id, insertUser.username, insertUser.password]
    );
    return this.mapUser(result.rows[0])!;
  }

  async getUserPreferences(username: string): Promise<UserPreferences> {
    const user = await this.getUserByUsername(username);
    return toUserPreferences(user);
  }

  async updateUserPreferences(username: string, preferences: UserPreferences): Promise<User> {
    const user = await this.ensureUser(username);
  
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (preferences.theme !== undefined) {
      updates.push(`theme = $${paramIndex++}`);
      values.push(preferences.theme);
    }
    if (preferences.style !== undefined) {
      updates.push(`style = $${paramIndex++}`);
      values.push(preferences.style);
    }
    if (preferences.imageModelKey !== undefined) {
      updates.push(`image_model_key = $${paramIndex++}`);
      values.push(preferences.imageModelKey);
    }
    if (preferences.llmModelKey !== undefined) {
      // Empty string clears the choice (the player follows the default story model).
      updates.push(`llm_model_key = $${paramIndex++}`);
      values.push(preferences.llmModelKey ? preferences.llmModelKey : null);
    }
    if (preferences.skipImageCache !== undefined) {
      updates.push(`skip_image_cache = $${paramIndex++}`);
      values.push(preferences.skipImageCache);
    }
    if (preferences.typewriterEnabled !== undefined) {
      updates.push(`typewriter_enabled = $${paramIndex++}`);
      values.push(preferences.typewriterEnabled);
    }
  
    if (updates.length === 0) {
      return user;
    }
  
    values.push(username);
    const result = await this.query(
      `UPDATE users SET ${updates.join(', ')} WHERE username = $${paramIndex} RETURNING *`,
      values
    );
  
    if (!result.rows[0]) {
      throw new Error(`Failed to update preferences for user ${username}`);
    }
  
    const updatedRow = result.rows[0];
    return this.mapUser(updatedRow)!;
  }
}
