/**
 * Checks on image-model catalog edits, so a typo is refused when it is saved rather than
 * failing every turn that uses the model. (A provider named "fai-ai" instead of "fal-ai"
 * was saved without complaint and failed on every image.)
 */

import { PROVIDERS_OR_POLICIES } from "@huggingface/inference";
import { validateGenerationParams } from "./generationParams";

export const IMAGE_PROVIDERS = ["openai", "huggingface"] as const;

/** Hugging Face inference providers (and "auto") the installed client library knows. */
export const HF_PROVIDERS: readonly string[] = PROVIDERS_OR_POLICIES;

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** The known provider closest to `value`, if it is close enough to be a likely typo. */
export function closestHfProvider(value: string): string | null {
  const needle = value.trim().toLowerCase();
  let best: { name: string; distance: number } | null = null;
  for (const name of HF_PROVIDERS) {
    const distance = editDistance(needle, name);
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best && best.distance <= 2 ? best.name : null;
}

/**
 * Returns a message for the first problem in the fields that were supplied, or null.
 * Only fields present in `input` are checked, so a partial update (one field) works.
 * An empty hfProvider is allowed: the generator then uses its default.
 */
export function validateImageModelInput(input: { provider?: unknown; hfProvider?: unknown; providerParams?: unknown }): string | null {
  if (input.provider !== undefined && !(IMAGE_PROVIDERS as readonly string[]).includes(String(input.provider))) {
    return `Provider must be one of: ${IMAGE_PROVIDERS.join(", ")} (got "${String(input.provider)}")`;
  }

  const hf = input.hfProvider;
  if (hf !== undefined && hf !== null && String(hf).trim() !== "") {
    const value = String(hf).trim();
    if (!HF_PROVIDERS.includes(value)) {
      const suggestion = closestHfProvider(value);
      return (
        `"${value}" is not a Hugging Face inference provider.` +
        (suggestion ? ` Did you mean "${suggestion}"?` : "") +
        ` Valid values: ${HF_PROVIDERS.join(", ")}.`
      );
    }
  }

  if (input.providerParams !== undefined) {
    return validateGenerationParams(input.providerParams);
  }
  return null;
}
