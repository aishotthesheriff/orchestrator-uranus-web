import { ImageGenerator, ImageRequest, ImageResponse } from "../types";
import { InferenceClient } from "@huggingface/inference";
import { resolveGenerationParams } from "../generationParams";

function parseSize(size: string): { width: number; height: number } {
  const [w, h] = size.split("x").map((v) => parseInt(v, 10));
  return { width: w, height: h };
}

export class HuggingFaceImageGenerator implements ImageGenerator {
  async generate(req: ImageRequest): Promise<ImageResponse> {
    const token = process.env.HF_TOKEN;
    if (!token) throw new Error("HF_TOKEN not set");

    const { width, height } = parseSize(req.size);

    // Create client with direct token passing
    const hf = new InferenceClient(token);
    
    try {
      const provider = req.hfProvider ?? "fal-ai";
      const result = await hf.textToImage({
        provider,
        model: req.modelName,
        inputs: req.prompt,
        parameters: {
          width,
          height,
          // Steps (and guidance, if the model sets it) come from the catalog row: 5 steps
          // suits FLUX Schnell and the turbo models but ruins SDXL, which needs about 30.
          ...resolveGenerationParams(req.providerParams),
        },
      });

      // result is a Blob; convert to Buffer
      try {
        // Try to treat as Blob first
        const arrayBuffer = await (result as any).arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        const imageBase64 = buf.toString("base64");
        return { imageBase64, imageUrl: `data:image/png;base64,${imageBase64}` };
      } catch (blobError) {
        // If that fails, try as string
        if (typeof result === 'string') {
          return { imageBase64: result, imageUrl: `data:image/png;base64,${result}` };
        } else {
          throw new Error('Unexpected result type from HuggingFace textToImage');
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      
      // Handle specific error types
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        throw new Error(`HF Inference error 404: Not Found (model: ${req.modelName}${req.hfProvider ? `, provider: ${req.hfProvider}` : ''})`);
      }
      
      if (msg.includes("429") || msg.toLowerCase().includes("too many requests") || msg.toLowerCase().includes("rate limit")) {
        throw new Error(`HF Inference rate limit exceeded. Please try again later. (model: ${req.modelName})`);
      }
      
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        throw new Error(`HF Inference authentication failed. Please check your HF_TOKEN. (model: ${req.modelName})`);
      }
      
      if (msg.includes("500") || msg.toLowerCase().includes("internal server error")) {
        throw new Error(`HF Inference server error. The model may be temporarily unavailable. (model: ${req.modelName})`);
      }
      
      // Generic error handling
      throw new Error(`HF Inference error: ${msg} (model: ${req.modelName})`);
    }
  }
}

