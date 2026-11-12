import OpenAI from "openai";
import type { GameState, ActionChip, ModStoryThemes, ModVisualStyles, ImagePromptSource } from "@shared/schema";
import { storage } from "./storage.js";
import { getCurrentReference } from "./reference/referenceLoader";
import { saveImageToFile, loadImageFromFile, deleteImageFile } from "./imageStorage.js";
import { 
  generatePromptHash, 
  generateVariablesHash, 
  generateCacheKey, 
  generateSceneFingerprint,
  calculateSceneSimilarity,
  findSimilarScenes,
  type ImageSettings,
  type SceneFingerprint
} from "./cacheUtils.js";
import { buildMetaPrompt, buildPcePrompt, flattenMasterEnrichment, getTemplateLoadMetrics, type SeparatedPrompts } from "./pce/promptBuilder.js";
import { buildModelInstructionSet } from "./pce/modelInstructions.js";
import { resolvePceSelections, type PceSelection } from "./pce/settings.js";
import { getSocketIO } from "./socketManager.js";
import {
  ContentGenerationRouter,
  type ActionsPayload,
  type FullTurnContentResult,
  type ImagePromptPayload,
  type MasterEnrichmentData,
  type NarrativePayload,
  type PromptStage,
  type StageMetadata,
  type StageResult,
  type TurnGenerationContext
} from "./pce/contentRouter.js";
import { 
  llmCallDuration,
  pceStageDuration,
  variableBuildDuration,
  promptBuildDuration
} from "./metrics.js";
import { describeLlmError, getLlmClient, llmCallErrorInfo, maxTokensParam, tagLlmCallError } from "./llm/clients.js";
import { STAGE_OBJECT_KEYS, parseStageJson, recoverStageOutput } from "./llm/json.js";
import {
  BUILTIN_LLM_MODEL,
  adhocLlmModel,
  getThemeForcedLlmModelKeys,
  requestModelId,
  resolveLlmFallback,
  resolveLlmModel,
  type ResolvedLlmModel
} from "./llm/models.js";

// Lazy initialization of OpenAI clients to avoid module-load errors in tests
// Text generation client (customizable via AI integrations env vars)
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    });
  }
  return _openai;
}

// Image generation client (direct to OpenAI API) - currently unused but available
let _openaiImages: OpenAI | null = null;
function getOpenAIImages(): OpenAI {
  if (!_openaiImages) {
    _openaiImages = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return _openaiImages;
}


let lastTemplateLoadCountLogged = 0;

// Helper functions to replace cache functions
async function getItemById(id: string) {
  const reference = await getCurrentReference();
  const item = reference.data.items.find(item => item.id === id);
  if (!item || item.active !== 1) return undefined;
  
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    skillBonus: item.skillBonusSkill && item.skillBonusValue 
      ? { skill: item.skillBonusSkill as any, bonus: item.skillBonusValue }
      : undefined,
    sceneEffect: item.sceneEffectTags && item.sceneEffectEffect
      ? { tags: item.sceneEffectTags as string[], effect: item.sceneEffectEffect }
      : undefined,
    efficiency: item.efficiency
  };
}

async function getEquippedItems(ids: string[]) {
  const items = await Promise.all(ids.map(id => getItemById(id)));
  return items.filter((item): item is NonNullable<typeof item> => item !== undefined);
}

async function getPromptFromCache(name: string) {
  const reference = await getCurrentReference();
  const prompt = reference.data.prompts.find(p => p.name === name);
  
  if (!prompt) {
    throw new Error(`Prompt '${name}' not found in reference. Available prompts: ${reference.data.prompts.map(p => p.name).join(", ")}`);
  }

  // Find global system prompt for inheritance
  const globalPrompt = reference.data.prompts.find(p => p.name === 'global_system_prompt');
  
  let systemPrompt: string;
  if (prompt.name === 'global_system_prompt') {
    systemPrompt = prompt.content;
    // Validate immediately after assignment
    if (!systemPrompt || !systemPrompt.trim()) {
      throw new Error(`Prompt '${name}' has empty or missing system prompt. Check reference data.`);
    }
  } else {
    // Support both snake_case (from JSON) and camelCase (for backwards compatibility)
    const inheritGlobalPrompt = prompt.inherit_global_prompt ?? prompt.inheritGlobalPrompt;
    const systemContent = prompt.system_content ?? prompt.systemContent;
    
    if (inheritGlobalPrompt === 1 && globalPrompt) {
      systemPrompt = globalPrompt.content;
      if (systemContent) {
        systemPrompt = systemPrompt + "\n\n" + systemContent;
      }
      // Validate immediately after determination
      if (!systemPrompt || !systemPrompt.trim()) {
        throw new Error(`Prompt '${name}' has empty or missing system prompt. Global prompt inheritance enabled but global_system_prompt has empty content.`);
      }
    } else {
      // Only set to empty string if we're about to validate it's invalid
      if (!systemContent || !systemContent.trim()) {
        throw new Error(`Prompt '${name}' has empty or missing system prompt. Check reference data - ensure either systemContent is set or inheritGlobalPrompt is enabled with a valid global_system_prompt.`);
      }
      systemPrompt = systemContent;
    }
  }
  
  // Validate user prompt (content) is not empty
  if (!prompt.content || !prompt.content.trim()) {
    throw new Error(`Prompt '${name}' has empty or missing user prompt (content). Check reference data.`);
  }
  
  return {
    system: systemPrompt,
    user: prompt.content
  };
}

async function getSettingFromReference(key: string): Promise<string | undefined> {
  const reference = await getCurrentReference();
  const settings = reference.data.settings || {};
  if (settings && Object.prototype.hasOwnProperty.call(settings, key)) {
    return settings[key];
  }
  return undefined;
}

/**
 * Gets the default image model key from reference system_defaults.
 */
export async function getDefaultImageModelKey(): Promise<string | null> {
  try {
    const reference = await getCurrentReference();
    if (reference.data.system_defaults?.image_model_key) {
      return reference.data.system_defaults.image_model_key;
    }
  } catch (error) {
    console.warn("Failed to get default image model key from reference:", error);
  }
  
  return null;
}


async function getImagePromptByName(name: string) {
  const reference = await getCurrentReference();
  const prompt = reference.data.image_prompts.find(p => p.name === name && p.active === 1);
  
  if (!prompt) {
    throw new Error(`Image prompt '${name}' not found in reference. Available prompts: ${reference.data.image_prompts.map(p => p.name).join(", ")}`);
  }

  // Get visual style base prompt
  const visualStylePrompt = reference.data.prompts.find(p => p.name === 'visual_style_prompt' && p.active === 1);
  const visualStyleContent = visualStylePrompt?.content || '';

  // Database uses snake_case: prompt_template, inherit_visual_style
  const promptTemplate = (prompt as any).prompt_template || null;
  
  if (!promptTemplate) {
    throw new Error(`Image prompt '${name}' has no promptTemplate. Prompt ID: ${prompt.id}`);
  }
  
  const inheritVisualStyle = (prompt as any).inherit_visual_style !== undefined 
    ? (prompt as any).inherit_visual_style 
    : 1;
  
  let compiledTemplate = promptTemplate;
  if (inheritVisualStyle && visualStyleContent) {
    compiledTemplate = [
      promptTemplate,
      "",
      `STYLE: ${visualStyleContent}`,
    ].join("\n");
  }

  return {
    ...prompt,
    promptTemplate,
    compiledTemplate
  };
}

function replaceVariables(template: string, variables: Record<string, any> = {}): string {
  if (!template) {
    throw new Error('Template is required for replaceVariables');
  }
  
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, String(value ?? ''));
  }

  return result;
}

function addInterviewResponsesToVariables(variables: Record<string, any>, state: GameState): Record<string, any> {
  const enhanced = { ...variables };
  
  if (state.interviewResponses && typeof state.interviewResponses === 'object') {
    for (const [key, value] of Object.entries(state.interviewResponses)) {
      enhanced[`INTERVIEW_${key}`] = value || 'Not provided';
    }
  }
  
  return enhanced;
}

export async function logLlmCall(
  functionName: string,
  prompt: string,
  response: string,
  metadata: any = {},
  executionTimeMs: number,
  gameId?: string,
  turnNumber?: number
) {
  try {
    const baseMetadata =
      metadata && typeof metadata === "object" ? { ...metadata } : {};
    const templateMetricsSnapshot = getTemplateLoadMetrics();
    let metadataWithMetrics = baseMetadata;

    if (templateMetricsSnapshot.totalLoads > lastTemplateLoadCountLogged) {
      metadataWithMetrics = {
        ...baseMetadata,
        templateLoadMetrics: {
          cacheHits: templateMetricsSnapshot.cacheHits,
          cacheMisses: templateMetricsSnapshot.cacheMisses,
          totalLoads: templateMetricsSnapshot.totalLoads,
          lastLoadDurationMs: templateMetricsSnapshot.lastLoadDurationMs,
          lastLoadTimestamp: templateMetricsSnapshot.lastLoadTimestamp,
          lastLoadWasCacheHit: templateMetricsSnapshot.lastLoadWasCacheHit
        }
      };
      lastTemplateLoadCountLogged = templateMetricsSnapshot.totalLoads;
    }

    // Always log to database
    await storage.createLlmLog({
      functionName,
      prompt,
      response,
      metadata: metadataWithMetrics,
      executionTimeMs,
      gameId: gameId || null,
      turnNumber: turnNumber || null,
      promptTemplateId: null,
    });
    
    // Conditionally emit log data to browser console via Socket.IO (if CONSOLE_LLM_LOG is enabled)
    if (process.env.CONSOLE_LLM_LOG === 'true') {
      const io = getSocketIO();
      if (io) {
        const logData = {
          functionName,
          prompt,
          response,
          metadata: metadataWithMetrics,
          executionTimeMs,
          gameId: gameId || null,
          turnNumber: turnNumber || null,
          timestamp: new Date().toISOString(),
        };
        // Emit to all connected clients (broadcast)
        io.emit('llmLog', logData);
      }
    }
  } catch (error) {
    console.error("Error logging LLM call:", error);
  }
}



function summarizeChecks(checks: any[]): string {
  if (!checks || checks.length === 0) {
    return "No skill checks resolved this turn.";
  }

  return checks.map(check => {
    const outcome = check.success ? "success" : "failure";
    return `${check.skill} DC${check.dc} → rolled ${check.roll} (${outcome})`;
  }).join("; ");
}

function summarizeNpcs(state: GameState): string {
  if (!state.npcs || state.npcs.length === 0) {
    return "No active crew members.";
  }

  return state.npcs.map(npc => {
    const attitude = npc.affinity > 0 ? "Warm" : npc.affinity < 0 ? "Cold" : "Neutral";
    return `${npc.name} (${npc.role}) — ${attitude}, status ${npc.status}`;
  }).join("; ");
}

function summarizeEquippedItems(items: Awaited<ReturnType<typeof getEquippedItems>>): string {
  if (!items || items.length === 0) {
    return "None equipped.";
  }

  return items.map(item => `${item.name} (${item.icon}): ${item.description}`).join("; ");
}

function summarizeRecentTurns(state: GameState): string {
  if (!state.turns || state.turns.length === 0) {
    return "No prior turns logged.";
  }

  return state.turns.slice(-3).map(t => {
    const snippet = t.narrative.replace(/\s+/g, " ").substring(0, 140);
    return `Turn ${t.turnNumber}: ${snippet}${snippet.length === 140 ? "..." : ""}`;
  }).join(" | ");
}

function summarizeInterviewResponses(responses: Record<string, string>): string {
  const entries = Object.entries(responses || {});
  if (entries.length === 0) {
    return "None recorded.";
  }

  return entries.slice(0, 4).map(([key, value]) => `${key}: ${value}`).join("; ");
}

function buildPceContent(
  state: GameState,
  playerAction: string,
  checks: any[],
  triggeredEvent: { name: string; segment: string; skill: string } | null | undefined,
  equippedItems: Awaited<ReturnType<typeof getEquippedItems>>
): string {
  const triggeredEventText = triggeredEvent
    ? `${triggeredEvent.name} (${triggeredEvent.segment} / ${triggeredEvent.skill})`
    : "No special events triggered.";

  const statsLine = [
    `Hull ${state.stats.hull}`,
    `Oxygen ${state.stats.oxygen}`,
    `Fuel ${state.stats.fuel}`,
    `Food ${state.stats.food}`,
    `Morale ${state.stats.morale}`,
    `Weirdness ${state.stats.weirdness}`
  ].join(", ");

  const runningGags = state.runningGags?.length
    ? state.runningGags.slice(0, 3).join(", ")
    : "None yet.";

  const interviewSummary = summarizeInterviewResponses(state.interviewResponses || {});

  return [
    "Narrator Persona: E.L.O.N., smug AI announcer.",
    `Turn Context: Day ${state.day}, Segment ${state.segment}, Turn ${state.turnNumber}.`,
    `Player Action: ${playerAction}.`,
    `Triggered Event: ${triggeredEventText}`,
    `Skill Checks: ${summarizeChecks(checks)}`,
    `Crew Status: ${summarizeNpcs(state)}`,
    `Equipped Items: ${summarizeEquippedItems(equippedItems)}`,
    `Ship Stats: ${statsLine}.`,
    `Running Gags: ${runningGags}`,
    `Recent Narrative Echoes: ${summarizeRecentTurns(state)}`,
    `Interview Responses: ${interviewSummary}.`
  ].join("\n");
}

async function resolveCreativeSelectionsForState(
  state: GameState,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean }
): Promise<PceSelection> {
  return await resolvePceSelections({
    theme: userPreferences.theme,
    style: userPreferences.style,
  });
}

interface ImageModelWithLabel {
  label: string;
  triggerWords: string;
  class: string | null;
  [key: string]: unknown;
}

interface TurnPromptIngredients {
  state: GameState;
  playerAction: string;
  checks: any[];
  triggeredEvent: { name: string; segment: string; skill: string } | null;
  selections: PceSelection;
  themeObject: ModStoryThemes;
  styleObject: ModVisualStyles;
  imageModel: ImageModelWithLabel;
  equippedItems: Awaited<ReturnType<typeof getEquippedItems>>;
  formattedChecks: string;
  runningGags: string;
  activeEvent: string;
  equippedItemsText: string;
  modelStyleInstructions: string;
  outputFormatInstructions: string;
  outputExample: string;
  instructionClass: string;
  diffusionModifiers: string;
  transformerModifiers: string;
  resolvedStyleModifiers: string;
  recentTurnsSummary: string;
  interviewSummary: string;
  imageModelKey: string;
  /** Story model for this turn (theme-forced, player-chosen, or the default). */
  llmModel: ResolvedLlmModel;
  /** Model to fall back to when the story model fails a stage. Null: none. */
  llmFallback: ResolvedLlmModel | null;
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean };
}

async function gatherTurnPromptIngredients(
  state: GameState,
  playerAction: string,
  checks: any[],
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  triggeredEvent: { name: string; segment: string; skill: string } | null,
  llmOverride?: ResolvedLlmModel,
  llmFallbackOverride?: ResolvedLlmModel | null
): Promise<TurnPromptIngredients> {
  const selections = await resolveCreativeSelectionsForState(state, userPreferences);

  const equippedItems = await getEquippedItems(state.equippedItems);

  const modelKey = (userPreferences.imageModelKey ?? (await getDefaultImageModelKey()))?.trim();
  if (!modelKey) {
    throw new Error("No image model key specified and no default model found");
  }

  const imageModelRaw = await storage.getImageModelByKey(modelKey);
  if (!imageModelRaw) {
    throw new Error(`Image model not found. Tried key: ${modelKey}, and default model not found in database.`);
  }

  const themesData = await storage.listStoryThemes();
  const stylesData = await storage.listVisualStyles();

  const selectedTheme =
    themesData.find(t => t.label === selections.theme || t.storyThemeKey === selections.theme) || null;
  const selectedStyle =
    stylesData.find(s => s.label === selections.style || s.visualStyleKey === selections.style) || null;

  if (!selectedTheme) {
    throw new Error(
      `Theme "${selections.theme}" not found in database. Available themes: ${themesData
        .map(t => t.label || t.storyThemeKey)
        .join(", ")}`
    );
  }

  if (!selectedStyle) {
    throw new Error(
      `Style "${selections.style}" not found in database. Available styles: ${stylesData
        .map(s => s.label || s.visualStyleKey)
        .join(", ")}`
    );
  }

  // Story model: a Dev Tools override wins; otherwise the theme's forced model, then the
  // player's choice, then the default. Unknown keys fall back instead of failing the turn.
  const llmModel =
    llmOverride ??
    (await resolveLlmModel(
      (await getThemeForcedLlmModelKeys()).get(selectedTheme.storyThemeKey),
      userPreferences.llmModelKey
    ));
  // Dev Tools passes its own fallback (it tests unpublished rows); the game resolves it.
  const llmFallback =
    llmFallbackOverride !== undefined ? llmFallbackOverride : await resolveLlmFallback(llmModel);

  const formattedChecks =
    checks && checks.length > 0
      ? checks
          .map(
            check => `- ${check.skill} DC${check.dc}: Rolled ${check.roll} ${check.success ? "✅" : "❌"}`
          )
          .join("\n")
      : "No skill checks this turn.";

  const runningGags = state.runningGags?.length ? state.runningGags.slice(0, 3).join(", ") : "None yet";

  const activeEvent = triggeredEvent
    ? `${triggeredEvent.name} (${triggeredEvent.segment} segment - ${triggeredEvent.skill} challenge)`
    : "No special events triggered this turn.";

  const equippedItemsText =
    equippedItems && equippedItems.length > 0
      ? equippedItems.map(item => `${item.name} (${item.icon})`).join(", ")
      : "None";

  const { style: modelStyleInstructions, output: outputFormatInstructions, example: outputExample, modelClass: instructionClass } =
    buildModelInstructionSet(imageModelRaw?.class);

  const rawDiffusionModifiers = (selectedStyle?.modifiersDiffusion ?? "").trim();
  const rawTransformerModifiers = (selectedStyle?.modifiersTransformer ?? "").trim();

  const diffusionModifiers = rawDiffusionModifiers || "None provided.";
  const transformerModifiers = rawTransformerModifiers || "None provided.";

  const resolvedStyleModifiers = (() => {
    if (instructionClass === "diffuser") {
      return diffusionModifiers !== "None provided." ? diffusionModifiers : transformerModifiers;
    }
    if (instructionClass === "flux" || instructionClass === "transformer") {
      return transformerModifiers !== "None provided." ? transformerModifiers : diffusionModifiers;
    }
    return transformerModifiers !== "None provided." ? transformerModifiers : diffusionModifiers;
  })();

  const imageModelWithLabel: ImageModelWithLabel = {
    ...imageModelRaw,
    label: imageModelRaw.displayName || imageModelRaw.modelName || "",
    triggerWords: imageModelRaw.triggerWords ?? "",
    class: imageModelRaw.class ?? null
  };

  const recentTurnsSummary = summarizeRecentTurns(state);
  const interviewSummary = summarizeInterviewResponses(state.interviewResponses || {});

  return {
    state,
    playerAction,
    checks,
    triggeredEvent,
    selections,
    themeObject: selectedTheme,
    styleObject: selectedStyle,
    imageModel: imageModelWithLabel,
    equippedItems,
    formattedChecks,
    runningGags,
    activeEvent,
    equippedItemsText,
    modelStyleInstructions,
    outputFormatInstructions,
    outputExample,
    instructionClass,
    diffusionModifiers,
    transformerModifiers,
    resolvedStyleModifiers,
    recentTurnsSummary,
    interviewSummary,
    imageModelKey: modelKey,
    llmModel,
    llmFallback,
    userPreferences
  };
}

export function buildMasterVariables(ingredients: TurnPromptIngredients): Record<string, unknown> {
  // Ensure THEME_OBJECT has all required properties for nested access
  const themeObject = {
    ...ingredients.themeObject,
    label: ingredients.themeObject.label,
    narratorTemplate: ingredients.themeObject.narratorTemplate,
  };

  // Ensure STYLE_OBJECT has all required properties for nested access
  const styleObject = {
    ...ingredients.styleObject,
    label: ingredients.styleObject.label,
    exemplifiedBy: ingredients.styleObject.exemplifiedBy,
  };

  // Ensure IMAGE_MODEL has all required properties for nested access
  const imageModel = {
    ...ingredients.imageModel,
    label: ingredients.imageModel.label,
    class: ingredients.imageModel.class,
    triggerWords: ingredients.imageModel.triggerWords,
  };

  return {
    TURN_NUMBER: ingredients.state.turnNumber,
    DAY: ingredients.state.day,
    SEGMENT: ingredients.state.segment,
    PLAYER_ACTION: ingredients.playerAction,
    ACTIVE_EVENT: ingredients.activeEvent,
    CHECKS: ingredients.formattedChecks,
    RUNNING_GAGS: ingredients.runningGags,
    NPC_SUMMARY: summarizeNpcs(ingredients.state),
    HULL: ingredients.state.stats.hull,
    OXYGEN: ingredients.state.stats.oxygen,
    FUEL: ingredients.state.stats.fuel,
    FOOD: ingredients.state.stats.food,
    MORALE: ingredients.state.stats.morale,
    WEIRDNESS: ingredients.state.stats.weirdness,
    EQUIPPED_ITEMS: ingredients.equippedItemsText,
    RECENT_TURNS: ingredients.recentTurnsSummary,
    INTERVIEW_SUMMARY: ingredients.interviewSummary,
    THEME_OBJECT: themeObject,
    STYLE_OBJECT: styleObject,
    IMAGE_MODEL: imageModel,
    IMAGE_MODEL_KEY: ingredients.imageModelKey,
    MODEL_STYLE_INSTRUCTIONS: ingredients.modelStyleInstructions,
    OUTPUT_FORMAT_INSTRUCTIONS: ingredients.outputFormatInstructions,
    OUTPUT_EXAMPLE: ingredients.outputExample,
    STYLE_MODIFIERS: ingredients.resolvedStyleModifiers,
    STYLE_DIFFUSION_MODIFIERS: ingredients.diffusionModifiers,
    STYLE_TRANSFORMER_MODIFIERS: ingredients.transformerModifiers
  };
}

export function buildNarrativeVariables(
  ingredients: TurnPromptIngredients,
  master: MasterEnrichmentData
): Record<string, unknown> {
  // Ensure MASTER_CONTEXT, MASTER_VARIABLES, MASTER_GUIDANCE are objects for nested property access
  const masterContext = master.flattened.MASTER_CONTEXT ?? {};
  const masterVariables = master.flattened.MASTER_VARIABLES ?? {};
  const masterGuidance = master.flattened.MASTER_GUIDANCE ?? {};

  return {
    ...buildMasterVariables(ingredients),
    MASTER_CONTEXT: masterContext,
    MASTER_VARIABLES: masterVariables,
    MASTER_GUIDANCE: masterGuidance,
    IMAGE_MODEL_KEY: ingredients.imageModelKey
  };
}

export function buildImageVariables(
  ingredients: TurnPromptIngredients,
  narrative: NarrativePayload,
  master: MasterEnrichmentData
): Record<string, unknown> {
  // Ensure MASTER_CONTEXT, MASTER_VARIABLES, MASTER_GUIDANCE are objects for nested property access
  const masterContext = master.flattened.MASTER_CONTEXT ?? {};
  const masterVariables = master.flattened.MASTER_VARIABLES ?? {};
  const masterGuidance = master.flattened.MASTER_GUIDANCE ?? {};

  // Ensure NARRATIVE_TONE_HINTS is an array for template access
  const narrativeToneHints = Array.isArray(narrative.toneHints) ? narrative.toneHints : [];

  return {
    ...buildMasterVariables(ingredients),
    MASTER_CONTEXT: masterContext,
    MASTER_VARIABLES: masterVariables,
    MASTER_GUIDANCE: masterGuidance,
    NARRATION: narrative.narration,
    NARRATIVE_SUMMARY: narrative.narration,
    NARRATIVE_TONE_HINTS: narrativeToneHints,
    MODEL_STYLE_INSTRUCTIONS: ingredients.modelStyleInstructions,
    IMAGE_MODEL_KEY: ingredients.imageModelKey
  };
}

export function buildActionsVariables(
  ingredients: TurnPromptIngredients,
  narrative: NarrativePayload,
  master: MasterEnrichmentData
): Record<string, unknown> {
  // Ensure MASTER_CONTEXT, MASTER_VARIABLES, MASTER_GUIDANCE are objects for nested property access
  const masterContext = master.flattened.MASTER_CONTEXT ?? {};
  const masterVariables = master.flattened.MASTER_VARIABLES ?? {};
  const masterGuidance = master.flattened.MASTER_GUIDANCE ?? {};

  // Build base variables (same as narrative stage), excluding image-specific ones
  const baseVariables = buildMasterVariables(ingredients);
  
  // Remove image-specific variables that actions stage doesn't need
  const {
    MODEL_STYLE_INSTRUCTIONS,
    OUTPUT_FORMAT_INSTRUCTIONS,
    OUTPUT_EXAMPLE,
    STYLE_MODIFIERS,
    STYLE_DIFFUSION_MODIFIERS,
    STYLE_TRANSFORMER_MODIFIERS,
    IMAGE_MODEL,
    ...actionsBaseVariables
  } = baseVariables;

  return {
    ...actionsBaseVariables,
    MASTER_CONTEXT: masterContext,
    MASTER_VARIABLES: masterVariables,
    MASTER_GUIDANCE: masterGuidance,
    CURRENT_NARRATIVE: narrative.narration
  };
}

interface PromptExecutionOptions {
  stage: PromptStage;
  template: string;
  systemPrompt?: string;  // NEW: system prompt
  userPrompt?: string;    // NEW: user prompt
  prompt?: string;         // DEPRECATED: single prompt (backward compat)
  /** Story model to call. Defaults to the built-in model. */
  llm?: ResolvedLlmModel;
  model?: string;          // DEPRECATED: bare OpenAI model name; prefer `llm`
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  metadata?: Record<string, unknown>;
  gameId?: string;
  turnNumber?: number;
  logName?: string;
}

export async function executeJsonPrompt(
  promptOrOptions: string | PromptExecutionOptions,
  options?: PromptExecutionOptions
): Promise<{ rawContent: string; metadata: StageMetadata }> {
  // Handle both old (string) and new (options) signatures
  let opts: PromptExecutionOptions;
  if (typeof promptOrOptions === "string") {
    // Legacy: single prompt string
    opts = { ...options!, prompt: promptOrOptions };
  } else {
    opts = promptOrOptions;
  }

  // Story model: an explicit catalog/ad-hoc model wins; a bare `model` name is treated as
  // an OpenAI model (legacy callers); otherwise the built-in default.
  const llm: ResolvedLlmModel = opts.llm
    ?? (opts.model ? adhocLlmModel({ provider: "openai", modelName: opts.model }) : BUILTIN_LLM_MODEL);
  const model = requestModelId(llm);
  const startTime = Date.now();

  // Build messages array
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  // System prompt (required)
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  } else if (opts.prompt) {
    // Backward compatibility: use prompt as system message
    messages.push({ role: "system", content: opts.prompt });
  } else {
    throw new Error("Either systemPrompt or prompt must be provided");
  }

  // User prompt (optional - only add if provided and not empty)
  if (opts.userPrompt && opts.userPrompt.trim()) {
    messages.push({ role: "user", content: opts.userPrompt });
  }

  // A catalog entry may raise the output limit (reasoning models spend tokens before answering).
  const maxTokens = Math.max(opts.maxTokens ?? 600, llm.params.maxTokens ?? 0);
  const requestParams: any = {
    model,
    messages,
    [maxTokensParam(llm.provider)]: maxTokens
  };
  // Models without a JSON mode reject response_format; they rely on the prompt alone.
  if (llm.supportsJsonMode) {
    requestParams.response_format = { type: "json_object" };
  }

  // Apply optional request parameter overrides
  const temperature = opts.temperature ?? llm.params.temperature;
  if (temperature !== undefined) {
    requestParams.temperature = temperature;
  }
  if (opts.topP !== undefined) {
    requestParams.top_p = opts.topP;
  }
  if (opts.frequencyPenalty !== undefined) {
    requestParams.frequency_penalty = opts.frequencyPenalty;
  }
  if (opts.presencePenalty !== undefined) {
    requestParams.presence_penalty = opts.presencePenalty;
  }

  // Instrument LLM call duration
  const llmTimer = llmCallDuration.startTimer({
    model,
    stage: opts.stage || "unknown",
    cache: "na" // PCE stages don't use cache yet
  });

  // Build full prompt string for logging
  const fullPrompt = opts.userPrompt
    ? `SYSTEM:\n${opts.systemPrompt || opts.prompt}\n\nUSER:\n${opts.userPrompt}`
    : opts.systemPrompt || opts.prompt || "";
  const logName = opts.logName ?? `pce.${opts.stage}`;
  const modelInfo = { model, modelKey: llm.key, provider: llm.provider };

  try {
    const response: any = await getLlmClient(llm.provider).chat.completions.create(requestParams);
    llmTimer();

    const choice = response.choices?.[0];
    const content: string = choice?.message?.content?.trim() ?? "";
    const finishReason: string | null = choice?.finish_reason ?? null;
    // Measured on what the model actually returned, before the empty-response substitution.
    const jsonQuality = recoverStageOutput(content, { stage: opts.stage, finishReason }).quality;
    const emptyResponse = content.length === 0;
    const rawContent = content || "{}";
    const executionTime = Date.now() - startTime;
    const timestamp = new Date().toISOString();
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens ?? null,
          completionTokens: response.usage.completion_tokens ?? null
        }
      : undefined;

    await logLlmCall(
      logName,
      fullPrompt,
      rawContent,
      {
        ...modelInfo,
        stage: opts.stage,
        template: opts.template,
        usage,
        finishReason,
        jsonQuality,
        ...opts.metadata
      },
      executionTime,
      opts.gameId,
      opts.turnNumber
    );

    const metadata: StageMetadata = {
      stage: opts.stage,
      template: opts.template,
      ...modelInfo,
      prompt: fullPrompt,
      rawResponse: rawContent,
      durationMs: executionTime,
      timestamp,
      usage,
      finishReason,
      maxTokens,
      ...(emptyResponse ? { emptyResponse: true } : {}),
      jsonQuality,
      extras: opts.metadata
    };

    return { rawContent, metadata };
  } catch (error) {
    llmTimer(); // Record duration even on error
    // Lets the stage runner record which model failed, and the router fall back.
    tagLlmCallError(error, { ...modelInfo, maxTokens });
    // Record the failed call too, so a model that errors is visible in LLM Logs.
    const { status, message } = describeLlmError(error);
    await logLlmCall(
      logName,
      fullPrompt,
      `ERROR: ${message}`,
      { ...modelInfo, stage: opts.stage, template: opts.template, error: message, upstreamStatus: status, ...opts.metadata },
      Date.now() - startTime,
      opts.gameId,
      opts.turnNumber
    ).catch(() => undefined);
    throw error;
  }
}

interface BuiltTurnContext {
  context: TurnGenerationContext;
  ingredients: TurnPromptIngredients;
  masterVariables: Record<string, unknown>;
}

export async function buildTurnGenerationContext(
  state: GameState,
  playerAction: string,
  checks: any[],
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  triggeredEvent: { name: string; segment: string; skill: string } | null,
  options: { intro?: boolean; llmOverride?: ResolvedLlmModel; llmFallbackOverride?: ResolvedLlmModel | null } = {}
): Promise<BuiltTurnContext> {
  const ingredients = await gatherTurnPromptIngredients(
    state,
    playerAction,
    checks,
    userPreferences,
    triggeredEvent,
    options.llmOverride,
    options.llmFallbackOverride
  );
  const masterVariables = buildMasterVariables(ingredients);

  const context: TurnGenerationContext = {
    state,
    gameId: state.id,
    turnNumber: state.turnNumber,
    intro: options.intro ?? false,
    playerAction,
    checks,
    userPreferences,
    llmModel: ingredients.llmModel,
    llmFallback: ingredients.llmFallback,
    triggeredEvent,
    promptVariables: {
      master: () => masterVariables,
      narrative: (master) => buildNarrativeVariables(ingredients, master),
      image: (master, narrative) => buildImageVariables(ingredients, narrative, master),
      actions: (master, narrative) => buildActionsVariables(ingredients, narrative, master)
    },
    selections: {
      theme: ingredients.selections.theme,
      style: ingredients.selections.style,
      imageModelKey: ingredients.imageModelKey,
      llmModelKey: ingredients.llmModel.key
    },
    extras: {
      ingredients
    }
  };

  return { context, ingredients, masterVariables };
}

export function getIngredients(context: TurnGenerationContext): TurnPromptIngredients {
  const extras = context.extras as { ingredients?: TurnPromptIngredients } | undefined;
  if (!extras?.ingredients) {
    throw new Error("Turn generation context missing prompt ingredients");
  }
  return extras.ingredients;
}

export async function runMasterStage(context: TurnGenerationContext): Promise<StageResult<MasterEnrichmentData>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'master' });

  try {
    console.log("[PCE] runMasterStage starting", {
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      hasIngredients: !!ingredients
    });

    // Instrument variable building
    const variableTimer = variableBuildDuration.startTimer({ stage: 'master' });
    const variables = await context.promptVariables.master();
    variableTimer();
    console.log("[PCE] Master variables built", {
      gameId: context.gameId,
      variableKeys: Object.keys(variables),
      variableCount: Object.keys(variables).length
    });

    // Instrument prompt building
    const promptTimer = promptBuildDuration.startTimer({ stage: 'master' });
    const prompts = await buildPcePrompt("master", variables, { validate: true });
    promptTimer();
    console.log("[PCE] Master prompt built", {
      gameId: context.gameId,
      systemPromptLength: prompts.system.length,
      userPromptLength: prompts.user.length
    });

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage: "master",
      template: "master",
      systemPrompt: prompts.system,
      userPrompt: prompts.user || undefined, // Only include if not empty
      metadata: {
        theme: ingredients.selections.theme,
        style: ingredients.selections.style,
        imageModelKey: ingredients.imageModelKey
      },
      gameId: context.gameId,
      turnNumber: context.turnNumber
    });

    console.log("[PCE] Master stage LLM response received", {
      gameId: context.gameId,
      rawContentLength: rawContent.length,
      hasRawContent: !!rawContent
    });

    let parsed: unknown;
    try {
      parsed = parseStageJson(rawContent, metadata);
      console.log("[PCE] Master stage JSON parsed successfully", {
        gameId: context.gameId,
        parsedType: typeof parsed,
        isObject: typeof parsed === "object" && parsed !== null
      });
    } catch (error) {
      console.error("[PCE] Master stage JSON parse failed", {
        gameId: context.gameId,
        error: (error as Error).message,
        rawContentPreview: rawContent.substring(0, 200)
      });
      metadata.error = `JSON parse error: ${(error as Error).message}`;
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    // The scene plan must carry at least one of the sections the later prompts are built
    // from (see flattenMasterEnrichment). "{}", a bare array, or a fragment of the plan
    // would leave those prompts without their variables.
    // A plan whose JSON had to be repaired must have every section: closing an unfinished
    // object can fold later sections into an earlier one.
    const isSection = (section: string) => {
      const value = (parsed as Record<string, unknown>)[section];
      return !!value && typeof value === "object" && !Array.isArray(value);
    };
    const isPlan =
      !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      (metadata.jsonQuality === "repaired"
        ? STAGE_OBJECT_KEYS.master.every(isSection)
        : STAGE_OBJECT_KEYS.master.some(isSection));
    if (!isPlan) {
      metadata.error = "Master stage returned no usable plan (expected context, variables and guidance)";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const flattened = flattenMasterEnrichment(parsed);
    const output: MasterEnrichmentData = {
      enrichment: parsed as Record<string, unknown>,
      flattened
    };

    console.log("[PCE] Master stage completed successfully", {
      gameId: context.gameId,
      hasEnrichment: !!output.enrichment,
      enrichmentKeys: output.enrichment ? Object.keys(output.enrichment) : []
    });

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output,
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    console.error("[PCE] Master stage exception caught", {
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
    const timestamp = new Date().toISOString();
    const metadata: StageMetadata = {
      stage: "master",
      template: "master",
      ...llmCallErrorInfo(error),
      prompt: "",
      rawResponse: null,
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

export async function runNarrativeStage(
  context: TurnGenerationContext,
  master: MasterEnrichmentData
): Promise<StageResult<NarrativePayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'narrative' });

  try {
    // Instrument variable building
    const variableTimer = variableBuildDuration.startTimer({ stage: 'narrative' });
    const variables = await context.promptVariables.narrative(master);
    variableTimer();

    // Instrument prompt building
    const promptTimer = promptBuildDuration.startTimer({ stage: 'narrative' });
    const prompts = await buildPcePrompt("narrative", variables, { validate: true });
    promptTimer();

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage: "narrative",
      template: "narrative",
      systemPrompt: prompts.system,
      userPrompt: prompts.user || undefined,
      metadata: {
        theme: ingredients.selections.theme,
        style: ingredients.selections.style
      },
      gameId: context.gameId,
      turnNumber: context.turnNumber
    });

    let parsed: unknown;
    try {
      parsed = parseStageJson(rawContent, metadata);
    } catch (error) {
      metadata.error = `JSON parse error: ${(error as Error).message}`;
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    if (!parsed || typeof parsed !== "object" || parsed === null) {
      metadata.error = "Narrative stage returned invalid payload";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const narration = typeof (parsed as any).narration === "string" ? (parsed as any).narration.trim() : "";
    const toneHintsRaw = (parsed as any).toneHints;
    const toneHints =
      Array.isArray(toneHintsRaw) && toneHintsRaw.every(item => typeof item === "string")
        ? toneHintsRaw
        : undefined;

    if (!narration) {
      metadata.error = "Narrative stage missing 'narration' field";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const output: NarrativePayload = {
      narration,
      toneHints
    };

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output,
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const timestamp = new Date().toISOString();
    const metadata: StageMetadata = {
      stage: "narrative",
      template: "narrative",
      ...llmCallErrorInfo(error),
      prompt: "",
      rawResponse: null,
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

export async function runImageStage(
  context: TurnGenerationContext,
  master: MasterEnrichmentData,
  narrative: NarrativePayload
): Promise<StageResult<ImagePromptPayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'image' });

  try {
    // Instrument variable building
    const variableTimer = variableBuildDuration.startTimer({ stage: 'image' });
    const variables = await context.promptVariables.image(master, narrative);
    variableTimer();

    // Instrument prompt building
    const promptTimer = promptBuildDuration.startTimer({ stage: 'image' });
    const prompts = await buildPcePrompt("image", variables, { validate: true });
    promptTimer();

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage: "image",
      template: "image",
      systemPrompt: prompts.system,
      userPrompt: prompts.user || undefined,
      metadata: {
        theme: ingredients.selections.theme,
        style: ingredients.selections.style,
        imageModelKey: ingredients.imageModelKey
      },
      gameId: context.gameId,
      turnNumber: context.turnNumber
    });

    let parsed: unknown;
    try {
      parsed = parseStageJson(rawContent, metadata);
    } catch (error) {
      metadata.error = `JSON parse error: ${(error as Error).message}`;
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    if (!parsed || typeof parsed !== "object" || parsed === null) {
      metadata.error = "Image stage returned invalid payload";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const imagePrompt = typeof (parsed as any).imagePrompt === "string" ? (parsed as any).imagePrompt.trim() : "";
    const modelOverrides = (parsed as any).modelOverrides;

    if (!imagePrompt) {
      metadata.error = "Image stage missing 'imagePrompt' field";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const output: ImagePromptPayload = {
      imagePrompt,
      modelOverrides:
        modelOverrides && typeof modelOverrides === "object" ? (modelOverrides as ImagePromptPayload["modelOverrides"]) : undefined
    };

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output,
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const timestamp = new Date().toISOString();
    const metadata: StageMetadata = {
      stage: "image",
      template: "image",
      ...llmCallErrorInfo(error),
      prompt: "",
      rawResponse: null,
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

export async function runActionsStage(
  context: TurnGenerationContext,
  master: MasterEnrichmentData,
  narrative: NarrativePayload
): Promise<StageResult<ActionsPayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'actions' });

  try {
    // Instrument variable building
    const variableTimer = variableBuildDuration.startTimer({ stage: 'actions' });
    const variables = await context.promptVariables.actions(master, narrative);
    variableTimer();

    // Instrument prompt building
    const promptTimer = promptBuildDuration.startTimer({ stage: 'actions' });
    const prompts = await buildPcePrompt("actions", variables, { validate: true });
    promptTimer();

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage: "actions",
      template: "actions",
      systemPrompt: prompts.system,
      userPrompt: prompts.user || undefined,
      metadata: {
        theme: ingredients.selections.theme,
        style: ingredients.selections.style
      },
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      maxTokens: 800
    });

    let parsed: unknown;
    try {
      parsed = parseStageJson(rawContent, metadata);
    } catch (error) {
      metadata.error = `JSON parse error: ${(error as Error).message}`;
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    if (!parsed || typeof parsed !== "object" || parsed === null) {
      metadata.error = "Actions stage returned invalid payload";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const actions = Array.isArray((parsed as any).actions) ? (parsed as any).actions : [];
    const normalized = actions
      .filter((action: any) => action && typeof action === "object")
      .map((action: any) => ({
        action: typeof action.action === "string" ? action.action : "",
        summary: typeof action.summary === "string" ? action.summary : "",
        risk: typeof action.risk === "string" ? action.risk : "Safe",
        intent: typeof action.intent === "string" ? action.intent : "other",
        usesItemId:
          action.usesItemId && typeof action.usesItemId === "string" ? action.usesItemId : undefined
      }))
      .filter((action: ActionChip) => action.action && action.summary && action.risk && action.intent) as ActionChip[];

    if (!normalized.length) {
      metadata.error = "Actions stage produced no valid actions";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    const output: ActionsPayload = {
      actions: normalized
    };

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output,
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const timestamp = new Date().toISOString();
    const metadata: StageMetadata = {
      stage: "actions",
      template: "actions",
      ...llmCallErrorInfo(error),
      prompt: "",
      rawResponse: null,
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}


const contentGenerationRouter = new ContentGenerationRouter({
  master: runMasterStage,
  narrative: runNarrativeStage,
  image: runImageStage,
  actions: runActionsStage
});

export interface TurnContentResult extends PceSelection {
  narration: string;
  imagePrompt: string;
  rawResponse?: string | null;
  toneHints?: string[];
  promptChain: StageMetadata[];
  masterEnrichment?: Record<string, unknown> | null;
  imageModelKey: string;
  fallbackUsed: boolean;
  imageMetadata?: ImagePromptPayload["modelOverrides"] | null;
  imagePromptSource: ImagePromptSource;
  actions?: ActionChip[]; // Actions generated by PCE pipeline (optional to maintain backward compatibility)
}

export async function generateTurnContent(
  state: GameState,
  playerAction: string,
  checks: any[],
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  triggeredEvent: { name: string; segment: string; skill: string } | null = null,
  options: { intro?: boolean } = {}
): Promise<TurnContentResult> {
  const built = await buildTurnGenerationContext(
    state,
    playerAction,
    checks,
    userPreferences,
    triggeredEvent,
    options
  );

  const { context, ingredients } = built;
  const result = await contentGenerationRouter.generateFullTurnContent(context);
  const narrativeOutput = result.narrative.output;
  const imageOutput = result.image.output;
  const actionsOutput = result.actions.output;

  const imageStageMetadata = result.image.metadata[result.image.metadata.length - 1];
  const imagePromptSource: ImagePromptSource = imageStageMetadata?.stage === "image" ? "pce" : "template";
  const overrideModelKey = (() => {
    const params = imageOutput?.modelOverrides?.params as Record<string, unknown> | undefined;
    if (params && typeof (params as any).modelKey === "string") {
      const value = ((params as any).modelKey as string).trim();
      if (value.length > 0) {
        return value;
      }
    }
    return undefined;
  })();

  const resolvedImageModelKey = overrideModelKey ?? ingredients.imageModelKey;

  const turnResult: TurnContentResult = {
    narration: narrativeOutput?.narration ?? "",
    toneHints: narrativeOutput?.toneHints,
    imagePrompt: imageOutput?.imagePrompt ?? "",
    imageMetadata: imageOutput?.modelOverrides,
    rawResponse: result.narrative.metadata[result.narrative.metadata.length - 1]?.rawResponse ?? null,
    promptChain: result.promptChain,
    masterEnrichment: result.master.output?.enrichment ?? null,
    theme: ingredients.selections.theme,
    style: ingredients.selections.style,
    imageModelKey: resolvedImageModelKey,
    fallbackUsed: result.fallbackUsed,
    imagePromptSource,
    actions: actionsOutput?.actions, // Extract actions from PCE pipeline to avoid redundant generation
  };

  if (!turnResult.narration) {
    // PCE must always produce narration - throw error instead of falling back
    const errorContext = {
      gameId: state.id,
      turnNumber: state.turnNumber,
      playerAction,
      checksCount: checks.length,
      narrativeOutput: narrativeOutput,
      imageOutput: imageOutput,
      actionsOutput: actionsOutput,
      promptChain: result.promptChain
    };
    console.error("[PCE_ERROR] PCE produced no narration", errorContext);
    throw new Error(`PCE turn generation failed: no narration produced. ${JSON.stringify(errorContext, null, 2)}`);
  }

  return turnResult;
}

export async function generateTurnContentWithFlag(
  state: GameState,
  playerAction: string,
  checks: any[],
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  options: { intro?: boolean } = {},
  triggeredEvent: { name: string; segment: string; skill: string } | null = null
): Promise<TurnContentResult> {
  console.log('[GAME_FLOW] generateTurnContentWithFlag', {
    options,
    playerAction: playerAction?.substring(0, 50),
    checksCount: checks.length,
    userPreferences,
    turnNumber: state.turnNumber
  });

  if (options.intro) {
    console.log('[GAME_FLOW] Intro turn using PCE path');
    // For intro turns, use empty checks and a default action
    return generateTurnContent(
      state,
      "Beginning the voyage to Uranus",
      [],
      userPreferences,
      null,
      { intro: true }
    );
  }

  console.log('[GAME_FLOW] Regular turn using PCE path');
  return generateTurnContent(state, playerAction, checks, userPreferences, triggeredEvent || null);
}

export async function generateNarrative(
  state: GameState,
  playerAction: string,
  checks: any[],
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  triggeredEvent: { name: string; segment: string; skill: string } | null = null
): Promise<string> {
  const result = await generateTurnContent(state, playerAction, checks, userPreferences, triggeredEvent);
  return result.narration;
}

export async function generateActions(
  state: GameState,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  preGeneratedNarrative: { narration: string; toneHints?: string[] }
): Promise<ActionChip[]> {
  const lastTurn = state.turns.length > 0 ? state.turns[state.turns.length - 1] : undefined;
  const referenceAction = lastTurn?.action ?? "Assess the situation carefully";
  const referenceChecks = Array.isArray(lastTurn?.checks) ? lastTurn!.checks : [];

  const built = await buildTurnGenerationContext(
    state,
    referenceAction,
    referenceChecks,
    userPreferences,
    null
  );

  const masterStage = await runMasterStage(built.context);
  if (!masterStage.ok || !masterStage.output) {
    const errorContext = {
      stage: 'master',
      gameId: state.id,
      turnNumber: state.turnNumber,
      error: !masterStage.ok ? 'Stage failed' : 'Unknown error',
      output: masterStage.output
    };
    console.error("[PCE_ACTIONS] Master stage failed", errorContext);
    throw new Error(`PCE actions generation failed: master stage failed. ${JSON.stringify(errorContext)}`);
  }

  // Use the provided pre-generated narrative (required - no fallback)
  console.log("[PCE_ACTIONS] Using pre-generated narrative", {
    gameId: state.id,
    turnNumber: state.turnNumber,
    narrationLength: preGeneratedNarrative.narration.length
  });

  const actionsStage = await runActionsStage(built.context, masterStage.output, preGeneratedNarrative);
  if (!actionsStage.ok || !actionsStage.output) {
    const errorContext = {
      stage: 'actions',
      gameId: state.id,
      turnNumber: state.turnNumber,
      error: !actionsStage.ok ? 'Stage failed' : 'Unknown error',
      output: actionsStage.output
    };
    console.error("[PCE_ACTIONS] Actions stage failed", errorContext);
    throw new Error(`PCE actions generation failed: actions stage failed. ${JSON.stringify(errorContext)}`);
  }

  return actionsStage.output.actions;
}

export async function mapCustomActionToIntent(customText: string): Promise<string> {
  const startTime = Date.now();

  try {
    const promptTemplate = await getPromptFromCache('intent_mapping');

    const variables = {
      CUSTOM_ACTION: customText
    };

    const systemPrompt = replaceVariables(promptTemplate.system, variables);
    const userPrompt = replaceVariables(promptTemplate.user, variables);

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_completion_tokens: 10
    });

    const intent = response.choices[0].message.content?.trim().toLowerCase() || "other";
    const executionTime = Date.now() - startTime;

    const validIntents = ['repair', 'negotiate', 'cook', 'explore', 'improvise', 'research', 'command', 'other'];
    const finalIntent = validIntents.includes(intent) ? intent : "other";

    await logLlmCall(
      'mapCustomActionToIntent',
      `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      intent,
      { model: 'gpt-4o-mini', variables, finalIntent },
      executionTime
    );

    return finalIntent;
  } catch (error) {
    console.error("Error mapping intent:", error);
    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'mapCustomActionToIntent',
      `Error: ${error}`,
      'other',
      { error: String(error), fallback: true },
      executionTime
    );

    return "other";
  }
}

interface ImageGenerationOptions {
  turnNumber?: number;
}

type ImagePromptContext = {
  template: any;
  finalPrompt: string;
  variables: Record<string, any>;
  promptSource: 'pce' | 'template';
  effectiveTemplateName: string;
  modelKey: string;
  modelOverrides?: ImagePromptPayload["modelOverrides"] | null;
};

type ImageGenerationResult = {
  imageUrl: string;
  promptUsed: string;
  templateName: string;
  promptSource: 'pce' | 'template';
  modelKey: string;
};

async function buildImagePromptContext(
  imagePrompt: string,
  gameState: GameState,
  options: ImageGenerationOptions = {},
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean }
): Promise<ImagePromptContext> {
  // Require imagePrompt from PCE - no template fallback
  if (!imagePrompt || typeof imagePrompt !== 'string' || imagePrompt.trim().length === 0) {
    const errorContext = {
      gameId: gameState.id,
      turnNumber: options.turnNumber ?? gameState.turnNumber,
      hasImagePrompt: !!imagePrompt,
      imagePromptType: typeof imagePrompt
    };
    console.error("[PCE] Image prompt missing in buildImagePromptContext", errorContext);
    throw new Error(`PCE image generation failed: imagePrompt is required. ${JSON.stringify(errorContext)}`);
  }

  const finalPrompt = imagePrompt.trim();
  const turnNumber = options.turnNumber ?? gameState.turnNumber;
  const targetTurn = gameState.turns.find(t => t.turnNumber === turnNumber) ?? gameState.turns.at(-1);
  const turnModelKey = targetTurn?.imageModelKey && typeof targetTurn.imageModelKey === "string"
    ? targetTurn.imageModelKey.trim()
    : undefined;
  const preferenceModelKey = userPreferences.imageModelKey && typeof userPreferences.imageModelKey === "string"
    ? userPreferences.imageModelKey.trim()
    : undefined;
  let resolvedModelKey = turnModelKey && turnModelKey.length > 0 ? turnModelKey : undefined;
  if (!resolvedModelKey) {
    resolvedModelKey = preferenceModelKey && preferenceModelKey.length > 0 ? preferenceModelKey : undefined;
  }
  if (!resolvedModelKey) {
    const fallbackModelKey = await getDefaultImageModelKey();
    if (fallbackModelKey && fallbackModelKey.trim().length > 0) {
      resolvedModelKey = fallbackModelKey.trim();
    }
  }
  if (!resolvedModelKey) {
    throw new Error("No image model key available for image generation");
  }

  const turnModelOverrides = targetTurn?.imageMetadata && typeof targetTurn.imageMetadata === "object"
    ? (targetTurn.imageMetadata as ImagePromptPayload["modelOverrides"])
    : null;

  const variables = {
    THEME: userPreferences.theme ?? '',
    STYLE: userPreferences.style ?? '',
    TURN_NUMBER: turnNumber,
    IMAGE_MODEL_KEY: resolvedModelKey,
    IMAGE_PROMPT: finalPrompt,
  };

  // Use default template metadata for size/quality (from modelOverrides or defaults)
  const defaultTemplate = {
    size: '1024x1024' as const,
    quality: 'high' as const,
    sceneTypes: [] as string[],
    tags: [] as string[]
  };

  return {
    template: defaultTemplate,
    finalPrompt,
    variables,
    promptSource: 'pce',
    effectiveTemplateName: 'pce_generated',
    modelKey: resolvedModelKey,
    modelOverrides: turnModelOverrides
  };
}

export async function generateImage(
  imagePrompt: string,
  gameState: GameState,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult | null> {
  const startTime = Date.now();

  try {
    // Require imagePrompt from PCE
    if (!imagePrompt || typeof imagePrompt !== 'string' || imagePrompt.trim().length === 0) {
      const errorContext = {
        gameId: gameState.id,
        turnNumber: options.turnNumber ?? gameState.turnNumber,
        hasImagePrompt: !!imagePrompt,
        imagePromptType: typeof imagePrompt
      };
      console.error("[PCE] Image prompt missing in generateImage", errorContext);
      throw new Error(`PCE image generation failed: imagePrompt is required. ${JSON.stringify(errorContext)}`);
    }

    const context = await buildImagePromptContext(imagePrompt.trim(), gameState, options, userPreferences);
    const { template, finalPrompt, variables, promptSource, effectiveTemplateName, modelKey, modelOverrides } = context;

    const backgroundValue = await getSettingFromReference('image_background_setting') || 'auto';
    const moderationValue = 'low'; // Always use low moderation

    let modelKeyToUse = modelKey || userPreferences.imageModelKey || (await getDefaultImageModelKey()) || '';
    if (!modelKeyToUse) {
      throw new Error("No image model key specified and no default model found in database");
    }

    const overrideParams = modelOverrides?.params as Record<string, unknown> | undefined;
    if (overrideParams && typeof (overrideParams as any).modelKey === "string") {
      const candidate = ((overrideParams as any).modelKey as string).trim();
      if (candidate.length > 0) {
        modelKeyToUse = candidate;
      }
    }

    let size = template.size as "1024x1024" | "1536x1024" | "1024x1536";
    let quality = template.quality as "low" | "medium" | "high" | "auto";
    let background = backgroundValue as "auto" | "transparent" | "opaque";
    const moderation = 'low' as const; // Always use low moderation

    if (overrideParams) {
      if (typeof (overrideParams as any).size === "string") {
        size = (overrideParams as any).size as typeof size;
      }
      if (typeof (overrideParams as any).quality === "string") {
        quality = (overrideParams as any).quality as typeof quality;
      }
      if (typeof (overrideParams as any).background === "string") {
        background = (overrideParams as any).background as typeof background;
      }
      // Moderation override removed - always "low"
    }

    // Generate cache keys and fingerprint
    const promptHash = generatePromptHash(finalPrompt);
    const variablesHash = generateVariablesHash(variables);
    const settings: ImageSettings = {
      size,
      quality,
      background,
      moderation
    };

    const sceneFingerprint = generateSceneFingerprint(
      effectiveTemplateName,
      gameState,
      variables,
      settings,
      Array.isArray(template.sceneTypes) ? template.sceneTypes : [],
      Array.isArray(template.tags) ? template.tags : []
    );

    // Check for exact cache match first
    let cachedImage = await storage.getGeneratedImageByHash(promptHash, variablesHash);

    if (cachedImage) {
      // Exact match found
      await storage.updateImageAccess(cachedImage.id);
      if (!cachedImage.filePath) {
        console.warn('[IMAGE_CACHE] Exact match missing filePath, treating as miss', { id: cachedImage.id, templateName: effectiveTemplateName });
      } else {
        try {
          const imageUrl = await loadImageFromFile(cachedImage.filePath);

          const executionTime = Date.now() - startTime;
          // Use provided preferences for logging if available
          const cachedModel = (cachedImage.metadata as any)?.model 
            || userPreferences.imageModelKey 
                || (await getDefaultImageModelKey()) 
                || '';
          await logLlmCall(
            'generateImage',
            finalPrompt,
            imageUrl.substring(0, 100) + '... [cached]',
            { 
              model: cachedModel, 
              templateName: effectiveTemplateName,
              variables,
              size,
              quality,
              background,
              moderation,
              cacheHit: true,
              cacheStrategy: 'exact',
              similarityScore: 1.0,
              cachedImageId: cachedImage.id
            },
            executionTime,
            gameState.id,
            gameState.turnNumber
          );

          return {
            imageUrl,
            promptUsed: finalPrompt,
            templateName: effectiveTemplateName,
            promptSource,
            modelKey: cachedModel
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('ENOENT')) {
            console.warn('[IMAGE_CACHE] File missing for cached image, treating as miss', {
              id: cachedImage.id,
              filePath: cachedImage.filePath,
              templateName: effectiveTemplateName
            });
            // Fall through to similarity check or new generation
          } else {
            throw error; // Re-throw non-file-not-found errors
          }
        }
      }
    }

    // Check for similar scenes if no exact match (unless similarity caching is disabled)
    const similarityCacheEnabled = process.env.IMAGE_SIMILARITY_CACHE_ENABLED !== 'false';
    const templateImages = similarityCacheEnabled ? await storage.getGeneratedImagesByTemplate(effectiveTemplateName) : [];
    if (templateImages.length > 0) {
      const candidateFingerprints = templateImages.map(img => img.sceneFingerprint as SceneFingerprint);
      const similarScenes = findSimilarScenes(sceneFingerprint, candidateFingerprints, 0.85);

      if (similarScenes.length > 0) {
        for (const match of similarScenes) {
          const bestMatchImage = templateImages.find(img => 
            JSON.stringify(img.sceneFingerprint) === JSON.stringify(match.fingerprint)
          );
          if (!bestMatchImage) continue;
          if (!bestMatchImage.filePath) {
            console.warn('[IMAGE_CACHE] Similar match missing filePath, skipping', { id: bestMatchImage.id, templateName: effectiveTemplateName });
            continue;
          }
          await storage.updateImageAccess(bestMatchImage.id);
          try {
            const imageUrl = await loadImageFromFile(bestMatchImage.filePath);

            const executionTime = Date.now() - startTime;
            // Use provided preferences for logging if available
            const cachedModel = (bestMatchImage.metadata as any)?.model 
              || userPreferences.imageModelKey 
                  || (await getDefaultImageModelKey()) 
                  || '';
            await logLlmCall(
              'generateImage',
              finalPrompt,
              imageUrl.substring(0, 100) + '... [similar]',
            {
              model: cachedModel,
              templateName: effectiveTemplateName,
              variables,
              size,
              quality,
              background,
              moderation,
              cacheHit: true,
              cacheStrategy: 'similar',
                similarityScore: match.similarity.overallSimilarity,
                narrativeSimilarity: match.similarity.narrativeSimilarity,
                contextSimilarity: match.similarity.contextSimilarity,
                actionSimilarity: match.similarity.actionSimilarity,
                visualSimilarity: match.similarity.visualSimilarity,
                cachedImageId: bestMatchImage.id
              },
              executionTime,
              gameState.id,
              gameState.turnNumber
            );

            return {
              imageUrl,
              promptUsed: finalPrompt,
              templateName: effectiveTemplateName,
              promptSource,
              modelKey: cachedModel
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('ENOENT')) {
              console.warn('[IMAGE_CACHE] File missing for similar cached image, skipping', {
                id: bestMatchImage.id,
                filePath: bestMatchImage.filePath,
                templateName: effectiveTemplateName
              });
              continue; // Try next similar match
            } else {
              throw error; // Re-throw non-file-not-found errors
            }
          }
        }
      }
    }

    // No cache hit - generate new image via provider abstraction
    const { generateWithModelKey } = await import("./image/index.js");
    const genRes = await generateWithModelKey(modelKeyToUse, {
      prompt: finalPrompt,
      size,
      quality,
      background,
      moderation,
    }, { cache: 'miss' });

    const imageUrl = genRes.imageUrl
      ? genRes.imageUrl
      : genRes.imageBase64
      ? `data:image/png;base64,${genRes.imageBase64}`
      : "";

    // Save to cache
    try {
      const { filePath, fileSize } = await saveImageToFile(imageUrl, {
        templateName: effectiveTemplateName,
        promptHash,
        variablesHash,
        gameId: gameState.id,
        turnNumber: gameState.turnNumber,
        generatedAt: new Date()
      });

      const themeForMetadata = userPreferences.theme ?? '';
      const styleForMetadata = userPreferences.style ?? '';
      
      await storage.createGeneratedImage({
        templateName: effectiveTemplateName,
        promptHash,
        variablesHash,
        filePath,
        fileSize,
        mimeType: 'image/png',
        sceneFingerprint,
        metadata: {
          variables,
          settings,
          promptUsed: finalPrompt,
          model: modelKeyToUse,
          promptSource,
          theme: themeForMetadata,
          style: styleForMetadata
        },
        promptSource,
        promptText: finalPrompt,
        gameId: gameState.id,
        turnNumber: gameState.turnNumber,
        accessCount: 1
      });
    } catch (cacheError) {
      console.warn('Failed to cache generated image:', cacheError);
    }

    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'generateImage',
      finalPrompt,
      imageUrl.substring(0, 100) + '... [generated]',
      { 
        model: modelKeyToUse, 
        templateName: effectiveTemplateName,
        variables,
        size,
        quality,
        background,
        moderation,
        cacheHit: false,
        cacheStrategy: 'none',
        similarityScore: 0
      },
      executionTime,
      gameState.id,
      gameState.turnNumber
    );

    return {
      imageUrl,
      promptUsed: finalPrompt,
      templateName: effectiveTemplateName,
      promptSource,
      modelKey: modelKeyToUse
    };
  } catch (error) {
    console.error("Error generating image:", error);
    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'generateImage',
      `ImagePrompt: ${imagePrompt.substring(0, 100)}`,
      'Error',
      { error: String(error), fallback: true },
      executionTime,
      gameState.id,
      gameState.turnNumber
    );

    return null;
  }
}

// Compute prompt/variable hashes exactly like generateImage, without any model calls
export async function computeImageKeys(
  templateName: string,
  gameState: GameState,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  options: ImageGenerationOptions = {}
): Promise<{ promptHash: string; variablesHash: string; template: any; variables: Record<string, any>; promptSource: 'pce' | 'template'; effectiveTemplateName: string; finalPrompt: string; modelKey: string; modelOverrides?: ImagePromptPayload["modelOverrides"] | null }> {
  const context = await buildImagePromptContext(templateName, gameState, options, userPreferences);
  const promptHash = generatePromptHash(context.finalPrompt);
  const variablesHash = generateVariablesHash(context.variables);

  return {
    promptHash,
    variablesHash,
    template: context.template,
    variables: context.variables,
    promptSource: context.promptSource,
    effectiveTemplateName: context.effectiveTemplateName,
    finalPrompt: context.finalPrompt,
    modelKey: context.modelKey,
    modelOverrides: context.modelOverrides ?? null
  };
}

export async function checkImageCache(
  templateName: string,
  gameState: GameState,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult | null> {
  const startTime = Date.now();
  try {
    // Compute cache keys exactly like generateImage does
    const { promptHash, variablesHash, template, variables, promptSource, effectiveTemplateName, finalPrompt, modelKey } = await computeImageKeys(templateName, gameState, userPreferences, options);
    
    const backgroundValue = await getSettingFromReference('image_background_setting') || 'auto';
    const moderationValue = 'low'; // Always use low moderation
    
    // Check for exact cache match
    const cachedImage = await storage.getGeneratedImageByHash(promptHash, variablesHash);
    if (cachedImage) {
      // Update access time and return cached image (if filePath is valid)
      await storage.updateImageAccess(cachedImage.id);
      if (cachedImage.filePath) {
        try {
          const imageUrl = await loadImageFromFile(cachedImage.filePath);
          
          const executionTime = Date.now() - startTime;
          // Use provided preferences for logging if available
          const cachedModel = (cachedImage.metadata as any)?.model 
            || userPreferences.imageModelKey 
            || modelKey
            || (await getDefaultImageModelKey()) 
            || '';
          
          // Log exact cache hit to database (consistent with generateImage)
          await logLlmCall(
            'checkImageCache',
            finalPrompt,
            imageUrl.substring(0, 100) + '... [cached]',
            { 
              model: cachedModel, 
              templateName: effectiveTemplateName,
              variables,
              size: template.size,
              quality: template.quality,
              background: backgroundValue,
              moderation: moderationValue,
              cacheHit: true,
              cacheStrategy: 'exact',
              similarityScore: 1.0,
              cachedImageId: cachedImage.id
            },
            executionTime,
            gameState.id,
            options.turnNumber ?? gameState.turnNumber
          );
          
          console.log('[IMAGE_CACHE] Exact cache hit', {
            templateName: effectiveTemplateName,
            turnNumber: options.turnNumber ?? gameState.turnNumber,
            gameId: gameState.id,
            cachedImageId: cachedImage.id.substring(0, 8),
            executionTimeMs: executionTime
          });
          
          return {
            imageUrl,
            promptUsed: (cachedImage.metadata as any)?.promptUsed || finalPrompt,
            templateName: templateName, // Return original templateName, not effectiveTemplateName
            promptSource,
            modelKey: cachedModel
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('ENOENT')) {
            console.warn('[IMAGE_CACHE] File missing for cached image, treating as miss', {
              id: cachedImage.id,
              filePath: cachedImage.filePath,
              templateName: effectiveTemplateName
            });
            // Continue to similarity check or return null
          } else {
            throw error; // Re-throw non-file-not-found errors
          }
        }
      } else {
        console.warn('[IMAGE_CACHE] Cached image missing filePath, treating as miss', {
          id: cachedImage.id,
          templateName: effectiveTemplateName
        });
      }
    }

    // Check for similar scenes if no exact match (unless similarity caching is disabled)
    const similarityCacheEnabled = process.env.IMAGE_SIMILARITY_CACHE_ENABLED !== 'false';
    if (!similarityCacheEnabled) {
      // Similarity caching disabled - only exact matches will be used
      return null;
    }
    
    const templateImages = await storage.getGeneratedImagesByTemplate(effectiveTemplateName);
    if (templateImages.length > 0) {
      const { generateSceneFingerprint, findSimilarScenes } = await import("./cacheUtils.js");
      
      const settings = {
        size: template.size,
        quality: template.quality,
        background: backgroundValue,
        moderation: moderationValue
      };

      const sceneFingerprint = generateSceneFingerprint(
        effectiveTemplateName,
        gameState,
        variables,
        settings,
        Array.isArray(template.sceneTypes) ? template.sceneTypes : [],
        Array.isArray(template.tags) ? template.tags : []
      );

      const candidateFingerprints = templateImages.map(img => img.sceneFingerprint as any);
      const similarScenes = findSimilarScenes(sceneFingerprint, candidateFingerprints, 0.85);

      if (similarScenes.length > 0) {
        for (const match of similarScenes) {
          const matched = templateImages.find(img => 
            JSON.stringify(img.sceneFingerprint) === JSON.stringify(match.fingerprint)
          );
          if (!matched) continue;
          if (!matched.filePath) {
            console.warn('[IMAGE_CACHE] Similar match missing filePath, skipping', { id: matched.id, templateName: effectiveTemplateName });
            continue;
          }
          await storage.updateImageAccess(matched.id);
          try {
            const imageUrl = await loadImageFromFile(matched.filePath);
            
            const executionTime = Date.now() - startTime;
            // Use provided preferences for logging if available
            const cachedModel = (matched.metadata as any)?.model 
              || userPreferences.imageModelKey 
              || modelKey
              || (await getDefaultImageModelKey()) 
              || '';
            
            // Log similarity cache hit to database (consistent with generateImage)
            await logLlmCall(
              'checkImageCache',
              finalPrompt,
              imageUrl.substring(0, 100) + '... [similar]',
              { 
                model: cachedModel, 
                templateName: effectiveTemplateName,
                variables,
                size: template.size,
                quality: template.quality,
                background: backgroundValue,
                moderation: moderationValue,
                cacheHit: true,
                cacheStrategy: 'similar',
                similarityScore: match.similarity.overallSimilarity,
                narrativeSimilarity: match.similarity.narrativeSimilarity,
                contextSimilarity: match.similarity.contextSimilarity,
                actionSimilarity: match.similarity.actionSimilarity,
                visualSimilarity: match.similarity.visualSimilarity,
                cachedImageId: matched.id
              },
              executionTime,
              gameState.id,
              options.turnNumber ?? gameState.turnNumber
            );
            
            console.log('[IMAGE_CACHE] Similarity cache hit', {
              templateName: effectiveTemplateName,
              turnNumber: options.turnNumber ?? gameState.turnNumber,
              gameId: gameState.id,
              cachedImageId: matched.id.substring(0, 8),
              similarityScore: match.similarity.overallSimilarity,
              narrativeSimilarity: match.similarity.narrativeSimilarity,
              contextSimilarity: match.similarity.contextSimilarity,
              actionSimilarity: match.similarity.actionSimilarity,
              visualSimilarity: match.similarity.visualSimilarity,
              executionTimeMs: executionTime
            });
            
            return {
              imageUrl,
              promptUsed: (matched.metadata as any)?.promptUsed || finalPrompt,
              templateName: templateName, // Return original templateName, not effectiveTemplateName
              promptSource,
              modelKey: cachedModel
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('ENOENT')) {
              console.warn('[IMAGE_CACHE] File missing for similar cached image, skipping', {
                id: matched.id,
                filePath: matched.filePath,
                templateName: effectiveTemplateName
              });
              continue; // Try next similar match
            } else {
              throw error; // Re-throw non-file-not-found errors
            }
          }
        }
      }
    }

    // No cache hit found
    return null;
  } catch (error) {
    console.error("Error checking image cache:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      gameId: gameState.id,
      turnNumber: options.turnNumber ?? gameState.turnNumber,
      templateName,
      error: error
    });
    return null;
  }
}

export async function testGenerateImage(
  templateName: string,
  customVariables: Record<string, string>
): Promise<{ 
  imageUrl: string; 
  promptUsed: string; 
  debugInfo: {
    model: string;
    size: string;
    quality: string;
    background: string;
    moderation: string;
    generationTime: number;
    variables: Record<string, string>;
  }
} | null> {
  const startTime = Date.now();

  try {
    const template = await getImagePromptByName(templateName);
    if (!template) {
      throw new Error(`Image prompt template "${templateName}" not found`);
    }

    const backgroundValue = await getSettingFromReference('image_background_setting') || 'auto';
    const moderationValue = 'low'; // Always use low moderation

    const finalPrompt = replaceVariables(template.compiledTemplate, customVariables);

    // Get default model key from reference or database
    const defaultModelKey = await getDefaultImageModelKey();
    const modelKey = (customVariables.imageModelKey as string) || defaultModelKey;
    if (!modelKey) {
      throw new Error("No image model key specified and no default model found in database");
    }

    const { generateWithModelKey } = await import("./image/index.js");
    const genRes = await generateWithModelKey(modelKey, {
      prompt: finalPrompt,
      size: template.size as "1024x1024" | "1536x1024" | "1024x1536",
      quality: template.quality as "low" | "medium" | "high" | "auto",
      background: backgroundValue as "auto" | "transparent" | "opaque",
      moderation: 'low' as const,
    }, { cache: 'miss' });

    const imageUrl = genRes.imageUrl
      ? genRes.imageUrl
      : genRes.imageBase64
      ? `data:image/png;base64,${genRes.imageBase64}`
      : "";

    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'testGenerateImage',
      finalPrompt,
      imageUrl.substring(0, 100) + '... [base64 data]',
      { 
        model: modelKey, 
        templateName,
        variables: customVariables,
        size: template.size,
        quality: template.quality,
        background: backgroundValue,
        moderation: moderationValue
      },
      executionTime
    );

    return {
      imageUrl,
      promptUsed: finalPrompt,
      debugInfo: {
        model: modelKey,
        size: template.size,
        quality: template.quality,
        background: backgroundValue,
        moderation: moderationValue,
        generationTime: executionTime,
        variables: customVariables
      }
    };
  } catch (error) {
    console.error("Error testing image generation:", error);
    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'testGenerateImage',
      `Template: ${templateName}`,
      'Error',
      { error: String(error), fallback: true },
      executionTime
    );

    throw error;
  }
}

export async function generateInterviewAnswer(question: string): Promise<string> {
  const startTime = Date.now();

  try {
    const promptTemplate = await getPromptFromCache('interview_answer');
    
    const variables = {
      CURRENT_QUESTION: question
    };

    const systemPrompt = replaceVariables(promptTemplate.system, variables);
    const userPrompt = replaceVariables(promptTemplate.user, variables);

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_completion_tokens: 200
    });

    const answer = response.choices[0].message.content || "I'm ready for this mission.";
    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'generateInterviewAnswer',
      userPrompt,
      answer,
      { question },
      executionTime
    );

    return answer;
  } catch (error) {
    console.error("Error generating interview answer:", error);
    const executionTime = Date.now() - startTime;

    await logLlmCall(
      'generateInterviewAnswer',
      `Question: ${question}`,
      'Error',
      { error: String(error), fallback: true },
      executionTime
    );

    throw error;
  }
}
