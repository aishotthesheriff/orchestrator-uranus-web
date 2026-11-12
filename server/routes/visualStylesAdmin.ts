import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const visualStylesAdmin = express.Router();

visualStylesAdmin.use(requireAdmin);

visualStylesAdmin.get("/", async (_req, res) => {
  try {
    const rows = await storage.listVisualStyles();
    res.json(rows);
  } catch (error) {
    console.error("Error listing visual styles:", error);
    res.status(500).json({ 
      error: "Failed to list visual styles",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

visualStylesAdmin.post("/", async (req, res) => {
  try {
    const row = await storage.upsertVisualStyle(req.body);
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: "Failed to upsert visual style" });
  }
});

visualStylesAdmin.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const row = await storage.upsertVisualStyle({ ...req.body, id });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: "Failed to update visual style" });
  }
});

visualStylesAdmin.delete("/:id", async (req, res) => {
  try {
    await storage.deactivateVisualStyle(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to deactivate visual style" });
  }
});

