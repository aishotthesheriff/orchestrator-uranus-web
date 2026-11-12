# Derived schema: source of truth

The **most recent schema** the repo can derive comes from two places (no assumptions from old docs).

## 1. Introspected schema (18 tables)

**Source:** `temp/schema-introspection.json`  
**How it was produced:** `npx tsx scripts/introspect-architecture.ts` run against a **live database** (with `DATABASE_URL` set). The script reads `information_schema` and writes tables, columns, types, defaults, primary keys, foreign keys, and indexes.

**Tables in that file:**

| Table | Description |
|-------|-------------|
| `app_settings` | Key-value config |
| `events` | Game events and triggers |
| `games` | Game state (FK to users.username) |
| `generated_images` | Image cache |
| `image_jobs` | Async image jobs |
| `image_models` | Image model catalog |
| `image_prompts` | Image prompt templates |
| `interview_questions` | Character creation questions |
| `items` | Items catalog |
| `llm_logs` | LLM call logging |
| `mod_story_themes` | Story theme catalog |
| `mod_visual_styles` | Visual style catalog |
| `npc_templates` | NPC templates |
| `prompt_templates` | AI prompt templates |
| `reference_releases` | Reference version metadata |
| `session` | Express session store (connect-pg-simple) |
| `turn_jobs` | Async turn jobs |
| `users` | Users (theme, style, image_model_key, typewriter_enabled, skip_image_cache; no mood) |

So for these 18 tables, **the column names, types, and constraints in `temp/schema-introspection.json` are the derived “most recent” schema.**

## 2. Tables only in migrations (not in introspection JSON)

These are created only by migration SQL (and/or test setup). They are not in `schema-introspection.json`, so their “most recent” definition is the migration files and `server/__tests__/setup/db.ts` where applicable.

| Table | Defined in |
|-------|------------|
| `queue_entries` | `server/migrations/20251104_create_queue_entries.sql` |
| `queue_leases` | `server/migrations/20251104_create_queue_leases.sql` |
| `turn_execution_manifests` | `server/migrations/20251104_create_turn_execution_manifests.sql` |
| `pce_test_scenarios` | `server/migrations/20250127_add_pce_inspector.sql` (or `007_add_pce_inspector.sql`) |
| `pce_test_runs` | same |
| `pce_test_metrics` | same |
| `pce_template_versions` | same |

Additional objects:

- **View:** `legacy_turn_jobs_v` — `server/migrations/20251104_create_legacy_turn_jobs_view.sql`
- **View:** `pce_scenario_summary` — `server/migrations/20250127_add_pce_inspector.sql`
- **Index:** `uniq_active_image_job` on `image_jobs` — `server/migrations/20251101_add_unique_active_image_job_index.sql`

Optional migrations (add columns to existing tables; safe to run if columns missing):

- `20250127_add_pce_inspector.sql` (or `007_*`) adds to `prompt_templates`: `status`, `quality_score`, `last_tested_at`.

One-off scripts (run manually if needed; not part of normal migration order):

- `scripts/migrate-add-story-themes-rank-default.ts` — adds `rank`, `"default"` to `mod_story_themes`
- `scripts/migrate-add-visual-styles-rank-default.ts` — adds `rank`, `"default"` to `mod_visual_styles`

## 3. How to get the “most recent” schema for a table

- **For the 18 introspected tables:** use `temp/schema-introspection.json` (table → columns, data_type, is_nullable, column_default, plus primary_keys, foreign_keys, indexes in that file).
- **For queue/orchestrator and PCE tables and views:** use the migration files and test setup listed above.

## 4. Refreshing the introspected schema

When you have a live DB that matches the app (e.g. after applying all migrations and optional scripts):

```bash
# With DATABASE_URL pointing at that DB (e.g. Docker)
export DATABASE_URL="postgresql://postgres:password@localhost:5432/uranus_dungeon"
npx tsx scripts/introspect-architecture.ts
```

That overwrites `temp/schema-introspection.json` (and any other output the script writes). After that, the “most recent” schema for the 18 tables is again whatever is in that JSON. For queue/PCE tables and views, the migration files remain the source.

## 5. Bootstrap an empty DB and load reference data

To recreate the full schema on an empty DB and repopulate reference data from `releases/current/`:

1. **Prerequisites:** `temp/schema-introspection.json` must exist (from a previous run of `npx tsx scripts/introspect-architecture.ts` against a live DB). `releases/current/` must contain `manifest.json`, `metadata.json`, and the reference JSON files (items, events, npcs, prompts, etc.).
2. **Bootstrap schema:** `npm run db:bootstrap` (or `npx tsx scripts/bootstrap-database.ts`). This reads the introspection JSON, creates all 18 tables in dependency order, adds primary keys and foreign keys, then runs the migration SQL files for queue_*, turn_execution_manifests, pce_*, views, and the image_jobs index.
3. **Import reference data:** `npm run db:import-reference` (or `npx tsx scripts/import-reference-data.ts`). This loads `releases/current/*.json` into the corresponding DB tables and sets the current reference release.
4. **One-shot recreate:** `npm run db:recreate` runs bootstrap then import.

Either way, the **definition** of “most recent schema” is: introspection JSON for the 18 tables, plus the migration and view definitions above for the rest.
