import type { ParsedTestRun, ParsedTestScenario, PceTestRun, PceTestScenario, GameState } from "@shared/schema";
import { storage } from "../storage";
import { getCurrentReferenceRelease } from "../reference/publishReference";
import type {
  FullTurnContentResult,
  MasterEnrichmentData,
  PromptStage,
  StageMetadata,
  StageResult,
  TurnGenerationContext
} from "./contentRouter";
import { buildTurnGenerationContext, getDefaultImageModelKey } from "../aiService";
import { runPceGraph } from "./graph";
import { verdictFromStages, type StructuralVerdict } from "./verdict";
import { requestModelId, type ResolvedLlmModel } from "../llm/models";
import { currentRootTraceRef, withSpan, type TraceRef } from "../observability/langsmith";

const PROMPT_COST_PER_1K = Number(process.env.PCE_PROMPT_COST_PER_1K ?? 0.00015);
const COMPLETION_COST_PER_1K = Number(process.env.PCE_COMPLETION_COST_PER_1K ?? 0.0006);

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
  /** Where this run is in LangSmith, when tracing is on. */
  trace?: TraceRef;
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
  let trace: TraceRef | undefined;
  
  try {
    stageResults = await withSpan(
      "pce.inspector",
      {
        inputs: {
          scenarioId: parsedScenario.id,
          scenario: parsedScenario.name,
          playerAction: parsedScenario.playerAction,
          mode,
          targetStage: options.targetStage ?? null,
          usesMockData: !!actualMockData?.masterEnrichment || !!actualMockData?.narrative
        },
        metadata: { scenarioId: parsedScenario.id, promptSource: "database", source: "pce-inspector" },
        tags: ["pce-inspector"],
        outputs: (r) => ({
          narration: r.narrative.output?.narration ?? null,
          actions: (r.actions.output?.actions ?? []).map((a) => a.action),
          imagePrompt: r.image.output?.imagePrompt ?? null,
          modelCalls: r.promptChain.length
        })
      },
      async () => {
        trace = currentRootTraceRef();
        if (mode === 'full') {
          // The whole turn, on the draft prompts, with retry and fallback as in a live turn.
          return runPceGraph(context, { promptSource: "database" });
        }
        if (mode === 'single-stage') {
          if (!options.targetStage) {
            throw new Error('targetStage is required for single-stage mode');
          }
          return executeSingleStage(options.targetStage, context, actualMockData);
        }
        throw new Error(`Invalid mode: ${mode}`);
      }
    );
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
      executedAt: new Date().toISOString(),
      trace
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
    executedAt: new Date().toISOString(),
    trace
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

/** Error thrown when a single-stage run cannot produce its target (or a stage it depends on). */
const SINGLE_STAGE_FAILURE: Record<PromptStage, string> = {
  master: "Master enrichment failed",
  narrative: "Narrative generation failed",
  image: "Image prompt generation failed",
  actions: "Actions generation failed"
};

/**
 * Run one stage on the draft prompts. Upstream stages come from `mockData` when given
 * and are run otherwise. Each stage runs once: no retry or fallback, so a prompt problem
 * shows up as it is.
 */
async function executeSingleStage(
  stage: PromptStage,
  context: TurnGenerationContext,
  mockData?: { masterEnrichment?: any; narrative?: string }
): Promise<FullTurnContentResult> {
  // Mock data may be a saved stage output ({ enrichment, flattened }) or a bare plan.
  const master: MasterEnrichmentData | undefined = mockData?.masterEnrichment
    ? {
        enrichment: mockData.masterEnrichment.enrichment ?? mockData.masterEnrichment,
        flattened: mockData.masterEnrichment.flattened ?? {}
      }
    : undefined;
  const narrative = mockData?.narrative ? { narration: mockData.narrative } : undefined;

  const result = await runPceGraph(context, {
    promptSource: "database",
    target: stage,
    upstream: { master, narrative },
    recover: false,
    mode: "lenient"
  });

  const needed: PromptStage[] = stage === "master" ? ["master"] : stage === "narrative" ? ["master", "narrative"] : ["master", "narrative", stage];
  for (const name of needed) {
    const stageResult = result[name] as StageResult<unknown>;
    if (!stageResult.ok || !stageResult.output) {
      throw new Error(SINGLE_STAGE_FAILURE[name]);
    }
  }
  return result;
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

/** How a qualification run went. See server/pce/verdict.ts for what each value means. */
export type QualificationVerdict = StructuralVerdict;

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
  /** Where this run is in LangSmith, when tracing is on. */
  trace?: TraceRef;
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

  const model = requestModelId(options.llm);
  let trace: TraceRef | undefined;

  const start = Date.now();
  // Lenient: a stage that fails ends the run without throwing, and what did run is reported.
  const result = await withSpan(
    "pce.qualify",
    {
      inputs: {
        scenarioId: parsedScenario.id,
        scenario: parsedScenario.name,
        playerAction: parsedScenario.playerAction,
        model,
        fallbackModel: options.llmFallback ? requestModelId(options.llmFallback) : null
      },
      metadata: { scenarioId: parsedScenario.id, promptSource: "database", source: "model-qualification", model },
      tags: ["qualify"],
      outputs: (r) => ({
        narration: r.narrative.output?.narration ?? null,
        actions: (r.actions.output?.actions ?? []).map((a) => a.action),
        imagePrompt: r.image.output?.imagePrompt ?? null,
        modelCalls: r.promptChain.length
      })
    },
    async () => {
      trace = currentRootTraceRef();
      return runPceGraph(context, { promptSource: "database", mode: "lenient" });
    }
  );
  const turnMs = Date.now() - start;
  const { master, narrative, actions, image, promptChain } = result;

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
  const verdict: QualificationVerdict = verdictFromStages(stages);
  const tokenStats = calculateTokensFromResult(promptChain);
  const hasPrice = options.llm.priceInput !== null && options.llm.priceOutput !== null;
  const costUsd = hasPrice ? estimateCost(tokenStats.promptTokens, tokenStats.completionTokens, options.llm) : null;

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
    executedAt: new Date().toISOString(),
    trace
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
    actions: actionLabels,
    trace
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
