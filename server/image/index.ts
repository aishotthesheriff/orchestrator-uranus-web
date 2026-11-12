import { ImageRequest, ImageResponse } from "./types";
import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import { GENERATORS } from "./registry";
import { imageModelCallDuration } from "../metrics";
export type { ImageRequest, ImageResponse } from "./types";

type ModelPresetResolved = {
  inferenceProvider: "openai" | "huggingface";
  modelName: string;
  hfProvider?: InferenceProviderOrPolicy;
  providerParams?: unknown;
};

async function resolveModelPreset(modelKey: string): Promise<ModelPresetResolved> {
  try {
    const { getCurrentReference } = await import("../reference/referenceLoader.js");
    const ref = await getCurrentReference();
    const row = (ref.data.image_models as any[]).find(m => (m.model_key === modelKey) || (m.modelKey === modelKey));
    if (row && (row.active ?? 1) === 1) {
      const hfProvider = row.hf_provider ?? row.hfProvider ?? undefined;
      return {
        inferenceProvider: row.provider as any,
        modelName: row.model_name ?? row.modelName,
        hfProvider: (hfProvider ?? undefined) as InferenceProviderOrPolicy | undefined,
        providerParams: row.provider_params ?? row.providerParams ?? undefined,
      };
    }
  } catch (_) {}

  // DB fallback
  try {
    const { storage } = await import("../storage.js");
    const fromDb = await storage.getImageModelByKey?.(modelKey);
    if (fromDb && fromDb.active === 1) {
      const hfProvider = fromDb.hfProvider ?? undefined;
      return {
        inferenceProvider: fromDb.provider as any,
        modelName: fromDb.modelName,
        hfProvider: (hfProvider ?? undefined) as InferenceProviderOrPolicy | undefined,
        providerParams: fromDb.providerParams ?? undefined,
      };
    }
  } catch (_) {}

  // No fallback - throw error if model not found
  throw new Error(`Image model key "${modelKey}" not found in reference or database`);
}

export async function generateWithModelKey(
  modelKey: string,
  req: Omit<ImageRequest, "inferenceProvider" | "modelName" | "hfProvider">,
  options?: { cache?: 'hit' | 'miss' }
): Promise<ImageResponse> {
  const preset = await resolveModelPreset(modelKey);
  const generator = GENERATORS[preset.inferenceProvider];
  
  if (!generator) {
    throw new Error(`No generator found for provider: ${preset.inferenceProvider}`);
  }

  // Track image model API call duration
  const timer = imageModelCallDuration.startTimer({
    model: modelKey,
    provider: preset.inferenceProvider,
    cache: options?.cache || 'miss'
  });

  try {
    const result = await generator.generate({ 
      ...req, 
      inferenceProvider: preset.inferenceProvider, 
      modelName: preset.modelName,
      hfProvider: preset.hfProvider,
      providerParams: preset.providerParams
    });
    timer();
    return result;
  } catch (error) {
    timer();
    throw error;
  }
}

