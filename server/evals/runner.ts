/**
 * Offline eval experiments: run every saved scenario through the story pipeline with one
 * model and one prompt set, score each turn, and record the result.
 *
 * LangSmith holds the experiment (runs, traces, scores) so two experiments can be compared
 * side by side there. A summary is also kept locally for Dev Tools (experimentStore.ts).
 */

import { evaluate } from "langsmith/evaluation";
import type { ParsedTestScenario } from "@shared/schema";
import { storage } from "../storage";
import { getCurrentReferenceRelease } from "../reference/publishReference";
import { buildContextFromScenario, calculateTokensFromResult, estimateCost, parseTestScenario } from "../pce/inspectorService";
import { runPceGraph, type PromptSource } from "../pce/graph";
import {
  BUILTIN_LLM_MODEL,
  requestModelId,
  resolveLlmFallback,
  toResolvedLlmModel,
  type ResolvedLlmModel
} from "../llm/models";
import { flushTraces, getLangSmithClient, tracingEnabled } from "../observability/langsmith";
import { EVAL_DATASET_NAME, scenarioTags, syncScenarioDataset, type ScenarioExampleInputs } from "./dataset";
import {
  runCodeEvaluators,
  structuralVerdictOf,
  summarizeScores,
  type EvalScore,
  type TurnEvalInput,
  type TurnEvalOutput
} from "./evaluators";
import { resolveJudgeModel, runJudges } from "./judges";
import { JUDGES } from "./rubrics";
import {
  createExperiment,
  finishExperiment,
  type EvalExperiment,
  type ExperimentRow,
  type ExperimentSummary
} from "./experimentStore";

export interface ExperimentOptions {
  /** Catalog key of the story model. Absent: the catalog default. */
  modelKey?: string | null;
  /** "reference": published prompts. "database": the drafts being edited in Dev Tools. */
  promptSource: PromptSource;
  /** Judge keys to run. Absent: all of them. Empty: code evaluators only. */
  judges?: string[];
  /** Only scenarios carrying this tag. Absent: all scenarios. */
  scenarioTag?: string | null;
}

/** Scenarios scored at once. Each is four model calls plus one per judge. */
const SCENARIO_CONCURRENCY = 2;

let runningExperimentId: string | null = null;

export function currentExperimentId(): string | null {
  return runningExperimentId;
}

export class ExperimentBusyError extends Error {
  readonly status = 409;
}

async function resolveStoryModel(modelKey?: string | null): Promise<{ llm: ResolvedLlmModel; llmFallback: ResolvedLlmModel | null }> {
  // Read from the database, like model qualification, so unpublished catalog rows can be evaluated.
  const lookup = async (key: string) => toResolvedLlmModel(await storage.getLlmModelByKey(key), "database");
  const defaultRow = await storage.getDefaultLlmModel();
  let llm: ResolvedLlmModel | null;
  if (modelKey) {
    llm = await lookup(modelKey);
    if (!llm) throw new Error(`Story model "${modelKey}" is not in the catalog`);
  } else {
    llm = toResolvedLlmModel(defaultRow, "database") ?? BUILTIN_LLM_MODEL;
  }
  const llmFallback = await resolveLlmFallback(llm, lookup, defaultRow?.modelKey ?? null);
  return { llm, llmFallback };
}

interface ScoredTurn {
  input: TurnEvalInput;
  output: TurnEvalOutput;
  turnMs: number;
  costUsd: number | null;
}

/** One scenario through the pipeline. Never throws for a stage failure; that is a result. */
export async function runScenarioTurn(
  scenario: ParsedTestScenario,
  llm: ResolvedLlmModel,
  llmFallback: ResolvedLlmModel | null,
  promptSource: PromptSource
): Promise<ScoredTurn> {
  const { context, normalizedChecks, normalizedEvent } = await buildContextFromScenario(scenario, llm, llmFallback);
  const startedAt = Date.now();
  const result = await runPceGraph(context, { promptSource, mode: "lenient" });
  const turnMs = Date.now() - startedAt;

  const tokens = calculateTokensFromResult(result.promptChain);
  const hasPrice = llm.priceInput !== null && llm.priceOutput !== null;
  return {
    input: {
      playerAction: scenario.playerAction,
      checks: normalizedChecks,
      triggeredEvent: normalizedEvent,
      theme: context.selections.theme,
      style: context.selections.style,
      turnNumber: context.turnNumber
    },
    output: {
      narration: result.narrative.output?.narration ?? null,
      actions: result.actions.output?.actions ?? [],
      imagePrompt: result.image.output?.imagePrompt ?? null,
      promptChain: result.promptChain
    },
    turnMs,
    costUsd: hasPrice ? estimateCost(tokens.promptTokens, tokens.completionTokens, llm) : null
  };
}

function summarize(rows: ExperimentRow[]): ExperimentSummary {
  const verdicts = { clean: 0, repaired: 0, fallback: 0, failed: 0 };
  for (const row of rows) verdicts[row.verdict]++;
  const costs = rows.map((r) => r.costUsd).filter((c): c is number => typeof c === "number");
  return {
    scores: summarizeScores(rows.map((r) => r.scores)),
    verdicts,
    turnMsMean: rows.length ? Math.round(rows.reduce((sum, r) => sum + r.turnMs, 0) / rows.length) : null,
    costUsd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
    rows: [...rows].sort((a, b) => a.scenario.localeCompare(b.scenario))
  };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function execute(experiment: EvalExperiment, options: ExperimentOptions, models: {
  llm: ResolvedLlmModel;
  llmFallback: ResolvedLlmModel | null;
  judgeLlm: ResolvedLlmModel;
  judges: string[];
}): Promise<EvalExperiment> {
  const client = getLangSmithClient();
  const turns = new Map<string, ScoredTurn | { error: string }>();
  const rows: ExperimentRow[] = [];
  let experimentName: string | null = null;

  try {
    // The dataset is rebuilt from the scenarios each time, so an experiment always runs
    // on the scenarios as they are now.
    await syncScenarioDataset();
    const examples = [];
    for await (const example of client.listExamples({ datasetName: EVAL_DATASET_NAME })) {
      const tags = (example.metadata as { tags?: string[] } | undefined)?.tags ?? [];
      if (!options.scenarioTag || tags.includes(options.scenarioTag)) examples.push(example);
    }
    if (examples.length === 0) {
      throw new Error(options.scenarioTag ? `No scenarios carry the tag "${options.scenarioTag}"` : "There are no saved scenarios to evaluate");
    }

    const target = async (inputs: ScenarioExampleInputs) => {
      try {
        const record = await storage.getPceTestScenario(inputs.scenarioId);
        if (!record) throw new Error(`Scenario ${inputs.scenarioId} no longer exists`);
        const turn = await runScenarioTurn(parseTestScenario(record), models.llm, models.llmFallback, options.promptSource);
        turns.set(inputs.scenarioId, turn);
        return {
          narration: turn.output.narration,
          actions: turn.output.actions,
          imagePrompt: turn.output.imagePrompt,
          verdict: structuralVerdictOf(turn.output),
          theme: turn.input.theme,
          style: turn.input.style,
          turnMs: turn.turnMs,
          costUsd: turn.costUsd,
          // Prompts and raw replies are on the trace; here only what each call amounted to.
          modelCalls: turn.output.promptChain.map((m) => ({
            stage: m.stage,
            model: m.model,
            recovery: m.recovery ?? null,
            jsonQuality: m.jsonQuality ?? null,
            templateHash: m.templateHash ?? null,
            error: m.error ?? null
          }))
        };
      } catch (error) {
        turns.set(inputs.scenarioId, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };

    const scoreTurn = async ({ inputs }: { inputs: Record<string, any> }) => {
      const scenarioId = String(inputs.scenarioId);
      const turn = turns.get(scenarioId);
      if (!turn || "error" in turn) {
        rows.push({
          scenarioId,
          scenario: String(inputs.scenario ?? scenarioId),
          verdict: "failed",
          turnMs: 0,
          costUsd: null,
          scores: [{ key: "structural_verdict", score: 0, comment: turn?.error ?? "The turn did not run" }],
          error: turn?.error ?? "The turn did not run"
        });
        return [{ key: "structural_verdict", score: 0, comment: turn?.error ?? "The turn did not run" }];
      }
      const scores: EvalScore[] = [
        ...runCodeEvaluators(turn.output, turn.input),
        ...(await runJudges(turn.input, turn.output, { keys: models.judges, llm: models.judgeLlm }))
      ];
      rows.push({
        scenarioId,
        scenario: String(inputs.scenario ?? scenarioId),
        verdict: structuralVerdictOf(turn.output),
        turnMs: turn.turnMs,
        costUsd: turn.costUsd,
        scores
      });
      // LangSmith needs a number; a judge that could not score is left out there.
      return scores
        .filter((s): s is EvalScore & { score: number } => typeof s.score === "number")
        .map((s) => ({ key: s.key, score: s.score, comment: s.comment }));
    };

    const results = await evaluate(target, {
      data: examples,
      evaluators: [scoreTurn],
      experimentPrefix: `pce-${options.promptSource === "database" ? "draft" : "published"}-${slug(requestModelId(models.llm))}`,
      description: `Story pipeline on ${examples.length} saved scenarios`,
      maxConcurrency: SCENARIO_CONCURRENCY,
      client,
      metadata: {
        model: requestModelId(models.llm),
        modelKey: models.llm.key,
        fallbackModel: models.llmFallback ? requestModelId(models.llmFallback) : null,
        promptSource: options.promptSource,
        releaseVersion: experiment.releaseVersion,
        judgeModel: requestModelId(models.judgeLlm),
        judges: models.judges,
        scenarioTag: options.scenarioTag ?? null,
        localExperimentId: experiment.id
      }
    });
    experimentName = results.experimentName;
    await flushTraces();

    let langsmithUrl: string | null = null;
    try {
      const datasetId = examples[0].dataset_id;
      const session = await client.readProject({ projectName: experimentName });
      langsmithUrl = `${await client.getDatasetUrl({ datasetId })}/compare?selectedSessions=${session.id}`;
    } catch (error) {
      console.warn("[Evals] Could not build the experiment link:", error instanceof Error ? error.message : error);
    }

    return await finishExperiment(experiment.id, { name: experimentName, summary: summarize(rows), langsmithUrl });
  } catch (error) {
    console.error("[Evals] Experiment failed:", error);
    return await finishExperiment(experiment.id, {
      name: experimentName,
      summary: rows.length ? summarize(rows) : null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function prepare(options: ExperimentOptions) {
  if (!tracingEnabled()) {
    throw new Error("LangSmith is not configured on this server (set LANGSMITH_TRACING=true and LANGSMITH_API_KEY)");
  }
  if (runningExperimentId) {
    throw new ExperimentBusyError("Another experiment is still running");
  }
  const judges = options.judges ?? JUDGES.map((judge) => judge.key);
  const unknown = judges.filter((key) => !JUDGES.some((judge) => judge.key === key));
  if (unknown.length) throw new Error(`Unknown judge: ${unknown.join(", ")}`);

  const { llm, llmFallback } = await resolveStoryModel(options.modelKey);
  const judgeLlm = await resolveJudgeModel();
  const scenarioCount = (await storage.getPceTestScenarios({ limit: 500 })).filter(
    (s) => !options.scenarioTag || scenarioTags(s.tags).includes(options.scenarioTag)
  ).length;

  const experiment = await createExperiment({
    model: requestModelId(llm),
    modelKey: llm.key,
    promptSource: options.promptSource,
    releaseVersion: (await getCurrentReferenceRelease())?.version ?? null,
    scenarioTag: options.scenarioTag ?? null,
    judges,
    judgeModel: judges.length ? requestModelId(judgeLlm) : null,
    exampleCount: scenarioCount
  });
  return { experiment, models: { llm, llmFallback, judgeLlm, judges } };
}

/** Start an experiment and return at once; poll the store for the result. */
export async function startExperiment(options: ExperimentOptions): Promise<EvalExperiment> {
  const { experiment, models } = await prepare(options);
  runningExperimentId = experiment.id;
  void execute(experiment, options, models).finally(() => {
    runningExperimentId = null;
  });
  return experiment;
}

/** Run an experiment to completion (for the command line). */
export async function runExperiment(options: ExperimentOptions): Promise<EvalExperiment> {
  const { experiment, models } = await prepare(options);
  runningExperimentId = experiment.id;
  try {
    return await execute(experiment, options, models);
  } finally {
    runningExperimentId = null;
  }
}
