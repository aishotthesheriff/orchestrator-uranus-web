# Prompt Composition Engine (PCE) - UI Flow Diagram

This document describes how the **Prompt Composition Engine (PCE)** generates synchronized narration and image prompts through a single multi-persona meta prompt. This is the current implementation when `pce_enabled` is `true` in app settings.

> **Note:** For the legacy prompt stack flow (when PCE is disabled), see `PROMPT_UI_FLOW.md`.

---

## Overview: PCE Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PCE META PROMPT SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  masterPrompt.txt → Single template with dual persona:         │
│    ├─ Narrator Persona: Generates 6-7 sentence narrative       │
│    └─ Visualizer Persona: Generates image prompt                │
│                                                                 │
│  Input Variables:                                               │
│    ├─ THEME_OBJECT, STYLE_OBJECT, IMAGE_MODEL (full objects)   │
│    ├─ TURN_NUMBER, DAY, SEGMENT, HULL, OXYGEN, etc.            │
│    └─ CONTENT (assembled game state summary)                     │
│                                                                 │
│  Output Format: Strict JSON                                     │
│    {                                                            │
│      "narration": "...",                                        │
│      "image_prompt": "..."                                      │
│    }                                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Differences from Legacy:**
- **Single LLM call** produces both narration and image prompt (synchronized)
- **Creative selections** (theme, mood, style) are persisted per game and influence both outputs
- **Image prompt** is stored on each turn for regeneration without re-querying LLM
- **Fallback path** to legacy prompts if JSON parsing fails (logged with `mode: "pce-fallback"`)

---

## Complete User Journey Flow (PCE Enabled)

### Game Start Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GAME START FLOW (PCE)                          │
└─────────────────────────────────────────────────────────────────────────┘

User clicks "New Voyage"
         │
         ▼
    [POST /api/game/start]
         │
         ▼
   Initialize Game State
   stats: {hull: 100, ...}
   npcs: [Engineer, ...]
   items: [...]
   theme, mood, style (from defaults or user preferences)
         │
         ├────────────────────────────────────────────┐
         ▼                                            ▼
   AI Call 1: generateTurnContentWithFlag()    AI Call 2: generateActions()
         │ (PCE path when enabled)                   │
         │                                            │
         ├─ Check: isPceEnabled() ────┐              │
         │ (returns true)              │              │
         │                             │              │
         ▼                             │              │
   generateTurnContent()               │              │
         │                             │              │
         ├─ Resolve creative selections (theme/mood/style)│
         ├─ Build CONTENT variable from game state    │
         ├─ Load masterPrompt.txt template            │
         ├─ Replace variables (THEME, STYLE, CONTENT, etc.)│
         └─ buildMetaPrompt() ────────────────────────┘
         │
         ▼
   Single LLM Call (GPT-4o-mini)
   response_format: { type: "json_object" }
         │
         ▼
   Parse JSON Response:
   {
     "narration": "The docking bay buzzes...",
     "image_prompt": "A bustling spacecraft..."
   }
         │
         ├─────────────────────────┐
         ▼                         ▼
   Store narration        Store imagePrompt
   on Turn 0              on Turn 0
         │                         │
         └──────────────┬───────────┘
                        ▼
         ┌──────────────────────────────────────────────┐
         │         GAME PAGE (GamePage.tsx)             │
         ├──────────────────────────────────────────────┤
         │                                              │
         │  StatBar × 5, WeirdnessMeter, NPCCard × 3,  │
         │  ItemCard × 6                                │
         │                                              │
         │  TurnCard (Turn 0)                          │
         │  ├─ narrative ← FROM PCE narration          │
         │  ├─ imagePrompt ← FROM PCE image_prompt     │
         │  └─ imageStyle ← FROM resolved style        │
         │                                              │
         │  ActionChip × 6  ← FROM action_generation   │
         │                                              │
         └──────────────────────────────────────────────┘
```

**Notes:**
- Intro turn uses the same PCE path with a default action: `"Beginning the voyage to Uranus"`
- Both `narration` and `imagePrompt` are persisted on the turn object
- Image generation can use the stored `imagePrompt` directly (see Image Generation Flow below)
- **Intro Turn Special Handling**: Unlike regular turns, intro turns check the image cache **synchronously** during turn creation. If cache hit, `turn.imageUrl` is set immediately (no job needed). If cache miss, an image job is created for asynchronous processing. See `server/gameLogic.ts` → `processIntroTurn()` and IMAGE_SYSTEM_ARCHITECTURE.md for details.

---

### Player Takes Action Flow (PCE)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PLAYER TAKES ACTION FLOW (PCE)                      │
└─────────────────────────────────────────────────────────────────────────┘

User clicks an ActionChip (e.g., "File paperwork")
         │
         ▼
    [POST /api/game/action]
    { gameId, action: "File departure paperwork" }
         │
         ▼
    Server processes action (intent→skill, DC, roll d20, success/fail)
         │
         ├─────────────────────┬──────────────────────┐
         ▼                     ▼                      ▼
   AI Call 1:          Apply Consequences    AI Call 2:
   generateTurnContent() (stats delta)        generateActions()
   (PCE path)               │                      │
         │                   │                      │
         ├─ Resolve creative selections            │
         │  (theme/mood/style from game state)     │
         │                                          │
         ├─ buildPceContent() ──┐                  │
         │  Assembles CONTENT:   │                  │
         │  - Narrator persona   │                  │
         │  - Turn context       │                  │
         │  - Player action      │                  │
         │  - Skill checks       │                  │
         │  - Crew status        │                  │
         │  - Ship stats         │                  │
         │  - Running gags       │                  │
         │  - Recent turns        │                  │
         │  - Interview responses│                  │
         │                      │                  │
         ├─ Load masterPrompt.txt                  │
         ├─ Replace variables:                     │
         │  THEME_OBJECT.narratorTemplate          │
         │  STYLE_OBJECT.*                         │
         │  IMAGE_MODEL.*                          │
         │  TURN_NUMBER, DAY, SEGMENT              │
         │  HULL, OXYGEN, FUEL, FOOD, MORALE        │
         │  CHECKS, ACTIVE_EVENT, PLAYER_ACTION     │
         │  RUNNING_GAGS, NPC_SUMMARY               │
         │  EQUIPPED_ITEMS, CONTENT                  │
         │                      │                  │
         └─ buildMetaPrompt() ──┘                  │
         │                                          │
         ▼                                          │
   Single LLM Call (GPT-4o-mini)                    │
   response_format: { type: "json_object" }        │
         │                                          │
         ▼                                          │
   Parse JSON Response:                             │
   {                                                │
     "narration": "You approach the desk...",      │
     "image_prompt": "A bureaucrat stamps..."      │
   }                                                │
         │                                          │
         ├───────────────────┐                      │
         ▼                   ▼                      │
   Store narration    Store imagePrompt             │
   on Turn N         on Turn N                     │
         │                   │                      │
         └───────────┬───────┘                      │
                     │                              │
                     └──────────────┬───────────────┘
                                     ▼
         ┌──────────────────────────────────────────────┐
         │         GAME PAGE (Updated)                   │
         ├──────────────────────────────────────────────┤
         │  StatBar ×5 (updated), TurnCard (new),        │
         │  TurnCard displays:                           │
         │  ├─ narrative ← FROM PCE narration           │
         │  ├─ embedded check lines                     │
         │  ├─ imagePrompt ← FROM PCE image_prompt     │
         │  └─ stat deltas                              │
         │                                              │
         │  ActionChip × 6  ← FROM action_generation    │
         └──────────────────────────────────────────────┘
```

**Notes:**
- Single AI call generates both narration and image prompt (synchronized)
- If JSON parsing fails, falls back to `legacyGenerateNarrative()` (returns narration only, empty imagePrompt)
- Fallback is logged with `mode: "pce-fallback"` for monitoring

---

### Custom Action Flow (PCE)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CUSTOM ACTION FLOW (PCE)                            │
└─────────────────────────────────────────────────────────────────────────┘

User types custom action: "Bribe the coffee machine with premium beans"
         │
         ▼
    [POST /api/game/action]
    { gameId, customText: "Bribe the coffee machine..." }
         │
         ▼
    AI Call: mapCustomActionToIntent()
         │
         ├─ intent_mapping prompt (unchanged from legacy)
         └─ Returns intent: "negotiate"
         │
         ▼
    Server continues normal flow:
    ├─ skill calc → narrative → actions
    └─ Uses generateTurnContent() (PCE path)
         │
         ▼
    Same flow as "Player Takes Action" above
    (Custom action text becomes PLAYER_ACTION variable)
```

**Note:** Custom action mapping is unchanged from legacy; it's the narrative generation that uses PCE.

---

### Image Generation Flow (PCE)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    IMAGE GENERATION FLOW (PCE)                         │
└─────────────────────────────────────────────────────────────────────────┘

Option A: Automatic (after turn generation)
         │
         ▼
   Turn processed, narrative + imagePrompt stored
         │
         ▼
   Image job created (server/turnJobProcessor.ts)
   - Job created AFTER turn completes
   - Processed asynchronously by ImageJobProcessor queue
         │
         ▼
   generateImage("pce_turn", gameState, options)
   (called by ImageJobProcessor during job processing)
         │
         ├─ buildImagePromptContext()
         │  ├─ Finds targetTurn.imagePrompt
         │  ├─ If found: uses prompt directly (promptSource: "pce")
         │  └─ effectiveTemplateName: "pce_turn"
         │
         ├─ Check image cache (keyed by prompt hash + variables hash)
         │  ├─ If cache hit: return cached image URL
         │  └─ If cache miss: continue
         │
         └─ Send to image provider
            ├─ Uses imageModel from userPreferences or game state
            ├─ Prompt: turn.imagePrompt (already optimized for model)
            └─ Returns imageUrl

Option B: Manual (player clicks "Visualize Scene")
         │
         ▼
   User clicks "Visualize Scene" on TurnCard
         │
         ▼
   generateImage("pce_turn", gameState, { turnNumber })
         │
         └─ Same flow as Option A (uses stored turn.imagePrompt)
```

**Key Points:**
- PCE image prompts are **already optimized** for the selected image model (includes trigger words, style modifiers, etc.)
- No additional template interpolation needed — the prompt from the turn is sent directly to the image provider
- Cache keys include `promptSource: "pce"` to distinguish from legacy template-based images
- If `turn.imagePrompt` is missing (legacy turn or error), falls back to legacy template path

**Timing Note**: For regular turns, image jobs are created **after** turn processing completes (in `turnJobProcessor.ts`), then processed asynchronously by the image job processor queue. Intro turns (Turn 0) check cache synchronously during turn creation - see IMAGE_SYSTEM_ARCHITECTURE.md for details.

---

## PCE Prompt Breakdown

### Meta Prompt Template (`masterPrompt.txt`)

**Location:** `server/pce/masterPrompt.txt`

**Structure:**
1. **First Protocol: Narrator Persona**
   - Uses `{{THEME_OBJECT.narratorTemplate}}` for voice/tone
   - Receives game state via `{{CONTENT}}` variable
   - Outputs 6-7 sentence narrative

2. **Second Protocol: Visualizer Persona**
   - Uses `{{STYLE_OBJECT.*}}` for visual style parameters
   - Uses `{{IMAGE_MODEL.*}}` for model-specific instructions
   - Transforms narrator's perspective into image prompt
   - Outputs model-optimized image prompt

3. **Output Format**
   - Strict JSON with `"narration"` and `"image_prompt"` fields
   - Enforced via `response_format: { type: "json_object" }`

**Variables Available in Meta Prompt:**

**Creative Selections:**
- `{{THEME}}` — Theme label string (e.g., "Corporate AI Satire")
- `{{STYLE}}` — Style label string (e.g., "Sierra VGA 1989")
- `{{THEME_OBJECT.narratorTemplate}}` — Full narrator template from theme object
- `{{STYLE_OBJECT.label}}`, `{{STYLE_OBJECT.description}}`, `{{STYLE_OBJECT.exemplifiedBy}}` — Style details
- `{{STYLE_DIFFUSION_MODIFIERS}}` — Style modifiers for diffusion models
- `{{STYLE_TRANSFORMER_MODIFIERS}}` — Style modifiers for transformer models

**Image Model:**
- `{{IMAGE_MODEL.label}}`, `{{IMAGE_MODEL.class}}`, `{{IMAGE_MODEL.triggerWords}}` — Model-specific parameters
- `{{MODEL_CLASS}}` — Shorthand for model class
- `{{TRIGGER_WORDS}}` — Shorthand for trigger words
- `{{MODEL_STYLE_INSTRUCTIONS}}` — Instructions tailored to model class

**Game State:**
- `{{TURN_NUMBER}}`, `{{DAY}}`, `{{SEGMENT}}` — Turn/segment info
- `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}` — Ship stats (0-100)
- `{{EQUIPPED_ITEMS}}` — Formatted item list
- `{{NPC_SUMMARY}}` — Formatted crew summary with affinity/status
- `{{PLAYER_ACTION}}` — The action the player chose
- `{{CHECKS}}` — Formatted skill check results (e.g., "Bureaucracy DC10 → rolled 14 (success)")
- `{{ACTIVE_EVENT}}` — Triggered event or "No special events triggered"
- `{{RUNNING_GAGS}}` — Active running gags (comma-separated)

**Content Assembly:**
- `{{CONTENT}}` — Pre-assembled game state summary (includes narrator persona, turn context, action, checks, crew, items, stats, absurdity, running gags, recent turns, interview responses)

**Output Format Instructions:**
- `{{OUTPUT_FORMAT_INSTRUCTIONS}}` — JSON format requirements
- `{{OUTPUT_EXAMPLE}}` — Example JSON response

**Source Code:** `server/pce/promptBuilder.ts` → `buildMetaPrompt()`, `server/aiService.ts` → `generateTurnContent()`

---

### CONTENT Variable Assembly

The `{{CONTENT}}` variable is a pre-formatted string that bundles all game state context into a single variable. This is built by `buildPceContent()`:

**Format:**
```
Narrator Persona: E.L.O.N., smug AI announcer.
Turn Context: Day {DAY}, Segment {SEGMENT}, Turn {TURN_NUMBER}.
Player Action: {PLAYER_ACTION}.
Triggered Event: {ACTIVE_EVENT}.
Skill Checks: {CHECKS_SUMMARY}.
Crew Status: {NPC_SUMMARY}.
Equipped Items: {EQUIPPED_ITEMS_DETAIL}.
Ship Stats: Hull {HULL}, Oxygen {OXYGEN}, Fuel {FUEL}, Food {FOOD}, Morale {MORALE}, Weirdness {WEIRDNESS}.
Absurdity Meter: Level {ABSURDITY} — {DESCRIPTOR}.
Running Gags: {RUNNING_GAGS}.
Recent Narrative Echoes: {RECENT_TURNS}.
Interview Responses: {INTERVIEW_SUMMARY}.
```

**Source Code:** `server/aiService.ts` → `buildPceContent()`

---

## Action Generation (Unchanged)

Action generation still uses the `action_generation` prompt template (not PCE). It receives:
- `{{CURRENT_NARRATIVE}}` — The full narration text from the PCE turn (already generated)
- `{{DAY}}`, `{{TURN_NUMBER}}`, `{{SEGMENT}}`
- `{{RECENT_EVENT}}`, `{{CRITICAL_STATS}}`
- `{{EQUIPPED_ITEMS_DETAIL}}`

The action prompt is separate because:
1. Actions are generated **after** the turn narrative is complete
2. Actions reference the **current narrative** for context
3. Actions maintain compatibility with both PCE and legacy paths

**Source Code:** `server/aiService.ts` → `generateActions()`

---

## Fallback Behavior

If PCE fails (JSON parse error, missing fields, etc.):

```
generateTurnContent() error
         │
         ▼
   Catch block:
   ├─ Log error with mode: "pce-fallback"
   ├─ Call legacyGenerateNarrative()
   │  └─ Uses turn_generation template (legacy path)
   └─ Return:
      {
        narration: "[legacy narrative]",
        imagePrompt: "",  // Empty on fallback
        rawResponse: "",
        theme, mood, style  // Still preserved
      }
```

**Monitoring:** Check LLM logs for `mode: "pce-fallback"` to track fallback frequency.

---

## Prompt Interaction Matrix (PCE)

```
┌──────────────────┬───────────────────────┬─────────────┬────────────────┐
│ User Action      │ Prompts Used          │ AI Calls    │ UI Updates     │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Start New Game   │ PCE meta prompt       │ 2 calls     │ TurnCard (0)   │
│                  │ + action              │ (parallel)  │ imagePrompt    │
│                  │                       │             │ ActionChip ×6  │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Click Action     │ PCE meta prompt       │ 2 calls     │ TurnCard       │
│ Button           │ + action              │ (parallel)  │ imagePrompt    │
│                  │                       │             │ StatBar ×5     │
│                  │                       │             │ ActionChip ×6  │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Type Custom      │ intent_mapping +      │ 3 calls     │ Same as above  │
│ Action           │ PCE meta prompt +     │ (2 parallel)│                │
│                  │ action                │             │                │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Visualize Scene  │ (uses stored          │ 1 call      │ Image displayed │
│ (manual)         │ turn.imagePrompt)     │ (image API) │ on TurnCard    │
└──────────────────┴───────────────────────┴─────────────┴────────────────┘
```

---

## AI Call Timing (PCE)

```
GAME START:
  ├─ 1 AI call: generateTurnContent() (1–2 seconds)
  │  └─ Returns: { narration, imagePrompt } in one call
  └─ 1 AI call: generateActions()      (1–2 seconds)
  Total: ~2–4 seconds (calls run in parallel)

NORMAL ACTION:
  ├─ 1 AI call: generateTurnContent() (1–2 seconds)
  │  └─ Returns: { narration, imagePrompt } in one call
  └─ 1 AI call: generateActions()  (1–2 seconds)
  Total: ~2–4 seconds (calls run in parallel)

CUSTOM ACTION:
  ├─ 1 AI call: mapCustomActionToIntent() (≤1 second)
  ├─ 1 AI call: generateTurnContent()    (1–2 seconds)
  └─ 1 AI call: generateActions()         (1–2 seconds)
  Total: ~2.5–4.5 seconds (turn + actions run in parallel)

IMAGE GENERATION:
  └─ Uses stored turn.imagePrompt (no LLM call if cache hit)
```

**Performance Note:** PCE generates both narration and image prompt in a single LLM call, reducing total API calls compared to separate text/image prompts.

**Job Creation Timing:** Image jobs are created **sequentially after** turn processing completes (in `server/turnJobProcessor.ts`), then processed asynchronously by the image job processor queue. The job creation happens immediately after narrative generation, but image generation itself runs asynchronously.

---

## UI Component Dependencies (PCE)

```
GamePage.tsx (Router Component)
│
├─ MobileGamePage.tsx / DesktopGamePage.tsx
│  └─ useGameLogic.ts (Shared Logic)
│     ├─ State management
│     ├─ API calls
│     └─ Event handlers
│
├─ WeirdnessMeter
│  └─ Updated from: Game state (not AI)
│
├─ NPCCard ×3
│  └─ Updated from: Game state + PCE narration influence
│
├─ ItemCard ×6
│  └─ Static (not AI-generated)
│
├─ TurnCard
│  ├─ Turn narrative
│  │  └─ FROM: PCE meta prompt → narration field
│  ├─ CheckDisplay (inline)
│  │  └─ FROM: Game engine (embedded in narrative context)
│  ├─ DeltaDisplay
│  │  └─ FROM: Game engine calculations (not AI)
│  ├─ imagePrompt (displayed for debugging)
│  │  └─ FROM: PCE meta prompt → image_prompt field
│  └─ ImagePreview
│     └─ FROM: Image generation using stored imagePrompt
│
└─ ActionChip ×6
   └─ FROM: action_generation prompt (unchanged from legacy)
```

---

## Key Takeaways (PCE)

1. **Single Meta Prompt** = One LLM call produces both narration and image prompt
2. **Synchronized Outputs** = Image prompt is guaranteed to match narration (same LLM response)
3. **Creative Selections** = Theme, mood, and style are persisted per game and influence both outputs
4. **Stored Prompts** = Image prompts are saved on each turn for regeneration without re-querying LLM
5. **Fallback Safety** = If PCE fails, falls back to legacy narrative generation (logged for monitoring)
6. **Image Optimization** = Image prompts are pre-optimized for the selected model (trigger words, style modifiers included)

The PCE system ensures narrative and visual storytelling remain synchronized throughout the game experience.

---

## Related Documentation

- **Legacy Flow:** `PROMPT_UI_FLOW.md` (when `pce_enabled` is `false`)
- **Variable Reference:** `PROMPT_VARIABLES.md` (PCE variables documented in separate sections)
- **Migration Guide:** `PCE_MIGRATION_GUIDE.md` (implementation details and rollout plan)
- **PCE Comparison:** `PCE_COMPARISON.md` (side-by-side with legacy architecture)
- **Image System Details:** `IMAGE_SYSTEM_ARCHITECTURE.md` (image job processing, cache handling, intro turn special cases)
- **UI Automation:** `ACTION_UI_AUTOMATION_DOCUMENTATION.md` (client-side behavior and WebSocket events)

---

**Last Updated:** January 2025  
**Game Version:** Quest to Uranus v1.0 (PCE-enabled)

