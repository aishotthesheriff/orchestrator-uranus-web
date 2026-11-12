import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const promptTemplatesAdmin = express.Router();

promptTemplatesAdmin.use(requireAdmin);

promptTemplatesAdmin.get("/", async (_req, res) => {
  try {
    const prompts = await storage.getAllPromptTemplates();
    res.json(prompts);
  } catch (error) {
    console.error("Error fetching prompts:", error);
    res.status(500).json({ error: "Failed to fetch prompts" });
  }
});

promptTemplatesAdmin.get("/:name", async (req, res) => {
  try {
    const prompt = await storage.getActivePromptTemplate(req.params.name);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    res.json(prompt);
  } catch (error) {
    console.error("Error fetching prompt:", error);
    res.status(500).json({ error: "Failed to fetch prompt" });
  }
});

promptTemplatesAdmin.put("/:id", async (req, res) => {
  try {
    const { content, systemContent, inheritGlobalPrompt, description, active } = req.body;
    const updates: any = {};

    if (content !== undefined) updates.content = content;
    if (systemContent !== undefined) updates.systemContent = systemContent;
    if (inheritGlobalPrompt !== undefined) updates.inheritGlobalPrompt = inheritGlobalPrompt;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = active;

    const updated = await storage.updatePromptTemplate(req.params.id, updates);
    res.json(updated);
  } catch (error) {
    console.error("Error updating prompt:", error);
    res.status(500).json({ error: "Failed to update prompt" });
  }
});


