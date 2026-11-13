-- Baseline schema for Quest to Uranus on MariaDB (10.6 or later).
--
-- This file is the definition of the database. It creates tables only; content
-- (prompts, items, models, themes, ...) is loaded from a published release by
-- `npm run db:init`. Apply with `npm run db:migrate`.
--
-- Conventions
--   * Ids, keys, usernames, versions, statuses and hashes are VARCHAR ... COLLATE utf8mb4_bin,
--     so they match exactly (case-sensitive), as they did on Postgres.
--   * Timestamps are DATETIME(3) holding UTC.
--   * BOOLEAN columns hold true/false; INT flags (active, is_complete, is_current) hold 0/1.
--   * Every statement is IF NOT EXISTS: MariaDB commits each DDL statement on its own, so
--     a run that stops halfway can simply be run again.
--   * One statement per `;` at the end of a line. The runner splits on that.

-- ---------------------------------------------------------------------------
-- Players and games
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  password TEXT NOT NULL,
  theme VARCHAR(128) COLLATE utf8mb4_bin NULL,
  style VARCHAR(128) COLLATE utf8mb4_bin NULL,
  image_model_key VARCHAR(80) COLLATE utf8mb4_bin NULL DEFAULT 'gpt-image-1-mini',
  typewriter_enabled BOOLEAN NULL DEFAULT TRUE,
  skip_image_cache BOOLEAN NULL DEFAULT TRUE,
  llm_model_key VARCHAR(80) COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  seed TEXT NOT NULL,
  day INT NOT NULL DEFAULT 1,
  turn_number INT NOT NULL DEFAULT 0,
  segment TEXT NOT NULL DEFAULT 'Launch from Earth',
  absurdity INT NOT NULL DEFAULT 2,
  stats JSON NOT NULL,
  npcs JSON NOT NULL,
  equipped_items JSON NOT NULL,
  turns JSON NOT NULL,
  current_actions JSON NOT NULL,
  running_gags JSON NOT NULL,
  event_history JSON NOT NULL,
  interview_responses JSON NOT NULL DEFAULT '{}',
  is_complete INT NOT NULL DEFAULT 0,
  failure_reason MEDIUMTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_games_username (username),
  CONSTRAINT fk_games_username FOREIGN KEY (username) REFERENCES users (username) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Content (edited in Dev Tools, published as releases)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  `key` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  value MEDIUMTEXT NOT NULL,
  description MEDIUMTEXT NULL,
  active INT NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  skill TEXT NOT NULL,
  dc INT NOT NULL,
  trigger_condition JSON NOT NULL,
  pass_effect MEDIUMTEXT NOT NULL,
  fail_effect MEDIUMTEXT NOT NULL,
  tags JSON NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NOT NULL,
  description MEDIUMTEXT NOT NULL,
  icon TEXT NOT NULL,
  skill_bonus_skill TEXT NULL,
  skill_bonus_value INT NULL,
  scene_effect_tags JSON NULL,
  scene_effect_effect MEDIUMTEXT NULL,
  efficiency JSON NULL,
  tags JSON NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS npc_templates (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  bio MEDIUMTEXT NULL,
  starting_affinity INT NOT NULL DEFAULT 0,
  tags JSON NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prompt_templates (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  content MEDIUMTEXT NOT NULL,
  system_content MEDIUMTEXT NULL,
  inherit_global_prompt INT NOT NULL DEFAULT 1,
  description MEDIUMTEXT NULL,
  version INT NOT NULL DEFAULT 1,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  status VARCHAR(32) COLLATE utf8mb4_bin NULL DEFAULT 'active',
  quality_score INT NULL,
  last_tested_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY prompt_templates_name_unique (name),
  KEY idx_prompts_status (status),
  CONSTRAINT chk_prompt_templates_status CHECK (status IN ('draft', 'testing', 'ready', 'active', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_prompts (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NOT NULL,
  prompt_template MEDIUMTEXT NOT NULL,
  inherit_visual_style INT NOT NULL DEFAULT 1,
  size TEXT NOT NULL DEFAULT '1024x1024',
  quality TEXT NOT NULL DEFAULT 'auto',
  description MEDIUMTEXT NULL,
  scene_types JSON NOT NULL,
  tags JSON NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_models (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  model_key VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  hf_provider TEXT NULL,
  active INT NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description MEDIUMTEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  default_size TEXT NULL,
  default_quality TEXT NULL,
  default_background TEXT NULL,
  default_moderation TEXT NULL,
  allowed_sizes JSON NULL,
  capabilities JSON NULL,
  provider_params JSON NULL,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NULL DEFAULT NOW(3),
  trigger_words VARCHAR(500) NULL,
  class TEXT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY image_models_model_key_key (model_key),
  KEY idx_image_models_active_sort (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS llm_models (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  model_key VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model_name TEXT NOT NULL,
  hf_provider TEXT NULL,
  active INT NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT NOT NULL,
  description MEDIUMTEXT NULL,
  notes MEDIUMTEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  adult BOOLEAN NOT NULL DEFAULT FALSE,
  supports_json_mode BOOLEAN NOT NULL DEFAULT TRUE,
  context_length INT NULL,
  price_input DECIMAL(12,6) NULL,
  price_output DECIMAL(12,6) NULL,
  params JSON NULL,
  fallback_model_key VARCHAR(80) COLLATE utf8mb4_bin NULL,
  last_check_at DATETIME(3) NULL,
  last_check_ok BOOLEAN NULL,
  last_check_summary JSON NULL,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  UNIQUE KEY llm_models_model_key_key (model_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- default_slot is 1 for the default row and NULL for every other, so its unique index
-- allows at most one default. (On Postgres this was a partial unique index.)
CREATE TABLE IF NOT EXISTS mod_story_themes (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  story_theme_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  label TEXT NOT NULL,
  narrator_template MEDIUMTEXT NOT NULL,
  tags MEDIUMTEXT NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NULL DEFAULT NOW(3),
  `rank` INT NULL,
  `default` BOOLEAN NOT NULL DEFAULT FALSE,
  llm_model_key VARCHAR(80) COLLATE utf8mb4_bin NULL,
  default_slot TINYINT AS (CASE WHEN `default` THEN 1 END) STORED INVISIBLE,
  PRIMARY KEY (id),
  UNIQUE KEY mod_story_themes_story_theme_key_key (story_theme_key),
  UNIQUE KEY mod_story_themes_rank_key (`rank`),
  UNIQUE KEY mod_story_themes_default_true_unique (default_slot),
  KEY idx_mod_story_themes_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mod_visual_styles (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  category VARCHAR(128) NOT NULL,
  visual_style_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  label TEXT NOT NULL,
  exemplified_by MEDIUMTEXT NOT NULL,
  modifiers_diffusion MEDIUMTEXT NULL,
  modifiers_transformer MEDIUMTEXT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NULL DEFAULT NOW(3),
  `rank` INT NULL,
  `default` BOOLEAN NOT NULL DEFAULT FALSE,
  default_slot TINYINT AS (CASE WHEN `default` THEN 1 END) STORED INVISIBLE,
  PRIMARY KEY (id),
  UNIQUE KEY mod_visual_styles_visual_style_key_key (visual_style_key),
  UNIQUE KEY mod_visual_styles_rank_key (`rank`),
  UNIQUE KEY mod_visual_styles_default_true_unique (default_slot),
  KEY idx_mod_visual_styles_active (active),
  KEY idx_mod_visual_styles_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interview_questions (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  question MEDIUMTEXT NOT NULL,
  variable_name TEXT NOT NULL,
  description MEDIUMTEXT NULL,
  display_order INT NOT NULL DEFAULT 0,
  tags JSON NOT NULL,
  active INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reference_releases (
  version VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  published_by TEXT NOT NULL,
  notes MEDIUMTEXT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  is_current INT NOT NULL DEFAULT 0,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Jobs and the orchestrator queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS turn_jobs (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  game_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  action_payload JSON NOT NULL,
  status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
  error MEDIUMTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_turn_jobs_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- active_slot is "<game>:<turn>" while a job is pending or processing and NULL once it
-- has finished, so its unique index allows one active image job per turn and any number
-- of finished ones. (On Postgres this was the partial unique index uniq_active_image_job.)
-- template_name holds the full image prompt, hence MEDIUMTEXT.
CREATE TABLE IF NOT EXISTS image_jobs (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  game_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  turn_number INT NOT NULL,
  template_name MEDIUMTEXT NOT NULL,
  status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
  image_url MEDIUMTEXT NULL,
  image_template MEDIUMTEXT NULL,
  error MEDIUMTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  completed_at DATETIME(3) NULL,
  active_slot VARCHAR(100) COLLATE utf8mb4_bin
    AS (CASE WHEN status IN ('pending', 'processing') THEN CONCAT(game_id, ':', turn_number) END) STORED INVISIBLE,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_active_image_job (active_slot),
  KEY idx_image_jobs_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS queue_entries (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  queue VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  payload_table VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  payload_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 0,
  run_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  lease_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  lease_owner VARCHAR(255) COLLATE utf8mb4_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  trace_id VARCHAR(128) COLLATE utf8mb4_bin NULL,
  request_id VARCHAR(128) COLLATE utf8mb4_bin NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  idempotency_key VARCHAR(512) COLLATE utf8mb4_bin NULL,
  last_error JSON NULL,
  PRIMARY KEY (id),
  -- NULL keys never collide, so entries without an idempotency key are unaffected
  UNIQUE KEY idx_queue_idempotency (queue, idempotency_key),
  KEY idx_queue_pending (queue, status, run_at),
  KEY idx_queue_status_updated (queue, status, updated_at),
  KEY idx_queue_payload (payload_table, payload_id),
  KEY idx_queue_lease (lease_id),
  KEY idx_queue_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS queue_leases (
  lease_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  entry_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  worker_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  heartbeat_expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  renewed_at DATETIME(3) NULL,
  released_at DATETIME(3) NULL,
  -- 'completed' | 'failed' | 'released' | 'expired'
  outcome VARCHAR(32) COLLATE utf8mb4_bin NULL,
  outcome_details JSON NULL,
  PRIMARY KEY (lease_id),
  KEY idx_lease_entry_id (entry_id),
  KEY idx_lease_worker_id (worker_id),
  KEY idx_lease_expires_at (heartbeat_expires_at),
  CONSTRAINT fk_queue_leases_entry FOREIGN KEY (entry_id) REFERENCES queue_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- precompute_hash is written empty first and filled in later, hence VARBINARY (not BINARY).
CREATE TABLE IF NOT EXISTS turn_execution_manifests (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  game_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  turn_number INT NOT NULL,
  queue_entry_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  attempt INT NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  manifest JSON NOT NULL,
  manifest_hash VARBINARY(32) NOT NULL,
  precompute_hash VARBINARY(32) NOT NULL,
  trace_id VARCHAR(128) COLLATE utf8mb4_bin NULL,
  request_id VARCHAR(128) COLLATE utf8mb4_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  UNIQUE KEY idx_manifest_game_turn_attempt (game_id, turn_number, attempt),
  KEY idx_manifest_queue_entry (queue_entry_id),
  KEY idx_manifest_trace_id (trace_id),
  CONSTRAINT fk_manifests_queue_entry FOREIGN KEY (queue_entry_id) REFERENCES queue_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Image cache and LLM logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS generated_images (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  template_name VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  prompt_hash VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  variables_hash VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  file_path TEXT NOT NULL,
  file_size INT NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/png',
  scene_fingerprint JSON NOT NULL,
  metadata JSON NOT NULL,
  game_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  turn_number INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  accessed_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  access_count INT NOT NULL DEFAULT 1,
  prompt_source VARCHAR(64) NOT NULL DEFAULT 'template',
  prompt_text MEDIUMTEXT NULL,
  PRIMARY KEY (id),
  KEY idx_generated_images_accessed (accessed_at),
  KEY idx_generated_images_prompt_vars (prompt_hash, variables_hash),
  KEY idx_generated_images_template (template_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS llm_logs (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  prompt_template_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  game_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  turn_number INT NULL,
  function_name VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  prompt MEDIUMTEXT NOT NULL,
  response MEDIUMTEXT NOT NULL,
  metadata JSON NULL,
  execution_time_ms INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_llm_logs_game_created (game_id, created_at),
  KEY idx_llm_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- PCE Inspector and evals
-- ---------------------------------------------------------------------------

-- The *_json columns are text that holds JSON; the app reads and writes them as strings.
CREATE TABLE IF NOT EXISTS pce_test_scenarios (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NOT NULL,
  description MEDIUMTEXT NULL,
  game_state_json MEDIUMTEXT NOT NULL,
  player_action MEDIUMTEXT NOT NULL,
  checks_json MEDIUMTEXT NULL DEFAULT '[]',
  triggered_event_json MEDIUMTEXT NULL,
  theme TEXT NULL,
  style TEXT NULL,
  image_model_key TEXT NULL,
  tags TEXT NULL,
  is_preset INT NULL DEFAULT 0,
  created_by TEXT NULL,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_test_scenarios_is_preset (is_preset),
  KEY idx_test_scenarios_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pce_test_runs (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  scenario_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  release_version VARCHAR(64) COLLATE utf8mb4_bin NULL,
  template_master_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  template_narrative_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  template_image_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  template_actions_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
  status VARCHAR(32) COLLATE utf8mb4_bin NULL,
  stage_results_json LONGTEXT NOT NULL,
  executed_at DATETIME(3) NULL DEFAULT NOW(3),
  duration_ms INT NULL,
  total_tokens_prompt INT NULL,
  total_tokens_response INT NULL,
  estimated_cost_usd DOUBLE NULL,
  notes MEDIUMTEXT NULL,
  tags TEXT NULL,
  starred INT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_test_runs_scenario (scenario_id),
  KEY idx_test_runs_executed_at (executed_at),
  KEY idx_test_runs_status (status),
  KEY idx_test_runs_starred (starred),
  KEY idx_test_runs_release_version (release_version),
  CONSTRAINT fk_test_runs_scenario FOREIGN KEY (scenario_id) REFERENCES pce_test_scenarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_test_runs_status CHECK (status IN ('success', 'partial_success', 'failure'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pce_test_metrics (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  test_run_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  overall_score INT NOT NULL,
  coherence_score INT NULL,
  thematic_score INT NULL,
  variety_score INT NULL,
  technical_score INT NULL,
  player_impact_score INT NULL,
  coherence_analysis_json MEDIUMTEXT NULL,
  thematic_analysis_json MEDIUMTEXT NULL,
  variety_analysis_json MEDIUMTEXT NULL,
  technical_analysis_json MEDIUMTEXT NULL,
  player_impact_analysis_json MEDIUMTEXT NULL,
  computed_at DATETIME(3) NULL DEFAULT NOW(3),
  computation_duration_ms INT NULL,
  PRIMARY KEY (id),
  KEY idx_test_metrics_run (test_run_id),
  CONSTRAINT fk_test_metrics_run FOREIGN KEY (test_run_id) REFERENCES pce_test_runs (id) ON DELETE CASCADE,
  CONSTRAINT chk_test_metrics_overall CHECK (overall_score >= 0 AND overall_score <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pce_template_versions (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  prompt_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  version_number INT NOT NULL,
  release_version VARCHAR(64) COLLATE utf8mb4_bin NULL,
  system_content MEDIUMTEXT NULL,
  content MEDIUMTEXT NULL,
  created_by TEXT NULL,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  notes MEDIUMTEXT NULL,
  PRIMARY KEY (id),
  KEY idx_template_versions_prompt (prompt_id),
  KEY idx_template_versions_release (release_version),
  CONSTRAINT fk_template_versions_prompt FOREIGN KEY (prompt_id) REFERENCES prompt_templates (id) ON DELETE CASCADE,
  CONSTRAINT fk_template_versions_release FOREIGN KEY (release_version) REFERENCES reference_releases (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eval_experiments (
  id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name TEXT NULL,
  -- 'running' | 'completed' | 'failed'
  status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  model_key VARCHAR(80) COLLATE utf8mb4_bin NULL,
  prompt_source TEXT NOT NULL,
  release_version VARCHAR(64) COLLATE utf8mb4_bin NULL,
  scenario_tag TEXT NULL,
  judges JSON NOT NULL DEFAULT '[]',
  judge_model TEXT NULL,
  example_count INT NULL,
  summary JSON NULL,
  langsmith_url MEDIUMTEXT NULL,
  error MEDIUMTEXT NULL,
  created_at DATETIME(3) NULL DEFAULT NOW(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_eval_experiments_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
