import { ImageGenerator, ImageRequest, ImageResponse } from "../types";
import OpenAI from "openai";

const openaiImages = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class OpenAIImageGenerator implements ImageGenerator {
  async generate(req: ImageRequest): Promise<ImageResponse> {
    if (!req.modelName) {
      throw new Error("modelName is required for OpenAI image generation");
    }
    const response = await openaiImages.images.generate({
      model: req.modelName,
      prompt: req.prompt,
      n: 1,
      size: req.size,
      quality: req.quality,
      background: req.background,
      moderation: req.moderation,
    });

    const imageData = response.data?.[0];
    if (!imageData) throw new Error("No image data returned from OpenAI");

    if (imageData.b64_json) {
      return { imageUrl: `data:image/png;base64,${imageData.b64_json}`, imageBase64: imageData.b64_json };
    }
    if (imageData.url) return { imageUrl: imageData.url };
    throw new Error("Unsupported OpenAI image response format");
  }
}


