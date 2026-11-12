import { describe, expect, it } from "vitest";
import type { ActionChip } from "@shared/schema";
import type { StageMetadata } from "../pce/contentRouter";
import { stageOutcomesFromPromptChain, verdictFromStages } from "../pce/verdict";
import {
  countSentences,
  runCodeEvaluators,
  structuralVerdictOf,
  summarizeScores,
  type TurnEvalInput,
  type TurnEvalOutput
} from "./evaluators";

const call = (stage: StageMetadata["stage"], extra: Partial<StageMetadata> = {}): StageMetadata => ({
  stage,
  template: stage,
  model: "org/primary",
  timestamp: "t",
  rawResponse: "{}",
  jsonQuality: "raw",
  ...extra
});

const cleanChain = (): StageMetadata[] => [call("master"), call("narrative"), call("actions"), call("image")];

const action = (overrides: Partial<ActionChip> = {}): ActionChip => ({
  action: "Seal the breach",
  summary: "Patch the hull with the emergency foam before the air runs out.",
  risk: "Safe",
  intent: "repair",
  ...overrides
});

const input: TurnEvalInput = {
  playerAction: "Repair the hull",
  checks: [{ skill: "engineering", success: true }],
  triggeredEvent: null,
  theme: "noir",
  style: "ink"
};

const output = (overrides: Partial<TurnEvalOutput> = {}): TurnEvalOutput => ({
  narration:
    "You wedge yourself into the crawlspace. The foam canister hisses. A seam of frost marks the breach. " +
    "You press the nozzle to it and squeeze. The hiss fades to nothing. Somewhere aft, the captain exhales.",
  actions: [
    action(),
    action({ action: "Check the aft sensors", intent: "research", risk: "Risky" }),
    action({ action: "Report to the captain", intent: "command", risk: "Wild" })
  ],
  imagePrompt: "A cramped crawlspace, frost along a hull seam, ink wash",
  promptChain: cleanChain(),
  ...overrides
});

const score = (o: TurnEvalOutput, key: string) => runCodeEvaluators(o, input).find((s) => s.key === key)!;

describe("structural verdict", () => {
  it("is clean when every stage answered with valid JSON on the first try", () => {
    expect(structuralVerdictOf(output())).toBe("clean");
    expect(score(output(), "structural_verdict").score).toBe(1);
  });

  it("is repaired when a stage needed JSON repair", () => {
    const chain = cleanChain();
    chain[1] = call("narrative", { jsonQuality: "repaired" });
    expect(structuralVerdictOf(output({ promptChain: chain }))).toBe("repaired");
  });

  it("is repaired when a stage needed a retry", () => {
    const chain = [
      call("master"),
      call("narrative", { error: "JSON parse error", jsonQuality: "failed" }),
      call("narrative", { recovery: "retry" }),
      call("actions"),
      call("image")
    ];
    expect(structuralVerdictOf(output({ promptChain: chain }))).toBe("repaired");
  });

  it("is fallback when the fallback model served a stage", () => {
    const chain = [
      call("master", { rawResponse: null, error: "503", providerError: true }),
      call("master", { recovery: "fallback", model: "org/fallback" }),
      call("narrative"),
      call("actions"),
      call("image")
    ];
    const o = output({ promptChain: chain });
    expect(structuralVerdictOf(o)).toBe("fallback");
    // The comment names what went wrong first.
    expect(score(o, "structural_verdict")).toMatchObject({ score: 0.33, comment: "fallback: 503" });
  });

  it("is failed when a stage produced nothing", () => {
    const chain = [call("master"), call("narrative"), call("actions"), call("image", { error: "Image stage missing 'imagePrompt' field" })];
    expect(structuralVerdictOf(output({ imagePrompt: null, promptChain: chain }))).toBe("failed");
  });

  it("is failed when later stages never ran", () => {
    const chain = [call("master", { error: "JSON parse error" })];
    expect(structuralVerdictOf(output({ narration: null, actions: [], imagePrompt: null, promptChain: chain }))).toBe("failed");
  });

  it("grades a list of model calls the same way as per-stage reports", () => {
    const stages = stageOutcomesFromPromptChain(cleanChain(), { master: true, narrative: true, actions: true, image: true });
    expect(stages.map((s) => s.stage)).toEqual(["master", "narrative", "actions", "image"]);
    expect(stages.every((s) => s.ran && s.ok && s.attempts === 1 && s.recovery === "none")).toBe(true);
    expect(verdictFromStages(stages)).toBe("clean");
  });
});

describe("actions_valid", () => {
  it("passes distinct, well-formed actions", () => {
    expect(score(output(), "actions_valid").score).toBe(1);
  });

  it("is zero with no actions", () => {
    expect(score(output({ actions: [] }), "actions_valid")).toMatchObject({ score: 0, comment: "no actions" });
  });

  it("marks down duplicates, unknown labels and long summaries, one step per kind of problem", () => {
    const duplicate = output({ actions: [action(), action(), action({ action: "Report in", intent: "command" })] });
    expect(score(duplicate, "actions_valid").score).toBe(0.75);

    const badLabels = output({
      actions: [action({ risk: "Deadly" as any }), action({ action: "Wait", intent: "ponder" as any }), action({ action: "Run" })]
    });
    expect(score(badLabels, "actions_valid").score).toBe(0.5);

    const longSummary = output({
      actions: [action({ summary: Array(25).fill("word").join(" ") }), action({ action: "Wait" })]
    });
    expect(score(longSummary, "actions_valid")).toMatchObject({ score: 0.75, comment: "summary of 25 words" });
  });
});

describe("narration_length", () => {
  it("counts sentences, including ones ending in quotes or ellipses", () => {
    expect(countSentences("One. Two! Three? \"Four.\" Five… Six.")).toBe(6);
    expect(countSentences("")).toBe(0);
  });

  it("passes narration near the requested 6-7 sentences", () => {
    expect(score(output(), "narration_length")).toMatchObject({ score: 1, comment: "6 sentences (asked for 6-7)" });
  });

  it("fails narration that is far too short or missing", () => {
    expect(score(output({ narration: "It works. You win." }), "narration_length").score).toBe(0);
    expect(score(output({ narration: null }), "narration_length")).toMatchObject({ score: 0, comment: "no narration" });
  });
});

describe("summarizeScores", () => {
  it("averages each key and skips turns an evaluator could not score", () => {
    const summary = summarizeScores([
      [{ key: "a", score: 1 }, { key: "b", score: 0.5 }],
      [{ key: "a", score: 0 }, { key: "b", score: null }]
    ]);
    expect(summary).toEqual({ a: { mean: 0.5, n: 2 }, b: { mean: 0.5, n: 1 } });
  });

  it("reports a key nobody could score as null", () => {
    expect(summarizeScores([[{ key: "a", score: null }]])).toEqual({ a: { mean: null, n: 0 } });
  });
});
