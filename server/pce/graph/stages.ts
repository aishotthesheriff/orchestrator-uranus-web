/**
 * The four story-pipeline stages as one function.
 *
 * Every stage does the same thing: build its variables, render its prompt, call the model,
 * read the reply as JSON, and check that the reply has what later stages need. Only the
 * variables, the token limit and that final check differ, so those live in STAGES below.
 *
 * A stage never throws. A failure comes back as { ok: false } with metadata that says
 * what went wrong, which is what the recovery step (recovery.ts) decides on.
 */

import type { ActionChip } from "@shared/schema";
import { buildPcePrompt, flattenMasterEnrichment } from "../promptBuilder";
import type {
  ActionsPayload,
  ImagePromptPayload,
  MasterEnrichmentData,
  NarrativePayload,
  PromptStage,
  StageMetadata,
  StageResult,
  TurnGenerationContext
} from "../contentRouter";
import { executeJsonPrompt } from "../../llm/jsonPrompt";
import { STAGE_OBJECT_KEYS, parseStageJson } from "../../llm/json";
import { llmCallErrorInfo } from "../../llm/clients";
import { pceStageDuration, promptBuildDuration, variableBuildDuration } from "../../metrics";

/** Published prompts (what players get) or the database drafts (what Dev Tools is editing). */
export type PromptSource = "reference" | "database";

export interface StageOutputs {
  master: MasterEnrichmentData;
  narrative: NarrativePayload;
  image: ImagePromptPayload;
  actions: ActionsPayload;
}

/** Outputs of earlier stages that a stage builds on. */
export interface StageUpstream {
  master?: MasterEnrichmentData | null;
  narrative?: NarrativePayload | null;
}

export type StageRunner = <S extends PromptStage>(
  stage: S,
  context: TurnGenerationContext,
  upstream: StageUpstream,
  options: { promptSource: PromptSource }
) => Promise<StageResult<StageOutputs[S]>>;

type Validation<T> = { output: T } | { error: string };

interface StageSpec<T> {
  /** Output token limit for the request. Absent: the default in executeJsonPrompt. */
  maxTokens?: number;
  /** Selections recorded with the model call. */
  callMetadata: (context: TurnGenerationContext) => Record<string, unknown>;
  variables: (
    context: TurnGenerationContext,
    upstream: StageUpstream
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Turn the parsed reply into the stage's output, or say why it is unusable. */
  validate: (parsed: unknown, metadata: StageMetadata) => Validation<T>;
}

function requireUpstream<K extends keyof StageUpstream>(
  stage: PromptStage,
  upstream: StageUpstream,
  key: K
): NonNullable<StageUpstream[K]> {
  const value = upstream[key];
  if (!value) throw new Error(`${stage} stage needs the ${key} stage's output`);
  return value as NonNullable<StageUpstream[K]>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

const themeAndStyle = (context: TurnGenerationContext) => ({
  theme: context.selections.theme,
  style: context.selections.style
});

const themeStyleAndImageModel = (context: TurnGenerationContext) => ({
  ...themeAndStyle(context),
  imageModelKey: context.selections.imageModelKey
});

const STAGES: { [S in PromptStage]: StageSpec<StageOutputs[S]> } = {
  master: {
    callMetadata: themeStyleAndImageModel,
    variables: (context) => context.promptVariables.master(),
    validate: (parsed, metadata) => {
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
        isObject(parsed) &&
        !Array.isArray(parsed) &&
        (metadata.jsonQuality === "repaired"
          ? STAGE_OBJECT_KEYS.master.every(isSection)
          : STAGE_OBJECT_KEYS.master.some(isSection));
      if (!isPlan) {
        return { error: "Master stage returned no usable plan (expected context, variables and guidance)" };
      }
      return {
        output: {
          enrichment: parsed as Record<string, unknown>,
          flattened: flattenMasterEnrichment(parsed)
        }
      };
    }
  },

  narrative: {
    callMetadata: themeAndStyle,
    variables: (context, upstream) =>
      context.promptVariables.narrative(requireUpstream("narrative", upstream, "master")),
    validate: (parsed) => {
      if (!isObject(parsed)) return { error: "Narrative stage returned invalid payload" };
      const narration = typeof parsed.narration === "string" ? parsed.narration.trim() : "";
      if (!narration) return { error: "Narrative stage missing 'narration' field" };
      const toneHintsRaw = parsed.toneHints;
      const toneHints =
        Array.isArray(toneHintsRaw) && toneHintsRaw.every((item) => typeof item === "string")
          ? (toneHintsRaw as string[])
          : undefined;
      return { output: { narration, toneHints } };
    }
  },

  image: {
    callMetadata: themeStyleAndImageModel,
    variables: (context, upstream) =>
      context.promptVariables.image(
        requireUpstream("image", upstream, "master"),
        requireUpstream("image", upstream, "narrative")
      ),
    validate: (parsed) => {
      if (!isObject(parsed)) return { error: "Image stage returned invalid payload" };
      const imagePrompt = typeof parsed.imagePrompt === "string" ? parsed.imagePrompt.trim() : "";
      if (!imagePrompt) return { error: "Image stage missing 'imagePrompt' field" };
      const modelOverrides = parsed.modelOverrides;
      return {
        output: {
          imagePrompt,
          modelOverrides: isObject(modelOverrides)
            ? (modelOverrides as ImagePromptPayload["modelOverrides"])
            : undefined
        }
      };
    }
  },

  actions: {
    maxTokens: 800,
    callMetadata: themeAndStyle,
    variables: (context, upstream) =>
      context.promptVariables.actions(
        requireUpstream("actions", upstream, "master"),
        requireUpstream("actions", upstream, "narrative")
      ),
    validate: (parsed) => {
      if (!isObject(parsed)) return { error: "Actions stage returned invalid payload" };
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const normalized = actions
        .filter((action: any) => action && typeof action === "object")
        .map((action: any) => ({
          action: typeof action.action === "string" ? action.action : "",
          summary: typeof action.summary === "string" ? action.summary : "",
          risk: typeof action.risk === "string" ? action.risk : "Safe",
          intent: typeof action.intent === "string" ? action.intent : "other",
          usesItemId: action.usesItemId && typeof action.usesItemId === "string" ? action.usesItemId : undefined
        }))
        .filter((action: ActionChip) => action.action && action.summary && action.risk && action.intent) as ActionChip[];
      if (!normalized.length) return { error: "Actions stage produced no valid actions" };
      return { output: { actions: normalized } };
    }
  }
};

export const runStage: StageRunner = async (stage, context, upstream, options) => {
  const spec = STAGES[stage] as StageSpec<StageOutputs[typeof stage]>;
  const stageTimer = pceStageDuration.startTimer({ stage });

  try {
    const variableTimer = variableBuildDuration.startTimer({ stage });
    const variables = await spec.variables(context, upstream);
    variableTimer();

    const promptTimer = promptBuildDuration.startTimer({ stage });
    const prompts = await buildPcePrompt(stage, variables, {
      validate: true,
      useDatabase: options.promptSource === "database"
    });
    promptTimer();

    const { rawContent, metadata } = await executeJsonPrompt({
      llm: context.llmModel,
      stage,
      template: stage,
      systemPrompt: prompts.system,
      userPrompt: prompts.user || undefined, // Only include if not empty
      metadata: {
        ...spec.callMetadata(context),
        templateHash: prompts.template?.hash,
        templateSource: prompts.template?.source
      },
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      maxTokens: spec.maxTokens
    });

    const unusable = (error: string): StageResult<StageOutputs[typeof stage]> => {
      metadata.error = error;
      metadata.fallbackUsed = true;
      return { ok: false, output: null, metadata: [metadata] };
    };

    let parsed: unknown;
    try {
      parsed = parseStageJson(rawContent, metadata);
    } catch (error) {
      return unusable(`JSON parse error: ${(error as Error).message}`);
    }

    const checked = spec.validate(parsed, metadata);
    if ("error" in checked) return unusable(checked.error);

    stageTimer({ status: "success" });
    return { ok: true, output: checked.output, metadata: [metadata] };
  } catch (error) {
    // Our own code failed (building variables or the prompt) or the provider call did.
    // llmCallErrorInfo tells the two apart for the recovery step.
    stageTimer({ status: "failure" });
    console.error(`[PCE] ${stage} stage failed`, {
      gameId: context.gameId,
      turnNumber: context.turnNumber,
      error: error instanceof Error ? error.message : String(error)
    });
    const metadata: StageMetadata = {
      stage,
      template: stage,
      ...llmCallErrorInfo(error),
      prompt: "",
      rawResponse: null,
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
    return { ok: false, output: null, metadata: [metadata] };
  }
};
