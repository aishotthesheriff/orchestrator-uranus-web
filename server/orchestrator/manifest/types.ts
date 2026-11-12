/**
 * Manifest type definitions
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §5.3
 */

export interface JobSection {
  queue: string;
  queueEntryId: string;
  jobId: string; // payload id
  attempt: number;
  leaseId?: string;
  workerId?: string;
  claimedAt?: string;
  releasedAt?: string;
  outcome?: string;
}

export interface RequestSection {
  traceId: string;
  requestId?: string;
  /** Root run of this turn's LangSmith trace, when tracing is on. */
  langsmith?: { runId: string; traceId: string };
  issuedBy?: string;
  action: {
    type: string;
    params: Record<string, unknown>;
  };
  sourceStateDigest?: string;
  seed?: string;
  preconditions: {
    turnNumber: number;
    day: number;
    segment: string;
  };
}

export interface PrecomputeSection {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  deterministicDurationMs?: number; // Time spent on deterministic computation (excludes LLM calls)
  llmDurationMs?: number; // Total time spent in LLM calls
  deterministic: {
    checks: unknown[];
    selectedAction: unknown;
    event: unknown | null;
    skill?: string;
    success?: boolean;
    nextTurnNumber?: number;
    rng?: {
      seed: string;
      rolls: number[];
    };
  };
  llmCalls: Array<{
    model: string;
    promptTemplate: string;
    /** Hash of the rendered prompt that was sent. */
    promptHash: string;
    latencyMs: number;
    cache: 'hit' | 'miss';
    stage?: string;
    modelKey?: string | null;
    provider?: string;
    /** Hash of the unrendered template, and where it was loaded from. */
    templateHash?: string;
    templateSource?: string;
    /** Set on attempts after the first: a retry of the same model, or the fallback model. */
    recovery?: 'retry' | 'fallback';
    usage?: { promptTokens: number | null; completionTokens: number | null };
    error?: string;
  }>;
  turnContent?: {
    narration: string;
    imagePrompt: string;
    imageModelKey?: string;
    imageMetadata?: unknown;
    imagePromptSource?: string;
    theme?: string;
    style?: string;
    toneHints?: string[];
    promptChain?: unknown[];
    masterEnrichment?: unknown;
    fallbackUsed?: boolean;
  };
  actions?: unknown[];
  imagePlan?: {
    cacheKey: string;
    template: string;
    style?: string;
    cacheHit: boolean;
    imageUrl?: string;
  };
  warnings: string[];
  precomputeHash?: string;
  userPreferences?: {
    theme?: string;
    style?: string;
    imageModelKey?: string;
    /** Player's story model choice, kept so a regenerated turn uses the same model. */
    llmModelKey?: string;
    skipImageCache?: boolean;
  };
}

export interface ApplySection {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  transaction?: {
    id: string;
    tablesTouched: string[];
    rowsWritten: number;
  };
  stateDiff?: {
    previousDigest: string;
    nextDigest: string;
    statChanges: Record<string, number>;
    turnRecordId?: string;
  };
  imageJob?: {
    queueEntryId: string;
    status: string;
    precomputedMetadata?: unknown;
  };
  socket?: {
    emitted: boolean;
    namespace: string;
    room: string;
  };
  errors: string[];
}

export interface TurnExecutionManifest {
  version: string;
  job: JobSection;
  request: RequestSection;
  precompute?: PrecomputeSection;
  apply?: ApplySection;
  /** Scores from live-turn sampling, present only on turns that were sampled. Not part of the manifest hash. */
  evals?: {
    sampledAt: string;
    verdict: string;
    judgeModel: string;
    scores: Array<{ key: string; score: number | null; comment?: string }>;
  };
  postconditions?: {
    gameComplete: boolean;
    failureResolved: string | null;
  };
  attachments?: {
    logs?: string;
    promptArtifacts?: string;
  };
}

/**
 * Type helper for precomputed turn data passed to processTurnLogic
 * Matches the structure built in turnApplyWorker.ts
 */
export type PrecomputedTurnData = {
  turnContent: {
    narration: string;
    imagePrompt: string;
    imageModelKey: string;
    imageMetadata: unknown | null;
    imagePromptSource: string;
    theme: string;
    style: string;
    toneHints: unknown[];
    promptChain: unknown[];
    masterEnrichment: unknown | null;
    fallbackUsed: boolean;
  };
  actions: unknown[];
  checks: unknown[];
  selectedAction: unknown;
  event: unknown | null;
  skill: string;
  success: boolean;
  userPreferences?: {
    theme?: string;
    style?: string;
    imageModelKey?: string;
    /** Player's story model choice, kept so a regenerated turn uses the same model. */
    llmModelKey?: string;
    skipImageCache?: boolean;
  };
};

