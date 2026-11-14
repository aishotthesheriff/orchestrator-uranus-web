import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';


export class SettingsRepository extends BaseRepository {
  async getAllSettings(): Promise<AppSetting[]> {
    const result = await this.query('SELECT * FROM app_settings');
    return result.rows;
  }

  async getActiveSettings(): Promise<AppSetting[]> {
    const result = await this.query('SELECT * FROM app_settings WHERE active = 1');
    return result.rows;
  }

  async getSetting(key: string): Promise<AppSetting | undefined> {
    const result = await this.query('SELECT * FROM app_settings WHERE `key` = $1', [key]);
    return result.rows[0] || undefined;
  }

  async upsertSetting(key: string, value: string, description?: string, active: number = 1): Promise<AppSetting> {
    const existing = await this.getSetting(key);
    if (existing) {
      const result = await this.query(
        `UPDATE app_settings SET value = $1, description = $2, active = $3, updated_at = NOW(3)
         WHERE \`key\` = $4 RETURNING *`,
        [value, description ?? existing.description ?? null, active, key]
      );
      return result.rows[0];
    } else {
      const result = await this.query(
        `INSERT INTO app_settings (\`key\`, value, description, active)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [key, value, description ?? null, active]
      );
      return result.rows[0];
    }
  }
}
