import express from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/adminAuth";
import { traceUrl, tracingProjectId, tracingStatus } from "../observability/langsmith";

/**
 * Dev Tools access to tracing: whether it is on, and links from app records
 * (LLM logs, Inspector runs, turn manifests) to their trace in LangSmith.
 */
export const observabilityAdmin = express.Router();
observabilityAdmin.use(requireAdmin);

/** GET /status — is tracing on, where do traces go, and is that project reachable. */
observabilityAdmin.get("/status", async (_req, res) => {
  const status = tracingStatus();
  const projectId = status.enabled ? await tracingProjectId() : undefined;
  res.json({
    ...status,
    /** False until the first trace has created the project, or if the key is wrong. */
    projectReachable: !!projectId
  });
});

const TraceRefSchema = z.object({
  runId: z.string().uuid(),
  traceId: z.string().uuid()
});

/** GET /trace-url?runId=&traceId= — the LangSmith page for one run. */
observabilityAdmin.get("/trace-url", async (req, res) => {
  const parsed = TraceRefSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "runId and traceId are required" });
  }
  if (!tracingStatus().enabled) {
    return res.status(409).json({ error: "Tracing is off on this server" });
  }
  const url = await traceUrl(parsed.data);
  if (!url) {
    return res.status(404).json({ error: "Could not resolve this run in LangSmith" });
  }
  res.json({ url });
});
