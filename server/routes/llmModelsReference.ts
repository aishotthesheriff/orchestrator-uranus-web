import express from "express";
import { getDefaultLlmModelKey, listSelectableLlmModels } from "../llm/models";

/**
 * Public list of story models a player may choose.
 * Only player-safe fields are returned: no pricing, admin notes or health data.
 * Served from the published release; falls back to the database when the current
 * release predates the catalog, so the dropdown is never empty.
 */
export const llmModelsReference = express.Router();

llmModelsReference.get("/", async (_req, res) => {
  try {
    const rows = await listSelectableLlmModels();
    const defaultKey = await getDefaultLlmModelKey();
    const models = rows
      .map((row: any) => ({
        modelKey: row.modelKey ?? row.model_key,
        displayName: row.displayName ?? row.display_name ?? row.modelKey ?? row.model_key,
        description: row.description ?? null,
        adult: Boolean(row.adult),
        isDefault: defaultKey
          ? (row.modelKey ?? row.model_key) === defaultKey
          : Boolean(row.isDefault ?? row.is_default),
        sortOrder: row.sortOrder ?? row.sort_order ?? 0,
      }))
      .filter((m) => typeof m.modelKey === "string" && m.modelKey.length > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.modelKey.localeCompare(b.modelKey));
    res.json(models);
  } catch (error) {
    console.error("Error fetching story models:", error);
    res.status(500).json({ error: "Failed to fetch story models" });
  }
});
