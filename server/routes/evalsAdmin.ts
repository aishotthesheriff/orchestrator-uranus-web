import express from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import { tracingStatus } from "../observability/langsmith";
import { requestModelId } from "../llm/models";
import { CODE_EVALUATORS } from "../evals/evaluators";
import { JUDGE_INFO, JUDGE_MODEL_SETTING, resolveJudgeModel } from "../evals/judges";
import { EVAL_DATASET_NAME, datasetExampleCount, scenarioTags, syncScenarioDataset } from "../evals/dataset";
import { getExperiment, listExperiments } from "../evals/experimentStore";
import { ExperimentBusyError, currentExperimentId, startExperiment } from "../evals/runner";
import { LIVE_SAMPLE_RATE_SETTING, clearLiveSampleRateCache, liveSampleRate } from "../evals/liveSampler";

/**
 * Dev Tools > Evals. Offline experiments over the saved PCE scenarios, and the settings
 * for scoring a sample of live turns. See docs_master/current/OBSERVABILITY_AND_EVALS.md.
 */
export const evalsAdmin = express.Router();
evalsAdmin.use(requireAdmin);

/** GET /status — everything the Evals tab needs to render before any experiment is run. */
evalsAdmin.get("/status", async (_req, res) => {
  try {
    const [scenarios, exampleCount, sampleRate, judgeModel, judgeSetting] = await Promise.all([
      storage.getPceTestScenarios({ limit: 500 }),
      datasetExampleCount(),
      liveSampleRate(),
      resolveJudgeModel(),
      storage.getSetting(JUDGE_MODEL_SETTING)
    ]);
    const tags = [...new Set(scenarios.flatMap((s) => scenarioTags(s.tags)))].sort();
    res.json({
      tracing: tracingStatus(),
      dataset: {
        name: EVAL_DATASET_NAME,
        scenarioCount: scenarios.length,
        /** Null when the dataset has not been created in LangSmith yet (or it is unreachable). */
        exampleCount,
        tags
      },
      evaluators: [...CODE_EVALUATORS.map(({ evaluate: _evaluate, ...info }) => info), ...JUDGE_INFO],
      settings: {
        liveSampleRate: sampleRate,
        judgeModelKey: judgeSetting?.active ? judgeSetting.value || null : null,
        judgeModel: requestModelId(judgeModel)
      },
      runningExperimentId: currentExperimentId()
    });
  } catch (error) {
    console.error("Failed to load eval status", error);
    res.status(500).json({ error: "Failed to load eval status" });
  }
});

/** POST /dataset/sync — make the LangSmith dataset match the saved scenarios. */
evalsAdmin.post("/dataset/sync", async (_req, res) => {
  try {
    res.json(await syncScenarioDataset());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(/not configured/.test(message) ? 409 : 502).json({ error: message });
  }
});

/** GET /experiments — most recent first. */
evalsAdmin.get("/experiments", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    res.json({ experiments: await listExperiments(limit), runningExperimentId: currentExperimentId() });
  } catch (error) {
    console.error("Failed to list experiments", error);
    res.status(500).json({ error: "Failed to list experiments" });
  }
});

evalsAdmin.get("/experiments/:id", async (req, res) => {
  const experiment = await getExperiment(req.params.id).catch(() => null);
  if (!experiment) return res.status(404).json({ error: "Experiment not found" });
  res.json(experiment);
});

const StartSchema = z.object({
  modelKey: z.string().trim().min(1).nullable().optional(),
  promptSource: z.enum(["reference", "database"]),
  judges: z.array(z.string()).optional(),
  scenarioTag: z.string().trim().min(1).nullable().optional()
});

/** POST /experiments — start one. It runs in the background; poll GET /experiments/:id. */
evalsAdmin.post("/experiments", async (req, res) => {
  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid experiment request", details: parsed.error.flatten() });
  }
  try {
    res.status(202).json(await startExperiment(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ExperimentBusyError ? 409 : /not configured/.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

const SettingsSchema = z.object({
  /** Fraction of live turns to score, 0 to 1. */
  liveSampleRate: z.number().min(0).max(1).optional(),
  /** Catalog key of the judge model; null returns to the built-in utility model. */
  judgeModelKey: z.string().trim().min(1).nullable().optional()
});

/** PUT /settings — live sample rate and judge model. Takes effect at once, no release needed. */
evalsAdmin.put("/settings", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  }
  try {
    const { liveSampleRate: rate, judgeModelKey } = parsed.data;
    if (judgeModelKey) {
      const model = await storage.getLlmModelByKey(judgeModelKey);
      if (!model) return res.status(400).json({ error: `Story model "${judgeModelKey}" is not in the catalog` });
    }
    if (rate !== undefined) {
      await storage.upsertSetting(LIVE_SAMPLE_RATE_SETTING, String(rate), "Fraction of live turns scored by the eval judges (0 = off)");
      clearLiveSampleRateCache();
    }
    if (judgeModelKey !== undefined) {
      await storage.upsertSetting(JUDGE_MODEL_SETTING, judgeModelKey ?? "", "Catalog key of the model that grades turns in evals (empty = built-in utility model)");
    }
    const judgeModel = await resolveJudgeModel();
    res.json({
      liveSampleRate: await liveSampleRate(),
      judgeModelKey: judgeModelKey === undefined ? undefined : judgeModelKey,
      judgeModel: requestModelId(judgeModel)
    });
  } catch (error) {
    console.error("Failed to save eval settings", error);
    res.status(500).json({ error: "Failed to save eval settings" });
  }
});
