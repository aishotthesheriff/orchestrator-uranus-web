import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const settingsReference = express.Router();

settingsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const settings = reference.data.settings || {};
    res.json(settings);
  } catch (error) {
    console.error("Error fetching settings from reference:", error);
    res.status(500).json({ error: "Failed to fetch settings from reference" });
  }
});

