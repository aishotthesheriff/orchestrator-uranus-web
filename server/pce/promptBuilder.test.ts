import { describe, it, expect, beforeEach } from "vitest";
import { buildMetaPrompt, clearTemplateCache } from "./promptBuilder.js";
import { buildModelInstructionSet } from "./modelInstructions.js";

type ModelClass = string | null | undefined;

function createBaseVariables(modelClass: ModelClass, overrides: Record<string, unknown> = {}) {
  const baseImageModel = {
    label: "Test Model",
    class: modelClass,
    triggerWords: "test trigger",
    modelKey: "test-model"
  };

  const baseTheme = {
    narratorTemplate: "You are the shipboard AI chronicler",
    label: "Nebula Opera",
    description: "An operatic tale among the stars.",
    value: "nebula-opera"
  };

  const baseStyle = {
    label: "Galactic Noir",
    description: "Smoky light, saturated colors, high drama.",
    exemplifiedBy: "Classic Stellarnet matte paintings",
    modifiersDiffusion: "(noir diffusion:1.2), (smoky shadows:1.1)",
    modifiersTransformer: "noir lighting, high contrast"
  };

  return {
    STYLE: "Galactic Noir",
    THEME: "Nebula Opera",
    MODEL_CLASS: modelClass ?? "fallback",
    TRIGGER_WORDS: baseImageModel.triggerWords,
    TURN_NUMBER: 7,
    DAY: 3,
    SEGMENT: "Delta",
    CHECKS: "No skill checks this turn.",
    ACTIVE_EVENT: "Calibrating the graviton sails.",
    PLAYER_ACTION: "Reinforced the hull plating.",
    RUNNING_GAGS: "Spilled coffee in zero-g",
    NPC_SUMMARY: "Captain Vega (Commander) — Warm, status active",
    HULL: 85,
    OXYGEN: 72,
    FUEL: 66,
    FOOD: 59,
    MORALE: 90,
    EQUIPPED_ITEMS: "Quantum Spanner (🔧)",
    IMAGE_MODEL: baseImageModel,
    THEME_OBJECT: baseTheme,
    STYLE_OBJECT: baseStyle,
    MODEL_STYLE_INSTRUCTIONS: "",
    OUTPUT_FORMAT_INSTRUCTIONS: "",
    OUTPUT_EXAMPLE: "",
    STYLE_MODIFIERS: "",
    STYLE_DIFFUSION_MODIFIERS: baseStyle.modifiersDiffusion,
    STYLE_TRANSFORMER_MODIFIERS: baseStyle.modifiersTransformer,
    ...overrides
  };
}

describe("buildMetaPrompt model-specific instructions", () => {
  beforeEach(() => {
    clearTemplateCache();
  });

  const scenarios = [
    {
      name: "flux",
      modelClass: "flux",
      expectedSnippet: "<<<FLUX FORMAT>>>",
      expectedTargetHint: "When IMAGE_MODEL.class is \"flux\"",
      expectedDiffusion: "(noir diffusion:1.2), (smoky shadows:1.1)",
      expectedTransformer: "noir lighting, high contrast"
    },
    {
      name: "transformer",
      modelClass: "transformer",
      expectedSnippet: "<<<TRANSFORMER FORMAT>>>",
      expectedTargetHint: "When IMAGE_MODEL.class is \"transformer\"",
      expectedDiffusion: "(noir diffusion:1.2), (smoky shadows:1.1)",
      expectedTransformer: "noir lighting, high contrast"
    },
    {
      name: "diffuser",
      modelClass: "diffuser",
      expectedSnippet: "<<<DIFFUSER FORMAT>>>",
      expectedTargetHint: "\"positive\": \"<positive prompt>\"",
      expectedDiffusion: "(noir diffusion:1.2), (smoky shadows:1.1)",
      expectedTransformer: "noir lighting, high contrast"
    },
    {
      name: "unknown",
      modelClass: "some-future-model",
      expectedSnippet: "IMAGE_MODEL.class is unrecognized",
      expectedTargetHint: "Default to transformer formatting",
      expectedDiffusion: "(noir diffusion:1.2), (smoky shadows:1.1)",
      expectedTransformer: "noir lighting, high contrast"
    }
  ] as const;

  scenarios.forEach(({ name, modelClass, expectedSnippet, expectedTargetHint, expectedDiffusion, expectedTransformer }) => {
    it(`injects correct instructions for ${name}`, async () => {
      const instructionSet = buildModelInstructionSet(modelClass);

      const variables = createBaseVariables(modelClass, {
        MODEL_STYLE_INSTRUCTIONS: instructionSet.style,
        OUTPUT_FORMAT_INSTRUCTIONS: instructionSet.output,
        OUTPUT_EXAMPLE: instructionSet.example,
        IMAGE_MODEL: {
          label: "Test Model",
          class: modelClass,
          triggerWords: "test trigger",
          modelKey: "test-model"
        }
      });

      const metaPrompt = await buildMetaPrompt(variables);

      expect(metaPrompt).toContain(instructionSet.output);
      expect(metaPrompt).toContain(instructionSet.example);
      expect(metaPrompt).toContain(expectedSnippet);
      expect(metaPrompt).toContain(expectedTargetHint);
      expect(metaPrompt).toContain(`Diffusion modifiers:** ${expectedDiffusion}`);
      expect(metaPrompt).toContain(`Transformer modifiers:** ${expectedTransformer}`);
      expect(metaPrompt).not.toContain("{{MODEL_STYLE_INSTRUCTIONS}}");
      expect(metaPrompt).not.toContain("{{OUTPUT_FORMAT_INSTRUCTIONS}}");
      expect(metaPrompt).not.toContain("{{STYLE_MODIFIERS}}");
      expect(metaPrompt).not.toContain("{{STYLE_DIFFUSION_MODIFIERS}}");
      expect(metaPrompt).not.toContain("{{STYLE_TRANSFORMER_MODIFIERS}}");
    });
  });
});

describe("buildMetaPrompt validation", () => {
  beforeEach(() => {
    clearTemplateCache();
  });

  it("throws descriptive error when required scalar variables are missing", async () => {
    const variables = createBaseVariables("flux");
    delete (variables as any).RUNNING_GAGS;

    await expect(buildMetaPrompt(variables, { validate: true })).rejects.toThrowError(
      /{{RUNNING_GAGS}}.*missing variable/i
    );
  });

  it("throws descriptive error when nested properties are missing", async () => {
    const variables = createBaseVariables("flux", {
      IMAGE_MODEL: {
        class: "flux",
        triggerWords: "test trigger",
        modelKey: "test-model"
      }
    });

    await expect(buildMetaPrompt(variables, { validate: true })).rejects.toThrowError(
      /{{IMAGE_MODEL\.label}}.*missing path/i
    );
  });

  it("strips template documentation annotations before returning prompt text", async () => {
    const variables = createBaseVariables("flux");
    const metaPrompt = await buildMetaPrompt(variables, { validate: true });
    expect(metaPrompt).not.toContain("PCE_TEMPLATE_DOC_START");
    expect(metaPrompt).not.toContain("PCE_TEMPLATE_DOC_END");
  });
});
