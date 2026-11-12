import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const itemsReference = express.Router();

itemsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const items = (reference.data.items || []).filter((item: any) => item.active === 1);
    res.json(items);
  } catch (error) {
    console.error("Error fetching items from reference:", error);
    res.status(500).json({ error: "Failed to fetch items from reference" });
  }
});


