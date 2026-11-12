import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const promptTemplatesReference = express.Router();

promptTemplatesReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const prompts = reference.data.prompts || [];
    res.json(prompts);
  } catch (error) {
    console.error("Error fetching prompt templates from reference:", error);
    res.status(500).json({ error: "Failed to fetch prompt templates from reference" });
  }
});


