# Reference releases

Versioned snapshots of **reference data** (items, events, NPCs, prompts, image prompts, settings, image models, story themes, visual styles, system defaults). This is the source of truth for all game content and AI/config—not game sessions or user data.

## Active reference: `current/`

**The app uses `releases/current/` as the active reference.** All reference data at runtime is loaded from that directory (see `server/reference/referenceLoader.ts`).

- Ensure `releases/current/` exists and contains:
  - `manifest.json` – maps table names to JSON files
  - `metadata.json` – version, publishedBy, publishedAt, notes
  - `items.json`, `events.json`, `npcs.json`, `prompts.json`, `image_prompts.json`, `settings.json`, `image_models.json`, `mod_story_themes.json`, `mod_visual_styles.json`, `system_defaults.json`
- To switch the active reference: activate a version (admin API or copy a version folder’s contents into `current/`), then restart the app or clear the reference cache.

## Versioned snapshots

Each `v*` (e.g. `v10.2.0`, `v10.3.0`) or dated folder is a full snapshot. Publish/activate flows create these and optionally update `current/`. See `docs_master/current/REFERENCE_RELEASE_PUBLISHING.md` for details.
