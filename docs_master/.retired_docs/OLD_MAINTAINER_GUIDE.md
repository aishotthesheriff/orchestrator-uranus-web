# Quest to Uranus - Maintainer Guide

## Overview
Quest to Uranus is an AI-driven narrative game built with TypeScript, React, Express, and PostgreSQL. Content (events, items, prompts, NPCs, settings) is published as “reference releases” and loaded at runtime via an in-memory cache (no TTL). The cache is cleared explicitly on publish/activate, ensuring deterministic gameplay and consistent prompts.

## Architecture

### Structure
```
quest-to-uranus/
├── client/
│   └── src/
│       ├── components/          # UI components
│       ├── pages/               # GamePage, DevToolsPage
│       └── lib/                 # Query client, helpers
├── server/
│   ├── aiService.ts             # LLM calls + prompt variables
│   ├── gameEngine.ts            # Trigger evaluation, deltas
│   ├── gameLogic.ts             # Turn flow, day/segment, running gags
│   ├── reference/
│   │   ├── referenceLoader.ts   # in-memory cache (no TTL) of current reference
│   │   └── publishReference.ts  # Publish pipeline
│   ├── routes.ts                # API routes
│   └── storage.ts               # DB interface
├── shared/
│   └── schema.ts                # Drizzle schemas + game types
└── releases/                    # Published reference data by version
```

### Reference Releases (Source of Truth)
- Datasets: `events`, `items`, `npcs`, `prompts`, `image_prompts`, `settings`.
- Active version tracked in DB; data files live under `releases/<version>/`.
- Load at runtime via `server/reference/referenceLoader.ts` (explicit invalidation) using `manifest.json`.
- Update: Dev Tools → Publish → Cache cleared automatically → new data active immediately.

### Settings Management
- Global application settings stored in `app_settings` table
- Settings exported to `releases/{version}/settings.json` during publish
- Managed via DevTools → Settings tab or API endpoints
- Server code loads settings from reference JSON files using `getSettingFromReference()`
- See [Settings System Documentation](./SETTINGS_SYSTEM.md) for detailed information

## Database & Types
- DB stores game sessions (`games`), logs, admin resources, and the “current reference” pointer.
- Reference content is exported to `releases/` at publish and read from filesystem at runtime.
- Canonical types in `shared/schema.ts` (e.g., `GameState`, `TriggerCondition`, `EventDefinition`).

## Core Systems

### Game Engine (`server/gameEngine.ts`)
- `getActiveEvents()` pulls events from the current reference release.
- `evaluateTriggerCondition()` supports discriminated-union triggers:
  - `stat` with operators: `>=`, `<=`, `>`, `<`, `==`
  - `day_modulo` with `divisor`, `remainder`
  - `random` with `chance`
  - `or` / `and` with nested `conditions`
- `applyDelta()` parses comma-separated deltas (e.g., `hull+5,oxygen-3`), clamps within bounds, returns applied changes.

### Game Logic (`server/gameLogic.ts`)
- Turn flow: increment turn → evaluate triggers → select first triggered event → compute checks → apply pass/fail deltas.
- Day/segment: day advances every 2 turns; segment derived from day:
  - Departure (1–3), Belt (4–6), Outer Darkness (7–9), Approach (10–12)
- Running gags: add unique event names to `state.runningGags[]`.
- Item sceneEffects: if `sceneEffect.tags` intersects scene tags (event tags or intent tags), append deltas.

### AI Service (`server/aiService.ts`)
- Sets variables for prompts:
  - `{{TRIGGERED_EVENT}}`: event display string or “No special events triggered this turn”
  - `{{RUNNING_GAGS}}`: up to 3 gag names, or “None yet”
  - `{{CHECKS}}`, `{{SEGMENT}}`, stats, equipped items, NPC summary, recent turns, absurdity description
- Templates are part of the current reference release (prompt cache).

## Events
- Canonical doc: `EVENT_SYSTEM.md`.
- Authoring: Dev Tools → Events → Publish.
- Runtime behavior: only the first triggered event per turn applies.
- Trigger schema: `type`-based; see canonical doc examples.

## Prompts
- Canonical doc: `docs_master/PROMPT_VARIABLES.md`.
- Templates live in reference releases. Edit via Dev Tools and Publish.
- Variables use `{{VARIABLE}}`; populated in `aiService.ts`.

## Dev Tools & Publishing
- `/dev`:
  - Manage events, items, prompts, NPCs, settings.
  - Publish builds a new `releases/<version>` and marks active.
- Cache is cleared automatically on Publish/Activate; changes take effect immediately.

## Running Locally
```bash
npm install
npm run dev         # dev server (Express + Vite proxied client)
npm run build       # build client; bundle server to dist/
npm start           # production server (dist/index.js)
```
Other scripts:
- `npm run db:push` — apply Drizzle schema
- `npm run seed` — seed database smartly
- `npm run seed:force` — destructive local reseed

## Testing & Debugging
- Server logs include AI call timing and variables; turn data is recorded in game state.
- Inspect games via API/DB.
- If content updates don't show: ensure Publish completed (cache clears automatically).

## Monitoring & Maintenance

### Health Checks
- **Health Endpoint**: `GET /api/health` - Database latency, queue depths, memory usage
- **Metrics Endpoint**: `GET /metrics` - Prometheus metrics for monitoring
- **Cache Performance**: Image cache hit/miss rates tracked automatically

### Cache Management
- **Reference Cache**: No TTL - cleared explicitly on content updates
- **Image Cache**: Automated cleanup daily at 2 AM based on retention policy
- **Manual Cleanup**: `POST /api/admin/cache/cleanup` for on-demand cleanup
- **Retention Settings**: Configure via database `app_settings` table:
  - `image_cache_retention_days` (default: 30)
  - `image_cache_min_access_count` (default: 5)

### Database Performance
- **Indexes**: Automatically created for job status, image cache lookups, and cleanup
- **Connection Pooling**: Handled by Drizzle ORM with environment-specific drivers
- **Monitoring**: Memory usage updated every 15 seconds via Prometheus metrics

## Deployment
- Deploy code and ship `releases/` content for the active reference.
- Set DB env vars.
- `npm run build && npm start` to serve; runtime loads the active reference release.

## Gotchas
- Always Publish after Dev Tools edits; runtime reads from releases, not raw DB rows.
- Triggers must use the `type`-based schema; legacy shapes won’t match.
- Keep deltas meaningful but safe (±5–10 typical).
- `RUNNING_GAGS` sends up to 3, or “None yet”.

## References
- Events: `EVENT_SYSTEM.md`
- Prompt variables: `docs_master/PROMPT_VARIABLES.md`
- Types: `shared/schema.ts`
- Reference loader: `server/reference/referenceLoader.ts`
- AI integration: `server/aiService.ts`
- Turn flow: `server/gameLogic.ts`
- Engine helpers: `server/gameEngine.ts`
