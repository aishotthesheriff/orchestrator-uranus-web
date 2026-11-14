import { z } from "zod";

// Database table type definitions (MariaDB; the schema itself is server/db/schema/)
export interface AppSettings {
  key: string;
  value: string;
  description: string | null;
  active: number;
  updatedAt: Date;
}

export const insertAppSettingsSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string().nullable().optional(),
  active: z.number().optional().default(1),
});

export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;

export interface Events {
  id: string;
  name: string;
  segment: string;
  skill: string;
  dc: number;
  triggerCondition: any;
  passEffect: string;
  failEffect: string;
  tags: any;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertEventsSchema = z.object({
  name: z.string(),
  segment: z.string(),
  skill: z.string(),
  dc: z.number(),
  triggerCondition: z.any(),
  passEffect: z.string(),
  failEffect: z.string(),
  tags: z.any(),
  active: z.number().optional().default(1),
});

export type InsertEvents = z.infer<typeof insertEventsSchema>;

export interface Games {
  id: string;
  username: string;
  seed: string;
  day: number;
  turnNumber: number;
  segment: string;
  absurdity: number;
  stats: any;
  npcs: any;
  equippedItems: any;
  turns: any;
  currentActions: any;
  runningGags: any;
  eventHistory: any;
  interviewResponses: any;
  isComplete: number;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const insertGamesSchema = z.object({
  username: z.string(),
  seed: z.string(),
  day: z.number().optional().default(1),
  turnNumber: z.number().optional().default(0),
  segment: z.string().optional().default('Launch from Earth'),
  absurdity: z.number().optional().default(2),
  stats: z.any(),
  npcs: z.any(),
  equippedItems: z.any(),
  turns: z.any(),
  currentActions: z.any(),
  runningGags: z.any(),
  eventHistory: z.any(),
  interviewResponses: z.any().optional().default({}),
  isComplete: z.number().optional().default(0),
  failureReason: z.string().nullable().optional(),
});

export type InsertGames = z.infer<typeof insertGamesSchema>;

export interface GeneratedImages {
  id: string;
  templateName: string;
  promptHash: string;
  variablesHash: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  sceneFingerprint: any;
  metadata: any;
  gameId: string | null;
  turnNumber: number | null;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  promptSource: string;
  promptText: string | null;
}

export const insertGeneratedImagesSchema = z.object({
  templateName: z.string(),
  promptHash: z.string(),
  variablesHash: z.string(),
  filePath: z.string(),
  fileSize: z.number(),
  mimeType: z.string().optional().default('image/png'),
  sceneFingerprint: z.any(),
  metadata: z.any(),
  gameId: z.string().nullable().optional(),
  turnNumber: z.number().nullable().optional(),
  accessedAt: z.date().optional(),
  accessCount: z.number().optional().default(1),
  promptSource: z.string().optional().default('template'),
  promptText: z.string().nullable().optional(),
});

export type InsertGeneratedImages = z.infer<typeof insertGeneratedImagesSchema>;

export interface ImageJobs {
  id: string;
  gameId: string;
  turnNumber: number;
  templateName: string;
  status: string;
  imageUrl: string | null;
  imageTemplate: string | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export const insertImageJobsSchema = z.object({
  gameId: z.string(),
  turnNumber: z.number(),
  templateName: z.string(),
  status: z.string().optional().default('pending'),
  imageUrl: z.string().nullable().optional(),
  imageTemplate: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  completedAt: z.date().nullable().optional(),
});

export type InsertImageJobs = z.infer<typeof insertImageJobsSchema>;

export interface ImageModels {
  id: string;
  modelKey: string;
  provider: string;
  modelName: string;
  hfProvider: string | null;
  active: number;
  displayName: string;
  description: string | null;
  sortOrder: number;
  defaultSize: string | null;
  defaultQuality: string | null;
  defaultBackground: string | null;
  defaultModeration: string | null;
  allowedSizes: any | null;
  capabilities: any | null;
  providerParams: any | null;
  isDefault: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  triggerWords: string | null;
  class: string | null;
}

export const insertImageModelsSchema = z.object({
  modelKey: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().optional().default(0),
  defaultSize: z.string().nullable().optional(),
  defaultQuality: z.string().nullable().optional(),
  defaultBackground: z.string().nullable().optional(),
  defaultModeration: z.string().nullable().optional(),
  allowedSizes: z.any().nullable().optional(),
  capabilities: z.any().nullable().optional(),
  isDefault: z.boolean().optional().default(false),
  triggerWords: z.string().nullable().optional(),
  class: z.string().nullable().optional(),
});

export type InsertImageModels = z.infer<typeof insertImageModelsSchema>;

/** Story (text) model catalog entry. Mirrors ImageModels; see server/llm/models.ts. */
export interface LlmModels {
  id: string;
  modelKey: string;
  provider: string; // 'openai' | 'huggingface'
  modelName: string;
  hfProvider: string | null;
  active: number;
  isDefault: boolean;
  displayName: string;
  description: string | null; // shown to players
  notes: string | null; // admin-only
  sortOrder: number;
  adult: boolean;
  supportsJsonMode: boolean;
  contextLength: number | null;
  priceInput: number | null; // USD per 1M input tokens
  priceOutput: number | null; // USD per 1M output tokens
  params: { maxTokens?: number; temperature?: number } | null;
  /** Model to use when this one fails a stage. Null: the default model. */
  fallbackModelKey: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckSummary: Record<string, unknown> | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const llmModelInputSchema = z.object({
  modelKey: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore"),
  provider: z.enum(["openai", "huggingface"]),
  modelName: z.string().trim().min(1).max(200),
  hfProvider: z.string().trim().max(80).nullable().optional(),
  active: z.number().int().min(0).max(1).optional(),
  isDefault: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  adult: z.boolean().optional(),
  supportsJsonMode: z.boolean().optional(),
  contextLength: z.number().int().positive().nullable().optional(),
  priceInput: z.number().min(0).nullable().optional(),
  priceOutput: z.number().min(0).nullable().optional(),
  params: z.object({
    maxTokens: z.number().int().min(1).max(32000).optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).nullable().optional(),
  fallbackModelKey: z.string().trim().max(80).nullable().optional(),
});

export type LlmModelInput = z.infer<typeof llmModelInputSchema>;

export interface ImagePrompts {
  id: string;
  name: string;
  promptTemplate: string;
  inheritVisualStyle: number;
  size: string;
  quality: string;
  description: string | null;
  sceneTypes: any;
  tags: any;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertImagePromptsSchema = z.object({
  name: z.string(),
  promptTemplate: z.string(),
  inheritVisualStyle: z.number().optional().default(1),
  size: z.string().optional().default('1024x1024'),
  quality: z.string().optional().default('auto'),
  description: z.string().nullable().optional(),
  sceneTypes: z.any(),
  tags: z.any(),
  active: z.number().optional().default(1),
});

export type InsertImagePrompts = z.infer<typeof insertImagePromptsSchema>;

export interface InterviewQuestions {
  id: string;
  question: string;
  variableName: string;
  description: string | null;
  displayOrder: number;
  tags: any;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertInterviewQuestionsSchema = z.object({
  question: z.string(),
  variableName: z.string(),
  description: z.string().nullable().optional(),
  displayOrder: z.number().optional().default(0),
  tags: z.any(),
  active: z.number().optional().default(1),
});

export type InsertInterviewQuestions = z.infer<typeof insertInterviewQuestionsSchema>;

export interface Items {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillBonusSkill: string | null;
  skillBonusValue: number | null;
  sceneEffectTags: any | null;
  sceneEffectEffect: string | null;
  efficiency: any | null;
  tags: any;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertItemsSchema = z.object({
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  skillBonusSkill: z.string().nullable().optional(),
  skillBonusValue: z.number().nullable().optional(),
  sceneEffectTags: z.any().nullable().optional(),
  sceneEffectEffect: z.string().nullable().optional(),
  efficiency: z.any().nullable().optional(),
  tags: z.any(),
  active: z.number().optional().default(1),
});

export type InsertItems = z.infer<typeof insertItemsSchema>;

export interface LlmLogs {
  id: string;
  promptTemplateId: string | null;
  gameId: string | null;
  turnNumber: number | null;
  functionName: string;
  prompt: string;
  response: string;
  metadata: any | null;
  executionTimeMs: number | null;
  createdAt: Date;
}

export const insertLlmLogsSchema = z.object({
  promptTemplateId: z.string().nullable().optional(),
  gameId: z.string().nullable().optional(),
  turnNumber: z.number().nullable().optional(),
  functionName: z.string(),
  prompt: z.string(),
  response: z.string(),
  metadata: z.any().nullable().optional(),
  executionTimeMs: z.number().nullable().optional(),
});

export type InsertLlmLogs = z.infer<typeof insertLlmLogsSchema>;

export interface ModStoryThemes {
  id: string;
  storyThemeKey: string;
  label: string;
  narratorTemplate: string;
  tags: string;
  active: number;
  rank: number | null;
  default: boolean;
  /** When set, this theme forces the story model (overrides the player's choice). */
  llmModelKey?: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const insertModStoryThemesSchema = z.object({
  storyThemeKey: z.string(),
  label: z.string(),
  narratorTemplate: z.string(),
  tags: z.string(),
  active: z.number().optional().default(1),
  rank: z.number().int().nullable().optional(),
  default: z.boolean().optional().default(false),
  llmModelKey: z.string().nullable().optional(),
});

export type InsertModStoryThemes = z.infer<typeof insertModStoryThemesSchema>;

export interface ModVisualStyles {
  id: string;
  category: string;
  visualStyleKey: string;
  label: string;
  exemplifiedBy: string;
  modifiersDiffusion: string | null;
  modifiersTransformer: string | null;
  active: number;
  rank: number | null;
  default: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const insertModVisualStylesSchema = z.object({
  category: z.string(),
  visualStyleKey: z.string(),
  label: z.string(),
  exemplifiedBy: z.string(),
  modifiersDiffusion: z.string().nullable().optional(),
  modifiersTransformer: z.string().nullable().optional(),
  active: z.number().optional().default(1),
  rank: z.number().int().nullable().optional(),
  default: z.boolean().optional().default(false),
});

export type InsertModVisualStyles = z.infer<typeof insertModVisualStylesSchema>;

export interface NpcTemplates {
  id: string;
  name: string;
  role: string;
  bio: string | null;
  startingAffinity: number;
  tags: any;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertNpcTemplatesSchema = z.object({
  name: z.string(),
  role: z.string(),
  bio: z.string().nullable().optional(),
  startingAffinity: z.number().optional().default(0),
  tags: z.any(),
  active: z.number().optional().default(1),
});

export type InsertNpcTemplates = z.infer<typeof insertNpcTemplatesSchema>;

export interface PromptTemplates {
  id: string;
  name: string;
  content: string;
  systemContent: string | null;
  inheritGlobalPrompt: number;
  description: string | null;
  version: number;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}

export const insertPromptTemplatesSchema = z.object({
  name: z.string(),
  content: z.string(),
  systemContent: z.string().nullable().optional(),
  inheritGlobalPrompt: z.number().optional().default(1),
  description: z.string().nullable().optional(),
  version: z.number().optional().default(1),
  active: z.number().optional().default(1),
});

export type InsertPromptTemplates = z.infer<typeof insertPromptTemplatesSchema>;

export interface ReferenceReleases {
  version: string;
  published_by: string;
  notes: string | null;
  published_at: Date;
  is_current: number;
}

export const insertReferenceReleasesSchema = z.object({
  version: z.string(),
  published_by: z.string(),
  notes: z.string().nullable().optional(),
  is_current: z.number().optional().default(0),
});

export type InsertReferenceReleases = z.infer<typeof insertReferenceReleasesSchema>;

export interface TurnJobs {
  id: string;
  gameId: string;
  actionPayload: any;
  status: string;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export const insertTurnJobsSchema = z.object({
  gameId: z.string(),
  actionPayload: z.any(),
  status: z.string().optional().default('pending'),
  error: z.string().nullable().optional(),
  completedAt: z.date().nullable().optional(),
});

export type InsertTurnJob = z.infer<typeof insertTurnJobsSchema>;
export type TurnJob = TurnJobs;

export interface Users {
  id: string;
  username: string;
  password: string;
  theme: string | null;
  style: string | null;
  imageModelKey: string | null;
  llmModelKey?: string | null;
  skipImageCache: boolean | null;
  typewriterEnabled: boolean | null;
}

export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;

// Alias for backward compatibility
export type User = Users;

// Table aliases for snake_case exports (expected by codebase)
export const reference_releases = null as any; // No longer used, kept for compatibility
export const app_settings = null as any; // No longer used, kept for compatibility

// Game state types
export type Skill = 'Bureaucracy' | 'Engineering' | 'Piloting' | 'Culinary' | 'Diplomacy' | 'Deception' | 'Vibes';
export type Intent = 'repair' | 'negotiate' | 'cook' | 'explore' | 'improvise' | 'research' | 'command' | 'other';
export type Risk = 'Safe' | 'Risky' | 'Wild';
export type Segment =
  // New mission phases
  | 'Launch from Earth'
  | 'Moon Flyby'
  | 'Onto to Mars'
  | 'Asteroid Belt'
  | 'Jupiter & Saturn'
  | 'Outer Darkness'
  | 'Approaching Uranus'
  | 'Arrival on Uranus'
  | 'Lost';
// Canonical event tags used for triggering, routing, and UI
export type EventTag =
  | 'technical'      // malfunctions, life support, engineering problems
  | 'cosmic'         // phenomena, weird space stuff
  | 'crisis'         // emergencies, time pressure
  | 'crew'           // people-focused, interactions
  | 'authority'      // inspections, rules, power dynamics
  | 'bureaucracy'    // paperwork, process, pedantry
  | 'repair'         // fixing things, maintenance tasks
  | 'survival'       // oxygen, food, fuel scarcity
  | 'travel'         // transit, navigation, moving between places
  | 'discovery'      // finding new things, science moments
  | 'science'        // experiments, research
  | 'social'         // conversations, morale
  | 'morale'         // mood, crew vibe
  | 'food'           // cooking, supplies, cuisine
  | 'gross'          // icky situations
  | 'absurd';        // comedic/meta/tonal absurdity

export const EVENT_TAGS: readonly EventTag[] = [
  'technical',
  'cosmic',
  'crisis',
  'crew',
  'authority',
  'bureaucracy',
  'repair',
  'survival',
  'travel',
  'discovery',
  'science',
  'social',
  'morale',
  'food',
  'gross',
  'absurd',
] as const;
export type NPCStatus = 'Indifferent' | 'Warm' | 'Friendly' | 'Cold' | 'Hostile' | 'Rivalry' | 'Crush';

// NPC Skill Mappings - defines which skills each crew member specializes in
export const NPC_SKILL_MAPPINGS: Record<string, Skill[]> = {
  'Pilot Lyra': ['Piloting', 'Deception'],
  'Engineer Grom': ['Engineering', 'Bureaucracy'],
  'Doctor Moss': ['Bureaucracy', 'Culinary'],
  'Coffee-9000': ['Diplomacy', 'Vibes']
} as const;

export interface GameStats {
  hull: number;
  oxygen: number;
  fuel: number;
  food: number;
  morale: number;
  weirdness: number;
}

export interface NPC {
  id: string;
  name: string;
  role: string;
  affinity: number;
  status: NPCStatus;
  lastInteraction?: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillBonus?: { skill: Skill; bonus: number };
  sceneEffect?: { tags: string[]; effect: string };
  efficiency?: {
    oxygen?: number;
    fuel?: number;
    food?: number;
    morale?: number;
  };
}

export interface Check {
  skill: Skill;
  dc: number;
  roll: number;
  success: boolean;
  description?: string;
}

export interface DeltaChange {
  stat: string;
  change: number;
  note?: string;
}

export type ImagePromptSource = 'pce' | 'template';

export type PromptStageName = 'master' | 'narrative' | 'image' | 'actions';

export interface PromptChainStage {
  stage: PromptStageName;
  template: string;
  model?: string | null;
  /** Catalog key of the story model that produced this stage (null for an ad-hoc model). */
  modelKey?: string | null;
  provider?: string | null;
  usage?: { promptTokens: number | null; completionTokens: number | null } | null;
  finishReason?: string | null;
  jsonQuality?: "raw" | "extracted" | "repaired" | "salvaged" | "failed" | null;
  /** Set on attempts after the first: a retry of the same model, or the fallback model. */
  recovery?: "retry" | "fallback" | null;
  prompt?: string | null;
  rawResponse?: string | null;
  fallbackUsed?: boolean;
  error?: string | null;
  durationMs?: number | null;
  timestamp: string;
  extras?: Record<string, unknown> | null;
}

export interface Turn {
  turnNumber: number;
  action?: string;
  narrative: string;
  checks: Check[];
  delta: DeltaChange[];
  timestamp: number;
  imageUrl?: string;
  imageTemplate?: string;
  imageStatus?: 'pending' | 'completed' | 'failed';
  imageJobId?: string;
  imagePrompt?: string;
  imageStyle?: string;
  imageModelKey?: string;
  imageMetadata?: Record<string, unknown> | null;
  imagePromptSource?: ImagePromptSource;
  promptChain?: PromptChainStage[];
  masterEnrichment?: Record<string, unknown> | null;
  toneHints?: string[];
  theme?: string;
  style?: string;
  fallbackUsed?: boolean;
}

export interface ActionChip {
  action: string;
  summary: string;
  risk: Risk;
  intent: Intent;
  usesItemId?: string;
}

export interface GameState {
  id: string;
  username: string;
  seed: string;
  day: number;
  turnNumber: number;
  segment: Segment;
  absurdity: number;
  stats: GameStats;
  npcs: NPC[];
  equippedItems: string[];
  turns: Turn[];
  currentActions: ActionChip[];
  runningGags: string[];
  eventHistory: string[];
  interviewResponses: Record<string, string>;
  isComplete: boolean;
  failureReason?: string;
}

export type GameSummary = Pick<
  GameState,
  'id' | 'username' | 'day' | 'turnNumber' | 'segment' | 'isComplete' | 'failureReason'
>;

// Insert schemas
export const insertGameStateSchema = z.object({
  username: z.string().min(1, "Captain name required"),
  seed: z.string().optional(),
  absurdity: z.number().int().min(0).max(3).optional().default(2),
});

export type InsertGameState = z.infer<typeof insertGameStateSchema>;

export const actionInputSchema = z.object({
  gameId: z.string(),
  action: z.string(),
  customText: z.string().optional(),
});

export type ActionInput = z.infer<typeof actionInputSchema>;

// Event trigger condition types
export type TriggerCondition = 
  | { type: 'stat'; stat: keyof GameStats; operator: '>=' | '<=' | '>' | '<' | '=='; value: number }
  | { type: 'day_modulo'; divisor: number; remainder: number }
  | { type: 'random'; chance: number }
  | { type: 'or'; conditions: TriggerCondition[] }
  | { type: 'and'; conditions: TriggerCondition[] };

// Event definition (runtime version with evaluated trigger)
export interface EventDefinition {
  id: string;
  name: string;
  segment: Segment | 'Any';
  tags: string[];
  triggerCondition: TriggerCondition;
  skill: Skill;
  dc: number;
  passEffect: string;
  failEffect: string;
  active: boolean;
}

// Items are now loaded from database via itemCache
// Use getActiveItems() to get all items
// Use getItemById(id) to get a specific item

// ============================================
// PCE Inspector Types
// ============================================

export interface PceTestScenario {
  id: string;
  name: string;
  description?: string | null;
  gameStateJson: string;
  playerAction: string;
  checksJson?: string | null;
  triggeredEventJson?: string | null;
  theme?: string | null;
  style?: string | null;
  imageModelKey?: string | null;
  tags?: string | null;
  isPreset: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PceTestRun {
  id: string;
  scenarioId: string;
  releaseVersion?: string | null;
  templateMasterId?: string | null;
  templateNarrativeId?: string | null;
  templateImageId?: string | null;
  templateActionsId?: string | null;
  status: 'success' | 'partial_success' | 'failure';
  stageResultsJson: string;
  executedAt: string;
  durationMs?: number;
  totalTokensPrompt?: number;
  totalTokensResponse?: number;
  estimatedCostUsd?: number;
  notes?: string | null;
  tags?: string | null;
  starred: boolean;
}

export interface PceTestMetrics {
  id: string;
  testRunId: string;
  overallScore: number;
  coherenceScore?: number;
  thematicScore?: number;
  varietyScore?: number;
  technicalScore?: number;
  playerImpactScore?: number;
  coherenceAnalysisJson?: string;
  thematicAnalysisJson?: string;
  varietyAnalysisJson?: string;
  technicalAnalysisJson?: string;
  playerImpactAnalysisJson?: string;
  computedAt: string;
  computationDurationMs?: number;
}

export interface PceTemplateVersion {
  id: string;
  promptId: string;
  versionNumber: number;
  releaseVersion?: string;
  systemContent?: string;
  content?: string;
  createdBy?: string;
  createdAt: string;
  notes?: string;
}

export interface ParsedTestScenario extends Omit<PceTestScenario, 'gameStateJson' | 'checksJson' | 'triggeredEventJson'> {
  gameState: unknown;
  checks: unknown[];
  triggeredEvent: unknown | null;
}

export interface ParsedTestRun extends Omit<PceTestRun, 'stageResultsJson'> {
  stageResults: unknown;
}

export const PceTestScenarioCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  gameStateJson: z.string().min(1, "Game state is required"),
  playerAction: z.string().min(1, "Player action is required"),
  checksJson: z.string().optional(),
  triggeredEventJson: z.string().optional(),
  theme: z.string().optional(),
  style: z.string().optional(),
  imageModelKey: z.string().optional(),
  tags: z.string().optional(),
  isPreset: z.boolean().default(false),
  createdBy: z.string().optional()
});

export const PceTestScenarioUpdateSchema = PceTestScenarioCreateSchema.partial();

export const PceTestRunCreateSchema = z.object({
  scenarioId: z.string().min(1, "scenarioId is required"),
  mode: z.enum(['full', 'single-stage']).optional().default('full'),
  targetStage: z.enum(['master', 'narrative', 'image', 'actions']).optional(),
  useDataFromRunId: z.string().optional(),
  /** Catalog key of the story model to run with (Dev Tools). Omit for the default. */
  llmModelKey: z.string().optional(),
  mockData: z.object({
    masterEnrichment: z.any().optional(),
    narrative: z.string().optional()
  }).optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
  starred: z.boolean().default(false)
});

export const PceTestRunUpdateSchema = z.object({
  notes: z.string().optional(),
  tags: z.string().optional(),
  starred: z.boolean().optional()
});

// Singular type aliases matching codebase expectations
export type PromptTemplate = PromptTemplates;
export type InsertPromptTemplate = InsertPromptTemplates;

export type LlmLog = LlmLogs;
export type InsertLlmLog = InsertLlmLogs;

export type Event = Events;
export type InsertEvent = InsertEvents;

export type ItemRow = Items;
export type InsertItem = InsertItems;

export type NpcTemplate = NpcTemplates;
export type InsertNpcTemplate = InsertNpcTemplates;

export type ImagePrompt = ImagePrompts;
export type InsertImagePrompt = InsertImagePrompts;

export type GeneratedImage = GeneratedImages;
export type InsertGeneratedImage = InsertGeneratedImages;

export type InterviewQuestion = InterviewQuestions;
export type InsertInterviewQuestion = InsertInterviewQuestions;

export type ReferenceRelease = ReferenceReleases;
export type InsertReferenceRelease = InsertReferenceReleases;

export type ImageJob = ImageJobs;
export type InsertImageJob = InsertImageJobs;

export type AppSetting = AppSettings;

export type ImageModel = ImageModels;
export type LlmModel = LlmModels;

export type SelectGame = Games;
export type InsertGame = InsertGames;

// Orchestrator types
export interface QueueEntries {
  id: string;
  queue: string;
  payloadTable: string;
  payloadId: string;
  status: 'pending' | 'leased' | 'completed' | 'dead_letter';
  attempts: number;
  priority: number;
  runAt: Date;
  leaseId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  traceId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string | null;
  lastError: Record<string, unknown> | null;
}

export interface QueueLeases {
  leaseId: string;
  entryId: string;
  workerId: string;
  heartbeatExpiresAt: Date;
  createdAt: Date;
  renewedAt: Date | null;
  releasedAt: Date | null;
  outcome: 'completed' | 'failed' | 'released' | 'expired' | null;
  outcomeDetails: Record<string, unknown> | null;
}

export interface TurnExecutionManifests {
  id: string;
  gameId: string;
  turnNumber: number;
  queueEntryId: string;
  attempt: number;
  version: string;
  manifest: Record<string, unknown>;
  manifestHash: Buffer;
  precomputeHash: Buffer;
  traceId: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
