import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool, withTransaction } from '../db';
import { BaseRepository } from './baseRepository';
import { randomUUID } from 'crypto';


export class CatalogRepository extends BaseRepository {
  private mapImageModelRow(row: any): ImageModel {
    if (!row) return row;
    return {
      id: row.id,
      modelKey: row.model_key,
      provider: row.provider,
      modelName: row.model_name,
      hfProvider: row.hf_provider ?? '',
      active: row.active,
      displayName: row.display_name,
      description: row.description ?? '',
      sortOrder: row.sort_order,
      defaultSize: row.default_size ?? '',
      defaultQuality: row.default_quality ?? '',
      defaultBackground: row.default_background ?? '',
      defaultModeration: row.default_moderation ?? '',
      allowedSizes: row.allowed_sizes,
      capabilities: row.capabilities,
      providerParams: row.provider_params,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      triggerWords: row.trigger_words ?? '',
      class: row.class ?? '',
    } as unknown as ImageModel;
  }

  async getActiveImageModels(): Promise<ImageModel[]> {
    const result = await this.query(
      'SELECT * FROM image_models WHERE active = 1 ORDER BY sort_order, model_key'
    );
    return result.rows.map((r: any) => this.mapImageModelRow(r));
  }

  async getImageModelByKey(modelKey: string): Promise<ImageModel | null> {
    const result = await this.query('SELECT * FROM image_models WHERE model_key = $1 LIMIT 1', [modelKey]);
    return result.rows[0] ? this.mapImageModelRow(result.rows[0]) : null;
  }

  async getDefaultImageModel(): Promise<ImageModel | null> {
    const result = await this.query(
      'SELECT * FROM image_models WHERE active = 1 AND is_default = true ORDER BY sort_order, model_key LIMIT 1'
    );
    return result.rows[0] ? this.mapImageModelRow(result.rows[0]) : null;
  }

  async listImageModels(): Promise<ImageModel[]> {
    const result = await this.query('SELECT * FROM image_models ORDER BY sort_order, model_key');
    return result.rows.map((r: any) => this.mapImageModelRow(r));
  }

  async upsertImageModel(input: Partial<ImageModel> & { modelKey: string }): Promise<ImageModel> {
    const columns: Array<[keyof ImageModel, string, (value: any) => any]> = [
      ['provider', 'provider', value => value],
      ['modelName', 'model_name', value => value],
      ['hfProvider', 'hf_provider', value => value ?? null],
      ['active', 'active', value => value],
      ['isDefault', 'is_default', value => Boolean(value)],
      ['displayName', 'display_name', value => value],
      ['description', 'description', value => value ?? null],
      ['sortOrder', 'sort_order', value => value],
      ['defaultSize', 'default_size', value => value ?? null],
      ['defaultQuality', 'default_quality', value => value ?? null],
      ['defaultBackground', 'default_background', value => value ?? null],
      ['defaultModeration', 'default_moderation', value => value ?? null],
      ['allowedSizes', 'allowed_sizes', value => value ? JSON.stringify(value) : null],
      ['capabilities', 'capabilities', value => value ? JSON.stringify(value) : null],
      ['providerParams', 'provider_params', value => value ? JSON.stringify(value) : null],
      ['triggerWords', 'trigger_words', value => value ?? null],
      ['class', 'class', value => value ?? null],
    ];
  
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT id, active FROM image_models WHERE model_key = $1 FOR UPDATE',
        [input.modelKey],
      );
      const willBeActive = (input.active ?? existing.rows[0]?.active ?? 1) === 1;
      if (input.isDefault === true && !willBeActive) {
        throw new Error('An inactive image model cannot be the default');
      }
  
      const effectiveInput = input.active === 0 ? { ...input, isDefault: false } : input;
      if (effectiveInput.isDefault === true) {
        await client.query(
          'UPDATE image_models SET is_default = FALSE, updated_at = NOW(3) WHERE is_default = TRUE AND model_key <> $1',
          [input.modelKey],
        );
      }
  
      let row: any;
      if (existing.rows[0]) {
        const provided = columns.filter(([field]) => effectiveInput[field] !== undefined);
        const sets = provided.map(([, column], index) => `${column} = $${index + 1}`);
        const values = provided.map(([field, , convert]) => convert(effectiveInput[field]));
        sets.push('updated_at = NOW(3)');
        values.push(input.modelKey);
  
        const result = await client.query(
          `UPDATE image_models SET ${sets.join(', ')} WHERE model_key = $${values.length} RETURNING *`,
          values,
        );
        row = result.rows[0];
      } else {
        if (!effectiveInput.modelName) {
          throw new Error('modelName is required when creating an image model');
        }
  
        const withDefaults: Partial<ImageModel> = {
          provider: 'openai',
          displayName: effectiveInput.modelKey,
          ...effectiveInput,
        };
        const provided = columns.filter(([field]) => withDefaults[field] !== undefined);
        const names = ['id', 'model_key', ...provided.map(([, column]) => column)];
        const values = [
          randomUUID(),
          effectiveInput.modelKey,
          ...provided.map(([field, , convert]) => convert(withDefaults[field])),
        ];
        const result = await client.query(
          `INSERT INTO image_models (${names.join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`,
          values,
        );
        row = result.rows[0];
      }
  
      await client.query('COMMIT');
      return this.mapImageModelRow(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateImageModel(modelKey: string): Promise<void> {
    await this.query('UPDATE image_models SET active = 0, updated_at = NOW(3) WHERE model_key = $1', [modelKey]);
  }

  async reorderImageModels(order: { modelKey: string; sortOrder: number }[]): Promise<void> {
    for (const row of order) {
      await this.query('UPDATE image_models SET sort_order = $1, updated_at = NOW(3) WHERE model_key = $2', [row.sortOrder, row.modelKey]);
    }
  }

  private mapLlmModelRow(row: any): LlmModel {
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    return {
      id: row.id,
      modelKey: row.model_key,
      provider: row.provider,
      modelName: row.model_name,
      hfProvider: row.hf_provider ?? null,
      active: row.active,
      isDefault: Boolean(row.is_default),
      displayName: row.display_name,
      description: row.description ?? null,
      notes: row.notes ?? null,
      sortOrder: row.sort_order,
      adult: Boolean(row.adult),
      supportsJsonMode: Boolean(row.supports_json_mode),
      contextLength: num(row.context_length),
      priceInput: num(row.price_input),
      priceOutput: num(row.price_output),
      params: row.params ?? null,
      fallbackModelKey: row.fallback_model_key ?? null,
      lastCheckAt: row.last_check_at ? new Date(row.last_check_at).toISOString() : null,
      lastCheckOk: row.last_check_ok ?? null,
      lastCheckSummary: row.last_check_summary ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  async listLlmModels(): Promise<LlmModel[]> {
    const result = await this.query('SELECT * FROM llm_models ORDER BY sort_order, model_key');
    return result.rows.map((r: any) => this.mapLlmModelRow(r));
  }

  async getActiveLlmModels(): Promise<LlmModel[]> {
    const result = await this.query('SELECT * FROM llm_models WHERE active = 1 ORDER BY sort_order, model_key');
    return result.rows.map((r: any) => this.mapLlmModelRow(r));
  }

  async getLlmModelByKey(modelKey: string): Promise<LlmModel | null> {
    const result = await this.query('SELECT * FROM llm_models WHERE model_key = $1 LIMIT 1', [modelKey]);
    return result.rows[0] ? this.mapLlmModelRow(result.rows[0]) : null;
  }

  async getDefaultLlmModel(): Promise<LlmModel | null> {
    const result = await this.query(
      'SELECT * FROM llm_models WHERE active = 1 AND is_default = true ORDER BY sort_order, model_key LIMIT 1'
    );
    return result.rows[0] ? this.mapLlmModelRow(result.rows[0]) : null;
  }

  async upsertLlmModel(input: Partial<LlmModel> & { modelKey: string }): Promise<LlmModel> {
    const columns: Array<[keyof LlmModel, string, (v: any) => any]> = [
      ['provider', 'provider', (v) => v],
      ['modelName', 'model_name', (v) => v],
      ['hfProvider', 'hf_provider', (v) => (v ? String(v).trim() || null : null)],
      ['active', 'active', (v) => v],
      ['isDefault', 'is_default', (v) => Boolean(v)],
      ['displayName', 'display_name', (v) => v],
      ['description', 'description', (v) => v ?? null],
      ['notes', 'notes', (v) => v ?? null],
      ['sortOrder', 'sort_order', (v) => v],
      ['adult', 'adult', (v) => Boolean(v)],
      ['supportsJsonMode', 'supports_json_mode', (v) => Boolean(v)],
      ['contextLength', 'context_length', (v) => v ?? null],
      ['priceInput', 'price_input', (v) => v ?? null],
      ['priceOutput', 'price_output', (v) => v ?? null],
      ['params', 'params', (v) => (v && Object.keys(v).length > 0 ? JSON.stringify(v) : null)],
      ['fallbackModelKey', 'fallback_model_key', (v) => (v ? String(v).trim() || null : null)],
    ];
  
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT id, active FROM llm_models WHERE model_key = $1 FOR UPDATE', [input.modelKey]);
      // Only an active model can be the default: an inactive default would silently leave
      // the game on its built-in model. Deactivating the default therefore clears the flag.
      const willBeActive = (input.active ?? existing.rows[0]?.active ?? 1) === 1;
      if (input.isDefault === true && !willBeActive) {
        throw new Error('An inactive model cannot be the default');
      }
      if (input.active === 0) {
        input = { ...input, isDefault: false };
      }
      if (input.isDefault === true) {
        await client.query(
          'UPDATE llm_models SET is_default = FALSE, updated_at = NOW(3) WHERE is_default = TRUE AND model_key <> $1',
          [input.modelKey]
        );
      }
  
      let row: any;
      if (existing.rows[0]) {
        const provided = columns.filter(([field]) => (input as any)[field] !== undefined);
        const sets = provided.map(([, col], i) => `${col} = $${i + 1}`);
        const values = provided.map(([field, , conv]) => conv((input as any)[field]));
        sets.push('updated_at = NOW(3)');
        values.push(input.modelKey);
        const result = await client.query(
          `UPDATE llm_models SET ${sets.join(', ')} WHERE model_key = $${values.length} RETURNING *`,
          values
        );
        row = result.rows[0];
      } else {
        if (!input.modelName) {
          throw new Error('modelName is required when creating an LLM model');
        }
        const withDefaults: Partial<LlmModel> = { displayName: input.modelKey, provider: 'openai', ...input };
        const provided = columns.filter(([field]) => (withDefaults as any)[field] !== undefined);
        const names = ['id', 'model_key', ...provided.map(([, col]) => col)];
        const values = [
          randomUUID(),
          input.modelKey,
          ...provided.map(([field, , conv]) => conv((withDefaults as any)[field])),
        ];
        const result = await client.query(
          `INSERT INTO llm_models (${names.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          values
        );
        row = result.rows[0];
      }
      await client.query('COMMIT');
      return this.mapLlmModelRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateLlmModel(modelKey: string): Promise<void> {
    await this.query(
      'UPDATE llm_models SET active = 0, is_default = FALSE, updated_at = NOW(3) WHERE model_key = $1',
      [modelKey]
    );
  }

  async recordLlmModelCheck(modelKey: string, ok: boolean | null, summary: Record<string, unknown>): Promise<void> {
    // Deliberately leaves updated_at alone: a check is not an edit.
    // The new keys are merged over the stored summary (top level only), with the row locked
    // so two checks finishing together cannot overwrite each other.
    await withTransaction(async (client) => {
      const current = await client.query(
        'SELECT last_check_summary FROM llm_models WHERE model_key = $1 FOR UPDATE',
        [modelKey]
      );
      if (current.rows.length === 0) return;
      const stored = current.rows[0].last_check_summary;
      const existing = typeof stored === 'string' ? JSON.parse(stored) : stored ?? {};
      const merged = JSON.stringify({ ...existing, ...summary });
      if (ok === null) {
        await client.query('UPDATE llm_models SET last_check_summary = $1 WHERE model_key = $2', [merged, modelKey]);
        return;
      }
      await client.query(
        'UPDATE llm_models SET last_check_summary = $1, last_check_at = NOW(3), last_check_ok = $3 WHERE model_key = $2',
        [merged, modelKey, ok]
      );
    });
  }

  async listStoryThemes(): Promise<ModStoryThemes[]> {
    const result = await this.query(`
      SELECT 
        id,
        story_theme_key,
        label,
        narrator_template,
        tags,
        active,
        llm_model_key,
        created_at,
        updated_at
      FROM mod_story_themes 
      ORDER BY label
    `);
    return result.rows.map(row => ({
      id: row.id,
      storyThemeKey: row.story_theme_key,
      label: row.label,
      narratorTemplate: row.narrator_template,
      tags: row.tags,
      active: row.active,
      llmModelKey: row.llm_model_key ?? null,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }));
  }

  async getActiveStoryThemes(): Promise<ModStoryThemes[]> {
    const result = await this.query(`
      SELECT 
        id,
        story_theme_key,
        label,
        narrator_template,
        tags,
        active,
        llm_model_key,
        created_at,
        updated_at
      FROM mod_story_themes 
      WHERE active = 1 
      ORDER BY label
    `);
    return result.rows.map(row => ({
      id: row.id,
      storyThemeKey: row.story_theme_key,
      label: row.label,
      narratorTemplate: row.narrator_template,
      tags: row.tags,
      active: row.active,
      llmModelKey: row.llm_model_key ?? null,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }));
  }

  async upsertStoryTheme(input: Partial<ModStoryThemes> & { id?: string }): Promise<ModStoryThemes> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (input.storyThemeKey !== undefined) {
      updateFields.push(`story_theme_key = $${paramIndex++}`);
      values.push(input.storyThemeKey);
    }
    if (input.label !== undefined) {
      updateFields.push(`label = $${paramIndex++}`);
      values.push(input.label);
    }
    if (input.narratorTemplate !== undefined) {
      updateFields.push(`narrator_template = $${paramIndex++}`);
      values.push(input.narratorTemplate);
    }
    if (input.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(input.tags);
    }
    if (input.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(input.active);
    }
    if (input.llmModelKey !== undefined) {
      // Empty string clears the forced story model.
      updateFields.push(`llm_model_key = $${paramIndex++}`);
      values.push(input.llmModelKey ? input.llmModelKey : null);
    }
  
    if (input.id) {
      updateFields.push(`updated_at = NOW(3)`);
      values.push(input.id);
      const result = await this.query(
        `UPDATE mod_story_themes SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );
      if (!result.rows[0]) {
        throw new Error(`Story theme ${input.id} not found`);
      }
      const row = result.rows[0];
      return {
        id: row.id,
        storyThemeKey: row.story_theme_key,
        label: row.label,
        narratorTemplate: row.narrator_template,
        tags: row.tags,
        active: row.active,
        llmModelKey: row.llm_model_key ?? null,
        rank: null,
        default: false,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      };
    }
  
    const required = ["storyThemeKey", "label", "narratorTemplate"] as const;
    for (const field of required) {
      if (!input[field]) {
        throw new Error(`Missing required field '${field}'`);
      }
    }
  
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO mod_story_themes (id, story_theme_key, label, narrator_template, tags, active, llm_model_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        input.storyThemeKey!,
        input.label!,
        input.narratorTemplate!,
        input.tags ?? "",
        input.active ?? 1,
        input.llmModelKey ? input.llmModelKey : null,
      ]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      storyThemeKey: row.story_theme_key,
      label: row.label,
      narratorTemplate: row.narrator_template,
      tags: row.tags,
      active: row.active,
      llmModelKey: row.llm_model_key ?? null,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  async getDefaultStoryTheme(): Promise<ModStoryThemes | null> {
    const result = await this.query(
      'SELECT * FROM mod_story_themes WHERE active = 1 ORDER BY label LIMIT 1'
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      storyThemeKey: row.story_theme_key,
      label: row.label,
      narratorTemplate: row.narrator_template,
      tags: row.tags,
      active: row.active,
      llmModelKey: row.llm_model_key ?? null,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  async deactivateStoryTheme(id: string): Promise<void> {
    await this.query('UPDATE mod_story_themes SET active = 0, updated_at = NOW(3) WHERE id = $1', [id]);
  }

  async listVisualStyles(): Promise<ModVisualStyles[]> {
    const result = await this.query(`
      SELECT 
        id,
        category,
        visual_style_key,
        label,
        exemplified_by,
        modifiers_diffusion,
        modifiers_transformer,
        active,
        created_at,
        updated_at
      FROM mod_visual_styles 
      ORDER BY category, label
    `);
    return result.rows.map(row => ({
      id: row.id,
      category: row.category,
      visualStyleKey: row.visual_style_key,
      label: row.label,
      exemplifiedBy: row.exemplified_by,
      modifiersDiffusion: row.modifiers_diffusion,
      modifiersTransformer: row.modifiers_transformer,
      active: row.active,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }));
  }

  async getActiveVisualStyles(): Promise<ModVisualStyles[]> {
    const result = await this.query(`
      SELECT 
        id,
        category,
        visual_style_key,
        label,
        exemplified_by,
        modifiers_diffusion,
        modifiers_transformer,
        active,
        created_at,
        updated_at
      FROM mod_visual_styles 
      WHERE active = 1 
      ORDER BY category, label
    `);
    return result.rows.map(row => ({
      id: row.id,
      category: row.category,
      visualStyleKey: row.visual_style_key,
      label: row.label,
      exemplifiedBy: row.exemplified_by,
      modifiersDiffusion: row.modifiers_diffusion,
      modifiersTransformer: row.modifiers_transformer,
      active: row.active,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }));
  }

  async upsertVisualStyle(input: Partial<ModVisualStyles> & { id?: string }): Promise<ModVisualStyles> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (input.category !== undefined) {
      updateFields.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.visualStyleKey !== undefined) {
      updateFields.push(`visual_style_key = $${paramIndex++}`);
      values.push(input.visualStyleKey);
    }
    if (input.label !== undefined) {
      updateFields.push(`label = $${paramIndex++}`);
      values.push(input.label);
    }
    if (input.exemplifiedBy !== undefined) {
      updateFields.push(`exemplified_by = $${paramIndex++}`);
      values.push(input.exemplifiedBy);
    }
    if (input.modifiersDiffusion !== undefined) {
      updateFields.push(`modifiers_diffusion = $${paramIndex++}`);
      values.push(input.modifiersDiffusion);
    }
    if (input.modifiersTransformer !== undefined) {
      updateFields.push(`modifiers_transformer = $${paramIndex++}`);
      values.push(input.modifiersTransformer);
    }
    if (input.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(input.active);
    }
  
    if (input.id) {
      updateFields.push(`updated_at = NOW(3)`);
      values.push(input.id);
      const result = await this.query(
        `UPDATE mod_visual_styles SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );
      if (!result.rows[0]) {
        throw new Error(`Visual style ${input.id} not found`);
      }
      const row = result.rows[0];
      return {
        id: row.id,
        category: row.category,
        visualStyleKey: row.visual_style_key,
        label: row.label,
        exemplifiedBy: row.exemplified_by,
        modifiersDiffusion: row.modifiers_diffusion,
        modifiersTransformer: row.modifiers_transformer,
        active: row.active,
        rank: null,
        default: false,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      };
    }
  
    const required = ["category", "visualStyleKey", "label", "exemplifiedBy"] as const;
    for (const field of required) {
      if (!input[field]) {
        throw new Error(`Missing required field '${field}'`);
      }
    }
  
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO mod_visual_styles (id, category, visual_style_key, label, exemplified_by, modifiers_diffusion, modifiers_transformer, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        id,
        input.category!,
        input.visualStyleKey!,
        input.label!,
        input.exemplifiedBy!,
        input.modifiersDiffusion ?? null,
        input.modifiersTransformer ?? null,
        input.active ?? 1,
      ]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      visualStyleKey: row.visual_style_key,
      label: row.label,
      exemplifiedBy: row.exemplified_by,
      modifiersDiffusion: row.modifiers_diffusion,
      modifiersTransformer: row.modifiers_transformer,
      active: row.active,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  async getDefaultVisualStyle(): Promise<ModVisualStyles | null> {
    const result = await this.query(
      'SELECT * FROM mod_visual_styles WHERE active = 1 ORDER BY category, label LIMIT 1'
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      visualStyleKey: row.visual_style_key,
      label: row.label,
      exemplifiedBy: row.exemplified_by,
      modifiersDiffusion: row.modifiers_diffusion,
      modifiersTransformer: row.modifiers_transformer,
      active: row.active,
      rank: null,
      default: false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  async deactivateVisualStyle(id: string): Promise<void> {
    await this.query('UPDATE mod_visual_styles SET active = 0, updated_at = NOW(3) WHERE id = $1', [id]);
  }
}

/** The CatalogRepository methods the storage facade exposes. */
export interface ICatalogRepository extends Pick<CatalogRepository,
  | 'getActiveImageModels'
  | 'getImageModelByKey'
  | 'getDefaultImageModel'
  | 'listImageModels'
  | 'upsertImageModel'
  | 'deactivateImageModel'
  | 'reorderImageModels'
  | 'listLlmModels'
  | 'getActiveLlmModels'
  | 'getLlmModelByKey'
  | 'getDefaultLlmModel'
  | 'upsertLlmModel'
  | 'deactivateLlmModel'
  | 'recordLlmModelCheck'
  | 'listStoryThemes'
  | 'getActiveStoryThemes'
  | 'upsertStoryTheme'
  | 'getDefaultStoryTheme'
  | 'deactivateStoryTheme'
  | 'listVisualStyles'
  | 'getActiveVisualStyles'
  | 'upsertVisualStyle'
  | 'getDefaultVisualStyle'
  | 'deactivateVisualStyle'
> {}
