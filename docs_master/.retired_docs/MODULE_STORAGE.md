# Module: Storage Layer (Postgres-backed Repository)

- File: `server/storage.ts`
- Purpose: Typed data access layer for all server-side persistence and caches, backed by Postgres via `server/db.ts`. Exposes a single `storage` instance implementing `IStorage`.

## Overview
- Provides CRUD and query methods for users, games, prompts, events, items, NPC templates, image prompts, interview questions, generated images (cache), reference releases, background jobs, settings, image models, and PCE catalogs (story themes, visual styles).
- Implements transaction helpers for game turn processing with row-level locking.
- Normalizes DB snake_case columns to camelCase objects expected by the app.
- Maintains a small in-memory cache for user preferences (per-process).

## Architecture
- Underlying connection: `server/db.ts` sets up a `pg.Pool` using `DATABASE_URL` with sane defaults (pool size, timeouts): server/db.ts:1
- Public interface: `IStorage` enumerates all storage capabilities: server/storage.ts:6
- Implementation: `DatabaseStorage` and exported singleton `storage`: server/storage.ts:136, server/storage.ts:2017

## Key Responsibilities
- Users: get (server/storage.ts:142), get by username (server/storage.ts:157), search (server/storage.ts:172), ensure/create (server/storage.ts:192), get prefs (server/storage.ts:227), update prefs (server/storage.ts:251)
  - Search uses case-insensitive prefix match with a hard cap of 50 results for safety: server/storage.ts:172
- Games: get (server/storage.ts:307), list by user (server/storage.ts:333), create (server/storage.ts:360), update (server/storage.ts:387), delete (server/storage.ts:418)
- Prompts: get (server/storage.ts:422), list (server/storage.ts:427), list active (server/storage.ts:432), get active by name (server/storage.ts:439), create (server/storage.ts:445), update (server/storage.ts:464)
- LLM Logs: create (server/storage.ts:508), query (server/storage.ts:528), clear (server/storage.ts:547)
- Events: list (server/storage.ts:551), list active (server/storage.ts:556), get (server/storage.ts:561), create (server/storage.ts:566), update (server/storage.ts:587)
- Items: list (server/storage.ts:639), list active (server/storage.ts:644), get (server/storage.ts:649), create (server/storage.ts:654), update (server/storage.ts:676)
- NPC Templates: list (server/storage.ts:732), list active (server/storage.ts:737), get (server/storage.ts:742), create (server/storage.ts:747), update (server/storage.ts:765)
- Image Prompts: list (server/storage.ts:805), list active (server/storage.ts:810), get (server/storage.ts:815), create (server/storage.ts:820), update (server/storage.ts:841)
- Interview Questions: list (server/storage.ts:894), list active (server/storage.ts:899), get (server/storage.ts:904), create (server/storage.ts:909), update (server/storage.ts:927)
- Generated Images (Cache): create (server/storage.ts:968), get (server/storage.ts:994), get by hash (server/storage.ts:999), list by template (server/storage.ts:1007), list all (server/storage.ts:1015), access update (server/storage.ts:1020), delete (server/storage.ts:1027), bulk delete w/ filters (server/storage.ts:1031), stats (server/storage.ts:1063)
- Reference Releases: create (server/storage.ts:1096), get (server/storage.ts:1110), get current (server/storage.ts:1115), list (server/storage.ts:1120), update (server/storage.ts:1125), set current (server/storage.ts:1157)
- Transactions: process turn with lock (server/storage.ts:1164)
- Image Jobs: create (server/storage.ts:1247), get (server/storage.ts:1267), update (server/storage.ts:1272), pending (server/storage.ts:1324)
- Turn Jobs: create (server/storage.ts:1333), get (server/storage.ts:1350), update (server/storage.ts:1355), pending (server/storage.ts:1395)
- Settings: list (server/storage.ts:1403), list active (server/storage.ts:1408), get (server/storage.ts:1413), upsert (server/storage.ts:1418)
- Image Models Catalog: list active (server/storage.ts:1438), get by key (server/storage.ts:1445), get default (server/storage.ts:1450), list all (server/storage.ts:1457), upsert (server/storage.ts:1462), deactivate (server/storage.ts:1580), reorder (server/storage.ts:1584)
- PCE Catalogs — Story Themes: list (server/storage.ts:1591), list active (server/storage.ts:1619), get (server/storage.ts:1648), upsert (server/storage.ts:1679), get default (server/storage.ts:1765), deactivate (server/storage.ts:1785)
- PCE Catalogs — Visual Styles: list (server/storage.ts:1790), list active (server/storage.ts:1822), get (server/storage.ts:1855), upsert (server/storage.ts:1890), get default (server/storage.ts:1990), deactivate (server/storage.ts:2012)

## Data Mapping
- Many tables use snake_case; this module consistently maps to camelCase for TypeScript interfaces.
  - Example (users): maps `image_model_key` → `imageModelKey`: server/storage.ts:146
  - Example (games): maps numeric booleans and JSONB columns: server/storage.ts:307

## Caching
- `userPreferencesCache` Map caches `{ theme, style, imageModelKey }` by username for read-heavy paths, invalidated on update: server/storage.ts:138, server/storage.ts:227
- Scope is per-node-process; multi-instance deployments won’t share this cache.

## Transactions & Concurrency
- `processTurnWithTransaction(gameId, processor)` locks the game row (`FOR UPDATE`), builds a `GameState`, runs the provided processor, writes back atomically, and commits: server/storage.ts:1164
- `ensureUser(username)` handles create-or-return with unique constraint fallback to avoid races: server/storage.ts:192

## Generated Image Cache
- Schema fields recorded per image include `template_name`, `prompt_hash`, `variables_hash`, `file_path`, `scene_fingerprint`, `metadata`, `game_id`, `turn_number`, and prompt source/text: server/storage.ts:968
- Access tracking increments `access_count` and updates `accessed_at`: server/storage.ts:1020
- Deletion supports filters (`templateName`, `gameId`, `before`, `maxAccessCount`), returns count via `RETURNING id`: server/storage.ts:1031
- Stats aggregate from both generated_images and LLM logs for hit rate and average generation time: server/storage.ts:1063

## Jobs
- Image jobs: `image_jobs` CRUD and pending retrieval: server/storage.ts:1247
- Turn jobs: `turn_jobs` CRUD, pending retrieval; `action_payload` stored as JSON: server/storage.ts:1333

## Settings & Catalogs
- Settings: `app_settings` get/list/upsert keyed by `key`: server/storage.ts:1403
- Image models: CRUD with default selection and ordering; upsert handles large set of optional provider/model fields: server/storage.ts:1438
- PCE catalogs:
  - Story themes (mod_story_themes): list/active/get/upsert/deactivate; maps `story_theme_key` ↔ `storyThemeKey`: server/storage.ts:1591
  - Visual styles (mod_visual_styles): list/active/get/upsert/deactivate; maps `visual_style_key` ↔ `visualStyleKey`, includes diffusion/transformer modifiers: server/storage.ts:1790

## Logging
- LLM logs persist prompts/responses and metadata; used by DevTools and cache stats: server/storage.ts:508, server/storage.ts:1063

## Known Pitfalls
- Per-process user preferences cache may become stale across multiple server instances; updates invalidate only the local cache.

## Environment
- Requires `DATABASE_URL` configured; see server/db.ts:5

## Export
- Use the singleton: `import { storage } from 'server/storage'`: server/storage.ts:2017
