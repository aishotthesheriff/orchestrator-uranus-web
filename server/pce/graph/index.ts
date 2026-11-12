/**
 * Entry point for the story pipeline. Live turns, the PCE Inspector, model qualification
 * and evals all run a turn through runPceGraph; they differ only in the options.
 */

import type {
  FullTurnContentResult,
  MasterEnrichmentData,
  NarrativePayload,
  PromptStage,
  StageMetadata,
  StageResult,
  TurnGenerationContext
} from "../contentRouter";
import { requestModelId, BUILTIN_LLM_MODEL } from "../../llm/models";
import { pceGraph, type PceGraphState, type PceRuntime } from "./graph";
import { runStage, type PromptSource, type StageRunner } from "./stages";

export type { PromptSource, StageRunner } from "./stages";
export { withRecovery, MAX_RETRY_TOKENS } from "./recovery";

export interface RunPceGraphOptions {
  /** "reference": published prompts (default). "database": the drafts Dev Tools is editing. */
  promptSource?: PromptSource;
  /**
   * "strict" (default) throws if any stage that should have run did not produce output,
   * as a live turn requires. "lenient" returns whatever was produced.
   */
  mode?: "strict" | "lenient";
  /** Stop after this stage (earlier stages run only if not supplied in `upstream`). */
  target?: PromptStage;
  /** Results to use instead of running the stage. */
  upstream?: { master?: MasterEnrichmentData; narrative?: NarrativePayload };
  /** False runs each stage once, without retry or fallback. Default true. */
  recover?: boolean;
  /** Replaces the stage runner. For tests. */
  runStage?: StageRunner;
}

const notRun = <T,>(): StageResult<T> => ({ ok: false, output: null, metadata: [] });
const supplied = <T,>(output: T): StageResult<T> => ({ ok: true, output, metadata: [] });

export async function runPceGraph(
  context: TurnGenerationContext,
  options: RunPceGraphOptions = {}
): Promise<FullTurnContentResult> {
  const runtime: PceRuntime = {
    context,
    promptSource: options.promptSource ?? "reference",
    recover: options.recover ?? true,
    runStage: options.runStage ?? runStage
  };

  const input: Partial<PceGraphState> = {
    target: options.target,
    masterResult: options.upstream?.master ? supplied(options.upstream.master) : undefined,
    narrativeResult: options.upstream?.narrative ? supplied(options.upstream.narrative) : undefined
  };

  const state = (await pceGraph.invoke(input, {
    configurable: { pce: runtime },
    runName: "pce.graph",
    tags: ["pce", `prompts:${runtime.promptSource}`],
    metadata: {
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      promptSource: runtime.promptSource,
      target: options.target ?? "full",
      model: requestModelId(context.llmModel ?? BUILTIN_LLM_MODEL),
      modelKey: context.llmModel?.key ?? null,
      theme: context.selections.theme,
      style: context.selections.style
    }
  })) as PceGraphState;

  const master = state.masterResult ?? notRun<MasterEnrichmentData>();
  const narrative = state.narrativeResult ?? notRun<NarrativePayload>();
  const actions = state.actionsResult ?? notRun();
  const image = state.imageResult ?? notRun();

  const result: FullTurnContentResult = {
    master,
    narrative,
    actions,
    image,
    // Always in this order, whichever of actions and image finished first.
    promptChain: [...master.metadata, ...narrative.metadata, ...actions.metadata, ...image.metadata],
    fallbackUsed: false
  };

  if ((options.mode ?? "strict") === "strict") {
    assertStagesSucceeded(result, context, options.target);
  }
  return result;
}

/** Stages a run with this target is expected to complete, in pipeline order. */
function expectedStages(target?: PromptStage): PromptStage[] {
  switch (target) {
    case "master":
      return ["master"];
    case "narrative":
      return ["master", "narrative"];
    case "actions":
      return ["master", "narrative", "actions"];
    case "image":
      return ["master", "narrative", "image"];
    default:
      return ["master", "narrative", "actions", "image"];
  }
}

/**
 * Throw for the first stage that did not produce output. The messages carry the stage's
 * metadata because the workers classify failures (transient or permanent) from them.
 */
function assertStagesSucceeded(
  result: FullTurnContentResult,
  context: TurnGenerationContext,
  target?: PromptStage
): void {
  for (const stage of expectedStages(target)) {
    const stageResult = result[stage] as StageResult<unknown>;
    const produced =
      stage === "master"
        ? stageResult.ok && !!(stageResult.output as MasterEnrichmentData | null)?.enrichment
        : stageResult.ok && !!stageResult.output;
    if (produced) continue;

    const metadata: StageMetadata[] = stageResult.metadata ?? [];
    const errorMetadata = metadata.find((m) => m.error) || metadata[0];
    const error =
      errorMetadata?.error ||
      (metadata.length === 0
        ? "Stage failed with no error metadata - possible exception in stage handler"
        : !stageResult.ok
        ? "Stage failed"
        : "Missing output");
    const errorContext = {
      stage,
      gameId: context.state.id,
      turnNumber: context.state.turnNumber,
      error,
      output: stageResult.output,
      metadata
    };
    console.error(`[PCE] ${stage} stage failed`, errorContext);
    throw new Error(`PCE turn generation failed: ${stage} stage failed. ${JSON.stringify(errorContext)}`);
  }
}
