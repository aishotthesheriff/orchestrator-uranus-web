# Database Technical Architecture Document V3

> **Generated from live database introspection**
> 
> **Generated on**: 2025-11-04T20:19:08.767Z
> 
> This document is automatically generated from the current database schema.

## Validation Summary (V2 → V3 Changes)

This document has been validated against the live Docker PostgreSQL database. The following changes were identified compared to V2:

_Note: Detailed validation summary requires comparing against previous version schema._

### Validation Status
✅ **All tables validated** - 18 tables match expected schema
✅ **All columns validated** - Schema introspection complete
✅ **All indexes validated** - 39 indexes documented
✅ **All foreign keys validated** - Relationships documented

---

## Executive Summary

The Quest to Uranus game uses a PostgreSQL-based database architecture with Drizzle ORM, designed for high-performance text-based adventure gaming. The system features multi-layer caching, async job processing, versioned content management, and comprehensive transaction safety.

**Technology Stack:**
- **Database**: PostgreSQL 15
- **ORM**: Drizzle ORM 0.39.1 with Drizzle Kit 0.31.4
- **Connection**: `pg` 8.11.3 (node-postgres)
- **Session Store**: `connect-pg-simple` 10.0.0
- **Caching**: Multi-layer (Reference, Image, Session)
- **Job Processing**: Async with Socket.IO real-time updates

## Complete Schema Documentation

### Table Overview (18 tables)

| Table | Columns | Primary Keys | Foreign Keys | Indexes | Description |
|-------|---------|--------------|--------------|---------|-------------|
| `app_settings` | 5 | 1 | 0 | 1 | Application configuration - key-value settings |
| `events` | 12 | 1 | 0 | 1 | Game events - random events with triggers |
| `games` | 19 | 1 | 1 | 2 | Game state storage - complete game session data |
| `generated_images` | 16 | 1 | 0 | 4 | Image cache - cached generated images |
| `image_jobs` | 10 | 1 | 0 | 2 | Async image processing - background image generation jobs |
| `image_models` | 21 | 1 | 0 | 3 | Image model catalog - publishable model routing presets |
| `image_prompts` | 12 | 1 | 0 | 1 | Image generation templates - AI image prompt templates |
| `interview_questions` | 9 | 1 | 0 | 1 | Game setup - character creation questions |
| `items` | 13 | 1 | 0 | 1 | Game items - equipment and consumables |
| `llm_logs` | 10 | 1 | 0 | 1 | AI interaction logging - all LLM calls and responses |
| `mod_story_themes` | 10 | 1 | 0 | 6 | Story theme templates - narrator template themes |
| `mod_visual_styles` | 12 | 1 | 0 | 6 | Visual style presets - art style definitions |
| `npc_templates` | 9 | 1 | 0 | 1 | NPC templates - crew member definitions |
| `prompt_templates` | 10 | 1 | 0 | 2 | AI prompt templates - versioned, editable AI prompts |
| `reference_releases` | 5 | 1 | 0 | 1 | Content versioning - published content versions |
| `session` | 3 | 1 | 0 | 2 | Express session storage - PostgreSQL-backed sessions |
| `turn_jobs` | 7 | 1 | 0 | 2 | Async turn processing - background turn processing jobs |
| `users` | 7 | 1 | 0 | 2 | User authentication and profiles |

### Detailed Table Definitions

#### `app_settings`

Application configuration - key-value settings

**Schema Definition:**
```sql
CREATE TABLE app_settings (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `key` | TEXT | NO | - | - |
| `value` | TEXT | NO | - | - |
| `description` | TEXT | YES | - | - |
| `active` | INTEGER | NO | 1 | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `key`

**Indexes:**

- UNIQUE `app_settings_pkey` (key)

---

#### `events`

Game events - random events with triggers

**Schema Definition:**
```sql
CREATE TABLE events (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  skill TEXT NOT NULL,
  dc INTEGER NOT NULL,
  trigger_condition JSONB NOT NULL,
  pass_effect TEXT NOT NULL,
  fail_effect TEXT NOT NULL,
  tags JSONB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `name` | TEXT | NO | - | - |
| `segment` | TEXT | NO | - | - |
| `skill` | TEXT | NO | - | - |
| `dc` | INTEGER | NO | - | - |
| `trigger_condition` | JSONB | NO | - | - |
| `pass_effect` | TEXT | NO | - | - |
| `fail_effect` | TEXT | NO | - | - |
| `tags` | JSONB | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `events_pkey` (id)

---

#### `games`

Game state storage - complete game session data

**Schema Definition:**
```sql
CREATE TABLE games (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  seed TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 1,
  turn_number INTEGER NOT NULL DEFAULT 0,
  segment TEXT NOT NULL DEFAULT 'Launch from Earth',
  absurdity INTEGER NOT NULL DEFAULT 2,
  stats JSONB NOT NULL,
  npcs JSONB NOT NULL,
  equipped_items JSONB NOT NULL,
  turns JSONB NOT NULL,
  current_actions JSONB NOT NULL,
  running_gags JSONB NOT NULL,
  event_history JSONB NOT NULL,
  interview_responses JSONB NOT NULL DEFAULT '{}',
  is_complete INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE games ADD CONSTRAINT fk_games_username
  FOREIGN KEY (username) REFERENCES users(username);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `username` | TEXT | NO | - | - |
| `seed` | TEXT | NO | - | - |
| `day` | INTEGER | NO | 1 | - |
| `turn_number` | INTEGER | NO | 0 | - |
| `segment` | TEXT | NO | 'Launch from Earth' | - |
| `absurdity` | INTEGER | NO | 2 | - |
| `stats` | JSONB | NO | - | - |
| `npcs` | JSONB | NO | - | - |
| `equipped_items` | JSONB | NO | - | - |
| `turns` | JSONB | NO | - | - |
| `current_actions` | JSONB | NO | - | - |
| `running_gags` | JSONB | NO | - | - |
| `event_history` | JSONB | NO | - | - |
| `interview_responses` | JSONB | NO | '{}' | - |
| `is_complete` | INTEGER | NO | 0 | - |
| `failure_reason` | TEXT | YES | - | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Foreign Keys:**

- `username` → `users.`username`

**Indexes:**

- UNIQUE `games_pkey` (id)
- `idx_games_username` (username)

---

#### `generated_images`

Image cache - cached generated images

**Schema Definition:**
```sql
CREATE TABLE generated_images (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL,
  prompt_hash VARCHAR NOT NULL,
  variables_hash VARCHAR NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  scene_fingerprint JSONB NOT NULL,
  metadata JSONB NOT NULL,
  game_id VARCHAR,
  turn_number INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 1,
  prompt_source TEXT NOT NULL DEFAULT 'template',
  prompt_text TEXT
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `template_name` | TEXT | NO | - | - |
| `prompt_hash` | VARCHAR | NO | - | - |
| `variables_hash` | VARCHAR | NO | - | - |
| `file_path` | TEXT | NO | - | - |
| `file_size` | INTEGER | NO | - | - |
| `mime_type` | TEXT | NO | 'image/png' | - |
| `scene_fingerprint` | JSONB | NO | - | - |
| `metadata` | JSONB | NO | - | - |
| `game_id` | VARCHAR | YES | - | - |
| `turn_number` | INTEGER | YES | - | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `accessed_at` | TIMESTAMP | NO | NOW() | - |
| `access_count` | INTEGER | NO | 1 | - |
| `prompt_source` | TEXT | NO | 'template' | - |
| `prompt_text` | TEXT | YES | - | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `generated_images_pkey` (id)
- `idx_generated_images_accessed` (accessed_at)
- `idx_generated_images_prompt_vars` (prompt_hash, variables_hash)
- `idx_generated_images_template` (template_name)

---

#### `image_jobs`

Async image processing - background image generation jobs

**Schema Definition:**
```sql
CREATE TABLE image_jobs (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  game_id VARCHAR NOT NULL,
  turn_number INTEGER NOT NULL,
  template_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  image_template TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `game_id` | VARCHAR | NO | - | - |
| `turn_number` | INTEGER | NO | - | - |
| `template_name` | TEXT | NO | - | - |
| `status` | TEXT | NO | 'pending' | - |
| `image_url` | TEXT | YES | - | - |
| `image_template` | TEXT | YES | - | - |
| `error` | TEXT | YES | - | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `completed_at` | TIMESTAMP | YES | - | - |

**Primary Key:** `id`

**Indexes:**

- `idx_image_jobs_status` (status, created_at)
- UNIQUE `image_jobs_pkey` (id)

---

#### `image_models`

Image model catalog - publishable model routing presets

**Schema Definition:**
```sql
CREATE TABLE image_models (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  hf_provider TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_size TEXT,
  default_quality TEXT,
  default_background TEXT,
  default_moderation TEXT,
  allowed_sizes JSONB,
  capabilities JSONB,
  provider_params JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  trigger_words VARCHAR(500),
  class TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE image_models ADD CONSTRAINT image_models_model_key_key UNIQUE (model_key);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `model_key` | TEXT | NO | - | - |
| `provider` | TEXT | NO | - | - |
| `model_name` | TEXT | NO | - | - |
| `hf_provider` | TEXT | YES | - | - |
| `active` | INTEGER | NO | 1 | - |
| `display_name` | TEXT | NO | - | - |
| `description` | TEXT | YES | - | - |
| `sort_order` | INTEGER | NO | 0 | - |
| `default_size` | TEXT | YES | - | - |
| `default_quality` | TEXT | YES | - | - |
| `default_background` | TEXT | YES | - | - |
| `default_moderation` | TEXT | YES | - | - |
| `allowed_sizes` | JSONB | YES | - | - |
| `capabilities` | JSONB | YES | - | - |
| `provider_params` | JSONB | YES | - | - |
| `created_at` | TIMESTAMP | YES | NOW() | - |
| `updated_at` | TIMESTAMP | YES | NOW() | - |
| `trigger_words` | VARCHAR(500) | YES | - | - |
| `class` | TEXT | YES | - | - |
| `is_default` | BOOLEAN | NO | false | - |

**Primary Key:** `id`

**Unique Constraints:** `model_key`

**Indexes:**

- `idx_image_models_active_sort` (active, sort_order)
- UNIQUE `image_models_model_key_key` (model_key)
- UNIQUE `image_models_pkey` (id)

---

#### `image_prompts`

Image generation templates - AI image prompt templates

**Schema Definition:**
```sql
CREATE TABLE image_prompts (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  inherit_visual_style INTEGER NOT NULL DEFAULT 1,
  size TEXT NOT NULL DEFAULT '1024x1024',
  quality TEXT NOT NULL DEFAULT 'auto',
  description TEXT,
  scene_types JSONB NOT NULL,
  tags JSONB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `name` | TEXT | NO | - | - |
| `prompt_template` | TEXT | NO | - | - |
| `inherit_visual_style` | INTEGER | NO | 1 | - |
| `size` | TEXT | NO | '1024x1024' | - |
| `quality` | TEXT | NO | 'auto' | - |
| `description` | TEXT | YES | - | - |
| `scene_types` | JSONB | NO | - | - |
| `tags` | JSONB | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `image_prompts_pkey` (id)

---

#### `interview_questions`

Game setup - character creation questions

**Schema Definition:**
```sql
CREATE TABLE interview_questions (
  id VARCHAR NOT NULL,
  question TEXT NOT NULL,
  variable_name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  tags JSONB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | - | - |
| `question` | TEXT | NO | - | - |
| `variable_name` | TEXT | NO | - | - |
| `description` | TEXT | YES | - | - |
| `display_order` | INTEGER | NO | 0 | - |
| `tags` | JSONB | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `interview_questions_pkey` (id)

---

#### `items`

Game items - equipment and consumables

**Schema Definition:**
```sql
CREATE TABLE items (
  id VARCHAR NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  skill_bonus_skill TEXT,
  skill_bonus_value INTEGER,
  scene_effect_tags JSONB,
  scene_effect_effect TEXT,
  efficiency JSONB,
  tags JSONB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | - | - |
| `name` | TEXT | NO | - | - |
| `description` | TEXT | NO | - | - |
| `icon` | TEXT | NO | - | - |
| `skill_bonus_skill` | TEXT | YES | - | - |
| `skill_bonus_value` | INTEGER | YES | - | - |
| `scene_effect_tags` | JSONB | YES | - | - |
| `scene_effect_effect` | TEXT | YES | - | - |
| `efficiency` | JSONB | YES | - | - |
| `tags` | JSONB | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `items_pkey` (id)

---

#### `llm_logs`

AI interaction logging - all LLM calls and responses

**Schema Definition:**
```sql
CREATE TABLE llm_logs (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  prompt_template_id VARCHAR,
  game_id VARCHAR,
  turn_number INTEGER,
  function_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  metadata JSONB,
  execution_time_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `prompt_template_id` | VARCHAR | YES | - | - |
| `game_id` | VARCHAR | YES | - | - |
| `turn_number` | INTEGER | YES | - | - |
| `function_name` | TEXT | NO | - | - |
| `prompt` | TEXT | NO | - | - |
| `response` | TEXT | NO | - | - |
| `metadata` | JSONB | YES | - | - |
| `execution_time_ms` | INTEGER | YES | - | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `llm_logs_pkey` (id)

---

#### `mod_story_themes`

Story theme templates - narrator template themes

**Schema Definition:**
```sql
CREATE TABLE mod_story_themes (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  story_theme_key TEXT NOT NULL,
  label TEXT NOT NULL,
  narrator_template TEXT NOT NULL,
  tags TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  rank INTEGER,
  default BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE mod_story_themes ADD CONSTRAINT mod_story_themes_story_theme_key_key UNIQUE (story_theme_key);
ALTER TABLE mod_story_themes ADD CONSTRAINT mod_story_themes_rank_key UNIQUE (rank);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `story_theme_key` | TEXT | NO | - | - |
| `label` | TEXT | NO | - | - |
| `narrator_template` | TEXT | NO | - | - |
| `tags` | TEXT | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | YES | NOW() | - |
| `updated_at` | TIMESTAMP | YES | NOW() | - |
| `rank` | INTEGER | YES | - | - |
| `default` | BOOLEAN | NO | false | - |

**Primary Key:** `id`

**Unique Constraints:** `story_theme_key`, `rank`

**Indexes:**

- `idx_mod_story_themes_active` (active)
- `idx_mod_story_themes_story_theme_key` (story_theme_key)
- UNIQUE `mod_story_themes_default_true_unique` (NULL)
  - Partial index: ("default" = true)
- UNIQUE `mod_story_themes_pkey` (id)
- UNIQUE `mod_story_themes_rank_key` (rank)
- UNIQUE `mod_story_themes_story_theme_key_key` (story_theme_key)

---

#### `mod_visual_styles`

Visual style presets - art style definitions

**Schema Definition:**
```sql
CREATE TABLE mod_visual_styles (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  visual_style_key TEXT NOT NULL,
  label TEXT NOT NULL,
  exemplified_by TEXT NOT NULL,
  modifiers_diffusion TEXT,
  modifiers_transformer TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  rank INTEGER,
  default BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE mod_visual_styles ADD CONSTRAINT mod_visual_styles_visual_style_key_key UNIQUE (visual_style_key);
ALTER TABLE mod_visual_styles ADD CONSTRAINT mod_visual_styles_rank_key UNIQUE (rank);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `category` | TEXT | NO | - | - |
| `visual_style_key` | TEXT | NO | - | - |
| `label` | TEXT | NO | - | - |
| `exemplified_by` | TEXT | NO | - | - |
| `modifiers_diffusion` | TEXT | YES | - | - |
| `modifiers_transformer` | TEXT | YES | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | YES | NOW() | - |
| `updated_at` | TIMESTAMP | YES | NOW() | - |
| `rank` | INTEGER | YES | - | - |
| `default` | BOOLEAN | NO | false | - |

**Primary Key:** `id`

**Unique Constraints:** `visual_style_key`, `rank`

**Indexes:**

- `idx_mod_visual_styles_active` (active)
- `idx_mod_visual_styles_category` (category)
- UNIQUE `mod_visual_styles_default_true_unique` (NULL)
  - Partial index: ("default" = true)
- UNIQUE `mod_visual_styles_pkey` (id)
- UNIQUE `mod_visual_styles_rank_key` (rank)
- UNIQUE `mod_visual_styles_visual_style_key_key` (visual_style_key)

---

#### `npc_templates`

NPC templates - crew member definitions

**Schema Definition:**
```sql
CREATE TABLE npc_templates (
  id VARCHAR NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  bio TEXT,
  starting_affinity INTEGER NOT NULL DEFAULT 0,
  tags JSONB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | - | - |
| `name` | TEXT | NO | - | - |
| `role` | TEXT | NO | - | - |
| `bio` | TEXT | YES | - | - |
| `starting_affinity` | INTEGER | NO | 0 | - |
| `tags` | JSONB | NO | - | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Indexes:**

- UNIQUE `npc_templates_pkey` (id)

---

#### `prompt_templates`

AI prompt templates - versioned, editable AI prompts

**Schema Definition:**
```sql
CREATE TABLE prompt_templates (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  system_content TEXT,
  inherit_global_prompt INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_name_key UNIQUE (name);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `name` | TEXT | NO | - | - |
| `content` | TEXT | NO | - | - |
| `system_content` | TEXT | YES | - | - |
| `inherit_global_prompt` | INTEGER | NO | 1 | - |
| `description` | TEXT | YES | - | - |
| `version` | INTEGER | NO | 1 | - |
| `active` | INTEGER | NO | 1 | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `updated_at` | TIMESTAMP | NO | NOW() | - |

**Primary Key:** `id`

**Unique Constraints:** `name`

**Indexes:**

- UNIQUE `prompt_templates_name_unique` (name)
- UNIQUE `prompt_templates_pkey` (id)

---

#### `reference_releases`

Content versioning - published content versions

**Schema Definition:**
```sql
CREATE TABLE reference_releases (
  version TEXT NOT NULL,
  published_by TEXT NOT NULL,
  notes TEXT,
  published_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_current INTEGER NOT NULL DEFAULT 0
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `version` | TEXT | NO | - | - |
| `published_by` | TEXT | NO | - | - |
| `notes` | TEXT | YES | - | - |
| `published_at` | TIMESTAMP | NO | NOW() | - |
| `is_current` | INTEGER | NO | 0 | - |

**Primary Key:** `version`

**Indexes:**

- UNIQUE `reference_releases_pkey` (version)

---

#### `session`

Express session storage - PostgreSQL-backed sessions

**Schema Definition:**
```sql
CREATE TABLE session (
  sid VARCHAR NOT NULL,
  sess JSON NOT NULL,
  expire TIMESTAMP NOT NULL
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `sid` | VARCHAR | NO | - | - |
| `sess` | JSON | NO | - | - |
| `expire` | TIMESTAMP | NO | - | - |

**Primary Key:** `sid`

**Indexes:**

- `IDX_session_expire` (expire)
- UNIQUE `session_pkey` (sid)

---

#### `turn_jobs`

Async turn processing - background turn processing jobs

**Schema Definition:**
```sql
CREATE TABLE turn_jobs (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  game_id VARCHAR NOT NULL,
  action_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `game_id` | VARCHAR | NO | - | - |
| `action_payload` | JSONB | NO | - | - |
| `status` | TEXT | NO | 'pending' | - |
| `error` | TEXT | YES | - | - |
| `created_at` | TIMESTAMP | NO | NOW() | - |
| `completed_at` | TIMESTAMP | YES | - | - |

**Primary Key:** `id`

**Indexes:**

- `idx_turn_jobs_status` (status, created_at)
- UNIQUE `turn_jobs_pkey` (id)

---

#### `users`

User authentication and profiles

**Schema Definition:**
```sql
CREATE TABLE users (
  id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  theme TEXT DEFAULT 'DOGE',
  mood TEXT DEFAULT 'Humorous and Chaotic',
  style TEXT DEFAULT 'game_ega_vga',
  image_model_key TEXT DEFAULT 'gpt-image-1-mini'
);
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
```

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR | NO | gen_random_uuid() | - |
| `username` | TEXT | NO | - | - |
| `password` | TEXT | NO | - | - |
| `theme` | TEXT | YES | 'DOGE' | - |
| `mood` | TEXT | YES | 'Humorous and Chaotic' | - |
| `style` | TEXT | YES | 'game_ega_vga' | - |
| `image_model_key` | TEXT | YES | 'gpt-image-1-mini' | - |

**Primary Key:** `id`

**Unique Constraints:** `username`

**Indexes:**

- UNIQUE `users_pkey` (id)
- UNIQUE `users_username_unique` (username)

---

## Indexing Strategy

### All Indexes

#### `app_settings` (1 indexes)

- **`app_settings_pkey`** (btree)
  - Columns: key
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX app_settings_pkey ON public.app_settings USING btree (key)`

#### `events` (1 indexes)

- **`events_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id)`

#### `games` (2 indexes)

- **`games_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX games_pkey ON public.games USING btree (id)`

- **`idx_games_username`** (btree)
  - Columns: username
  - Unique: No
  - Definition: `CREATE INDEX idx_games_username ON public.games USING btree (username)`

#### `generated_images` (4 indexes)

- **`generated_images_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX generated_images_pkey ON public.generated_images USING btree (id)`

- **`idx_generated_images_accessed`** (btree)
  - Columns: accessed_at
  - Unique: No
  - Definition: `CREATE INDEX idx_generated_images_accessed ON public.generated_images USING btree (accessed_at)`

- **`idx_generated_images_prompt_vars`** (btree)
  - Columns: prompt_hash, variables_hash
  - Unique: No
  - Definition: `CREATE INDEX idx_generated_images_prompt_vars ON public.generated_images USING btree (prompt_hash, variables_hash)`

- **`idx_generated_images_template`** (btree)
  - Columns: template_name
  - Unique: No
  - Definition: `CREATE INDEX idx_generated_images_template ON public.generated_images USING btree (template_name)`

#### `image_jobs` (2 indexes)

- **`idx_image_jobs_status`** (btree)
  - Columns: status, created_at
  - Unique: No
  - Definition: `CREATE INDEX idx_image_jobs_status ON public.image_jobs USING btree (status, created_at)`

- **`image_jobs_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX image_jobs_pkey ON public.image_jobs USING btree (id)`

#### `image_models` (3 indexes)

- **`idx_image_models_active_sort`** (btree)
  - Columns: active, sort_order
  - Unique: No
  - Definition: `CREATE INDEX idx_image_models_active_sort ON public.image_models USING btree (active, sort_order)`

- **`image_models_model_key_key`** (btree)
  - Columns: model_key
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX image_models_model_key_key ON public.image_models USING btree (model_key)`

- **`image_models_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX image_models_pkey ON public.image_models USING btree (id)`

#### `image_prompts` (1 indexes)

- **`image_prompts_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX image_prompts_pkey ON public.image_prompts USING btree (id)`

#### `interview_questions` (1 indexes)

- **`interview_questions_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX interview_questions_pkey ON public.interview_questions USING btree (id)`

#### `items` (1 indexes)

- **`items_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX items_pkey ON public.items USING btree (id)`

#### `llm_logs` (1 indexes)

- **`llm_logs_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX llm_logs_pkey ON public.llm_logs USING btree (id)`

#### `mod_story_themes` (6 indexes)

- **`idx_mod_story_themes_active`** (btree)
  - Columns: active
  - Unique: No
  - Definition: `CREATE INDEX idx_mod_story_themes_active ON public.mod_story_themes USING btree (active)`

- **`idx_mod_story_themes_story_theme_key`** (btree)
  - Columns: story_theme_key
  - Unique: No
  - Definition: `CREATE INDEX idx_mod_story_themes_story_theme_key ON public.mod_story_themes USING btree (story_theme_key)`

- **`mod_story_themes_default_true_unique`** (btree)
  - Columns: NULL
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_story_themes_default_true_unique ON public.mod_story_themes USING btree ((1)) WHERE ("default" = true)`

- **`mod_story_themes_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_story_themes_pkey ON public.mod_story_themes USING btree (id)`

- **`mod_story_themes_rank_key`** (btree)
  - Columns: rank
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_story_themes_rank_key ON public.mod_story_themes USING btree (rank)`

- **`mod_story_themes_story_theme_key_key`** (btree)
  - Columns: story_theme_key
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_story_themes_story_theme_key_key ON public.mod_story_themes USING btree (story_theme_key)`

#### `mod_visual_styles` (6 indexes)

- **`idx_mod_visual_styles_active`** (btree)
  - Columns: active
  - Unique: No
  - Definition: `CREATE INDEX idx_mod_visual_styles_active ON public.mod_visual_styles USING btree (active)`

- **`idx_mod_visual_styles_category`** (btree)
  - Columns: category
  - Unique: No
  - Definition: `CREATE INDEX idx_mod_visual_styles_category ON public.mod_visual_styles USING btree (category)`

- **`mod_visual_styles_default_true_unique`** (btree)
  - Columns: NULL
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_visual_styles_default_true_unique ON public.mod_visual_styles USING btree ((1)) WHERE ("default" = true)`

- **`mod_visual_styles_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_visual_styles_pkey ON public.mod_visual_styles USING btree (id)`

- **`mod_visual_styles_rank_key`** (btree)
  - Columns: rank
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_visual_styles_rank_key ON public.mod_visual_styles USING btree (rank)`

- **`mod_visual_styles_visual_style_key_key`** (btree)
  - Columns: visual_style_key
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX mod_visual_styles_visual_style_key_key ON public.mod_visual_styles USING btree (visual_style_key)`

#### `npc_templates` (1 indexes)

- **`npc_templates_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX npc_templates_pkey ON public.npc_templates USING btree (id)`

#### `prompt_templates` (2 indexes)

- **`prompt_templates_name_unique`** (btree)
  - Columns: name
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX prompt_templates_name_unique ON public.prompt_templates USING btree (name)`

- **`prompt_templates_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX prompt_templates_pkey ON public.prompt_templates USING btree (id)`

#### `reference_releases` (1 indexes)

- **`reference_releases_pkey`** (btree)
  - Columns: version
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX reference_releases_pkey ON public.reference_releases USING btree (version)`

#### `session` (2 indexes)

- **`IDX_session_expire`** (btree)
  - Columns: expire
  - Unique: No
  - Definition: `CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire)`

- **`session_pkey`** (btree)
  - Columns: sid
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX session_pkey ON public.session USING btree (sid)`

#### `turn_jobs` (2 indexes)

- **`idx_turn_jobs_status`** (btree)
  - Columns: status, created_at
  - Unique: No
  - Definition: `CREATE INDEX idx_turn_jobs_status ON public.turn_jobs USING btree (status, created_at)`

- **`turn_jobs_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX turn_jobs_pkey ON public.turn_jobs USING btree (id)`

#### `users` (2 indexes)

- **`users_pkey`** (btree)
  - Columns: id
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`

- **`users_username_unique`** (btree)
  - Columns: username
  - Unique: Yes
  - Definition: `CREATE UNIQUE INDEX users_username_unique ON public.users USING btree (username)`

**Total Indexes**: 39
