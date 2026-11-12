import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MasterEnrichmentData,
  StageMetadata,
  StageResult,
  TurnGenerationContext,
} from "../contentRouter";
import { BUILTIN_LLM_MODEL, adhocLlmModel, type ResolvedLlmModel } from "../../llm/models";
import { withRecovery } from "./recovery";

// The recovery steps (retry the same model, then the fallback model) are tested with a
// scripted stage: each call consumes the next scripted outcome.

const primary = adhocLlmModel({ provider: "huggingface", modelName: "org/primary" });
const fallback = adhocLlmModel({ provider: "huggingface", modelName: "org/fallback" });

type Outcome =
  | { kind: "ok" }
  | { kind: "badOutput"; finishReason?: string; maxTokens?: number } // model answered, answer unusable
  | { kind: "providerError" } // the provider call itself failed
  | { kind: "internalError" }; // our own code threw before or after the call

function meta(stage: StageMetadata["stage"], llm: ResolvedLlmModel | undefined, extra: Partial<StageMetadata>): StageMetadata {
  return { stage, template: stage, model: llm?.modelName, timestamp: "t", ...extra };
}

function scripted(outcomes: Outcome[]) {
  const calls: Array<{ model?: string; maxTokens?: number }> = [];
  const master = async (ctx: TurnGenerationContext): Promise<StageResult<MasterEnrichmentData>> => {
    const outcome = outcomes[calls.length] ?? { kind: "ok" };
    calls.push({ model: ctx.llmModel?.modelName, maxTokens: ctx.llmModel?.params.maxTokens });
    if (outcome.kind === "ok") {
      return {
        ok: true,
        output: { enrichment: { scene: "bridge" }, flattened: {} as any },
        metadata: [meta("master", ctx.llmModel, { rawResponse: "{}", jsonQuality: "raw", finishReason: "stop" })],
      };
    }
    if (outcome.kind === "badOutput") {
      return {
        ok: false,
        output: null,
        metadata: [
          meta("master", ctx.llmModel, {
            rawResponse: "not json",
            error: "JSON parse error",
            finishReason: outcome.finishReason ?? "stop",
            maxTokens: outcome.maxTokens,
          }),
        ],
      };
    }
    if (outcome.kind === "internalError") {
      return { ok: false, output: null, metadata: [meta("master", ctx.llmModel, { rawResponse: null, error: "Missing prompt variable" })] };
    }
    // Provider failure: the stage runner's catch block has no response to record.
    return {
      ok: false,
      output: null,
      metadata: [meta("master", ctx.llmModel, { rawResponse: null, error: "503 upstream", providerError: true })],
    };
  };
  const router = {
    generateMasterEnrichment: (ctx: TurnGenerationContext) => withRecovery("master", ctx, master),
  };
  return { router, calls };
}

const context = (overrides: Partial<TurnGenerationContext> = {}): TurnGenerationContext =>
  ({ llmModel: primary, llmFallback: fallback, ...overrides } as TurnGenerationContext);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("stage recovery", () => {
  it("makes a single call when the stage succeeds", async () => {
    const { router, calls } = scripted([{ kind: "ok" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0].recovery).toBeUndefined();
  });

  it("retries the same model once when its answer was unusable", async () => {
    const { router, calls } = scripted([{ kind: "badOutput" }, { kind: "ok" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(["org/primary", "org/primary"]);
    // Both attempts are kept, in order; the last one is the output that was used.
    expect(result.metadata.map((m) => m.recovery)).toEqual([undefined, "retry"]);
  });

  it("doubles the token limit when the first answer was cut off", async () => {
    const { router, calls } = scripted([{ kind: "badOutput", finishReason: "length", maxTokens: 600 }, { kind: "ok" }]);
    await router.generateMasterEnrichment(context());
    expect(calls[1]).toEqual({ model: "org/primary", maxTokens: 1200 });
  });

  it("caps the raised token limit", async () => {
    const { router, calls } = scripted([{ kind: "badOutput", finishReason: "length", maxTokens: 12000 }, { kind: "ok" }]);
    await router.generateMasterEnrichment(context());
    expect(calls[1].maxTokens).toBe(16000);
  });

  it("skips the retry when a cut-off reply was already at the ceiling", async () => {
    // Retrying with the same (or a lower) limit would just repeat the failure.
    const { router, calls } = scripted([{ kind: "badOutput", finishReason: "length", maxTokens: 20000 }, { kind: "ok" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(["org/primary", "org/fallback"]);
  });

  it("does not involve another model when our own code failed", async () => {
    const { router, calls } = scripted([{ kind: "internalError" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("treats a stage with no explicit model as the built-in model", async () => {
    // The fallback is the built-in model too, so there is nothing different to try.
    const { router, calls } = scripted([{ kind: "providerError" }]);
    const result = await router.generateMasterEnrichment(context({ llmModel: undefined, llmFallback: BUILTIN_LLM_MODEL }));
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("uses the fallback model after the retry also fails", async () => {
    const { router, calls } = scripted([{ kind: "badOutput" }, { kind: "badOutput" }, { kind: "ok" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(["org/primary", "org/primary", "org/fallback"]);
    expect(result.metadata.map((m) => m.recovery)).toEqual([undefined, "retry", "fallback"]);
    expect(result.metadata.at(-1)?.model).toBe("org/fallback");
  });

  it("skips the retry and goes straight to the fallback when the provider failed", async () => {
    const { router, calls } = scripted([{ kind: "providerError" }, { kind: "ok" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(["org/primary", "org/fallback"]);
    expect(result.metadata.map((m) => m.recovery)).toEqual([undefined, "fallback"]);
  });

  it("fails with every attempt recorded when the fallback fails too", async () => {
    const { router, calls } = scripted([{ kind: "badOutput" }, { kind: "badOutput" }, { kind: "providerError" }]);
    const result = await router.generateMasterEnrichment(context());
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
  });

  it("does not fall back when there is no fallback model", async () => {
    const { router, calls } = scripted([{ kind: "badOutput" }, { kind: "badOutput" }]);
    const result = await router.generateMasterEnrichment(context({ llmFallback: null }));
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("does not 'fall back' to the same model", async () => {
    const { router, calls } = scripted([{ kind: "providerError" }]);
    const result = await router.generateMasterEnrichment(context({ llmFallback: primary }));
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
