import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { createLimiter, pool, poolLimit, withTransaction, type DbClient } from "./db";

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
import { isUniqueViolation as isUniqueViolationError } from "./db/errors";
import { randomUUID } from "crypto";
import { dbOperationDuration } from "./metrics";
import { getContentTableSpec } from "./reference/contentTables";
import { JobService } from "./orchestrator/jobService";
const DISABLE_ORCHESTRATOR_ENQUEUE =
  process.env.DISABLE_ORCHESTRATOR_ENQUEUE === 'true' || process.env.NODE_ENV === 'test';

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  searchUsersByUsername(pattern: string, limit?: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  ensureUser(username: string): Promise<User>;
  getUserPreferences(username: string): Promise<UserPreferences>;
  updateUserPreferences(username: string, preferences: UserPreferences): Promise<User>;

  // Game state methods
  getGameState(id: string): Promise<GameState | undefined>;
  getGamesByUsername(username: string): Promise<GameState[]>;
  getGameSummariesByUsername(username: string): Promise<GameSummary[]>;
  getGameSummariesByUsernames(usernames: string[]): Promise<GameSummary[]>;
  createGameState(state: GameState): Promise<GameState>;
  deleteGameState(id: string): Promise<void>;

  // Prompt template methods
  getPromptTemplate(name: string): Promise<PromptTemplate | undefined>;
  getAllPromptTemplates(): Promise<PromptTemplate[]>;
  getActivePromptTemplates(): Promise<PromptTemplate[]>;
  getActivePromptTemplate(name: string): Promise<PromptTemplate | undefined>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: Partial<InsertPromptTemplate>): Promise<PromptTemplate>;

  // LLM log methods
  createLlmLog(log: InsertLlmLog): Promise<LlmLog>;
  getLlmLogs(filters?: { gameId?: string; limit?: number }): Promise<LlmLog[]>;
  clearAllLlmLogs(): Promise<void>;

  // Event methods
  getAllEvents(): Promise<Event[]>;
  getActiveEvents(): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: string, event: Partial<InsertEvent>): Promise<Event>;

  // Item methods
  getItems(): Promise<ItemRow[]>;
  getActiveItems(): Promise<ItemRow[]>;
  getItem(id: string): Promise<ItemRow | undefined>;
  createItem(item: InsertItem): Promise<ItemRow>;
  updateItem(id: string, item: Partial<InsertItem>): Promise<ItemRow>;

  // NPC template methods
  getNpcTemplates(): Promise<NpcTemplate[]>;
  getActiveNpcTemplates(): Promise<NpcTemplate[]>;
  createNpcTemplate(npc: InsertNpcTemplate): Promise<NpcTemplate>;
  updateNpcTemplate(id: string, npc: Partial<InsertNpcTemplate>): Promise<NpcTemplate>;

  // Image prompt methods
  getImagePrompts(): Promise<ImagePrompt[]>;
  getActiveImagePrompts(): Promise<ImagePrompt[]>;
  createImagePrompt(prompt: InsertImagePrompt): Promise<ImagePrompt>;
  updateImagePrompt(id: string, prompt: Partial<InsertImagePrompt>): Promise<ImagePrompt>;

  // Interview question methods
  getInterviewQuestions(): Promise<InterviewQuestion[]>;
  getActiveInterviewQuestions(): Promise<InterviewQuestion[]>;
  createInterviewQuestion(question: InsertInterviewQuestion): Promise<InterviewQuestion>;
  updateInterviewQuestion(id: string, question: Partial<InsertInterviewQuestion>): Promise<InterviewQuestion>;

  // Generated image cache methods
  createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage>;
  getGeneratedImage(id: string): Promise<GeneratedImage | undefined>;
  getGeneratedImageByHash(promptHash: string, variablesHash: string): Promise<GeneratedImage | undefined>;
  getGeneratedImagesByTemplate(templateName: string): Promise<GeneratedImage[]>;
  getAllGeneratedImages(): Promise<GeneratedImage[]>;
  updateImageAccess(id: string): Promise<void>;
  deleteGeneratedImage(id: string): Promise<void>;
  deleteGeneratedImages(filters?: { templateName?: string; gameId?: string; before?: Date; maxAccessCount?: number }): Promise<number>;
  getImageCacheStats(): Promise<{ totalImages: number; totalSize: number; hitRate: number; averageGenerationTime: number }>;

  // Reference release methods
  createReferenceRelease(release: InsertReferenceRelease): Promise<ReferenceRelease>;
  getReferenceRelease(version: string): Promise<ReferenceRelease | undefined>;
  getCurrentReferenceRelease(): Promise<ReferenceRelease | undefined>;
  getAllReferenceReleases(): Promise<ReferenceRelease[]>;
  updateReferenceRelease(version: string, updates: Partial<InsertReferenceRelease>): Promise<ReferenceRelease>;
  setCurrentReferenceRelease(version: string): Promise<void>;
  /** Every row of a content table (active and inactive) as raw database rows, ordered by primary key. */
  dumpContentTable(table: string): Promise<Record<string, unknown>[]>;

  // Transaction methods
  processTurnWithTransaction(
    gameId: string,
    processor: (state: GameState, client: DbClient) => Promise<GameState>
  ): Promise<GameState>;

  // Image job methods
  createImageJob(job: InsertImageJob, traceId?: string, requestId?: string, client?: DbClient): Promise<ImageJob>;
  getImageJob(id: string): Promise<ImageJob | undefined>;
  updateImageJob(id: string, updates: Partial<InsertImageJob>): Promise<ImageJob>;
  countPendingJobs(): Promise<{ turnJobs: number; imageJobs: number }>;

  // Turn job methods
  createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string, client?: DbClient): Promise<TurnJob>;
  getTurnJob(id: string): Promise<TurnJob | undefined>;
  updateTurnJob(id: string, updates: Partial<InsertTurnJob>): Promise<TurnJob>;

  // Settings
  getAllSettings(): Promise<AppSetting[]>;
  getActiveSettings(): Promise<AppSetting[]>;
  getSetting(key: string): Promise<AppSetting | undefined>;
  upsertSetting(key: string, value: string, description?: string, active?: number): Promise<AppSetting>;

  // Image model catalog
  getActiveImageModels(): Promise<ImageModel[]>;
  getImageModelByKey(modelKey: string): Promise<ImageModel | null>;
  getDefaultImageModel(): Promise<ImageModel | null>;
  listImageModels(): Promise<ImageModel[]>;
  upsertImageModel(model: Partial<ImageModel> & { modelKey: string }): Promise<ImageModel>;
  deactivateImageModel(modelKey: string): Promise<void>;
  reorderImageModels(order: { modelKey: string; sortOrder: number }[]): Promise<void>;
  // Story (LLM) model catalog
  listLlmModels(): Promise<LlmModel[]>;
  getActiveLlmModels(): Promise<LlmModel[]>;
  getLlmModelByKey(modelKey: string): Promise<LlmModel | null>;
  getDefaultLlmModel(): Promise<LlmModel | null>;
  upsertLlmModel(model: Partial<LlmModel> & { modelKey: string }): Promise<LlmModel>;
  deactivateLlmModel(modelKey: string): Promise<void>;
  recordLlmModelCheck(modelKey: string, ok: boolean | null, summary: Record<string, unknown>): Promise<void>;
  // PCE catalog tables
  listStoryThemes(): Promise<ModStoryThemes[]>;
  getActiveStoryThemes(): Promise<ModStoryThemes[]>;
  getDefaultStoryTheme(): Promise<ModStoryThemes | null>;
  upsertStoryTheme(input: Partial<ModStoryThemes> & { id?: string }): Promise<ModStoryThemes>;
  deactivateStoryTheme(id: string): Promise<void>;
  listVisualStyles(): Promise<ModVisualStyles[]>;
  getActiveVisualStyles(): Promise<ModVisualStyles[]>;
  getDefaultVisualStyle(): Promise<ModVisualStyles | null>;
  upsertVisualStyle(input: Partial<ModVisualStyles> & { id?: string }): Promise<ModVisualStyles>;
  deactivateVisualStyle(id: string): Promise<void>;

  // PCE Inspector - Test Scenarios
  getPceTestScenarios(filters?: {
    tags?: string;
    preset?: boolean;
    limit?: number;
  }): Promise<PceTestScenario[]>;
  getPceTestScenario(id: string): Promise<PceTestScenario | null>;
  createPceTestScenario(
    scenario: Omit<PceTestScenario, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PceTestScenario>;
  updatePceTestScenario(
    id: string,
    updates: Partial<PceTestScenario>
  ): Promise<PceTestScenario>;
  deletePceTestScenario(id: string): Promise<void>;

  // PCE Inspector - Test Runs
  getPceTestRuns(filters?: {
    limit?: number;
    scenarioId?: string;
    tags?: string;
    status?: string;
    starred?: boolean;
  }): Promise<PceTestRun[]>;
  getPceTestRun(id: string): Promise<PceTestRun | null>;
  createPceTestRun(
    run: Omit<PceTestRun, 'id' | 'executedAt'>
  ): Promise<PceTestRun>;
  updatePceTestRun(
    id: string,
    updates: Partial<PceTestRun>
  ): Promise<PceTestRun>;
  deletePceTestRun(id: string): Promise<void>;

  // PCE Inspector - Test Metrics
  getPceTestMetrics(testRunId: string): Promise<PceTestMetrics | null>;

  // PCE Inspector - Template Versions
  getPceTemplateVersions(promptId: string): Promise<PceTemplateVersion[]>;
}

/** Turn transactions may hold at most half the pool; the other half serves the queries they make. */
const turnTransactionSlots = createLimiter(Math.max(1, Math.floor(poolLimit() / 2)));

export class DatabaseStorage implements IStorage {
  private readonly jobService = new JobService();

  constructor() {}

  private mapUser(row: any): User | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      password: row.password,
      theme: row.theme,
      style: row.style,
      imageModelKey: row.image_model_key ?? row.imageModelKey ?? null,
      llmModelKey: row.llm_model_key ?? row.llmModelKey ?? null,
      skipImageCache: row.skip_image_cache ?? null,
      typewriterEnabled: row.typewriter_enabled ?? null,
    };
  }

  private mapGameRow(row: any): GameState | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      seed: row.seed,
      day: row.day,
      turnNumber: row.turn_number,
      segment: row.segment as Segment,
      absurdity: row.absurdity,
      stats: row.stats as GameStats,
      npcs: row.npcs as NPC[],
      equippedItems: row.equipped_items as string[],
      turns: row.turns as Turn[],
      currentActions: row.current_actions as ActionChip[],
      runningGags: row.running_gags as string[],
      eventHistory: row.event_history as string[],
      interviewResponses: (row.interview_responses as Record<string, string>) || {},
      isComplete: Number(row.is_complete) === 1,
      failureReason: row.failure_reason || undefined,
    };
  }

  // Helper methods to map snake_case DB rows to camelCase TypeScript interfaces
  private mapPromptTemplate(row: any): PromptTemplate | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      systemContent: row.system_content,
      inheritGlobalPrompt: row.inherit_global_prompt,
      description: row.description,
      version: row.version,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEvent(row: any): Event | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      segment: row.segment,
      skill: row.skill,
      dc: row.dc,
      triggerCondition: typeof row.trigger_condition === 'string' ? JSON.parse(row.trigger_condition) : row.trigger_condition,
      passEffect: row.pass_effect,
      failEffect: row.fail_effect,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapItem(row: any): ItemRow | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      skillBonusSkill: row.skill_bonus_skill,
      skillBonusValue: row.skill_bonus_value,
      sceneEffectTags: typeof row.scene_effect_tags === 'string' ? JSON.parse(row.scene_effect_tags) : row.scene_effect_tags,
      sceneEffectEffect: row.scene_effect_effect,
      efficiency: typeof row.efficiency === 'string' ? JSON.parse(row.efficiency) : row.efficiency,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNpcTemplate(row: any): NpcTemplate | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      bio: row.bio,
      startingAffinity: row.starting_affinity,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapImagePrompt(row: any): ImagePrompt | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      promptTemplate: row.prompt_template,
      inheritVisualStyle: row.inherit_visual_style,
      size: row.size,
      quality: row.quality,
      description: row.description,
      sceneTypes: typeof row.scene_types === 'string' ? JSON.parse(row.scene_types) : row.scene_types,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapInterviewQuestion(row: any): InterviewQuestion | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      question: row.question,
      variableName: row.variable_name,
      description: row.description,
      displayOrder: row.display_order,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapGeneratedImage(row: any): GeneratedImage | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      templateName: row.template_name,
      promptHash: row.prompt_hash,
      variablesHash: row.variables_hash,
      filePath: row.file_path,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      sceneFingerprint: typeof row.scene_fingerprint === 'string' ? JSON.parse(row.scene_fingerprint) : row.scene_fingerprint,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      promptSource: row.prompt_source,
      promptText: row.prompt_text,
    };
  }

  private mapReferenceRelease(row: any): ReferenceRelease | undefined {
    if (!row) return undefined;
    // Note: ReferenceRelease schema uses snake_case for some fields
    return {
      version: row.version,
      published_by: row.published_by,
      notes: row.notes,
      published_at: row.published_at,
      is_current: row.is_current,
    };
  }

  private mapLlmLog(row: any): LlmLog | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      promptTemplateId: row.prompt_template_id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      functionName: row.function_name,
      prompt: row.prompt,
      response: row.response,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
    };
  }

  private mapImageJob(row: any): ImageJob | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      templateName: row.template_name,
      status: row.status,
      imageUrl: row.image_url,
      imageTemplate: row.image_template,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  private mapTurnJob(row: any): TurnJob | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      gameId: row.game_id,
      actionPayload: typeof row.action_payload === 'string' ? JSON.parse(row.action_payload) : row.action_payload,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  private mapPceTestScenario(row: any): PceTestScenario | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      gameStateJson: row.game_state_json,
      playerAction: row.player_action,
      checksJson: row.checks_json ?? undefined,
      triggeredEventJson: row.triggered_event_json ?? undefined,
      theme: row.theme ?? undefined,
      style: row.style ?? undefined,
      imageModelKey: row.image_model_key ?? undefined,
      tags: row.tags ?? undefined,
      isPreset: row.is_preset === 1 || row.is_preset === true,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPceTestRun(row: any): PceTestRun | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      scenarioId: row.scenario_id,
      releaseVersion: row.release_version ?? undefined,
      templateMasterId: row.template_master_id ?? undefined,
      templateNarrativeId: row.template_narrative_id ?? undefined,
      templateImageId: row.template_image_id ?? undefined,
      templateActionsId: row.template_actions_id ?? undefined,
      status: row.status,
      stageResultsJson: row.stage_results_json,
      executedAt: row.executed_at,
      durationMs: row.duration_ms ?? undefined,
      totalTokensPrompt: row.total_tokens_prompt ?? undefined,
      totalTokensResponse: row.total_tokens_response ?? undefined,
      estimatedCostUsd: row.estimated_cost_usd ?? undefined,
      notes: row.notes ?? undefined,
      tags: row.tags ?? undefined,
      starred: row.starred === 1 || row.starred === true,
    };
  }

  private mapPceTestMetrics(row: any): PceTestMetrics | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      testRunId: row.test_run_id,
      overallScore: row.overall_score,
      coherenceScore: row.coherence_score ?? undefined,
      thematicScore: row.thematic_score ?? undefined,
      varietyScore: row.variety_score ?? undefined,
      technicalScore: row.technical_score ?? undefined,
      playerImpactScore: row.player_impact_score ?? undefined,
      coherenceAnalysisJson: row.coherence_analysis_json ?? undefined,
      thematicAnalysisJson: row.thematic_analysis_json ?? undefined,
      varietyAnalysisJson: row.variety_analysis_json ?? undefined,
      technicalAnalysisJson: row.technical_analysis_json ?? undefined,
      playerImpactAnalysisJson: row.player_impact_analysis_json ?? undefined,
      computedAt: row.computed_at,
      computationDurationMs: row.computation_duration_ms ?? undefined,
    };
  }

  private mapPceTemplateVersion(row: any): PceTemplateVersion | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      promptId: row.prompt_id,
      versionNumber: row.version_number,
      releaseVersion: row.release_version ?? undefined,
      systemContent: row.system_content ?? undefined,
      content: row.content ?? undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      notes: row.notes ?? undefined,
    };
  }

  async getUser(id: string): Promise<User | undefined> {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return this.mapUser(result.rows[0]);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return this.mapUser(result.rows[0]);
  }

  async searchUsersByUsername(pattern: string, limit: number = 20): Promise<User[]> {
    const escapedPattern = pattern.replace(/[\\%_]/g, '\\$&');
    const searchPattern = `${escapedPattern}%`;
    const cappedLimit = Math.min(limit, 50);
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE username = $${paramIndex} RETURNING *`,
      values
    );

    if (!result.rows[0]) {
      throw new Error(`Failed to update preferences for user ${username}`);
    }

    const updatedRow = result.rows[0];
    return this.mapUser(updatedRow)!;
  }

  async getGameState(id: string): Promise<GameState | undefined> {
    const timer = dbOperationDuration.startTimer({ operation: 'query', table: 'games' });
    try {
      const result = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
      timer();
      return this.mapGameRow(result.rows[0]);
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getGamesByUsername(username: string): Promise<GameState[]> {
    const result = await pool.query(
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
    const result = await pool.query(
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
    await pool.query(
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
    await pool.query('DELETE FROM games WHERE id = $1', [id]);
  }

  async getPromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    const result = await pool.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    return this.mapPromptTemplate(result.rows[0]);
  }

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    const result = await pool.query('SELECT * FROM prompt_templates ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapPromptTemplate(row)!);
  }

  async getActivePromptTemplates(): Promise<PromptTemplate[]> {
    const result = await pool.query(
      'SELECT * FROM prompt_templates WHERE active = 1 ORDER BY updated_at DESC'
    );
    return result.rows.map(row => this.mapPromptTemplate(row)!);
  }

  async getActivePromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    const result = await pool.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    const active = result.rows.find((t: any) => t.active === 1);
    return active ? this.mapPromptTemplate(active) : undefined;
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE prompt_templates SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapPromptTemplate(result.rows[0])!;
  }

  async createLlmLog(log: InsertLlmLog): Promise<LlmLog> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(query, params);
    return result.rows.map(row => this.mapLlmLog(row)!);
  }

  async clearAllLlmLogs(): Promise<void> {
    await pool.query('DELETE FROM llm_logs');
  }

  async getAllEvents(): Promise<Event[]> {
    const result = await pool.query('SELECT * FROM events ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapEvent(row)!);
  }

  async getActiveEvents(): Promise<Event[]> {
    const result = await pool.query('SELECT * FROM events WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapEvent(row)!);
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE events SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapEvent(result.rows[0])!;
  }

  async getItems(): Promise<ItemRow[]> {
    const result = await pool.query('SELECT * FROM items ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapItem(row)!);
  }

  async getActiveItems(): Promise<ItemRow[]> {
    const result = await pool.query('SELECT * FROM items WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapItem(row)!);
  }

  async getItem(id: string): Promise<ItemRow | undefined> {
    const result = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    return this.mapItem(result.rows[0]);
  }

  async createItem(item: InsertItem): Promise<ItemRow> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE items SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapItem(result.rows[0])!;
  }

  async getNpcTemplates(): Promise<NpcTemplate[]> {
    const result = await pool.query('SELECT * FROM npc_templates ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapNpcTemplate(row)!);
  }

  async getActiveNpcTemplates(): Promise<NpcTemplate[]> {
    const result = await pool.query('SELECT * FROM npc_templates WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapNpcTemplate(row)!);
  }

  async createNpcTemplate(npc: InsertNpcTemplate): Promise<NpcTemplate> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE npc_templates SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapNpcTemplate(result.rows[0])!;
  }

  async getImagePrompts(): Promise<ImagePrompt[]> {
    const result = await pool.query('SELECT * FROM image_prompts ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapImagePrompt(row)!);
  }

  async getActiveImagePrompts(): Promise<ImagePrompt[]> {
    const result = await pool.query('SELECT * FROM image_prompts WHERE active = 1 ORDER BY updated_at DESC');
    return result.rows.map(row => this.mapImagePrompt(row)!);
  }

  async createImagePrompt(prompt: InsertImagePrompt): Promise<ImagePrompt> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE image_prompts SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapImagePrompt(result.rows[0])!;
  }

  // Interview question methods
  async getInterviewQuestions(): Promise<InterviewQuestion[]> {
    const result = await pool.query('SELECT * FROM interview_questions ORDER BY display_order');
    return result.rows.map(row => this.mapInterviewQuestion(row)!);
  }

  async getActiveInterviewQuestions(): Promise<InterviewQuestion[]> {
    const result = await pool.query('SELECT * FROM interview_questions WHERE active = 1 ORDER BY display_order');
    return result.rows.map(row => this.mapInterviewQuestion(row)!);
  }

  async createInterviewQuestion(question: InsertInterviewQuestion): Promise<InterviewQuestion> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
      `UPDATE interview_questions SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapInterviewQuestion(result.rows[0])!;
  }

  // Generated image cache methods
  async createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage> {
    const id = randomUUID();
    const result = await pool.query(
      `INSERT INTO generated_images (id, template_name, prompt_hash, variables_hash, file_path, file_size, mime_type, scene_fingerprint, metadata, game_id, turn_number, accessed_at, access_count, prompt_source, prompt_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        id,
        image.templateName,
        image.promptHash,
        image.variablesHash,
        image.filePath,
        image.fileSize,
        image.mimeType ?? 'image/png',
        JSON.stringify(image.sceneFingerprint),
        JSON.stringify(image.metadata),
        image.gameId || null,
        image.turnNumber || null,
        image.accessedAt || new Date(),
        image.accessCount ?? 1,
        image.promptSource ?? 'template',
        image.promptText || null,
      ]
    );
    return this.mapGeneratedImage(result.rows[0])!;
  }

  async getGeneratedImage(id: string): Promise<GeneratedImage | undefined> {
    const result = await pool.query('SELECT * FROM generated_images WHERE id = $1', [id]);
    return this.mapGeneratedImage(result.rows[0]);
  }

  async getGeneratedImageByHash(promptHash: string, variablesHash: string): Promise<GeneratedImage | undefined> {
    const result = await pool.query(
      'SELECT * FROM generated_images WHERE prompt_hash = $1 AND variables_hash = $2',
      [promptHash, variablesHash]
    );
    return this.mapGeneratedImage(result.rows[0]);
  }

  async getGeneratedImagesByTemplate(templateName: string): Promise<GeneratedImage[]> {
    const result = await pool.query(
      'SELECT * FROM generated_images WHERE template_name = $1 ORDER BY created_at DESC',
      [templateName]
    );
    return result.rows.map(row => this.mapGeneratedImage(row)!);
  }

  async getAllGeneratedImages(): Promise<GeneratedImage[]> {
    const result = await pool.query('SELECT * FROM generated_images ORDER BY created_at DESC');
    return result.rows.map(row => this.mapGeneratedImage(row)!);
  }

  async updateImageAccess(id: string): Promise<void> {
    await pool.query(
      'UPDATE generated_images SET accessed_at = NOW(3), access_count = access_count + 1 WHERE id = $1',
      [id]
    );
  }

  async deleteGeneratedImage(id: string): Promise<void> {
    await pool.query('DELETE FROM generated_images WHERE id = $1', [id]);
  }

  async deleteGeneratedImages(filters?: { templateName?: string; gameId?: string; before?: Date; maxAccessCount?: number }): Promise<number> {
    let query = 'DELETE FROM generated_images';
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.templateName) {
      conditions.push(`template_name = $${paramIndex++}`);
      params.push(filters.templateName);
    }
    if (filters?.gameId) {
      conditions.push(`game_id = $${paramIndex++}`);
      params.push(filters.gameId);
    }
    if (filters?.before) {
      conditions.push(`created_at < $${paramIndex++}`);
      params.push(filters.before);
    }
    if (filters?.maxAccessCount !== undefined) {
      conditions.push(`access_count <= $${paramIndex++}`);
      params.push(filters.maxAccessCount);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' RETURNING id';
    const result = await pool.query(query, params);
    return result.rows.length;
  }

  async getImageCacheStats(): Promise<{ totalImages: number; totalSize: number; hitRate: number; averageGenerationTime: number }> {
    const [imageStats, generationStats] = await Promise.all([
      pool.query(
        'SELECT COUNT(*) AS totalImages, COALESCE(SUM(file_size), 0) AS totalSize FROM generated_images',
      ),
      pool.query(
        `SELECT COUNT(*) AS totalRequests,
                COALESCE(SUM(CASE
                  WHEN JSON_TYPE(JSON_EXTRACT(metadata, '$.cacheHit')) = 'BOOLEAN'
                   AND JSON_VALUE(metadata, '$.cacheHit') = 1 THEN 1
                  ELSE 0
                END), 0) AS cacheHits,
                AVG(execution_time_ms) AS averageGenerationTime
         FROM llm_logs
         WHERE function_name = 'generateImage'`,
      ),
    ]);

    const { totalImages, totalSize } = imageStats.rows[0];
    const { totalRequests, cacheHits, averageGenerationTime } = generationStats.rows[0];

    return {
      totalImages: Number(totalImages),
      totalSize: Number(totalSize),
      hitRate: Number(totalRequests) > 0 ? Number(cacheHits) / Number(totalRequests) : 0,
      averageGenerationTime: Number(averageGenerationTime ?? 0),
    };
  }

  // Reference release methods
  async createReferenceRelease(release: InsertReferenceRelease): Promise<ReferenceRelease> {
    const result = await pool.query(
      `INSERT INTO reference_releases (version, published_by, notes, is_current)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        release.version,
        release.published_by,
        release.notes || null,
        release.is_current ?? 0,
      ]
    );
    return this.mapReferenceRelease(result.rows[0])!;
  }

  async getReferenceRelease(version: string): Promise<ReferenceRelease | undefined> {
    const result = await pool.query('SELECT * FROM reference_releases WHERE version = $1', [version]);
    return this.mapReferenceRelease(result.rows[0]);
  }

  async getCurrentReferenceRelease(): Promise<ReferenceRelease | undefined> {
    const result = await pool.query('SELECT * FROM reference_releases WHERE is_current = 1');
    return this.mapReferenceRelease(result.rows[0]);
  }

  async getAllReferenceReleases(): Promise<ReferenceRelease[]> {
    const result = await pool.query('SELECT * FROM reference_releases ORDER BY published_at DESC');
    return result.rows.map(row => this.mapReferenceRelease(row)!);
  }

  async updateReferenceRelease(version: string, updates: Partial<InsertReferenceRelease>): Promise<ReferenceRelease> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.published_by !== undefined) {
      updateFields.push(`published_by = $${paramIndex++}`);
      values.push(updates.published_by);
    }
    if (updates.notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      values.push(updates.notes);
    }
    if (updates.is_current !== undefined) {
      updateFields.push(`is_current = $${paramIndex++}`);
      values.push(updates.is_current);
    }

    if (updateFields.length === 0) {
      const existing = await this.getReferenceRelease(version);
      if (!existing) throw new Error(`Reference release ${version} not found`);
      return existing;
    }

    values.push(version);
    const result = await pool.query(
      `UPDATE reference_releases SET ${updateFields.join(', ')} WHERE version = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapReferenceRelease(result.rows[0])!;
  }

  async setCurrentReferenceRelease(version: string): Promise<void> {
    await withTransaction(async client => {
      const existing = await client.query('SELECT version FROM reference_releases WHERE version = $1 FOR UPDATE', [version]);
      if (!existing.rows[0]) {
        throw new Error(`Reference release ${version} not found`);
      }

      await client.query('UPDATE reference_releases SET is_current = 0 WHERE is_current = 1');
      await client.query('UPDATE reference_releases SET is_current = 1 WHERE version = $1', [version]);
    });
  }

  async dumpContentTable(table: string): Promise<Record<string, unknown>[]> {
    // The table name is interpolated, so it must come from the fixed list.
    const spec = getContentTableSpec(table);
    const result = await pool.query(`SELECT * FROM ${spec.table}`);
    // Sorted here, not in SQL, so the order is the same on every database and collation.
    const key = (row: Record<string, unknown>) => String(row[spec.primaryKey]);
    return [...result.rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
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
    const client = await pool.connect();
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

  // Image job methods
  async createImageJob(job: InsertImageJob, traceId?: string, requestId?: string, client?: DbClient): Promise<ImageJob> {
    const row = await this.jobService.createImageJob(job, {
      traceId,
      requestId,
      enqueue: !DISABLE_ORCHESTRATOR_ENQUEUE,
      client,
    });
    return this.mapImageJob(row)!;
  }

  async getImageJob(id: string): Promise<ImageJob | undefined> {
    const result = await pool.query('SELECT * FROM image_jobs WHERE id = $1', [id]);
    return this.mapImageJob(result.rows[0]);
  }

  async countPendingJobs(): Promise<{ turnJobs: number; imageJobs: number }> {
    const [turnJobs, imageJobs] = await Promise.all([
      pool.query("SELECT COUNT(*) AS count FROM turn_jobs WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) AS count FROM image_jobs WHERE status = 'pending'"),
    ]);

    return {
      turnJobs: Number(turnJobs.rows[0]?.count ?? 0),
      imageJobs: Number(imageJobs.rows[0]?.count ?? 0),
    };
  }

  async updateImageJob(id: string, updates: Partial<InsertImageJob>): Promise<ImageJob> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.gameId !== undefined) {
      updateFields.push(`game_id = $${paramIndex++}`);
      values.push(updates.gameId);
    }
    if (updates.turnNumber !== undefined) {
      updateFields.push(`turn_number = $${paramIndex++}`);
      values.push(updates.turnNumber);
    }
    if (updates.templateName !== undefined) {
      updateFields.push(`template_name = $${paramIndex++}`);
      values.push(updates.templateName);
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.imageUrl !== undefined) {
      updateFields.push(`image_url = $${paramIndex++}`);
      values.push(updates.imageUrl);
    }
    if (updates.imageTemplate !== undefined) {
      updateFields.push(`image_template = $${paramIndex++}`);
      values.push(updates.imageTemplate);
    }
    if (updates.error !== undefined) {
      updateFields.push(`error = $${paramIndex++}`);
      values.push(updates.error);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }

    if (updateFields.length === 0) {
      const existing = await this.getImageJob(id);
      if (!existing) throw new Error(`Image job ${id} not found`);
      return existing;
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE image_jobs SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapImageJob(result.rows[0])!;
  }

  // Turn job methods
  async createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string, client?: DbClient): Promise<TurnJob> {
    const row = await this.jobService.createTurnJob(job, {
      traceId,
      requestId,
      enqueue: !DISABLE_ORCHESTRATOR_ENQUEUE,
      client,
    });
    return this.mapTurnJob(row)!;
  }

  async getTurnJob(id: string): Promise<TurnJob | undefined> {
    const result = await pool.query('SELECT * FROM turn_jobs WHERE id = $1', [id]);
    return this.mapTurnJob(result.rows[0]);
  }

  async updateTurnJob(id: string, updates: Partial<InsertTurnJob>): Promise<TurnJob> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.gameId !== undefined) {
      updateFields.push(`game_id = $${paramIndex++}`);
      values.push(updates.gameId);
    }
    if (updates.actionPayload !== undefined) {
      updateFields.push(`action_payload = $${paramIndex++}`);
      values.push(JSON.stringify(updates.actionPayload));
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.error !== undefined) {
      updateFields.push(`error = $${paramIndex++}`);
      values.push(updates.error);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }

    if (updateFields.length === 0) {
      const existing = await this.getTurnJob(id);
      if (!existing) throw new Error(`Turn job ${id} not found`);
      return existing;
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE turn_jobs SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    return this.mapTurnJob(result.rows[0])!;
  }

  async getAllSettings(): Promise<AppSetting[]> {
    const result = await pool.query('SELECT * FROM app_settings');
    return result.rows;
  }

  async getActiveSettings(): Promise<AppSetting[]> {
    const result = await pool.query('SELECT * FROM app_settings WHERE active = 1');
    return result.rows;
  }

  async getSetting(key: string): Promise<AppSetting | undefined> {
    const result = await pool.query('SELECT * FROM app_settings WHERE `key` = $1', [key]);
    return result.rows[0] || undefined;
  }

  async upsertSetting(key: string, value: string, description?: string, active: number = 1): Promise<AppSetting> {
    const existing = await this.getSetting(key);
    if (existing) {
      const result = await pool.query(
        `UPDATE app_settings SET value = $1, description = $2, active = $3, updated_at = NOW(3)
         WHERE \`key\` = $4 RETURNING *`,
        [value, description ?? existing.description ?? null, active, key]
      );
      return result.rows[0];
    } else {
      const result = await pool.query(
        `INSERT INTO app_settings (\`key\`, value, description, active)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [key, value, description ?? null, active]
      );
      return result.rows[0];
    }
  }

  // Image model catalog
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
    const result = await pool.query(
      'SELECT * FROM image_models WHERE active = 1 ORDER BY sort_order, model_key'
    );
    return result.rows.map((r: any) => this.mapImageModelRow(r));
  }

  async getImageModelByKey(modelKey: string): Promise<ImageModel | null> {
    const result = await pool.query('SELECT * FROM image_models WHERE model_key = $1 LIMIT 1', [modelKey]);
    return result.rows[0] ? this.mapImageModelRow(result.rows[0]) : null;
  }

  async getDefaultImageModel(): Promise<ImageModel | null> {
    const result = await pool.query(
      'SELECT * FROM image_models WHERE active = 1 AND is_default = true ORDER BY sort_order, model_key LIMIT 1'
    );
    return result.rows[0] ? this.mapImageModelRow(result.rows[0]) : null;
  }

  async listImageModels(): Promise<ImageModel[]> {
    const result = await pool.query('SELECT * FROM image_models ORDER BY sort_order, model_key');
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

    const client = await pool.connect();
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
    await pool.query('UPDATE image_models SET active = 0, updated_at = NOW(3) WHERE model_key = $1', [modelKey]);
  }

  async reorderImageModels(order: { modelKey: string; sortOrder: number }[]): Promise<void> {
    for (const row of order) {
      await pool.query('UPDATE image_models SET sort_order = $1, updated_at = NOW(3) WHERE model_key = $2', [row.sortOrder, row.modelKey]);
    }
  }

  // Story (LLM) model catalog
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
    const result = await pool.query('SELECT * FROM llm_models ORDER BY sort_order, model_key');
    return result.rows.map((r: any) => this.mapLlmModelRow(r));
  }

  async getActiveLlmModels(): Promise<LlmModel[]> {
    const result = await pool.query('SELECT * FROM llm_models WHERE active = 1 ORDER BY sort_order, model_key');
    return result.rows.map((r: any) => this.mapLlmModelRow(r));
  }

  async getLlmModelByKey(modelKey: string): Promise<LlmModel | null> {
    const result = await pool.query('SELECT * FROM llm_models WHERE model_key = $1 LIMIT 1', [modelKey]);
    return result.rows[0] ? this.mapLlmModelRow(result.rows[0]) : null;
  }

  async getDefaultLlmModel(): Promise<LlmModel | null> {
    const result = await pool.query(
      'SELECT * FROM llm_models WHERE active = 1 AND is_default = true ORDER BY sort_order, model_key LIMIT 1'
    );
    return result.rows[0] ? this.mapLlmModelRow(result.rows[0]) : null;
  }

  /**
   * Create or update a catalog row. Setting isDefault clears the flag on every other row
   * in the same transaction, so there is never more than one default.
   */
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

    const client = await pool.connect();
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
    await pool.query(
      'UPDATE llm_models SET active = 0, is_default = FALSE, updated_at = NOW(3) WHERE model_key = $1',
      [modelKey]
    );
  }

  /**
   * Merge a result into last_check_summary. Pass ok = true/false for a health check
   * (updates last_check_ok and last_check_at); pass null to store extra data, such as a
   * qualification result, without changing the health status.
   */
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

  // Story theme modifiers CRUD
  async listStoryThemes(): Promise<ModStoryThemes[]> {
    const result = await pool.query(`
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
    const result = await pool.query(`
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
      const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    await pool.query('UPDATE mod_story_themes SET active = 0, updated_at = NOW(3) WHERE id = $1', [id]);
  }

  // Visual style modifiers CRUD
  async listVisualStyles(): Promise<ModVisualStyles[]> {
    const result = await pool.query(`
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
    const result = await pool.query(`
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
      const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
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
    await pool.query('UPDATE mod_visual_styles SET active = 0, updated_at = NOW(3) WHERE id = $1', [id]);
  }

  // ============================================
  // PCE Inspector Methods
  // ============================================

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

    const result = await pool.query(query, params);
    return result.rows.map(row => this.mapPceTestScenario(row)!);
  }

  async getPceTestScenario(id: string): Promise<PceTestScenario | null> {
    const result = await pool.query('SELECT * FROM pce_test_scenarios WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? this.mapPceTestScenario(row)! : null;
  }

  async createPceTestScenario(scenario: Omit<PceTestScenario, 'id' | 'createdAt' | 'updatedAt'>): Promise<PceTestScenario> {
    const id = randomUUID();
    const result = await pool.query(
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

    const result = await pool.query(
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
    await pool.query('DELETE FROM pce_test_scenarios WHERE id = $1', [id]);
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

    const result = await pool.query(query, params);
    return result.rows.map(row => this.mapPceTestRun(row)!);
  }

  async getPceTestRun(id: string): Promise<PceTestRun | null> {
    const result = await pool.query('SELECT * FROM pce_test_runs WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? this.mapPceTestRun(row)! : null;
  }

  async createPceTestRun(run: Omit<PceTestRun, 'id' | 'executedAt'>): Promise<PceTestRun> {
    const id = randomUUID();
    const result = await pool.query(
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
    const result = await pool.query(
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
    await pool.query('DELETE FROM pce_test_runs WHERE id = $1', [id]);
  }

  async getPceTestMetrics(testRunId: string): Promise<PceTestMetrics | null> {
    const result = await pool.query('SELECT * FROM pce_test_metrics WHERE test_run_id = $1 LIMIT 1', [testRunId]);
    const row = result.rows[0];
    return row ? this.mapPceTestMetrics(row)! : null;
  }

  async getPceTemplateVersions(promptId: string): Promise<PceTemplateVersion[]> {
    const result = await pool.query(
      'SELECT * FROM pce_template_versions WHERE prompt_id = $1 ORDER BY version_number DESC',
      [promptId]
    );
    return result.rows.map(row => this.mapPceTemplateVersion(row)!);
  }

  // Manifest storage methods
  async getTurnExecutionManifest(
    gameId: string,
    turnNumber: number,
    attempt?: number
  ): Promise<import('@shared/schema').TurnExecutionManifests | undefined> {
    let query = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 AND turn_number = $2';
    const params: any[] = [gameId, turnNumber];
    
    if (attempt !== undefined) {
      query += ' AND attempt = $3';
      params.push(attempt);
    } else {
      query += ' ORDER BY attempt DESC LIMIT 1';
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
      id: row.id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      queueEntryId: row.queue_entry_id,
      attempt: row.attempt,
      version: row.version,
      manifest: row.manifest,
      manifestHash: row.manifest_hash,
      precomputeHash: row.precompute_hash,
      traceId: row.trace_id,
      requestId: row.request_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getGameManifests(
    gameId: string,
    limit?: number
  ): Promise<import('@shared/schema').TurnExecutionManifests[]> {
    let query = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 ORDER BY turn_number DESC, attempt DESC';
    const params: any[] = [gameId];
    
    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await pool.query(query, params);
    
    // Deduplicate: for each turn number, keep only the latest attempt
    const seen = new Set<number>();
    const manifests: import('@shared/schema').TurnExecutionManifests[] = [];
    
    for (const row of result.rows) {
      const turnNumber = row.turn_number;
      if (!seen.has(turnNumber)) {
        seen.add(turnNumber);
        manifests.push({
          id: row.id,
          gameId: row.game_id,
          turnNumber: row.turn_number,
          queueEntryId: row.queue_entry_id,
          attempt: row.attempt,
          version: row.version,
          manifest: row.manifest,
          manifestHash: row.manifest_hash,
          precomputeHash: row.precompute_hash,
          traceId: row.trace_id,
          requestId: row.request_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
    }
    
    // Sort by turn number ascending
    return manifests.sort((a, b) => a.turnNumber - b.turnNumber);
  }

}

export const storage = new DatabaseStorage();
