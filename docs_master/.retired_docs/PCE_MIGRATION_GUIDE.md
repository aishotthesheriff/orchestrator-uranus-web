# Prompt Composition Engine (PCE) Migration Guide

This document describes how to migrate the Quest to Uranus runtime from the current prompt stack to the Prompt Composition Engine described in _Prompt Composition Engine (PCE) — Architecture & Engineering Specification v1.0 (October 2025)_. It assumes the theme, mood, and style catalogs are stored in the database, published through `app_settings`, and exposed to players through the in-game settings UI.

---

## Purpose

- Produce narration and image prompts from a single multi-persona meta prompt, guaranteeing synchronized storytelling and visuals.
- Parse and store both fields from the model response as strict JSON (`{"narration": "...", "image_prompt": "..."}`).
- Retire the dependency on standalone image prompt templates once the new flow is stable, while preserving existing cache, logging, and fallback behavior.

---

## Current-State Snapshot

### Narrative pipeline

- `server/aiService.ts:247-324` (`generateNarrative`) renders prose by filling the `turn_generation` template with runtime variables and calling `gpt-4o-mini`. The function returns a plain string and stores it directly on each turn.
- The prompt separation (`getPromptFromCache`) allows live edits via the Dev Tools but does not expose image instructions.

### Image pipeline

- `server/aiService.ts:509-719` (`generateImage`) loads a named entry from the `image_prompts` reference, merges shared style instructions, replaces `{{VARIABLES}}`, and feeds the result into the image provider. Cache keys and analytics are keyed by `templateName`, `promptHash`, and `variablesHash`.
- Reference data (`shared/schema.ts:418-459`) stores turns with optional `imageUrl`, `imageTemplate`, and job metadata, but no raw prompt.

### Tooling & observability

- `docs_master/PROMPT_MAINTAINER_GUIDE.md` documents distinct templates for text and image.
- LLM logs (`llm_logs` table) assume single-output text for narratives and text-only prompts for image jobs.

---

## Target PCE Model

The PCE meta prompt (see spec) acts as a two-stage creative system:

1. Narrator persona generates 3–6 sentences of in-world prose that honors the selected `THEME`, `MOOD`, and runtime `CONTENT`.
2. Visualizer persona returns a single paragraph describing the same moment, ending with the verbatim `STYLE` label.

Key properties:

- One LLM call yields both `"narration"` and `"image_prompt"` in strict JSON.
- Themes, moods, and styles are curated enumerations selectable per game/session.
- Runtime `CONTENT` bundles current turn context (action, stats, NPCs, running gags, etc.).
- The image prompt must flow directly into the image model, optionally after light validation, without another template pass.

---

## Gap Analysis

- **Data model**: `Turn` lacks a place to persist `image_prompt`; `GameState` has no theme/mood/style fields.
- **Prompt infrastructure**: No builder for the multi-persona instructions; existing templates produce single-output prose.
- **Image generation**: The pipeline assumes a template name; cache fingerprints hinge on `templateName`.
- **Client UX**: UI surfaces template names and manual overrides but not a raw prompt coming from the narrative call.
- **Observability & tooling**: Admin tools expect separate template inventories; test harnesses (`server/routes.ts:900-1040`) and vitest mocks assume string responses.

---

## Migration Plan

### Phase 0 – Alignment & prerequisites

1. **Confirm creative defaults**: Pick default `THEME`, `MOOD`, `STYLE` that match the current voice (e.g., Theme=`Corporate AI Satire`, Mood derived from `absurdity`, Style=`Sierra VGA 1989`).
2. **Decide ownership of selector UI**: Confirm the in-game settings menu controls the per-save theme/mood/style selections and how those map onto stored player preferences vs. transient session overrides.
3. **Document runtime content contract**: Map which game fields feed into `CONTENT` (player action, stats, checks, NPC states, running gags, triggered events, etc.).
4. **Define persistence rules**: Decide whether player selections write to the `games` row, a user profile defaults table, or both, and how they interact with existing settings APIs.

Deliverable: signed-off data dictionary for the meta prompt inputs.

**Status:** Complete. Creative catalogs live in `app_settings` (`pce_*` keys) and defaults are published via `pce_defaults`. Player selections are stored on the `games` row and surfaced in the settings dialog.

### Phase 1 – Data model & reference updates

1. **Schema changes**:
   - Extend `Turn` (`shared/schema.ts`) with `imagePrompt?: string` and, if needed, `imageStyle?: string`.
   - Extend `GameState` with `theme`, `mood`, `style` fields (defaults derived server-side if absent).
   - Add a migration for `generated_images` to track `promptSource` (`"pce"` vs `"template"`) and store the raw prompt string for audit/cache reuse.
2. **Reference pack**:
   - Publish `theme`, `mood`, `style` enumerations in `app_settings` (or a dedicated `creative_settings` table) so they deploy with the reference bundle and remain editable from Dev Tools.
   - Store machine-readable keys, display labels, descriptions, and optional default weights to support the settings UI.
   - Add the PCE instruction block as a new prompt template (`pce_turn_generation`) so it can be hotfix-ed without redeploys.

Deliverable: database migration scripts, schema updates, and reference export changes ready for review, including pre-seeded settings records for the starter catalogs.

**Status:** Complete. Migration `20251105_pce_phase1.sql` adds the new columns, seeds theme/mood/style catalogs, and records prompt provenance in `generated_images`.

### Phase 2 – Meta prompt integration

1. **Builder module**: Create `server/pce/promptBuilder.ts` (or similar) that implements `buildMetaPrompt(theme, mood, style, content)` using the spec template.
2. **New service entry point**:
   - Replace `generateNarrative` with `generateTurnContent` that calls the builder, submits the prompt to OpenAI with `response_format: { type: "json_object" }`, and returns `{ narration, imagePrompt }`.
   - Retain `generateNarrative` as a thin wrapper returning `turnContent.narration` until API callers migrate.
3. **Runtime content assembly**: Extract a helper to produce the `CONTENT` blob from `GameState` (reuse the variable-building logic now used for `turn_generation`; cross-check `docs_master/PROMPT_VARIABLES.md` for the current injection catalog).
4. **Error handling**: Implement JSON validation and fallback behavior (e.g., default to legacy narrative generation or inject minimal placeholders if parsing fails).
5. **Logging**: Update `logLlmCall` metadata to save both narration and image prompt plus selected theme/mood/style for observability.

Deliverable: End-to-end turn generation returning JSON, unit tests verifying parsing, and a feature flag (`app_settings.pce_enabled`) gating adoption.

**Status:** Complete. `generateTurnContent` now drives the turn loop, persisting both narration and image prompts with a legacy fallback. Logging captures the resolved creative selections for observability.

### Phase 3 – Image pipeline refactor

1. **API shape**: Allow `generateImage` to accept either a template name or a raw prompt payload. Introduce `generateImageFromPrompt({ prompt, style, settings })`.
2. **Cache adjustments**:
   - Swap `templateName` for a logical key (e.g., `"pce_turn"`) when the source is PCE.
   - Hash on the exact `image_prompt` string plus deterministic metadata (`theme`, `mood`, `style`, `absurdity`, etc.) to preserve cache hit rates.
   - Store raw prompt text in `generated_images.metadata.promptUsed` (already present) and optionally `imagePrompt` at the turn level to support manual replays.
3. **Settings inheritance**: Retain `visual_style_prompt` for legacy templates but ensure the PCE path respects the STYLE already appended by the meta prompt (no duplicate suffix).
4. **Backwards compatibility**: Preserve the existing template workflow behind a flag for manual jobs until Dev Tools adopts the new flow.

Deliverable: Updated image generation service with dual-path support, cache migration notes, and regression tests for exact and similarity cache hits.

**Status:** Implemented core refactor. Image generation reuses turn-level PCE prompts (with cache provenance via `promptSource`/`promptText`) and the settings API now accepts creative overrides. Decision: purge legacy caches/games prior to launch instead of maintaining mixed similarity heuristics; documentation/dev tooling updates will happen as part of code cleanup.

### Phase 4 – Client & UX updates

1. **State propagation**: Include `imagePrompt` in API responses (REST + socket payloads) so the UI can display/edit the prompt if needed.
2. **Creative settings control**: Embed pickers in the in-game settings menu (`useGameLogic` consumer components, e.g., `DesktopGamePage` / `MobileGamePage`) so players can choose theme, mood, style, image model, and absurdity per save from one consolidated control. Persist selections through the settings endpoint and include them in every `GameState` payload.
3. **Manual image dialog**: Replace template dropdowns with read-only prompt previews (or editable fields if desired) and show the STYLE label for clarity.
4. **Telemetry**: Add UI-level tracking for manual overrides vs. auto-generated prompts.
5. **Routes & persistence**: Update the game settings API (`server/routes.ts`) and storage layer to read/write the new fields, ensuring sync with `app_settings` defaults when a player has not customized their save.

Deliverable: Updated React hooks (`client/src/hooks/useGameLogic.ts`), settings pages, and API handlers to read/write the new fields, with fallbacks when the flag is off.

**Status:** Complete. Desktop and mobile settings dialogs now surface creative selectors backed by `useGameLogic`, and turn cards display the generated `imagePrompt`.

### Phase 5 – QA, rollout, and cleanup

1. **Testing**:
   - Unit tests for the prompt builder and JSON parser (Vitest in `server/aiService.test.ts`).
   - Integration smoke tests via `/api/test/llm/narrative` and `/api/test/llm/image` harnesses, ensuring JSON validity.
   - Regression suite covering cache reuse and failure fallbacks.
2. **Backfill & migration**:
   - For active games, write a migration job to set default theme/mood/style and optionally seed `imagePrompt` using the latest narrative until new turns are generated.
   - Decide whether to re-run image generation for existing turns (likely unnecessary).
3. **Rollout plan**:
   - Enable `pce_enabled` for internal environments, monitor LLM logs for JSON compliance, then expand to production.
   - Once stable, retire `image_prompts` entries that are no longer referenced and clean up UI components that exposed template names.
4. **Documentation updates**: Refresh `PROMPT_MAINTAINER_GUIDE.md`, `AI_SERVICES.md`, and any operational runbooks to describe the unified flow.

Deliverable: Signed-off release checklist, updated documentation, and clear rollback instructions (toggle flag + revert to legacy prompt/template).

**Status:** Planned as manual QA pass with feature flag fully cut over (legacy prompt path removed). Rollout will occur via full production switch once manual validation completes, with monitoring trained on the new PCE telemetry.

---

## Design Decisions & Outcomes

- **Creative catalogs in `app_settings`:** Starter theme/mood/style sets are stored as JSON arrays (`pce_themes`, `pce_moods`, `pce_styles`) with human-readable labels and optional descriptions to keep the UI and reference pack aligned.
- **Per-turn prompt persistence:** Each turn now stores `imagePrompt` and `imageStyle`, allowing regeneration without re-querying the LLM and enabling cache keys based on the actual prompt text.
- **Unified image pipeline:** `generateImage` accepts PCE-driven prompts while remaining compatible with legacy templates by tagging cache entries with `promptSource` (`"pce"` vs `"template"`). Legacy caches/games will be wiped during cutover to avoid stale entries.
- **Player-facing creative settings:** Game creation defaults are resolved through the catalogs and exposed in the in-game settings dialog, with updates (theme, mood, style, image model, absurdity dial) persisted on the `games` row for the current save.
- **Fallback strategy:** When the PCE pipeline fails to parse JSON, the system falls back to the legacy `turn_generation` prompt and records the event with `mode: "pce-fallback"` for observability.
- **Client visibility:** Turn cards surface the generated image prompt for debugging, and manual “visualize” actions reuse the per-turn prompt to keep art aligned with narration.
- **Operational posture:** We are aiming for a full cutover (no dual-mode support). Monitoring should watch for `mode: "pce-fallback"` spikes after enablement.

---

## Testing Strategy & Tooling Updates

- Extend `server/aiService.test.ts` to cover success, malformed JSON, and fallback paths for `generateTurnContent`.
- Add snapshot samples of valid PCE responses for regression.
- Update CLI tooling (e.g., `/api/test/llm/narrative`) to print both narration and image prompt, plus the resolved theme/mood/style selections for traceability.
- Ensure the Dev Tools log viewer displays `image_prompt` content without breaking existing log parsing.
- Manual QA checklist: play 2–3 full runs post-cutover, validate image prompts match narration, confirm settings changes propagate, and review LLM logs for `mode: "pce-fallback"` anomalies.

---

## Rollout & Fallback Checklist

- Feature flag default: `OFF` in production, `ON` in staging once QA passes.
- Rollback: disable flag, revert to legacy prompt template names; no DB rollback required if new columns are nullable.
- Monitor: LLM error rate, cache hit ratio, image generation latency, and narrative sentiment consistency.

---

## Open Questions

1. How do we derive `MOOD` each turn—static per game, auto-mapped from `absurdity`, or author-controlled per event? **Resolution:** keep player-selected mood constant until narrative design requests dynamic overrides.
2. Should we persist multi-persona narrators (e.g., allow narrator override per theme) or keep a single narrator voice? **TBD:** revisit after first release; full cutover keeps current narrator.
3. Do we retire `image_prompts` entirely or keep them for scripted cut-scenes? **Resolution:** retire during cutover; remaining references will be removed with the cache wipe.
4. What validation (if any) is required on the returned `image_prompt` before handing it to image models (safety filters, token budgets)? **Resolution:** rely on manual QA plus provider safety filters for initial release; add automated validation only if issues emerge.

Answering these will finalize the migration scope and help size the rollout. Once resolved, treat this guide as the canonical implementation plan.
