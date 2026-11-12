import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const visualStylesReference = express.Router();

visualStylesReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    // Reference data is published with camelCase fields from storage.getActiveVisualStyles()
    // Format: { id, category, visualStyleKey, label, exemplifiedBy, modifiersDiffusion, modifiersTransformer, active, rank, default, createdAt, updatedAt }
    const styles = (reference.data.mod_visual_styles || []).filter((style: any) => style.active === 1);
    res.json(styles);
  } catch (error) {
    console.error("Error fetching visual styles from reference:", error);
    res.status(500).json({ error: "Failed to fetch visual styles from reference" });
  }
});

