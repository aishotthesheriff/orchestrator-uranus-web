/**
 * How well a turn's model calls went, structurally: did each stage return usable JSON,
 * and what did it take to get it. Pure functions, shared by model qualification, offline
 * evals and live-turn sampling so all three grade a turn the same way.
 */

import type { PromptStage, StageMetadata } from "./contentRouter";

/**
 * Best to worst:
 *  clean     every stage returned valid JSON on the first try
 *  repaired  completed on the model's own output, but needed JSON repair and/or a retry
 *  fallback  completed only because the fallback model stepped in for at least one stage
 *  failed    the turn could not be completed
 */
export type StructuralVerdict = "clean" | "repaired" | "fallback" | "failed";

/** The facts about one stage that the verdict depends on. */
export interface StageOutcome {
  /** False when an earlier stage failed and this one could not run. */
  ran: boolean;
  ok: boolean;
  /** Model calls made for this stage (1 unless a retry or fallback was needed). */
  attempts: number;
  /** What the used output took: nothing, a retry of the same model, or the fallback model. */
  recovery: "none" | "retry" | "fallback";
  /** How the used output was read (see server/llm/json.ts). */
  jsonQuality?: StageMetadata["jsonQuality"];
}

export function verdictFromStages(stages: StageOutcome[]): StructuralVerdict {
  if (!stages.every((s) => s.ran && s.ok)) return "failed";
  if (stages.some((s) => s.recovery === "fallback")) return "fallback";
  if (stages.every((s) => s.attempts === 1 && s.jsonQuality === "raw")) return "clean";
  return "repaired";
}

export const PIPELINE_STAGES: readonly PromptStage[] = ["master", "narrative", "actions", "image"];

/**
 * Stage outcomes rebuilt from a turn's list of model calls (as stored on a manifest),
 * given which stages ended up producing output.
 */
export function stageOutcomesFromPromptChain(
  promptChain: StageMetadata[],
  produced: Record<PromptStage, boolean>
): Array<StageOutcome & { stage: PromptStage }> {
  return PIPELINE_STAGES.map((stage) => {
    const attempts = promptChain.filter((m) => m.stage === stage);
    const used = attempts[attempts.length - 1];
    return {
      stage,
      ran: attempts.length > 0,
      ok: produced[stage] && !!used && !used.error,
      attempts: attempts.length,
      recovery: used?.recovery ?? "none",
      jsonQuality: used?.jsonQuality
    };
  });
}

/** A verdict as a 0-1 score, so it can sit next to judge scores. */
export const VERDICT_SCORE: Record<StructuralVerdict, number> = {
  clean: 1,
  repaired: 0.67,
  fallback: 0.33,
  failed: 0
};
