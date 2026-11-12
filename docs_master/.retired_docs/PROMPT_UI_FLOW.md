# Prompt to UI Flow Diagram

This document shows how each prompt template connects to UI components and when they're triggered.

## Overview: Core Prompts (+ Image)

```
┌─────────────────────────────────────────────────────────────────┐
│                      PROMPT TEMPLATES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. global_system_prompt → Sets narrator voice & rules          │
│  2. intro_generation      → Creates Turn 0 introduction         │
│  3. turn_generation       → Creates narrative text (Turn 1+)    │
│  4. action_generation     → Creates 6 action buttons            │
│  5. intent_mapping        → Maps custom text to intent          │
│  6. interview_answer      → Short pre-flight answer             │
│  7. visual_style_prompt   → Shared style for image prompts      │
│     image_* settings      → background/moderation/model         │
│     image prompt templates→ Image generation templates          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Notes:
- “Inherit Global System Prompt” (checkbox) extends `global_system_prompt` with scenario-specific system instructions for all text prompts except the base itself.
- Image prompts can “Inherit Visual Style” from `visual_style_prompt`.

## Complete User Journey Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GAME START FLOW                                 │
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
         │
         ├────────────────────────────────────────────┐
         ▼                                            ▼
   AI Call 1: generateIntroTurnContent()      AI Call 2: generateActions()
         │                                            │
         ├─ global_system_prompt ─┐                  ├─ global_system_prompt ─┐
         └─ intro_generation ────┤                  └─ action_generation ────┤
                                 ▼                                          ▼
                           GPT-4o-mini                                GPT-4o-mini
                                 │                                          │
                                 ▼                                          ▼
                           Turn 0 Narrative                          JSON Array
                           (4–8 sentences)                           6 ActionChips
                                 │                                          │
                                 └──────────────┬───────────────────────────┘
                                                ▼
         ┌──────────────────────────────────────────────┐
         │         GAME PAGE (GamePage.tsx)             │
         │         ├─ MobileGamePage.tsx                 │
         │         ├─ DesktopGamePage.tsx                │
         │         └─ useGameLogic.ts                    │
         ├──────────────────────────────────────────────┤
         │                                              │
         │  StatBar × 5, WeirdnessMeter, NPCCard × 3,  │
         │  ItemCard × 6                                │
         │                                              │
         │  TurnCard ← FROM intro_generation            │
         │                                              │
         │  ActionChip × 6  ← FROM action_generation    │
         │                                              │
         └──────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PLAYER TAKES ACTION FLOW                             │
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
   generateNarrative()  (stats delta)        generateActions()
         │                     │                      │
         ├─ global_system_prompt ─┐ │                 ├─ global_system_prompt ─┐
         └─ turn_generation ──────┤ │                 └─ action_generation ────┤
                                  ▼ ▼                                        ▼
                            GPT-4o-mini                                  GPT-4o-mini
                                  │                                            │
                                  ▼                                            ▼
                       4–8 sentence narrative                          6 new ActionChips
                                  │                                            │
                                  └────────────────┬───────────────────────────┘
                                                   ▼
         ┌──────────────────────────────────────────────┐
         │         GAME PAGE (Updated)                  │
         ├──────────────────────────────────────────────┤
         │  StatBar, TurnCard (new narrative),          │
         │  embedded check lines, new ActionChips       │
         └──────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CUSTOM ACTION FLOW                                   │
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
         ├─ global_system_prompt
         └─ intent_mapping ───┐
                              ▼
                        GPT-4o-mini
                              │
                              ▼
                        Intent: "negotiate"
                              │
                              ▼
    Server continues normal flow (skill calc → narrative → actions)
```

Optional: Image generation flow (when triggered by game or Dev Tools):
- generateImage(templateName) → resolves image prompt template, variables, and shared visual style; uses model configured by `image_model_key_default` or game override.
 - testGenerateImage(templateName, variables) → Dev Tools helper to preview image generation with a chosen model and variable overrides (no game state required). The set of available image models is sourced from the published reference/DB.

## Detailed Prompt Breakdown

### 1. global_system_prompt

**When Called:** Prepended (via inheritance) to system content for all text prompts unless a scenario overrides.

**Purpose:** Sets the narrator's personality, tone, and rules

**Variables:** None (tone is handled internally by the narrator logic)

**Connected Calls:**
- `generateIntroTurnContent`, `generateNarrative`, `generateActions`, `mapCustomActionToIntent`, `generateInterviewAnswer`

---

### 2. intro_generation

**When Called:** Once at game start (before first action)

**Purpose:** Generate the opening scene that introduces the player to their situation

**Variables:**
```
{{HULL}}             - Hull stat value (100)
{{OXYGEN}}           - Oxygen stat value (100)
{{FUEL}}             - Fuel stat value (100)
{{FOOD}}             - Food stat value (100)
{{MORALE}}           - Morale stat value (100)
{{EQUIPPED_ITEMS}}   - Starting equipped items
{{NPC_SUMMARY}}      - Crew member names and roles
```

**Output Format:**
```
"The docking bay buzzes with pre-departure chaos. Your ship, 
the S.S. Questionable Decisions, sits ready for its maiden 
voyage to Uranus—a mission nobody else wanted. Engineer 
Grom tinkers nervously with the coffee machine, which has 
already filed three union grievances. You're the captain now. 
The cosmos holds its breath."
```

**Connected UI Components:**
```
┌────────────────────────────────────────┐
│  TurnCard Component (Turn 0)           │
├────────────────────────────────────────┤
│  Turn 0:                               │
│  ┌──────────────────────────────────┐  │
│  │ Introduction narrative           │  │ ← FROM intro_generation
│  │ (4-6 sentences)                  │  │
│  │ - Sets the scene                 │  │
│  │ - Introduces mission             │  │
│  │ - Establishes tone               │  │
│  │ - Mentions crew members          │  │
│  └──────────────────────────────────┘  │
│                                        │
│  No skill checks or deltas in Turn 0  │
└────────────────────────────────────────┘
```

**Key Differences from turn_generation:**
- No PLAYER_ACTION (game hasn't started yet)
- No CHECKS (no dice rolls in Turn 0)
- No RECENT_TURNS (this IS the first turn)
- Focused on world-building, not action resolution

---

### 3. turn_generation

**When Called:** After every player action

**Purpose:** Generate the 4–8 sentence narrative describing what happened

**Variables:**
```
{{TURN_NUMBER}}      - Current turn (1–12)
{{DAY}}              - Day in journey
{{SEGMENT}}          - Story segment (Departure, Belt, Outer Darkness, Approach)
{{HULL}}             - Hull stat value (0–100)
{{OXYGEN}}           - Oxygen stat value
{{FUEL}}             - Fuel stat value
{{FOOD}}             - Food stat value
{{MORALE}}           - Morale stat value
{{EQUIPPED_ITEMS}}   - Currently equipped items
{{NPC_SUMMARY}}      - Crew member statuses
{{PLAYER_ACTION}}    - The action player chose
{{CHECKS}}           - Formatted skill check results
{{RECENT_TURNS}}     - Last 2–3 turn narratives
{{RUNNING_GAGS}}     - Active running gags
{{TRIGGERED_EVENT}}  - Event name and challenge summary
```

**Output Format:**
```
"You approach the departure desk with practiced bureaucratic
precision. The clerk, a six-eyed bureaucrat from Rigel IV,
scrutinizes your paperwork. [🎲 Bureaucracy DC10 → 14 ✅]
They stamp it with unnecessary vigor. Engineer Grom nods
approvingly from the corner."
```

**Connected UI Components:**
```
┌────────────────────────────────────────┐
│  TurnCard Component                    │
├────────────────────────────────────────┤
│  Turn 1:                               │
│  ┌──────────────────────────────────┐  │
│  │ Narrative text (4-8 sentences)   │  │ ← FROM turn_generation
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ CheckDisplay                     │  │
│  │ 🎲 Bureaucracy DC10 → 14 ✅      │  │ ← Embedded in narrative
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ DeltaDisplay                     │  │
│  │ 📊 Hull +2, Morale +1            │  │ ← Shown after narrative
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

---

### 4. action_generation

**When Called:** 
- After game starts
- After every player action (for next turn)

**Purpose:** Generate 6 contextual action buttons

**Variables:**
```
{{DAY}}                    - Current day
{{TURN_NUMBER}}            - Current turn
{{SEGMENT}}                - Story segment
{{RECENT_EVENT}}           - Last thing that happened
{{CRITICAL_STATS}}         - Stats below 40
{{CURRENT_NARRATIVE}}      - Complete narrative from previous turn (full text)
{{EQUIPPED_ITEMS_DETAIL}}  - Full item descriptions
```

**Important:** The action_generation prompt receives the full narrative text from the previous turn (not a truncated snippet) so actions can reference specific details.

**Output Format (JSON):**
```json
[
  {
    "action": "File departure paperwork",
    "summary": "Bureaucracy solves everything. Eventually.",
    "risk": "Safe",
    "intent": "command"
  }
  // ... 5 more
]
```

**Connected UI Components:**
```
┌────────────────────────────────────────┐
│  ActionChip Component (×6)             │
├────────────────────────────────────────┤
│  🟢 File departure paperwork  | Summary | [Safe · Command]
│  🟡 Repair hull breach        | Summary | [Risky · Repair]
│  🔴 Challenge coffee union    | Summary | [Wild  · Negotiate]
│  [+ 3 more]
└────────────────────────────────────────┘
```

**Risk Color Mapping (typical guidance):**
- 🟢 Safe (green) - DC 10
- 🟡 Risky (yellow) - DC 14
- 🔴 Wild (red) - DC 18

---

### 5. intent_mapping

**When Called:** Only when player types custom action text

**Purpose:** Categorize custom text into one of 8 intent types

**Variables:**
```
{{CUSTOM_ACTION}}  - Player's typed text
```

**Valid Intents:**
```
repair, negotiate, cook, explore, improvise, research, command, other
```

**Output Format (plain text):**
```
"negotiate"
```

---

### 6. interview_answer

**When Called:** Pre-flight setup in interview contexts (Dev or onboarding features).

**Purpose:** Short in-voice answer for pre-flight questions.

**Variables:**
```
{{CURRENT_QUESTION}}
```

**Output:**
- 1–2 sentences of prose.

---

### 7. Image Prompts (Dev Tools → Image Prompts)

Templates:
- `name`, `promptTemplate`, `inheritVisualStyle` (0/1), `size` (1024x1024|1536x1024|1024x1536), `quality` (auto|low|medium|high), `description`, `sceneTypes`, `tags`, `active`

Shared Style (if enabled):
- Prepends `visual_style_prompt` content to the image `promptTemplate`.

Global Settings (Prompts):
- `image_background_setting` → `auto` | `transparent` | `opaque` (**Moved to app_settings**)
- `image_moderation_setting` → `auto` | `low` (**Moved to app_settings**)
- `image_model_key_default` → default model key (e.g., `gpt-image-1-mini`)

Common variables available when rendering:
```
{{CURRENT_NARRATIVE}}, {{SEGMENT}}, {{DAY}}
{{HULL}}, {{OXYGEN}}, {{FUEL}}, {{FOOD}}, {{MORALE}}
{{EQUIPPED_ITEMS}}, {{NPC_SUMMARY}}
{{INTERVIEW_*}} (optional)
```

Calls:
- `generateImage(templateName)`
- `testGenerateImage(templateName, variables)`

## Prompt Interaction Matrix

```
┌──────────────────┬───────────────────────┬─────────────┬────────────────┐
│ User Action      │ Prompts Used          │ AI Calls    │ UI Updates     │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Start New Game   │ global + intro +      │ 2 calls     │ TurnCard (0)   │
│                  │ action                │ (parallel)  │ ActionChip ×6  │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Click Action     │ global + turn +       │ 2 calls     │ TurnCard       │
│ Button           │ action                │ (parallel)  │ StatBar ×5     │
│                  │                        │             │ ActionChip ×6  │
├──────────────────┼───────────────────────┼─────────────┼────────────────┤
│ Type Custom      │ global + intent +     │ 3 calls     │ Same as above  │
│ Action           │ turn + action         │ (2 parallel)│                │
└──────────────────┴───────────────────────┴─────────────┴────────────────┘
```

## AI Call Timing

```
GAME START:
  ├─ 1 AI call: generateIntroTurnContent() (1–2 seconds)
  └─ 1 AI call: generateActions()      (1–2 seconds)
  Total: ~2–4 seconds (calls run in parallel)

NORMAL ACTION:
  ├─ 1 AI call: generateNarrative() (1–2 seconds)
  └─ 1 AI call: generateActions()  (1–2 seconds)
  Total: ~2–4 seconds (calls run in parallel)

CUSTOM ACTION:
  ├─ 1 AI call: mapCustomActionToIntent() (≤1 second)
  ├─ 1 AI call: generateNarrative()       (1–2 seconds)
  └─ 1 AI call: generateActions()         (1–2 seconds)
  Total: ~2.5–4.5 seconds (narrative + actions run in parallel)
```

## Prompt Variables Summary

### Variables by Source

**From Game State:**
- Turn/Day/Segment info
- All stats (hull, oxygen, fuel, food, morale, weirdness)
- NPC data (affinity, status)
- Equipped items
- Running gags
- Event history

**From Player Input:**
- Player action text
- Custom action text

**From Game Engine:**
- Skill check results (d20 roll, DC, success/fail)
- Critical stats (below threshold)

**From Settings:**
- Absurdity level (0–3), image defaults

### Variable Usage by Prompt

```
global_system_prompt:
  └─ (no variables)

intro_generation:
  ├─ HULL, OXYGEN, FUEL, FOOD, MORALE
  ├─ EQUIPPED_ITEMS
  └─ NPC_SUMMARY

turn_generation:
  ├─ TURN_NUMBER, DAY, SEGMENT
  ├─ HULL, OXYGEN, FUEL, FOOD, MORALE
  ├─ EQUIPPED_ITEMS
  ├─ NPC_SUMMARY
  ├─ PLAYER_ACTION
  ├─ CHECKS (skill check results)
  ├─ RECENT_TURNS
  ├─ RUNNING_GAGS
  ├─ TRIGGERED_EVENT

action_generation:
  ├─ DAY, TURN_NUMBER, SEGMENT
  ├─ RECENT_EVENT
  ├─ CRITICAL_STATS
  ├─ CURRENT_NARRATIVE
  └─ EQUIPPED_ITEMS_DETAIL

intent_mapping:
  └─ CUSTOM_ACTION

image prompts (by template):
  ├─ CURRENT_NARRATIVE, SEGMENT, DAY
  ├─ HULL, OXYGEN, FUEL, FOOD, MORALE
  └─ EQUIPPED_ITEMS, NPC_SUMMARY
```

## UI Component Dependencies

```
GamePage.tsx (Router Component)
│
├─ MobileGamePage.tsx
│  ├─ CompactStat ×5 (mobile stats)
│  ├─ StatBar ×0 (desktop only)
│  └─ Mobile-optimized layout
│
├─ DesktopGamePage.tsx
│  ├─ StatBar ×5 (desktop stats)
│  ├─ CompactStat ×0 (mobile only)
│  └─ Desktop sidebar layout
│
└─ useGameLogic.ts (Shared Logic)
   ├─ State management
   ├─ API calls
   └─ Event handlers
│
├─ WeirdnessMeter
│  └─ Updated from: Game state (not AI)
│
├─ NPCCard ×3
│  └─ Updated from: Game state + turn_generation influence
│
├─ ItemCard ×6
│  └─ Static (not AI-generated)
│
├─ TurnCard
│  ├─ Turn 0 narrative
│  │  └─ FROM: intro_generation prompt
│  ├─ Turn 1+ narratives
│  │  └─ FROM: turn_generation prompt
│  ├─ CheckDisplay (inline)
│  │  └─ FROM: turn_generation (embeds check results)
│  └─ DeltaDisplay
│     └─ FROM: Game engine calculations (not AI)
│
└─ ActionChip ×6
   └─ FROM: action_generation prompt
```

## Editing Prompts Impact

**If you edit global_system_prompt:**
- ✅ Changes tone of ALL narratives
- ✅ Changes action button humor
- ✅ Affects running gag frequency
- ❌ Doesn't change game mechanics

**If you edit intro_generation:**
- ✅ Changes Turn 0 opening scene
- ✅ Affects player's first impression
- ✅ Can adjust introduction length/style
- ❌ Only affects game start (not subsequent turns)
- ❌ Doesn't affect action buttons

**If you edit turn_generation:**
- ✅ Changes TurnCard narrative style
- ✅ Can adjust narrative length
- ✅ Can change how checks are described
- ❌ Doesn't affect action buttons

**If you edit action_generation:**
- ✅ Changes ActionChip text/style
- ✅ Can adjust action button length
- ✅ Can influence risk distribution
- ❌ Doesn't affect narratives

**If you edit intent_mapping:**
- ✅ Changes how custom actions are categorized
- ✅ Affects which skills are used
- ❌ Only impacts custom actions (not button clicks)
- ❌ Doesn't affect UI appearance

## Key Takeaways

1. **global_system_prompt** = Universal narrator voice (used in every text AI call)
2. **intro_generation** = Turn 0 opening scene (game start only)
3. **turn_generation** = Story text in TurnCard (Turn 1+)
4. **action_generation** = 6 action buttons
5. **intent_mapping** = Backend helper for custom actions
6. **interview_answer** = Short pre-flight responses
7. **image prompts** = Visual scene generation with shared style

The prompts work together to create a cohesive narrative experience where:
- Game starts with an introduction scene (intro_generation)
- Every turn gets a unique story (turn_generation)
- Every turn gets 6 contextual choices (action_generation)
- The narrator's voice stays consistent (global_system_prompt)
- Players can type anything they want (intent_mapping)
- Optional: images generated via image prompts (with visual_style inheritance)
