import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const imagePromptsReference = express.Router();

imagePromptsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const imagePrompts = (reference.data.image_prompts || []).filter((prompt: any) => prompt.active === 1);
    res.json(imagePrompts);
  } catch (error) {
    console.error("Error fetching image prompts from reference:", error);
    res.status(500).json({ error: "Failed to fetch image prompts from reference" });
  }
});


