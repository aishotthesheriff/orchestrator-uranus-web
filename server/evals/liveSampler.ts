/**
 * Live-turn sampling: score a fraction of real player turns with the same evaluators the
 * offline experiments use.
 *
 * Runs after the turn has been committed and announced, in the background, one sample at
 * a time. If a sample is still being scored when the next turn lands, that turn is not
 * sampled. A sample lost to a restart is not retried: this is a statistical signal, not a
 * record that must be complete.
 *
 * Scores are written to the turn's manifest and, when tracing is on, attached as feedback
 * to the turn's trace in LangSmith.
 */

import { pool } from "../db";
import { storage } from "../storage";
import type { StageMetadata } from "../pce/contentRouter";
import { requestModelId } from "../llm/models";
import { getLangSmithClient, tracingEnabled, tracingProjectId, type TraceRef } from "../observability/langsmith";
import { runCodeEvaluators, structuralVerdictOf, type EvalScore, type TurnEvalInput, type TurnEvalOutput } from "./evaluators";
import { resolveJudgeModel, runJudges } from "./judges";

export const LIVE_SAMPLE_RATE_SETTING = "eval_live_sample_rate";

const RATE_CACHE_MS = 30_000;
let cachedRate: { value: number; at: number } | null = null;
let sampling = false;

/** Fraction of live turns to score, 0 to 1. Zero (the default) turns sampling off. */
export async function liveSampleRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.at < RATE_CACHE_MS) return cachedRate.value;
  let value = 0;
  try {
    const setting = await storage.getSetting(LIVE_SAMPLE_RATE_SETTING);
    const parsed = setting?.active ? Number(setting.value) : 0;
    value = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
  } catch (error) {
    console.warn("[Evals] Could not read the live sample rate:", error);
  }
  cachedRate = { value, at: Date.now() };
  return value;
}

export function clearLiveSampleRateCache(): void {
  cachedRate = null;
}

/** Scores stored on a turn's manifest. */
export interface ManifestEvals {
  sampledAt: string;
  verdict: string;
  judgeModel: string;
  scores: EvalScore[];
}

/** The parts of a manifest the sampler reads. */
export interface SampledTurn {
  manifestId: string;
  gameId: string;
  turnNumber: number;
  trace?: TraceRef;
  input: TurnEvalInput;
  output: TurnEvalOutput;
}

/** Build the sampler's view of a turn from its manifest. Null if the manifest has no turn content. */
export function sampledTurnFromManifest(manifestId: string, gameId: string, turnNumber: number, manifest: any): SampledTurn | null {
  const precompute = manifest?.precompute;
  const content = precompute?.turnContent;
  if (!content) return null;
  const deterministic = precompute.deterministic ?? {};
  const event = deterministic.event;
  return {
    manifestId,
    gameId,
    turnNumber,
    trace: manifest?.request?.langsmith,
    input: {
      playerAction: String(deterministic.selectedAction?.action ?? manifest?.request?.action?.type ?? ""),
      checks: Array.isArray(deterministic.checks) ? deterministic.checks : [],
      triggeredEvent: event?.name ? { name: event.name, segment: event.segment, skill: event.skill } : null,
      theme: content.theme ?? null,
      style: content.style ?? null,
      turnNumber
    },
    output: {
      narration: content.narration || null,
      actions: Array.isArray(precompute.actions) ? precompute.actions : [],
      imagePrompt: content.imagePrompt || null,
      promptChain: (Array.isArray(content.promptChain) ? content.promptChain : []) as StageMetadata[]
    }
  };
}

async function writeManifestEvals(manifestId: string, evals: ManifestEvals): Promise<void> {
  // Sets only the `evals` key, in one statement, so the rest of the manifest (and its hash,
  // which covers the turn itself) is untouched. JSON_QUERY makes the value a JSON object;
  // a bare parameter would be stored as a quoted string.
  await pool.query(
    `UPDATE turn_execution_manifests
        SET manifest = JSON_SET(manifest, '$.evals', JSON_QUERY($2, '$')), updated_at = NOW(3)
      WHERE id = $1`,
    [manifestId, JSON.stringify(evals)]
  );
}

async function sendFeedback(trace: TraceRef, scores: EvalScore[]): Promise<void> {
  const projectId = await tracingProjectId();
  if (!projectId) return;
  const client = getLangSmithClient();
  await Promise.allSettled(
    scores
      .filter((s): s is EvalScore & { score: number } => typeof s.score === "number")
      .map((s) =>
        client.createFeedback({
          runId: trace.runId,
          traceId: trace.traceId,
          sessionId: projectId,
          key: s.key,
          score: s.score,
          comment: s.comment,
          feedbackSourceType: "api",
          sourceInfo: { source: "live-sample" }
        })
      )
  );
}

/** Score one turn now. Exposed for tests and for scoring a turn on demand. */
export async function scoreTurn(turn: SampledTurn): Promise<ManifestEvals> {
  const judgeLlm = await resolveJudgeModel();
  const scores: EvalScore[] = [
    ...runCodeEvaluators(turn.output, turn.input),
    ...(await runJudges(turn.input, turn.output, { llm: judgeLlm, gameId: turn.gameId, turnNumber: turn.turnNumber }))
  ];
  const evals: ManifestEvals = {
    sampledAt: new Date().toISOString(),
    verdict: structuralVerdictOf(turn.output),
    judgeModel: requestModelId(judgeLlm),
    scores
  };
  await writeManifestEvals(turn.manifestId, evals);
  if (turn.trace && tracingEnabled()) await sendFeedback(turn.trace, scores);
  return evals;
}

/**
 * Called by the apply worker once a turn is complete. Returns immediately; scoring, if this
 * turn is picked, happens in the background and never affects the turn.
 */
export function maybeSampleTurn(load: () => SampledTurn | null, random: () => number = Math.random): void {
  void (async () => {
    try {
      const rate = await liveSampleRate();
      if (rate <= 0 || random() >= rate) return;
      if (sampling) return; // still scoring an earlier turn: skip this one
      const turn = load();
      if (!turn) return;
      sampling = true;
      try {
        const evals = await scoreTurn(turn);
        console.log(`[Evals] Sampled turn ${turn.turnNumber} of game ${turn.gameId}: ${evals.verdict}, ` +
          evals.scores.map((s) => `${s.key}=${s.score ?? "n/a"}`).join(" "));
      } finally {
        sampling = false;
      }
    } catch (error) {
      console.warn("[Evals] Live sampling failed:", error instanceof Error ? error.message : error);
    }
  })();
}
