// Shared types and helpers for the Dev Tools "LLM Models" tab.

export type Provider = "openai" | "huggingface";

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  huggingface: "Hugging Face",
};

export type PublishState = "live" | "changed" | "unpublished" | "inactive";

export interface CatalogModel {
  id: string;
  modelKey: string;
  provider: Provider;
  modelName: string;
  hfProvider: string | null;
  active: number;
  isDefault: boolean;
  displayName: string;
  description: string | null;
  notes: string | null;
  sortOrder: number;
  adult: boolean;
  supportsJsonMode: boolean;
  contextLength: number | null;
  priceInput: number | null;
  priceOutput: number | null;
  params: { maxTokens?: number; temperature?: number } | null;
  /** Model used when this one fails a stage. Null: the default model. */
  fallbackModelKey: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckSummary: {
    check?: { ok: boolean; latencyMs: number; error?: string; at: string };
    qualify?: {
      ok: boolean;
      strictOk: boolean;
      verdict?: QualifyVerdict;
      turnMs: number;
      costUsd: number | null;
      at: string;
      runId: string;
    };
  } | null;
  publishState: PublishState;
  forcedByThemes: string[];
}

export interface CatalogResponse {
  releaseVersion: string | null;
  /** False while the current release predates the catalog: the game then reads the table directly. */
  catalogPublished: boolean;
  models: CatalogModel[];
}

/** Editable fields of a catalog row, as the form holds them. */
export interface CatalogDraft {
  modelKey: string;
  provider: Provider;
  modelName: string;
  hfProvider: string;
  displayName: string;
  description: string;
  notes: string;
  sortOrder: string;
  active: boolean;
  isDefault: boolean;
  adult: boolean;
  supportsJsonMode: boolean;
  contextLength: string;
  priceInput: string;
  priceOutput: string;
  maxTokens: string;
  temperature: string;
  /** Catalog key of the fallback model; "" means the default model. */
  fallbackModelKey: string;
}

export const EMPTY_DRAFT: CatalogDraft = {
  modelKey: "",
  provider: "huggingface",
  modelName: "",
  hfProvider: "",
  displayName: "",
  description: "",
  notes: "",
  sortOrder: "100",
  active: false,
  isDefault: false,
  adult: false,
  supportsJsonMode: true,
  contextLength: "",
  priceInput: "",
  priceOutput: "",
  maxTokens: "",
  temperature: "",
  fallbackModelKey: "",
};

export function draftFromModel(m: CatalogModel): CatalogDraft {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    modelKey: m.modelKey,
    provider: m.provider,
    modelName: m.modelName,
    hfProvider: m.hfProvider ?? "",
    displayName: m.displayName,
    description: m.description ?? "",
    notes: m.notes ?? "",
    sortOrder: String(m.sortOrder),
    active: m.active === 1,
    isDefault: m.isDefault,
    adult: m.adult,
    supportsJsonMode: m.supportsJsonMode,
    contextLength: str(m.contextLength),
    priceInput: str(m.priceInput),
    priceOutput: str(m.priceOutput),
    maxTokens: str(m.params?.maxTokens),
    temperature: str(m.params?.temperature),
    fallbackModelKey: m.fallbackModelKey ?? "",
  };
}

/** Convert the form to the API payload. Returns an error string when a number is malformed. */
export function draftToPayload(d: CatalogDraft): { payload?: Record<string, unknown>; error?: string } {
  const num = (label: string, raw: string, integer = false): number | null | string => {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) return `${label} must be a ${integer ? "whole " : ""}number`;
    return n;
  };
  const fields = {
    sortOrder: num("Sort order", d.sortOrder, true),
    contextLength: num("Context length", d.contextLength, true),
    priceInput: num("Input price", d.priceInput),
    priceOutput: num("Output price", d.priceOutput),
    maxTokens: num("Max tokens", d.maxTokens, true),
    temperature: num("Temperature", d.temperature),
  };
  for (const v of Object.values(fields)) if (typeof v === "string") return { error: v };
  if (!d.modelKey.trim()) return { error: "Model key is required" };
  if (!d.modelName.trim()) return { error: "Model id is required" };
  if (!d.displayName.trim()) return { error: "Display name is required" };

  const params: Record<string, number> = {};
  if (fields.maxTokens !== null) params.maxTokens = fields.maxTokens as number;
  if (fields.temperature !== null) params.temperature = fields.temperature as number;

  return {
    payload: {
      modelKey: d.modelKey.trim(),
      provider: d.provider,
      modelName: d.modelName.trim(),
      hfProvider: d.provider === "huggingface" && d.hfProvider.trim() ? d.hfProvider.trim() : null,
      displayName: d.displayName.trim(),
      description: d.description.trim() || null,
      notes: d.notes.trim() || null,
      sortOrder: (fields.sortOrder as number | null) ?? 0,
      active: d.active ? 1 : 0,
      isDefault: d.isDefault,
      adult: d.adult,
      supportsJsonMode: d.supportsJsonMode,
      contextLength: (fields.contextLength as number | null) || null,
      priceInput: fields.priceInput as number | null,
      priceOutput: fields.priceOutput as number | null,
      params: Object.keys(params).length > 0 ? params : null,
      fallbackModelKey: d.fallbackModelKey || null,
    },
  };
}

/** Turn "deepseek-ai/DeepSeek-V4.1-Flash" into a catalog key like "deepseek-v4.1-flash". */
export function suggestModelKey(modelId: string): string {
  const base = modelId.split(":")[0].split("/").pop() ?? modelId;
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** A model to test: a catalog row by key, or any provider + model id. */
export type ModelRef =
  | { modelKey: string }
  | { provider: Provider; modelName: string; hfProvider?: string | null; supportsJsonMode?: boolean; maxTokens?: number };

export interface TestTarget {
  provider: Provider;
  /** Model id as sent to the provider (may include a ":provider" suffix). */
  model: string;
  /** Set when the target is a catalog row. */
  modelKey?: string;
  supportsJsonMode?: boolean;
}

export function targetFromCatalog(m: CatalogModel): TestTarget {
  const model = m.provider === "huggingface" && m.hfProvider && !m.modelName.includes(":")
    ? `${m.modelName}:${m.hfProvider}`
    : m.modelName;
  return { provider: m.provider, model, modelKey: m.modelKey, supportsJsonMode: m.supportsJsonMode };
}

export interface DiscoveredProvider {
  provider: string;
  status: string | null;
  contextLength: number | null;
  priceInput: number | null;
  priceOutput: number | null;
  supportsJsonMode: boolean | null;
  latencyMs: number | null;
  throughput: number | null;
}

export interface DiscoveredModel {
  id: string;
  providers: DiscoveredProvider[];
  likes?: number | null;
  downloads?: number | null;
  catalogKeys: string[];
}

/** clean: valid JSON first try. repaired: needed JSON repair or a retry. fallback: another model stepped in. */
export type QualifyVerdict = "clean" | "repaired" | "fallback" | "failed";

export const VERDICT_LABELS: Record<QualifyVerdict, string> = {
  clean: "Clean pass",
  repaired: "Passed with repairs",
  fallback: "Needed fallback",
  failed: "Failed",
};

/** Verdict of a stored result; older results only have the two booleans. */
export function verdictOf(r: { verdict?: QualifyVerdict; ok: boolean; strictOk: boolean }): QualifyVerdict {
  return r.verdict ?? (r.strictOk ? "clean" : r.ok ? "repaired" : "failed");
}

export const verdictBadgeVariant = (v: QualifyVerdict): "secondary" | "outline" | "destructive" =>
  v === "clean" ? "secondary" : v === "failed" ? "destructive" : "outline";

export interface QualifyStage {
  stage: "master" | "narrative" | "image" | "actions";
  ran: boolean;
  ok: boolean;
  error?: string;
  /** Model calls made for this stage. */
  attempts: number;
  recovery: "none" | "retry" | "fallback";
  /** Model whose output was used. */
  servedBy?: string;
  firstError?: string;
  jsonQuality?: "raw" | "extracted" | "repaired" | "salvaged" | "failed";
  durationMs?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  finishReason?: string | null;
  detail?: string;
}

export interface QualifyResult {
  runId: string;
  scenarioId: string;
  model: string;
  modelKey: string | null;
  provider: string;
  fallbackModel: string | null;
  verdict: QualifyVerdict;
  ok: boolean;
  strictOk: boolean;
  turnMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  stages: QualifyStage[];
  narration?: string;
  imagePrompt?: string;
  actions?: string[];
  /** Where the run is in LangSmith; absent when it was made with tracing off. */
  trace?: { runId: string; traceId: string };
}

/** apiRequest throws "<status>: <body>"; pull the server's `error` field out when present. */
export function errorMessage(error: unknown): string {
  const raw = String((error as any)?.message ?? error);
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string") {
      return parsed.details ? `${parsed.error} (${parsed.details})` : parsed.error;
    }
  } catch {
    // not JSON
  }
  return body;
}

export const formatPrice = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(2)}`);

export function formatContext(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(v / 1000)}K`;
}

export const formatSeconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`);

export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(3)}`;
}
