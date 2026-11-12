# Prompt Composition Engine (PCE) Documentation

**Status:** ⚠️ **CONSOLIDATED** — This content has been merged into [`MAIN_STORY_SYSTEM.md`](./MAIN_STORY_SYSTEM.md), which provides a unified view of game turns, story beats, narrative arcs, and the Prompt Composition Engine working together.

This document remains for historical reference and detailed PCE implementation notes, but the integration with the main story system is now documented in `MAIN_STORY_SYSTEM.md`. For PCE-specific template authoring, see [`PCE_PROMPTS_AND_VARIABLES.md`](./PCE_PROMPTS_AND_VARIABLES.md).

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** January 2025  
**Primary Module:** `server/pce/`

---

## Context & Overview

### What is the Prompt Composition Engine?

The Prompt Composition Engine (PCE) is a sophisticated multi-stage prompt composition system that generates synchronized narrative text and image prompts for Quest to Uranus. Unlike legacy template-based approaches that generate content independently, PCE uses a sequential pipeline where each stage builds upon previous outputs, ensuring visual-textual consistency and thematic coherence across all generated content.

### Why It Exists

The PCE was created to solve critical problems with the legacy prompt system:

1. **Synchronization Problem**: Legacy system generated narrative and images independently, leading to visual-textual mismatches (e.g., narrative describes "dark corridor" but image shows "bright hallway").

2. **Thematic Inconsistency**: Without a unified enrichment layer, different content types (narrative, images, actions) could drift from the selected theme/style.

3. **Context Loss**: Each prompt generation operated in isolation, unable to leverage insights from previous stages or maintain narrative continuity.

4. **Maintenance Burden**: Multiple independent templates required manual synchronization when game mechanics or creative direction changed.

5. **Model Optimization**: Different image models (Flux, Transformer, Diffuser) require different prompt formats, but legacy system couldn't adapt dynamically.

### Purpose Within the System

The PCE sits at the core of the game's content generation pipeline, serving as the **orchestration layer** between game state and AI providers:

```
Game State + User Preferences
         ↓
    PCE Pipeline
    ┌──────────┐
    │  Master  │ → Contextual Enrichment
    └────┬─────┘
         ↓
    ┌──────────┐
    │Narrative │ → 6-7 Sentence Story
    └────┬─────┘
         ↓
    ┌──────────┐  ┌──────────┐
    │  Image   │  │ Actions  │ → Parallel Generation
    └──────────┘  └──────────┘
         ↓              ↓
    Image Prompt   Action Chips
```

**Integration Points**:
- **AI Service** (`server/aiService.ts`): Runs the PCE pipeline through `runPceGraph` (`server/pce/graph`)
- **Turn Processor**: Uses PCE to generate turn content during game execution
- **Game Initialization**: Resolves PCE theme/style selections for new games
- **DevTools**: Provides PCE prompt editing (Prompts tab) and catalog management (PCE tab)

---

## Technical Details

### Architecture

The PCE follows a **sequential pipeline architecture** with four distinct stages:

```
┌─────────────────────────────────────────────────────────┐
│         Pipeline graph (server/pce/graph)                │
│  (Stage order, parallel branches, retry and fallback)   │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 1: Master           │
        │   Generate Enrichment        │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 2: Narrative        │
        │   Generate Story Text       │
        └──────────────┬──────────────┘
                       │
        ┌──────────────┬──────────────┐
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐
│ Stage 3:     │ │ Stage 4:    │
│ Image        │ │ Actions    │
│ Generate     │ │ Generate    │
│ Image Prompt │ │ Action Chips│
└──────────────┘ └─────────────┘
```

**Key Design Principles**:
1. **Sequential Dependency**: Master → Narrative → (Image + Actions in parallel)
2. **Data Flow**: Each stage receives outputs from previous stages via `TurnGenerationContext`
3. **Error Propagation**: Stage failures bubble up with detailed metadata
4. **Template-Based**: Each stage uses a separate prompt template with variable substitution
5. **Model-Aware**: Image stage adapts output format based on image model class

### Core Components

#### 1. **Pipeline Graph** (`server/pce/graph/`)

The pipeline is a LangGraph graph. Types shared with its callers (`StageResult`, `StageMetadata`, `TurnGenerationContext`, `FullTurnContentResult`) are in `contentRouter.ts`.

**Responsibilities**:
- Stage sequencing and dependency management (`graph.ts`)
- One stage runner for all four stages: variables, prompt, model call, JSON, output check (`stages.ts`)
- Retry and fallback-model recovery, with every attempt recorded (`recovery.ts`)
- Parallel execution of independent stages (Image + Actions)
- Running part of the pipeline on supplied upstream data (PCE Inspector single-stage runs)

**Entry point**: `runPceGraph(context, options)` in `index.ts`
- no options: the whole turn on published prompts; throws if a stage produced nothing
- `promptSource: "database"`: use the drafts being edited in Dev Tools
- `mode: "lenient"`: return what was produced instead of throwing
- `target`, `upstream`: stop after one stage; supply earlier stages' output instead of running them
- `recover: false`: run each stage once, without retry or fallback

See [OBSERVABILITY_AND_EVALS.md](OBSERVABILITY_AND_EVALS.md) for the graph's design notes and how each stage appears on a trace.

**Error Handling Strategy**:
- Each stage returns `StageResult<T>` with `ok` boolean and `metadata` array
- Router validates stage outputs before proceeding
- Throws descriptive errors with full context when stages fail
- Aggregates all stage metadata into `promptChain` for debugging

#### 2. **Prompt Builder** (`promptBuilder.ts`)

Handles template loading, variable substitution, and validation:

**Template Loading**:
- **Primary Source**: Reference system (database `prompts` table)
- **Fallback**: File system (`server/pce/*.txt` files)
- **Caching**: In-memory cache with metrics tracking
- **Template Names**: `pce_master`, `pce_narrative`, `pce_image`, `pce_actions`

**Variable Substitution**:
- Supports nested property access: `{{THEME_OBJECT.narratorTemplate}}`
- Handles scalar values: `{{TURN_NUMBER}}`, `{{HULL}}`
- Validates placeholders when `validate: true` option provided
- Strips documentation blocks (`<!-- PCE_TEMPLATE_DOC_START ... -->`) before LLM delivery

**Key Functions**:
- `buildPcePrompt(templateName, variables, options)`: Builds system/user prompt pair, plus `template: { name, source, hash }` identifying the exact template version used
- `loadPceTemplate(templateName)`: Loads template from reference or file
- `validateMetaPromptVariables(template, variables)`: Validates all placeholders
- `renderTemplateString(template, variables, options)`: Performs substitution

**Template Structure**:
Templates can define both `system` and `user` prompts:
- **System Prompt**: Role definition, instructions, constraints
- **User Prompt**: Turn-specific context, game state, variables

If only system prompt is provided, user prompt defaults to empty string.

#### 3. **Settings Resolver** (`settings.ts`)

Resolves theme and style selections from user preferences and defaults:

**Resolution Strategy**:
1. Check user-provided overrides (`userPreferences.theme`, `userPreferences.style`)
2. Fall back to system defaults (`system_defaults.story_theme_key`, `system_defaults.visual_style_key`)
3. Validate selections exist in active catalogs
4. Match by `storyThemeKey`/`visualStyleKey` or `label` (case-insensitive)
5. Return normalized `label` values for use in prompts

**Key Functions**:
- `resolvePceSelections(overrides)`: Resolves final theme/style pair
- `getPceDefaults()`: Retrieves defaults from reference system

**Data Sources**:
- **Themes**: `story_themes` table (via `storage.listStoryThemes()`)
- **Styles**: `visual_styles` table (via `storage.listVisualStyles()`)
- **Defaults**: `releases/current/data/system_defaults.json`

#### 4. **Model Instructions** (`modelInstructions.ts`)

Adapts image prompt generation to specific model classes:

**Supported Model Classes**:
- **Flux**: Natural language sentences (2-4 fragments, 20-40 words)
- **Transformer**: Flowing narrative sentences (2-3 sentences, 25-45 words)
- **Diffuser**: Comma-separated tags with weights (40-80 words positive, 10-25 words negative)
- **Fallback**: Defaults to transformer format when class unrecognized

**Instruction Components**:
- **Style Guidance**: Format requirements, length constraints, structure templates
- **Output Contract**: JSON schema expectations (single string vs. positive/negative object)
- **Example**: Sample output demonstrating correct format

**Key Function**:
- `buildModelInstructionSet(modelClass)`: Returns instruction set for given model class

**Integration**:
Instructions are injected into image stage template via `{{MODEL_STYLE_INSTRUCTIONS}}`, `{{OUTPUT_FORMAT_INSTRUCTIONS}}`, and `{{OUTPUT_EXAMPLE}}` variables.

#### 5. **Master Enrichment Flattener** (`promptBuilder.ts`)

Transforms master stage output into reusable variable sets:

**Flattening Strategy**:
Master stage returns:
```json
{
  "context": { "turnMoment": "...", "tonalGoal": "...", ... },
  "variables": { "keyPhrases": [...], "sensoryDetails": [...], ... },
  "guidance": { "narrative": [...], "image": [...], "actions": [...] }
}
```

Flattener creates:
```typescript
{
  MASTER_CONTEXT: { ... },
  MASTER_VARIABLES: { ... },
  MASTER_GUIDANCE: { ... },
  MASTER_ENRICHMENT: { ... }  // Full original object
}
```

**Purpose**:
- Makes enrichment data accessible to downstream stages via simple variable names
- Preserves full enrichment object for debugging
- Enables template authors to reference nested properties easily

**Key Function**:
- `flattenMasterEnrichment(enrichment)`: Transforms master output into variable set

### Stage-by-Stage Breakdown

#### Stage 1: Master Enrichment

**Purpose**: Generate contextual enrichment that informs all subsequent stages

**Input Variables**:
- Game state: `TURN_NUMBER`, `DAY`, `SEGMENT`, `HULL`, `OXYGEN`, `FUEL`, `FOOD`, `MORALE`, `WEIRDNESS`
- Player context: `PLAYER_ACTION`, `CHECKS`, `ACTIVE_EVENT`, `RUNNING_GAGS`
- Equipment: `EQUIPPED_ITEMS`, `NPC_SUMMARY`
- Creative: `THEME_OBJECT`, `STYLE_OBJECT`, `IMAGE_MODEL`
- History: `RECENT_TURNS`, `INTERVIEW_SUMMARY`

**Template**: `server/pce/masterPrompt.txt` (or `pce_master` in reference)

**Output Structure**:
```json
{
  "context": {
    "turnMoment": "string",      // Required: High-signal moment description
    "tonalGoal": "string",        // Required: Desired tone
    "focusNpc": "string?",       // Optional: NPC to spotlight
    "tension": "string?",        // Optional: Current tension source
    "callback": "string?"        // Optional: Reference to previous turn
  },
  "variables": {
    "keyPhrases": ["string"]?,   // Optional: Reusable phrases
    "sensoryDetails": ["string"]?, // Optional: Sensory hooks
    "riskSummary": "string?",     // Optional: Risk assessment
    "punchlineSetup": "string?"  // Optional: Comedy setup
  },
  "guidance": {
    "narrative": ["string"],     // Required: 2-4 directives
    "image": ["string"],         // Required: 2-4 directives
    "actions": ["string"]       // Required: 2-4 directives
  }
}

### Variable Supply Chain (Merged from Prompt Variable System)

| Layer | Responsibility | Implementation |
| --- | --- | --- |
| **Turn Prompt Ingredients** | Pulls together `GameState`, DB lookups (themes, styles, image models), player-preference overrides, and formatted summaries (checks, NPCs, running gags). | `gatherTurnPromptIngredients` in `server/aiService.ts:411-557` |
| **Stage Variable Builders** | `buildMasterVariables`, `buildNarrativeVariables`, `buildImageVariables`, `buildActionsVariables` expose stage-specific maps, ensuring nested objects (`THEME_OBJECT`, `MASTER_CONTEXT`, etc.) always contain the fields templates expect. | `server/aiService.ts:560-689` |
| **Validation + Rendering** | `buildPcePrompt()` performs placeholder validation (when `validate: true`) via `validateMetaPromptVariables`, renders templates, and emits separated system/user prompts. | `server/pce/promptBuilder.ts:271-495` |
| **Enrichment Flattening** | `flattenMasterEnrichment()` normalizes the master JSON into `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`, `MASTER_GUIDANCE.*` for downstream reuse. | `server/pce/promptBuilder.ts:502-531` |

#### Data Flow
1. **Ingredients Gathered:** Before any stage runs, the router calls `gatherTurnPromptIngredients` to hydrate theme/style selections, equipped item metadata, model instructions, recent turn snippets, and interview summaries.
2. **Base Variables Built:** Master stage receives the shared map (`TURN_NUMBER`, ship vitals, creative selections, formatted strings). These keys are upper-snake-case by convention to stay readable inside prompts.
3. **Enrichment Propagated:** After master completes, `flattenMasterEnrichment` exposes nested context/guidance blocks so later stages can access `{{MASTER_GUIDANCE.image}}`, `{{MASTER_CONTEXT.turnMoment}}`, etc.
4. **Narrative Echo:** Image and action stages receive `NARRATION` / `CURRENT_NARRATIVE`, tone hints, and style modifiers so they stay synchronized with the latest prose.
5. **Template Validation:** `buildPcePrompt` validates every placeholder before calling the LLM, ensuring undefined variables never leak into production prompts.

#### Instrumentation
- `variableBuildDuration` labels variable construction time per stage (`server/aiService.ts:889-1174`).
- `promptBuildDuration` covers template rendering latency.
- `pceStageDuration` wraps the LLM call itself. Dashboards combine these metrics to spot regressions (e.g., new variables that require extra DB work).

#### Best Practices
- **Upper snake case** for root keys; use dot notation for nested properties (`{{MASTER_CONTEXT.tension}}`).
- **Prefer formatted helpers** (e.g., `summarizeNpcs`, `summarizeRecentTurns`) over raw arrays to keep prompts concise.
- **Guard optional data** inside templates (“If {{RUNNING_GAGS}} is 'None yet', avoid gag callbacks.”).
- **Keep enrichment authoritative:** treat `MASTER_GUIDANCE` as the single source of truth for later-stage directives.

### Operational Guidance

#### Inspecting Variables
1. Enable `CONSOLE_LLM_LOG=true` to stream `promptVariables` snapshots over Socket.IO while running turns.
2. Use DevTools → **PCE Audit** to replay a turn; it invokes the same `buildPcePrompt()` path as production.
3. For isolated testing, import `buildMasterVariables`/`buildNarrativeVariables` in a REPL or unit test and print the resulting keys.

#### Adding or Changing Variables
1. Extend `TurnPromptIngredients` and populate the data in `gatherTurnPromptIngredients`.
2. Expose the field through the appropriate builder (master for base availability; narrative/image/actions for stage-specific variants).
3. Update template documentation (`PCE_PROMPTS_AND_VARIABLES.md`) with the new variable description and availability.
4. Validate by running `pnpm vitest server/pce/promptBuilder.test.ts` and exercising the DevTools replay.

#### Troubleshooting
| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| `Meta prompt validation failed: {{VAR}} (missing variable 'VAR')` | Template references a key not present in the builder. | Ensure the builder sets the field or guard the template; rerun with `validate: true`. |
| `missing-path` errors for nested objects | Stage attempted to read `{{MASTER_CONTEXT.focusNpc}}` before master enrichment succeeded. | Verify master output, provide safe defaults, or short-circuit downstream stages. |
| Image/actions templates see `[object Object]` | Template referenced `{{MASTER_GUIDANCE}}` instead of `{{MASTER_GUIDANCE.image}}`. | Always reference nested properties; builders intentionally block inserting raw objects. |
| Actions stage errors mentioning image modifiers | Actions builder strips model-specific fields; template still tries to reference them. | Remove image-only placeholders or reintroduce the data via builder if truly needed. |

#### Standards & Processes
- Keep `validate: true` enabled in all production `buildPcePrompt` calls so template regressions fail fast.
- Treat variable renames as breaking changes; coordinate with prompt authors before shipping.
- Sanitize any user-authored text (interview responses, player actions). Helper functions cap list sizes and normalize whitespace; extend them if new inputs are introduced.
- Template cache: call `clearTemplateCache()` after editing fallback `.txt` files locally to avoid serving stale prompts.
```

**Validation**:
- All required fields must be present
- Guidance arrays must contain 2-4 strings each
- Context fields should be concise (max 50 words each)

#### Stage 2: Narrative Generation

**Purpose**: Generate 6-7 sentence player-facing narration

**Input Variables**:
- Inherits all master variables
- Master enrichment: `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`, `MASTER_GUIDANCE.narrative`
- Game state: `PLAYER_ACTION`, `CHECKS`, `ACTIVE_EVENT`, stats, items, NPCs

**Template**: `server/pce/narrativePrompt.txt` (or `pce_narrative` in reference)

**Output Structure**:
```json
{
  "narration": "string",         // Required: 6-7 sentences
  "toneHints": ["string"]?       // Optional: Tone descriptors
}
```

**Requirements**:
- Exactly 6-7 sentences
- Direct second-person voice (unless theme specifies otherwise)
- Must incorporate `MASTER_CONTEXT.focusNpc` if provided
- Must reflect `MASTER_VARIABLES.riskSummary` stakes
- Must close with energy matching `MASTER_CONTEXT.tonalGoal`
- No markdown, no JSON-in-JSON, no apologies

**Thematic Anchoring**:
- Primary weight: `THEME_OBJECT.label` and `THEME_OBJECT.narratorTemplate`
- All narrative choices should reinforce theme motif
- Honor narrator persona specified in theme

#### Stage 3: Image Prompt Generation

**Purpose**: Generate synchronized image prompt based on narrative

**Input Variables**:
- Inherits all master variables
- Master enrichment: `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`, `MASTER_GUIDANCE.image`
- Narrative: `NARRATION`, `NARRATIVE_SUMMARY`, `NARRATIVE_TONE_HINTS`
- Style: `STYLE_OBJECT.*`, `STYLE_MODIFIERS`, `STYLE_DIFFUSION_MODIFIERS`, `STYLE_TRANSFORMER_MODIFIERS`
- Model: `IMAGE_MODEL.*`, `MODEL_STYLE_INSTRUCTIONS`, `OUTPUT_FORMAT_INSTRUCTIONS`, `OUTPUT_EXAMPLE`

**Template**: `server/pce/imagePrompt.txt` (or `pce_image` in reference)

**Output Structure**:
```json
{
  "imagePrompt": "string",      // Required: Model-ready prompt
  "modelOverrides": {            // Optional: Provider-specific overrides
    "provider": "string",
    "params": { "key": "value" }
  }?
}
```

**Format Adaptation**:
- **Flux/Transformer**: Single string prompt (20-45 words)
- **Diffuser**: Object with `positive` and `negative` strings (40-80 words positive, 10-25 words negative)

**Requirements**:
- Lead with subject, setting, and action
- Layer style-specific vocabulary (color palette, composition, rendering)
- Embed model trigger words naturally
- Call out lighting, camera, mood per style
- Avoid narration quotes or player-facing prose
- Keep under 120 tokens
- If `MASTER_GUIDANCE.image` conflicts with `STYLE_OBJECT`, prefer style

#### Stage 4: Actions Generation

**Purpose**: Generate next-turn action choices

**Input Variables**:
- Subset of master variables (no image-specific data)
- Master enrichment: `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`, `MASTER_GUIDANCE.actions`
- Narrative: `CURRENT_NARRATIVE` (from narrative stage)
- Game state: `PLAYER_ACTION`, `CHECKS`, stats, items, NPCs
- Creative: `THEME_OBJECT`, `STYLE_OBJECT`

**Template**: `server/pce/actionsPrompt.txt` (or `pce_actions` in reference)

**Output Structure**:
```json
{
  "actions": [
    {
      "action": "string",         // Required: Action identifier
      "summary": "string",        // Required: ≤18 words
      "risk": "Safe|Risky|Wild",  // Required: Risk level
      "intent": "string",        // Required: Intent category
      "usesItemId": "string?"    // Optional: Item to use
    }
  ]
}
```

**Requirements**:
- Provide 4 distinct actions (unless guidance mandates fewer)
- Summaries ≤18 words, actionable, theme-aware
- Risks must balance per `MASTER_GUIDANCE.actions`
- Offer spectrum of intents: `repair`, `negotiate`, `cook`, `explore`, `improvise`, `research`, `command`, `other`
- If `MASTER_VARIABLES.punchlineSetup` exists, dedicate one action to pay it off
- For high-risk stats, include one stabilizing option

### Technologies & Frameworks

**Core Dependencies**:
- **Node.js File System** (`fs/promises`): Template file loading
- **Performance API** (`perf_hooks`): Template load timing
- **Reference System** (`server/reference/referenceLoader.ts`): Template storage and retrieval
- **Storage Layer** (`server/storage.ts`): Theme/style catalog access

**Internal Modules**:
- `server/pce/promptBuilder.ts`: Template loading and variable substitution
- `server/pce/graph/`: Pipeline graph, stage runner, retry and fallback
- `server/pce/contentRouter.ts`: Shared pipeline types
- `server/pce/verdict.ts`: Structural verdict (clean, repaired, fallback, failed)
- `server/pce/settings.ts`: Theme/style resolution
- `server/pce/modelInstructions.ts`: Model-specific prompt adaptation

**Integration Points**:
- `server/aiService.ts`: Runs the pipeline via `runPceGraph`
- `server/metrics.ts`: Tracks template load performance

### Relationships & Interactions

**Upstream Dependencies**:
- **AI Service**: Provides `TurnGenerationContext` and executes LLM calls
- **Reference System**: Supplies prompt templates and theme/style catalogs
- **Storage Layer**: Provides theme/style data from database
- **Game Logic**: Supplies game state and player actions

**Downstream Consumers**:
- **Turn Processor**: Uses PCE output to populate turn records
- **Image Processor**: Uses image prompt from PCE for scene generation
- **Game State**: Stores narration, image prompt, and actions in turn data

**Data Flow**:
```
Game State + User Preferences
    ↓
gatherTurnPromptIngredients()
    ↓
buildTurnGenerationContext()
    ↓
runPceGraph()
    ↓
[Master Stage] → MasterEnrichmentData
    ↓
[Narrative Stage] → NarrativePayload
    ↓
[Image Stage] + [Actions Stage] (parallel)
    ↓
FullTurnContentResult
    ↓
Persisted to game state
```

### Configurations & Parameters

**Reference Settings** (from `releases/current`):
- `pce_enabled`: Boolean flag controlling PCE vs legacy system
- `system_defaults.story_theme_key`: Default theme for new games
- `system_defaults.visual_style_key`: Default style for new games

**Template Configuration** (from database `prompts` table):
- `name`: Must match `pce_master`, `pce_narrative`, `pce_image`, or `pce_actions`
- `active`: Must be `1` for template to be used
- `inherit_global_prompt`: Boolean (default `1`) to inherit global system prompt
- `system_content`: System prompt content (required if not inheriting)
- `content`: User prompt content (required)

**Environment Variables**:
- None specific to PCE (uses AI Service configuration)

**Template Cache**:
- In-memory cache with no expiration (cleared on server restart)
- Cache cleared via `clearTemplateCache()` (primarily for testing)
- Metrics tracked per template: cache hits/misses, load duration

---

## Practical Guidance

### Step-by-Step: Understanding the Pipeline Flow

**1. Context Building**
```typescript
import { buildTurnGenerationContext } from './aiService';

const context = await buildTurnGenerationContext(
  gameState,
  playerAction,
  skillChecks,
  userPreferences,
  triggeredEvent,
  { intro: false }
);
```

**2. Pipeline Execution**
```typescript
import { runPceGraph } from './pce/graph';

// Published prompts, retry and fallback on, throws if any stage produced nothing
const result = await runPceGraph(context);

// The same turn on the Dev Tools drafts, returning partial results instead of throwing
const draft = await runPceGraph(context, { promptSource: "database", mode: "lenient" });
```

**3. Result Processing**
```typescript
// Access stage outputs
const narration = result.narrative.output?.narration;
const imagePrompt = result.image.output?.imagePrompt;
const actions = result.actions.output?.actions;

// Check for failures
if (!result.narrative.ok) {
  // Handle narrative stage failure
}

// Review execution metadata
result.promptChain.forEach(stage => {
  console.log(`${stage.stage}: ${stage.durationMs}ms`);
  if (stage.error) {
    console.error(`Error: ${stage.error}`);
  }
});
```

### Step-by-Step: Creating a Custom PCE Template

**1. Define Template Structure**
Create a new template file or database entry with:
- System prompt: Role definition, instructions, constraints
- User prompt: Variable placeholders for turn-specific data
- Documentation block: Purpose, inputs, outputs, requirements

**Example** (`server/pce/customPrompt.txt`):
```
<!-- PCE_TEMPLATE_DOC_START
PCE Custom Template
- PURPOSE: Generate custom content type
- OUTPUT: JSON { "customField": string }
- REQUIRED FIELD: customField
PCE_TEMPLATE_DOC_END -->
You are the CUSTOM STAGE of the PCE pipeline.

INPUT:
- Turn: {{TURN_NUMBER}}
- Action: {{PLAYER_ACTION}}

OUTPUT:
Return JSON: { "customField": "string" }
```

**2. Register Template in Reference System**
Add to `releases/current/data/prompts.json`:
```json
{
  "name": "pce_custom",
  "active": 1,
  "inherit_global_prompt": 1,
  "system_content": "Additional system instructions",
  "content": "User prompt with {{VARIABLES}}"
}
```

**3. Describe the Stage**

Add an entry to the `STAGES` table in `server/pce/graph/stages.ts` (and the stage name to `PromptStage` in `contentRouter.ts`). The shared `runStage` does the rest: prompt rendering, the model call, JSON reading, logging, metrics and tracing.

```typescript
custom: {
  maxTokens: 600,
  callMetadata: themeAndStyle,
  // Variables for the prompt, built from earlier stages' output
  variables: (context, upstream) =>
    buildCustomVariables(context, upstream.master, upstream.narrative),
  // Turn the parsed reply into the stage's output, or say why it is unusable
  validate: (parsed) => {
    if (!isObject(parsed) || typeof parsed.customField !== "string") {
      return { error: "Custom stage missing 'customField'" };
    }
    return { output: { customField: parsed.customField } };
  }
}
```

**4. Add It to the Graph**

In `server/pce/graph/graph.ts`: add a state channel (`customResult`), a node, and the edges that place it. A stage that needs only the narration can run beside `actions` and `image`:

```typescript
.addNode("custom", stageNode("custom"))
.addEdge("custom", END)
// and return "custom" from afterNarration() alongside "actions" and "image"
```

Then include its result in `runPceGraph`'s return value (`index.ts`) and add a case to `graph.test.ts`.

### Code Examples & Usage Patterns

**Pattern 1: Testing Individual Stages**
```typescript
import { buildTurnGenerationContext } from './aiService';
import { runPceGraph } from './pce/graph';

// Build context
const { context } = await buildTurnGenerationContext(...);

// Test master stage in isolation
const { master: masterResult } = await runPceGraph(context, { target: "master", mode: "lenient" });

if (masterResult.ok && masterResult.output) {
  console.log("Enrichment:", masterResult.output.enrichment);
  console.log("Flattened:", masterResult.output.flattened);
} else {
  console.error("Master stage failed:", masterResult.metadata);
}
```

**Pattern 2: Custom Variable Building**
```typescript
function buildCustomVariables(
  context: TurnGenerationContext,
  master: MasterEnrichmentData
): Record<string, unknown> {
  return {
    ...buildMasterVariables(context),
    MASTER_CONTEXT: master.flattened.MASTER_CONTEXT ?? {},
    CUSTOM_FIELD: computeCustomValue(context)
  };
}
```

**Pattern 3: Template Validation**
```typescript
import { buildPcePrompt, validateMetaPromptVariables } from './pce/promptBuilder';

const variables = { TURN_NUMBER: 5, HULL: 80 };
const template = await loadTemplate("master");

// Validate before building
const issues = validateMetaPromptVariables(template, variables);
if (issues.length > 0) {
  console.error("Validation issues:", issues);
  // issues: [{ placeholder: "{{MISSING}}", reason: "missing-variable", path: "MISSING" }]
}

// Build with validation enabled
const prompts = await buildPcePrompt("master", variables, { validate: true });
```

**Pattern 4: Template Metrics Monitoring**
```typescript
import { getTemplateLoadMetrics } from './pce/promptBuilder';

const metrics = getTemplateLoadMetrics();

console.log("Template Load Performance:");
console.log(`Total loads: ${metrics.totalLoads}`);
console.log(`Cache hits: ${metrics.cacheHits}`);
console.log(`Cache misses: ${metrics.cacheMisses}`);
console.log(`Hit rate: ${(metrics.cacheHits / metrics.totalLoads * 100).toFixed(1)}%`);

// Per-template breakdown
Object.entries(metrics.perTemplate).forEach(([name, stats]) => {
  console.log(`${name}: ${stats.cacheHits}/${stats.totalLoads} hits`);
});
```

### Best Practices & Guidelines

**1. Template Design**
- Keep system prompts focused on role and constraints
- Use user prompts for turn-specific context
- Document templates with metadata blocks (stripped before LLM delivery)
- Validate all placeholders before deployment
- Test templates with realistic variable sets

**2. Variable Naming**
- Use UPPER_SNAKE_CASE for top-level variables
- Use dot notation for nested properties: `{{THEME_OBJECT.label}}`
- Group related variables (e.g., `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`)
- Avoid variable name collisions between stages

**3. Stage Dependencies**
- Master stage must succeed before narrative stage
- Narrative stage must succeed before image/actions stages
- Image and actions stages can run in parallel (both depend on narrative, not each other)
- Always validate stage outputs before using in downstream stages

**4. Error Handling**
- Check `StageResult.ok` before accessing `output`
- Review `metadata` array for detailed error information
- Log full context when stages fail (gameId, turnNumber, error details)
- Implement fallback strategies for non-critical stages

**5. Performance Optimization**
- Template caching reduces file I/O (automatic)
- Reference system templates preferred over file-based (enables live updates)
- Parallel execution of independent stages (image + actions)
- Validate variables once, reuse validated sets

**6. Testing**
- Test each stage in isolation with mock contexts
- Test full pipeline with realistic game states
- Validate template variable coverage
- Monitor template load metrics for cache efficiency

---

## Troubleshooting & Support

### Common Issues & Solutions

**Issue: Template Not Found**
- **Symptoms**: Error: `"Failed to load prompt template 'X'"`
- **Causes**:
  - Template file missing from `server/pce/` directory
  - Template not registered in reference system with correct name
  - Template name mismatch (must match `pce_master`, `pce_narrative`, etc.)
- **Solutions**:
  1. Verify template file exists: `server/pce/masterPrompt.txt`
  2. Check reference system: `releases/current/data/prompts.json`
  3. Verify template name matches expected: `PCE_PROMPT_NAMES[templateName]`
  4. Ensure template `active` field is `1` in database

**Issue: Variable Placeholder Not Resolved**
- **Symptoms**: Error: `"Meta prompt validation failed: unresolved placeholders"`
- **Causes**:
  - Variable not provided in variable set
  - Nested property path incorrect
  - Variable is `null` or `undefined`
  - Variable is object when scalar expected
- **Solutions**:
  1. Run `validateMetaPromptVariables(template, variables)` to identify issues
  2. Check variable building functions (`buildMasterVariables`, etc.)
  3. Verify nested property paths match object structure
  4. Ensure required variables are populated before template building

**Issue: Master Stage Returns Invalid JSON**
- **Symptoms**: Error: `"JSON parse error: ..."` in master stage metadata
- **Causes**:
  - LLM returned malformed JSON
  - LLM wrapped JSON in markdown code fences
  - LLM included extra text before/after JSON
  - Required fields missing from JSON structure
- **Solutions**:
  1. Review raw response in `llm_logs` table
  2. Check template for JSON format instructions
  3. Verify `response_format: { type: "json_object" }` in LLM call
  4. Add post-processing to strip markdown if needed

**Issue: Narrative Stage Produces Wrong Length**
- **Symptoms**: Narration is too short (< 6 sentences) or too long (> 7 sentences)
- **Causes**:
  - Template instructions unclear about length requirement
  - LLM not following length constraints
  - Variable substitution affecting sentence count
- **Solutions**:
  1. Strengthen length requirement in template: "Exactly 6-7 sentences"
  2. Add example output showing correct length
  3. Post-process to split/merge sentences if needed
  4. Monitor output lengths and adjust template if consistently wrong

**Issue: Image Prompt Format Mismatch**
- **Symptoms**: Image prompt not compatible with selected model class
- **Causes**:
  - Model instructions not properly injected into template
  - LLM ignoring format requirements
  - Model class not recognized (falling back to transformer)
- **Solutions**:
  1. Verify `MODEL_STYLE_INSTRUCTIONS` variable populated correctly
  2. Check `buildModelInstructionSet()` returns correct format for model class
  3. Review image stage template for format instructions
  4. Validate model class in database matches expected values

**Issue: Actions Stage Returns Empty Array**
- **Symptoms**: `result.actions.output.actions` is empty array
- **Causes**:
  - LLM returned invalid action structure
  - Actions filtered out during normalization (missing required fields)
  - Template instructions unclear about action count
- **Solutions**:
  1. Check raw response in `llm_logs` for actions stage
  2. Verify action normalization logic in the `actions` entry of `STAGES` (`server/pce/graph/stages.ts`)
  3. Ensure template specifies minimum action count (e.g., "Provide 4 distinct actions")
  4. Review action validation: all fields (`action`, `summary`, `risk`, `intent`) must be present

### Error Messages & Meanings

**"Meta prompt validation failed: unresolved placeholders detected: {{X}}"**
- **Meaning**: Template contains placeholder that cannot be satisfied by provided variables
- **Action**: Add missing variable to variable building function or fix placeholder name

**"PCE turn generation failed: master stage failed"**
- **Meaning**: Master stage returned `ok: false` or missing enrichment output
- **Action**: Check master stage metadata for specific error, review LLM logs, verify template

**"PCE turn generation failed: narrative stage failed"**
- **Meaning**: Narrative stage failed after master stage succeeded
- **Action**: Check narrative stage metadata, verify narrative template, review master enrichment structure

**"Template 'X' exists in reference but has empty system or user content"**
- **Meaning**: Reference template found but content fields are empty
- **Action**: Populate `system_content` and `content` fields in reference data

**"Value 'X' for theme not found in catalog; using provided value"**
- **Meaning**: Theme/style selection not found in active catalog
- **Action**: Verify theme/style exists in database with `active=1`, check key/label spelling

### Debugging Tips & Strategies

**1. Enable Detailed Logging**
```typescript
// In aiService.ts stage handlers
console.log("[PCE] Stage starting", {
  gameId: context.gameId,
  turnNumber: context.turnNumber,
  variableKeys: Object.keys(variables)
});

console.log("[PCE] Stage completed", {
  ok: result.ok,
  outputKeys: result.output ? Object.keys(result.output) : [],
  metadataCount: result.metadata.length
});
```

**2. Inspect Template Variables**
```typescript
import { buildPcePrompt } from './pce/promptBuilder';

const variables = await context.promptVariables.master();
console.log("Master variables:", JSON.stringify(variables, null, 2));

const prompts = await buildPcePrompt("master", variables, { validate: true });
console.log("System prompt length:", prompts.system.length);
console.log("User prompt length:", prompts.user.length);
```

**3. Review Stage Metadata**
```typescript
const result = await runPceGraph(context);

result.promptChain.forEach((stage, index) => {
  console.log(`Stage ${index + 1}: ${stage.stage}`);
  console.log(`  Duration: ${stage.durationMs}ms`);
  console.log(`  Model: ${stage.model}`);
  console.log(`  Error: ${stage.error || 'none'}`);
  console.log(`  Fallback: ${stage.fallbackUsed || false}`);
  if (stage.rawResponse) {
    console.log(`  Response preview: ${stage.rawResponse.substring(0, 200)}`);
  }
});
```

**4. Query LLM Logs**
```sql
-- Find recent PCE stage failures
SELECT 
  function_name,
  metadata->>'stage' as stage,
  metadata->>'error' as error,
  execution_time_ms,
  created_at
FROM llm_logs
WHERE function_name LIKE 'pce.%'
  AND metadata->>'fallbackUsed' = 'true'
ORDER BY created_at DESC
LIMIT 20;

-- Analyze stage performance
SELECT 
  metadata->>'stage' as stage,
  COUNT(*) as total_calls,
  AVG(execution_time_ms) as avg_duration_ms,
  MAX(execution_time_ms) as max_duration_ms
FROM llm_logs
WHERE function_name LIKE 'pce.%'
GROUP BY stage;
```

**5. Test Template Loading**
```typescript
import { loadTemplate, getTemplateLoadMetrics } from './pce/promptBuilder';

// Test template load
const template = await loadTemplate("master");
console.log("Template loaded:", template.length, "characters");

// Check cache performance
const metrics = getTemplateLoadMetrics();
console.log("Cache performance:", metrics);
```

**6. Validate Variable Coverage**
```typescript
import { validateMetaPromptVariables, loadTemplate } from './pce/promptBuilder';

const template = await loadTemplate("master");
const variables = { /* your variable set */ };

const issues = validateMetaPromptVariables(template, variables);
if (issues.length > 0) {
  issues.forEach(issue => {
    console.error(`${issue.placeholder}: ${issue.reason} (path: ${issue.path})`);
  });
}
```

---

## Standards & Processes

### Quality Requirements & Criteria

**Template Quality**:
- All placeholders must be documented with expected variable names
- Templates must include output format specifications (JSON schema)
- Required fields must be clearly marked in template documentation
- Examples should demonstrate correct output format

**Stage Output Quality**:
- **Master**: All required fields present, guidance arrays contain 2-4 items
- **Narrative**: Exactly 6-7 sentences, theme-consistent, no markdown
- **Image**: Format matches model class, style-appropriate, under 120 tokens
- **Actions**: 4 distinct actions, summaries ≤18 words, balanced risks

**Pipeline Quality**:
- All stages must complete successfully (no `ok: false` results)
- Total pipeline execution time < 8 seconds (4 stages × ~2s each)
- Template cache hit rate > 90% (after warmup)
- Variable validation must pass before LLM calls

### Security Considerations

**Template Injection**:
- Variable substitution uses regex replacement, not eval
- User-provided content (player actions, interview responses) sanitized before variable building
- Template validation prevents undefined variable access

**Reference System Access**:
- Templates loaded from reference system (database) preferred over file system
- Reference data validated on load (active flags, content presence)
- Template cache prevents file system access on every call

**Error Information Leakage**:
- Stage metadata includes full error context (for debugging)
- LLM logs contain full prompts/responses (sensitive data)
- Ensure error messages don't expose internal structure to clients

### Performance Implications

**Template Loading**:
- **File System**: ~1-5ms per load (first load), ~0.1ms (cached)
- **Reference System**: ~5-10ms per load (database query), ~0.1ms (cached)
- **Cache Hit Rate**: Should be > 90% after initial warmup

**Pipeline Execution**:
- **Master Stage**: ~1-2 seconds (LLM call)
- **Narrative Stage**: ~1-2 seconds (LLM call)
- **Image Stage**: ~1-2 seconds (LLM call)
- **Actions Stage**: ~1-2 seconds (LLM call)
- **Total Sequential**: ~4-8 seconds
- **With Parallelization**: ~3-6 seconds (image + actions in parallel)

**Optimization Opportunities**:
- Cache master enrichment for similar game states (future enhancement)
- Batch variable building operations
- Preload templates on server startup
- Use reference system templates (enables live updates without code deployment)

**Database Load**:
- Template loading: Minimal (cached after first load)
- Theme/style resolution: 2 queries per turn (themes + styles)
- LLM logging: ~1-5KB per stage call (4 stages = ~4-20KB per turn)

### Testing & Validation Approaches

**Unit Testing**:
- Test template loading (file and reference system)
- Test variable substitution with various input types
- Test placeholder validation
- Test model instruction building
- Test master enrichment flattening

**Integration Testing**:
- Test individual stage execution with mock contexts
- Test stage dependency chain (master → narrative → image/actions)
- Test error propagation through pipeline
- Test parallel execution of image + actions stages

**End-to-End Testing**:
- Test full pipeline with realistic game states
- Test theme/style resolution and application
- Test model class adaptation (flux, transformer, diffuser)
- Test template fallback (reference → file system)

**Performance Testing**:
- Measure template load times (cache hit/miss)
- Measure pipeline execution times per stage
- Monitor cache hit rates over time
- Track LLM call durations and error rates

**Example Test Structure**:
```typescript
describe('PCE Pipeline', () => {
  describe('Template Loading', () => {
    it('should load template from file system', async () => {
      const template = await loadTemplate('master');
      expect(template).toContain('Your Role:');
    });
    
    it('should cache template after first load', async () => {
      await loadTemplate('master');
      const metrics = getTemplateLoadMetrics();
      expect(metrics.cacheHits).toBeGreaterThan(0);
    });
  });
  
  describe('Variable Substitution', () => {
    it('should substitute scalar variables', () => {
      const template = 'Turn {{TURN_NUMBER}}';
      const variables = { TURN_NUMBER: 5 };
      const result = renderTemplateString(template, variables);
      expect(result).toBe('Turn 5');
    });
    
    it('should substitute nested properties', () => {
      const template = 'Theme: {{THEME_OBJECT.label}}';
      const variables = { THEME_OBJECT: { label: 'Cosmic Horror' } };
      const result = renderTemplateString(template, variables);
      expect(result).toBe('Theme: Cosmic Horror');
    });
  });
  
  describe('Pipeline Execution', () => {
    it('should execute all stages successfully', async () => {
      const { context } = await buildTurnGenerationContext(...);
      const result = await runPceGraph(context);
      
      expect(result.master.ok).toBe(true);
      expect(result.narrative.ok).toBe(true);
      expect(result.image.ok).toBe(true);
      expect(result.actions.ok).toBe(true);
    });
  });
});
```

---

## Visual Aids

### Recommended Diagrams

**1. PCE Pipeline Flow Diagram**
```
┌─────────────────────────────────────────────────────────┐
│              TurnGenerationContext                      │
│  (Game State + Preferences + Variables)                │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 1: Master           │
        │   Input: All variables      │
        │   Output: Enrichment        │
        │   Duration: ~1-2s           │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 2: Narrative        │
        │   Input: Master + State     │
        │   Output: Narration          │
        │   Duration: ~1-2s           │
        └──────────────┬──────────────┘
                       │
        ┌──────────────┬──────────────┐
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐
│ Stage 3:     │ │ Stage 4:    │
│ Image        │ │ Actions     │
│ Input: Master│ │ Input: Master│
│ + Narrative  │ │ + Narrative │
│ Output: Image│ │ Output:     │
│ Prompt       │ │ Actions[]   │
│ Duration:    │ │ Duration:   │
│ ~1-2s        │ │ ~1-2s       │
└──────────────┘ └─────────────┘
```

**2. Variable Resolution Hierarchy**
```
Master Variables (base layer)
    ├─ Game State (TURN_NUMBER, DAY, SEGMENT, STATS)
    ├─ Player Context (ACTION, CHECKS, EVENT)
    ├─ Equipment (ITEMS, NPCS)
    └─ Creative (THEME, STYLE, MODEL)
         ↓
Master Enrichment (from Stage 1)
    ├─ MASTER_CONTEXT.*
    ├─ MASTER_VARIABLES.*
    └─ MASTER_GUIDANCE.*
         ↓
Narrative Variables (Stage 2)
    ├─ Inherits Master Variables
    ├─ Inherits Master Enrichment
    └─ Game State (for narrative-specific)
         ↓
Image Variables (Stage 3)
    ├─ Inherits Master Variables
    ├─ Inherits Master Enrichment
    ├─ NARRATION (from Stage 2)
    └─ Model Instructions
         ↓
Actions Variables (Stage 4)
    ├─ Subset of Master Variables
    ├─ Inherits Master Enrichment
    └─ CURRENT_NARRATIVE (from Stage 2)
```

**3. Template Loading Strategy**
```
Template Request (templateName)
         │
         ├─ Try Reference System
         │   ├─ Query: prompts.name = 'pce_{templateName}'
         │   ├─ Check: active = 1
         │   ├─ Load: system_content + content
         │   └─ Return: { system, user }
         │
         └─ Fallback to File System
             ├─ Path: server/pce/{templateName}Prompt.txt
             ├─ Load: File content
             ├─ Strip: Documentation blocks
             └─ Return: { system: content, user: '' }
         │
         └─ Cache Result (in-memory)
             └─ Return cached on subsequent requests
```

**4. Model Instruction Adaptation**
```
Image Model Class
         │
         ├─ "flux"
         │   └─ Format: 2-4 sentence fragments (20-40 words)
         │       Single string prompt
         │
         ├─ "transformer"
         │   └─ Format: 2-3 flowing sentences (25-45 words)
         │       Single string prompt
         │
         ├─ "diffuser"
         │   └─ Format: Comma-separated tags (40-80 words)
         │       Object: { positive, negative }
         │
         └─ "fallback" (unrecognized)
             └─ Format: Transformer format (default)
```

---

## Cross-References

### Related Documentation

- **AI Service**: See `docs_master/current/AI_SERVICE.md` for PCE integration and usage
- **System Overview**: See `docs_master/current/GAME_PAGE_ARCHITECTURE.md` for game flow context
- **Agent Architecture**: See `AGENTS.md` for agent responsibilities
- **Legacy Comparison**: See `docs_master/.retired_docs/PCE_COMPARISON.md` for PCE vs legacy differences
- **Technical Audit**: See `docs_master/.retired_docs/PCE_TECHNICAL_AUDIT.md` for detailed implementation notes

### Dependencies

**Required Modules**:
- `server/aiService.ts`: Provides stage execution functions and LLM calling
- `server/reference/referenceLoader.ts`: Template and catalog data access
- `server/storage.ts`: Theme/style database queries
- `server/metrics.ts`: Performance instrumentation

**Consumed By**:
- `server/aiService.ts`: Runs the pipeline via `runPceGraph`
- `server/pce/inspectorService.ts`, `server/evals/runner.ts`: Run it on saved scenarios
- `server/gameInitialization.ts`: Resolves PCE selections for new games

### API Surface

**Public Functions** (exported from `server/pce/`):

**promptBuilder.ts**:
- `buildPcePrompt(templateName, variables, options)`: Builds system/user prompt pair, plus `template: { name, source, hash }` identifying the exact template version used
- `loadTemplate(templateName)`: Loads template from file system
- `validateMetaPromptVariables(template, variables)`: Validates placeholders
- `flattenMasterEnrichment(enrichment)`: Transforms master output
- `getTemplateLoadMetrics()`: Returns cache performance metrics
- `clearTemplateCache()`: Clears template cache (testing)

**graph/index.ts**:
- `runPceGraph(context, options)`: Runs the pipeline, whole or in part
- `withRecovery(stage, context, run)`: Retry and fallback for one stage

**contentRouter.ts**:
- Types only: `StageResult`, `StageMetadata`, `TurnGenerationContext`, `FullTurnContentResult`, stage payloads

**settings.ts**:
- `resolvePceSelections(overrides)`: Resolves theme/style pair
- `getPceDefaults()`: Retrieves system defaults

**modelInstructions.ts**:
- `buildModelInstructionSet(modelClass)`: Returns model-specific instructions

**Internal Functions** (not exported, but important):
- `loadPcePromptFromReference()`: Loads template from reference system
- `loadTemplateInternal()`: File system template loading with caching
- `renderTemplateString()`: Variable substitution engine
- `getNestedValue()`: Nested property access helper

---

## Appendix: Key Data Structures

### TurnGenerationContext
```typescript
interface TurnGenerationContext {
  state: GameState;
  gameId: string;
  turnNumber: number;
  intro?: boolean;
  playerAction: string;
  checks: unknown[];
  userPreferences: {
    theme?: string;
    style?: string;
    imageModelKey?: string;
    skipImageCache?: boolean;
  };
  triggeredEvent?: { name: string; segment: string; skill: string } | null;
  promptVariables: {
    master: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    narrative: (enrichment: MasterEnrichmentData) => Promise<Record<string, unknown>> | Record<string, unknown>;
    image: (enrichment: MasterEnrichmentData, narrative: NarrativePayload) => Promise<Record<string, unknown>> | Record<string, unknown>;
    actions: (enrichment: MasterEnrichmentData, narrative: NarrativePayload) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  selections: {
    theme: string;
    style: string;
    imageModelKey: string;
  };
  extras?: Record<string, unknown>;
}
```

### StageResult
```typescript
interface StageResult<T> {
  ok: boolean;                    // Stage execution success
  output: T | null;               // Stage output payload
  metadata: StageMetadata[];     // Execution metadata
}
```

### StageMetadata
```typescript
interface StageMetadata {
  stage: "master" | "narrative" | "image" | "actions";
  template: string;               // Template name used
  model?: string;                 // LLM model used
  prompt?: string;                // Full prompt sent to LLM
  rawResponse?: string | null;    // Raw LLM response
  fallbackUsed?: boolean;         // Whether fallback was used
  error?: string;                 // Error message if failed
  durationMs?: number;            // Execution time
  timestamp: string;              // ISO timestamp
  extras?: Record<string, unknown>; // Additional metadata
}
```

### MasterEnrichmentData
```typescript
interface MasterEnrichmentData {
  enrichment: Record<string, unknown> | null;  // Full master output
  flattened: FlattenedMasterEnrichment;        // Flattened for variable access
}

interface FlattenedMasterEnrichment {
  MASTER_CONTEXT?: Record<string, unknown>;
  MASTER_VARIABLES?: Record<string, unknown>;
  MASTER_GUIDANCE?: Record<string, unknown>;
  MASTER_ENRICHMENT?: Record<string, unknown>;
}
```

### SeparatedPrompts
```typescript
interface SeparatedPrompts {
  system: string;  // System prompt (role, instructions)
  user: string;     // User prompt (context, variables)
}
```

---

**Document Status**: Complete  
**Maintainer**: Engineering Team  
**Review Cycle**: Quarterly or when major changes occur
