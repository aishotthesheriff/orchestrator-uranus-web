export type PceStage = "master" | "narrative" | "image" | "actions";

export interface PceVariable {
  name: string;
  description: string;
  example?: string;
  category: string;
  availableIn: PceStage[];
}

export const PCE_VARIABLES: PceVariable[] = [
  // Basic Game State
  {
    name: "TURN_NUMBER",
    description: "Current turn number in the game",
    example: "7",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "DAY",
    description: "Current day of the voyage",
    example: "3",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "SEGMENT",
    description: "Current location segment (Departure, Belt, Outer Darkness, Approach)",
    example: "Belt",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "PLAYER_ACTION",
    description: "The action the player just took",
    example: "Attempt to repair the hull with duct tape",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "ACTIVE_EVENT",
    description: "Currently active special event",
    example: "Cosmic HOA Inspection (Belt segment - Bureaucracy challenge)",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "CHECKS",
    description: "Formatted skill check results",
    example: "- Engineering DC15: Rolled 12 ❌",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "RUNNING_GAGS",
    description: "Active running gags in the game",
    example: "Paperwork Singularity, Coffee Machine Union",
    category: "Basic Game State",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  
  // Ship Stats
  {
    name: "HULL",
    description: "Ship hull strength (0-100)",
    example: "75",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "OXYGEN",
    description: "Oxygen level (0-100)",
    example: "85",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "FUEL",
    description: "Fuel level (0-100)",
    example: "60",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "FOOD",
    description: "Food supplies (0-100)",
    example: "90",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "MORALE",
    description: "Crew morale (0-100)",
    example: "70",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "WEIRDNESS",
    description: "Weirdness level (0-5)",
    example: "2",
    category: "Ship Stats",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  
  // NPCs & Items
  {
    name: "NPC_SUMMARY",
    description: "Summary of active NPCs with affinity and status",
    example: "Captain Shem (Captain) — Warm, status active",
    category: "NPCs & Items",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "EQUIPPED_ITEMS",
    description: "List of currently equipped items",
    example: "Universal Allen Key (🔧): Multi-purpose tool",
    category: "NPCs & Items",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "RECENT_TURNS",
    description: "Summary of last 3 turns",
    example: "Turn 5: The crew discovered... | Turn 6: Captain Shem attempted...",
    category: "NPCs & Items",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "INTERVIEW_SUMMARY",
    description: "Summary of player interview responses",
    example: "captainMotivation: To prove myself; favoriteFood: Space ramen",
    category: "NPCs & Items",
    availableIn: ["master", "narrative", "image"]
  },
  
  // Master Enrichment
  {
    name: "MASTER_CONTEXT.turnMoment",
    description: "High-signal description of the current moment",
    example: "A tense negotiation with cosmic bureaucrats",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_CONTEXT.tonalGoal",
    description: "Desired tone for this turn",
    example: "Tense but comedic",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_CONTEXT.focusNpc",
    description: "NPC that should be highlighted this turn",
    example: "Captain Shem",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_CONTEXT.tension",
    description: "Current tension or problem",
    example: "Hull integrity is failing",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_CONTEXT.callback",
    description: "Reference to previous turn for continuity",
    example: "The paperwork from last turn",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_VARIABLES.keyPhrases",
    description: "Array of key phrases to use naturally",
    example: '["cosmic bureaucracy", "duct tape solution"]',
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_VARIABLES.sensoryDetails",
    description: "Array of sensory details",
    example: '["neon lights flickering", "metallic tang in the air"]',
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_VARIABLES.riskSummary",
    description: "Summary of current risks",
    example: "Hull breach imminent if not addressed",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_VARIABLES.punchlineSetup",
    description: "Setup for a comedic payoff",
    example: "The cosmic HOA inspector is about to arrive",
    category: "Master Enrichment",
    availableIn: ["narrative", "image", "actions"]
  },
  {
    name: "MASTER_GUIDANCE.narrative",
    description: "Array of guidance directives for narrative stage",
    example: '["Emphasize the bureaucratic absurdity", "Show Captain Shem\'s frustration"]',
    category: "Master Enrichment",
    availableIn: ["narrative"]
  },
  {
    name: "MASTER_GUIDANCE.image",
    description: "Array of guidance directives for image stage",
    example: '["Focus on the inspector\'s officious expression", "Include neon signage"]',
    category: "Master Enrichment",
    availableIn: ["image"]
  },
  {
    name: "MASTER_GUIDANCE.actions",
    description: "Array of guidance directives for actions stage",
    example: '["Include a bureaucratic compliance option", "Offer a risky escape attempt"]',
    category: "Master Enrichment",
    availableIn: ["actions"]
  },
  
  // Theme & Style
  {
    name: "THEME_OBJECT.label",
    description: "Name of the active story theme",
    example: "Corporate AI Satire",
    category: "Theme & Style",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "THEME_OBJECT.narratorTemplate",
    description: "Narrator persona template from theme",
    example: "E.L.O.N., smug AI announcer",
    category: "Theme & Style",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "STYLE_OBJECT.label",
    description: "Name of the active visual style",
    example: "Neo Deco",
    category: "Theme & Style",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  {
    name: "STYLE_OBJECT.exemplifiedBy",
    description: "Examples that exemplify the visual style",
    example: "Art Deco meets cyberpunk, geometric patterns, chrome surfaces",
    category: "Theme & Style",
    availableIn: ["master", "narrative", "image", "actions"]
  },
  
  // Image Model
  {
    name: "IMAGE_MODEL.label",
    description: "Display name of the image model",
    example: "DALL-E 3",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "IMAGE_MODEL.class",
    description: "Model class (diffuser, transformer, flux)",
    example: "diffuser",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "IMAGE_MODEL.triggerWords",
    description: "Trigger words specific to this model",
    example: "cinematic, dramatic lighting",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "MODEL_STYLE_INSTRUCTIONS",
    description: "Model-specific style instructions",
    example: "Use comma-separated descriptive phrases",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "STYLE_MODIFIERS",
    description: "Resolved style modifiers for the model class",
    example: "art deco, geometric patterns, chrome",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "STYLE_DIFFUSION_MODIFIERS",
    description: "Style modifiers for diffusion models",
    example: "art deco, geometric patterns",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "STYLE_TRANSFORMER_MODIFIERS",
    description: "Style modifiers for transformer models",
    example: "cinematic, dramatic lighting",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  {
    name: "IMAGE_MODEL_KEY",
    description: "Key identifier for the image model",
    example: "dall-e-3",
    category: "Image Model",
    availableIn: ["master", "narrative", "image"]
  },
  
  // Narrative
  {
    name: "NARRATION",
    description: "Full narrative text from narrative stage",
    example: "You step onto the bridge as the cosmic HOA inspector arrives...",
    category: "Narrative",
    availableIn: ["image"]
  },
  {
    name: "NARRATIVE_SUMMARY",
    description: "Summary of the narrative (same as NARRATION)",
    example: "You step onto the bridge as the cosmic HOA inspector arrives...",
    category: "Narrative",
    availableIn: ["image"]
  },
  {
    name: "NARRATIVE_TONE_HINTS",
    description: "Array of tone descriptors from narrative stage",
    example: '["tense", "comedic", "bureaucratic"]',
    category: "Narrative",
    availableIn: ["image"]
  },
  {
    name: "CURRENT_NARRATIVE",
    description: "Current narrative text (for actions stage)",
    example: "You step onto the bridge as the cosmic HOA inspector arrives...",
    category: "Narrative",
    availableIn: ["actions"]
  },
  
  // Output Format
  {
    name: "OUTPUT_FORMAT_INSTRUCTIONS",
    description: "Instructions for output format",
    example: "Return ONLY valid JSON with the following structure...",
    category: "Output Format",
    availableIn: ["master"]
  },
  {
    name: "OUTPUT_EXAMPLE",
    description: "Example of expected output format",
    example: '{"context": {...}, "variables": {...}, "guidance": {...}}',
    category: "Output Format",
    availableIn: ["master"]
  }
];

/**
 * Get variables by category
 */
export function getVariablesByCategory(): Record<string, PceVariable[]> {
  const byCategory: Record<string, PceVariable[]> = {};
  for (const variable of PCE_VARIABLES) {
    if (!byCategory[variable.category]) {
      byCategory[variable.category] = [];
    }
    byCategory[variable.category].push(variable);
  }
  return byCategory;
}

/**
 * Get variables available for a specific stage
 */
export function getVariablesForStage(stage: PceStage | null): PceVariable[] {
  if (!stage) {
    return PCE_VARIABLES;
  }
  return PCE_VARIABLES.filter(v => v.availableIn.includes(stage));
}

/**
 * Check if a variable is available for a stage
 */
export function isVariableAvailableForStage(variable: PceVariable, stage: PceStage | null): boolean {
  if (!stage) {
    return true;
  }
  return variable.availableIn.includes(stage);
}

