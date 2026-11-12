import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const imagePromptsAdmin = express.Router();

imagePromptsAdmin.use(requireAdmin);

imagePromptsAdmin.get("/", async (_req, res) => {
  try {
    const prompts = await storage.getImagePrompts();
    res.json(prompts);
  } catch (error) {
    console.error("Error fetching image prompts:", error);
    res.status(500).json({ error: "Failed to fetch image prompts" });
  }
});

imagePromptsAdmin.post("/", async (req, res) => {
  try {
    const newPrompt = await storage.createImagePrompt(req.body);
    res.json(newPrompt);
  } catch (error) {
    console.error("Error creating image prompt:", error);
    res.status(500).json({ error: "Failed to create image prompt" });
  }
});

imagePromptsAdmin.put("/:id", async (req, res) => {
  try {
    const updated = await storage.updateImagePrompt(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error("Error updating image prompt:", error);
    res.status(500).json({ error: "Failed to update image prompt" });
  }
});


