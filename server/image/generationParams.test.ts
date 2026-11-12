import { describe, expect, it } from "vitest";
import { DEFAULT_INFERENCE_STEPS, resolveGenerationParams, validateGenerationParams } from "./generationParams";
import { validateImageModelInput } from "./validation";

describe("validateGenerationParams", () => {
  it("accepts nothing, or valid steps and guidance", () => {
    expect(validateGenerationParams(null)).toBeNull();
    expect(validateGenerationParams(undefined)).toBeNull();
    expect(validateGenerationParams({})).toBeNull();
    expect(validateGenerationParams({ num_inference_steps: 30, guidance_scale: 7 })).toBeNull();
    expect(validateGenerationParams({ guidance_scale: 7.5 })).toBeNull();
  });

  it("refuses values that are not an object", () => {
    expect(validateGenerationParams("30")).toContain("must be an object");
    expect(validateGenerationParams([30])).toContain("must be an object");
  });

  it("refuses unknown parameters instead of silently ignoring them", () => {
    expect(validateGenerationParams({ steps: 30 })).toContain("Unknown generation parameter: steps");
    expect(validateGenerationParams({ a: 1, b: 2 })).toContain("a, b");
  });

  it("refuses non-numbers, fractional steps and out-of-range values", () => {
    expect(validateGenerationParams({ num_inference_steps: "30" })).toContain("must be a number");
    expect(validateGenerationParams({ num_inference_steps: 12.5 })).toContain("whole number");
    expect(validateGenerationParams({ num_inference_steps: 0 })).toContain("between 1 and 100");
    expect(validateGenerationParams({ num_inference_steps: 500 })).toContain("between 1 and 100");
    expect(validateGenerationParams({ guidance_scale: -1 })).toContain("between 0 and 30");
    expect(validateGenerationParams({ guidance_scale: Number.NaN })).toContain("must be a number");
  });
});

describe("resolveGenerationParams", () => {
  it("defaults to 5 steps, as every model had before this was configurable", () => {
    expect(DEFAULT_INFERENCE_STEPS).toBe(5);
    expect(resolveGenerationParams(null)).toEqual({ num_inference_steps: 5 });
    expect(resolveGenerationParams({})).toEqual({ num_inference_steps: 5 });
  });

  it("uses what the model sets", () => {
    expect(resolveGenerationParams({ num_inference_steps: 30, guidance_scale: 7 })).toEqual({
      num_inference_steps: 30,
      guidance_scale: 7,
    });
    expect(resolveGenerationParams({ guidance_scale: 3.5 })).toEqual({ num_inference_steps: 5, guidance_scale: 3.5 });
  });

  it("drops invalid or unknown values from a row that predates validation", () => {
    expect(resolveGenerationParams({ num_inference_steps: "many", guidance_scale: 7, evil: 1 })).toEqual({
      num_inference_steps: 5,
      guidance_scale: 7,
    });
    expect(resolveGenerationParams("not an object")).toEqual({ num_inference_steps: 5 });
  });
});

describe("validateImageModelInput with provider params", () => {
  it("checks providerParams when supplied", () => {
    expect(validateImageModelInput({ providerParams: { num_inference_steps: 30 } })).toBeNull();
    expect(validateImageModelInput({ providerParams: null })).toBeNull();
    expect(validateImageModelInput({ providerParams: { num_inference_steps: 0 } })).toContain("between 1 and 100");
  });
});
