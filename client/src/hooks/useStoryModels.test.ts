import { describe, expect, it, vi } from "vitest";

// The hook module imports the app's query client, which needs a browser. Only the pure
// helpers are under test here.
vi.mock("@/lib/queryClient", () => ({ REFERENCE_DATA_QUERY_OPTIONS: {} }));

import {
  resolveStoryModelChoice,
  storyModelKeyToSave,
  storyModelLabel,
  type StoryModelOption,
} from "./useStoryModels";

const model = (modelKey: string, extra: Partial<StoryModelOption> = {}): StoryModelOption => ({
  modelKey,
  displayName: modelKey.toUpperCase(),
  description: null,
  adult: false,
  isDefault: false,
  sortOrder: 0,
  ...extra,
});

const models = [model("base", { isDefault: true }), model("fast"), model("spicy", { adult: true })];

describe("resolveStoryModelChoice", () => {
  it("shows the default when the player has not chosen", () => {
    const choice = resolveStoryModelChoice(models, undefined, null);
    expect(choice).toMatchObject({ selectedKey: "base", defaultKey: "base", forced: null, showPicker: true });
  });

  it("shows the saved choice", () => {
    expect(resolveStoryModelChoice(models, "fast", null).selectedKey).toBe("fast");
  });

  it("falls back to the default when the saved model is no longer offered", () => {
    expect(resolveStoryModelChoice(models, "retired", null).selectedKey).toBe("base");
  });

  it("locks to the theme's model, ignoring the saved choice", () => {
    const choice = resolveStoryModelChoice(models, "fast", "spicy");
    expect(choice.forced?.modelKey).toBe("spicy");
    expect(choice.selectedKey).toBe("spicy");
  });

  it("does not lock when the theme's model is not offered", () => {
    const choice = resolveStoryModelChoice(models, "fast", "retired");
    expect(choice.forced).toBeNull();
    expect(choice.selectedKey).toBe("fast");
  });

  it("hides the picker when there is nothing to choose", () => {
    expect(resolveStoryModelChoice([model("base", { isDefault: true })], undefined, null).showPicker).toBe(false);
    expect(resolveStoryModelChoice([], undefined, null)).toMatchObject({ showPicker: false, selectedKey: "" });
  });

  it("uses the first model when none is marked default", () => {
    expect(resolveStoryModelChoice([model("a"), model("b")], undefined, null).defaultKey).toBe("a");
  });
});

describe("storyModelKeyToSave", () => {
  it("stores the default as an empty choice so the player keeps following it", () => {
    expect(storyModelKeyToSave("base", "base")).toBe("");
    expect(storyModelKeyToSave("fast", "base")).toBe("fast");
  });
});

describe("storyModelLabel", () => {
  it("marks adult and default models", () => {
    expect(storyModelLabel(model("spicy", { adult: true }))).toBe("SPICY · 18+");
    expect(storyModelLabel(model("base", { isDefault: true }))).toBe("BASE (Default)");
  });
});
