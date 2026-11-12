import { ImageGenerator } from "./types";
import { OpenAIImageGenerator } from "./providers/openai";
import { HuggingFaceImageGenerator } from "./providers/huggingface";

const openai = new OpenAIImageGenerator();
const hf = new HuggingFaceImageGenerator();

/**
 * Which generator handles each provider. Which models exist, and the provider and model id
 * each one uses, is not listed here: it comes from the published reference release (with
 * the `image_models` table as fallback). See `resolveModelPreset` in ./index.ts.
 */
export const GENERATORS: Record<string, ImageGenerator> = {
  openai,
  huggingface: hf,
};
