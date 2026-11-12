# Main Story System

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** January 2025  
**Primary Modules:** `server/gameLogic.ts`, `server/gameEngine.ts`, `server/orchestrator/workers/`, `server/pce/`

---

## Context & Overview

### What is the Main Story System?

The Main Story System is the unified architecture that drives Quest to Uranus's narrative gameplay. It combines four interconnected subsystems:

1. **Game Turn**: The atomic unit of gameplay—each turn represents a player action, skill check resolution, narrative generation, and state update
2. **Story Beat** (also called **Game Beat**): Procedural narrative moments triggered by game state conditions, manifesting as Events that create skill challenges and running gags
3. **Narrative Arc**: The overarching journey structure progressing through Segments, providing thematic progression, escalating difficulty, and win/loss conditions
4. **Prompt Composition Engine (PCE)**: The multi-stage pipeline that generates synchronized narrative text and image prompts based on turn context, beats, and arc progression

### Why They Exist Together

These systems create a cohesive gameplay experience where:

- **Game Turns** provide the mechanical foundation for player agency and deterministic state management
- **Story Beats** inject procedural variety and memorable moments without requiring hand-authored content for every possible state
- **Narrative Arc** ensures the journey feels structured and progressive, preventing aimless wandering while maintaining replayability
- **PCE** generates thematically consistent, synchronized narrative and visual content that responds to all three systems

### Purpose Within the Larger System

The Main Story System sits at the core of Quest to Uranus's gameplay loop:

```
Player Action
     ↓
Game Turn Processing
     ↓
┌─────────────────┬──────────────────┐
│  Story Beat     │  Narrative Arc   │
│  (Event Check)  │  (Segment Gate)  │
└────────┬────────┴────────┬─────────┘
         ↓                 ↓
    Skill Check      Thematic Context
         ↓                 ↓
    Stat Changes    Difficulty Scaling
         ↓                 ↓
    PCE Pipeline    PCE Theme/Style
    ┌──────────┐    ┌──────────────┐
    │  Master  │    │ Segment/Beat │
    │  Stage   │    │   Context    │
    └────┬─────┘    └──────┬───────┘
         ↓                 ↓
    ┌──────────┐    ┌──────────────┐
    │Narrative │    │    Image      │
    │  Stage   │    │    Stage      │
    └────┬─────┘    └──────┬───────┘
         ↓                 ↓
    Turn Record      Running Gags
```

**Integration Points**:
- **Turn Processor Agent**: Executes turn logic via `processTurnLogic()` in `server/gameLogic.ts`
- **Game Engine**: Evaluates events via `getTriggeredEvents()` and calculates segment progression via `getSegment()`
- **PCE Pipeline**: Uses segment/event context to generate thematically consistent narrative and images
- **Reference System**: Stores events, segments, and narrative templates as versioned content

---

## Technical Details

### Components, Structure, and Architecture

#### 1. Game Turn Architecture

**Two-Phase Processing Pattern**:

The turn system uses a **precompute → apply** pattern to optimize database transactions:

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: Precompute (OUTSIDE Transaction)              │
│  ─────────────────────────────────────────────────────  │
│  1. Load game state (read-only)                         │
│  2. Compute deterministic checks                        │
│  3. Evaluate story beat triggers                        │
│  4. Generate LLM content via PCE pipeline               │
│  5. Check image cache                                   │
│  6. Persist manifest to database                        │
│  7. Enqueue to turn-apply queue                        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: Apply (INSIDE Transaction)                    │
│  ─────────────────────────────────────────────────────  │
│  1. Lock game row (FOR UPDATE)                          │
│  2. Rehydrate manifest                                  │
│  3. Apply precomputed state changes                     │
│  4. Update turn number, day, segment                    │
│  5. Apply stat deltas (action + consumption)            │
│  6. Check win/loss conditions                           │
│  7. Commit transaction                                  │
│  8. Emit WebSocket notification                         │
└─────────────────────────────────────────────────────────┘
```

**Key Components**:

- **TurnPrecomputeWorker** (`server/orchestrator/workers/turnPrecomputeWorker.ts`): Leases jobs from `turn-precompute` queue, executes deterministic checks, evaluates story beats, calls PCE pipeline, persists manifest
- **TurnApplyWorker** (`server/orchestrator/workers/turnApplyWorker.ts`): Leases jobs from `turn-apply` queue, applies precomputed data within transaction, emits completion events
- **processTurnLogic()** (`server/gameLogic.ts:692`): Core turn processing function that applies state changes, advances day/segment, records turn history
- **computeTurnChecks()** (`server/gameLogic.ts:200`): Deterministic skill check computation using seeded random number generation

**Turn Data Structure**:

```typescript
interface Turn {
  turnNumber: number;              // Sequential turn counter (1, 2, 3, ...)
  action?: string;                 // Player action text
  narrative: string;               // 6-7 sentence AI-generated story (from PCE)
  checks: Check[];                 // Skill check results
  delta: DeltaChange[];            // Stat changes (action + consumption)
  timestamp: number;               // Unix timestamp
  imagePrompt?: string;            // PCE-generated image prompt
  imageUrl?: string;               // Cached/generated image URL
  promptChain?: PromptChainStage[]; // PCE pipeline metadata
  masterEnrichment?: Record<string, unknown>; // PCE master stage output
  theme?: string;                  // Active story theme
  style?: string;                  // Active visual style
}
```

**Turn Processing Flow**:

1. Client sends action via `POST /api/game/action`
2. Route handler creates `TurnJob` and enqueues to `turn-precompute`
3. `TurnPrecomputeWorker` claims job, computes checks, evaluates story beats
4. Precompute worker calls PCE pipeline with turn context (state, beat, arc)
5. PCE generates narrative, image prompt, and actions
6. Precompute worker persists manifest and enqueues to `turn-apply`
7. `TurnApplyWorker` claims job, applies changes in transaction
8. Apply worker emits `turnComplete` WebSocket event
9. Client receives notification and refreshes game state

#### 2. Story Beat Architecture

**Event System**:

Story beats (also called game beats) are implemented as **Events** stored in the reference system and evaluated each turn:

```typescript
interface EventDefinition {
  id: string;                      // UUID for running gag tracking
  name: string;                    // Display name (e.g., "Asteroid Belt Surprise")
  segment: Segment | 'Any';        // When it can trigger
  tags: string[];                  // Categorization (technical, crew, absurd, etc.)
  triggerCondition: TriggerCondition; // JSON condition tree
  skill: Skill;                    // Skill tested (Engineering, Piloting, etc.)
  dc: number;                      // Base Difficulty Class (8-18)
  passEffect: string;              // Delta string on success (e.g., "hull+5,morale+2")
  failEffect: string;              // Delta string on failure (e.g., "hull-10,oxygen-5")
  active: boolean;                  // Enable/disable flag
}
```

**Trigger Condition Types**:

Events use a discriminated-union JSON structure for flexible triggering:

- **Stat-Based**: `{ type: 'stat', stat: 'hull', operator: '<', value: 50 }`
- **Time-Based**: `{ type: 'day_modulo', divisor: 3, remainder: 0 }`
- **Random**: `{ type: 'random', chance: 0.25 }`
- **Compound OR**: `{ type: 'or', conditions: [...] }`
- **Compound AND**: `{ type: 'and', conditions: [...] }`

**Event Evaluation Flow**:

```typescript
// Called each turn in computeTurnChecks()
const triggeredEvents = await getTriggeredEvents(state);

// getTriggeredEvents filters by:
// 1. Segment match (event.segment === state.segment || event.segment === 'Any')
// 2. Active flag (event.active === true)
// 3. Trigger condition evaluation (evaluateTriggerCondition())

// First triggered event is selected
const selectedEvent = triggeredEvents[0] || null;
```

**Running Gags**:

When an event triggers and has an `id`, its name is added to `state.runningGags[]` (if not already present). The PCE pipeline receives up to 3 running gags via `{{RUNNING_GAGS}}` variable, enabling narrative callbacks:

```typescript
// In processTurnLogic()
if (event && event.id && !state.runningGags.includes(event.name)) {
  state.runningGags.push(event.name);
}
```

**Story Beat → PCE Integration**:

1. Event triggers → Creates skill check with event's skill/DC
2. Check resolves → Applies pass/fail effect to stats
3. Event name passed to PCE via `{{ACTIVE_EVENT}}` variable
4. Running gags passed to PCE via `{{RUNNING_GAGS}}` variable
5. PCE master stage receives beat context and weaves it into enrichment
6. PCE narrative stage incorporates event into story naturally
7. Event name added to running gags for future callbacks

#### 3. Narrative Arc Architecture

**Segment Progression**:

The narrative arc is defined by **Segments** that gate content and provide thematic progression:

```typescript
type Segment =
  | 'Launch from Earth'      // Day 1
  | 'Moon Flyby'             // Day 2
  | 'Onto to Mars'           // Days 3-4
  | 'Asteroid Belt'          // Day 5
  | 'Jupiter & Saturn'       // Days 6-7
  | 'Outer Darkness'         // Days 8-10
  | 'Approaching Uranus'     // Days 11-12
  | 'Arrival on Uranus'      // Day 12 (finale)
  | 'Lost';                  // Fallback
```

**Segment Calculation**:

```typescript
// In server/gameEngine.ts:244
export function getSegment(day: number): Segment {
  if (day == 1) return 'Launch from Earth';
  if (day == 2) return 'Moon Flyby';
  if (day <= 4) return 'Onto to Mars';
  if (day == 5) return 'Asteroid Belt';
  if (day <= 7) return 'Jupiter & Saturn';
  if (day <= 10) return 'Outer Darkness';
  if (day < 12) return 'Approaching Uranus';
  if (day === 12) return 'Arrival on Uranus';
  return 'Lost';
}
```

**Day Advancement**:

Days advance every 2 turns (even-numbered turn numbers):

```typescript
// In processTurnLogic()
if (state.turnNumber % 2 === 0) {
  state.day++;
  state.segment = getSegment(state.day);
  // Apply daily resource consumption
  const { deltaString: consumptionDelta } = calculateDailyConsumption(equippedItems);
  applyDelta(state.stats, consumptionDelta);
}
```

**Difficulty Scaling**:

DC (Difficulty Class) increases with turn number and low morale:

```typescript
// In server/gameEngine.ts:257
export function calculateDC(baseDC: number, turnNumber: number, morale: number): number {
  let dc = baseDC;
  
  // DC increases by 1 every 3 turns (turn 3, 6, 9, 12, etc.)
  const turnIncrease = Math.floor(turnNumber / 3);
  dc += turnIncrease;
  
  // Low morale (below 30) makes checks harder
  if (morale < 30) {
    dc += 1;
  }
  
  return dc;
}
```

**Arc Progression Mechanics**:

- **Early Arc** (Days 1-4): Bureaucratic comedy, resource building, crew establishment
- **Mid Arc** (Days 5-7): Slapstick danger, asteroid dodging, crew dynamics
- **Late Arc** (Days 8-10): Cosmic horror comedy, isolation, weirdness spikes
- **Finale** (Days 11-12): Approach tension, arrival celebration, win condition check

**Win/Loss Conditions**:

```typescript
// Win: Day 12, segment 'Arrival on Uranus', any stat ≥ 30
export function checkWinCondition(state: GameState): boolean {
  return state.day >= 12 && 
         state.segment === 'Arrival on Uranus' &&
         (state.stats.hull >= 30 || state.stats.oxygen >= 30 ||
          state.stats.fuel >= 30 || state.stats.food >= 30 ||
          state.stats.morale >= 30);
}

// Loss: Any critical stat reaches 0 or weirdness ≥ 5
export function checkFailState(stats: GameStats): string | null {
  if (stats.hull <= 0) return "Ship folded into modern art.";
  if (stats.oxygen <= 0) return "Everyone discovers mindfulness too late.";
  if (stats.morale <= 0) return "Crew quits to start a space bakery.";
  if (stats.weirdness >= 5) return "Cosmic HR freezes reality for an audit.";
  return null;
}
```

**Narrative Arc → PCE Integration**:

- Segment passed to PCE via `{{SEGMENT}}` variable
- Day passed via `{{DAY}}` variable
- Arc phase (early/mid/late/finale) influences PCE master stage enrichment
- Segment-specific themes/styles guide PCE narrative tone
- Difficulty scaling affects skill check DCs used in PCE context

#### 4. Prompt Composition Engine (PCE) Architecture

**Sequential Pipeline Architecture**:

The PCE follows a **sequential pipeline architecture** with four distinct stages:

```
┌─────────────────────────────────────────────────────────┐
│         ContentGenerationRouter                          │
│  (Orchestrates stage execution and error handling)      │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 1: Master           │
        │   Generate Enrichment        │
        │   Input: Game State, Beat,  │
        │          Arc, Theme, Style   │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 2: Narrative        │
        │   Generate Story Text       │
        │   Input: Master + State     │
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

**PCE Integration with Main Story System**:

The PCE receives comprehensive context from all three subsystems:

**From Game Turn**:
- `TURN_NUMBER`: Current turn counter
- `PLAYER_ACTION`: Player's chosen action
- `CHECKS`: Skill check results
- `STATS`: Current ship statistics (hull, oxygen, fuel, food, morale, weirdness)

**From Story Beat**:
- `ACTIVE_EVENT`: Currently triggered event name (if any)
- `RUNNING_GAGS`: Up to 3 previously triggered events for callback humor
- Event context influences master stage enrichment

**From Narrative Arc**:
- `DAY`: Current day (1-12)
- `SEGMENT`: Current segment name
- Segment context guides thematic consistency
- Arc phase influences narrative tone

**Core Components**:

#### 1. **Content Generation Router** (`contentRouter.ts`)

The router orchestrates the entire pipeline execution:

**Responsibilities**:
- Stage sequencing and dependency management
- Error handling and metadata aggregation
- Parallel execution of independent stages (Image + Actions)
- Result validation and fallback coordination

**Key Methods**:
- `generateFullTurnContent(context)`: Executes complete pipeline
- `generateMasterEnrichment(context)`: Stage 1 execution
- `generateNarrative(context, master)`: Stage 2 execution
- `generateImagePrompt(context, master, narrative)`: Stage 3 execution
- `generateActions(context, master, narrative)`: Stage 4 execution

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
- `buildPcePrompt(templateName, variables, options)`: Builds system/user prompt pair
- `loadPceTemplate(templateName)`: Loads template from reference or file
- `validateMetaPromptVariables(template, variables)`: Validates all placeholders
- `renderTemplateString(template, variables, options)`: Performs substitution

#### 3. **Settings Resolver** (`settings.ts`)

Resolves theme and style selections from user preferences and defaults:

**Resolution Strategy**:
1. Check user-provided overrides (`userPreferences.theme`, `userPreferences.style`)
2. Fall back to system defaults (`system_defaults.story_theme_key`, `system_defaults.visual_style_key`)
3. Validate selections exist in active catalogs
4. Match by `storyThemeKey`/`visualStyleKey` or `label` (case-insensitive)
5. Return normalized `label` values for use in prompts

#### 4. **Model Instructions** (`modelInstructions.ts`)

Adapts image prompt generation to specific model classes:

**Supported Model Classes**:
- **Flux**: Natural language sentences (2-4 fragments, 20-40 words)
- **Transformer**: Flowing narrative sentences (2-3 sentences, 25-45 words)
- **Diffuser**: Comma-separated tags with weights (40-80 words positive, 10-25 words negative)
- **Fallback**: Defaults to transformer format when class unrecognized

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
- Must reference `ACTIVE_EVENT` if present
- Must incorporate `RUNNING_GAGS` for callback humor
- No markdown, no JSON-in-JSON, no apologies

**Thematic Anchoring**:
- Primary weight: `THEME_OBJECT.label` and `THEME_OBJECT.narratorTemplate`
- All narrative choices should reinforce theme motif
- Honor narrator persona specified in theme
- Segment context influences tone (bureaucratic early, cosmic late)

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

### Variable Supply Chain

| Layer | Responsibility | Implementation |
| --- | --- | --- |
| **Turn Prompt Ingredients** | Pulls together `GameState`, DB lookups (themes, styles, image models), player-preference overrides, and formatted summaries (checks, NPCs, running gags). | `gatherTurnPromptIngredients` in `server/aiService.ts:411-557` |
| **Stage Variable Builders** | `buildMasterVariables`, `buildNarrativeVariables`, `buildImageVariables`, `buildActionsVariables` expose stage-specific maps, ensuring nested objects (`THEME_OBJECT`, `MASTER_CONTEXT`, etc.) always contain the fields templates expect. | `server/aiService.ts:560-689` |
| **Validation + Rendering** | `buildPcePrompt()` performs placeholder validation (when `validate: true`) via `validateMetaPromptVariables`, renders templates, and emits separated system/user prompts. | `server/pce/promptBuilder.ts:271-495` |
| **Enrichment Flattening** | `flattenMasterEnrichment()` normalizes the master JSON into `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`, `MASTER_GUIDANCE.*` for downstream reuse. | `server/pce/promptBuilder.ts:502-531` |

#### Data Flow
1. **Ingredients Gathered:** Before any stage runs, the router calls `gatherTurnPromptIngredients` to hydrate theme/style selections, equipped item metadata, model instructions, recent turn snippets, interview summaries, **story beat context** (`ACTIVE_EVENT`, `RUNNING_GAGS`), and **narrative arc context** (`SEGMENT`, `DAY`).
2. **Base Variables Built:** Master stage receives the shared map (`TURN_NUMBER`, ship vitals, creative selections, formatted strings, **beat and arc context**). These keys are upper-snake-case by convention to stay readable inside prompts.
3. **Enrichment Propagated:** After master completes, `flattenMasterEnrichment` exposes nested context/guidance blocks so later stages can access `{{MASTER_GUIDANCE.image}}`, `{{MASTER_CONTEXT.turnMoment}}`, etc.
4. **Narrative Echo:** Image and action stages receive `NARRATION` / `CURRENT_NARRATIVE`, tone hints, and style modifiers so they stay synchronized with the latest prose.
5. **Template Validation:** `buildPcePrompt` validates every placeholder before calling the LLM, ensuring undefined variables never leak into production prompts.

### Technologies, Tools, and Frameworks

**Core Technologies**:
- **TypeScript**: Type-safe turn processing and state management
- **PostgreSQL**: Transactional game state storage with row-level locking
- **Socket.IO**: Real-time turn completion notifications
- **LLM APIs** (OpenAI): Narrative and content generation via PCE pipeline
- **Seeded Random**: Deterministic skill check rolls using `(seed, day, intent)` tuple

**Key Libraries**:
- **Express**: HTTP routing for turn action endpoints
- **Zod**: Schema validation for turn inputs and state
- **Orchestrator Pattern**: Job queue system for async turn processing
- **Node.js File System** (`fs/promises`): Template file loading
- **Performance API** (`perf_hooks`): Template load timing

### Relationships and Interactions

**Turn ↔ Beat Relationship**:
- Turns evaluate events each cycle → Events create beats → Beats influence narrative
- Events trigger skill checks → Checks affect stats → Stats influence future event triggers
- Running gags accumulate across turns → PCE references gags in narrative → Narrative feels continuous

**Turn ↔ Arc Relationship**:
- Turns advance day counter (every 2 turns) → Days determine segment → Segments gate events
- Segment provides thematic context → PCE uses segment in prompts → Narrative matches arc phase
- Difficulty scales with turn number → Later turns feel more challenging → Arc feels progressive

**Beat ↔ Arc Relationship**:
- Events are segment-gated → Early segments have bureaucratic events → Late segments have cosmic horror events
- Arc progression unlocks new event types → Players experience variety → Replayability increases
- Running gags span segments → Callbacks create continuity → Arc feels cohesive

**Main Story System ↔ PCE Relationship**:
- Turn context (action, checks, stats) → PCE master stage → Enrichment
- Story beat context (active event, running gags) → PCE master stage → Narrative callbacks
- Arc context (segment, day, phase) → PCE master stage → Thematic consistency
- Master enrichment → PCE narrative stage → 6-7 sentence story
- Narrative + enrichment → PCE image stage → Synchronized image prompt
- Narrative + enrichment → PCE actions stage → Context-aware action choices

### Configurations and Parameters

**Turn Configuration**:
- **Day Advancement**: Every 2 turns (`state.turnNumber % 2 === 0`)
- **Daily Consumption**: Applied on day advancement, calculated from equipped items
- **Skill Check Seeding**: `(state.seed, state.day, intent)` ensures reproducibility
- **DC Scaling**: Base DC + `Math.floor(turnNumber / 3)` + (morale < 30 ? 1 : 0)

**Event Configuration**:
- **Trigger Evaluation**: Every turn, before skill check computation
- **Event Selection**: First triggered event wins (no priority system)
- **Running Gag Limit**: Up to 3 gags passed to PCE (via `state.runningGags.slice(0, 3)`)
- **Segment Gating**: Events with `segment: 'Any'` can trigger in any segment

**Arc Configuration**:
- **Segment Boundaries**: Defined in `getSegment()` function (day-based)
- **Win Condition**: Day 12, segment 'Arrival on Uranus', any stat ≥ 30
- **Loss Conditions**: Hull/Oxygen/Morale ≤ 0, or Weirdness ≥ 5
- **Session Length**: 8-12 turns (≈10-12 minutes) targeting snackable gameplay

**PCE Configuration**:
- **Reference Settings** (from `releases/current`):
  - `pce_enabled`: Boolean flag controlling PCE vs legacy system
  - `system_defaults.story_theme_key`: Default theme for new games
  - `system_defaults.visual_style_key`: Default style for new games
- **Template Configuration** (from database `prompts` table):
  - `name`: Must match `pce_master`, `pce_narrative`, `pce_image`, or `pce_actions`
  - `active`: Must be `1` for template to be used
  - `inherit_global_prompt`: Boolean (default `1`) to inherit global system prompt
  - `system_content`: System prompt content (required if not inheriting)
  - `content`: User prompt content (required)

---

## Practical Guidance

### Step-by-Step Instructions

#### Processing a Complete Turn with All Systems

**1. Turn Initiation**:
```typescript
// In route handler (server/routes.ts)
app.post('/api/game/action', async (req, res) => {
  const { gameId, action, customText } = req.body;
  
  // Create turn job (auto-enqueues to turn-precompute)
  const job = await storage.createTurnJob({
    gameId,
    actionPayload: { gameId, action, customText }
  });
  
  // Return immediately (async processing)
  res.json({ turnJobId: job.id, status: 'processing' });
});
```

**2. Precompute Phase**:
```typescript
// In TurnPrecomputeWorker
// 1. Load game state
const currentState = await storage.getGameState(job.gameId);

// 2. Evaluate story beats
const triggeredEvents = await getTriggeredEvents(currentState);
const selectedEvent = triggeredEvents[0] || null;

// 3. Compute skill checks (including event check if event triggered)
const computed = await computeTurnChecks(currentState, action);

// 4. Build PCE context with all story system data
const context = await buildTurnGenerationContext(
  currentState,
  action,
  computed.checks,
  userPreferences,
  selectedEvent ? { 
    name: selectedEvent.name, 
    segment: selectedEvent.segment, 
    skill: selectedEvent.skill 
  } : null,
  { intro: false }
);

// 5. Generate content via PCE pipeline
const router = new ContentGenerationRouter({
  master: runMasterStage,
  narrative: runNarrativeStage,
  image: runImageStage,
  actions: runActionsStage
});
const turnContent = await router.generateFullTurnContent(context);

// 6. Persist manifest and enqueue to turn-apply
await storage.updateTurnJob(job.id, { manifestData: manifest });
await orchestrator.enqueue({ queue: 'turn-apply', payload: { id: job.id } });
```

**3. Apply Phase**:
```typescript
// In TurnApplyWorker
const updatedState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
  return await processTurnLogic(state, action, {
    turnContent,
    actions: precomputedActions,
    checks: computed.checks,
    selectedAction: computed.selectedAction,
    event: computed.event,
    skill: computed.skill,
    success: computed.success,
    userPreferences
  });
});

// Emit completion
this.io.to(job.gameId).emit('turnComplete', { 
  gameId: job.gameId, 
  turnNumber: updatedState.turnNumber 
});
```

#### Creating a New Story Beat (Event)

1. **Access Dev Tools**: Navigate to `/dev` in the application
2. **Open Events Tab**: Click "Events" in the Dev Tools interface
3. **Create New Event**:
   - **Name**: Descriptive display name (e.g., "Cosmic Bureaucracy")
   - **Segment**: Select segment or "Any" for universal triggers
   - **Skill**: Choose skill tested (Engineering, Piloting, etc.)
   - **DC**: Set base difficulty (8-18, 12 is typical)
   - **Tags**: Comma-separated tags (e.g., "bureaucracy,cosmic,absurd")
4. **Define Trigger Condition** (JSON):
   ```json
   {
     "type": "or",
     "conditions": [
       { "type": "stat", "stat": "morale", "operator": "<", "value": 30 },
       { "type": "day_modulo", "divisor": 5, "remainder": 0 }
     ]
   }
   ```
5. **Set Effects**:
   - **Pass Effect**: Delta string (e.g., `hull+5,morale+2`)
   - **Fail Effect**: Delta string (e.g., `hull-10,oxygen-5`)
6. **Publish Reference**: Click "Publish" to create new reference release
7. **Activate Release**: Activate release to enable event in gameplay

#### Debugging Main Story System Integration

**1. Check Turn Job Status**:
```sql
SELECT id, game_id, status, created_at, completed_at 
FROM turn_jobs 
WHERE game_id = 'your-game-id' 
ORDER BY created_at DESC 
LIMIT 10;
```

**2. Inspect Turn Manifest** (if precompute completed):
```sql
SELECT manifest_data 
FROM turn_jobs 
WHERE id = 'job-id' AND manifest_data IS NOT NULL;
```

**3. Review Game State**:
```typescript
const state = await storage.getGameState(gameId);
console.log('Turn:', state.turnNumber);
console.log('Day:', state.day);
console.log('Segment:', state.segment);
console.log('Running Gags:', state.runningGags);
```

**4. Check PCE Pipeline Output**:
```typescript
const turn = state.turns[state.turns.length - 1];
console.log('Prompt Chain:', turn.promptChain);
console.log('Master Enrichment:', turn.masterEnrichment);
console.log('Narrative:', turn.narrative);
console.log('Image Prompt:', turn.imagePrompt);
```

**5. Trace Story Beat Evaluation**:
```typescript
// In getTriggeredEvents()
const activeEvents = await getActiveEvents();
for (const event of activeEvents) {
  const matches = event.segment === state.segment || event.segment === 'Any';
  const conditionMet = evaluateTriggerCondition(event, state);
  console.log(`Event ${event.name}: segment=${matches}, condition=${conditionMet}`);
}
```

### Code Examples and Usage Patterns

#### Accessing Narrative Arc Context in PCE

```typescript
// Current segment
const segment = state.segment;  // e.g., 'Outer Darkness'

// Day progression
const day = state.day;  // 1-12
const turnNumber = state.turnNumber;  // Sequential counter

// Arc phase detection
const isEarlyArc = day <= 4;
const isMidArc = day >= 5 && day <= 7;
const isLateArc = day >= 8 && day <= 10;
const isFinale = day >= 11;

// Difficulty scaling
const baseDC = 12;
const scaledDC = calculateDC(baseDC, turnNumber, state.stats.morale);

// Pass to PCE via context
const context = await buildTurnGenerationContext(
  state,
  action,
  checks,
  userPreferences,
  triggeredEvent,
  { intro: false }
);
// Context includes SEGMENT, DAY, and arc phase information
```

#### Evaluating Event Triggers

```typescript
// In computeTurnChecks() (server/gameLogic.ts)
const triggeredEvents = await getTriggeredEvents(state);

// getTriggeredEvents filters by:
// 1. Segment match
// 2. Active flag
// 3. Trigger condition evaluation

const selectedEvent = triggeredEvents[0] || null;

if (selectedEvent) {
  // Create skill check for event
  const skill = selectedEvent.skill;
  const baseDC = selectedEvent.dc;
  const dc = calculateDC(baseDC, state.turnNumber, state.stats.morale);
  const roll = seededRandom.roll(state.seed, state.day, skill);
  const success = roll >= dc;
  
  // Apply event effects
  const deltaString = success ? selectedEvent.passEffect : selectedEvent.failEffect;
  // ... apply delta to stats
  
  // Pass event to PCE
  const eventContext = {
    name: selectedEvent.name,
    segment: selectedEvent.segment,
    skill: selectedEvent.skill
  };
}
```

### Best Practices and Guidelines

**Turn Processing**:
- Always use orchestrator pattern (precompute → apply) for production turns
- Never call LLM APIs inside database transactions
- Validate all inputs before enqueuing turn jobs
- Use row-level locking (`FOR UPDATE`) to prevent race conditions
- Emit WebSocket events after transaction commit (not before)

**Story Beat Design**:
- Name events clearly and memorably (players see these in narrative)
- Match event tone to segment atmosphere (bureaucratic early, cosmic late)
- Vary skills tested to avoid over-reliance on one skill
- Use balanced DCs: 10-12 common, 14-16 rare, 18 critical
- Set meaningful effects: ±5-10 points feels impactful
- Mix trigger types (stat, time, random) for variety
- Avoid spam: Use `day_modulo` with divisor ≥ 3 for recurring events

**Arc Progression**:
- Keep segment boundaries clear and day-based
- Ensure win condition is achievable but not trivial
- Scale difficulty gradually (DC +1 every 3 turns)
- Provide segment-appropriate events for each phase
- Use running gags to create continuity across segments

**PCE Integration**:
- Pass event context to PCE via `{{ACTIVE_EVENT}}` variable
- Include running gags in PCE prompts for callback humor
- Use segment context to guide thematic consistency
- Reference previous turns in narrative generation (last 3 turns)
- Ensure master stage receives all story system context
- Validate all PCE variables before template rendering

**Narrative Integration**:
- Narrative must reference active events when present
- Running gags must appear in narrative (callback humor)
- Segment tone must match narrative style
- PCE pipeline must produce consistent output
- Master enrichment must incorporate beat and arc context

### Common Patterns and Conventions

**Turn Numbering**:
- Turn numbers start at 1 (intro turn is special case)
- Even-numbered turns advance day counter
- Turn number used for DC scaling and difficulty progression

**Event Naming**:
- Use descriptive, memorable names (players see these)
- Follow tone conventions: bureaucratic (early), slapstick (mid), cosmic (late)
- Examples: "Paperwork Singularity", "Asteroid Belt Surprise", "Cosmic HR Audit"

**Delta String Format**:
- Comma-separated stat changes: `hull+5,morale+2,oxygen-3`
- Stat names: `hull`, `oxygen`, `fuel`, `food`, `morale`, `weirdness`
- Operators: `+` for increase, `-` for decrease
- Values: Integers only (no decimals)

**Segment Naming**:
- Use clear, location-based names
- Match game design document terminology
- Keep consistent with event segment references

**PCE Variable Naming**:
- Use UPPER_SNAKE_CASE for top-level variables
- Use dot notation for nested properties: `{{THEME_OBJECT.label}}`
- Group related variables (e.g., `MASTER_CONTEXT.*`, `MASTER_VARIABLES.*`)
- Avoid variable name collisions between stages

---

## Troubleshooting & Support

### Common Issues and Solutions

**Issue: Turn processing hangs or times out**

**Symptoms**: Turn job remains in 'processing' status, client never receives completion event

**Diagnosis**:
1. Check orchestrator worker logs for errors
2. Verify PostgreSQL connection pool isn't exhausted
3. Inspect LLM API rate limits and quotas
4. Review turn job manifest for precompute phase completion
5. Check PCE pipeline execution logs

**Solutions**:
- Increase orchestrator worker lease duration if LLM calls are slow
- Add retry logic for transient LLM API failures
- Implement job timeout and dead-letter queue
- Check database connection pool size (`pool.max` in storage config)
- Verify PCE template loading isn't blocking

**Issue: Events not triggering**

**Symptoms**: Expected events never appear in gameplay

**Diagnosis**:
1. Verify event is active (`active: true` in database)
2. Check segment match (`event.segment === state.segment || event.segment === 'Any'`)
3. Inspect trigger condition evaluation (add logging to `evaluateTriggerCondition()`)
4. Confirm event is in active reference release

**Solutions**:
- Use Dev Tools to verify event configuration
- Test trigger condition manually with sample game state
- Check reference release activation status
- Review event segment gating (may be too restrictive)

**Issue: Running gags not appearing in narrative**

**Symptoms**: Events trigger but aren't referenced in later turns

**Diagnosis**:
1. Verify event has `id` field (required for running gag tracking)
2. Check `state.runningGags` array contains event name
3. Inspect PCE prompt variables (ensure `{{RUNNING_GAGS}}` is populated)
4. Review narrative stage output (may ignore running gags)

**Solutions**:
- Ensure all events have UUID `id` fields
- Verify running gag array is passed to PCE pipeline
- Update PCE narrative template to emphasize running gag usage
- Check narrative stage output for gag references

**Issue: PCE narrative doesn't match segment tone**

**Symptoms**: Narrative feels inconsistent with arc phase

**Diagnosis**:
1. Verify `{{SEGMENT}}` variable is populated correctly
2. Check master stage receives segment context
3. Review master enrichment for arc phase awareness
4. Inspect narrative template for segment-specific instructions

**Solutions**:
- Ensure segment context passed to PCE via `buildTurnGenerationContext`
- Update master stage template to consider arc phase
- Add segment-specific guidance to master enrichment
- Review narrative template for thematic consistency

**Issue: Image prompt doesn't match narrative**

**Symptoms**: Generated image doesn't reflect narrative content

**Diagnosis**:
1. Verify `{{NARRATION}}` variable passed to image stage
2. Check image stage receives master enrichment
3. Review image template for narrative synchronization
4. Inspect image prompt output for narrative references

**Solutions**:
- Ensure narrative stage completes before image stage
- Verify image stage receives `NARRATION` variable
- Update image template to reference narrative content
- Check master guidance includes image synchronization directives

### Error Messages and Meanings

**"processTurnLogic called without precomputed data"**

**Meaning**: Turn processing attempted without orchestrator precompute phase

**Solution**: Ensure all turn processing goes through orchestrator workers. Legacy inline processing is no longer supported.

**"PCE turn generation failed: master stage failed"**

**Meaning**: Master stage returned `ok: false` or missing enrichment output

**Solution**: Check master stage metadata for specific error, review LLM logs, verify template, ensure all story system variables are populated.

**"Meta prompt validation failed: unresolved placeholders detected: {{X}}"**

**Meaning**: Template contains placeholder that cannot be satisfied by provided variables

**Solution**: Add missing variable to variable building function or fix placeholder name. Ensure story beat and arc context variables are included.

**"Game not found"**

**Meaning**: Game ID doesn't exist in database or transaction failed to lock row

**Solution**: Verify game ID is valid, check database connection, review transaction isolation level

**"PCE image generation failed: imagePrompt is required"**

**Meaning**: PCE pipeline didn't generate image prompt for turn

**Solution**: Check PCE image stage execution, verify image template exists, review PCE error logs

### Debugging Tips and Strategies

**Enable Detailed Logging**:
```typescript
// In server/gameLogic.ts
console.log('[GAME_FLOW] processTurnLogic', {
  action: action.action,
  turnNumber: state.turnNumber,
  username: state.username,
  hasPrecomputed: !!precomputed,
  segment: state.segment,
  day: state.day,
  activeEvent: event?.name,
  runningGags: state.runningGags
});

// In PCE pipeline
console.log('[PCE] Stage starting', {
  gameId: context.gameId,
  turnNumber: context.turnNumber,
  segment: context.state.segment,
  activeEvent: context.triggeredEvent?.name,
  variableKeys: Object.keys(variables)
});
```

**Inspect Turn Manifest**:
```typescript
// In TurnApplyWorker
const manifest = await storage.getTurnJobManifest(job.id);
console.log('Manifest:', JSON.stringify(manifest, null, 2));
console.log('PCE Output:', manifest.turnContent);
console.log('Master Enrichment:', manifest.turnContent.master?.output);
```

**Trace Event Evaluation**:
```typescript
// In getTriggeredEvents()
const activeEvents = await getActiveEvents();
for (const event of activeEvents) {
  const matches = event.segment === state.segment || event.segment === 'Any';
  const conditionMet = evaluateTriggerCondition(event, state);
  console.log(`Event ${event.name}: segment=${matches}, condition=${conditionMet}`);
}
```

**Monitor Segment Progression**:
```typescript
// Log segment changes
if (oldSegment !== newSegment) {
  console.log(`Segment changed: ${oldSegment} → ${newSegment} (day ${state.day})`);
}
```

**Review PCE Variable Coverage**:
```typescript
import { validateMetaPromptVariables, loadTemplate } from './pce/promptBuilder';

const template = await loadTemplate("master");
const variables = await buildMasterVariables(context);
const issues = validateMetaPromptVariables(template, variables);
if (issues.length > 0) {
  issues.forEach(issue => {
    console.error(`${issue.placeholder}: ${issue.reason} (path: ${issue.path})`);
  });
}
```

---

## Standards & Processes

### Quality Requirements and Criteria

**Turn Processing Reliability**:
- All turns must complete within 30 seconds (precompute + apply)
- Transaction rollback on any error (no partial state updates)
- Idempotent processing (retry-safe via manifest hashing)
- WebSocket notification delivery within 1 second of commit

**Story Beat System Accuracy**:
- Events trigger when conditions are met (no false positives)
- Events don't trigger when conditions aren't met (no false negatives)
- Running gags accumulate correctly (no duplicates)
- Event effects apply deterministically (reproducible with same seed)

**Arc Progression Consistency**:
- Segments advance in correct order (no skipping or backtracking)
- Day counter increments exactly every 2 turns
- Difficulty scaling follows formula (no unexpected jumps)
- Win/loss conditions trigger at correct thresholds

**PCE Pipeline Quality**:
- All stages must complete successfully (no `ok: false` results)
- Total pipeline execution time < 8 seconds (4 stages × ~2s each)
- Template cache hit rate > 90% (after warmup)
- Variable validation must pass before LLM calls
- Narrative must reference active events when present
- Running gags must appear in narrative (callback humor)
- Segment tone must match narrative style

**Narrative Quality**:
- Narrative references active events when present
- Running gags appear in narrative (callback humor)
- Segment tone matches narrative style
- PCE pipeline produces consistent output
- Image prompts synchronize with narrative content

### Security Considerations

**Input Validation**:
- All turn actions validated via Zod schema (`actionInputSchema`)
- Custom action text sanitized (no script injection)
- Game ID verified before processing (prevents cross-game access)
- PCE template variables sanitized before substitution

**State Protection**:
- Row-level locking prevents concurrent turn processing
- Transaction isolation ensures consistent reads
- Manifest hashing prevents duplicate processing
- PCE template validation prevents undefined variable access

**Rate Limiting**:
- Turn actions rate-limited per user (`gameActionRateLimit`)
- Prevents turn spam and resource exhaustion
- Configurable via middleware settings

**Template Injection**:
- Variable substitution uses regex replacement, not eval
- User-provided content (player actions, interview responses) sanitized before variable building
- Template validation prevents undefined variable access

### Performance Implications

**Turn Processing Latency**:
- Precompute phase: ~5-15 seconds (LLM calls dominate)
- Apply phase: ~100-500ms (database transaction)
- Total: ~6-16 seconds per turn
- Optimization: Image cache hits reduce latency by ~3-5 seconds

**PCE Pipeline Execution**:
- **Master Stage**: ~1-2 seconds (LLM call)
- **Narrative Stage**: ~1-2 seconds (LLM call)
- **Image Stage**: ~1-2 seconds (LLM call)
- **Actions Stage**: ~1-2 seconds (LLM call)
- **Total Sequential**: ~4-8 seconds
- **With Parallelization**: ~3-6 seconds (image + actions in parallel)

**Database Load**:
- Turn jobs table grows with game activity
- Manifest storage increases database size
- Consider archival strategy for completed jobs
- Template loading: Minimal (cached after first load)
- Theme/style resolution: 2 queries per turn (themes + styles)
- LLM logging: ~1-5KB per stage call (4 stages = ~4-20KB per turn)

**Scalability**:
- Orchestrator workers can scale horizontally (multiple workers per queue)
- Database connection pool limits concurrent processing
- LLM API rate limits may bottleneck at high volume
- Template cache reduces file I/O (automatic)

### Testing and Validation Approaches

**Unit Tests**:
```typescript
// Test segment progression
describe('getSegment', () => {
  it('returns correct segment for day 1', () => {
    expect(getSegment(1)).toBe('Launch from Earth');
  });
  
  it('advances to Outer Darkness at day 8', () => {
    expect(getSegment(8)).toBe('Outer Darkness');
  });
});

// Test DC scaling
describe('calculateDC', () => {
  it('scales with turn number', () => {
    expect(calculateDC(12, 3, 50)).toBe(13); // +1 every 3 turns
  });
  
  it('adds penalty for low morale', () => {
    expect(calculateDC(12, 1, 25)).toBe(13); // +1 for morale < 30
  });
});

// Test PCE variable building
describe('buildMasterVariables', () => {
  it('includes story beat context', () => {
    const context = createContextWithEvent('Cosmic Bureaucracy');
    const variables = buildMasterVariables(context);
    expect(variables.ACTIVE_EVENT).toBe('Cosmic Bureaucracy');
  });
  
  it('includes narrative arc context', () => {
    const context = createContextWithSegment('Outer Darkness');
    const variables = buildMasterVariables(context);
    expect(variables.SEGMENT).toBe('Outer Darkness');
  });
});
```

**Integration Tests**:
```typescript
// Test turn processing end-to-end
describe('Turn Processing', () => {
  it('processes turn and advances day on even turn numbers', async () => {
    const state = await createTestGame();
    const initialDay = state.day;
    
    await processTurn(state, { action: 'repair hull' });
    await processTurn(state, { action: 'check systems' });
    
    const updatedState = await getGameState(state.id);
    expect(updatedState.day).toBe(initialDay + 1);
  });
  
  it('triggers event and passes to PCE', async () => {
    const state = await createStateWithLowMorale(25);
    const result = await processTurn(state, { action: 'check morale' });
    
    expect(result.event).toBeDefined();
    expect(result.turnContent.master.output.enrichment.context.turnMoment).toContain(result.event.name);
  });
});

// Test PCE pipeline with story system context
describe('PCE Integration', () => {
  it('generates narrative referencing active event', async () => {
    const context = await buildTurnGenerationContext(
      state,
      action,
      checks,
      preferences,
      { name: 'Cosmic Bureaucracy', segment: 'Outer Darkness', skill: 'Engineering' }
    );
    const result = await router.generateFullTurnContent(context);
    
    expect(result.narrative.output?.narration).toContain('Cosmic Bureaucracy');
  });
  
  it('incorporates running gags in narrative', async () => {
    const state = createStateWithRunningGags(['Paperwork Singularity', 'Asteroid Belt Surprise']);
    const context = await buildTurnGenerationContext(state, action, checks, preferences, null);
    const result = await router.generateFullTurnContent(context);
    
    expect(result.narrative.output?.narration).toMatch(/Paperwork|Asteroid/);
  });
});
```

**Event Trigger Tests**:
```typescript
// Test event evaluation
describe('Event Triggers', () => {
  it('triggers event when condition met', async () => {
    const state = createStateWithLowMorale(25);
    const events = await getTriggeredEvents(state);
    
    expect(events).toContainEqual(
      expect.objectContaining({ name: 'Crew Mutiny' })
    );
  });
});
```

**Manual Testing Checklist**:
- [ ] Create new game and verify intro turn
- [ ] Process 2 turns and verify day advancement
- [ ] Trigger event and verify skill check
- [ ] Verify running gag appears in narrative
- [ ] Test segment progression through all phases
- [ ] Verify win condition triggers at day 12
- [ ] Test loss conditions (hull/oxygen/morale/weirdness)
- [ ] Check PCE pipeline output quality
- [ ] Verify narrative references active events
- [ ] Confirm image prompts match narrative content
- [ ] Test running gag callbacks across multiple turns

---

## Visual Aids

### Recommended Diagrams

**1. Complete Main Story System Flow**

```
┌─────────────┐
│ Player      │
│ Action      │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Route Handler   │────▶│ Create Turn Job  │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Enqueue: turn-precompute│
                    └────────────┬───────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ TurnPrecomputeWorker    │
                    │ • Load game state        │
                    │ • Evaluate story beats  │
                    │ • Compute checks        │
                    │ • Build PCE context    │
                    │ • Generate content      │
                    │ • Persist manifest      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Enqueue: turn-apply     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ TurnApplyWorker         │
                    │ • Lock game row         │
                    │ • Apply changes         │
                    │ • Update day/segment    │
                    │ • Commit transaction    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ WebSocket: turnComplete │
                    └────────────────────────┘
```

**2. Story Beat Evaluation Flow**

```
┌─────────────────┐
│ Game State      │
│ (Turn Start)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ getTriggeredEvents()    │
│ • Filter by segment     │
│ • Filter by active      │
│ • Evaluate conditions   │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │ Event  │
    │ Found? │
    └───┬────┘
        │
   ┌────┴────┐
   │ Yes    │ No
   │        │
   ▼        ▼
┌─────────┐ ┌──────────┐
│ Create  │ │ Use     │
│ Event   │ │ Action  │
│ Check   │ │ Check   │
└────┬────┘ └────┬─────┘
     │           │
     └─────┬─────┘
           │
           ▼
    ┌──────────────┐
    │ Resolve Check│
    │ Apply Effects│
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Add Running   │
    │ Gag (if new)  │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Pass to PCE  │
    │ (ACTIVE_EVENT│
    │  RUNNING_GAGS│
    └──────────────┘
```

**3. Narrative Arc Progression**

```
Day 1          Day 2          Days 3-4       Day 5
Launch ──────▶ Moon ────────▶ Onto Mars ───▶ Asteroid
Earth          Flyby                          Belt
  │              │               │              │
  │ Bureaucratic │               │              │ Slapstick
  │ Comedy       │               │              │ Danger
  │              │               │              │
  ▼              ▼               ▼              ▼
Days 6-7        Days 8-10       Days 11-12
Jupiter & ────▶ Outer ────────▶ Approaching
Saturn          Darkness        Uranus
  │              │              │
  │               │              │ Finale
  │               │              │
  ▼               ▼              ▼
              Cosmic Horror   Arrival on
              Comedy          Uranus
                                │
                                ▼
                            Win Condition
                            (Any stat ≥ 30)
```

**4. PCE Pipeline with Story System Integration**

```
┌─────────────────────────────────────────────────────────┐
│              TurnGenerationContext                      │
│  Game State + Story Beat + Narrative Arc + Preferences │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 1: Master           │
        │   Input: All variables      │
        │   + ACTIVE_EVENT            │
        │   + RUNNING_GAGS            │
        │   + SEGMENT                 │
        │   + DAY                     │
        │   Output: Enrichment        │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Stage 2: Narrative        │
        │   Input: Master + State     │
        │   Output: Narration          │
        │   (References events/gags)  │
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
│ (Synced)     │ │ (Contextual) │
└──────────────┘ └─────────────┘
```

**5. Variable Flow Through Main Story System**

```
Game Turn Context
    ├─ TURN_NUMBER
    ├─ PLAYER_ACTION
    ├─ CHECKS
    └─ STATS
         ↓
Story Beat Context
    ├─ ACTIVE_EVENT
    └─ RUNNING_GAGS
         ↓
Narrative Arc Context
    ├─ DAY
    ├─ SEGMENT
    └─ Arc Phase
         ↓
PCE Master Stage
    ├─ Receives all context
    ├─ Generates enrichment
    └─ Flattens to variables
         ↓
PCE Narrative Stage
    ├─ Uses enrichment
    ├─ References events/gags
    └─ Matches arc tone
         ↓
PCE Image/Actions Stages
    ├─ Inherit narrative
    └─ Stay synchronized
```

---

## Cross-References

### Related Documentation

**Core System Documentation**:
- [`SYSTEM_OVERVIEW.md`](./SYSTEM_OVERVIEW.md): Overall system architecture and agent responsibilities
- [`AGENTS.md`](../AGENTS.md): Agent catalog and runtime responsibilities
- [`API_GUIDE.md`](./API_GUIDE.md): HTTP/WebSocket API endpoints and patterns

**Content Generation**:
- [`PROMPT_COMPOSITION_ENGINE.md`](./PROMPT_COMPOSITION_ENGINE.md): Detailed PCE pipeline architecture and stage details (legacy reference)
- [`PCE_PROMPTS_AND_VARIABLES.md`](./PCE_PROMPTS_AND_VARIABLES.md): PCE template authoring guide and variable catalog
- [`AI_SERVICE.md`](./AI_SERVICE.md): LLM integration and content generation

**Game Mechanics**:
- Event System (retired docs): Event trigger conditions and effects (see `docs_master/.retired_docs/EVENT_SYSTEM.md`)
- Reference System: Content versioning and release management

**Client Integration**:
- [`CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`](./CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md): Client-side turn handling and UI updates
- [`SESSIONS.md`](./SESSIONS.md): Session management and game lifecycle

### Key Code Modules

**Turn Processing**:
- `server/gameLogic.ts`: Core turn processing logic (`processTurnLogic`, `computeTurnChecks`)
- `server/orchestrator/workers/turnPrecomputeWorker.ts`: Precompute phase worker
- `server/orchestrator/workers/turnApplyWorker.ts`: Apply phase worker
- `server/storage.ts`: Transactional state management (`processTurnWithTransaction`)

**Story Beats**:
- `server/gameEngine.ts`: Event evaluation (`getTriggeredEvents`, `evaluateTriggerCondition`)
- `server/reference/referenceLoader.ts`: Event loading from reference system
- `shared/schema.ts`: Event definition types and trigger condition schemas

**Narrative Arc**:
- `server/gameEngine.ts`: Segment calculation (`getSegment`), DC scaling (`calculateDC`), win/loss checks
- `server/gameLogic.ts`: Day advancement and segment updates

**PCE Pipeline**:
- `server/pce/contentRouter.ts`: Pipeline orchestration
- `server/pce/promptBuilder.ts`: Template loading and variable substitution
- `server/pce/settings.ts`: Theme/style resolution
- `server/pce/modelInstructions.ts`: Model-specific prompt adaptation
- `server/aiService.ts`: PCE integration and stage execution

### Dependencies

**Internal Dependencies**:
- Turn processing requires: Storage agent, Orchestrator agent, AI Service, Reference Steward
- Event evaluation requires: Reference Steward (for event definitions), Game Engine (for state evaluation)
- Arc progression requires: Game Logic (for day advancement), Game Engine (for segment calculation)
- PCE requires: AI Service (for LLM calls), Reference Steward (for templates), Storage (for themes/styles), Game Logic (for context)

**External Dependencies**:
- PostgreSQL: Game state storage and job queue
- LLM APIs: Narrative and content generation
- Socket.IO: Real-time turn completion notifications

---

## Summary

The Main Story System unifies four interconnected subsystems that drive Quest to Uranus's narrative gameplay:

- **Game Turn**: The atomic unit processed through a two-phase orchestrator pattern (precompute → apply) for optimal performance and reliability
- **Story Beat** (Game Beat): Procedural narrative moments triggered by game state conditions, implemented as Events that create skill challenges and running gags
- **Narrative Arc**: The structured journey through Segments, providing thematic progression, escalating difficulty, and win/loss conditions
- **Prompt Composition Engine (PCE)**: The multi-stage pipeline that generates synchronized narrative text and image prompts based on turn context, beats, and arc progression

Together, these systems create a cohesive gameplay experience where:
- Player actions drive deterministic state changes through game turns
- Procedural events (story beats) inject variety and memorable moments
- The narrative arc ensures a satisfying journey from Earth to Uranus
- The PCE generates thematically consistent, synchronized content that responds to all three systems

The integration between these systems ensures that:
- Story beats influence narrative generation through PCE variables
- Narrative arc provides context for thematic consistency
- Running gags create continuity across turns and segments
- Image prompts synchronize with narrative content
- All content generation respects the current arc phase and active events

This unified architecture enables Quest to Uranus to deliver a rich, procedurally generated narrative experience that feels both structured and surprising, maintaining player engagement through 8-12 turns of snackable gameplay.

---

**Document Status**: Complete  
**Maintainer**: Engineering Team  
**Review Cycle**: Quarterly or when major changes occur







