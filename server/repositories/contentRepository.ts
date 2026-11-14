import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';
import { randomUUID } from 'crypto';


export class ContentRepository extends BaseRepository {
  async getPromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    const result = await this.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    return this.mapPromptTemplate(result.rows[0]);
  }

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    const result = await this.query('SELECT * FROM prompt_templates ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapPromptTemplate(row)!);
  }

  async getActivePromptTemplates(): Promise<PromptTemplate[]> {
    const result = await this.query(
      'SELECT * FROM prompt_templates WHERE active = 1 ORDER BY updated_at DESC'
    );
    return result.rows.map(row => this.mapPromptTemplate(row)!);
  }

  async getActivePromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    const result = await this.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    const active = result.rows.find((t: any) => t.active === 1);
    return active ? this.mapPromptTemplate(active) : undefined;
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO prompt_templates (id, name, content, system_content, inherit_global_prompt, description, version, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        id,
        template.name,
        template.content,
        template.systemContent || null,
        template.inheritGlobalPrompt ?? 1,
        template.description || null,
        template.version ?? 1,
        template.active ?? 1,
      ]
    );
    return this.mapPromptTemplate(result.rows[0])!;
  }

  async updatePromptTemplate(id: string, updates: Partial<InsertPromptTemplate>): Promise<PromptTemplate> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.content !== undefined) {
      updateFields.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.systemContent !== undefined) {
      updateFields.push(`system_content = $${paramIndex++}`);
      values.push(updates.systemContent);
    }
    if (updates.inheritGlobalPrompt !== undefined) {
      updateFields.push(`inherit_global_prompt = $${paramIndex++}`);
      values.push(updates.inheritGlobalPrompt);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.version !== undefined) {
      updateFields.push(`version = $${paramIndex++}`);
      values.push(updates.version);
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE prompt_templates SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapPromptTemplate(result.rows[0])!;
  }

  async createLlmLog(log: InsertLlmLog): Promise<LlmLog> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO llm_logs (id, prompt_template_id, game_id, turn_number, function_name, prompt, response, metadata, execution_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        log.promptTemplateId || null,
        log.gameId || null,
        log.turnNumber || null,
        log.functionName,
        log.prompt,
        log.response,
        log.metadata ? JSON.stringify(log.metadata) : null,
        log.executionTimeMs || null,
      ]
    );
    return this.mapLlmLog(result.rows[0])!;
  }

  async getLlmLogs(filters?: { gameId?: string; limit?: number }): Promise<LlmLog[]> {
    const params: any[] = [];
    let paramIndex = 1;
    const conditions: string[] = [];
  
    if (filters?.gameId) {
      conditions.push(`game_id = $${paramIndex++}`);
      params.push(filters.gameId);
    }
  
    let query = 'SELECT * FROM llm_logs';
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY created_at DESC';
  
    if (typeof filters?.limit === 'number') {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
  
    const result = await this.query(query, params);
    return result.rows.map(row => this.mapLlmLog(row)!);
  }

  async clearAllLlmLogs(): Promise<void> {
    await this.query('DELETE FROM llm_logs');
  }

  async getAllEvents(): Promise<Event[]> {
    const result = await this.query('SELECT * FROM events ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapEvent(row)!);
  }

  async getActiveEvents(): Promise<Event[]> {
    const result = await this.query('SELECT * FROM events WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapEvent(row)!);
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO events (id, name, segment, skill, dc, trigger_condition, pass_effect, fail_effect, tags, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        event.name,
        event.segment,
        event.skill,
        event.dc,
        JSON.stringify(event.triggerCondition),
        event.passEffect,
        event.failEffect,
        JSON.stringify(event.tags),
        event.active ?? 1,
      ]
    );
    return this.mapEvent(result.rows[0])!;
  }

  async updateEvent(id: string, updates: Partial<InsertEvent>): Promise<Event> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.segment !== undefined) {
      updateFields.push(`segment = $${paramIndex++}`);
      values.push(updates.segment);
    }
    if (updates.skill !== undefined) {
      updateFields.push(`skill = $${paramIndex++}`);
      values.push(updates.skill);
    }
    if (updates.dc !== undefined) {
      updateFields.push(`dc = $${paramIndex++}`);
      values.push(updates.dc);
    }
    if (updates.triggerCondition !== undefined) {
      updateFields.push(`trigger_condition = $${paramIndex++}`);
      values.push(JSON.stringify(updates.triggerCondition));
    }
    if (updates.passEffect !== undefined) {
      updateFields.push(`pass_effect = $${paramIndex++}`);
      values.push(updates.passEffect);
    }
    if (updates.failEffect !== undefined) {
      updateFields.push(`fail_effect = $${paramIndex++}`);
      values.push(updates.failEffect);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE events SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapEvent(result.rows[0])!;
  }

  async getItems(): Promise<ItemRow[]> {
    const result = await this.query('SELECT * FROM items ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapItem(row)!);
  }

  async getActiveItems(): Promise<ItemRow[]> {
    const result = await this.query('SELECT * FROM items WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapItem(row)!);
  }

  async getItem(id: string): Promise<ItemRow | undefined> {
    const result = await this.query('SELECT * FROM items WHERE id = $1', [id]);
    return this.mapItem(result.rows[0]);
  }

  async createItem(item: InsertItem): Promise<ItemRow> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO items (id, name, description, icon, skill_bonus_skill, skill_bonus_value, scene_effect_tags, scene_effect_effect, efficiency, tags, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        id,
        item.name,
        item.description,
        item.icon,
        item.skillBonusSkill || null,
        item.skillBonusValue || null,
        item.sceneEffectTags ? JSON.stringify(item.sceneEffectTags) : null,
        item.sceneEffectEffect || null,
        item.efficiency ? JSON.stringify(item.efficiency) : null,
        JSON.stringify(item.tags),
        item.active ?? 1,
      ]
    );
    return this.mapItem(result.rows[0])!;
  }

  async updateItem(id: string, updates: Partial<InsertItem>): Promise<ItemRow> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.icon !== undefined) {
      updateFields.push(`icon = $${paramIndex++}`);
      values.push(updates.icon);
    }
    if (updates.skillBonusSkill !== undefined) {
      updateFields.push(`skill_bonus_skill = $${paramIndex++}`);
      values.push(updates.skillBonusSkill);
    }
    if (updates.skillBonusValue !== undefined) {
      updateFields.push(`skill_bonus_value = $${paramIndex++}`);
      values.push(updates.skillBonusValue);
    }
    if (updates.sceneEffectTags !== undefined) {
      updateFields.push(`scene_effect_tags = $${paramIndex++}`);
      values.push(updates.sceneEffectTags ? JSON.stringify(updates.sceneEffectTags) : null);
    }
    if (updates.sceneEffectEffect !== undefined) {
      updateFields.push(`scene_effect_effect = $${paramIndex++}`);
      values.push(updates.sceneEffectEffect);
    }
    if (updates.efficiency !== undefined) {
      updateFields.push(`efficiency = $${paramIndex++}`);
      values.push(updates.efficiency ? JSON.stringify(updates.efficiency) : null);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE items SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapItem(result.rows[0])!;
  }

  async getNpcTemplates(): Promise<NpcTemplate[]> {
    const result = await this.query('SELECT * FROM npc_templates ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapNpcTemplate(row)!);
  }

  async getActiveNpcTemplates(): Promise<NpcTemplate[]> {
    const result = await this.query('SELECT * FROM npc_templates WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapNpcTemplate(row)!);
  }

  async createNpcTemplate(npc: InsertNpcTemplate): Promise<NpcTemplate> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO npc_templates (id, name, role, bio, starting_affinity, tags, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        npc.name,
        npc.role,
        npc.bio || null,
        npc.startingAffinity ?? 0,
        JSON.stringify(npc.tags),
        npc.active ?? 1,
      ]
    );
    return this.mapNpcTemplate(result.rows[0])!;
  }

  async updateNpcTemplate(id: string, updates: Partial<InsertNpcTemplate>): Promise<NpcTemplate> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.role !== undefined) {
      updateFields.push(`role = $${paramIndex++}`);
      values.push(updates.role);
    }
    if (updates.bio !== undefined) {
      updateFields.push(`bio = $${paramIndex++}`);
      values.push(updates.bio);
    }
    if (updates.startingAffinity !== undefined) {
      updateFields.push(`starting_affinity = $${paramIndex++}`);
      values.push(updates.startingAffinity);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE npc_templates SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapNpcTemplate(result.rows[0])!;
  }

  async getImagePrompts(): Promise<ImagePrompt[]> {
    const result = await this.query('SELECT * FROM image_prompts ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapImagePrompt(row)!);
  }

  async getActiveImagePrompts(): Promise<ImagePrompt[]> {
    const result = await this.query('SELECT * FROM image_prompts WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapImagePrompt(row)!);
  }

  async createImagePrompt(prompt: InsertImagePrompt): Promise<ImagePrompt> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO image_prompts (id, name, prompt_template, inherit_visual_style, size, quality, description, scene_types, tags, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        prompt.name,
        prompt.promptTemplate,
        prompt.inheritVisualStyle ?? 1,
        prompt.size ?? '1024x1024',
        prompt.quality ?? 'auto',
        prompt.description || null,
        JSON.stringify(prompt.sceneTypes),
        JSON.stringify(prompt.tags),
        prompt.active ?? 1,
      ]
    );
    return this.mapImagePrompt(result.rows[0])!;
  }

  async updateImagePrompt(id: string, updates: Partial<InsertImagePrompt>): Promise<ImagePrompt> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.promptTemplate !== undefined) {
      updateFields.push(`prompt_template = $${paramIndex++}`);
      values.push(updates.promptTemplate);
    }
    if (updates.inheritVisualStyle !== undefined) {
      updateFields.push(`inherit_visual_style = $${paramIndex++}`);
      values.push(updates.inheritVisualStyle);
    }
    if (updates.size !== undefined) {
      updateFields.push(`size = $${paramIndex++}`);
      values.push(updates.size);
    }
    if (updates.quality !== undefined) {
      updateFields.push(`quality = $${paramIndex++}`);
      values.push(updates.quality);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.sceneTypes !== undefined) {
      updateFields.push(`scene_types = $${paramIndex++}`);
      values.push(JSON.stringify(updates.sceneTypes));
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE image_prompts SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapImagePrompt(result.rows[0])!;
  }

  async getInterviewQuestions(): Promise<InterviewQuestion[]> {
    const result = await this.query('SELECT * FROM interview_questions ORDER BY display_order');
    return result.rows.map(row => this.mapInterviewQuestion(row)!);
  }

  async getActiveInterviewQuestions(): Promise<InterviewQuestion[]> {
    const result = await this.query('SELECT * FROM interview_questions WHERE active = 1 ORDER BY display_order');
    return result.rows.map(row => this.mapInterviewQuestion(row)!);
  }

  async createInterviewQuestion(question: InsertInterviewQuestion): Promise<InterviewQuestion> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO interview_questions (id, question, variable_name, description, display_order, tags, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        question.question,
        question.variableName,
        question.description || null,
        question.displayOrder ?? 0,
        JSON.stringify(question.tags),
        question.active ?? 1,
      ]
    );
    return this.mapInterviewQuestion(result.rows[0])!;
  }

  async updateInterviewQuestion(id: string, updates: Partial<InsertInterviewQuestion>): Promise<InterviewQuestion> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.question !== undefined) {
      updateFields.push(`question = $${paramIndex++}`);
      values.push(updates.question);
    }
    if (updates.variableName !== undefined) {
      updateFields.push(`variable_name = $${paramIndex++}`);
      values.push(updates.variableName);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.displayOrder !== undefined) {
      updateFields.push(`display_order = $${paramIndex++}`);
      values.push(updates.displayOrder);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.active !== undefined) {
      updateFields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
  
    updateFields.push(`updated_at = NOW(3)`);
    values.push(id);
  
    const result = await this.query(
      `UPDATE interview_questions SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapInterviewQuestion(result.rows[0])!;
  }
}
