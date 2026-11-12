import type { LlmModel } from "@shared/schema";
import { LLM_PROVIDERS, type LlmProvider } from "./clients";

/**
 * Story-model resolution: turns a catalog key into everything needed to call the model.
 *
 * A key is looked up in the published reference release. Only when that release predates
 * the catalog is the database read directly. Dev Tools reads drafts from the database
 * itself (see routes/llmModelsAdmin.ts), never through here. Resolution never
 * throws for an unknown or inactive key: it logs a warning and falls back, because a
 * stale preference must not fail a player's turn.
 */

export interface ResolvedLlmModel {
  /** Catalog key, or null for an ad-hoc model chosen in Dev Tools. */
  key: string | null;
  provider: LlmProvider;
  modelName: string;
  /** Optional Hugging Face Inference Provider pin (e.g. "novita"). */
  hfProvider: string | null;
  supportsJsonMode: boolean;
  params: { maxTokens?: number; temperature?: number };
  priceInput: number | null;
  priceOutput: number | null;
  /** Catalog key of the model to use when this one fails a stage. Null: the default model. */
  fallbackKey: string | null;
  source: "reference" | "database" | "builtin" | "adhoc";
}

/** The model the game used before the catalog existed. Last-resort fallback. */
export const BUILTIN_LLM_MODEL: ResolvedLlmModel = Object.freeze({
  key: "gpt-4o-mini",
  provider: "openai" as const,
  modelName: "gpt-4o-mini",
  hfProvider: null,
  supportsJsonMode: true,
  params: {},
  priceInput: 0.15,
  priceOutput: 0.6,
  fallbackKey: null,
  source: "builtin" as const,
});

/** Model for small utility calls (intent mapping, interview). Not player-selectable. */
export const UTILITY_LLM_MODEL = "gpt-4o-mini";

/** The id sent to the provider. A pinned HF provider is appended as "model:provider". */
export function requestModelId(model: Pick<ResolvedLlmModel, "provider" | "modelName" | "hfProvider">): string {
  if (model.provider === "huggingface" && model.hfProvider && !model.modelName.includes(":")) {
    return `${model.modelName}:${model.hfProvider}`;
  }
  return model.modelName;
}

function isProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as readonly string[]).includes(value);
}

/** Accepts a catalog row in camelCase (DB mapper, published JSON) or snake_case. */
export function toResolvedLlmModel(row: any, source: ResolvedLlmModel["source"]): ResolvedLlmModel | null {
  if (!row) return null;
  const provider = row.provider;
  const modelName = row.modelName ?? row.model_name;
  if (!isProvider(provider) || typeof modelName !== "string" || !modelName.trim()) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const params = row.params && typeof row.params === "object" ? row.params : {};
  return {
    key: row.modelKey ?? row.model_key ?? null,
    provider,
    modelName: modelName.trim(),
    hfProvider: (row.hfProvider ?? row.hf_provider ?? null) || null,
    supportsJsonMode: Boolean(row.supportsJsonMode ?? row.supports_json_mode ?? true),
    params: {
      ...(typeof params.maxTokens === "number" ? { maxTokens: params.maxTokens } : {}),
      ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    },
    priceInput: num(row.priceInput ?? row.price_input),
    priceOutput: num(row.priceOutput ?? row.price_output),
    fallbackKey: (row.fallbackModelKey ?? row.fallback_model_key ?? null) || null,
    source,
  };
}

const rowKey = (row: any): string | undefined => row?.modelKey ?? row?.model_key;
const rowActive = (row: any): boolean => (row?.active ?? 1) === 1;

async function referenceRows(): Promise<any[]> {
  try {
    const { getCurrentReference } = await import("../reference/referenceLoader.js");
    const ref = await getCurrentReference();
    return Array.isArray((ref.data as any).llm_models) ? (ref.data as any).llm_models : [];
  } catch {
    return [];
  }
}

async function findCatalogModel(key: string): Promise<ResolvedLlmModel | null> {
  const published = await referenceRows();
  if (published.length > 0) {
    // The release carries a catalog: it is the single source of truth for the game.
    // Database rows that are not in it are drafts and stay invisible until published.
    const fromRef = published.find((row) => rowKey(row) === key);
    return fromRef && rowActive(fromRef) ? toResolvedLlmModel(fromRef, "reference") : null;
  }
  // The current release predates the catalog: read the table directly so the game
  // keeps working until the first release that includes it.
  try {
    const { storage } = await import("../storage.js");
    const fromDb: LlmModel | null = await storage.getLlmModelByKey(key);
    if (fromDb && fromDb.active === 1) return toResolvedLlmModel(fromDb, "database");
  } catch (error) {
    console.warn(`[LLM] Could not read llm_models for key '${key}':`, error instanceof Error ? error.message : error);
  }
  return null;
}

/** Default key: the published release's system default, else the database default row. */
export async function getDefaultLlmModelKey(): Promise<string | null> {
  try {
    const { getCurrentReference } = await import("../reference/referenceLoader.js");
    const ref = await getCurrentReference();
    const key = (ref.data.system_defaults as any)?.llm_model_key;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // fall through to the database
  }
  try {
    const { storage } = await import("../storage.js");
    return (await storage.getDefaultLlmModel())?.modelKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the first usable model among the candidate keys (in priority order), then the
 * system default, then the built-in model. Blank candidates are skipped silently; unknown
 * or inactive ones are skipped with a warning.
 */
export async function resolveLlmModel(...candidateKeys: Array<string | null | undefined>): Promise<ResolvedLlmModel> {
  for (const candidate of candidateKeys) {
    const key = candidate?.trim();
    if (!key) continue;
    const found = await findCatalogModel(key);
    if (found) return found;
    console.warn(`[LLM] Story model '${key}' is not in the catalog or is inactive; trying the next choice.`);
  }

  const defaultKey = await getDefaultLlmModelKey();
  if (defaultKey) {
    const found = await findCatalogModel(defaultKey);
    if (found) return found;
    console.warn(`[LLM] Default story model '${defaultKey}' is not usable; using built-in ${BUILTIN_LLM_MODEL.modelName}.`);
  }
  return BUILTIN_LLM_MODEL;
}

/**
 * The model to try when `model` cannot produce a usable stage: its own configured
 * fallback, else the default model, else the built-in one. Returns null when that would
 * be the same model again (the default has nothing to fall back to but itself).
 *
 * `lookup` finds a catalog model by key; Dev Tools passes one that reads drafts.
 */
export async function resolveLlmFallback(
  model: ResolvedLlmModel,
  lookup: (key: string) => Promise<ResolvedLlmModel | null> = findCatalogModel,
  defaultKey?: string | null
): Promise<ResolvedLlmModel | null> {
  const sameAs = (other: ResolvedLlmModel) => requestModelId(other) === requestModelId(model);
  const candidates: ResolvedLlmModel[] = [];
  if (model.fallbackKey) {
    const configured = await lookup(model.fallbackKey);
    if (configured) candidates.push(configured);
    else console.warn(`[LLM] Fallback model '${model.fallbackKey}' for '${model.key ?? model.modelName}' is not usable; using the default.`);
  }
  const resolvedDefaultKey = defaultKey !== undefined ? defaultKey : await getDefaultLlmModelKey();
  if (resolvedDefaultKey) {
    const fromDefault = await lookup(resolvedDefaultKey);
    if (fromDefault) candidates.push(fromDefault);
  }
  candidates.push(BUILTIN_LLM_MODEL);
  return candidates.find((candidate) => !sameAs(candidate)) ?? null;
}

/** An ad-hoc model chosen in Dev Tools, not (yet) in the catalog. */
export function adhocLlmModel(input: {
  provider: LlmProvider;
  modelName: string;
  hfProvider?: string | null;
  supportsJsonMode?: boolean;
  params?: ResolvedLlmModel["params"];
}): ResolvedLlmModel {
  return {
    key: null,
    provider: input.provider,
    modelName: input.modelName.trim(),
    hfProvider: input.hfProvider?.trim() || null,
    supportsJsonMode: input.supportsJsonMode ?? true,
    params: input.params ?? {},
    priceInput: null,
    priceOutput: null,
    fallbackKey: null,
    source: "adhoc",
  };
}

/** Active catalog rows as players may see them: published release first, database otherwise. */
export async function listSelectableLlmModels(): Promise<any[]> {
  const fromRef = (await referenceRows()).filter(rowActive);
  if (fromRef.length > 0) return fromRef;
  try {
    const { storage } = await import("../storage.js");
    return await storage.getActiveLlmModels();
  } catch {
    return [];
  }
}

/**
 * Story themes that force a model: theme key -> model key.
 *
 * Follows the same published-first rule as the catalog: forced models come from the
 * release's themes, or from the database while the release predates the catalog.
 * A theme pointing at a model players cannot use is left out, so the theme simply
 * does not force anything (the player's choice or the default applies).
 */
export async function getThemeForcedLlmModelKeys(): Promise<Map<string, string>> {
  const forced = new Map<string, string>();
  try {
    const usable = new Set((await listSelectableLlmModels()).map(rowKey));
    let themes: any[] = [];
    if ((await referenceRows()).length > 0) {
      const { getCurrentReference } = await import("../reference/referenceLoader.js");
      themes = (await getCurrentReference()).data.mod_story_themes ?? [];
    } else {
      const { storage } = await import("../storage.js");
      themes = await storage.getActiveStoryThemes();
    }
    for (const theme of themes) {
      const themeKey = theme.storyThemeKey ?? theme.story_theme_key;
      const modelKey = theme.llmModelKey ?? theme.llm_model_key;
      if (themeKey && modelKey && (theme.active ?? 1) === 1 && usable.has(modelKey)) {
        forced.set(themeKey, modelKey);
      }
    }
  } catch (error) {
    console.warn("[LLM] Could not read theme-forced story models:", error instanceof Error ? error.message : error);
  }
  return forced;
}
