import express from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import {
  PceTestRunCreateSchema,
  PceTestRunUpdateSchema,
  PceTestScenarioCreateSchema,
  PceTestScenarioUpdateSchema,
} from "@shared/schema";
import { parseTestRun, parseTestScenario, runPceTest } from "../pce/inspectorService";
import { toResolvedLlmModel } from "../llm/models";

const router = express.Router();

router.use(requireAdmin);

router.get("/scenarios", async (req, res) => {
  try {
    const filters = {
      tags: typeof req.query.tags === "string" ? req.query.tags : undefined,
      preset: req.query.preset !== undefined ? parseBoolean(req.query.preset) : undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
    };
    if (filters.limit !== undefined && Number.isNaN(filters.limit)) {
      return res.status(400).json({ error: "limit must be a number" });
    }
    const scenarios = await storage.getPceTestScenarios(filters);
    res.json(scenarios.map(parseTestScenario));
  } catch (error) {
    console.error("Failed to list PCE test scenarios", error);
    res.status(500).json({ error: "Failed to list scenarios" });
  }
});

router.get("/scenarios/:id", async (req, res) => {
  try {
    const scenario = await storage.getPceTestScenario(req.params.id);
    if (!scenario) {
      return res.status(404).json({ error: "Scenario not found" });
    }
    res.json(parseTestScenario(scenario));
  } catch (error) {
    console.error("Failed to load scenario", error);
    res.status(500).json({ error: "Failed to load scenario" });
  }
});

router.post("/scenarios", async (req, res) => {
  try {
    const payload = coerceScenarioPayload(req.body);
    const parsed = PceTestScenarioCreateSchema.parse(payload);
    const created = await storage.createPceTestScenario({
      ...parsed,
      createdBy: parsed.createdBy ?? "admin"
    });
    res.status(201).json(parseTestScenario(created));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid scenario payload", details: error.flatten() });
    }
    console.error("Failed to create scenario", error);
    res.status(500).json({ error: "Failed to create scenario" });
  }
});

router.put("/scenarios/:id", async (req, res) => {
  try {
    const payload = coerceScenarioPayload(req.body);
    const parsed = PceTestScenarioUpdateSchema.parse(payload);
    const updated = await storage.updatePceTestScenario(req.params.id, parsed);
    res.json(parseTestScenario(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid scenario payload", details: error.flatten() });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return res.status(404).json({ error: "Scenario not found" });
    }
    console.error("Failed to update scenario", error);
    res.status(500).json({ error: "Failed to update scenario" });
  }
});

router.delete("/scenarios/:id", async (req, res) => {
  try {
    await storage.deletePceTestScenario(req.params.id);
    res.status(204).end();
  } catch (error) {
    console.error("Failed to delete scenario", error);
    res.status(500).json({ error: "Failed to delete scenario" });
  }
});

router.post("/test/run", async (req, res) => {
  try {
    const parsed = PceTestRunCreateSchema.parse(req.body);
    
    // Validate single-stage mode requires targetStage
    if (parsed.mode === 'single-stage' && !parsed.targetStage) {
      return res.status(400).json({ error: 'targetStage is required for single-stage mode' });
    }
    
    // Optional story-model override. Read from the database so unpublished catalog rows can be tested.
    const { llmModelKey, ...runOptions } = parsed;
    let llm;
    if (llmModelKey) {
      llm = toResolvedLlmModel(await storage.getLlmModelByKey(llmModelKey), "database");
      if (!llm) {
        return res.status(400).json({ error: `Story model "${llmModelKey}" is not in the catalog` });
      }
    }
    const run = await runPceTest({
      ...runOptions,
      llm: llm ?? undefined,
      tags: llm ? [runOptions.tags, `model:${llm.modelName}`].filter(Boolean).join(",") : runOptions.tags,
    });
    res.status(201).json(run);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid run payload", details: error.flatten() });
    }
    console.error("Failed to execute PCE test run", error);
    res.status(500).json({ error: "Failed to execute test run", message: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/runs", async (req, res) => {
  try {
    const filters = {
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      scenarioId: typeof req.query.scenarioId === "string" ? req.query.scenarioId : undefined,
      tags: typeof req.query.tags === "string" ? req.query.tags : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      starred: req.query.starred !== undefined ? parseBoolean(req.query.starred) : undefined,
    };
    if (filters.limit !== undefined && Number.isNaN(filters.limit)) {
      return res.status(400).json({ error: "limit must be a number" });
    }
    const runs = await storage.getPceTestRuns(filters);
    res.json(runs.map(parseTestRun));
  } catch (error) {
    console.error("Failed to list PCE test runs", error);
    res.status(500).json({ error: "Failed to list test runs" });
  }
});

router.get("/runs/:id", async (req, res) => {
  try {
    const run = await storage.getPceTestRun(req.params.id);
    if (!run) {
      return res.status(404).json({ error: "Test run not found" });
    }
    res.json(parseTestRun(run));
  } catch (error) {
    console.error("Failed to load test run", error);
    res.status(500).json({ error: "Failed to load test run" });
  }
});

router.put("/runs/:id", async (req, res) => {
  try {
    const parsed = PceTestRunUpdateSchema.parse(req.body);
    const updated = await storage.updatePceTestRun(req.params.id, parsed);
    res.json(parseTestRun(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid test run payload", details: error.flatten() });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return res.status(404).json({ error: "Test run not found" });
    }
    console.error("Failed to update test run", error);
    res.status(500).json({ error: "Failed to update test run" });
  }
});

router.delete("/runs/:id", async (req, res) => {
  try {
    await storage.deletePceTestRun(req.params.id);
    res.status(204).end();
  } catch (error) {
    console.error("Failed to delete test run", error);
    res.status(500).json({ error: "Failed to delete test run" });
  }
});

router.get("/runs/:id/metrics", async (req, res) => {
  try {
    const metrics = await storage.getPceTestMetrics(req.params.id);
    if (!metrics) {
      return res.status(404).json({ error: "Metrics not found" });
    }
    res.json(metrics);
  } catch (error) {
    console.error("Failed to load test run metrics", error);
    res.status(500).json({ error: "Failed to load metrics" });
  }
});

router.post("/runs/:id/metrics", async (_req, res) => {
  res.status(501).json({ error: "Metrics computation not implemented yet" });
});

router.get("/templates/:promptId/versions", async (req, res) => {
  try {
    const versions = await storage.getPceTemplateVersions(req.params.promptId);
    res.json(versions);
  } catch (error) {
    console.error("Failed to load template versions", error);
    res.status(500).json({ error: "Failed to load template versions" });
  }
});

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
}

function coerceScenarioPayload(body: any) {
  if (body?.gameState && !body.gameStateJson) {
    body.gameStateJson = JSON.stringify(body.gameState, null, 2);
  }
  if (body?.checks && !body.checksJson) {
    body.checksJson = JSON.stringify(body.checks);
  }
  if (body?.triggeredEvent && !body.triggeredEventJson) {
    body.triggeredEventJson = JSON.stringify(body.triggeredEvent);
  }
  return body;
}

export default router;
