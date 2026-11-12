import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

export const itemsAdmin = express.Router();

itemsAdmin.use(requireAdmin);

itemsAdmin.get("/", async (_req, res) => {
  try {
    const items = await storage.getItems();
    res.json(items);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

itemsAdmin.post("/", async (req, res) => {
  try {
    const newItem = await storage.createItem(req.body);
    res.json(newItem);
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(500).json({ error: "Failed to create item" });
  }
});

itemsAdmin.put("/:id", async (req, res) => {
  try {
    const updated = await storage.updateItem(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).json({ error: "Failed to update item" });
  }
});


