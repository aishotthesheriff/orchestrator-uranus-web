# Quest to Uranus - Prompt Variable Reference

This document describes all variables available for use in AI prompt templates. Variables use the `{{VARIABLE_NAME}}` syntax and are replaced at runtime with actual game state values.

## Understanding Global System Prompt & Inheritance

System Architecture: The game uses a global system prompt that establishes E.L.O.N.'s voice and personality. Each AI scenario can either inherit and extend this global prompt or completely override it.

### Global System Prompt (`global_system_prompt`)

Defines:
- E.L.O.N.'s personality and narrative voice
- Core game rules and constraints

Location: Stored as a prompt template named `global_system_prompt`

### Scenario-Specific Prompts

Each scenario (intro_generation, turn_generation, action_generation, intent_mapping, interview_answer) has two components:
1. System Prompt (Optional): Scenario-specific system instructions
2. User Prompt (Required): Main instructions with game state variables

### Inheritance System

Each scenario has an "Inherit Global System Prompt" checkbox in Dev Tools:

When CHECKED (Inherit = 1):
- Final system prompt = `global_system_prompt` + scenario's system content

When UNCHECKED (Inherit = 0):
- Final system prompt = scenario's system content only (complete override)

Editing in Dev Tools:
- The checkbox and a "System Prompt" textarea appear for all prompts except `global_system_prompt` itself.
- "User Prompt" is always required.

Example:
- Extending: global_system_prompt + "\n\n" + extension
- Override: only the scenario's system content

## System-Wide Variables

These variables are available in all text prompts:

### Interview Responses
- All interview answers are injected as variables prefixed with `INTERVIEW_`
- Example: If the question variableName is `captainMotivation`, you can use `{{INTERVIEW_captainMotivation}}`

---

## Prompt-Specific Variables

### 1. `global_system_prompt`
- Available Variables: (none — narrator tone is managed internally)

---

### 2. `intro_generation`
Generates the opening narrative when starting a new game (Turn 0).

Available Variables:
- `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}` — numbers (0–100)
- `{{EQUIPPED_ITEMS}}` — string ("Duct Tape Deluxe (🔧), Manual (📖)")
- `{{NPC_SUMMARY}}` — string ("Pilot Lyra (Navigator), Engineer Grom (Chief Engineer)")

Source Code: `server/aiService.ts` → `generateIntroTurnContent()`

---

### 3. `turn_generation`
Generates narrative for each turn after a player action.

Available Variables:
- `{{TURN_NUMBER}}` — number (1+)
- `{{DAY}}` — number (1+)
- `{{SEGMENT}}` — "Departure" | "Belt" | "Outer Darkness" | "Approach"
- `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}` — numbers (0–100)
- `{{EQUIPPED_ITEMS}}` — string
- `{{NPC_SUMMARY}}` — string with affinity/status
- `{{PLAYER_ACTION}}` — string
- `{{CHECKS}}` — formatted lines "- Skill DCX: Rolled Y ✅/❌"
- `{{RECENT_TURNS}}` — last 3 turn summaries
- `{{RUNNING_GAGS}}` — up to 3 gags
- `{{TRIGGERED_EVENT}}` — "Name (Segment segment - Skill challenge)"
- `{{INTERVIEW_*}}` — interview response variables (optional)

Source Code: `server/aiService.ts` → `generateNarrative()`

---

### 4. `action_generation`
Generates 6 action chips for the player to choose from.

Available Variables:
- `{{DAY}}` — number
- `{{TURN_NUMBER}}` — number
- `{{SEGMENT}}` — string
- `{{RECENT_EVENT}}` — last triggered event ID or default like "routine space operations"
- `{{CRITICAL_STATS}}` — string ("hull is low, oxygen is low …") based on thresholds
- `{{CURRENT_NARRATIVE}}` — full text of most recent narrative
- `{{EQUIPPED_ITEMS_DETAIL}}` — multi-line detail list ("- Duct Tape Deluxe (🔧): …" or "- None")
- `{{INTERVIEW_*}}` — interview response variables (optional)

Critical Stats Thresholds:
- Hull/Oxygen/Fuel/Food/Morale: < 40 → "low"
- Weirdness: ≥ 4 → "critical"

Expected Response Format:
- JSON array with exactly 6 objects; keys: `action`, `summary`, `risk`, `intent`

Source Code: `server/aiService.ts` → `generateActions()`

Important name correction:
- Use `{{CURRENT_NARRATIVE}}` (not `{{LAST_NARRATIVE}}`)

---

### 5. `intent_mapping`
Maps custom player text to an intent category.

Available Variables:
- `{{CUSTOM_ACTION}}` — raw text

Valid Intents:
- `repair`, `negotiate`, `cook`, `explore`, `improvise`, `research`, `command`, `other`

Expected Response:
- Single word intent category

Source Code: `server/aiService.ts` → `mapCustomActionToIntent()`

---

### 6. `interview_answer`
Generates a short in-voice answer to pre-flight questions.

Available Variables:
- `{{CURRENT_QUESTION}}` — the active question

Expected Response:
- 1–2 sentences in E.L.O.N.'s voice

Source Code: `server/aiService.ts` → `generateInterviewAnswer()`

---

## Image Prompt Templates

Managed in Dev Tools → Image Prompts tab. These are separate from the text prompts above.

Template fields:
- `name`, `promptTemplate`, `inheritVisualStyle` (0/1), `size` (1024x1024|1536x1024|1024x1536), `quality` (auto|low|medium|high), `description`, `sceneTypes`, `tags`, `active`

Variables typically available when rendering:
- `{{CURRENT_NARRATIVE}}`, `{{SEGMENT}}`, `{{DAY}}`
- `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}`
- `{{EQUIPPED_ITEMS}}`, `{{NPC_SUMMARY}}`
- `{{INTERVIEW_*}}` (if needed)

Inheritance:
- If `inheritVisualStyle` = 1, the `visual_style_prompt` content is prepended automatically.

Global image settings (edited in Prompts tab or Settings tab):
- `image_background_setting` → `auto` | `transparent` | `opaque` (**Moved to app_settings**)
- `image_moderation_setting` → `auto` | `low` (**Moved to app_settings**)
- `image_model_key_default` → default model key (e.g., `gpt-image-1-mini`)

Model inventory note:
- The set of available image model keys (and their provider/modelName/hfProvider mappings) is managed in the published reference/DB and may change via Dev Tools without code edits. Templates reference model keys, not provider details.

Source Code:
- `server/aiService.ts` → `getImagePromptByName()`, `generateImage()`, `testGenerateImage()`

---

## Variable Data Flow

- Variables replaced via regex: `{{KEY}}` → value
- Unknown variables are left unreplaced
- Variables may appear multiple times in both system and user prompts
- Interview answers are auto-injected as `INTERVIEW_*`

---

## Editing Prompt Templates

In Dev Tools UI:
1. Navigate to Dev Tools → Prompts tab
2. Select a prompt template
3. Edit "System Prompt" (if shown) and "User Prompt"
4. Click "Save Changes" (changes are applied immediately; no bulk refresh needed)

Best Practices:
- Test replacements in LLM Logs
- Keep names/cases exact for variables
- For new variables, add them in the corresponding service function and pass into the `replaceVariables` call

Adding New Variables:
1. Update the AI function (e.g., `generateNarrative()`)
2. Include the new variable in the variables object
3. Use `{{NEW_VARIABLE}}` in the template
4. Update this doc and the prompt description in the DB

---

## Related Files

- Prompt Cache & Interpolation: `server/aiService.ts`
- Dev Tools UI: `client/src/pages/DevToolsPage.tsx`
- Database Schema: `shared/schema.ts` (`systemContent`, `inheritGlobalPrompt`, etc.)
- Runtime Prompt Store: `releases/<version>/prompts.json` (managed by the reference release manifest)
- Image Generation & Cache: `server/image/*`, `server/cacheUtils.ts`

Last Updated: October 28, 2025  
Game Version: Quest to Uranus v1.0
