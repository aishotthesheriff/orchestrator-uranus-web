import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const eventsReference = express.Router();

eventsReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const events = (reference.data.events || []).filter((event: any) => event.active === 1);
    res.json(events);
  } catch (error) {
    console.error("Error fetching events from reference:", error);
    res.status(500).json({ error: "Failed to fetch events from reference" });
  }
});


