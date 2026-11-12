import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const eventsAdmin = express.Router();

eventsAdmin.use(requireAdmin);

eventsAdmin.get("/", async (_req, res) => {
  try {
    const events = await storage.getAllEvents();
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

eventsAdmin.post("/", async (req, res) => {
  try {
    const { name, segment, skill, dc, triggerCondition, passEffect, failEffect, tags, active } = req.body;
    const newEvent = await storage.createEvent({
      name,
      segment,
      skill,
      dc,
      triggerCondition,
      passEffect,
      failEffect,
      tags,
      active: active !== undefined ? active : 1
    });
    res.json(newEvent);
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to create event" });
  }
});

eventsAdmin.put("/:id", async (req, res) => {
  try {
    const { name, segment, skill, dc, triggerCondition, passEffect, failEffect, tags, active } = req.body;
    const updates: any = {};

    if (name !== undefined) updates.name = name;
    if (segment !== undefined) updates.segment = segment;
    if (skill !== undefined) updates.skill = skill;
    if (dc !== undefined) updates.dc = dc;
    if (triggerCondition !== undefined) updates.triggerCondition = triggerCondition;
    if (passEffect !== undefined) updates.passEffect = passEffect;
    if (failEffect !== undefined) updates.failEffect = failEffect;
    if (tags !== undefined) updates.tags = tags;
    if (active !== undefined) updates.active = active;

    const updated = await storage.updateEvent(req.params.id, updates);
    res.json(updated);
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
});


