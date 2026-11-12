import type { ParsedTestRun, ParsedTestScenario, PceTestRun, PceTestScenario, GameState } from "@shared/schema";
import { storage } from "../storage";
import { getCurrentReferenceRelease } from "../reference/publishReference";
import { ContentGenerationRouter, type FullTurnContentResult, type StageMetadata, type TurnGenerationContext, type MasterEnrichmentData } from "./contentRouter";
import { buildTurnGenerationContext, getDefaultImageModelKey, getIngredients, executeJsonPrompt } from "../aiService";
import { buildPcePrompt, flattenMasterEnrichment } from "./promptBuilder";
import type { StageResult } from "./contentRouter";
import type { NarrativePayload, ImagePromptPayload, ActionsPayload } from "./contentRouter";
import { pceStageDuration, variableBuildDuration, promptBuildDuration } from "../metrics";
import { STAGE_OBJECT_KEYS, parseStageJson } from "../llm/json";
import { llmCallErrorInfo } from "../llm/clients";
import { requestModelId, type ResolvedLlmModel } from "../llm/models";

const PROMPT_COST_PER_1K = Number(process.env.PCE_PROMPT_COST_PER_1K ?? 0.00015);
const COMPLETION_COST_PER_1K = Number(process.env.PCE_COMPLETION_COST_PER_1K ?? 0.0006);

/**
 * Inspector-specific stage functions that load prompts directly from database
 */
async function runMasterStageFromDb(context: TurnGenerationContext): Promise<StageResult<MasterEnrichmentData>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'master' });

  try {
    const variableTimer = variableBuildDuration.startTimer({ stage: 'master' });
    const variables = await context.promptVariables.master();
    variableTimer();

    const promptTimer = promptBuildDuration.startTimer({ stage: 'master' });
    const prompts = await buildPcePrompt("master", variables, { validate: true, useDatabase: true });
    promptTimer();

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage: "master",
      template: "master",
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

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output,
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const metadata: StageMetadata = {
      stage: "master",
      template: "master",
      ...llmCallErrorInfo(error),
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      timestamp: new Date().toISOString()
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

async function runNarrativeStageFromDb(
  context: TurnGenerationContext,
  master: MasterEnrichmentData
): Promise<StageResult<NarrativePayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'narrative' });

  try {
    const variableTimer = variableBuildDuration.startTimer({ stage: 'narrative' });
    const variables = await context.promptVariables.narrative(master);
    variableTimer();

    const promptTimer = promptBuildDuration.startTimer({ stage: 'narrative' });
    const prompts = await buildPcePrompt("narrative", variables, { validate: true, useDatabase: true });
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
      metadata.error = "Narrative stage returned empty narration";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output: { narration, toneHints },
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const metadata: StageMetadata = {
      stage: "narrative",
      template: "narrative",
      ...llmCallErrorInfo(error),
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      timestamp: new Date().toISOString()
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

async function runImageStageFromDb(
  context: TurnGenerationContext,
  master: MasterEnrichmentData,
  narrative: NarrativePayload
): Promise<StageResult<ImagePromptPayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'image' });

  try {
    const variableTimer = variableBuildDuration.startTimer({ stage: 'image' });
    const variables = await context.promptVariables.image(master, narrative);
    variableTimer();

    const promptTimer = promptBuildDuration.startTimer({ stage: 'image' });
    const prompts = await buildPcePrompt("image", variables, { validate: true, useDatabase: true });
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
      metadata.error = "Image stage returned empty imagePrompt";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output: { imagePrompt, modelOverrides },
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const metadata: StageMetadata = {
      stage: "image",
      template: "image",
      ...llmCallErrorInfo(error),
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      timestamp: new Date().toISOString()
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

async function runActionsStageFromDb(
  context: TurnGenerationContext,
  master: MasterEnrichmentData,
  narrative: NarrativePayload
): Promise<StageResult<ActionsPayload>> {
  const ingredients = getIngredients(context);
  const stageTimer = pceStageDuration.startTimer({ stage: 'actions' });

  try {
    const variableTimer = variableBuildDuration.startTimer({ stage: 'actions' });
    const variables = await context.promptVariables.actions(master, narrative);
    variableTimer();

    const promptTimer = promptBuildDuration.startTimer({ stage: 'actions' });
    const prompts = await buildPcePrompt("actions", variables, { validate: true, useDatabase: true });
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
        action: typeof action.action === "string" ? action.action : String(action.action || ""),
        summary: typeof action.summary === "string" ? action.summary : undefined,
        risk: typeof action.risk === "string" ? action.risk : undefined,
        intent: typeof action.intent === "string" ? action.intent : undefined
      }));

    // Same rule as the live game: a turn with no actions cannot continue.
    if (!normalized.length) {
      metadata.error = "Actions stage produced no valid actions";
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    }

    stageTimer({ status: 'success' });
    return {
      ok: true,
      output: { actions: normalized },
      metadata: [metadata]
    };
  } catch (error) {
    stageTimer({ status: 'failure' });
    const metadata: StageMetadata = {
      stage: "actions",
      template: "actions",
      ...llmCallErrorInfo(error),
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      timestamp: new Date().toISOString()
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
}

const inspectorRouter = new ContentGenerationRouter({
  master: runMasterStageFromDb,
  narrative: runNarrativeStageFromDb,
  image: runImageStageFromDb,
  actions: runActionsStageFromDb
});

export interface RunPceTestOptions {
  scenarioId: string;
  mode?: 'full' | 'single-stage';
  targetStage?: 'master' | 'narrative' | 'image' | 'actions';
  useDataFromRunId?: string;
  mockData?: {
    masterEnrichment?: any;
    narrative?: string;
  };
  notes?: string;
  tags?: string;
  starred?: boolean;
  /** Story model to run with, replacing the scenario default. */
  llm?: ResolvedLlmModel;
}

interface TemplateVersionIds {
  master?: string;
  narrative?: string;
  image?: string;
  actions?: string;
}

interface StageResultsEnvelope {
  scenarioId: string;
  scenarioName: string;
  playerAction: string;
  selections: TurnGenerationContext["selections"];
  result: FullTurnContentResult;
  checks: NormalizedCheck[];
  triggeredEvent: NormalizedEvent | null;
  executedAt: string;
}

interface NormalizedCheck {
  skill: string;
  dc: number;
  roll: number;
  success: boolean;
  description?: string;
}

interface NormalizedEvent {
  name: string;
  segment: string;
  skill: string;
}

export function parseTestScenario(record: PceTestScenario): ParsedTestScenario {
  return {
    ...record,
    gameState: parseJsonField(record.gameStateJson, `Scenario ${record.id} has invalid game_state_json`),
    checks: parseOptionalJsonField(record.checksJson, []),
    triggeredEvent: parseOptionalJsonField(record.triggeredEventJson, null)
  };
}

export function parseTestRun(record: PceTestRun): ParsedTestRun {
  return {
    ...record,
    stageResults: parseOptionalJsonField(record.stageResultsJson, {})
  };
}

export async function runPceTest(options: RunPceTestOptions): Promise<ParsedTestRun> {
  const scenarioRecord = await storage.getPceTestScenario(options.scenarioId);
  if (!scenarioRecord) {
    throw new Error(`Scenario ${options.scenarioId} not found`);
  }

  const parsedScenario = parseTestScenario(scenarioRecord);
  const { context, normalizedChecks, normalizedEvent } = await buildContextFromScenario(parsedScenario, options.llm);

  const mode = options.mode ?? 'full';

  // If useDataFromRunId specified, load that run's data
  let actualMockData = options.mockData;
  if (options.useDataFromRunId) {
    const sourceRun = await storage.getPceTestRun(options.useDataFromRunId);
    if (!sourceRun) {
      throw new Error(`Source run not found: ${options.useDataFromRunId}`);
    }
    const sourceResults = JSON.parse(sourceRun.stageResultsJson) as StageResultsEnvelope;
    const sourceResult = sourceResults.result;
    
    actualMockData = {
      masterEnrichment: sourceResult?.master?.output ?? undefined,
      narrative: sourceResult?.narrative?.output?.narration ?? undefined
    };
  }

  const start = Date.now();
  let stageResults: FullTurnContentResult;
  
  try {
    if (mode === 'full') {
      // Standard full pipeline execution
      stageResults = await inspectorRouter.generateFullTurnContent(context);
    } else if (mode === 'single-stage') {
      if (!options.targetStage) {
        throw new Error('targetStage is required for single-stage mode');
      }
      // Single stage execution
      stageResults = await executeSingleStage(
        inspectorRouter,
        options.targetStage,
        context,
        actualMockData
      );
    } else {
      throw new Error(`Invalid mode: ${mode}`);
    }
  } catch (error: any) {
    const durationMs = Date.now() - start;
    const templateIds = await getActiveTemplateIds();
    const releaseVersion = (await getCurrentReferenceRelease())?.version ?? undefined;

    // Save failed test run
    const failedPayload: StageResultsEnvelope = {
      scenarioId: parsedScenario.id,
      scenarioName: parsedScenario.name,
      playerAction: parsedScenario.playerAction,
      selections: context.selections,
      result: {
        master: { ok: false, output: null, metadata: [] },
        narrative: { ok: false, output: null, metadata: [] },
        image: { ok: false, output: null, metadata: [] },
        actions: { ok: false, output: null, metadata: [] },
        promptChain: [],
        fallbackUsed: false
      },
      checks: normalizedChecks,
      triggeredEvent: normalizedEvent,
      executedAt: new Date().toISOString()
    };

    const failedRun = await storage.createPceTestRun({
      scenarioId: parsedScenario.id,
      releaseVersion,
      templateMasterId: templateIds.master,
      templateNarrativeId: templateIds.narrative,
      templateImageId: templateIds.image,
      templateActionsId: templateIds.actions,
      status: 'failure',
      stageResultsJson: JSON.stringify({ ...failedPayload, error: error.message, stack: error.stack }),
      durationMs,
      notes: `Error: ${error.message}`,
      tags: options.tags ?? undefined,
      starred: options.starred ?? false
    });

    throw error;
  }

  const durationMs = Date.now() - start;

  const tokenStats = calculateTokensFromResult(stageResults.promptChain);
  const estimatedCostUsd = estimateCost(tokenStats.promptTokens, tokenStats.completionTokens, context.llmModel);

  const templateIds = await getActiveTemplateIds();
  const releaseVersion = (await getCurrentReferenceRelease())?.version ?? undefined;

  const payload: StageResultsEnvelope = {
    scenarioId: parsedScenario.id,
    scenarioName: parsedScenario.name,
    playerAction: parsedScenario.playerAction,
    selections: context.selections,
    result: stageResults,
    checks: normalizedChecks,
    triggeredEvent: normalizedEvent,
    executedAt: new Date().toISOString()
  };

  const status = determineRunStatus(stageResults);

  const created = await storage.createPceTestRun({
    scenarioId: parsedScenario.id,
    releaseVersion,
    templateMasterId: templateIds.master,
    templateNarrativeId: templateIds.narrative,
    templateImageId: templateIds.image,
    templateActionsId: templateIds.actions,
    status,
    stageResultsJson: JSON.stringify(payload),
    durationMs,
    totalTokensPrompt: tokenStats.promptTokens,
    totalTokensResponse: tokenStats.completionTokens,
    estimatedCostUsd,
    notes: options.notes ?? undefined,
    tags: options.tags ?? undefined,
    starred: options.starred ?? false
  });

  return parseTestRun(created);
}

/**
 * Execute a single stage with optional mock upstream data
 */
async function executeSingleStage(
  router: ContentGenerationRouter,
  stage: 'master' | 'narrative' | 'image' | 'actions',
  context: TurnGenerationContext,
  mockData?: { masterEnrichment?: any; narrative?: string }
): Promise<FullTurnContentResult> {
  const promptChain: StageMetadata[] = [];

  switch (stage) {
    case 'master': {
      // Master has no upstream dependencies - use DB-loaded stage function
      const masterResult = await runMasterStageFromDb(context);
      promptChain.push(...masterResult.metadata);

      if (!masterResult.ok || !masterResult.output) {
        throw new Error('Master enrichment failed');
      }

      return {
        master: masterResult,
        narrative: { ok: false, output: null, metadata: [] },
        image: { ok: false, output: null, metadata: [] },
        actions: { ok: false, output: null, metadata: [] },
        promptChain,
        fallbackUsed: false
      };
    }

    case 'narrative': {
      // Narrative requires master enrichment
      let masterEnrichment: StageResult<MasterEnrichmentData>;
      
      if (mockData?.masterEnrichment) {
        // Normalize mock data to MasterEnrichmentData format
        const normalizedMock: MasterEnrichmentData = {
          enrichment: mockData.masterEnrichment.enrichment ?? mockData.masterEnrichment,
          flattened: mockData.masterEnrichment.flattened ?? {}
        };
        masterEnrichment = { ok: true, output: normalizedMock, metadata: [] };
      } else {
        masterEnrichment = await runMasterStageFromDb(context);
      }

      if (!masterEnrichment.ok || !masterEnrichment.output) {
        throw new Error('Master enrichment failed');
      }

      const narrativeResult = await runNarrativeStageFromDb(context, masterEnrichment.output);
      promptChain.push(...(mockData?.masterEnrichment ? [] : masterEnrichment.metadata));
      promptChain.push(...narrativeResult.metadata);

      if (!narrativeResult.ok || !narrativeResult.output) {
        throw new Error('Narrative generation failed');
      }

      return {
        master: masterEnrichment,
        narrative: narrativeResult,
        image: { ok: false, output: null, metadata: [] },
        actions: { ok: false, output: null, metadata: [] },
        promptChain,
        fallbackUsed: false
      };
    }

    case 'image': {
      // Image requires both master enrichment and narrative
      let masterEnrichment: StageResult<MasterEnrichmentData>;
      
      if (mockData?.masterEnrichment) {
        // Normalize mock data to MasterEnrichmentData format
        const normalizedMock: MasterEnrichmentData = {
          enrichment: mockData.masterEnrichment.enrichment ?? mockData.masterEnrichment,
          flattened: mockData.masterEnrichment.flattened ?? {}
        };
        masterEnrichment = { ok: true, output: normalizedMock, metadata: [] };
      } else {
        masterEnrichment = await runMasterStageFromDb(context);
      }

      if (!masterEnrichment.ok || !masterEnrichment.output) {
        throw new Error('Master enrichment failed');
      }

      const narrativeData = mockData?.narrative
        ? { ok: true, output: { narration: mockData.narrative }, metadata: [] }
        : await runNarrativeStageFromDb(context, masterEnrichment.output);

      if (!narrativeData.ok || !narrativeData.output) {
        throw new Error('Narrative generation failed');
      }

      const imageResult = await runImageStageFromDb(context, masterEnrichment.output, narrativeData.output);
      promptChain.push(...(mockData?.masterEnrichment ? [] : masterEnrichment.metadata));
      promptChain.push(...(mockData?.narrative ? [] : narrativeData.metadata));
      promptChain.push(...imageResult.metadata);

      if (!imageResult.ok || !imageResult.output) {
        throw new Error('Image prompt generation failed');
      }

      return {
        master: masterEnrichment,
        narrative: narrativeData,
        image: imageResult,
        actions: { ok: false, output: null, metadata: [] },
        promptChain,
        fallbackUsed: false
      };
    }

    case 'actions': {
      // Actions requires both master enrichment and narrative
      let masterEnrichment: StageResult<MasterEnrichmentData>;
      
      if (mockData?.masterEnrichment) {
        // Normalize mock data to MasterEnrichmentData format
        const normalizedMock: MasterEnrichmentData = {
          enrichment: mockData.masterEnrichment.enrichment ?? mockData.masterEnrichment,
          flattened: mockData.masterEnrichment.flattened ?? {}
        };
        masterEnrichment = { ok: true, output: normalizedMock, metadata: [] };
      } else {
        masterEnrichment = await runMasterStageFromDb(context);
      }

      if (!masterEnrichment.ok || !masterEnrichment.output) {
        throw new Error('Master enrichment failed');
      }

      const narrativeData = mockData?.narrative
        ? { ok: true, output: { narration: mockData.narrative }, metadata: [] }
        : await runNarrativeStageFromDb(context, masterEnrichment.output);

      if (!narrativeData.ok || !narrativeData.output) {
        throw new Error('Narrative generation failed');
      }

      const actionsResult = await runActionsStageFromDb(context, masterEnrichment.output, narrativeData.output);
      promptChain.push(...(mockData?.masterEnrichment ? [] : masterEnrichment.metadata));
      promptChain.push(...(mockData?.narrative ? [] : narrativeData.metadata));
      promptChain.push(...actionsResult.metadata);

      if (!actionsResult.ok || !actionsResult.output) {
        throw new Error('Actions generation failed');
      }

      return {
        master: masterEnrichment,
        narrative: narrativeData,
        image: { ok: false, output: null, metadata: [] },
        actions: actionsResult,
        promptChain,
        fallbackUsed: false
      };
    }

    default:
      throw new Error(`Invalid stage: ${stage}`);
  }
}

export async function buildContextFromScenario(
  scenario: ParsedTestScenario,
  llmOverride?: ResolvedLlmModel,
  llmFallbackOverride?: ResolvedLlmModel | null
): Promise<{
  context: TurnGenerationContext;
  normalizedChecks: NormalizedCheck[];
  normalizedEvent: NormalizedEvent | null;
}> {
  const normalizedState = normalizeGameState(scenario);
  const normalizedChecks = normalizeChecks(scenario.checks);
  const normalizedEvent = normalizeTriggeredEvent(scenario.triggeredEvent);

  const userPreferences = {
    theme: scenario.theme ?? undefined,
    style: scenario.style ?? undefined,
    imageModelKey: scenario.imageModelKey ?? (await getDefaultImageModelKey()) ?? undefined
  };

  const built = await buildTurnGenerationContext(
    normalizedState,
    scenario.playerAction,
    normalizedChecks,
    userPreferences,
    normalizedEvent,
    { intro: normalizedState.turnNumber === 1, llmOverride, llmFallbackOverride }
  );

  return { context: built.context, normalizedChecks, normalizedEvent };
}

/** Token totals for a run. Uses the provider's real counts when reported, else a length estimate. */
export function calculateTokensFromResult(promptChain: StageMetadata[]): {
  promptTokens: number;
  completionTokens: number;
} {
  const promptTokens = promptChain.reduce(
    (sum, meta) => sum + (meta.usage?.promptTokens ?? estimateTokens(meta.prompt)),
    0
  );
  const completionTokens = promptChain.reduce(
    (sum, meta) => sum + (meta.usage?.completionTokens ?? estimateTokens(meta.rawResponse)),
    0
  );
  return { promptTokens, completionTokens };
}

/**
 * Cost of a run in USD. Uses the model's catalog price (per 1M tokens) when known;
 * otherwise the legacy flat rate, which matches gpt-4o-mini.
 */
export function estimateCost(promptTokens: number, completionTokens: number, llm?: ResolvedLlmModel): number {
  const hasCatalogPrice = llm && llm.priceInput !== null && llm.priceOutput !== null;
  const promptCost = hasCatalogPrice
    ? (promptTokens / 1_000_000) * llm.priceInput!
    : (promptTokens / 1000) * PROMPT_COST_PER_1K;
  const completionCost = hasCatalogPrice
    ? (completionTokens / 1_000_000) * llm.priceOutput!
    : (completionTokens / 1000) * COMPLETION_COST_PER_1K;
  return Number((promptCost + completionCost).toFixed(6));
}

export type QualificationStage = "master" | "narrative" | "image" | "actions";

/**
 * How a qualification run went, best to worst:
 *  clean     every stage returned valid JSON on the first try
 *  repaired  completed on the model's own output, but needed JSON repair and/or a retry
 *  fallback  completed only because the fallback model stepped in for at least one stage
 *  failed    the turn could not be completed
 */
export type QualificationVerdict = "clean" | "repaired" | "fallback" | "failed";

export interface QualificationStageReport {
  stage: QualificationStage;
  /** False when an earlier stage failed and this one could not run. */
  ran: boolean;
  ok: boolean;
  /** Error of the final attempt, when the stage failed. */
  error?: string;
  /** Model calls made for this stage (1 unless a retry or fallback was needed). */
  attempts: number;
  /** What it took: nothing, a retry of the same model, or the fallback model. */
  recovery: "none" | "retry" | "fallback";
  /** Model whose output was used (differs from the tested model after a fallback). */
  servedBy?: string;
  /** Why the first attempt was not good enough, when there was more than one. */
  firstError?: string;
  /** How the used output was read: raw, extracted, repaired or salvaged (see server/llm/json.ts). */
  jsonQuality?: StageMetadata["jsonQuality"];
  /** Time across all attempts. */
  durationMs?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  finishReason?: string | null;
  /** Short human summary of what the stage produced. */
  detail?: string;
}

export interface QualificationResult {
  runId: string;
  scenarioId: string;
  model: string;
  modelKey: string | null;
  provider: string;
  /** Fallback model that was available to the run, if any. */
  fallbackModel: string | null;
  verdict: QualificationVerdict;
  /** The turn completed (any verdict but "failed"). */
  ok: boolean;
  /** verdict === "clean". */
  strictOk: boolean;
  /** Wall-clock time for the whole turn (actions and image run in parallel). */
  turnMs: number;
  promptTokens: number;
  completionTokens: number;
  /** Null when the model has no catalog price. Fallback calls are priced at the tested model's rate. */
  costUsd: number | null;
  stages: QualificationStageReport[];
  narration?: string;
  imagePrompt?: string;
  actions?: string[];
}

/**
 * Run one scenario through the real four-stage pipeline with a given model and report
 * how it did. It goes through the same repair, retry and fallback steps as a live turn,
 * and records which of them each stage needed. Unlike a normal inspector run it never
 * throws on a stage failure. The run is saved like any PCE Inspector run, tagged with
 * the model.
 */
export async function runModelQualification(options: {
  scenarioId: string;
  llm: ResolvedLlmModel;
  /** Model to fall back to, as the game would. Null or omitted: no fallback. */
  llmFallback?: ResolvedLlmModel | null;
}): Promise<QualificationResult> {
  const scenarioRecord = await storage.getPceTestScenario(options.scenarioId);
  if (!scenarioRecord) {
    throw new Error(`Scenario ${options.scenarioId} not found`);
  }
  const parsedScenario = parseTestScenario(scenarioRecord);
  const { context, normalizedChecks, normalizedEvent } = await buildContextFromScenario(
    parsedScenario,
    options.llm,
    options.llmFallback ?? null
  );

  const notRun = <T,>(): StageResult<T> => ({ ok: false, output: null, metadata: [] });
  let master: StageResult<MasterEnrichmentData> = notRun();
  let narrative: StageResult<NarrativePayload> = notRun();
  let image: StageResult<ImagePromptPayload> = notRun();
  let actions: StageResult<ActionsPayload> = notRun();

  const start = Date.now();
  master = await inspectorRouter.generateMasterEnrichment(context);
  if (master.ok && master.output?.enrichment) {
    narrative = await inspectorRouter.generateNarrative(context, master.output);
    if (narrative.ok && narrative.output) {
      [actions, image] = await Promise.all([
        inspectorRouter.generateActions(context, master.output, narrative.output),
        inspectorRouter.generateImagePrompt(context, master.output, narrative.output)
      ]);
    }
  }
  const turnMs = Date.now() - start;

  const promptChain = [...master.metadata, ...narrative.metadata, ...actions.metadata, ...image.metadata];
  const result: FullTurnContentResult = { master, narrative, image, actions, promptChain, fallbackUsed: false };

  const sum = (values: Array<number | null | undefined>): number | null => {
    const known = values.filter((v): v is number => typeof v === "number");
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
  };

  const report = (
    stage: QualificationStage,
    stageResult: StageResult<unknown>,
    detail: string | undefined
  ): QualificationStageReport => {
    const attempts = stageResult.metadata;
    const used = attempts[attempts.length - 1];
    if (!used) return { stage, ran: false, ok: false, attempts: 0, recovery: "none" };
    const ok = stageResult.ok && stageResult.output !== null;
    return {
      stage,
      ran: true,
      ok,
      error: ok ? undefined : used.error,
      attempts: attempts.length,
      recovery: used.recovery ?? "none",
      servedBy: used.model,
      firstError: attempts.length > 1 ? attempts[0].error : undefined,
      jsonQuality: used.jsonQuality,
      durationMs: sum(attempts.map((m) => m.durationMs)) ?? undefined,
      promptTokens: sum(attempts.map((m) => m.usage?.promptTokens)),
      completionTokens: sum(attempts.map((m) => m.usage?.completionTokens)),
      finishReason: used.finishReason ?? null,
      detail
    };
  };

  const actionLabels = (actions.output?.actions ?? []).map((a) => a.action).filter(Boolean);
  const stages: QualificationStageReport[] = [
    report("master", master, master.output?.enrichment ? `${Object.keys(master.output.enrichment).length} fields` : undefined),
    report("narrative", narrative, narrative.output ? `${narrative.output.narration.length} characters` : undefined),
    report("actions", actions, actions.output ? `${actionLabels.length} actions` : undefined),
    report("image", image, image.output ? `${image.output.imagePrompt.length} characters` : undefined)
  ];
  // The game needs at least one action to continue; an empty list is a failure in practice.
  const actionsReport = stages[2];
  if (actionsReport.ran && actionsReport.ok && actionLabels.length === 0) {
    actionsReport.ok = false;
    actionsReport.error = "Returned no actions";
  }

  const ok = stages.every((s) => s.ran && s.ok);
  const verdict: QualificationVerdict = !ok
    ? "failed"
    : stages.some((s) => s.recovery === "fallback")
    ? "fallback"
    : stages.every((s) => s.attempts === 1 && s.jsonQuality === "raw")
    ? "clean"
    : "repaired";
  const tokenStats = calculateTokensFromResult(promptChain);
  const hasPrice = options.llm.priceInput !== null && options.llm.priceOutput !== null;
  const costUsd = hasPrice ? estimateCost(tokenStats.promptTokens, tokenStats.completionTokens, options.llm) : null;
  const model = requestModelId(options.llm);

  const templateIds = await getActiveTemplateIds();
  const releaseVersion = (await getCurrentReferenceRelease())?.version ?? undefined;
  const payload: StageResultsEnvelope = {
    scenarioId: parsedScenario.id,
    scenarioName: parsedScenario.name,
    playerAction: parsedScenario.playerAction,
    selections: context.selections,
    result,
    checks: normalizedChecks,
    triggeredEvent: normalizedEvent,
    executedAt: new Date().toISOString()
  };
  const firstError = stages.find((s) => s.error)?.error;
  const created = await storage.createPceTestRun({
    scenarioId: parsedScenario.id,
    releaseVersion,
    templateMasterId: templateIds.master,
    templateNarrativeId: templateIds.narrative,
    templateImageId: templateIds.image,
    templateActionsId: templateIds.actions,
    status: ok ? "success" : determineRunStatus(result),
    stageResultsJson: JSON.stringify(payload),
    durationMs: turnMs,
    totalTokensPrompt: tokenStats.promptTokens,
    totalTokensResponse: tokenStats.completionTokens,
    estimatedCostUsd: costUsd ?? undefined,
    notes: `Model qualification: ${model} (${verdict})${firstError ? ` — ${firstError}` : ""}`,
    tags: `qualify,model:${model}`,
    starred: false
  });

  return {
    runId: created.id,
    scenarioId: parsedScenario.id,
    model,
    modelKey: options.llm.key,
    provider: options.llm.provider,
    fallbackModel: options.llmFallback ? requestModelId(options.llmFallback) : null,
    verdict,
    ok,
    strictOk: verdict === "clean",
    turnMs,
    promptTokens: tokenStats.promptTokens,
    completionTokens: tokenStats.completionTokens,
    costUsd,
    stages,
    narration: narrative.output?.narration,
    imagePrompt: image.output?.imagePrompt,
    actions: actionLabels
  };
}

async function getActiveTemplateIds(): Promise<TemplateVersionIds> {
  const names: Record<keyof TemplateVersionIds, string> = {
    master: "pce_master",
    narrative: "pce_narrative",
    image: "pce_image",
    actions: "pce_actions"
  };

  const entries = await Promise.all(
    Object.entries(names).map(async ([key, name]) => {
      const template = await storage.getPromptTemplate(name);
      return [key, template?.id] as const;
    })
  );

  return entries.reduce((acc, [key, value]) => {
    if (value) {
      acc[key as keyof TemplateVersionIds] = value;
    }
    return acc;
  }, {} as TemplateVersionIds);
}

function determineRunStatus(result: FullTurnContentResult): PceTestRun["status"] {
  const masterOk = result.master.ok && !!result.master.output;
  const narrativeOk = result.narrative.ok && !!result.narrative.output;
  const imageOk = result.image.ok && !!result.image.output;
  const actionsOk = result.actions.ok && !!result.actions.output;

  if (masterOk && narrativeOk && imageOk && actionsOk) {
    return "success";
  }
  if (masterOk && narrativeOk) {
    return "partial_success";
  }
  return "failure";
}

function parseJsonField<T>(value: string | null | undefined, errorMessage: string): T {
  if (value === null || value === undefined) {
    throw new Error(errorMessage);
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(errorMessage);
  }
}

function parseOptionalJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return fallback;
  }
}

function normalizeGameState(scenario: ParsedTestScenario): GameState {
  const raw = scenario.gameState as Record<string, any>;
  if (!raw || typeof raw !== "object") {
    throw new Error(`Scenario ${scenario.id} is missing a valid game_state_json object`);
  }

  const ensureNumber = (input: unknown, defaultValue: number): number => {
    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }
    if (typeof input === "string" && input.trim() !== "" && !isNaN(Number(input))) {
      return Number(input);
    }
    return defaultValue;
  };

  const stats = raw.stats || {};
  const resolvedStats = {
    hull: ensureNumber(stats.hull ?? raw.hull, 100),
    oxygen: ensureNumber(stats.oxygen ?? raw.oxygen, 100),
    fuel: ensureNumber(stats.fuel ?? raw.fuel, 100),
    food: ensureNumber(stats.food ?? raw.food, 100),
    morale: ensureNumber(stats.morale ?? raw.morale, 100),
    weirdness: ensureNumber(stats.weirdness ?? raw.weirdness, 0)
  };

  const coerceArray = <T = unknown>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? value : fallback);

  const gameState: GameState = {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `scenario-${scenario.id}`,
    username: typeof raw.username === "string" && raw.username.length > 0 ? raw.username : "pce-inspector",
    seed: typeof raw.seed === "string" && raw.seed.length > 0 ? raw.seed : "pce-seed",
    day: ensureNumber(raw.day, 1),
    turnNumber: ensureNumber(raw.turnNumber, 1),
    segment: (raw.segment ?? "Launch from Earth") as GameState["segment"],
    absurdity: ensureNumber(raw.absurdity, 2),
    stats: resolvedStats,
    npcs: coerceArray(raw.npcs, []) as GameState["npcs"],
    equippedItems: coerceArray(raw.equippedItems, []) as GameState["equippedItems"],
    turns: coerceArray(raw.turns, []) as GameState["turns"],
    currentActions: coerceArray(raw.currentActions, []) as GameState["currentActions"],
    runningGags: coerceArray(raw.runningGags, []) as GameState["runningGags"],
    eventHistory: coerceArray(raw.eventHistory, []) as GameState["eventHistory"],
    interviewResponses:
      raw.interviewResponses && typeof raw.interviewResponses === "object"
        ? (raw.interviewResponses as GameState["interviewResponses"])
        : {},
    isComplete: Boolean(raw.isComplete),
    failureReason: typeof raw.failureReason === "string" ? raw.failureReason : undefined,
  };

  return gameState;
}

function normalizeChecks(value: unknown): NormalizedCheck[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: any): NormalizedCheck => {
    const skill = typeof entry?.skill === "string" ? entry.skill : "Unknown";
    const dc = typeof entry?.dc === "number" ? entry.dc : typeof entry?.difficulty === "number" ? entry.difficulty : 12;
    const roll =
      typeof entry?.roll === "number"
        ? entry.roll
        : typeof entry?.result === "number"
        ? entry.result
        : typeof entry?.value === "number"
        ? entry.value
        : 0;
    const success = typeof entry?.success === "boolean"
      ? entry.success
      : typeof entry?.result === "string"
      ? entry.result.toLowerCase().includes("success")
      : entry?.outcome
      ? String(entry.outcome).toLowerCase().includes("success")
      : false;

    return {
      skill,
      dc,
      roll,
      success,
      description: typeof entry?.description === "string" ? entry.description : undefined
    };
  });
}

function normalizeTriggeredEvent(value: unknown): NormalizedEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const name = typeof (value as any).name === "string" ? (value as any).name : "Unknown Event";
  const segment = typeof (value as any).segment === "string" ? (value as any).segment : "unknown";
  const skill = typeof (value as any).skill === "string" ? (value as any).skill : "unknown";
  return { name, segment, skill };
}

function estimateTokens(input?: string | null): number {
  if (!input || typeof input !== "string") {
    return 0;
  }
  return Math.ceil(input.length / 4);
}
