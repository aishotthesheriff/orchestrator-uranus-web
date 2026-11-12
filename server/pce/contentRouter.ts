import type { ActionChip, GameState } from "@shared/schema";
import type { FlattenedMasterEnrichment } from "./promptBuilder";
import { BUILTIN_LLM_MODEL, requestModelId, type ResolvedLlmModel } from "../llm/models";
import type { JsonQuality } from "../llm/json";
import { llmStageRecoveryTotal } from "../metrics";

export interface MasterEnrichmentData {
  enrichment: Record<string, unknown> | null;
  flattened: FlattenedMasterEnrichment;
}

export type PromptStage = "master" | "narrative" | "image" | "actions";

export interface StageMetadata {
  stage: PromptStage;
  template: string;
  /** Model id sent to the provider. */
  model?: string;
  /** Catalog key of the story model (null for an ad-hoc Dev Tools model). */
  modelKey?: string | null;
  provider?: string;
  prompt?: string;
  rawResponse?: string | null;
  fallbackUsed?: boolean;
  error?: string;
  durationMs?: number;
  timestamp: string;
  /** Token counts reported by the provider (absent if it reported none). */
  usage?: { promptTokens: number | null; completionTokens: number | null };
  finishReason?: string | null;
  /** Output token limit sent with the request. */
  maxTokens?: number;
  /** The model answered with nothing at all. */
  emptyResponse?: boolean;
  /** The provider call itself failed (outage, removed model, timeout): no reply to read. */
  providerError?: boolean;
  /** How the output was read as JSON (see server/llm/json.ts). */
  jsonQuality?: JsonQuality;
  /**
   * Set on attempts after the first: "retry" re-asked the same model, "fallback" asked
   * the fallback model. A stage's metadata lists every attempt in order; the last entry
   * is the one whose output was used.
   */
  recovery?: "retry" | "fallback";
  extras?: Record<string, unknown>;
}

export interface StageResult<T> {
  ok: boolean;
  output: T | null;
  metadata: StageMetadata[];
}

export interface NarrativePayload {
  narration: string;
  toneHints?: string[];
}

export interface ImagePromptPayload {
  imagePrompt: string;
  modelOverrides?: {
    provider: string;
    params: Record<string, unknown>;
  };
}

export interface ActionsPayload {
  actions: ActionChip[];
}

export interface TurnGenerationContext {
  state: GameState;
  gameId: string;
  turnNumber: number;
  intro?: boolean;
  playerAction: string;
  checks: unknown[];
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean };
  /** Story model for the four stages. Absent means the built-in default. */
  llmModel?: ResolvedLlmModel;
  /**
   * Model to try when the story model cannot produce a usable stage (after one retry),
   * or its provider fails. Absent means no fallback: the stage fails.
   */
  llmFallback?: ResolvedLlmModel | null;
  triggeredEvent?: { name: string; segment: string; skill: string } | null;
  promptVariables: {
    master: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    narrative: (enrichment: MasterEnrichmentData) => Promise<Record<string, unknown>> | Record<string, unknown>;
    image: (
      enrichment: MasterEnrichmentData,
      narrative: NarrativePayload
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    actions: (
      enrichment: MasterEnrichmentData,
      narrative: NarrativePayload
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  selections: {
    theme: string;
    style: string;
    imageModelKey: string;
    llmModelKey?: string | null;
  };
  extras?: Record<string, unknown>;
}

export interface RouterHandlers {
  master: (context: TurnGenerationContext) => Promise<StageResult<MasterEnrichmentData>>;
  narrative: (
    context: TurnGenerationContext,
    master: MasterEnrichmentData
  ) => Promise<StageResult<NarrativePayload>>;
  image: (
    context: TurnGenerationContext,
    master: MasterEnrichmentData,
    narrative: NarrativePayload
  ) => Promise<StageResult<ImagePromptPayload>>;
  actions: (
    context: TurnGenerationContext,
    master: MasterEnrichmentData,
    narrative: NarrativePayload
  ) => Promise<StageResult<ActionsPayload>>;
}

export interface FullTurnContentResult {
  master: StageResult<MasterEnrichmentData>;
  narrative: StageResult<NarrativePayload>;
  image: StageResult<ImagePromptPayload>;
  actions: StageResult<ActionsPayload>;
  promptChain: StageMetadata[];
  fallbackUsed: boolean;
}

/**
 * Ceiling for the raised token limit when a cut-off reply is retried. A reply that was
 * cut off at or above this limit is not retried (it would be the same request again).
 */
const MAX_RETRY_TOKENS = 16000;

export class ContentGenerationRouter {
  private handlers: RouterHandlers;

  constructor(handlers: RouterHandlers) {
    this.handlers = handlers;
  }

  /**
   * Run a stage with the recovery steps that need a second model call. (Cheaper fixes,
   * such as stripping a code fence, already happened inside the stage: see
   * server/llm/json.ts.)
   *
   *  1. If the model answered but the answer was unusable, ask it once more. A reply cut
   *     off at the token limit is retried with a doubled limit.
   *  2. If that fails too, or the provider itself failed (the SDK has already retried
   *     transport errors), ask the fallback model once.
   *
   * Every attempt is kept in the result's metadata, in order.
   */
  private async withRecovery<T>(
    stage: PromptStage,
    context: TurnGenerationContext,
    run: (ctx: TurnGenerationContext) => Promise<StageResult<T>>
  ): Promise<StageResult<T>> {
    const usable = (r: StageResult<T>) => r.ok && r.output !== null && r.output !== undefined;
    const first = await run(context);
    if (usable(first)) return first;

    const attempts: StageMetadata[] = [...first.metadata];
    // A stage without an explicit model runs on the built-in one.
    const primary = context.llmModel ?? BUILTIN_LLM_MODEL;
    const primaryId = requestModelId(primary);
    let last = first;

    const lastMeta = first.metadata[first.metadata.length - 1];
    const modelAnswered = lastMeta?.rawResponse !== null && lastMeta?.rawResponse !== undefined;
    // Neither an unusable answer nor a provider failure: the stage failed in our own code
    // (e.g. building the prompt). Another model would fail the same way.
    if (!modelAnswered && !lastMeta?.providerError) return first;

    // A cut-off reply is only worth retrying if the limit can actually be raised.
    const cutOff = lastMeta?.finishReason === "length" && typeof lastMeta.maxTokens === "number";
    const raisedLimit = cutOff ? Math.min(lastMeta!.maxTokens! * 2, MAX_RETRY_TOKENS) : undefined;
    const retryWorthwhile = modelAnswered && (!cutOff || raisedLimit! > lastMeta!.maxTokens!);
    if (retryWorthwhile) {
      const retryModel = raisedLimit
        ? { ...primary, params: { ...primary.params, maxTokens: raisedLimit } }
        : primary;
      const retry = await run({ ...context, llmModel: retryModel });
      retry.metadata.forEach((m) => { m.recovery = "retry"; });
      attempts.push(...retry.metadata);
      if (usable(retry)) {
        llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: "retry_ok" });
        console.warn(`[LLM] ${stage} stage recovered on retry (${primaryId}): ${lastMeta?.error ?? "unusable output"}`);
        return { ...retry, metadata: attempts };
      }
      last = retry;
    }

    const fallback = context.llmFallback;
    if (fallback && requestModelId(fallback) !== primaryId) {
      const fallbackId = requestModelId(fallback);
      const result = await run({ ...context, llmModel: fallback });
      result.metadata.forEach((m) => { m.recovery = "fallback"; });
      attempts.push(...result.metadata);
      const ok = usable(result);
      llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: ok ? "fallback_ok" : "failed" });
      console.warn(
        `[LLM] ${stage} stage ${ok ? "served by fallback" : "failed on fallback"} ${fallbackId} after ${primaryId} failed: ` +
          `${lastMeta?.error ?? "unusable output"}`
      );
      return { ...result, metadata: attempts };
    }

    llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: "failed" });
    return { ...last, metadata: attempts };
  }

  async generateMasterEnrichment(context: TurnGenerationContext): Promise<StageResult<MasterEnrichmentData>> {
    return this.withRecovery("master", context, (ctx) => this.handlers.master(ctx));
  }

  async generateNarrative(
    context: TurnGenerationContext,
    master: MasterEnrichmentData
  ): Promise<StageResult<NarrativePayload>> {
    return this.withRecovery("narrative", context, (ctx) => this.handlers.narrative(ctx, master));
  }

  async generateImagePrompt(
    context: TurnGenerationContext,
    master: MasterEnrichmentData,
    narrative: NarrativePayload
  ): Promise<StageResult<ImagePromptPayload>> {
    return this.withRecovery("image", context, (ctx) => this.handlers.image(ctx, master, narrative));
  }

  async generateActions(
    context: TurnGenerationContext,
    master: MasterEnrichmentData,
    narrative: NarrativePayload
  ): Promise<StageResult<ActionsPayload>> {
    return this.withRecovery("actions", context, (ctx) => this.handlers.actions(ctx, master, narrative));
  }

  async generateFullTurnContent(context: TurnGenerationContext): Promise<FullTurnContentResult> {
    const promptChain: StageMetadata[] = [];

    const master = await this.generateMasterEnrichment(context);
    promptChain.push(...master.metadata);

    if (!master.ok || !master.output?.enrichment) {
      // Extract actual error from metadata - log full details for debugging
      const hasMetadata = Array.isArray(master.metadata) && master.metadata.length > 0;
      console.error("[PCE] Master stage result details:", {
        ok: master.ok,
        hasOutput: !!master.output,
        hasEnrichment: !!master.output?.enrichment,
        metadataCount: hasMetadata ? master.metadata.length : 0,
        metadata: hasMetadata ? master.metadata : [],
        metadataEmpty: !hasMetadata
      });
      
      // Try to extract error from metadata
      let actualError = 'Stage failed';
      let errorMetadata: StageMetadata | undefined;
      
      if (hasMetadata) {
        errorMetadata = master.metadata.find(m => m.error) || master.metadata[0];
        actualError = errorMetadata?.error || (!master.ok ? 'Stage failed' : 'Missing enrichment');
      } else {
        // If no metadata, this is a critical issue - the stage didn't even create metadata
        actualError = !master.ok 
          ? 'Stage failed with no error metadata - possible exception in stage handler' 
          : 'Missing enrichment output';
      }
      
      const errorContext = {
        stage: 'master',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: master.output,
        metadata: hasMetadata ? master.metadata : [],
        metadataDetails: {
          errorMetadata: errorMetadata,
          allErrors: hasMetadata ? master.metadata.map(m => m.error).filter(Boolean) : [],
          hasMetadata: hasMetadata
        }
      };
      console.error("[PCE] Master stage failed", errorContext);
      throw new Error(`PCE turn generation failed: master stage failed. ${JSON.stringify(errorContext, null, 2)}`);
    }

    const narrativeStage = await this.generateNarrative(context, master.output);
    promptChain.push(...narrativeStage.metadata);

    if (!narrativeStage.ok || !narrativeStage.output) {
      // Extract actual error from metadata
      const errorMetadata = narrativeStage.metadata.find(m => m.error) || narrativeStage.metadata[0];
      const actualError = errorMetadata?.error || (!narrativeStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'narrative',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: narrativeStage.output,
        metadata: narrativeStage.metadata
      };
      console.error("[PCE] Narrative stage failed", errorContext);
      throw new Error(`PCE turn generation failed: narrative stage failed. ${JSON.stringify(errorContext)}`);
    }

    // Generate actions and image in parallel (both only need master + narrative, not each other)
    // This allows actions to be available immediately without waiting for image generation
    const [actionsStage, imageStage] = await Promise.all([
      this.generateActions(context, master.output, narrativeStage.output),
      this.generateImagePrompt(context, master.output, narrativeStage.output)
    ]);

    promptChain.push(...actionsStage.metadata);
    promptChain.push(...imageStage.metadata);

    if (!actionsStage.ok || !actionsStage.output) {
      // Extract actual error from metadata
      const errorMetadata = actionsStage.metadata.find(m => m.error) || actionsStage.metadata[0];
      const actualError = errorMetadata?.error || (!actionsStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'actions',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: actionsStage.output,
        metadata: actionsStage.metadata
      };
      console.error("[PCE] Actions stage failed", errorContext);
      throw new Error(`PCE turn generation failed: actions stage failed. ${JSON.stringify(errorContext)}`);
    }

    if (!imageStage.ok || !imageStage.output) {
      // Extract actual error from metadata
      const errorMetadata = imageStage.metadata.find(m => m.error) || imageStage.metadata[0];
      const actualError = errorMetadata?.error || (!imageStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'image',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: imageStage.output,
        metadata: imageStage.metadata
      };
      console.error("[PCE] Image stage failed", errorContext);
      throw new Error(`PCE turn generation failed: image stage failed. ${JSON.stringify(errorContext)}`);
    }

    return {
      master,
      narrative: narrativeStage,
      image: imageStage,
      actions: actionsStage,
      promptChain,
      fallbackUsed: false
    };
  }
}
