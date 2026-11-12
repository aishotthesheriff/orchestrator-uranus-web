# Image Pre-Generation Pipeline — Architecture

**Status:** Proposed architecture  
**Audience:** Architects, implementers  
**Related:** [`AI_SERVICE.md`](AI_SERVICE.md), [`IMAGE_CACHE.md`](IMAGE_CACHE.md), [`REFERENCE_RELEASE_PUBLISHING.md`](REFERENCE_RELEASE_PUBLISHING.md)

---

## 1. Purpose and Scope

### 1.1 Goal

A **standalone application** (the *image pre-generation pipeline*) consumes a **JSON file** whose records define variable values (and optionally prompts). For each record, the pipeline produces **one image**. It does **not** depend on the Quest to Uranus server, database, or runtime. It may **copy** selected reference data from `releases/current` (or another release) so that prompts, model config, and styles stay aligned with the game when desired. The pipeline is intended for batch asset production (e.g. marketing art, style guides) in environments where the game is not running.

### 1.2 Standalone Constraint

- **No database.** No PostgreSQL, no shared storage, no connection to the game’s DB.
- **No server dependency.** The pipeline does not call the game’s HTTP API or import its server runtime.
- **Self-contained.** It may include copied or vendored logic (e.g. provider calls, variable substitution) and optionally a **copy** of reference files from `releases/current`.

### 1.3 Out of Scope

- Real-time game turn processing (handled by the main app).
- Changing the main app’s image API or cache.
- Authoring the input JSON (handled by content tools or scripts).

---

## 2. What the Pipeline Uses (No Game Runtime)

The pipeline is a separate application. It does **not** reuse the game’s server process, database, or storage layer. It can:

| Need | Standalone approach |
|------|----------------------|
| **Image generation** | Implement or copy a thin path: **prompt → provider API (OpenAI / Hugging Face) → save image to filesystem.** No `aiService`, no game storage. |
| **Model config (size, quality, provider, model name)** | Copy from `releases/current` (e.g. `image_models.json`, `system_defaults.json`) and read as static JSON at startup, or accept config in the input JSON / env. |
| **Prompt templates** | Copy from `releases/current` (e.g. `prompts.json`, `image_prompts.json`) and implement simple `{{VARIABLE}}` substitution from record fields. |
| **Visual styles / themes** | Optional: copy `mod_visual_styles.json`, `mod_story_themes.json` and use when resolving templates or building prompts. |
| **Cache (optional)** | **File-based only:** e.g. directory keyed by hash of (prompt + variables), or a local JSON index mapping key → file path. No Postgres, no game DB. |
| **Secrets** | Same env vars as needed for providers (e.g. `OPENAI_API_KEY`, Hugging Face token). No game DB or session. |

**Design principle:** The pipeline may **copy** concepts and data from this repo (and from `releases/current`), but it **does not depend on** the game’s database or server at runtime.

---

## 3. Copying From `releases/current`

The pipeline may include or read a **copy** of selected reference files so that model names, sizes, prompt templates, and styles match the game when desired. No live link to the game’s reference system or DB is required.

### 3.1 Suggested Files to Copy (When Aligning With Game)

| File | Purpose in pipeline |
|------|---------------------|
| `image_models.json` | Provider, model name, size, quality, trigger words, class (diffuser/transformer/flux). |
| `system_defaults.json` | Default `image_model_key` (and optionally theme/style). |
| `prompts.json` | If using PCE-style template names; pipeline can resolve by name and substitute variables. |
| `image_prompts.json` | Image-specific prompt templates and variable placeholders. |
| `mod_visual_styles.json` | Visual style definitions (labels, exemplars) for template substitution. |
| `mod_story_themes.json` | Theme definitions if templates reference them. |
| `settings.json` | Optional: e.g. `image_background_setting` if the pipeline respects it. |

### 3.2 How the Pipeline Uses the Copy

- **At build or deploy time:** Bundle a snapshot of `releases/current` (or a specific release) into the pipeline’s assets, e.g. `pipeline/reference/` or `config/reference/`.
- **At runtime:** Load only the JSON files needed for the run (e.g. image models + defaults + one prompt template). No DB, no `referenceLoader`, no symlink to the live game.
- **Updates:** Refresh the copied reference by re-copying from this repo when content changes; no expectation of a shared filesystem or live `releases/current` at runtime.

---

## 4. Input: JSON File Schema

The pipeline’s input is a single JSON file. Two formats are supported: the **Occupy Uranus** schema (concrete, recommended) and a generic **Mode A / Mode B** schema for simple or template-driven use.

---

### 4.1 Occupy Uranus — Concrete Input Schema (Primary)

This is the schema used for *Occupy Uranus* and similar game art batches. Top-level structure:

| Top-level key | Purpose |
|---------------|--------|
| `metadata` | Project identity, target resolution, format, version. |
| `global_style` | Aesthetic, palette, mood, and quality applied to **all** images. |
| `images` | Array of image records; **one image generated per element.** |

#### 4.1.1 `metadata` (object)

| Field | Type | Purpose |
|-------|------|--------|
| `project` | string | Project name (e.g. "Occupy Uranus - Space Colony Game"). |
| `theme` | string | High-level theme (e.g. "Space travel, Oregon Trail parody, retro-futuristic"). |
| `target_resolution` | string | e.g. `"1024x1024"`; passed to provider or used in prompt. |
| `format` | string | e.g. `"PNG or JPG"`. |
| `color_depth` | string | e.g. `"24-bit with alpha channel"`. |
| `version` | string | Schema/catalog version (e.g. `"1.0"`). |

#### 4.1.2 `global_style` (object)

Applied to every image unless overridden by per-image fields:

| Field | Type | Purpose |
|-------|------|--------|
| `aesthetic` | string | e.g. "Modern space art, clean, visually striking". |
| `palette` | string | e.g. "Deep space blues, purples, cosmic colors...". |
| `mood` | string | e.g. "Adventure, exploration, slight retrofuturism". |
| `quality` | string | e.g. "High detail, professional game art quality". |

#### 4.1.3 `images[]` (array of objects)

Each element defines one image. **Output filename** is taken from `filename`; the pipeline writes that file under `output_dir`.

| Field | Type | Required | Purpose |
|-------|------|----------|--------|
| `filename` | string | Yes | Output filename (e.g. `Title-01.png`, `gameover.jpg`). Pipeline writes to `output_dir/filename`. |
| `category` | string | No | e.g. `special`, `event`, `milestone`, `waypoint`, `zone_day`, `zone_status`. |
| `context` | string | No | e.g. `title`, `gameover`, `victory`, `event`, `milestone`, `waypoint`, `day`, `status`, `shop_fallback`. |
| `variant` | number | No | Variant index (e.g. 1, 2, 3) for zone/day/status. |
| `milestone` | string | No | e.g. `"25%"`, `"50%"` for milestone images. |
| `waypoint_name` | string | No | e.g. `"Earth Orbit"`, `"Mars Base"` for waypoint images. |
| `zone` | string | No | e.g. `earth`, `inner`, `belt`, `outer`, `uranus` for zone images. |
| `style` | string | No | Per-image style (e.g. "Bold, eye-catching, game title screen"). |
| `content_description` | string | **Yes** | Main scene description; **core of the image prompt.** |
| `text_overlay` | string \| null | No | Text to appear in image (e.g. "OCCUPY URANUS"); `null` if none. |
| `text_style` | string | No | e.g. "Large, bold, retro sci-fi font, glowing effect". |
| `mood` | string | No | Per-image mood; overrides or refines global mood. |
| `color_palette` | string[] | No | Hex colors (e.g. `["#1a2332", "#4a90e2"]`) for this image. |
| `notes` | string | No | Instructions for the generator (e.g. "Main menu screen - make it memorable"). |

**Prompt building (Occupy Uranus):** The pipeline **composes a single provider-ready prompt** from:

1. **Global context:** `metadata.theme`, `metadata.target_resolution`, `global_style.aesthetic`, `global_style.palette`, `global_style.mood`, `global_style.quality`.
2. **Per-image:** `content_description` (primary), `style`, `mood`, `color_palette` (e.g. "Use colors: #1a2332, #4a90e2, ..."), and optionally `text_overlay` + `text_style` (e.g. "Include text overlay: 'OCCUPY URANUS' with large, bold, retro sci-fi font, glowing effect").
3. **Guidance:** `notes` can be appended or woven in (e.g. "Note: This is the main menu screen - make it memorable and inviting.").

Order and phrasing are implementation-defined; the pipeline should ensure the provider receives a clear, self-contained prompt (and optional negative prompt or style hints if the provider supports them). Resolution from `metadata.target_resolution` can be passed as a provider parameter (e.g. size) rather than only in the text prompt.

**Record identity:** For manifest and cache, the pipeline uses `filename` as the stable record id (e.g. `record_id` or `filename` in the manifest).

---

### 4.2 Generic Schema (Mode A / Mode B)

For simpler or template-driven use, the pipeline can accept a generic format.

**Mode A — Prompt per record**

- Top-level: `records` (array), `defaults` (optional).
- Each record: `id` (optional), `image_prompt` (required), `image_model_key` (optional).
- Output: one image per record; filename from `id` or index if no `id`.

**Mode B — Template + variables**

- Top-level: `template`, `reference_dir`, `records`, `defaults`.
- Each record: variable key-value pairs for `{{VARIABLE}}` substitution.
- Pipeline resolves template to a final prompt, then generates one image per record.

(Detailed examples for Mode A/B are as in the previous doc version; omit here to avoid duplication.)

---

### 4.3 Top-Level Fields (Common)

| Field | Purpose |
|-------|--------|
| `output_dir` | (Optional) Directory for output images and manifest. CLI/env override. |
| `cache_dir` | (Optional) Directory for file-based cache; omit for no cache. |
| `concurrency` | (Optional) Max parallel generations (e.g. 1–2). |
| `reference_dir` | (Optional) Path to copied reference JSON; used if using templates or model config from reference. |

---

## 5. Pipeline Flow (Standalone)

1. **Load config:** Read input JSON. Detect schema: **Occupy Uranus** (`metadata` + `global_style` + `images`) or generic (**Mode A/B** with `records`). Optionally load copied reference (e.g. `image_models.json`, `system_defaults.json`) from `reference_dir` or bundle.
2. **For each image record:**
   - **Resolve prompt:**
     - **Occupy Uranus:** Compose prompt from `metadata` + `global_style` + per-image (`content_description`, `style`, `mood`, `color_palette`, `text_overlay`, `text_style`, `notes`). Use `metadata.target_resolution` for provider size if supported.
     - **Mode A:** Use record’s `image_prompt`.
     - **Mode B:** Substitute record variables into the chosen template.
   - **Output filename:** **Occupy Uranus** use `images[].filename` (e.g. `Title-01.png`); generic use `record_id` or index.
   - **Resolve model:** From record or `defaults`, or from copied `system_defaults.json` / `image_models.json` (provider, model name, size, quality).
   - **Optional cache lookup:** If `cache_dir` is set, compute a key (e.g. hash of prompt + model + filename). If a file exists for that key, copy/link to `output_dir/filename` and skip the provider call.
   - **Call provider:** Use OpenAI or Hugging Face SDK with the resolved prompt and model settings. No game server, no game DB.
   - **Save image:** Write image bytes to `output_dir/{filename}` (and optionally to `cache_dir` with the key).
3. **Write manifest:** For each record, write `filename` (or `record_id`), `file_path`, `prompt_used`, `model_key`, `cache_hit`, `duration_ms`, and `error` (if failed) to a manifest JSON in `output_dir`.

No database reads or writes; no dependency on the game’s storage or reference loader.

---

## 6. Output

- **Images:** One file per record under `output_dir`. For **Occupy Uranus** schema, the file is named exactly from `images[].filename` (e.g. `Title-01.png`, `gameover.jpg`, `Waypoint-Mars-Flyby.png`). For generic schema, use `record_id` or index (e.g. `scene_01.png`).
- **Manifest:** One JSON file (e.g. `manifest.json`) with an array of results. For Occupy Uranus, use `filename` as the record identifier:

```json
[
  {
    "filename": "Title-01.png",
    "file_path": "./out/Title-01.png",
    "prompt_used": "Dramatic view of Uranus from space with a spacecraft approaching...",
    "model_key": "dall-e-3",
    "cache_hit": false,
    "duration_ms": 8200
  },
  {
    "filename": "gameover.jpg",
    "error": "Rate limit exceeded",
    "duration_ms": 0
  }
]
```

Failed records include `error` and no `file_path` so runs can be retried for failures only (e.g. re-run with a list of failed `filename`s).

---

## 7. Configuration and Environment

- **API keys:** e.g. `OPENAI_API_KEY`, Hugging Face token — same as needed for the chosen provider(s). No game secrets or DB.
- **Reference data:** Either bundled (e.g. `reference/` in the pipeline app) or passed via `reference_dir` in the input JSON. No live connection to the game’s `releases/current`.
- **Paths:** `output_dir`, optional `cache_dir`, optional `reference_dir` — from input JSON or CLI flags or env (e.g. `PREGEN_OUTPUT_DIR`, `PREGEN_REFERENCE_DIR`).

No `DATABASE_URL` or game server URL.

---

## 8. Optional: File-Based Cache

To avoid re-calling the provider for identical prompt + model + variables:

- **Key:** e.g. `SHA256(prompt + model_key + sorted variables)`.
- **Storage:** Directory under `cache_dir`, e.g. `cache/{key_prefix}/{key}.png`, plus a small index (JSON or SQLite) mapping key → path and metadata.
- **Lookup:** Before calling the provider, compute the key; if the file exists (and optionally is not expired), copy or link it to `output_dir` and record `cache_hit: true` in the manifest.
- **Scope:** Local to the pipeline run or machine; no sharing with the game’s Postgres cache.

---

## 9. Placement and Naming

- **Repo:** A **separate repo** or a top-level directory in this repo (e.g. `tools/image-pregens/` or `image-pregens/`) that does not import from `server/` or `shared/` in a way that pulls in DB or server runtime. Copying reference JSON and (if desired) a minimal provider wrapper is fine.
- **Name:** e.g. *Image Pre-Generation Pipeline* or *image-pregens*.
- **Deliverables:** Standalone runnable (CLI or script), input JSON schema, this doc, README with run instructions and example input; optionally a Docker image that includes a copied reference snapshot.

---

## 10. Summary

| Aspect | Standalone design |
|--------|-------------------|
| **Application** | Standalone; no database, no game server dependency. |
| **Reference data** | May **copy** from `releases/current` (e.g. `image_models.json`, `prompts.json`, `system_defaults.json`); read as static JSON at runtime. |
| **Image generation** | Prompt → provider API → write file; optional file-based cache. |
| **Input** | **Occupy Uranus:** `metadata` + `global_style` + `images[]` (each with `filename`, `content_description`, style/mood/palette/notes). **Generic:** `records` with `image_prompt` (Mode A) or template + variables (Mode B). |
| **Prompt building** | Occupy Uranus: compose from metadata, global_style, and per-image content_description, style, mood, color_palette, text_overlay, text_style, notes. |
| **Output** | One image per record in `output_dir`; filename from `images[].filename` (Occupy Uranus) or `record_id` (generic). Manifest JSON with `filename`, `file_path`, `prompt_used`, `model_key`, `cache_hit`, `duration_ms`, `error`. |
| **Config** | API keys via env; paths and optional reference/cache dirs via input JSON or CLI/env. |

This gives a standalone image pre-generation pipeline that supports the Occupy Uranus art catalog and can stay aligned with game content by copying from `releases/current` without ever depending on the game’s database or server.
