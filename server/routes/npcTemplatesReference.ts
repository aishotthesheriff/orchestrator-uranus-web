import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const npcTemplatesReference = express.Router();

npcTemplatesReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const npcs = (reference.data.npcs || []).filter((npc: any) => npc.active === 1);
    res.json(npcs);
  } catch (error) {
    console.error("Error fetching NPC templates from reference:", error);
    res.status(500).json({ error: "Failed to fetch NPC templates from reference" });
  }
});


