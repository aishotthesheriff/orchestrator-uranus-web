import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const npcTemplatesAdmin = express.Router();

npcTemplatesAdmin.use(requireAdmin);

npcTemplatesAdmin.get("/", async (_req, res) => {
  try {
    const npcs = await storage.getNpcTemplates();
    res.json(npcs);
  } catch (error) {
    console.error("Error fetching NPC templates:", error);
    res.status(500).json({ error: "Failed to fetch NPC templates" });
  }
});

npcTemplatesAdmin.post("/", async (req, res) => {
  try {
    const newNpc = await storage.createNpcTemplate(req.body);
    res.json(newNpc);
  } catch (error) {
    console.error("Error creating NPC template:", error);
    res.status(500).json({ error: "Failed to create NPC template" });
  }
});

npcTemplatesAdmin.put("/:id", async (req, res) => {
  try {
    const updated = await storage.updateNpcTemplate(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error("Error updating NPC template:", error);
    res.status(500).json({ error: "Failed to update NPC template" });
  }
});


