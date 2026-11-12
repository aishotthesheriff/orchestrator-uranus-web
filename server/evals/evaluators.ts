/**
 * Code evaluators: checks on a generated turn that need no model call.
 * Pure functions, so offline experiments and live-turn sampling score a turn identically.
 */

import type { ActionChip, Intent, Risk } from "@shared/schema";
import type { StageMetadata } from "../pce/contentRouter";
import {
  VERDICT_SCORE,
  stageOutcomesFromPromptChain,
  verdictFromStages,
  type StructuralVerdict
} from "../pce/verdict";

/** What the turn was asked to do: the part of the request a reader needs to judge the result. */
export interface TurnEvalInput {
  playerAction: string;
  checks: Array<{ skill?: string; dc?: number; roll?: number; success?: boolean; description?: string }>;
  triggeredEvent: { name: string; segment?: string; skill?: string } | null;
  theme: string | null;
  style: string | null;
  turnNumber?: number;
}

/** What the pipeline produced. */
export interface TurnEvalOutput {
  narration: string | null;
  actions: ActionChip[];
  imagePrompt: string | null;
  /** Every model call made for the turn, in order. */
  promptChain: StageMetadata[];
}

export interface EvalScore {
  key: string;
  /** 0 to 1. Null when the evaluator could not score this turn. */
  score: number | null;
  comment?: string;
}

export interface EvaluatorInfo {
  key: string;
  title: string;
  kind: "code" | "judge";
  description: string;
}

const INTENTS: readonly Intent[] = ["repair", "negotiate", "cook", "explore", "improvise", "research", "command", "other"];
const RISKS: readonly Risk[] = ["Safe", "Risky", "Wild"];

/** The narrative prompt asks for 6-7 sentences; outside this range the reply ignored it. */
const NARRATION_SENTENCES = { min: 4, max: 10 };
/** The actions prompt asks for summaries of at most 18 words. */
const ACTION_SUMMARY_MAX_WORDS = 18;

export function structuralVerdictOf(output: TurnEvalOutput): StructuralVerdict {
  const stages = stageOutcomesFromPromptChain(output.promptChain, {
    // A turn with narration necessarily had a usable scene plan.
    master: !!output.narration,
    narrative: !!output.narration,
    actions: output.actions.length > 0,
    image: !!output.imagePrompt
  });
  return verdictFromStages(stages);
}

function structuralVerdict(output: TurnEvalOutput): EvalScore {
  const verdict = structuralVerdictOf(output);
  const firstError = output.promptChain.find((m) => m.error)?.error;
  return {
    key: "structural_verdict",
    score: VERDICT_SCORE[verdict],
    comment: firstError ? `${verdict}: ${firstError}` : verdict
  };
}

function actionsValid(output: TurnEvalOutput): EvalScore {
  const problems: string[] = [];
  const actions = output.actions;
  if (actions.length === 0) {
    return { key: "actions_valid", score: 0, comment: "no actions" };
  }
  const labels = actions.map((a) => a.action.trim().toLowerCase());
  if (new Set(labels).size !== labels.length) problems.push("duplicate actions");
  for (const action of actions) {
    if (!INTENTS.includes(action.intent)) problems.push(`unknown intent "${action.intent}"`);
    if (!RISKS.includes(action.risk)) problems.push(`unknown risk "${action.risk}"`);
    const words = action.summary.trim().split(/\s+/).filter(Boolean).length;
    if (words > ACTION_SUMMARY_MAX_WORDS) problems.push(`summary of ${words} words`);
  }
  if (actions.length < 2) problems.push("fewer than 2 actions");
  // Each kind of problem costs a quarter; four or more is a zero.
  const kinds = new Set(problems.map((p) => p.replace(/"[^"]*"|\d+/g, ""))).size;
  return {
    key: "actions_valid",
    score: Math.max(0, 1 - kinds * 0.25),
    comment: problems.length ? problems.join("; ") : `${actions.length} valid actions`
  };
}

export function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?…]["'”’)]?)\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

function narrationLength(output: TurnEvalOutput): EvalScore {
  if (!output.narration) return { key: "narration_length", score: 0, comment: "no narration" };
  const sentences = countSentences(output.narration);
  const inRange = sentences >= NARRATION_SENTENCES.min && sentences <= NARRATION_SENTENCES.max;
  return {
    key: "narration_length",
    score: inRange ? 1 : 0,
    comment: `${sentences} sentences (asked for 6-7)`
  };
}

export const CODE_EVALUATORS: Array<EvaluatorInfo & { evaluate: (output: TurnEvalOutput, input: TurnEvalInput) => EvalScore }> = [
  {
    key: "structural_verdict",
    title: "Structural verdict",
    kind: "code",
    description: "Clean (1), repaired (0.67), served by the fallback model (0.33) or failed (0).",
    evaluate: structuralVerdict
  },
  {
    key: "actions_valid",
    title: "Actions valid",
    kind: "code",
    description: "Actions are distinct, use known intents and risk levels, and keep summaries to 18 words.",
    evaluate: actionsValid
  },
  {
    key: "narration_length",
    title: "Narration length",
    kind: "code",
    description: "Narration is close to the 6-7 sentences the prompt asks for.",
    evaluate: narrationLength
  }
];

export function runCodeEvaluators(output: TurnEvalOutput, input: TurnEvalInput): EvalScore[] {
  return CODE_EVALUATORS.map((evaluator) => evaluator.evaluate(output, input));
}

/** Mean of each score key across turns, ignoring turns the evaluator could not score. */
export function summarizeScores(rows: EvalScore[][]): Record<string, { mean: number | null; n: number }> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    for (const { key, score } of row) {
      if (!byKey.has(key)) byKey.set(key, []);
      if (typeof score === "number") byKey.get(key)!.push(score);
    }
  }
  const summary: Record<string, { mean: number | null; n: number }> = {};
  for (const [key, values] of byKey) {
    summary[key] = {
      mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)) : null,
      n: values.length
    };
  }
  return summary;
}
