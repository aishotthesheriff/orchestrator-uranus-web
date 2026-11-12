/**
 * Types shared by everything that runs or reads the story pipeline.
 * The pipeline itself is the LangGraph graph in ./graph.
 */

import type { ActionChip, GameState } from "@shared/schema";
import type { FlattenedMasterEnrichment } from "./promptBuilder";
import type { ResolvedLlmModel } from "../llm/models";
import type { JsonQuality } from "../llm/json";

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
  /** Hash of the rendered prompt. */
  promptHash?: string;
  /** Hash of the unrendered template, identifying the prompt version. */
  templateHash?: string;
  /** Where the template came from: the published release, the database draft, or a file. */
  templateSource?: "reference" | "database" | "file";
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

export interface FullTurnContentResult {
  master: StageResult<MasterEnrichmentData>;
  narrative: StageResult<NarrativePayload>;
  image: StageResult<ImagePromptPayload>;
  actions: StageResult<ActionsPayload>;
  promptChain: StageMetadata[];
  fallbackUsed: boolean;
}
