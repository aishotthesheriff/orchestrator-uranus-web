# Legacy Prompt Stack vs Prompt Composition Engine (PCE)

## Executive Summary
- Legacy: multiple independent prompt templates for text and images; narrative returns a string; images use named templates with variable interpolation.
- PCE: a single meta prompt returns strict JSON with synchronized "narration" and "image_prompt"; images reuse the per-turn prompt; Theme/Mood/Style are first-class and persisted per game.

## High-Level Architecture

Legacy (pre-PCE)
```
Client (GamePage)
  ├─ click → /api/game/action
  │          ├─ generateNarrative(turn_generation + global)
  │          └─ generateActions(action_generation + global)
  └─ (optional) generateImage(image template + visual_style)
```

PCE (current)
```
Client (GamePage)
  ├─ click → /api/game/action
  │          ├─ generateTurnContent(meta prompt → {narration, image_prompt})
  │          ├─ persist turn.imagePrompt + imageStyle
  │          └─ generateActions(action_generation + global)
  └─ (optional) generateImage(pce_turn using turn.imagePrompt)
```

## Data Model
- Legacy
  - Turn: optional imageUrl, imageTemplate; no raw prompt.
  - GameState: no Theme/Mood/Style.
- PCE
  - Turn: adds imagePrompt?, imageStyle?.
  - GameState: adds theme, mood, style (persisted and adjustable).
  - generated_images: adds promptSource ("pce"|"template") and promptText.

## Prompting & Runtime Flows

Narrative generation
- Legacy
  - Templates: global_system_prompt (+inherit), turn_generation user prompt.
  - Output: plain string narrative.
- PCE
  - Template: one meta prompt assembled via buildMetaPrompt(theme, mood, style, content).
  - Output: strict JSON with narration and image_prompt.
  - Fallback: legacy narrative on JSON parse error; logged with mode: "pce-fallback".

Action generation
- Unchanged conceptually; still uses action_generation (JSON array), now with context influenced by the PCE narrative that was just persisted.

Image generation
- Legacy
  - Named image prompt templates + optional visual_style_prompt inheritance; variables interpolated from game state.
  - Cache keyed by templateName, promptHash, variablesHash.
- PCE
  - Primary path uses turn.imagePrompt directly; logical templateName becomes "pce_turn" for cache lineage.
  - Cache records promptSource = "pce", promptText = imagePrompt, and creative selections.
  - Legacy template path remains as a fallback/manual path if no imagePrompt exists.

### Prompt variables and compilation

Legacy
- Text prompts
  - Variable sources (see PROMPT_VARIABLES):
    - Game state: TURN_NUMBER, DAY, SEGMENT, stats, equipped items, NPC summary, RECENT_TURNS, RUNNING_GAGS, TRIGGERED_EVENT
    - Engine output: CHECKS (per-turn check summaries)
    - Player input: PLAYER_ACTION, CUSTOM_ACTION
    - Settings: Absurdity level (handled internally)
    - Interview: INTERVIEW_* auto-injected
  - Compilation steps (server/aiService.ts):
    1) Load prompt via getPromptFromCache(name) which merges inheritance:
       - If inheritGlobalPrompt=1, final system = global_system_prompt + scenario.systemContent; else scenario.systemContent only.
    2) Build variables object; add interview responses via addInterviewResponsesToVariables.
    3) Replace tokens with replaceVariables: `{{KEY}}` → value in both system and user content.
    4) Call OpenAI chat with system/user messages; parse string output.
- Image prompts
  - Template fields: name, promptTemplate, inheritVisualStyle, size, quality, sceneTypes, tags.
  - Visual style inheritance: if inheritVisualStyle, compiledTemplate = promptTemplate + "\n\nSTYLE: " + visual_style_prompt.
  - Variables available: CURRENT_NARRATIVE, SEGMENT, DAY, stats, EQUIPPED_ITEMS, NPC_SUMMARY, optional INTERVIEW_*.
  - Final prompt = replaceVariables(compiledTemplate, variables).

PCE
- Text prompts
  - No per-token interpolation into the meta prompt; instead, the runtime context is condensed into `CONTENT`.
  - Inputs resolved before build:
    - Creative selections: resolvePceSelections(overrides, fallback) → theme, mood, style (catalogs + defaults).
    - CONTENT assembly: buildPceContent(state, action, checks, event, equippedItems) summarizing stats, crew, items, checks, running gags, recent turns, triggered event, absurdity descriptor, interview summaries.
  - Meta prompt compilation: buildMetaPrompt(theme, mood, style, content) produces a single system message that instructs the model to return strict JSON with fields narration and image_prompt.
  - Model call: response_format: { type: "json_object" }; parse JSON; validate both fields present; on parse/validation failure, fall back to legacy narrative generation.
- Image prompts
  - Primary: use the exact per-turn imagePrompt from the PCE response; no additional variable interpolation.
  - Secondary (fallback/manual): same compilation as legacy image templates if no imagePrompt is available.

## Settings & Creative Controls
- Legacy: Absurdity influenced tone via variables; no formal Theme/Mood/Style.
- PCE: Curated catalogs in app_settings (pce_themes, pce_moods, pce_styles) with defaults; selections are resolved server-side and persisted.

## Feature Flag & Compatibility
- pce_enabled (in app_settings):
  - OFF: generateNarrative and turn loop use legacy narrative path and leave imagePrompt empty.
  - ON: generateTurnContent returns JSON; turn stores imagePrompt.
- Legacy intro/actions/intent prompts remain; PCE integrates specifically at turn content generation.

## Observability & Tooling
- Legacy: LLM logs store function, prompt, response (text), and variables.
- PCE: Logs capture mode ("pce", "pce-fallback", "legacy"), resolved Theme/Mood/Style, and contentPreview.
- Dev Tools: Admin hint shows PCE enabled state, last LLM mode, and creative defaults.

## Client & UX
- Legacy: Players saw only narrative and a manual image template chooser.
- PCE: Players can adjust Theme/Mood/Style in settings; TurnCard shows the generated imagePrompt and style for transparency/regeneration.

## Trade-offs
- Benefits
  - Narrative and visual prompts are synchronized by design.
  - Simpler operator UX: fewer templates to curate; creative controls are orthogonal.
  - Better cache reuse: keyed by exact prompt text and selections.
- Risks
  - JSON parsing reliability: mitigated by fallback + tests.
  - Token budget pressure from CONTENT: requires careful content summarization.
  - Dual-mode complexity during rollout: addressed via pce_enabled switch and clear logs.

## Migration Mapping (Legacy → PCE)
- Narrative: generateNarrative → generateTurnContent (wrapper retained for compatibility).
- Image: named template → prefer turn.imagePrompt; cache tagged as pce.
- Data: add imagePrompt per turn; add theme/mood/style per game; record provenance.
- Settings: publish catalogs via app_settings; expose /api/pce/catalogs.
- Flag: gate via pce_enabled for controlled rollout.

## Testing Strategy
- Unit: builder/parsing happy path; malformed JSON → fallback path.
- Integration: /api/test/llm/narrative and /api/test/llm/image include PCE outputs and selections.
- Monitoring: watch mode: "pce-fallback" frequency, cache hit ratios, and narrative/image alignment.

## Reference: Key Implementations
- PCE generation: server/aiService.ts → generateTurnContent, generateTurnContentWithFlag, isPceEnabled.
- Meta prompt: server/pce/promptBuilder.ts.
- Creative catalogs: server/pce/settings.ts, /api/pce/catalogs.
- Turn loop: server/gameLogic.ts (writes imagePrompt, updates selections).
- Image pipeline: server/aiService.ts → generateImage (PCE override path, provenance tagging).
- Admin hint: client/src/pages/DevToolsPage.tsx (PCE status, last mode, defaults).

### Cross-links and code references

- Variable catalog: `docs_master/PROMPT_VARIABLES.md`
- UI flow timing: `docs_master/PROMPT_UI_FLOW.md`
- Legacy compilation helpers and inheritance: `server/aiService.ts`
- PCE builders and catalogs: `server/pce/promptBuilder.ts`, `server/pce/settings.ts`

getPromptFromCache (merges `global_system_prompt` inheritance)
```64:93:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
async function getPromptFromCache(name: string) {
  const reference = await getCurrentReference();
  const prompt = reference.data.prompts.find(p => p.name === name && p.active === 1);
  // Find global system prompt for inheritance
  const globalPrompt = reference.data.prompts.find(p => p.name === 'global_system_prompt' && p.active === 1);
  let systemPrompt: string;
  if (prompt.name === 'global_system_prompt') {
    systemPrompt = prompt.content;
  } else {
    if (prompt.inheritGlobalPrompt === 1 && globalPrompt) {
      systemPrompt = globalPrompt.content;
      if (prompt.systemContent) {
        systemPrompt = systemPrompt + "\n\n" + prompt.systemContent;
      }
    } else {
      systemPrompt = prompt.systemContent || "";
    }
  }
  return { system: systemPrompt, user: prompt.content };
}
```

replaceVariables (legacy token substitution)
```131:140:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
function replaceVariables(template: string, variables: Record<string, any> = {}): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, String(value));
  }
  return result;
}
```

Image template compilation (visual style inheritance)
```112:128:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
const visualStylePrompt = reference.data.prompts.find(p => p.name === 'visual_style_prompt' && p.active === 1);
const visualStyleContent = visualStylePrompt?.content || '';
let compiledTemplate = prompt.promptTemplate;
if (prompt.inheritVisualStyle && visualStyleContent) {
  compiledTemplate = [
    prompt.promptTemplate,
    "",
    `STYLE: ${visualStyleContent}`,
  ].join("\n");
}
return {
  ...prompt,
  compiledTemplate
};
```

buildPceContent (runtime CONTENT assembly)
```402:444:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
function buildPceContent(
  state: GameState,
  playerAction: string,
  checks: any[],
  triggeredEvent: { name: string; segment: string; skill: string } | null | undefined,
  equippedItems: Awaited<ReturnType<typeof getEquippedItems>>
): string {
  const triggeredEventText = triggeredEvent
    ? `${triggeredEvent.name} (${triggeredEvent.segment} / ${triggeredEvent.skill})`
    : "No special events triggered.";
  const statsLine = [
    `Hull ${state.stats.hull}`,
    `Oxygen ${state.stats.oxygen}`,
    `Fuel ${state.stats.fuel}`,
    `Food ${state.stats.food}`,
    `Morale ${state.stats.morale}`,
    `Weirdness ${state.stats.weirdness}`
  ].join(", ");
  // ...
  return [
    "Narrator Persona: E.L.O.N., smug AI announcer.",
    `Turn Context: Day ${state.day}, Segment ${state.segment}, Turn ${state.turnNumber}.`,
    `Player Action: ${playerAction}.`,
    // ...
  ].join("\n");
}
```

buildMetaPrompt (strict JSON contract)
```1:38:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/pce/promptBuilder.ts
export function buildMetaPrompt(theme: string, mood: string, style: string, content: string): string {
  const template = `
You are a two-stage creative system that must output STRICT JSON with two fields only.

INPUTS:
THEME: ${theme}
MOOD: ${mood}
STYLE: ${style}
CONTENT: ${content}
`;
  return template.trim();
}
```

## Variables by prompt (code-derived)

Legacy text prompts
- intro_generation → variables set in `generateIntroTurnContent`
```190:207:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
let variables: Record<string, any> = {
  HULL: state.stats.hull,
  OXYGEN: state.stats.oxygen,
  FUEL: state.stats.fuel,
  FOOD: state.stats.food,
  MORALE: state.stats.morale,
  EQUIPPED_ITEMS: equippedItemNames.join(', ') || 'None',
  NPC_SUMMARY: npcSummary
};
```

- turn_generation → variables set in `legacyGenerateNarrative`
```281:299:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
let variables: Record<string, any> = {
  TURN_NUMBER: state.turnNumber + 1,
  DAY: state.day,
  SEGMENT: state.segment,
  HULL: state.stats.hull,
  OXYGEN: state.stats.oxygen,
  FUEL: state.stats.fuel,
  FOOD: state.stats.food,
  MORALE: state.stats.morale,
  EQUIPPED_ITEMS: equippedItemNames.join(', ') || 'None',
  NPC_SUMMARY: npcSummary,
  PLAYER_ACTION: playerAction,
  CHECKS: checksText,
  RECENT_TURNS: recentTurns || 'This is the first turn.',
  RUNNING_GAGS: state.runningGags.slice(0, 3).join(', ') || 'None yet',
  TRIGGERED_EVENT: triggeredEventText
};
```

- action_generation → variables set in `generateActions`
```600:609:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
let variables: Record<string, any> = {
  DAY: state.day,
  TURN_NUMBER: state.turnNumber,
  SEGMENT: state.segment,
  RECENT_EVENT: triggeredEvents,
  CRITICAL_STATS: criticalStats.join(', ') || 'None',
  CURRENT_NARRATIVE: currentNarrative,
  EQUIPPED_ITEMS_DETAIL: equippedItemsDetail
};
```

- intent_mapping → variables set in `mapCustomActionToIntent`
```694:700:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
const variables = {
  CUSTOM_ACTION: customText
};
```

- interview_answer → variables set in `generateInterviewAnswer`
```1265:1272:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
const variables = {
  CURRENT_QUESTION: question
};
```

Legacy/PCE image prompts
- Runtime image prompt context (prefers PCE turn.imagePrompt)
```771:793:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
const promptOverride = options.promptOverride?.trim() || targetTurn?.imagePrompt?.trim();
if (promptOverride) {
  const variables = {
    THEME: gameState.theme,
    MOOD: gameState.mood,
    STYLE: gameState.style,
    ABSURDITY: gameState.absurdity,
    TURN_NUMBER: turnNumber,
    IMAGE_PROMPT: finalPrompt,
  };
  // promptSource: 'pce', effectiveTemplateName: 'pce_turn'
}
```

- Legacy template variables when no PCE prompt
```807:819:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
const variables = {
  CURRENT_NARRATIVE: currentNarrative,
  SEGMENT: gameState.segment,
  DAY: gameState.day,
  HULL: gameState.stats.hull,
  OXYGEN: gameState.stats.oxygen,
  FUEL: gameState.stats.fuel,
  FOOD: gameState.stats.food,
  MORALE: gameState.stats.morale,
  EQUIPPED_ITEMS: equippedItemSummary.join(', ') || 'None',
  NPC_SUMMARY: npcSummary
};
```

PCE meta prompt inputs (code-derived)
- Creative selections (resolved per request or from game state)
```446:455:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
async function resolveCreativeSelectionsForState(state: GameState): Promise<PceSelection> {
  return resolvePceSelections(
    {},
    {
      theme: state.theme,
      mood: state.mood,
      style: state.style
    }
  );
}
```
- CONTENT assembly fields (summarized into a single string for the meta prompt)
```430:443:/Users/cclayton/dev/ColonyTrail/UranusDungeonGuide/server/aiService.ts
return [
  "Narrator Persona: E.L.O.N., smug AI announcer.",
  `Turn Context: Day ${state.day}, Segment ${state.segment}, Turn ${state.turnNumber}.`,
  `Player Action: ${playerAction}.`,
  `Triggered Event: ${triggeredEventText}`,
  `Skill Checks: ${summarizeChecks(checks)}`,
  `Crew Status: ${summarizeNpcs(state)}`,
  `Equipped Items: ${summarizeEquippedItems(equippedItems)}`,
  `Ship Stats: ${statsLine}.`,
  `Absurdity Meter: Level ${state.absurdity} — ${absurdityDescriptor}.`,
  `Running Gags: ${runningGags}`,
  `Recent Narrative Echoes: ${summarizeRecentTurns(state)}`,
  `Interview Responses: ${interviewSummary}.`
].join("\n");
```
