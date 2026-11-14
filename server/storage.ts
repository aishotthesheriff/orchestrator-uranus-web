import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import type { DbClient } from './db';
import type { UserPreferences } from './repositories/userRepository';
export type { UserPreferences } from './repositories/userRepository';
import { createRepositories, type Repositories } from './repositories';

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

export class DatabaseStorage implements IStorage {
  readonly repos: Repositories = createRepositories();

  async getUser(id: string): Promise<User | undefined> {
    return this.repos.users.getUser(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.repos.users.getUserByUsername(username);
  }

  async searchUsersByUsername(pattern: string, limit: number = 20): Promise<User[]> {
    return this.repos.users.searchUsersByUsername(pattern, limit);
  }

  async ensureUser(username: string): Promise<User> {
    return this.repos.users.ensureUser(username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.repos.users.createUser(insertUser);
  }

  async getUserPreferences(username: string): Promise<UserPreferences> {
    return this.repos.users.getUserPreferences(username);
  }

  async updateUserPreferences(username: string, preferences: UserPreferences): Promise<User> {
    return this.repos.users.updateUserPreferences(username, preferences);
  }

  async getGameState(id: string): Promise<GameState | undefined> {
    return this.repos.games.getGameState(id);
  }

  async getGamesByUsername(username: string): Promise<GameState[]> {
    return this.repos.games.getGamesByUsername(username);
  }

  async getGameSummariesByUsername(username: string): Promise<GameSummary[]> {
    return this.repos.games.getGameSummariesByUsername(username);
  }

  async getGameSummariesByUsernames(usernames: string[]): Promise<GameSummary[]> {
    return this.repos.games.getGameSummariesByUsernames(usernames);
  }

  async createGameState(state: GameState): Promise<GameState> {
    return this.repos.games.createGameState(state);
  }

  async deleteGameState(id: string): Promise<void> {
    return this.repos.games.deleteGameState(id);
  }

  async processTurnWithTransaction(
      gameId: string,
      processor: (state: GameState, client: DbClient) => Promise<GameState>
    ): Promise<GameState> {
    return this.repos.games.processTurnWithTransaction(gameId, processor);
  }

  async getPromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    return this.repos.promptTemplates.getByName(name);
  }

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    return this.repos.promptTemplates.list();
  }

  async getActivePromptTemplates(): Promise<PromptTemplate[]> {
    return this.repos.promptTemplates.listActive();
  }

  async getActivePromptTemplate(name: string): Promise<PromptTemplate | undefined> {
    return this.repos.promptTemplates.getActiveByName(name);
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    return this.repos.promptTemplates.create(template);
  }

  async updatePromptTemplate(id: string, updates: Partial<InsertPromptTemplate>): Promise<PromptTemplate> {
    return this.repos.promptTemplates.update(id, updates);
  }

  async createLlmLog(log: InsertLlmLog): Promise<LlmLog> {
    return this.repos.llmLogs.createLlmLog(log);
  }

  async getLlmLogs(filters?: { gameId?: string; limit?: number }): Promise<LlmLog[]> {
    return this.repos.llmLogs.getLlmLogs(filters);
  }

  async clearAllLlmLogs(): Promise<void> {
    return this.repos.llmLogs.clearAllLlmLogs();
  }

  async getAllEvents(): Promise<Event[]> {
    return this.repos.events.list();
  }

  async getActiveEvents(): Promise<Event[]> {
    return this.repos.events.listActive();
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    return this.repos.events.create(event);
  }

  async updateEvent(id: string, updates: Partial<InsertEvent>): Promise<Event> {
    return this.repos.events.update(id, updates);
  }

  async getItems(): Promise<ItemRow[]> {
    return this.repos.items.list();
  }

  async getActiveItems(): Promise<ItemRow[]> {
    return this.repos.items.listActive();
  }

  async getItem(id: string): Promise<ItemRow | undefined> {
    return this.repos.items.getById(id);
  }

  async createItem(item: InsertItem): Promise<ItemRow> {
    return this.repos.items.create(item);
  }

  async updateItem(id: string, updates: Partial<InsertItem>): Promise<ItemRow> {
    return this.repos.items.update(id, updates);
  }

  async getNpcTemplates(): Promise<NpcTemplate[]> {
    return this.repos.npcTemplates.list();
  }

  async getActiveNpcTemplates(): Promise<NpcTemplate[]> {
    return this.repos.npcTemplates.listActive();
  }

  async createNpcTemplate(npc: InsertNpcTemplate): Promise<NpcTemplate> {
    return this.repos.npcTemplates.create(npc);
  }

  async updateNpcTemplate(id: string, updates: Partial<InsertNpcTemplate>): Promise<NpcTemplate> {
    return this.repos.npcTemplates.update(id, updates);
  }

  async getImagePrompts(): Promise<ImagePrompt[]> {
    return this.repos.imagePrompts.list();
  }

  async getActiveImagePrompts(): Promise<ImagePrompt[]> {
    return this.repos.imagePrompts.listActive();
  }

  async createImagePrompt(prompt: InsertImagePrompt): Promise<ImagePrompt> {
    return this.repos.imagePrompts.create(prompt);
  }

  async updateImagePrompt(id: string, updates: Partial<InsertImagePrompt>): Promise<ImagePrompt> {
    return this.repos.imagePrompts.update(id, updates);
  }

  async getInterviewQuestions(): Promise<InterviewQuestion[]> {
    return this.repos.interviewQuestions.list();
  }

  async getActiveInterviewQuestions(): Promise<InterviewQuestion[]> {
    return this.repos.interviewQuestions.listActive();
  }

  async createInterviewQuestion(question: InsertInterviewQuestion): Promise<InterviewQuestion> {
    return this.repos.interviewQuestions.create(question);
  }

  async updateInterviewQuestion(id: string, updates: Partial<InsertInterviewQuestion>): Promise<InterviewQuestion> {
    return this.repos.interviewQuestions.update(id, updates);
  }

  async createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage> {
    return this.repos.imageCache.createGeneratedImage(image);
  }

  async getGeneratedImage(id: string): Promise<GeneratedImage | undefined> {
    return this.repos.imageCache.getGeneratedImage(id);
  }

  async getGeneratedImageByHash(promptHash: string, variablesHash: string): Promise<GeneratedImage | undefined> {
    return this.repos.imageCache.getGeneratedImageByHash(promptHash, variablesHash);
  }

  async getGeneratedImagesByTemplate(templateName: string): Promise<GeneratedImage[]> {
    return this.repos.imageCache.getGeneratedImagesByTemplate(templateName);
  }

  async getAllGeneratedImages(): Promise<GeneratedImage[]> {
    return this.repos.imageCache.getAllGeneratedImages();
  }

  async updateImageAccess(id: string): Promise<void> {
    return this.repos.imageCache.updateImageAccess(id);
  }

  async deleteGeneratedImage(id: string): Promise<void> {
    return this.repos.imageCache.deleteGeneratedImage(id);
  }

  async deleteGeneratedImages(filters?: { templateName?: string; gameId?: string; before?: Date; maxAccessCount?: number }): Promise<number> {
    return this.repos.imageCache.deleteGeneratedImages(filters);
  }

  async getImageCacheStats(): Promise<{ totalImages: number; totalSize: number; hitRate: number; averageGenerationTime: number }> {
    return this.repos.imageCache.getImageCacheStats();
  }

  async createReferenceRelease(release: InsertReferenceRelease): Promise<ReferenceRelease> {
    return this.repos.reference.createReferenceRelease(release);
  }

  async getReferenceRelease(version: string): Promise<ReferenceRelease | undefined> {
    return this.repos.reference.getReferenceRelease(version);
  }

  async getCurrentReferenceRelease(): Promise<ReferenceRelease | undefined> {
    return this.repos.reference.getCurrentReferenceRelease();
  }

  async getAllReferenceReleases(): Promise<ReferenceRelease[]> {
    return this.repos.reference.getAllReferenceReleases();
  }

  async updateReferenceRelease(version: string, updates: Partial<InsertReferenceRelease>): Promise<ReferenceRelease> {
    return this.repos.reference.updateReferenceRelease(version, updates);
  }

  async setCurrentReferenceRelease(version: string): Promise<void> {
    return this.repos.reference.setCurrentReferenceRelease(version);
  }

  async dumpContentTable(table: string): Promise<Record<string, unknown>[]> {
    return this.repos.reference.dumpContentTable(table);
  }

  async createImageJob(job: InsertImageJob, traceId?: string, requestId?: string, client?: DbClient): Promise<ImageJob> {
    return this.repos.jobs.createImageJob(job, traceId, requestId, client);
  }

  async getImageJob(id: string): Promise<ImageJob | undefined> {
    return this.repos.jobs.getImageJob(id);
  }

  async countPendingJobs(): Promise<{ turnJobs: number; imageJobs: number }> {
    return this.repos.jobs.countPendingJobs();
  }

  async updateImageJob(id: string, updates: Partial<InsertImageJob>): Promise<ImageJob> {
    return this.repos.jobs.updateImageJob(id, updates);
  }

  async createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string, client?: DbClient): Promise<TurnJob> {
    return this.repos.jobs.createTurnJob(job, traceId, requestId, client);
  }

  async getTurnJob(id: string): Promise<TurnJob | undefined> {
    return this.repos.jobs.getTurnJob(id);
  }

  async updateTurnJob(id: string, updates: Partial<InsertTurnJob>): Promise<TurnJob> {
    return this.repos.jobs.updateTurnJob(id, updates);
  }

  async getAllSettings(): Promise<AppSetting[]> {
    return this.repos.settings.getAllSettings();
  }

  async getActiveSettings(): Promise<AppSetting[]> {
    return this.repos.settings.getActiveSettings();
  }

  async getSetting(key: string): Promise<AppSetting | undefined> {
    return this.repos.settings.getSetting(key);
  }

  async upsertSetting(key: string, value: string, description?: string, active: number = 1): Promise<AppSetting> {
    return this.repos.settings.upsertSetting(key, value, description, active);
  }

  async getActiveImageModels(): Promise<ImageModel[]> {
    return this.repos.catalog.getActiveImageModels();
  }

  async getImageModelByKey(modelKey: string): Promise<ImageModel | null> {
    return this.repos.catalog.getImageModelByKey(modelKey);
  }

  async getDefaultImageModel(): Promise<ImageModel | null> {
    return this.repos.catalog.getDefaultImageModel();
  }

  async listImageModels(): Promise<ImageModel[]> {
    return this.repos.catalog.listImageModels();
  }

  async upsertImageModel(input: Partial<ImageModel> & { modelKey: string }): Promise<ImageModel> {
    return this.repos.catalog.upsertImageModel(input);
  }

  async deactivateImageModel(modelKey: string): Promise<void> {
    return this.repos.catalog.deactivateImageModel(modelKey);
  }

  async reorderImageModels(order: { modelKey: string; sortOrder: number }[]): Promise<void> {
    return this.repos.catalog.reorderImageModels(order);
  }

  async listLlmModels(): Promise<LlmModel[]> {
    return this.repos.catalog.listLlmModels();
  }

  async getActiveLlmModels(): Promise<LlmModel[]> {
    return this.repos.catalog.getActiveLlmModels();
  }

  async getLlmModelByKey(modelKey: string): Promise<LlmModel | null> {
    return this.repos.catalog.getLlmModelByKey(modelKey);
  }

  async getDefaultLlmModel(): Promise<LlmModel | null> {
    return this.repos.catalog.getDefaultLlmModel();
  }

  async upsertLlmModel(input: Partial<LlmModel> & { modelKey: string }): Promise<LlmModel> {
    return this.repos.catalog.upsertLlmModel(input);
  }

  async deactivateLlmModel(modelKey: string): Promise<void> {
    return this.repos.catalog.deactivateLlmModel(modelKey);
  }

  async recordLlmModelCheck(modelKey: string, ok: boolean | null, summary: Record<string, unknown>): Promise<void> {
    return this.repos.catalog.recordLlmModelCheck(modelKey, ok, summary);
  }

  async listStoryThemes(): Promise<ModStoryThemes[]> {
    return this.repos.catalog.listStoryThemes();
  }

  async getActiveStoryThemes(): Promise<ModStoryThemes[]> {
    return this.repos.catalog.getActiveStoryThemes();
  }

  async upsertStoryTheme(input: Partial<ModStoryThemes> & { id?: string }): Promise<ModStoryThemes> {
    return this.repos.catalog.upsertStoryTheme(input);
  }

  async getDefaultStoryTheme(): Promise<ModStoryThemes | null> {
    return this.repos.catalog.getDefaultStoryTheme();
  }

  async deactivateStoryTheme(id: string): Promise<void> {
    return this.repos.catalog.deactivateStoryTheme(id);
  }

  async listVisualStyles(): Promise<ModVisualStyles[]> {
    return this.repos.catalog.listVisualStyles();
  }

  async getActiveVisualStyles(): Promise<ModVisualStyles[]> {
    return this.repos.catalog.getActiveVisualStyles();
  }

  async upsertVisualStyle(input: Partial<ModVisualStyles> & { id?: string }): Promise<ModVisualStyles> {
    return this.repos.catalog.upsertVisualStyle(input);
  }

  async getDefaultVisualStyle(): Promise<ModVisualStyles | null> {
    return this.repos.catalog.getDefaultVisualStyle();
  }

  async deactivateVisualStyle(id: string): Promise<void> {
    return this.repos.catalog.deactivateVisualStyle(id);
  }

  async getPceTestScenarios(filters?: { tags?: string; preset?: boolean; limit?: number }): Promise<PceTestScenario[]> {
    return this.repos.pce.getPceTestScenarios(filters);
  }

  async getPceTestScenario(id: string): Promise<PceTestScenario | null> {
    return this.repos.pce.getPceTestScenario(id);
  }

  async createPceTestScenario(scenario: Omit<PceTestScenario, 'id' | 'createdAt' | 'updatedAt'>): Promise<PceTestScenario> {
    return this.repos.pce.createPceTestScenario(scenario);
  }

  async updatePceTestScenario(id: string, updates: Partial<PceTestScenario>): Promise<PceTestScenario> {
    return this.repos.pce.updatePceTestScenario(id, updates);
  }

  async deletePceTestScenario(id: string): Promise<void> {
    return this.repos.pce.deletePceTestScenario(id);
  }

  async getPceTestRuns(filters?: { limit?: number; scenarioId?: string; tags?: string; status?: string; starred?: boolean }): Promise<PceTestRun[]> {
    return this.repos.pce.getPceTestRuns(filters);
  }

  async getPceTestRun(id: string): Promise<PceTestRun | null> {
    return this.repos.pce.getPceTestRun(id);
  }

  async createPceTestRun(run: Omit<PceTestRun, 'id' | 'executedAt'>): Promise<PceTestRun> {
    return this.repos.pce.createPceTestRun(run);
  }

  async updatePceTestRun(id: string, updates: Partial<PceTestRun>): Promise<PceTestRun> {
    return this.repos.pce.updatePceTestRun(id, updates);
  }

  async deletePceTestRun(id: string): Promise<void> {
    return this.repos.pce.deletePceTestRun(id);
  }

  async getPceTestMetrics(testRunId: string): Promise<PceTestMetrics | null> {
    return this.repos.pce.getPceTestMetrics(testRunId);
  }

  async getPceTemplateVersions(promptId: string): Promise<PceTemplateVersion[]> {
    return this.repos.pce.getPceTemplateVersions(promptId);
  }

  async getTurnExecutionManifest(
      gameId: string,
      turnNumber: number,
      attempt?: number
    ): Promise<import('@shared/schema').TurnExecutionManifests | undefined> {
    return this.repos.manifests.getTurnExecutionManifest(gameId, turnNumber, attempt);
  }

  async getGameManifests(
      gameId: string,
      limit?: number
    ): Promise<import('@shared/schema').TurnExecutionManifests[]> {
    return this.repos.manifests.getGameManifests(gameId, limit);
  }
}

export const storage = new DatabaseStorage();
