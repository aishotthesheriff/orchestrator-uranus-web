import { beforeEach, describe, expect, it, vi } from "vitest";

// The resolver reads the published release and, only when that release has no catalog,
// the database. Both are faked here so the precedence rules can be tested in isolation.
const reference = {
  llm_models: [] as any[],
  mod_story_themes: [] as any[],
  system_defaults: {} as Record<string, string>,
};
const db = {
  models: [] as any[],
  themes: [] as any[],
};

vi.mock("../reference/referenceLoader.js", () => ({
  getCurrentReference: async () => ({ version: "test", data: reference }),
}));
vi.mock("../storage.js", () => ({
  storage: {
    getLlmModelByKey: async (key: string) => db.models.find((m) => m.modelKey === key) ?? null,
    getDefaultLlmModel: async () => db.models.find((m) => m.active === 1 && m.isDefault) ?? null,
    getActiveLlmModels: async () => db.models.filter((m) => m.active === 1),
    getActiveStoryThemes: async () => db.themes.filter((t) => t.active === 1),
  },
}));

import {
  BUILTIN_LLM_MODEL,
  adhocLlmModel,
  getThemeForcedLlmModelKeys,
  listSelectableLlmModels,
  requestModelId,
  resolveLlmFallback,
  resolveLlmModel,
  toResolvedLlmModel,
} from "./models";

const row = (modelKey: string, extra: Record<string, unknown> = {}) => ({
  modelKey,
  provider: "huggingface",
  modelName: `org/${modelKey}`,
  hfProvider: null,
  active: 1,
  isDefault: false,
  supportsJsonMode: true,
  params: null,
  priceInput: 0.2,
  priceOutput: 0.6,
  ...extra,
});

beforeEach(() => {
  reference.llm_models = [];
  reference.mod_story_themes = [];
  reference.system_defaults = {};
  db.models = [];
  db.themes = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("resolveLlmModel with a published catalog", () => {
  beforeEach(() => {
    reference.llm_models = [row("default-model", { isDefault: true }), row("player-model"), row("theme-model")];
    reference.system_defaults = { llm_model_key: "default-model" };
  });

  it("prefers the first candidate (the theme's forced model) over the player's choice", async () => {
    const model = await resolveLlmModel("theme-model", "player-model");
    expect(model.key).toBe("theme-model");
    expect(model.source).toBe("reference");
  });

  it("uses the player's choice when the theme forces nothing", async () => {
    expect((await resolveLlmModel(undefined, "player-model")).key).toBe("player-model");
    expect((await resolveLlmModel(null, "player-model")).key).toBe("player-model");
    expect((await resolveLlmModel("", "player-model")).key).toBe("player-model");
  });

  it("falls back to the default when nothing is chosen", async () => {
    expect((await resolveLlmModel(undefined, undefined)).key).toBe("default-model");
  });

  it("skips an unknown key instead of failing the turn", async () => {
    expect((await resolveLlmModel("deleted-model", "player-model")).key).toBe("player-model");
    expect((await resolveLlmModel(undefined, "deleted-model")).key).toBe("default-model");
  });

  it("ignores database drafts that are not in the release", async () => {
    db.models = [row("draft-model")];
    expect((await resolveLlmModel(undefined, "draft-model")).key).toBe("default-model");
  });

  it("ignores a published row that is inactive", async () => {
    reference.llm_models.push(row("retired-model", { active: 0 }));
    expect((await resolveLlmModel(undefined, "retired-model")).key).toBe("default-model");
  });

  it("uses the built-in model when even the default is unusable", async () => {
    reference.system_defaults = { llm_model_key: "missing" };
    const model = await resolveLlmModel(undefined, undefined);
    expect(model).toBe(BUILTIN_LLM_MODEL);
  });
});

describe("resolveLlmModel before the first release that includes the catalog", () => {
  it("reads the database directly", async () => {
    db.models = [row("db-default", { isDefault: true }), row("db-model")];
    const chosen = await resolveLlmModel(undefined, "db-model");
    expect(chosen.key).toBe("db-model");
    expect(chosen.source).toBe("database");
    expect((await resolveLlmModel(undefined, undefined)).key).toBe("db-default");
  });

  it("skips inactive database rows", async () => {
    db.models = [row("db-default", { isDefault: true }), row("db-off", { active: 0 })];
    expect((await resolveLlmModel(undefined, "db-off")).key).toBe("db-default");
  });

  it("uses the built-in model when the catalog is empty", async () => {
    expect(await resolveLlmModel(undefined, "anything")).toBe(BUILTIN_LLM_MODEL);
  });
});

describe("resolveLlmFallback", () => {
  beforeEach(() => {
    reference.llm_models = [
      row("default-model", { isDefault: true }),
      row("spicy-small", { fallbackModelKey: "spicy-large" }),
      row("spicy-large"),
      row("plain"),
      row("points-nowhere", { fallbackModelKey: "retired" }),
    ];
    reference.system_defaults = { llm_model_key: "default-model" };
  });

  it("uses the model's configured fallback", async () => {
    const model = await resolveLlmModel("spicy-small");
    expect(model.fallbackKey).toBe("spicy-large");
    expect((await resolveLlmFallback(model))?.key).toBe("spicy-large");
  });

  it("uses the default model when none is configured", async () => {
    expect((await resolveLlmFallback(await resolveLlmModel("plain")))?.key).toBe("default-model");
  });

  it("uses the default model when the configured fallback is not usable", async () => {
    expect((await resolveLlmFallback(await resolveLlmModel("points-nowhere")))?.key).toBe("default-model");
  });

  it("falls back to the built-in model for the default model itself", async () => {
    const fallback = await resolveLlmFallback(await resolveLlmModel("default-model"));
    expect(fallback).toBe(BUILTIN_LLM_MODEL);
  });

  it("returns null when every candidate is the same model", async () => {
    expect(await resolveLlmFallback(BUILTIN_LLM_MODEL, async () => null, null)).toBeNull();
  });

  it("accepts a custom lookup and default (Dev Tools testing drafts)", async () => {
    const draft = toResolvedLlmModel(row("draft", { fallbackModelKey: "draft-fallback" }), "database")!;
    const lookup = async (key: string) =>
      key === "draft-fallback" ? toResolvedLlmModel(row("draft-fallback"), "database") : null;
    expect((await resolveLlmFallback(draft, lookup, null))?.key).toBe("draft-fallback");
  });
});

describe("listSelectableLlmModels", () => {
  it("returns only active published rows when a catalog is published", async () => {
    reference.llm_models = [row("a"), row("b", { active: 0 })];
    db.models = [row("draft")];
    expect((await listSelectableLlmModels()).map((m) => m.modelKey)).toEqual(["a"]);
  });

  it("falls back to active database rows otherwise", async () => {
    db.models = [row("a"), row("b", { active: 0 })];
    expect((await listSelectableLlmModels()).map((m) => m.modelKey)).toEqual(["a"]);
  });
});

describe("getThemeForcedLlmModelKeys", () => {
  it("maps themes to their forced model, from the published themes", async () => {
    reference.llm_models = [row("spicy")];
    reference.mod_story_themes = [
      { storyThemeKey: "ADULT", active: 1, llmModelKey: "spicy" },
      { storyThemeKey: "TREK", active: 1, llmModelKey: null },
    ];
    db.themes = [{ storyThemeKey: "TREK", active: 1, llmModelKey: "spicy" }]; // unpublished edit
    const forced = await getThemeForcedLlmModelKeys();
    expect(forced.get("ADULT")).toBe("spicy");
    expect(forced.has("TREK")).toBe(false);
  });

  it("drops a theme whose forced model players cannot use", async () => {
    reference.llm_models = [row("spicy")];
    reference.mod_story_themes = [{ storyThemeKey: "ADULT", active: 1, llmModelKey: "retired" }];
    expect((await getThemeForcedLlmModelKeys()).size).toBe(0);
  });

  it("reads database themes before the first catalog release", async () => {
    db.models = [row("spicy")];
    db.themes = [{ storyThemeKey: "ADULT", active: 1, llmModelKey: "spicy" }];
    expect((await getThemeForcedLlmModelKeys()).get("ADULT")).toBe("spicy");
  });
});

describe("model helpers", () => {
  it("appends a pinned Hugging Face provider to the request id", () => {
    expect(requestModelId({ provider: "huggingface", modelName: "org/m", hfProvider: "novita" })).toBe("org/m:novita");
    expect(requestModelId({ provider: "huggingface", modelName: "org/m", hfProvider: null })).toBe("org/m");
    // Already pinned in the id, or not a Hugging Face model: leave untouched.
    expect(requestModelId({ provider: "huggingface", modelName: "org/m:groq", hfProvider: "novita" })).toBe("org/m:groq");
    expect(requestModelId({ provider: "openai", modelName: "gpt-4o-mini", hfProvider: "novita" })).toBe("gpt-4o-mini");
  });

  it("normalises snake_case rows and numeric strings", () => {
    const model = toResolvedLlmModel(
      {
        model_key: "k",
        provider: "openai",
        model_name: " gpt-x ",
        supports_json_mode: false,
        price_input: "0.15",
        price_output: null,
        params: { maxTokens: 2000, temperature: "hot" },
      },
      "database"
    );
    expect(model).toMatchObject({
      key: "k",
      modelName: "gpt-x",
      supportsJsonMode: false,
      priceInput: 0.15,
      priceOutput: null,
      params: { maxTokens: 2000 },
    });
  });

  it("rejects rows with an unknown provider or no model name", () => {
    expect(toResolvedLlmModel({ modelKey: "k", provider: "acme", modelName: "x" }, "database")).toBeNull();
    expect(toResolvedLlmModel({ modelKey: "k", provider: "openai", modelName: " " }, "database")).toBeNull();
    expect(toResolvedLlmModel(null, "database")).toBeNull();
  });

  it("builds an ad-hoc model with JSON mode on by default", () => {
    expect(adhocLlmModel({ provider: "huggingface", modelName: " org/m " })).toMatchObject({
      key: null,
      modelName: "org/m",
      supportsJsonMode: true,
      source: "adhoc",
    });
  });
});
