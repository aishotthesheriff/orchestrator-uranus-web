import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const imageModelsReference = express.Router();

imageModelsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const rows = (reference.data.image_models || []).filter((model: any) => (model.active ?? 1) === 1);

    // Normalize reference snapshot rows (which may be snake_case) to camelCase
    const models = rows.map((row: any) => ({
      id: row.id,
      modelKey: row.modelKey ?? row.model_key,
      provider: row.provider,
      modelName: row.modelName ?? row.model_name,
      hfProvider: row.hfProvider ?? row.hf_provider ?? null,
      active: row.active,
      displayName: row.displayName ?? row.display_name ?? row.modelKey ?? row.model_key,
      description: row.description ?? null,
      sortOrder: row.sortOrder ?? row.sort_order ?? 0,
      defaultSize: row.defaultSize ?? row.default_size ?? null,
      defaultQuality: row.defaultQuality ?? row.default_quality ?? null,
      defaultBackground: row.defaultBackground ?? row.default_background ?? null,
      defaultModeration: row.defaultModeration ?? row.default_moderation ?? null,
      allowedSizes: row.allowedSizes ?? row.allowed_sizes ?? null,
      capabilities: row.capabilities ?? null,
      providerParams: row.providerParams ?? row.provider_params ?? null,
      triggerWords: row.triggerWords ?? row.trigger_words ?? null,
      class: row.class ?? null,
      isDefault: row.isDefault ?? row.is_default ?? false,
    }));

    res.json(models);
  } catch (error) {
    console.error("Error fetching image models from reference:", error);
    res.status(500).json({ error: "Failed to fetch image models from reference" });
  }
});

