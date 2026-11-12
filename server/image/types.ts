export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

import type { InferenceProviderOrPolicy } from "@huggingface/inference";

export interface ImageRequest {
  prompt: string;
  size: ImageSize;
  quality: "low" | "medium" | "high" | "auto";
  background: "auto" | "transparent" | "opaque";
  moderation: "auto" | "low";
  inferenceProvider: "openai" | "huggingface";
  modelName: string;
  hfProvider?: InferenceProviderOrPolicy; // HuggingFace provider: "fal-ai", "inference-endpoints", "serverless", etc.
  /** The catalog row's provider_params (steps, guidance). See generationParams.ts. */
  providerParams?: unknown;
}

export interface ImageResponse {
  imageUrl?: string;
  imageBase64?: string;
}

export interface ImageGenerator {
  generate(req: ImageRequest): Promise<ImageResponse>;
}
