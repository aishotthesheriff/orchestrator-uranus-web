/**
 * The story pipeline as a LangGraph graph.
 *
 *            ┌─────────┐      ┌───────────┐      ┌─────────┐
 *   START ──▶│ master  │─────▶│ narrative │──┬──▶│ actions │──▶ END
 *            └─────────┘      └───────────┘  │   └─────────┘
 *                 │ unusable        │        │   ┌─────────┐
 *                 ▼                 ▼        └──▶│  image  │──▶ END
 *                END               END           └─────────┘
 *
 * master plans the scene, narrative writes it, then actions and image run side by side
 * (each needs the plan and the narration, not each other).
 *
 * A run can start partway: a stage whose result is already in the input state is skipped.
 * That is how the PCE Inspector runs a single stage on saved or mock upstream data.
 *
 * State holds only stage results, so it stays serializable. The turn context (game state
 * and the closures that build prompt variables) travels in config.configurable.
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  ActionsPayload,
  ImagePromptPayload,
  MasterEnrichmentData,
  NarrativePayload,
  PromptStage,
  StageResult,
  TurnGenerationContext
} from "../contentRouter";
import { withRecovery } from "./recovery";
import type { PromptSource, StageOutputs, StageRunner } from "./stages";

// Channels are named "<stage>Result" because a node and a channel cannot share a name.
export const PceState = Annotation.Root({
  masterResult: Annotation<StageResult<MasterEnrichmentData> | undefined>(),
  narrativeResult: Annotation<StageResult<NarrativePayload> | undefined>(),
  actionsResult: Annotation<StageResult<ActionsPayload> | undefined>(),
  imageResult: Annotation<StageResult<ImagePromptPayload> | undefined>(),
  /** Stop after this stage. Absent: run the whole turn. */
  target: Annotation<PromptStage | undefined>()
});

export type PceGraphState = typeof PceState.State;

/** What the nodes need besides state. Passed as config.configurable.pce. */
export interface PceRuntime {
  context: TurnGenerationContext;
  promptSource: PromptSource;
  /** False runs each stage once, with no retry or fallback. */
  recover: boolean;
  runStage: StageRunner;
}

function runtimeOf(config: RunnableConfig): PceRuntime {
  const runtime = config.configurable?.pce as PceRuntime | undefined;
  if (!runtime) throw new Error("PCE graph invoked without config.configurable.pce");
  return runtime;
}

export const masterUsable = (state: PceGraphState) =>
  !!state.masterResult?.ok && !!state.masterResult.output?.enrichment;
export const narrativeUsable = (state: PceGraphState) =>
  !!state.narrativeResult?.ok && !!state.narrativeResult.output;

function stageNode<S extends PromptStage>(stage: S) {
  return async (state: PceGraphState, config: RunnableConfig): Promise<Partial<PceGraphState>> => {
    const { context, promptSource, recover, runStage } = runtimeOf(config);
    const upstream = { master: state.masterResult?.output, narrative: state.narrativeResult?.output };
    const run = (ctx: TurnGenerationContext) => runStage(stage, ctx, upstream, { promptSource });
    const result: StageResult<StageOutputs[S]> = recover
      ? await withRecovery(stage, context, run)
      : await run(context);
    return { [`${stage}Result`]: result } as Partial<PceGraphState>;
  };
}

/** The stages that follow the narration: both, or only the one being targeted. */
function afterNarration(state: PceGraphState): Array<"actions" | "image"> {
  if (state.target === "actions") return ["actions"];
  if (state.target === "image") return ["image"];
  return ["actions", "image"];
}

function routeFromStart(state: PceGraphState): "master" | "narrative" | Array<"actions" | "image"> {
  if (!masterUsable(state)) return "master";
  if (!narrativeUsable(state)) return "narrative";
  return afterNarration(state);
}

function routeAfterMaster(state: PceGraphState): "narrative" | typeof END {
  if (!masterUsable(state) || state.target === "master") return END;
  // The narration was supplied (Inspector mock data): go straight on.
  return "narrative";
}

function routeAfterNarrative(state: PceGraphState): Array<"actions" | "image"> | typeof END {
  if (!narrativeUsable(state) || state.target === "narrative") return END;
  return afterNarration(state);
}

/** Skips the narrative node when its result was supplied with the input. */
async function narrativeNode(state: PceGraphState, config: RunnableConfig): Promise<Partial<PceGraphState>> {
  if (narrativeUsable(state)) return {};
  return stageNode("narrative")(state, config);
}

export const pceGraph = new StateGraph(PceState)
  .addNode("master", stageNode("master"))
  .addNode("narrative", narrativeNode)
  .addNode("actions", stageNode("actions"))
  .addNode("image", stageNode("image"))
  .addConditionalEdges(START, routeFromStart, ["master", "narrative", "actions", "image"])
  .addConditionalEdges("master", routeAfterMaster, ["narrative", END])
  .addConditionalEdges("narrative", routeAfterNarrative, ["actions", "image", END])
  .addEdge("actions", END)
  .addEdge("image", END)
  .compile({ name: "pce" });
