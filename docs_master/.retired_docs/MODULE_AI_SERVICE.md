# Module: AI Service (Narrative, Actions, Images, PCE)

- File: `server/aiService.ts`
- Purpose: Central AI orchestration for narrative and action generation, image prompt building and generation with caching, and interview question responses. Supports dual paths: Prompt Composition Engine (PCE) and Legacy templates.

## Overview
- Provides high-level functions used by routes and game logic to generate turn content, actions, and images.
- Integrates with reference data (prompts, image templates, settings), storage (LLM logs, images), and Socket.IO for optional live LLM log streaming.
- Abstracts image providers behind a model-key interface via `./image/index.js`.

## Public API (Selected)
- PCE enablement toggle: `isPceEnabled()` — `server/aiService.ts:123-138`
- **Primary entry point**: `generateTurnContentWithFlag(...)` — `server/aiService.ts:1111-1163`
  - Routes intro/regular turns to PCE or Legacy based on `isPceEnabled()`
  - Intro turns: when PCE enabled, calls `generateTurnContent` with default intro values
  - Regular turns: uses PCE path if enabled, otherwise Legacy
- **Deprecated**: `generateIntroTurnContent(...)` — `server/aiService.ts:346-631`
  - Marked deprecated, warns if called with PCE enabled
  - Kept for legacy compatibility when PCE is disabled
- Turn content (PCE path): `generateTurnContent(...)` — `server/aiService.ts:840-1109`
  - Handles both intro and regular turns via PCE
  - Returns `TurnContentResult` with narration, imagePrompt, rawResponse, and PCE selections
  - Falls back to Legacy narrative if PCE fails
- Narrative (PCE or Legacy): `generateNarrative(...)` — `server/aiService.ts:1165-1179`
- Action chips: `generateActions(...)` — `server/aiService.ts:1181-1293`
- Map custom text to intent: `mapCustomActionToIntent(...)` — `server/aiService.ts:1295-1346`
- Image generation with caching: `generateImage(...)` — `server/aiService.ts:1438-1689`
- Hash computation only: `computeImageKeys(...)` — `server/aiService.ts:1692-1711`
- Cache-only check: `checkImageCache(...)` — `server/aiService.ts:1713-1806`
- Ad-hoc image gen for dev tools: `testGenerateImage(...)` — `server/aiService.ts:1808-1904`
- Interview answer: `generateInterviewAnswer(...)` — `server/aiService.ts:1906-1954`

## Helper Functions (Internal)
- Item retrieval: `getItemById(id)`, `getEquippedItems(ids)` — `server/aiService.ts:42-65`
- Reference access: `getPromptFromCache(name)`, `getSettingFromReference(key)`, `getImagePromptByName(name)` — `server/aiService.ts:67-177`
- Variable replacement: `replaceVariables(template, variables)`, `addInterviewResponsesToVariables(variables, state)` — `server/aiService.ts:179-204`
- Default image model: `getDefaultImageModelKey()` — `server/aiService.ts:110-121`
- State summarization: `summarizeChecks()`, `summarizeNpcs()`, `summarizeEquippedItems()`, `summarizeRecentTurns()`, `summarizeInterviewResponses()` — `server/aiService.ts:730-778`
- PCE content builder: `buildPceContent(...)` — `server/aiService.ts:780-822`

## Prompt Composition Engine (PCE)
- Uses `buildMetaPrompt(...)` with validated variables to produce single system prompts that return JSON outputs for narration and image_prompt.
- For intro and regular turns: builds variables from game state, selections, checks, items, NPCs, and interview responses; validates no unreplaced placeholders: `server/aiService.ts:510-518`, `server/aiService.ts:986-994`
- Variable building includes full theme/style/imageModel objects with mapped compatibility properties (`label`, `description`) — `server/aiService.ts:454-465`, `server/aiService.ts:932-941`
- Uses `buildModelInstructionSet(imageModel.class)` to provide model-specific style/output/example instructions — `server/aiService.ts:420-421`, `server/aiService.ts:911-912`
- Falls back to Legacy narrative generation if PCE fails with detailed log metadata: `server/aiService.ts:1069-1108`
- Handles diffuser models where `image_prompt` may be an object (stringified for compatibility) — `server/aiService.ts:544-550`, `server/aiService.ts:1019-1026`

## Legacy Path
- Uses reference prompts via `getPromptFromCache(name)` and variable replacement: `server/aiService.ts:663-685`
- Intro: `runIntroPrompt(...)` — `server/aiService.ts:271-340`
- Turn narrative: `legacyGenerateNarrative(...)` — `server/aiService.ts:633-728`

## Image Generation & Caching
- **Prompt context builder**: `buildImagePromptContext(...)` — `server/aiService.ts:1367-1436`
  - Prioritizes PCE-generated image prompts from turn state (`targetTurn?.imagePrompt`)
  - Falls back to template-based prompts with variable substitution
  - Returns context with `promptSource` ('pce' | 'template') and `effectiveTemplateName`
- **Cache lookup strategies**:
  - Exact match by prompt + variables hash (`getGeneratedImageByHash`)
  - Similar scene match via fingerprint similarity (`findSimilarScenes`) with 0.85 threshold
- **Hashes & scene fingerprint**: `generatePromptHash`, `generateVariablesHash`, `generateSceneFingerprint`: used in `generateImage(...)` — `server/aiService.ts:1454-1470`
- **Provider abstraction**: Fully abstracted via `generateWithModelKey(modelKey, ...)` from `./image/index.js` — `server/aiService.ts:1587-1594`
  - Model key resolution: user preference → default from reference → error if missing
  - Supports multiple image provider backends (OpenAI, Stability AI, etc.)
- **Metadata & storage**: Persists generated files via `saveImageToFile`, stores metadata including theme/style, updates access count on cache hits — `server/aiService.ts:1603-1639`

## LLM Logging
- All AI operations log inputs/outputs, metadata, and timing to DB: `logLlmCall(...)` — `server/aiService.ts:206-269`
- Includes template load metrics snapshot when cache loads change — `server/aiService.ts:218-234`
- Optional Socket.IO broadcast when `CONSOLE_LLM_LOG=true`: `server/aiService.ts:249-265`
- Logs include cache strategy, similarity scores, and model information for images

## Reference Integration
- Accesses prompts (`prompts`, `image_prompts`), settings, and system defaults from the current reference:
  - `getPromptFromCache(name)` with global prompt inheritance — `server/aiService.ts:67-96`
  - `getImagePromptByName(name)` with visual style inheritance — `server/aiService.ts:140-177`
  - `getSettingFromReference(key)` — `server/aiService.ts:98-105`
- Default image model resolution: `getDefaultImageModelKey()` from reference `system_defaults.image_model_key` — `server/aiService.ts:110-121`
- Image settings: `image_background_setting`, `image_moderation_setting` from reference settings

## Environment Variables
- `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` — text generation client: `server/aiService.ts:22-25`
- `OPENAI_API_KEY` — legacy direct OpenAI images client (deprecated; image generation now abstracted via `image/index`) — `server/aiService.ts:28-30`
- `CONSOLE_LLM_LOG` — when `true`, emits LLM logs via Socket.IO: `server/aiService.ts:249-265`

## Dependencies
- Internal: `storage`, `referenceLoader`, `imageStorage`, `cacheUtils`, `pce/promptBuilder`, `pce/modelInstructions`, `pce/settings`, `socketManager`, `image/index`
- External: `openai`

