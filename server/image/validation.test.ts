import { describe, expect, it } from "vitest";
import { HF_PROVIDERS, closestHfProvider, validateImageModelInput } from "./validation";

describe("validateImageModelInput", () => {
  it("accepts known providers and an empty or missing hf provider", () => {
    expect(validateImageModelInput({ provider: "huggingface", hfProvider: "fal-ai" })).toBeNull();
    expect(validateImageModelInput({ provider: "openai", hfProvider: "" })).toBeNull();
    expect(validateImageModelInput({ provider: "openai", hfProvider: null })).toBeNull();
    expect(validateImageModelInput({ hfProvider: "auto" })).toBeNull();
    expect(validateImageModelInput({})).toBeNull();
  });

  it("accepts every provider the client library knows", () => {
    for (const name of HF_PROVIDERS) {
      expect(validateImageModelInput({ hfProvider: name })).toBeNull();
    }
    expect(HF_PROVIDERS).toContain("fal-ai");
  });

  it("refuses the misspelling that was in the catalog, and suggests the fix", () => {
    const message = validateImageModelInput({ provider: "huggingface", hfProvider: "fai-ai" });
    expect(message).toContain('"fai-ai" is not a Hugging Face inference provider');
    expect(message).toContain('Did you mean "fal-ai"?');
  });

  it("refuses an unknown provider without guessing when nothing is close", () => {
    const message = validateImageModelInput({ hfProvider: "my-own-gpu-box" });
    expect(message).toContain("not a Hugging Face inference provider");
    expect(message).not.toContain("Did you mean");
  });

  it("refuses an unknown top-level provider", () => {
    expect(validateImageModelInput({ provider: "replicate" })).toContain("Provider must be one of: openai, huggingface");
  });

  it("ignores surrounding whitespace on the hf provider", () => {
    expect(validateImageModelInput({ hfProvider: "  fal-ai " })).toBeNull();
  });

  it("finds the closest provider for likely typos only", () => {
    expect(closestHfProvider("replicat")).toBe("replicate");
    expect(closestHfProvider("FAL-AI")).toBe("fal-ai");
    expect(closestHfProvider("zzzzzzzzzz")).toBeNull();
  });
});
