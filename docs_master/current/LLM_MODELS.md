# Story (LLM) Models

How the game decides which text model writes the story, and how to find, test and release new ones. Image models are covered separately in [AI_SERVICE.md](AI_SERVICE.md).

## What a story model does

Every turn runs four LLM stages: **master** (scene plan), **narrative**, **actions** and **image prompt**. One model, the *story model*, runs all four. Small utility calls (custom-action intent mapping, the interview) always use `gpt-4o-mini` and are not affected.

## Which model a turn uses

Resolved once per turn in `gatherTurnPromptIngredients` (`server/aiService.ts`), in this order:

1. The model the player's **theme forces**, if any.
2. The **player's choice** (Welcome page or Settings).
3. The **default** model (`system_defaults.llm_model_key` in the release).
4. A built-in `gpt-4o-mini`, if nothing above is usable.

An unknown or deactivated model is skipped with a `[LLM]` warning in the server log; it never fails the turn. The choice is read fresh every turn, so a change applies from the player's next turn. Each turn's `promptChain` records the model, catalog key, token usage and JSON quality per stage.

## The catalog: drafts and releases

Models live in the `llm_models` table and are edited in **Dev Tools → LLM Models → Catalog**. Like image models, edits are **drafts**: players see a model only after a reference release is published (Reference tab), which writes `llm_models.json` and the default key into the release.

| Status in the Catalog | Meaning |
| --- | --- |
| Live | Published and offered to players. |
| Unpublished changes | Published, but the draft differs. Players still get the published version. |
| Not published | Active in the table, not in the release yet. Players cannot see it. |
| Inactive | A draft. Not offered. |

**First release after this feature:** a release published before the catalog existed has no `llm_models.json`. Until one is published the game reads the table directly, so active rows are live immediately. The Catalog shows a banner while this is the case.

Players can only select models from the published catalog; `PATCH /api/user/preferences` rejects any other key.

## Workflow: adding a model

All in **Dev Tools → LLM Models**:

1. **Discover**: browse what the providers offer.
   - *Hugging Face: served models* lists live price, context length, JSON-mode support and speed per provider. Expand a row to compare providers and pin one.
   - *Hugging Face: search the Hub* finds community models (roleplay and abliterated fine-tunes) that the served list omits. A model only works if a provider enabled on the Hugging Face account serves it; enable providers at huggingface.co/settings/inference-providers.
   - *OpenAI* lists chat models available to the key.
2. **Playground**: send one prompt (free text or a saved prompt template) to the model.
3. **Qualify**: run a saved PCE Inspector scenario through the real four-stage pipeline, one to five times. Per stage you get success, JSON quality, latency and tokens, plus cost per turn and the generated text. Runs are saved in PCE Inspector with the tag `qualify`.
4. **Add** to the Catalog (from Discover the form is pre-filled). New models start inactive.
5. **Activate**, optionally set as default, then **publish a release**. Publishing warns when there is no default, a model failed its last health check, or a theme forces a model that is not active.

**Check all** in the Catalog sends a tiny prompt to every model. Use it before publishing: providers do drop models.

### Reading qualification results

Qualify runs use the same recovery steps as a live turn (see [When a model gets it wrong](#when-a-model-gets-it-wrong)). Each run gets one verdict:

| Verdict | Meaning | Offer it to players? |
| --- | --- | --- |
| Clean pass | Every stage returned valid JSON on the first try. | Yes. |
| Passed with repairs | The turn completed on the model's own writing, but the game fixed its JSON or asked twice. | Yes, if it is consistent. Retries make turns slower. |
| Needed fallback | Another model had to write at least one stage. | Only if this is rare; players would get a mix of two voices. |
| Failed | No turn. | No. |

The per-stage table shows which stage needed what. A stage marked **cut off** hit its token limit: raise *Min. max tokens* on the catalog row (reasoning models often need about 2000).

### Catalog fields worth knowing

| Field | Effect |
| --- | --- |
| Model key | Stable id stored in player settings and theme overrides. Cannot be changed after creation. |
| Hugging Face provider | Pins one Inference Provider. Use it when JSON support or price differs between providers. |
| JSON mode | When off, `response_format` is not sent and the model must follow the prompt's JSON instructions unaided. |
| Min. max tokens | Raises the per-stage output limit (stage defaults are 600 to 800). |
| Fallback model | Model that writes a stage when this one fails it. Empty means the default model. For an 18+ model choose another 18+ model, so a failed stage does not become a refusal mid-story. |
| 18+ | A label shown to admins and players. It does not gate access. |
| Prices | USD per 1M tokens. Used for cost estimates in Qualify and PCE Inspector. |

## When a model gets it wrong

Models without a JSON mode write good prose but often break the JSON around it. Each stage works through these steps and stops at the first that succeeds:

1. **Parse as-is.**
2. **Fix the wrapping**, with no extra model call: strip a code fence or surrounding text, escape raw line breaks inside strings, or close an unfinished object.
3. **Salvage the narration** (narrative stage only): if the JSON is beyond repair, the text after `"narration":` is used.
4. **Retry the same model once.** Only when the model answered and the answer was unusable. A reply cut off at the token limit is retried with double the limit (capped at 16000); if it was already at the cap, the retry is skipped.
5. **Ask the fallback model once.** After a failed retry, or immediately when the provider itself failed (outage, removed model, no credits, timeout). A failure in the game's own code (for example a prompt that cannot be built) is not sent to another model.
6. **Fail the turn.**

Two rules keep this safe:

- Repair and salvage apply only when the model stopped on its own (finish reason `stop`). A reply cut off at the token limit, filtered, or with no reported finish reason is never repaired: closing a truncated object would silently drop actions or half a scene, so it goes to the retry instead.
- A recovered object is only accepted as a stage's output if it carries that stage's fields (`narration`, `imagePrompt`, `actions`; for the scene plan `context`, `variables` or `guidance`). A stray example object, or one section of a broken reply, is not mistaken for the answer.
- An empty reply is a failure, and so is a scene plan without its sections. A plan whose JSON had to be repaired must have all three.
- Only an active model can be the default; deactivating the default clears the flag.

Every attempt is recorded. A stage's entries in the turn's `promptChain` list each attempt in order (`recovery: "retry" | "fallback"`, `jsonQuality: raw | extracted | repaired | salvaged | failed`); the last entry is the output that was used. Retries and fallbacks log a `[LLM]` warning and increment the `llm_stage_recovery_total` metric (`outcome`: `retry_ok`, `fallback_ok`, `failed`).

Steps 2 and 3 live in `server/llm/json.ts`; steps 4 and 5 in `withRecovery` (`server/pce/graph/recovery.ts`). On a LangSmith trace each attempt is its own run (`<stage>.attempt`, `<stage>.retry`, `<stage>.fallback`); see [`OBSERVABILITY_AND_EVALS.md`](OBSERVABILITY_AND_EVALS.md).

## Forcing a model from a theme

**Dev Tools → PCE → Story Themes → Forced story model.** Players on that theme always get the model and their picker is locked. A theme that points at a model players cannot use (inactive or unpublished) forces nothing. Theme overrides follow the same publish rule as the catalog.

## Code map

| Concern | Location |
| --- | --- |
| Provider clients, timeout, error text | `server/llm/clients.ts` |
| Resolution, defaults, theme overrides | `server/llm/models.ts` |
| JSON repair and narration salvage | `server/llm/json.ts` |
| Retry and fallback | `withRecovery` in `server/pce/graph/recovery.ts` |
| Stage execution | `runStage` in `server/pce/graph/stages.ts`; the model call is `executeJsonPrompt` in `server/llm/jsonPrompt.ts` |
| Pipeline (stage order, parallel actions and image) | `server/pce/graph/graph.ts`, entered through `runPceGraph` |
| Qualification runner | `runModelQualification` in `server/pce/inspectorService.ts` |
| Verdict rules (clean, repaired, fallback, failed) | `server/pce/verdict.ts`, shared with evals |
| Admin API (CRUD, discover, check, qualify) | `server/routes/llmModelsAdmin.ts` → `/api/admin/llm-models` |
| Player list | `server/routes/llmModelsReference.ts` → `/api/reference/llm-models` |
| Dev Tools UI | `client/src/pages/devtools/LlmModelsTab.tsx`, `client/src/pages/devtools/llm/` |
| Player picker | `client/src/hooks/useStoryModels.ts`, `WelcomePage.tsx`, `UserSettingsDialog.tsx` |
| Schema | `server/migrations/20261112_add_llm_models.sql` |

## Operations

- **Environment:** `HF_TOKEN` for Hugging Face; `AI_INTEGRATIONS_OPENAI_API_KEY` (or `OPENAI_API_KEY`) for OpenAI. `LLM_REQUEST_TIMEOUT_MS` sets the per-request timeout (default 90000).
- **Existing databases:** run `npm run db:bootstrap`. It is safe to re-run and applies the migration, which adds the table, `users.llm_model_key`, `mod_story_themes.llm_model_key`, and seed rows (only `gpt-4o-mini` active).
- **Logs:** every stage call, including failures, is in LLM Logs with its model. Filter by model name.
- **Tests:** `npx vitest run server/llm server/pce/graph server/evals client/src/hooks` (set `DATABASE_URL` to any value; nothing connects).
- **Comparing models on quality, not only structure:** run an eval experiment per model in Dev Tools > Evals. See [`OBSERVABILITY_AND_EVALS.md`](OBSERVABILITY_AND_EVALS.md).

## Known limits

- The story model also writes the image prompt. An uncensored model may produce prompts an image provider rejects; the turn still completes and the image is marked failed.
- There is no age gate. The 18+ label is informational.
- Stages run master → narrative → (actions and image in parallel), so turn time is roughly three model calls. Qualify reports the real figure.
- A fallback changes the writer for that stage only. If the fallback is a different kind of model, the voice can shift within a turn.
- A slow provider can hold a stage for up to the request timeout, times the SDK's built-in retries, before the fallback is tried.
