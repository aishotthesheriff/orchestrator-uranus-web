import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const systemDefaultsReference = express.Router();

systemDefaultsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const systemDefaults = reference.data.system_defaults || {};
    res.json(systemDefaults);
  } catch (error) {
    console.error("Error fetching system defaults from reference:", error);
    res.status(500).json({ error: "Failed to fetch system defaults from reference" });
  }
});

