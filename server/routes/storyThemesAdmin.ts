import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const storyThemesAdmin = express.Router();

storyThemesAdmin.use(requireAdmin);

storyThemesAdmin.get("/", async (_req, res) => {
  try {
    const rows = await storage.listStoryThemes();
    res.json(rows);
  } catch (error) {
    console.error("Error listing story themes:", error);
    res.status(500).json({ 
      error: "Failed to list story themes",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

storyThemesAdmin.post("/", async (req, res) => {
  try {
    const row = await storage.upsertStoryTheme(req.body);
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: "Failed to upsert story theme" });
  }
});

storyThemesAdmin.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const row = await storage.upsertStoryTheme({ ...req.body, id });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: "Failed to update story theme" });
  }
});

storyThemesAdmin.delete("/:id", async (req, res) => {
  try {
    await storage.deactivateStoryTheme(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to deactivate story theme" });
  }
});

