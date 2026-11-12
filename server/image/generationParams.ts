/**
 * Per-model generation settings for Hugging Face image models, stored on the catalog row
 * (`image_models.provider_params`).
 *
 * Models differ a lot here. FLUX Schnell and the turbo models are distilled to make a good
 * image in about 4-5 steps; SDXL base needs around 30 and a guidance value, and at 5 steps
 * it returns smeared, noisy images. So steps and guidance are set per model.
 */

/** Used when a model sets nothing: what every model got before this was configurable. */
export const DEFAULT_INFERENCE_STEPS = 5;

interface ParamSpec {
  min: number;
  max: number;
  integer: boolean;
  label: string;
}

export const GENERATION_PARAM_SPECS = {
  num_inference_steps: { min: 1, max: 100, integer: true, label: "Steps" },
  guidance_scale: { min: 0, max: 30, integer: false, label: "Guidance scale" },
} as const satisfies Record<string, ParamSpec>;

export type GenerationParamKey = keyof typeof GENERATION_PARAM_SPECS;

export interface GenerationParams {
  num_inference_steps?: number;
  guidance_scale?: number;
}

const KEYS = Object.keys(GENERATION_PARAM_SPECS) as GenerationParamKey[];

/** A message for the first problem in a provider_params value, or null if it is usable. */
export function validateGenerationParams(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return "Generation parameters must be an object, e.g. {\"num_inference_steps\": 30, \"guidance_scale\": 7}";
  }
  const record = value as Record<string, unknown>;

  const unknown = Object.keys(record).filter((key) => !(KEYS as string[]).includes(key));
  if (unknown.length > 0) {
    return `Unknown generation parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Supported: ${KEYS.join(", ")}`;
  }

  for (const key of KEYS) {
    if (record[key] === undefined || record[key] === null) continue;
    const spec: ParamSpec = GENERATION_PARAM_SPECS[key];
    const number = record[key];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      return `${spec.label} (${key}) must be a number`;
    }
    if (spec.integer && !Number.isInteger(number)) {
      return `${spec.label} (${key}) must be a whole number`;
    }
    if (number < spec.min || number > spec.max) {
      return `${spec.label} (${key}) must be between ${spec.min} and ${spec.max}`;
    }
  }
  return null;
}

/**
 * The parameters to send to the provider. Anything invalid or unknown is dropped (the
 * catalog is validated on save, but a row may predate that), and steps default to
 * DEFAULT_INFERENCE_STEPS.
 */
export function resolveGenerationParams(stored: unknown): Required<Pick<GenerationParams, "num_inference_steps">> & GenerationParams {
  const resolved: GenerationParams = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const key of KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (validateGenerationParams({ [key]: value }) === null) resolved[key] = value as number;
    }
  }
  return { ...resolved, num_inference_steps: resolved.num_inference_steps ?? DEFAULT_INFERENCE_STEPS };
}
