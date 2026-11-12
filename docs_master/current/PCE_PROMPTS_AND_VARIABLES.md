# PCE Prompts and Variables Reference

**Target Audience:** Prompt Engineers, Content Creators, and Developers  
**Last Updated:** January 2025  
**Primary Module:** `server/pce/`

---

## Overview

This document provides comprehensive documentation of:
1. **Current PCE Prompt Templates** - The exact prompts used in each stage of the PCE pipeline
2. **Available Prompt Variables** - All variables that can be used in templates, with descriptions and availability context

> **Document Scope**: This handbook focuses on authoring assets—template text, output contracts, and the exhaustive variable catalog. For architectural flow, variable construction, and operational guidance, see `docs_master/current/PROMPT_COMPOSITION_ENGINE.md` (the consolidated PCE System Guide).

**Important:** The prompts documented here are sourced from `releases/current/prompts.json` (the active reference release). The `.txt` files in `server/pce/` are fallback templates used only when prompts are not found in the reference system. The system prioritizes the reference JSON over the file system templates.

The Prompt Composition Engine (PCE) uses a four-stage pipeline:
- **Master Stage**: Generates contextual enrichment
- **Narrative Stage**: Generates player-facing narration
- **Image Stage**: Generates image prompts
- **Actions Stage**: Generates action choices

Each stage has its own prompt template and variable set. Variables are substituted using `{{VARIABLE_NAME}}` syntax, with support for nested properties like `{{THEME_OBJECT.label}}`.

---

## Current PCE Prompt Templates

### Stage 1: Master Enrichment Prompt

**Template File:** `server/pce/masterPrompt.txt` (fallback)  
**Reference Name:** `pce_master` (in `releases/current/prompts.json`)  
**Purpose:** Generate contextual enrichment that informs all subsequent stages

**System Prompt:**
```
Your Role: You are the scene director for a quirky sci-fi adventure game being made in real time.  You are the router of ideas and information that helps the other stages create the best content possible while staying true to the theme and style.
Your task: read the game data and craft tailored insight that later prompts can reuse.
```

**User Prompt (from release JSON):**
```
**GAME DATA - This is the information you have about the current turn.
- TURN: {{TURN_NUMBER}} • DAY {{DAY}} • SEGMENT: {{SEGMENT}}
- PLAYER ACTION: {{PLAYER_ACTION}}
- ACTIVE EVENT: {{ACTIVE_EVENT}}
- SKILL CHECKS: {{CHECKS}}
- RUNNING GAGS: {{RUNNING_GAGS}}
- SHIP STATUS: Hull {{HULL}}/100 | Oxygen {{OXYGEN}}/100 | Fuel {{FUEL}}/100 | Food {{FOOD}}/100 | Morale {{MORALE}}/100 | Weirdness {{WEIRDNESS}}/100
- NPC SUMMARY: {{NPC_SUMMARY}}
- EQUIPPED ITEMS: {{EQUIPPED_ITEMS}}
- RECENT TURN CALLBACKS: {{RECENT_TURNS}}
- INTERVIEW INSIGHTS: {{INTERVIEW_SUMMARY}}

**CREATIVE SIGNALS - This is the information that shapes the content of the turn.
- THEME FOCUS: {{THEME_OBJECT.label}}
- NARRATOR LENS: {{THEME_OBJECT.narratorTemplate}}
- STYLE ANCHOR: {{STYLE_OBJECT.label}}


**OUTPUT INSTRUCTIONS - Instructions for fulfilling the Output Contract.
- Synthesize the inputs into a short briefing the other stages can reuse verbatim.
- Respect the THEME above all else; the enrichment should reinforce that motif.
- Fold in STYLE cues when proposing sensory hooks or imagery.
- Highlight NPCs, stakes, and callbacks that deserve focus THIS turn.
- Keep guidance phrasing punchy (max 12 words each) and actionable.
- Never invent new lore that contradicts the supplied data.
- If information is missing, acknowledge it briefly instead of fabricating.

Return ONLY valid JSON with the following structure:
{
  "context": {
    "turnMoment": "...",
    "tonalGoal": "...",
    "focusNpc": "...",
    "tension": "...",
    "callback": "..."
  },
  "variables": {
    "sensoryDetails": ["..."],
    "riskSummary": "...",
  },
  "guidance": {
    "narrative": ["...", "..."],
    "image": ["...", "..."],
    "actions": ["...", "..."]
  }
}
Do not wrap the JSON in markdown code fences. Every required field MUST be present.
```

**Note:** This prompt does NOT inherit the global system prompt (`inheritGlobalPrompt: 0`).

**Output Contract:**
- **Required Fields:**
  - `context.turnMoment` (string): High-signal moment description
  - `context.tonalGoal` (string): Desired tone
  - `guidance.narrative` (array): 2-4 concise directive strings
  - `guidance.image` (array): 2-4 concise directive strings
  - `guidance.actions` (array): 2-4 concise directive strings
- **Optional Fields:**
  - `context.focusNpc` (string): NPC to spotlight
  - `context.tension` (string): Current tension source
  - `context.callback` (string): Reference to previous turn
  - `variables.keyPhrases` (array): Reusable phrases
  - `variables.sensoryDetails` (array): Sensory hooks
  - `variables.riskSummary` (string): Risk assessment
  - `variables.punchlineSetup` (string): Comedy setup

---

### Stage 2: Narrative Generation Prompt

**Template File:** `server/pce/narrativePrompt.txt` (fallback)  
**Reference Name:** `pce_narrative` (in `releases/current/prompts.json`)  
**Purpose:** Generate 5-6 sentence player-facing narration

**System Prompt:**
```
{{THEME_OBJECT.narratorTemplate}}
```

**User Prompt (from release JSON):**
```
═══════════════════════════════════════════════════════
MANDATE
═══════════════════════════════════════════════════════
- Anchor everything in THEME: {{THEME_OBJECT.label}}
- Honor the narrator persona: {{THEME_OBJECT.narratorTemplate}}
- Absorb enrichment context: {{MASTER_CONTEXT.turnMoment}},  tension {{MASTER_CONTEXT.tension}}
- Maintain continuity with callback: {{MASTER_CONTEXT.callback}}
- Use sensory hooks when natural: {{MASTER_VARIABLES.sensoryDetails}}
- Weave in current action: {{PLAYER_ACTION}} and outcome details from {{CHECKS}}
- Reference active event: {{ACTIVE_EVENT}}
- Reflect ship state stressing high/low stats when relevant.

═══════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════
- Narrative Content has been optimized for theme authenticity.
- 5-6 sentences, in 2nd person, vivid, and specific.
- Showcase at least one NPC if MASTER_CONTEXT.focusNpc is provided.
- Surface the stakes described in MASTER_VARIABLES.riskSummary.
- Close with an energy suited to MASTER_CONTEXT.tonalGoal.
- No bullet lists, no markdown, no JSON-in-JSON, no apologies.
- Never contradict supplied facts; admit if info is missing instead of inventing.

Respond with JSON:
{
  "narration": "string"
}
Do not include any extra keys.
```

**Note:** This prompt inherits the global system prompt (`inheritGlobalPrompt: 1`), which provides E.L.O.N.'s base personality.

**Output Contract:**
- **Required Fields:**
  - `narration` (string): Exactly 5-6 sentences of player-facing narration in 2nd person
- **Note:** The release JSON version does not include `toneHints` in the output (unlike the .txt fallback file)

---

### Stage 3: Image Prompt Generation

**Template File:** `server/pce/imagePrompt.txt` (fallback)  
**Reference Name:** `pce_image` (in `releases/current/prompts.json`)  
**Purpose:** Generate synchronized image prompt based on narrative

**System Prompt:**
```
You are the IMAGE STAGE of the PCE V2 pipeline.
Fuse style directives with the latest narrative beat to produce an evocative prompt for the art model.
```

**User Prompt (from release JSON):**
```
═══════════════════════════════════════════════════════
STYLE + MODEL DIRECTIVES
═══════════════════════════════════════════════════════
- STYLE: {{STYLE_OBJECT.label}}
- EXEMPLARS: {{STYLE_OBJECT.exemplifiedBy}}
- MASTER IMAGE GUIDANCE: {{MASTER_GUIDANCE.image}}
- IMAGE MODEL: {{IMAGE_MODEL.label}} ({{IMAGE_MODEL.class}})
- DEFAULT MODEL INSTRUCTIONS: {{MODEL_STYLE_INSTRUCTIONS}}
- MODEL TRIGGER WORDS: {{IMAGE_MODEL.triggerWords}}

═══════════════════════════════════════════════════════
NARRATIVE SIGNALS
═══════════════════════════════════════════════════════
- Current narration: {{NARRATION}}
- Enrichment tone goal: {{MASTER_CONTEXT.tonalGoal}}
- Focus NPC / subject: {{MASTER_CONTEXT.focusNpc}}
- Risk summary: {{MASTER_VARIABLES.riskSummary}}
- Sensory hooks: {{MASTER_VARIABLES.sensoryDetails}}

═══════════════════════════════════════════════════════
PROMPT RULES
═══════════════════════════════════════════════════════
- Lead with subject, setting, and action in one sentence.
- Immediately layer STYLE-specific vocabulary (color palette, composition, rendering finish).
- Embed model-critical keywords (trigger words, medium markers) naturally.
- Call out lighting, camera, and mood as dictated by STYLE_OBJECT.
- Avoid narration quotes and player-facing prose.
- Mention only concrete visual elements; no meta instructions like "describe" or "imagine".
- If MASTER_GUIDANCE.image conflicts with STYLE, prefer STYLE.
- Provide size or aspect hints ONLY if required by the guidance.
- Keep result under 120 tokens.

Return JSON:
{
  "imagePrompt": "string",
  "modelOverrides": { "provider": "optional", "params": { "key": "value" } }
}
Omit modelOverrides when not needed. No extra properties, no markdown.
```

**Note:** This prompt inherits the global system prompt (`inheritGlobalPrompt: 1`). Uses `{{NARRATION}}` variable (not `{{NARRATIVE_SUMMARY}}`).

**Output Contract:**
- **Required Fields:**
  - `imagePrompt` (string): Model-ready image prompt (format varies by model class)
- **Optional Fields:**
  - `modelOverrides` (object): Provider-specific parameter overrides

**Format Adaptation:**
- **Flux/Transformer Models**: Single string prompt (20-45 words)
- **Diffuser Models**: Object with `positive` and `negative` strings (40-80 words positive, 10-25 words negative)

---

### Stage 4: Actions Generation Prompt

**Template File:** `server/pce/actionsPrompt.txt`  
**Reference Name:** `pce_actions`  
**Purpose:** Generate next-turn action choices

**Full Template:**
```
You are the ACTION PLANNER stage of the PCE V2 pipeline.
Your mission is to transform context into compelling, mechanically valid action choices.

═══════════════════════════════════════════════════════
INPUT SNAPSHOT
═══════════════════════════════════════════════════════
- THEME PRIORITY: {{THEME_OBJECT.label}}
- ENRICHMENT GOALS: {{MASTER_GUIDANCE.actions}}
- PLAYER ACTION JUST TAKEN: {{PLAYER_ACTION}}
- CURRENT CHECK OUTCOME SUMMARY: {{CHECKS}}
- SHIP STATE: Hull {{HULL}}, Oxygen {{OXYGEN}}, Fuel {{FUEL}}, Food {{FOOD}}, Morale {{MORALE}}, Weirdness {{WEIRDNESS}}
- NPC SPOTLIGHT: {{MASTER_CONTEXT.focusNpc}}
- RISK SUMMARY: {{MASTER_VARIABLES.riskSummary}}
- AVAILABLE ITEMS: {{EQUIPPED_ITEMS}}
- OPEN THREADS / CALLBACKS: {{MASTER_CONTEXT.callback}}
- OPEN PROBLEMS: {{MASTER_CONTEXT.tension}}

═══════════════════════════════════════════════════════
DESIGN RULES
═══════════════════════════════════════════════════════
- Offer a spectrum of intents (repair, negotiate, explore, improvise, command, research, cook, other).
- Align each chip summary with the theme motif and enrichment cues.
- If MASTER_VARIABLES.punchlineSetup exists, dedicate one action to pay it off.
- Encourage interaction with highlighted NPC or item where relevant.
- For high risk stats (low hull, low morale, etc.), include one stabilizing option.
- Never reference mechanical minutiae (dice, modifiers); stay narrative-focused.

Respond with JSON matching:
{
  "actions": [
    {
      "action": "string identifier",
      "summary": "concise descriptive text",
      "risk": "Safe|Risky|Wild",
      "intent": "repair|negotiate|cook|explore|improvise|research|command|other",
      "usesItemId": "optional item id string"
    }
  ]
}
Ensure the array is not empty. No markdown, no trailing commentary.
```

**Output Contract:**
- **Required Fields:**
  - `actions` (array): Array of action chip objects
- **Action Chip Structure:**
  - `action` (string): Action identifier
  - `summary` (string): ≤18 words, actionable, theme-aware
  - `risk` (string): "Safe" | "Risky" | "Wild"
  - `intent` (string): One of: `repair`, `negotiate`, `cook`, `explore`, `improvise`, `research`, `command`, `other`
  - `usesItemId` (string, optional): Item ID if action uses an item

**Requirements:**
- Provide 4 distinct actions (unless guidance mandates fewer)
- Risks must balance per `MASTER_GUIDANCE.actions`
- Summaries must be ≤18 words

---

## Available Prompt Variables

Variables are organized by stage availability. Variables available in earlier stages are inherited by later stages unless explicitly noted.

### Base Variables (Available in All Stages)

These variables are available in the Master stage and inherited by all subsequent stages.

#### Game State Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `{{TURN_NUMBER}}` | number | Current turn number (1+) | `5` |
| `{{DAY}}` | number | Current day number (1+) | `3` |
| `{{SEGMENT}}` | string | Current journey segment | `"Belt"`, `"Outer Darkness"`, `"Approach"` |
| `{{HULL}}` | number | Ship hull integrity (0-100) | `75` |
| `{{OXYGEN}}` | number | Oxygen level (0-100) | `90` |
| `{{FUEL}}` | number | Fuel level (0-100) | `60` |
| `{{FOOD}}` | number | Food supplies (0-100) | `45` |
| `{{MORALE}}` | number | Crew morale (0-100) | `80` |
| `{{WEIRDNESS}}` | number | Weirdness level (0-100) | `25` |

#### Player Action Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `{{PLAYER_ACTION}}` | string | The action the player just took | `"Check the navigation console"` |
| `{{CHECKS}}` | string | Formatted skill check results | `"- Navigation DC15: Rolled 18 ✅\n- Engineering DC12: Rolled 8 ❌"` |
| `{{ACTIVE_EVENT}}` | string | Currently active event description | `"Asteroid Field (Belt segment - Navigation challenge)"` or `"No special events triggered this turn."` |
| `{{RUNNING_GAGS}}` | string | Up to 3 active running gags | `"Coffee-9000's existential crisis, Duct tape everywhere"` or `"None yet."` |

#### Equipment & NPC Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `{{EQUIPPED_ITEMS}}` | string | List of equipped items with icons | `"Duct Tape Deluxe (🔧), Manual (📖)"` or `"None"` |
| `{{NPC_SUMMARY}}` | string | Summary of active NPCs with affinity/status | `"Pilot Lyra (Navigator) — Warm, status active; Engineer Grom (Chief Engineer) — Neutral, status active"` or `"No active crew members."` |

#### History & Context Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `{{RECENT_TURNS}}` | string | Last 3 turn summaries (140 chars each) | `"Turn 3: You approach the asteroid field... | Turn 4: The navigation console flickers..."` |
| `{{INTERVIEW_SUMMARY}}` | string | Summary of interview responses (up to 4) | `"captainMotivation: Explore the unknown; favoriteFood: Space pizza"` or `"None recorded."` |

#### Creative Selection Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `{{THEME_OBJECT}}` | object | Selected theme object with nested properties | See nested properties below |
| `{{THEME_OBJECT.label}}` | string | Theme label | `"D.O.G.E. Interstellar Internship"` |
| `{{THEME_OBJECT.narratorTemplate}}` | string | Narrator persona template | `"You are E.L.O.N., the Edgelord Logic Observation Nexus..."` |
| `{{STYLE_OBJECT}}` | object | Selected visual style object | See nested properties below |
| `{{STYLE_OBJECT.label}}` | string | Style label | `"Game | Ega-Vga"` |
| `{{STYLE_OBJECT.exemplifiedBy}}` | string | Style exemplars | `"King's Quest, Commander Keen, Prince of Persia, Doom"` |
| `{{IMAGE_MODEL}}` | object | Selected image model object | See nested properties below |
| `{{IMAGE_MODEL.label}}` | string | Model display name | `"Flux Pro 1.1"` |
| `{{IMAGE_MODEL.class}}` | string | Model class | `"flux"`, `"transformer"`, `"diffuser"` |
| `{{IMAGE_MODEL.triggerWords}}` | string | Model-specific trigger words | `"cinematic, dramatic lighting"` |

#### Model Instruction Variables

| Variable | Type | Description | Availability |
|----------|------|-------------|--------------|
| `{{MODEL_STYLE_INSTRUCTIONS}}` | string | Format requirements for the image model | Master, Image stages |
| `{{OUTPUT_FORMAT_INSTRUCTIONS}}` | string | JSON output format expectations | Master stage only |
| `{{OUTPUT_EXAMPLE}}` | string | Example output demonstrating format | Master stage only |
| `{{IMAGE_MODEL_KEY}}` | string | Image model key identifier | All stages |

#### Style Modifier Variables

| Variable | Type | Description | Availability |
|----------|------|-------------|--------------|
| `{{STYLE_MODIFIERS}}` | string | Resolved style modifiers (model-class specific) | Master, Image stages |
| `{{STYLE_DIFFUSION_MODIFIERS}}` | string | Diffusion model modifiers | Master, Image stages |
| `{{STYLE_TRANSFORMER_MODIFIERS}}` | string | Transformer/Flux model modifiers | Master, Image stages |

---

### Master Enrichment Variables (Available After Master Stage)

These variables are generated by the Master stage and made available to all subsequent stages via flattened enrichment data.

#### Master Context Variables

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| `{{MASTER_CONTEXT}}` | object | Full master context object | Master stage output |
| `{{MASTER_CONTEXT.turnMoment}}` | string | High-signal moment description | **Required** from master |
| `{{MASTER_CONTEXT.tonalGoal}}` | string | Desired tone for the turn | **Required** from master |
| `{{MASTER_CONTEXT.focusNpc}}` | string | NPC to spotlight this turn | Optional from master |
| `{{MASTER_CONTEXT.tension}}` | string | Current tension source | Optional from master |
| `{{MASTER_CONTEXT.callback}}` | string | Reference to previous turn | Optional from master |

#### Master Variables

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| `{{MASTER_VARIABLES}}` | object | Full master variables object | Master stage output |
| `{{MASTER_VARIABLES.keyPhrases}}` | array | Reusable phrases for narrative | Optional from master |
| `{{MASTER_VARIABLES.sensoryDetails}}` | array | Sensory hooks for imagery | Optional from master |
| `{{MASTER_VARIABLES.riskSummary}}` | string | Risk assessment summary | Optional from master |
| `{{MASTER_VARIABLES.punchlineSetup}}` | string | Comedy setup for actions | Optional from master |

#### Master Guidance Variables

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| `{{MASTER_GUIDANCE}}` | object | Full master guidance object | Master stage output |
| `{{MASTER_GUIDANCE.narrative}}` | array | 2-4 directives for narrative stage | **Required** from master |
| `{{MASTER_GUIDANCE.image}}` | array | 2-4 directives for image stage | **Required** from master |
| `{{MASTER_GUIDANCE.actions}}` | array | 2-4 directives for actions stage | **Required** from master |

---

### Narrative Stage Variables

The Narrative stage inherits all Master stage variables plus:

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| `{{MASTER_CONTEXT.*}}` | various | All master context fields | Inherited from master |
| `{{MASTER_VARIABLES.*}}` | various | All master variable fields | Inherited from master |
| `{{MASTER_GUIDANCE.narrative}}` | array | Narrative-specific guidance | Inherited from master |

**Note:** The Narrative stage does not add new variables beyond what's inherited. It uses the master enrichment to generate narration.

---

### Image Stage Variables

The Image stage inherits all Master stage variables plus:

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| `{{MASTER_CONTEXT.*}}` | various | All master context fields | Inherited from master |
| `{{MASTER_VARIABLES.*}}` | various | All master variable fields | Inherited from master |
| `{{MASTER_GUIDANCE.image}}` | array | Image-specific guidance | Inherited from master |
| `{{NARRATION}}` | string | Full narration text from narrative stage | Narrative stage output |
| `{{NARRATIVE_SUMMARY}}` | string | Same as `NARRATION` (alias) | Narrative stage output |

**Note:** The image prompt template uses `{{NARRATION}}` (not `{{NARRATIVE_SUMMARY}}`). The `NARRATIVE_TONE_HINTS` variable is built but not currently used in the release JSON image prompt template.

---

### Actions Stage Variables

The Actions stage inherits **all** Master variables (same as Narrative stage) except image-specific ones, plus narrative output:

| Variable | Type | Description | Source |
|----------|------|-------------|--------|
| All base Master variables | various | Same as Narrative stage (see Base Variables section) | Inherited from master |
| `{{CURRENT_NARRATIVE}}` | string | Full narration text from narrative stage | Narrative stage output |
| `{{MASTER_CONTEXT.*}}` | various | All master context fields | Inherited from master |
| `{{MASTER_VARIABLES.*}}` | various | All master variable fields | Inherited from master |
| `{{MASTER_GUIDANCE.actions}}` | array | Actions-specific guidance | Inherited from master |

**Included Variables (same as Narrative stage):**
- `{{NPC_SUMMARY}}` - Available for NPC-aware action suggestions
- `{{RECENT_TURNS}}` - Available for continuity-aware actions
- `{{INTERVIEW_SUMMARY}}` - Available for personalized actions
- `{{THEME_OBJECT}}` - Theme context for action theming
- `{{STYLE_OBJECT}}` - Style context (though less relevant for actions)
- `{{IMAGE_MODEL_KEY}}` - Model key (for reference, though not used in actions)

**Excluded Variables (image-specific, not needed for actions):**
- `{{IMAGE_MODEL}}` object - Full image model object (not needed)
- `{{MODEL_STYLE_INSTRUCTIONS}}` - Image format instructions
- `{{OUTPUT_FORMAT_INSTRUCTIONS}}` - Image output format
- `{{OUTPUT_EXAMPLE}}` - Image output example
- `{{STYLE_MODIFIERS}}` - Image style modifiers
- `{{STYLE_DIFFUSION_MODIFIERS}}` - Diffusion model modifiers
- `{{STYLE_TRANSFORMER_MODIFIERS}}` - Transformer model modifiers

**Note:** Actions stage now has the same base variable access as Narrative stage, ensuring both stages can make informed decisions based on full game context (NPCs, recent turns, interview responses, etc.). Only image-specific variables are excluded since actions don't generate images.

---

## Variable Availability Matrix

| Variable | Master | Narrative | Image | Actions |
|----------|--------|-----------|-------|---------|
| **Game State** |
| `TURN_NUMBER` | ✅ | ✅ | ✅ | ✅ |
| `DAY` | ✅ | ✅ | ✅ | ✅ |
| `SEGMENT` | ✅ | ✅ | ✅ | ✅ |
| `HULL`, `OXYGEN`, etc. | ✅ | ✅ | ✅ | ✅ |
| **Player Action** |
| `PLAYER_ACTION` | ✅ | ✅ | ✅ | ✅ |
| `CHECKS` | ✅ | ✅ | ✅ | ✅ |
| `ACTIVE_EVENT` | ✅ | ✅ | ✅ | ✅ |
| `RUNNING_GAGS` | ✅ | ✅ | ✅ | ✅ |
| **Equipment & NPCs** |
| `EQUIPPED_ITEMS` | ✅ | ✅ | ✅ | ✅ |
| `NPC_SUMMARY` | ✅ | ✅ | ✅ | ✅ |
| **History** |
| `RECENT_TURNS` | ✅ | ✅ | ✅ | ✅ |
| `INTERVIEW_SUMMARY` | ✅ | ✅ | ✅ | ✅ |
| **Creative** |
| `THEME_OBJECT.*` | ✅ | ✅ | ✅ | ✅ |
| `STYLE_OBJECT.*` | ✅ | ✅ | ✅ | ✅ |
| `IMAGE_MODEL.*` | ✅ | ✅ | ✅ | ❌ |
| **Model Instructions** |
| `MODEL_STYLE_INSTRUCTIONS` | ✅ | ❌ | ✅ | ❌ |
| `OUTPUT_FORMAT_INSTRUCTIONS` | ✅ | ❌ | ❌ | ❌ |
| `OUTPUT_EXAMPLE` | ✅ | ❌ | ❌ | ❌ |
| `IMAGE_MODEL_KEY` | ✅ | ✅ | ✅ | ✅ |
| **Style Modifiers** |
| `STYLE_MODIFIERS` | ✅ | ❌ | ✅ | ❌ |
| `STYLE_DIFFUSION_MODIFIERS` | ✅ | ❌ | ✅ | ❌ |
| `STYLE_TRANSFORMER_MODIFIERS` | ✅ | ❌ | ✅ | ❌ |
| **Master Enrichment** |
| `MASTER_CONTEXT.*` | ❌ | ✅ | ✅ | ✅ |
| `MASTER_VARIABLES.*` | ❌ | ✅ | ✅ | ✅ |
| `MASTER_GUIDANCE.*` | ❌ | ✅ | ✅ | ✅ |
| **Narrative Output** |
| `NARRATION` | ❌ | ❌ | ✅ | ❌ |
| `NARRATIVE_SUMMARY` | ❌ | ❌ | ✅ | ❌ |
| `NARRATIVE_TONE_HINTS` | ❌ | ❌ | ❌ | ❌ |
| `CURRENT_NARRATIVE` | ❌ | ❌ | ❌ | ✅ |

---

## Variable Generation Details

### Helper Functions

Variables are generated by helper functions in `server/aiService.ts`:

#### `summarizeNpcs(state: GameState): string`
- **Format:** `"Name (Role) — Attitude, status Status; ..."`
- **Attitude:** "Warm" (affinity > 0), "Cold" (affinity < 0), "Neutral" (affinity = 0)
- **Returns:** `"No active crew members."` if no NPCs

#### `summarizeRecentTurns(state: GameState): string`
- **Format:** `"Turn N: snippet... | Turn N+1: snippet... | ..."`
- **Snippet Length:** 140 characters max per turn
- **Count:** Last 3 turns
- **Returns:** `"No prior turns logged."` if no turns

#### `summarizeInterviewResponses(responses: Record<string, string>): string`
- **Format:** `"key: value; key: value; ..."`
- **Count:** Up to 4 responses
- **Returns:** `"None recorded."` if no responses

#### `formattedChecks` (from `gatherTurnPromptIngredients`)
- **Format:** `"- Skill DCX: Rolled Y ✅"` or `"- Skill DCX: Rolled Y ❌"`
- **Multiple checks:** Newline-separated
- **Returns:** `"No skill checks this turn."` if no checks

#### `equippedItemsText` (from `gatherTurnPromptIngredients`)
- **Format:** `"Item Name (Icon), Item Name (Icon)"`
- **Returns:** `"None"` if no items

---

## Variable Substitution

### Syntax

Variables use double curly brace syntax: `{{VARIABLE_NAME}}`

### Nested Property Access

Nested properties use dot notation: `{{THEME_OBJECT.label}}`

**Supported:**
- `{{THEME_OBJECT.label}}`
- `{{MASTER_CONTEXT.turnMoment}}`
- `{{IMAGE_MODEL.triggerWords}}`

**Not Supported:**
- Array indexing: `{{MASTER_VARIABLES.keyPhrases[0]}}` (use full array)
- Deep nesting beyond 2 levels (rarely needed)

### Variable Validation

When `validate: true` is passed to `buildPcePrompt()`, the system:
1. Scans template for all `{{...}}` placeholders
2. Validates each placeholder against provided variables
3. Reports missing or undefined variables
4. Throws error if validation fails

### Handling Missing Variables

- **Undefined variables:** Left as-is in template (e.g., `{{MISSING}}` appears literally)
- **Null values:** Converted to empty string
- **Array values:** Converted to comma-separated string (for display)
- **Object values:** Must use nested property access

---

## Best Practices

### Template Design

1. **Document Required Variables:** Use template doc blocks to list required variables
2. **Use Nested Properties:** Access object properties via dot notation
3. **Handle Optional Variables:** Use conditional language when variables may be missing
4. **Validate Early:** Enable validation during development

### Variable Naming

1. **Use UPPER_SNAKE_CASE:** All top-level variables follow this convention
2. **Group Related Variables:** Use object structures (e.g., `MASTER_CONTEXT.*`)
3. **Avoid Collisions:** Don't reuse variable names across contexts
4. **Be Descriptive:** Variable names should indicate purpose

### Stage-Specific Considerations

1. **Master Stage:** Has access to all base variables; generates enrichment
2. **Narrative Stage:** Focus on `MASTER_GUIDANCE.narrative` and context
3. **Image Stage:** Prioritize `STYLE_OBJECT` and `NARRATION`; use model instructions
4. **Actions Stage:** Balance `MASTER_GUIDANCE.actions` with game state

---

## Related Documentation

- **PCE Architecture:** See `docs_master/current/PROMPT_COMPOSITION_ENGINE.md`
- **AI Service Integration:** See `docs_master/current/AI_SERVICE.md`
- **Template Loading:** See `server/pce/promptBuilder.ts`
- **Variable Building:** See `server/aiService.ts` (functions: `buildMasterVariables`, `buildNarrativeVariables`, `buildImageVariables`, `buildActionsVariables`)

---

**Document Status:** Complete  
**Maintainer:** Engineering Team  
**Review Cycle:** When prompts or variables change
