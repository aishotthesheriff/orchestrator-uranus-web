import express from "express";
import { z } from "zod";
import { llmModelInputSchema, type LlmModel } from "@shared/schema";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import { getCurrentReference } from "../reference/referenceLoader";
import { HF_ROUTER_BASE_URL, describeLlmError, getLlmClient, maxTokensParam } from "../llm/clients";
import { diagnoseJson } from "../llm/json";
import { adhocLlmModel, requestModelId, resolveLlmFallback, toResolvedLlmModel, type ResolvedLlmModel } from "../llm/models";
import { runModelQualification } from "../pce/inspectorService";

/**
 * Dev Tools: story (LLM) model catalog.
 *
 * - CRUD on the llm_models table (drafts; players see a model only after a release is published)
 * - /discover  browse what the providers offer
 * - /check     quick "is this model still reachable" probe
 * - /qualify   run a saved scenario through the real story pipeline with a model
 */

export const llmModelsAdmin = express.Router();
llmModelsAdmin.use(requireAdmin);

type PublishState = "live" | "changed" | "unpublished" | "inactive";

/** Fields that matter to players or to how the model is called. Health-check data is ignored. */
const PUBLISHED_FIELDS = [
  "provider", "modelName", "hfProvider", "displayName", "description", "isDefault",
  "sortOrder", "adult", "supportsJsonMode", "params", "fallbackModelKey",
] as const;

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const comparable = (v: unknown) => JSON.stringify(v === undefined || v === "" || (typeof v === "object" && v !== null && Object.keys(v).length === 0) ? null : v);

function publishState(row: LlmModel, published: Map<string, any>, catalogPublished: boolean): PublishState {
  if (row.active !== 1) return "inactive";
  // Release without a catalog: the game reads this table directly, so active rows are live.
  if (!catalogPublished) return "live";
  const live = published.get(row.modelKey);
  if (!live) return "unpublished";
  const same = PUBLISHED_FIELDS.every(
    (field) => comparable((row as any)[field]) === comparable(live[field] ?? live[snake(field)])
  );
  return same ? "live" : "changed";
}

function sendZodError(res: express.Response, error: z.ZodError) {
  return res.status(400).json({
    error: error.errors.map((e) => `${e.path.join(".") || "request"}: ${e.message}`).join("; "),
  });
}

/** Catalog rows, each with its publish state and the themes that force it. */
llmModelsAdmin.get("/", async (_req, res) => {
  try {
    const rows = await storage.listLlmModels();

    let releaseVersion: string | null = null;
    const published = new Map<string, any>();
    try {
      const reference = await getCurrentReference();
      releaseVersion = reference.version;
      for (const row of reference.data.llm_models ?? []) {
        const key = row.modelKey ?? row.model_key;
        if (key && (row.active ?? 1) === 1) published.set(key, row);
      }
    } catch {
      // No release yet: everything is unpublished.
    }

    const forcedBy = new Map<string, string[]>();
    for (const theme of await storage.listStoryThemes()) {
      if (theme.active === 1 && theme.llmModelKey) {
        forcedBy.set(theme.llmModelKey, [...(forcedBy.get(theme.llmModelKey) ?? []), theme.label]);
      }
    }

    // False while the current release predates the catalog (see server/llm/models.ts).
    const catalogPublished = published.size > 0;

    res.json({
      releaseVersion,
      catalogPublished,
      models: rows.map((row) => ({
        ...row,
        publishState: publishState(row, published, catalogPublished),
        forcedByThemes: forcedBy.get(row.modelKey) ?? [],
      })),
    });
  } catch (error) {
    console.error("Error listing LLM models:", error);
    res.status(500).json({ error: "Failed to list story models", details: error instanceof Error ? error.message : String(error) });
  }
});

/** Create a model, or replace an existing one with the same key. */
llmModelsAdmin.post("/", async (req, res) => {
  const parsed = llmModelInputSchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  if (parsed.data.fallbackModelKey && parsed.data.fallbackModelKey === parsed.data.modelKey) {
    return res.status(400).json({ error: "A model cannot be its own fallback" });
  }
  // Making an inactive model the default would leave the game with no usable default.
  if (parsed.data.isDefault && (parsed.data.active ?? 1) !== 1) {
    return res.status(400).json({ error: "Activate the model before making it the default" });
  }
  try {
    res.json(await storage.upsertLlmModel(parsed.data));
  } catch (error) {
    console.error("Error saving LLM model:", error);
    res.status(500).json({ error: "Failed to save story model", details: error instanceof Error ? error.message : String(error) });
  }
});

/** Partial update of an existing model. The key itself cannot be changed. */
llmModelsAdmin.put("/:modelKey", async (req, res) => {
  const parsed = llmModelInputSchema.omit({ modelKey: true }).partial().safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  try {
    const modelKey = req.params.modelKey;
    if (parsed.data.fallbackModelKey && parsed.data.fallbackModelKey === modelKey) {
      return res.status(400).json({ error: "A model cannot be its own fallback" });
    }
    const existing = await storage.getLlmModelByKey(modelKey);
    if (!existing) {
      return res.status(404).json({ error: `Story model "${modelKey}" not found` });
    }
    if (parsed.data.isDefault && (parsed.data.active ?? existing.active) !== 1) {
      return res.status(400).json({ error: "Activate the model before making it the default" });
    }
    res.json(await storage.upsertLlmModel({ ...parsed.data, modelKey }));
  } catch (error) {
    console.error("Error updating LLM model:", error);
    res.status(500).json({ error: "Failed to update story model", details: error instanceof Error ? error.message : String(error) });
  }
});

/** Deactivate (soft delete). Players who chose it fall back to the default model. */
llmModelsAdmin.delete("/:modelKey", async (req, res) => {
  try {
    await storage.deactivateLlmModel(req.params.modelKey);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to deactivate story model" });
  }
});

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

interface DiscoveredProvider {
  provider: string;
  status: string | null;
  contextLength: number | null;
  priceInput: number | null;
  priceOutput: number | null;
  supportsJsonMode: boolean | null;
  latencyMs: number | null;
  throughput: number | null;
}

interface DiscoveredModel {
  id: string;
  providers: DiscoveredProvider[];
  likes?: number | null;
  downloads?: number | null;
}

const DISCOVER_TTL_MS = 10 * 60 * 1000;
const discoverCache = new Map<string, { at: number; models: DiscoveredModel[] }>();

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Models the HF router serves, with per-provider price, context and JSON support. */
async function discoverHuggingFaceRouter(): Promise<DiscoveredModel[]> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is not set in the server environment");
  const body = await fetchJson(`${HF_ROUTER_BASE_URL}/models`, { Authorization: `Bearer ${token}` });
  const data: any[] = Array.isArray(body?.data) ? body.data : [];
  return data
    .filter((m) => {
      const out = m?.architecture?.output_modalities;
      return !Array.isArray(out) || out.includes("text");
    })
    .map((m) => ({
      id: String(m.id),
      providers: (Array.isArray(m.providers) ? m.providers : []).map((p: any): DiscoveredProvider => ({
        provider: String(p.provider),
        status: p.status ?? null,
        contextLength: numOrNull(p.context_length),
        priceInput: numOrNull(p.pricing?.input),
        priceOutput: numOrNull(p.pricing?.output),
        supportsJsonMode: typeof p.supports_structured_output === "boolean" ? p.supports_structured_output : null,
        latencyMs: numOrNull(p.first_token_latency_ms),
        throughput: numOrNull(p.throughput),
      })),
    }));
}

/** Hub search: finds community models (e.g. abliterated fine-tunes) the router list omits. */
async function searchHuggingFaceHub(query: string): Promise<DiscoveredModel[]> {
  const params = new URLSearchParams({
    inference_provider: "all",
    pipeline_tag: "text-generation",
    search: query,
    sort: "likes",
    limit: "50",
  });
  for (const field of ["inferenceProviderMapping", "likes", "downloads"]) params.append("expand[]", field);
  const body = await fetchJson(`https://huggingface.co/api/models?${params.toString()}`);
  const list: any[] = Array.isArray(body) ? body : [];
  return list.map((m) => ({
    id: String(m.id),
    likes: numOrNull(m.likes),
    downloads: numOrNull(m.downloads),
    providers: (Array.isArray(m.inferenceProviderMapping) ? m.inferenceProviderMapping : [])
      .filter((p: any) => !p.task || p.task === "conversational")
      .map((p: any): DiscoveredProvider => ({
        provider: String(p.provider),
        status: p.status ?? null,
        contextLength: null,
        priceInput: null,
        priceOutput: null,
        supportsJsonMode: null,
        latencyMs: null,
        throughput: null,
      })),
  }));
}

async function discoverOpenAi(): Promise<DiscoveredModel[]> {
  const ids: string[] = [];
  for await (const m of getLlmClient("openai").models.list()) {
    ids.push(m.id);
    if (ids.length >= 2000) break;
  }
  // Chat-capable families only; the API also lists embedding, audio and image models.
  return ids
    .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(embedding|audio|realtime|tts|transcribe|image|search|moderation)/.test(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, providers: [] }));
}

/**
 * GET /discover?source=hf-router | hf-hub | openai [&q=search] [&refresh=1]
 * Each model is flagged with the catalog keys that already use it.
 */
llmModelsAdmin.get("/discover", async (req, res) => {
  const source = String(req.query.source ?? "hf-router");
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  try {
    if (!["hf-router", "hf-hub", "openai"].includes(source)) {
      return res.status(400).json({ error: `Unknown source "${source}"` });
    }
    if (source === "hf-hub" && q.length < 2) {
      return res.status(400).json({ error: "Type at least 2 characters to search the Hub" });
    }

    const cacheKey = source === "hf-hub" ? `hf-hub:${q.toLowerCase()}` : source;
    let entry = req.query.refresh ? undefined : discoverCache.get(cacheKey);
    if (!entry || Date.now() - entry.at > DISCOVER_TTL_MS) {
      const models =
        source === "hf-router" ? await discoverHuggingFaceRouter()
        : source === "hf-hub" ? await searchHuggingFaceHub(q)
        : await discoverOpenAi();
      entry = { at: Date.now(), models };
      discoverCache.set(cacheKey, entry);
    }

    const provider = source === "openai" ? "openai" : "huggingface";
    const catalog = await storage.listLlmModels();
    const inCatalog = new Map<string, string[]>();
    for (const row of catalog) {
      if (row.provider !== provider) continue;
      const id = row.modelName.split(":")[0].toLowerCase();
      inCatalog.set(id, [...(inCatalog.get(id) ?? []), row.modelKey]);
    }

    res.json({
      source,
      provider,
      fetchedAt: new Date(entry.at).toISOString(),
      models: entry.models.map((m) => ({ ...m, catalogKeys: inCatalog.get(m.id.toLowerCase()) ?? [] })),
    });
  } catch (error) {
    const { message } = describeLlmError(error);
    res.status(502).json({ error: `Could not list models: ${message}` });
  }
});

// ---------------------------------------------------------------------------
// Check and qualify
// ---------------------------------------------------------------------------

const ModelRefSchema = z.union([
  z.object({ modelKey: z.string().trim().min(1) }),
  z.object({
    provider: z.enum(["openai", "huggingface"]),
    modelName: z.string().trim().min(1),
    hfProvider: z.string().trim().nullable().optional(),
    supportsJsonMode: z.boolean().optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
  }),
]);

/** A catalog row (read from the database, so drafts work) or an ad-hoc model. */
async function resolveModelRef(ref: z.infer<typeof ModelRefSchema>): Promise<ResolvedLlmModel | null> {
  if ("modelKey" in ref) {
    return toResolvedLlmModel(await storage.getLlmModelByKey(ref.modelKey), "database");
  }
  return adhocLlmModel({
    provider: ref.provider,
    modelName: ref.modelName,
    hfProvider: ref.hfProvider,
    supportsJsonMode: ref.supportsJsonMode,
    params: ref.maxTokens ? { maxTokens: ref.maxTokens } : {},
  });
}

/**
 * POST /check  — send a tiny prompt to one model and report whether it answered.
 * For a catalog model the result is stored on the row. Always HTTP 200 when the
 * request itself was valid; the probe outcome is in `ok`.
 */
llmModelsAdmin.post("/check", async (req, res) => {
  const parsed = ModelRefSchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  let llm: ResolvedLlmModel | null;
  try {
    llm = await resolveModelRef(parsed.data);
  } catch (error) {
    console.error("LLM health check could not load the model:", error);
    return res.status(500).json({ error: "Failed to load the story model" });
  }
  if (!llm) return res.status(404).json({ error: "Story model not found in the catalog" });

  const model = requestModelId(llm);
  const params: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: "You are a health check. Reply with JSON only." },
      { role: "user", content: 'Return exactly this JSON object: {"ok": true}' },
    ],
    // Reasoning models spend tokens before answering, so honour the row's raised limit.
    [maxTokensParam(llm.provider)]: Math.max(64, llm.params.maxTokens ?? 0),
  };
  if (llm.supportsJsonMode) params.response_format = { type: "json_object" };

  const start = Date.now();
  let result: { ok: boolean; latencyMs: number; model: string; jsonQuality?: string; error?: string; upstreamStatus?: number | null };
  try {
    const response: any = await getLlmClient(llm.provider).chat.completions.create(params as any);
    const content: string = response.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonQuality = diagnoseJson(content).quality;
    result = {
      ok: content.length > 0,
      latencyMs: Date.now() - start,
      model,
      jsonQuality,
      ...(content.length === 0 ? { error: "The model returned an empty response" } : {}),
    };
  } catch (error) {
    const { status, message } = describeLlmError(error);
    result = { ok: false, latencyMs: Date.now() - start, model, error: message, upstreamStatus: status };
  }

  if (llm.key) {
    await storage
      .recordLlmModelCheck(llm.key, result.ok, { check: { ...result, at: new Date().toISOString() } })
      .catch((e) => console.warn("[LLM] Could not store health check:", e));
  }
  res.json({ modelKey: llm.key, ...result });
});

const QualifySchema = z.object({
  model: ModelRefSchema,
  scenarioId: z.string().min(1, "scenarioId is required"),
});

/**
 * POST /qualify — one full pipeline run of a saved scenario with the given model.
 * The client repeats the call for multiple runs so progress is visible.
 */
llmModelsAdmin.post("/qualify", async (req, res) => {
  const parsed = QualifySchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  try {
    const llm = await resolveModelRef(parsed.data.model);
    if (!llm) return res.status(404).json({ error: "Story model not found in the catalog" });

    // Same fallback the game would use, but read from the database so drafts can be tested.
    const llmFallback = await resolveLlmFallback(
      llm,
      async (key) => toResolvedLlmModel(await storage.getLlmModelByKey(key), "database"),
      (await storage.getDefaultLlmModel())?.modelKey ?? null
    );
    const result = await runModelQualification({ scenarioId: parsed.data.scenarioId, llm, llmFallback });

    if (llm.key) {
      await storage
        .recordLlmModelCheck(llm.key, null, {
          qualify: {
            at: new Date().toISOString(),
            scenarioId: result.scenarioId,
            runId: result.runId,
            ok: result.ok,
            strictOk: result.strictOk,
            verdict: result.verdict,
            turnMs: result.turnMs,
            costUsd: result.costUsd,
          },
        })
        .catch((e) => console.warn("[LLM] Could not store qualification result:", e));
    }
    res.json(result);
  } catch (error) {
    console.error("LLM qualification failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(/^Scenario .* not found$/.test(message) ? 404 : 500).json({ error: message });
  }
});
