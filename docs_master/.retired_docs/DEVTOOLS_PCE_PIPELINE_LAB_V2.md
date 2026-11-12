# DevTools PCE Pipeline Lab (V2)

## Purpose

Provide an end-to-end diagnostics surface for the Prompt Composition Engine (PCE) V2 pipeline. The lab allows admins to:

- Load any game/turn (or canned fixtures) and view the resolved variables used at each stage.
- Execute Master, Narrative, Image, and Actions stages independently with override capabilities.
- Perform full-chain (Master → Narrative → Image → Actions) runs, inspect output diffs, and optionally apply results back to a turn.
- Inspect the exact request payloads and provider responses (LLM + image generation).
- Correlate runs with historical prompt-chain metadata and LLM logs.

## Page Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header (breadcrumbs + auth + environment pill)                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Context Bar                                                                  │
│ ├─ Mode selector (Game/Fixture/Custom)                                       │
│ ├─ Game select (auto-complete) or Fixture selector                           │
│ ├─ Turn select + Scenario Builder button                                     │
│ └─ Refresh pipeline data button                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Resolved Inputs Accordion (Master vars, Narrative vars, Image vars, Actions) │
├─────────────────┬──────────────────────────────────────────┬──────────────────┤
│ Stage Timeline  │ Stage Workbench (tabs)                    │ Turn Snapshot    │
│ (vertical)      │ ├─ Resolved Prompt                         │ ├─ Master ctx    │
│                 │ ├─ Request Payload                         │ ├─ Narrative     │
│                 │ └─ Response / Validation                   │ ├─ Image meta    │
│                 │ Buttons: Run, Run w/ Overrides, Legacy     │ └─ Actions       │
├──────────────────────────────────────────────────────────────┴──────────────────┤
│ End-to-End Runner card (Run pipeline, Apply to turn, Download artifact)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Request Monitor panel (LLM + image calls for context)                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Context Load (`GET /api/admin/pipeline/context?gameId=…&turnNumber=…&fixture=<id>`)**
   - Query params: `gameId` (required if not using fixture), `turnNumber` (optional), `fixture` or `fixtureId` (string ID for canned data), `playerAction` (optional, for simulation), `checks` (optional, JSON array), `triggeredEvent` (optional, JSON object).
   - Server composes a `TurnGenerationContext`: game state (`storage.getGameState`), user preferences (`storage.getUserPreferences`), turn history, and latest master enrichment (read from turn metadata; no separate enrichment cache table).
   - Response `{ contextId, game, preferences, turnSummary, promptChain, masterEnrichment, templateVariables, source }`, where `contextId` is a server-issued UUID cached in-memory (~1 hour TTL). Clients must reuse this token for stage runs.
   - React Query key: `["admin","pipeline","context", gameId, turnNumber, fixtureId, playerAction, checks, triggeredEvent]` (parameter-based, not contextId-based).

2. **Resolutions**
   - Derived client-side for quick display (flattened enrichment, variable maps).
   - Heavy formatting (e.g., syntax highlighting) deferred to `StageWorkbench`.

3. **Stage Execution (`POST /api/admin/pipeline/run-stage`)**
   - Payload: `{ contextId, stage, overrides?, forceLegacy? }`.
   - Backend retrieves cached context via `contextId`, applies overrides, executes requested stage, updates cached enrichment/prompt-chain, and emits response containing prompt/request/response metadata plus effective overrides.
   - Stage dependencies: Master must run before narrative/image/actions. Narrative must run before image/actions. Returns `400` if dependencies aren't met.
   - On success, update timeline, detail card, and request monitor.

4. **End-to-End Execution (`POST /api/admin/pipeline/run-all`)**
   - Runs every stage sequentially, returns aggregated result + prompt-chain.
   - Provide diff data (old vs new narrative/image/actions) for UI rendering.

5. **Apply Result (`POST /api/admin/pipeline/preview/apply`)**
   - Persists outputs to turn (admin-only). Requires explicit confirmation.
   - Returns `204 No Content` on success.

6. **Logs (`GET /api/admin/pipeline/logs?contextId=…&limit=…&after=…`)**
   - Supports pagination via `limit` (default: 50) and `after` (ISO timestamp string).
   - Stage is inferred from log metadata/function name (not explicitly filterable).
   - Status is inferred from execution time (not explicitly filterable).
   - Backed by `llm_logs` filtered using cached context metadata (gameId, turnNumber).

## UI Components

### ContextBar
Props:
```ts
{
  mode: "game" | "fixture" | "custom";
  selectedGameId?: string;
  selectedTurn?: number;
  selectedFixtureId?: string;
  fixtures?: PipelineFixtureSummary[];
  isCustomMode: boolean;
  hasContext: boolean;
  onModeChange: (mode: "game" | "fixture") => void;
  onGameChange: (gameId: string | undefined) => void;
  onTurnChange: (turn: number | undefined) => void;
  onFixtureSelect: (fixtureId: string | undefined) => void;
  onReload: () => void;
  onOpenScenarioBuilder: () => void;
  onClearCustomContext: () => void;
  isLoading: boolean;
}
```

Features:
- Mode toggle between Game Context, Fixture, and Custom scenarios.
- Game ID input with auto-complete (delegates to parent/game search API).
- Fixture selector dropdown when in fixture mode.
- Scenario Builder button opens custom context creation dialog.
- Refresh button reloads current context.

### ResolvedInputsAccordion
Displays read-only JSON viewers for:
- Master variables (base + flatten).
- Narrative variables (with master merges).
- Image variables & overrides.
- Actions variables.
Include copy/download buttons.

### StageTimeline
```
interface StageNode {
  id: "master" | "narrative" | "image" | "actions" | "legacy-master" | ...;
  title: string;
  status: "pending" | "success" | "fallback" | "error";
  durationMs?: number;
  template?: string;
  timestamp?: string;
}
```
Rendered via vertical Steps (shadcn). Clicking node selects StageWorkbench tab.

### StageWorkbench
Tabs:
1. **Resolved Prompt** (code block + token highlights).
2. **Request Payload** (JSON editor, view-only; toggle pretty/raw).
3. **Response & Validation** (show schema status, extracted fields, raw JSON with copy).

Actions:
- `Run Stage` (primary, uses latest context).
- `Run with Overrides` (opens Drawer containing JSON editors for variables, overrides).
- `Run Legacy Template` (if applicable).
- `Download Bundle` (zips prompt + request + response).

#### Override Drawer UX
- Opens from the right, pre-populated with:
  - **Variable Overrides**: editable JSON tree showing the resolved variable shape (global + stage). Provide helper buttons for "Insert key", "Reset", and "Remove".
  - **Request Overrides**: form inputs mapped to the request schema (model dropdown, temperature slider, token limits, image size/quality). Display validation hints pulled from the override schema.
  - **Template Override**: collapsible code editor for swapping the template inline (with syntax highlighting + lint).
- Footer buttons: `Cancel`, `Preview Diff` (diffs merged variables against original), and `Run Stage`. When submitted, call `run-stage` with overrides payload; keep drawer open with success banner so users can iterate quickly.
- Persist draft overrides per stage in local state so the drawer reopens with previous edits.

### TurnSnapshot
Cards summarizing resulting narrative snippet, tone hints, image metadata (model key, overrides, promptSource, imageTemplate), action chips preview. Provide inline copy buttons.

### EndToEndRunner
Buttons:
- `Run Pipeline` (calls `/run-all` with optional overrides).
- `Apply Output` (POST `/preview/apply` with optimistic UI + toast).
- `Download Artifact` (downloads last pipeline result as JSON from client state).
Diff view (narrative/image/actions) displayed underneath with simple text-based comparison (old vs new, red/green styling).

### RequestMonitor
```
interface PipelineLogEntry {
  id: string;
  stage: string;
  type: "llm" | "image" | "http";
  timestamp: string;
  status: "ok" | "error";
  requestSnippet: string;
  responseSnippet: string;
  metadata: Record<string, unknown>;
}
```
Paginated list with timestamp filtering. "Inspect" button scrolls to corresponding StageWorkbench payload.

## API Contracts

| Endpoint | Method | Payload | Response | Notes |
|----------|--------|---------|----------|-------|
| `/api/admin/pipeline/context` | GET | Query `gameId?`, `turnNumber?`, `fixture?` or `fixtureId?`, `playerAction?`, `checks?`, `triggeredEvent?` | `{ contextId, game, preferences, turnSummary, promptChain, masterEnrichment, templateVariables, source }` | `contextId` is cached UUID (~1h TTL, in-memory) |
| `/api/admin/pipeline/context/custom` | POST | `{ gameState, userPreferences?, playerAction?, checks?, triggeredEvent?, masterEnrichment? }` | `{ contextId, game, preferences, turnSummary, promptChain, masterEnrichment, templateVariables, source }` | Create custom context from synthetic data |
| `/api/admin/pipeline/fixtures` | GET | Query `id?` (optional, for specific fixture) | `{ fixtures: Array<{id, name, description, legacyId}> }` or single fixture object | List all fixtures or get specific fixture |
| `/api/admin/pipeline/template-variables` | GET | Query `fixtureId?` (optional) | `{ baseFixture, gameState, userPreferences, playerAction, checks, triggeredEvent, templateVariables }` | Sample template variables for scenario builder |
| `/api/admin/pipeline/variables` | GET | Query `contextId`, `stage` | `{ variables, flattened? }` | Resolve variables for a stage |
| `/api/admin/pipeline/stage-result` | GET | Query `contextId`, `stage` | Stage result object | Get cached stage result |
| `/api/admin/pipeline/resolved-prompt` | GET | Query `contextId`, `stage` | `{ prompt, variables, variableUsage }` | Get resolved prompt for a stage |
| `/api/admin/pipeline/run-stage` | POST | `{ contextId, stage, overrides?, forceLegacy? }` | `{ stageResult, timeline, appliedOverrides }` | Uses cached context keyed by `contextId` |
| `/api/admin/pipeline/run-all` | POST | `{ contextId, overrides? }` | `{ master, narrative, image, actions, promptChain, diff, appliedOverrides }` | Sequential run using cached context |
| `/api/admin/pipeline/preview/apply` | POST | `{ contextId, pipelineResult }` | 204 | Persists outputs to turn |
| `/api/admin/pipeline/logs` | GET | Query `contextId`, `limit?`, `after?` | `PipelineLogEntry[]` | Recent executions for context, paginated by timestamp |

All endpoints require admin session token + CSRF.

### Context Response Structure

```typescript
{
  contextId: string;                    // Server-generated UUID
  game: {
    id: string;
    username: string;
    turnNumber: number;
    day: number;
    segment: string;
  };
  preferences: {
    theme?: string;
    style?: string;
    imageModelKey?: string;
  };
  turnSummary: {
    turnNumber: number;
    action: string;
    narration: string;
    imagePrompt?: string;
    imageUrl?: string;
    actions?: any[];
  } | null;
  promptChain: any[];                   // Array of stage metadata
  masterEnrichment: any;                // Master enrichment data or null
  templateVariables: Record<string, unknown>;  // Resolved template variables
  source: {
    type: "game" | "fixture" | "custom";
    id?: string;                        // gameId or fixtureId
  };
}
```

### Override Structure

Overrides let admins adjust inputs or request metadata before a stage executes. The payload accepted by both `/run-stage` and `/run-all` follows the schema below (all fields optional):

```jsonc
{
  "global": {
    "variables": {
      "merge": { "key": "value" },   // shallow merge into resolved variables
      "replace": { "VAR_NAME": "..." }, // full replacement of specific variables
      "remove": ["VAR_TO_DROP"]
    },
    "request": {
      "model": "gpt-4o-mini",
      "maxTokens": 900,
      "temperature": 0.7,
      "metadata": { "label": "debug-run" }
    }
  },
  "master": {
    "template": "string | null",        // optional template override (null reverts)
    "variables": { "...": "..." },      // merged after global
    "enrichmentSeed": { "...": "..." }  // seed data for flattenMasterEnrichment
  },
  "narrative": {
    "template": "string | null",
    "variables": { "...": "..." },
    "forceThemeKey": "corporate_ai",
    "request": {
      "model": "gpt-4o-mini",
      "frequencyPenalty": 0.2,
      "presencePenalty": 0.1
    }
  },
  "image": {
    "template": "string | null",
    "variables": { "...": "..." },
    "modelKey": "flux-schnell",
    "modelOverrides": {
      "provider": "huggingface",
      "params": {
        "size": "1536x1024",
        "quality": "high",
        "background": "transparent"
      }
    }
  },
  "actions": {
    "template": "string | null",
    "variables": { "...": "..." },
    "request": {
      "model": "gpt-4o-mini",
      "topP": 0.9
    }
  }
}
```

**Precedence Rules**

1. Start with resolved variables produced by the context loader.
2. Apply `global.variables.merge` (shallow) and `replace`; remove any keys in `global.variables.remove`.
3. Apply stage-specific overrides using the same merge/replace semantics.
4. When `template` is provided it replaces the on-disk template for the run; `null` resets to default even if a prior override existed.
5. `request` blocks override provider-specific options (LLM or image). Only whitelisted keys (`model`, `maxTokens`, `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `metadata`) are forwarded to avoid unsafe parameters.
6. `modelKey`/`modelOverrides` take precedence over user preferences and turn metadata during image generation.

Stage run responses include the effective overrides applied so the UI can display diff badges. Contexts are cached server-side in-memory (Map-based, ~1 hour TTL); if the cache expires the client must re-fetch `/context` when a `contextExpired` error is returned.

## State Management

- Use React Query for context/stage data with parameter-based query keys.
- Local component state for UI toggles, overrides drafts.
- Persist last selected context (game/turn) in `sessionStorage`.
- Provide React Query mutation hooks for stage runs and apply calls.

## Testing Strategy

1. **Component tests (Vitest + Testing Library)**
   - StageWorkbench: renders tabs, triggers callbacks, displays validation badges.
   - EndToEndRunner: ensures diff view appears after mock mutation.
   - RequestMonitor: filter interactions, ensures log entries rendered.

2. **Integration (Playwright or Cypress)**
   - Load fixture context, run master stage, verify prompt/response display.
   - Run full pipeline, ensure timeline updates and diff view shows changed fields.
   - Test stage dependency validation (narrative without master, etc.).

3. **API contract tests**
   - Unit tests for new `/api/admin/pipeline/*` handlers, especially override/fallback paths.
   - Test context expiration handling.
   - Test stage dependency error responses.

4. **Snapshot tests**
   - Resolved prompt rendering with highlight spans for master-derived fields.

5. **Fallback scenarios**
   - Simulate stage error -> ensure timeline marks fallback and request monitor logs error.

## Implementation Steps

1. **Backend**
   - Implement `/api/admin/pipeline/context` (reuse existing storage helpers).
   - Add stage runner endpoints leveraging `ContentGenerationRouter`.
   - Expose logs by querying `llm_logs` and pipeline metadata.
   - Add fixture listing (`GET /api/admin/pipeline/fixtures`) and `/context?fixture=<id>` resolution.
   - Implement `POST /api/admin/pipeline/context/custom` to accept synthetic variable payloads and return a cached `contextId`.
   - Add variable resolution endpoints (`/variables`, `/resolved-prompt`, `/stage-result`).

2. **Frontend**
   - Add new tab `Pipeline Lab` to DevTools (route -> `/dev-tools/pipeline`).
   - Create React Query hooks (`usePipelineContext`, `usePipelineFixtures`, `useRunStage`, `useRunAll`, `usePipelineLogs`, `useStageVariables`, `useStageResult`, `useResolvedPrompt`, `useCreateCustomContext`).
   - Build components listed above; integrate with shadcn primitives.
   - Add Scenario Builder: template-variable inspector with editable JSON and a "Create Custom Context" action.
   - Surface fixture selector in ContextBar with mode management (game/fixture/custom).
   - Wire request monitor to mutation results (append inline) and periodic log fetch.

3. **Styling + UX**
   - Ensure responsive layout (collapse timeline on small screens).
   - Provide clear empty states (no context selected, stage not run yet).
   - Toast notifications for run/apply outcomes.
   - Display stage dependency errors clearly.

4. **Docs + onboarding**
   - Link this doc from DevTools documentation (`DevToolsPage.md`).
   - Add README snippet describing new endpoints + required admin token.

5. **QA Checklist**
   - Stage rerun with overrides works for each stage.
   - Legacy compare surfaces fallback template output.
   - End-to-end run updates timeline and diff view.
   - Logs panel shows request details with correct pagination.
   - Stage dependency validation works (400 errors when dependencies missing).
   - No PII leaks (strip tokens before display).
   - Context expiration handling works correctly.

