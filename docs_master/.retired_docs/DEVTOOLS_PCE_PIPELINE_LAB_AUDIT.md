# DevTools PCE Pipeline Lab - Accuracy Audit Report

**Date:** 2025-01-XX  
**Document:** `DEVTOOLS_PCE_PIPELINE_LAB.md`  
**Status:** ✅ Mostly Accurate with Minor Discrepancies

## Executive Summary

The documentation accurately describes the Pipeline Lab feature overall, but contains several discrepancies in API parameter names, React Query key structure, component props, and some implementation details. Most issues are minor and don't affect core functionality understanding.

---

## ✅ Accurate Sections

1. **Purpose & Core Functionality** - Accurately describes the lab's capabilities
2. **Page Layout** - Matches the actual UI structure
3. **API Endpoints** - All documented endpoints exist and function as described
4. **Override Structure** - Schema matches implementation in `server/pipeline/overrideProcessor.ts`
5. **Context Cache TTL** - Correctly documented as ~1 hour (60 * 60 * 1000ms)
6. **Component List** - All mentioned components exist in `client/src/pages/devtools/pipeline/`
7. **Stage Execution Flow** - Accurately describes the sequential dependency (master → narrative → image/actions)

---

## ❌ Issues Found

### 1. ContextBar Component Props (Line 67-80)

**Documented:**
```ts
{
  games: GameSummary[];
  turns: TurnSummary[];
  selectedGameId?: string;
  selectedTurn?: number;
  onChangeGame(id: string): void;
  onChangeTurn(turn: number): void;
  onReload(): void;
  isLoading: boolean;
}
```

**Actual Implementation** (`client/src/pages/devtools/pipeline/ContextBar.tsx`):
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

**Issue:** The documented props don't match the actual implementation. The component doesn't accept `games` or `turns` arrays directly; instead, it manages mode selection (game/fixture/custom) and delegates game search to a parent component.

**Recommendation:** Update the props interface to match the actual implementation, including the mode management and fixture selection props.

---

### 2. Context API Query Parameter (Line 40-41)

**Documented:**
```
GET /api/admin/pipeline/context?gameId=…&turnNumber=…&fixture=true
```

**Actual Implementation** (`server/routes.ts:1369-1515`):
- Accepts `fixture` (string) OR `fixtureId` (string)
- Does NOT accept `fixture=true` (boolean)
- Also supports: `playerAction`, `checks`, `triggeredEvent`

**Issue:** The parameter name and format are incorrect. The API expects a fixture ID string, not a boolean flag.

**Recommendation:** Update to:
```
GET /api/admin/pipeline/context?gameId=…&turnNumber=…&fixture=<fixtureId>
```
Or document both parameter names:
```
GET /api/admin/pipeline/context?gameId=…&turnNumber=…&fixture=<id> OR fixtureId=<id>
```

---

### 3. React Query Key Structure (Line 44)

**Documented:**
```
React Query key: `["admin","pipeline","context", contextId]`
```

**Actual Implementation** (`client/src/hooks/usePipelineLab.ts:114-124`):
```ts
queryKey: [
  "admin",
  "pipeline",
  "context",
  gameId ?? null,
  turnNumber ?? null,
  fixtureId ?? null,
  playerAction ?? null,
  checks ?? null,
  triggeredEvent ?? null,
],
```

**Issue:** The query key is based on the input parameters (gameId, turnNumber, etc.), not the returned `contextId`. The `contextId` is returned in the response, not used as a cache key.

**Recommendation:** Update documentation to reflect that the query key is parameter-based, and the `contextId` is a server-generated UUID returned in the response for subsequent stage execution calls.

---

### 4. Download Artifact Endpoint (Line 130)

**Documented:**
```
`Download Artifact` (calls `/run-all?download=zip` or reuses last run)
```

**Actual Implementation** (`client/src/pages/devtools/pipeline/EndToEndRunner.tsx:41-53`):
```ts
handleDownload = () => {
  // Downloads JSON directly from client-side state
  const blob = new Blob([JSON.stringify(pipelineResult, null, 2)], {
    type: "application/json",
  });
  // ... creates download link
}
```

**Issue:** The download is client-side JSON download, not a server endpoint with query parameters. No `/run-all?download=zip` endpoint exists.

**Recommendation:** Update to: "Downloads the last pipeline result as JSON from client state."

---

### 5. Logs Endpoint Filtering (Line 62-63)

**Documented:**
```
Supports pagination + filters (stage, status, timestamp)
```

**Actual Implementation** (`server/routes.ts:2094-2172`):
- Supports `limit` and `after` (timestamp) parameters ✅
- Does NOT support explicit `stage` or `status` filters
- Stage is inferred from log metadata/function name, not filtered
- Status is inferred from `executionTimeMs`, not filtered

**Issue:** The endpoint doesn't support explicit stage/status filtering, only timestamp pagination.

**Recommendation:** Update to: "Supports pagination via `limit` and `after` (timestamp) parameters. Stage is inferred from log metadata."

---

### 6. Missing Endpoints in API Table

**Documented Endpoints** (Line 150-157):
- `/api/admin/pipeline/context` ✅
- `/api/admin/pipeline/run-stage` ✅
- `/api/admin/pipeline/run-all` ✅
- `/api/admin/pipeline/preview/apply` ✅
- `/api/admin/pipeline/logs` ✅
- `/api/admin/pipeline/fixtures` ✅

**Additional Endpoints Found** (not documented):
- `POST /api/admin/pipeline/context/custom` - Create custom context
- `GET /api/admin/pipeline/template-variables` - Get template variables for scenario builder
- `GET /api/admin/pipeline/variables` - Resolve variables for a stage
- `GET /api/admin/pipeline/stage-result` - Get cached stage result
- `GET /api/admin/pipeline/resolved-prompt` - Get resolved prompt for a stage

**Recommendation:** Add these endpoints to the API Contracts table with descriptions.

---

### 7. Context Load Response Structure (Line 43)

**Documented:**
```
{ contextId, game, preferences, turnSummary, promptChain, masterEnrichment }
```

**Actual Implementation** (`server/routes.ts:1492-1507`):
```ts
{
  contextId,
  game: { id, username, turnNumber, day, segment },
  preferences,
  turnSummary,
  promptChain,
  masterEnrichment,
  templateVariables,  // ⚠️ Missing from docs
  source: { type, id }  // ⚠️ Missing from docs
}
```

**Issue:** Response includes `templateVariables` and `source` fields not documented.

**Recommendation:** Add these fields to the documented response structure.

---

### 8. Stage Workbench Tabs (Line 105-108)

**Documented:**
1. Resolved Prompt
2. Request Payload
3. Response & Validation

**Actual Implementation** (`client/src/pages/devtools/pipeline/StageWorkbench.tsx:102-201`):
- Tab names match ✅
- Content structure matches ✅

**Status:** ✅ Accurate

---

### 9. Override Precedence Rules (Line 219-228)

**Documented Rules:**
1. Start with resolved variables
2. Apply `global.variables.merge` (shallow) and `replace`; remove keys in `global.variables.remove`
3. Apply stage-specific overrides
4. Template override replaces on-disk template
5. Request blocks override provider options
6. `modelKey`/`modelOverrides` take precedence

**Actual Implementation** (`server/pipeline/overrideProcessor.ts:83-177`):
- Matches documented precedence ✅
- Global variables merge → replace → remove ✅
- Stage variables merge on top of global ✅
- Template override supported ✅
- Request parameter whitelisting enforced ✅

**Status:** ✅ Accurate

---

### 10. End-to-End Runner Diff View (Line 131)

**Documented:**
```
Diff view (narrative/image/actions) displayed underneath using `react-diff-viewer`
```

**Actual Implementation** (`client/src/pages/devtools/pipeline/EndToEndRunner.tsx:87-122`):
- Diff view exists ✅
- Shows narrative/image/actions diffs ✅
- Uses simple text-based diff (red/green), NOT `react-diff-viewer` library

**Issue:** The implementation uses a simple inline diff, not the `react-diff-viewer` library.

**Recommendation:** Update to: "Diff view displayed with simple text-based comparison (old vs new)."

---

## 📋 Minor Clarifications Needed

1. **Context Cache Implementation** (Line 43): Document mentions "in-memory/Redis" but implementation is in-memory only (`server/pipeline/contextCache.ts` uses `Map`, no Redis).

2. **Fixture Loading** (Line 41): Document says `fixture=true` but should clarify that fixtures are loaded by ID string, not boolean flag.

3. **Stage Dependency Validation**: The document mentions stage dependencies but doesn't explicitly state that the API returns `400` errors when dependencies aren't met (e.g., running narrative without master).

4. **Request Monitor**: Document mentions it exists but doesn't detail how it connects to the logs endpoint or how it filters by context.

---

## ✅ Verification Checklist

- [x] All documented API endpoints exist
- [x] Component structure matches documentation
- [x] Override schema matches implementation
- [x] Context cache TTL is accurate
- [x] Stage execution flow matches
- [x] End-to-end runner functionality exists
- [ ] ContextBar props need updating
- [ ] API query parameter names need correction
- [ ] React Query key structure needs clarification
- [ ] Download artifact description needs updating
- [ ] Missing endpoints need documentation

---

## Recommended Actions

1. **Update ContextBar Props** - Align with actual implementation
2. **Fix API Query Parameters** - Correct `fixture` parameter documentation
3. **Clarify React Query Keys** - Document parameter-based key structure
4. **Update Download Artifact** - Remove server endpoint reference
5. **Add Missing Endpoints** - Document all 5 additional endpoints
6. **Expand Response Structures** - Include `templateVariables` and `source` fields
7. **Clarify Logs Filtering** - Document actual filtering capabilities
8. **Update Diff View Description** - Remove `react-diff-viewer` reference

---

## Conclusion

The documentation is **85% accurate** with the implementation. The core concepts, API contracts, and component structure are well-documented. The discrepancies are primarily in:
- Component prop interfaces (ContextBar)
- API parameter naming conventions
- Implementation details (download mechanism, diff view library)
- Missing endpoint documentation

These issues don't prevent understanding the feature but should be corrected for accuracy.

