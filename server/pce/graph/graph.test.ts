import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptStage, StageMetadata, StageResult, TurnGenerationContext } from "../contentRouter";
import { adhocLlmModel } from "../../llm/models";
import { runPceGraph, type StageRunner } from "./index";

// The graph is tested with a scripted stage runner: no prompts are built and no model is
// called. Each stage succeeds unless told otherwise.

const primary = adhocLlmModel({ provider: "huggingface", modelName: "org/primary" });
const fallback = adhocLlmModel({ provider: "huggingface", modelName: "org/fallback" });

const context = (): TurnGenerationContext =>
  ({
    state: { id: "game-1", turnNumber: 4 },
    gameId: "game-1",
    turnNumber: 4,
    llmModel: primary,
    llmFallback: fallback,
    selections: { theme: "noir", style: "ink", imageModelKey: "img" }
  } as unknown as TurnGenerationContext);

const OUTPUTS: Record<PromptStage, unknown> = {
  master: { enrichment: { context: { scene: "bridge" } }, flattened: {} },
  narrative: { narration: "The hull groans." },
  actions: { actions: [{ action: "Seal the breach", summary: "s", risk: "Safe", intent: "repair" }] },
  image: { imagePrompt: "A cracked hull, ink wash" }
};

interface Call {
  stage: PromptStage;
  model?: string;
  promptSource: string;
  sawMaster: boolean;
  sawNarrative: boolean;
  startedAt: number;
  endedAt: number;
}

function scriptedRunner(options: { fail?: PromptStage[]; failOnceWith?: Partial<Record<PromptStage, Partial<StageMetadata>>>; delayMs?: number } = {}) {
  const calls: Call[] = [];
  const failedOnce = new Set<PromptStage>();
  let clock = 0;
  const runStage: StageRunner = async (stage, ctx, upstream, opts) => {
    const call: Call = {
      stage,
      model: ctx.llmModel?.modelName,
      promptSource: opts.promptSource,
      sawMaster: !!upstream.master,
      sawNarrative: !!upstream.narrative,
      startedAt: clock++,
      endedAt: -1
    };
    calls.push(call);
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5));
    call.endedAt = clock++;
    const meta = (extra: Partial<StageMetadata>): StageMetadata => ({
      stage,
      template: stage,
      model: ctx.llmModel?.modelName,
      timestamp: "t",
      ...extra
    });
    const scripted = options.failOnceWith?.[stage];
    if (scripted && !failedOnce.has(stage)) {
      failedOnce.add(stage);
      return { ok: false, output: null, metadata: [meta({ rawResponse: "not json", error: "JSON parse error", ...scripted })] } as StageResult<any>;
    }
    if (options.fail?.includes(stage)) {
      return { ok: false, output: null, metadata: [meta({ rawResponse: "not json", error: `${stage} unusable` })] } as StageResult<any>;
    }
    return { ok: true, output: OUTPUTS[stage], metadata: [meta({ rawResponse: "{}", jsonQuality: "raw" })] } as StageResult<any>;
  };
  return { runStage, calls };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("story pipeline graph", () => {
  it("runs master, then narrative, then actions and image", async () => {
    const { runStage, calls } = scriptedRunner();
    const result = await runPceGraph(context(), { runStage });

    expect(calls.map((c) => c.stage).slice(0, 2)).toEqual(["master", "narrative"]);
    expect(calls.map((c) => c.stage).slice(2).sort()).toEqual(["actions", "image"]);
    expect(result.master.ok && result.narrative.ok && result.actions.ok && result.image.ok).toBe(true);
    expect(result.narrative.output?.narration).toBe("The hull groans.");
  });

  it("gives each stage the outputs of the stages before it", async () => {
    const { runStage, calls } = scriptedRunner();
    await runPceGraph(context(), { runStage });
    const by = Object.fromEntries(calls.map((c) => [c.stage, c]));
    expect([by.master.sawMaster, by.master.sawNarrative]).toEqual([false, false]);
    expect([by.narrative.sawMaster, by.narrative.sawNarrative]).toEqual([true, false]);
    expect([by.actions.sawMaster, by.actions.sawNarrative]).toEqual([true, true]);
    expect([by.image.sawMaster, by.image.sawNarrative]).toEqual([true, true]);
  });

  it("runs actions and image at the same time", async () => {
    const { runStage, calls } = scriptedRunner({ delayMs: 20 });
    await runPceGraph(context(), { runStage });
    const actions = calls.find((c) => c.stage === "actions")!;
    const image = calls.find((c) => c.stage === "image")!;
    // Each started before the other finished.
    expect(actions.startedAt).toBeLessThan(image.endedAt);
    expect(image.startedAt).toBeLessThan(actions.endedAt);
  });

  it("lists model calls as master, narrative, actions, image whichever finished first", async () => {
    const { runStage } = scriptedRunner();
    const result = await runPceGraph(context(), { runStage });
    expect(result.promptChain.map((m) => m.stage)).toEqual(["master", "narrative", "actions", "image"]);
  });

  it("uses published prompts by default and drafts when asked", async () => {
    const published = scriptedRunner();
    await runPceGraph(context(), { runStage: published.runStage });
    expect(new Set(published.calls.map((c) => c.promptSource))).toEqual(new Set(["reference"]));

    const drafts = scriptedRunner();
    await runPceGraph(context(), { runStage: drafts.runStage, promptSource: "database" });
    expect(new Set(drafts.calls.map((c) => c.promptSource))).toEqual(new Set(["database"]));
  });

  it("stops after a failed master stage and throws in strict mode", async () => {
    const { runStage, calls } = scriptedRunner({ fail: ["master"] });
    await expect(runPceGraph(context(), { runStage, recover: false })).rejects.toThrow(
      /PCE turn generation failed: master stage failed.*master unusable/s
    );
    expect(calls.map((c) => c.stage)).toEqual(["master"]);
  });

  it("returns partial results in lenient mode instead of throwing", async () => {
    const { runStage, calls } = scriptedRunner({ fail: ["narrative"] });
    const result = await runPceGraph(context(), { runStage, recover: false, mode: "lenient" });
    expect(calls.map((c) => c.stage)).toEqual(["master", "narrative"]);
    expect(result.master.ok).toBe(true);
    expect(result.narrative.ok).toBe(false);
    // Stages that never ran have no attempts recorded.
    expect(result.actions).toEqual({ ok: false, output: null, metadata: [] });
    expect(result.image).toEqual({ ok: false, output: null, metadata: [] });
  });

  it("still runs the other branch when actions or image fails, then reports the failure", async () => {
    const { runStage, calls } = scriptedRunner({ fail: ["image"] });
    await expect(runPceGraph(context(), { runStage, recover: false })).rejects.toThrow(/image stage failed/);
    expect(calls.map((c) => c.stage).sort()).toEqual(["actions", "image", "master", "narrative"]);
  });

  it("retries and falls back inside a stage, keeping every attempt", async () => {
    const { runStage, calls } = scriptedRunner({ failOnceWith: { narrative: {} } });
    const result = await runPceGraph(context(), { runStage });
    expect(calls.filter((c) => c.stage === "narrative")).toHaveLength(2);
    expect(result.narrative.ok).toBe(true);
    expect(result.narrative.metadata.map((m) => m.recovery)).toEqual([undefined, "retry"]);
    expect(result.promptChain.map((m) => m.stage)).toEqual(["master", "narrative", "narrative", "actions", "image"]);
  });

  it("goes to the fallback model when the provider fails", async () => {
    const { runStage, calls } = scriptedRunner({ failOnceWith: { master: { rawResponse: null, providerError: true, error: "503" } } });
    const result = await runPceGraph(context(), { runStage });
    expect(calls.filter((c) => c.stage === "master").map((c) => c.model)).toEqual(["org/primary", "org/fallback"]);
    expect(result.master.metadata.map((m) => m.recovery)).toEqual([undefined, "fallback"]);
  });

  it("does not retry when recovery is off", async () => {
    const { runStage, calls } = scriptedRunner({ failOnceWith: { master: {} } });
    const result = await runPceGraph(context(), { runStage, recover: false, mode: "lenient" });
    expect(calls).toHaveLength(1);
    expect(result.master.ok).toBe(false);
  });

  describe("running part of the pipeline", () => {
    it("stops after the target stage", async () => {
      const { runStage, calls } = scriptedRunner();
      const result = await runPceGraph(context(), { runStage, target: "narrative" });
      expect(calls.map((c) => c.stage)).toEqual(["master", "narrative"]);
      expect(result.actions.metadata).toEqual([]);
    });

    it("runs only the target branch after the narration", async () => {
      const { runStage, calls } = scriptedRunner();
      const result = await runPceGraph(context(), { runStage, target: "image" });
      expect(calls.map((c) => c.stage)).toEqual(["master", "narrative", "image"]);
      expect(result.image.ok).toBe(true);
      expect(result.actions.ok).toBe(false);
    });

    it("skips stages whose results are supplied", async () => {
      const { runStage, calls } = scriptedRunner();
      const result = await runPceGraph(context(), {
        runStage,
        target: "actions",
        upstream: { master: OUTPUTS.master as any, narrative: { narration: "Supplied narration." } }
      });
      expect(calls.map((c) => c.stage)).toEqual(["actions"]);
      expect(calls[0].sawMaster && calls[0].sawNarrative).toBe(true);
      // Supplied stages count as done but contribute no model calls.
      expect(result.narrative.output?.narration).toBe("Supplied narration.");
      expect(result.promptChain.map((m) => m.stage)).toEqual(["actions"]);
    });

    it("runs master when only the narration is supplied", async () => {
      const { runStage, calls } = scriptedRunner();
      await runPceGraph(context(), {
        runStage,
        target: "actions",
        upstream: { narrative: { narration: "Supplied narration." } }
      });
      expect(calls.map((c) => c.stage)).toEqual(["master", "actions"]);
    });

    it("throws for a failed target but not for stages past it", async () => {
      const { runStage } = scriptedRunner({ fail: ["narrative"] });
      await expect(runPceGraph(context(), { runStage, target: "narrative", recover: false })).rejects.toThrow(
        /narrative stage failed/
      );
      const ok = scriptedRunner();
      await expect(runPceGraph(context(), { runStage: ok.runStage, target: "master" })).resolves.toBeTruthy();
    });
  });
});
