import { ImageGenerator } from "./types";
import { OpenAIImageGenerator } from "./providers/openai";
import { HuggingFaceImageGenerator } from "./providers/huggingface";
import type { ModelPreset } from "./types";

const openai = new OpenAIImageGenerator();
const hf = new HuggingFaceImageGenerator();

export const GENERATORS: Record<string, ImageGenerator> = {
  openai,
  huggingface: hf,
};

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  "gpt-image-1-mini": { 
    inferenceProvider: "openai", 
    modelName: "gpt-image-1-mini" 
  },
  "flux-schnell": { 
    inferenceProvider: "huggingface", 
    modelName: "black-forest-labs/FLUX.1-schnell",
    hfProvider: "fal-ai"
  },
  "sd-large-turbo": { 
    inferenceProvider: "huggingface", 
    modelName: "stabilityai/stable-diffusion-3.5-large-turbo",
    hfProvider: "fal-ai"
  },
  "sd-medium-turbo": { 
    inferenceProvider: "huggingface", 
    modelName: "stabilityai/stable-diffusion-3.5-medium",
    hfProvider: "fal-ai"
  },
  "claymation-xl": { 
    inferenceProvider: "huggingface", 
    modelName: "DervlexVenice/claymate_claymation_style_for_sdxl-style-sdxl",
    hfProvider: "fal-ai"
  },
  "retro-pixel-flux": { 
    inferenceProvider: "huggingface", 
    modelName: "prithivMLmods/Retro-Pixel-Flux-LoRA",
    hfProvider: "fal-ai"
  },
  "fal-flux-pixel-art": { 
    inferenceProvider: "huggingface", 
    modelName: "UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art",
    hfProvider: "auto"
  },
};


