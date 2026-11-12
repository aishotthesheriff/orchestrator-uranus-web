import process from "process";
import { buildMetaPrompt } from "../server/pce/promptBuilder.ts";
import { buildModelInstructionSet } from "../server/pce/modelInstructions.ts";

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    const trimmed = String(token).trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      args[trimmed.replace(/^--?/, "")] = "true";
    } else {
      const key = trimmed.slice(0, eqIndex).replace(/^--?/, "");
      const value = trimmed.slice(eqIndex + 1);
      args[key] = value;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const modelClassInput = (args.modelClass ?? args.model ?? "transformer").toLowerCase();
const themeLabel = args.themeLabel ?? "Nebula Opera";
const styleLabel = args.styleLabel ?? "Galactic Noir";

const instructionSet = buildModelInstructionSet(modelClassInput);

const imageModel = {
  label: args.modelLabel ?? "Preview Model",
  class: modelClassInput,
  triggerWords: args.triggerWords ?? "preview shimmer",
  modelKey: args.modelKey ?? `preview-${modelClassInput}`
};

const themeObject = {
  narratorTemplate: args.narratorTemplate ?? "You are the shipboard AI chronicler.",
  label: themeLabel,
  description: args.themeDescription ?? "An operatic tale among the stars.",
  value: args.themeValue ?? "nebula-opera"
};

const styleObject = {
  label: styleLabel,
  description: args.styleDescription ?? "Smoky light, saturated colors, high drama.",
  exemplifiedBy: args.styleExamples ?? "Classic Stellarnet matte paintings",
  modifiersDiffusion: args.styleDiffusionModifiers ?? "(noir diffusion:1.2), (smoky shadows:1.1)",
  modifiersTransformer: args.styleTransformerModifiers ?? "noir lighting, high contrast"
};

const diffusionModifiers = String(styleObject.modifiersDiffusion ?? "").trim();
const transformerModifiers = String(styleObject.modifiersTransformer ?? "").trim();

const resolvedStyleModifiers = (() => {
  if (modelClassInput === "diffuser") {
    return diffusionModifiers || transformerModifiers || "None provided.";
  }
  if (modelClassInput === "flux" || modelClassInput === "transformer") {
    return transformerModifiers || diffusionModifiers || "None provided.";
  }
  return transformerModifiers || diffusionModifiers || "None provided.";
})();

const baseVariables = {
  STYLE: styleLabel,
  THEME: themeLabel,
  MODEL_CLASS: imageModel.class,
  TRIGGER_WORDS: imageModel.triggerWords,
  TURN_NUMBER: Number(args.turn ?? 7),
  DAY: Number(args.day ?? 3),
  SEGMENT: args.segment ?? "Delta",
  CHECKS: args.checks ?? "No skill checks this turn.",
  ACTIVE_EVENT: args.activeEvent ?? "Calibrating the graviton sails.",
  PLAYER_ACTION: args.playerAction ?? "Reinforced the hull plating.",
  RUNNING_GAGS: args.runningGags ?? "Spilled coffee in zero-g",
  NPC_SUMMARY: args.npcSummary ?? "Captain Vega (Commander) — Warm, status active",
  HULL: Number(args.hull ?? 85),
  OXYGEN: Number(args.oxygen ?? 72),
  FUEL: Number(args.fuel ?? 66),
  FOOD: Number(args.food ?? 59),
  MORALE: Number(args.morale ?? 90),
  EQUIPPED_ITEMS: args.equippedItems ?? "Quantum Spanner (🔧)",
  IMAGE_MODEL: imageModel,
  THEME_OBJECT: themeObject,
  STYLE_OBJECT: styleObject,
  MODEL_STYLE_INSTRUCTIONS: instructionSet.style,
  OUTPUT_FORMAT_INSTRUCTIONS: instructionSet.output,
  OUTPUT_EXAMPLE: instructionSet.example
};

const variables = {
  ...baseVariables,
  STYLE_MODIFIERS: resolvedStyleModifiers,
  STYLE_DIFFUSION_MODIFIERS: diffusionModifiers,
  STYLE_TRANSFORMER_MODIFIERS: transformerModifiers
};

const heading = `\n=== Meta Prompt Preview (class: ${modelClassInput || "fallback"}) ===\n`;
const footer = "\n=== End Preview ===\n";

const metaPrompt = await buildMetaPrompt(variables, { validate: true });

process.stdout.write(heading);
process.stdout.write(metaPrompt);
process.stdout.write(footer);
