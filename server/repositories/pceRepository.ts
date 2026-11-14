import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';
import { randomUUID } from 'crypto';


export class PceRepository extends BaseRepository {
  async getPceTestScenarios(filters?: { tags?: string; preset?: boolean; limit?: number }): Promise<PceTestScenario[]> {
    let query = 'SELECT * FROM pce_test_scenarios WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;
  
    if (filters?.tags) {
      query += ` AND tags LIKE $${paramIndex++}`;
      params.push(`%${filters.tags}%`);
    }
  
    if (filters?.preset !== undefined) {
      query += ` AND is_preset = $${paramIndex++}`;
      params.push(filters.preset ? 1 : 0);
    }
  
    query += ' ORDER BY is_preset DESC, created_at DESC';
  
    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
  
    const result = await this.query(query, params);
    return result.rows.map(row => this.mapPceTestScenario(row)!);
  }

  async getPceTestScenario(id: string): Promise<PceTestScenario | null> {
    const result = await this.query('SELECT * FROM pce_test_scenarios WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? this.mapPceTestScenario(row)! : null;
  }

  async createPceTestScenario(scenario: Omit<PceTestScenario, 'id' | 'createdAt' | 'updatedAt'>): Promise<PceTestScenario> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO pce_test_scenarios (
        id, name, description, game_state_json, player_action, checks_json,
        triggered_event_json, theme, style, image_model_key, tags, is_preset,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, COALESCE($6, '[]'),
        $7, $8, $9, $10, $11, $12,
        $13, NOW(3), NOW(3)
      )
      RETURNING *`,
      [
        id,
        scenario.name,
        scenario.description ?? null,
        scenario.gameStateJson,
        scenario.playerAction,
        scenario.checksJson ?? null,
        scenario.triggeredEventJson ?? null,
        scenario.theme ?? null,
        scenario.style ?? null,
        scenario.imageModelKey ?? null,
        scenario.tags ?? null,
        scenario.isPreset ? 1 : 0,
        scenario.createdBy ?? null,
      ]
    );
    return this.mapPceTestScenario(result.rows[0])!;
  }

  async updatePceTestScenario(id: string, updates: Partial<PceTestScenario>): Promise<PceTestScenario> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };
  
    if (updates.name !== undefined) assign('name', updates.name);
    if (updates.description !== undefined) assign('description', updates.description);
    if (updates.gameStateJson !== undefined) assign('game_state_json', updates.gameStateJson);
    if (updates.playerAction !== undefined) assign('player_action', updates.playerAction);
    if (updates.checksJson !== undefined) assign('checks_json', updates.checksJson);
    if (updates.triggeredEventJson !== undefined) assign('triggered_event_json', updates.triggeredEventJson);
    if (updates.theme !== undefined) assign('theme', updates.theme);
    if (updates.style !== undefined) assign('style', updates.style);
    if (updates.imageModelKey !== undefined) assign('image_model_key', updates.imageModelKey);
    if (updates.tags !== undefined) assign('tags', updates.tags);
    if (updates.isPreset !== undefined) assign('is_preset', updates.isPreset ? 1 : 0);
    if (updates.createdBy !== undefined) assign('created_by', updates.createdBy);
  
    if (fields.length === 0) {
      const existing = await this.getPceTestScenario(id);
      if (!existing) throw new Error(`Test scenario ${id} not found`);
      return existing;
    }
  
    fields.push('updated_at = NOW(3)');
    values.push(id);
  
    const result = await this.query(
      `UPDATE pce_test_scenarios
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) {
      throw new Error(`Test scenario ${id} not found`);
    }
    return this.mapPceTestScenario(result.rows[0])!;
  }

  async deletePceTestScenario(id: string): Promise<void> {
    await this.query('DELETE FROM pce_test_scenarios WHERE id = $1', [id]);
  }

  async getPceTestRuns(filters?: { limit?: number; scenarioId?: string; tags?: string; status?: string; starred?: boolean }): Promise<PceTestRun[]> {
    let query = 'SELECT * FROM pce_test_runs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;
  
    if (filters?.scenarioId) {
      query += ` AND scenario_id = $${paramIndex++}`;
      params.push(filters.scenarioId);
    }
  
    if (filters?.tags) {
      query += ` AND tags LIKE $${paramIndex++}`;
      params.push(`%${filters.tags}%`);
    }
  
    if (filters?.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }
  
    if (filters?.starred !== undefined) {
      query += ` AND starred = $${paramIndex++}`;
      params.push(filters.starred ? 1 : 0);
    }
  
    query += ' ORDER BY executed_at DESC';
  
    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
  
    const result = await this.query(query, params);
    return result.rows.map(row => this.mapPceTestRun(row)!);
  }

  async getPceTestRun(id: string): Promise<PceTestRun | null> {
    const result = await this.query('SELECT * FROM pce_test_runs WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? this.mapPceTestRun(row)! : null;
  }

  async createPceTestRun(run: Omit<PceTestRun, 'id' | 'executedAt'>): Promise<PceTestRun> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO pce_test_runs (
        id, scenario_id, release_version, template_master_id, template_narrative_id,
        template_image_id, template_actions_id, status, stage_results_json, executed_at,
        duration_ms, total_tokens_prompt, total_tokens_response, estimated_cost_usd,
        notes, tags, starred
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, NOW(3),
        $10, $11, $12, $13,
        $14, $15, $16
      )
      RETURNING *`,
      [
        id,
        run.scenarioId,
        run.releaseVersion ?? null,
        run.templateMasterId ?? null,
        run.templateNarrativeId ?? null,
        run.templateImageId ?? null,
        run.templateActionsId ?? null,
        run.status,
        run.stageResultsJson,
        run.durationMs ?? null,
        run.totalTokensPrompt ?? null,
        run.totalTokensResponse ?? null,
        run.estimatedCostUsd ?? null,
        run.notes ?? null,
        run.tags ?? null,
        run.starred ? 1 : 0,
      ]
    );
    return this.mapPceTestRun(result.rows[0])!;
  }

  async updatePceTestRun(id: string, updates: Partial<PceTestRun>): Promise<PceTestRun> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };
  
    if (updates.notes !== undefined) assign('notes', updates.notes);
    if (updates.tags !== undefined) assign('tags', updates.tags);
    if (updates.starred !== undefined) assign('starred', updates.starred ? 1 : 0);
  
    if (fields.length === 0) {
      const existing = await this.getPceTestRun(id);
      if (!existing) throw new Error(`Test run ${id} not found`);
      return existing;
    }
  
    values.push(id);
    const result = await this.query(
      `UPDATE pce_test_runs
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) {
      throw new Error(`Test run ${id} not found`);
    }
    return this.mapPceTestRun(result.rows[0])!;
  }

  async deletePceTestRun(id: string): Promise<void> {
    await this.query('DELETE FROM pce_test_runs WHERE id = $1', [id]);
  }

  async getPceTestMetrics(testRunId: string): Promise<PceTestMetrics | null> {
    const result = await this.query('SELECT * FROM pce_test_metrics WHERE test_run_id = $1 LIMIT 1', [testRunId]);
    const row = result.rows[0];
    return row ? this.mapPceTestMetrics(row)! : null;
  }

  async getPceTemplateVersions(promptId: string): Promise<PceTemplateVersion[]> {
    const result = await this.query(
      'SELECT * FROM pce_template_versions WHERE prompt_id = $1 ORDER BY version_number DESC',
      [promptId]
    );
    return result.rows.map(row => this.mapPceTemplateVersion(row)!);
  }
}

/** The PceRepository methods the storage facade exposes. */
export interface IPceRepository extends Pick<PceRepository,
  | 'getPceTestScenarios'
  | 'getPceTestScenario'
  | 'createPceTestScenario'
  | 'updatePceTestScenario'
  | 'deletePceTestScenario'
  | 'getPceTestRuns'
  | 'getPceTestRun'
  | 'createPceTestRun'
  | 'updatePceTestRun'
  | 'deletePceTestRun'
  | 'getPceTestMetrics'
  | 'getPceTemplateVersions'
> {}
