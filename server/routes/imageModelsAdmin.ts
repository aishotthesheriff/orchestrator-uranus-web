import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import { validateImageModelInput } from "../image/validation";

export const imageModelsAdmin = express.Router();

imageModelsAdmin.use(requireAdmin);

imageModelsAdmin.get("/", async (_req, res) => {
  try {
    const rows = await storage.listImageModels();
    res.json(rows);
  } catch (e) {
    console.error("Error listing image models:", e);
    res.status(500).json({ error: "Failed to list image models", details: e instanceof Error ? e.message : String(e) });
  }
});

imageModelsAdmin.post("/", async (req, res) => {
  try {
    const invalid = validateImageModelInput(req.body ?? {});
    if (invalid) return res.status(400).json({ error: invalid });
    const row = await storage.upsertImageModel(req.body);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: "Failed to upsert image model" });
  }
});

imageModelsAdmin.put("/:modelKey", async (req, res) => {
  try {
    const modelKey = req.params.modelKey;
    const invalid = validateImageModelInput(req.body ?? {});
    if (invalid) return res.status(400).json({ error: invalid });
    const row = await storage.upsertImageModel({ ...req.body, modelKey });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: "Failed to update image model" });
  }
});

imageModelsAdmin.delete("/:modelKey", async (req, res) => {
  try {
    await storage.deactivateImageModel(req.params.modelKey);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to deactivate image model" });
  }
});

imageModelsAdmin.put("/reorder", async (req, res) => {
  try {
    const order = req.body as { modelKey: string; sortOrder: number }[];
    await storage.reorderImageModels(order);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to reorder image models" });
  }
});


