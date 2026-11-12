-- Migration: Story (LLM) model catalog
-- Date: 2026-11-12
-- Description: Catalog of text models the story pipeline may use, mirroring image_models.
--   Dev Tools edits this table; players only see a model once a reference release is published.
--   Also adds the per-user choice (users.llm_model_key) and the per-theme forced model
--   (mod_story_themes.llm_model_key). Both are nullable: NULL means "use the default".
-- Idempotent: safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  model_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'openai',          -- 'openai' | 'huggingface'
  model_name TEXT NOT NULL,                         -- id sent to the provider
  hf_provider TEXT,                                 -- optional HF Inference Provider pin (e.g. 'novita')
  active INTEGER NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT NOT NULL,
  description TEXT,                                 -- shown to players
  notes TEXT,                                       -- admin-only
  sort_order INTEGER NOT NULL DEFAULT 0,
  adult BOOLEAN NOT NULL DEFAULT FALSE,             -- handles 18+ content (label only)
  supports_json_mode BOOLEAN NOT NULL DEFAULT TRUE, -- send response_format: json_object
  context_length INTEGER,
  price_input NUMERIC,                              -- USD per 1M input tokens
  price_output NUMERIC,                             -- USD per 1M output tokens
  params JSONB,                                     -- { maxTokens?, temperature? }
  fallback_model_key TEXT,                          -- model to use when this one fails a stage; NULL = the default model
  last_check_at TIMESTAMPTZ,
  last_check_ok BOOLEAN,
  last_check_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS fallback_model_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_model_key TEXT;
ALTER TABLE mod_story_themes ADD COLUMN IF NOT EXISTS llm_model_key TEXT;

-- Seeds. Only gpt-4o-mini (the model the game has always used) starts active and default.
-- The rest are candidates to qualify in Dev Tools before activating.
INSERT INTO llm_models
  (id, model_key, provider, model_name, hf_provider, active, is_default, display_name, description, notes, sort_order, adult, supports_json_mode, context_length, price_input, price_output, params)
VALUES
  ('llm-gpt-4o-mini', 'gpt-4o-mini', 'openai', 'gpt-4o-mini', NULL, 1, TRUE,
   'GPT-4o mini', 'Balanced and reliable. The classic narrator.',
   'Original game model (baseline).', 0, FALSE, TRUE, 128000, 0.15, 0.60, NULL),
  ('llm-deepseek-v41-flash', 'deepseek-v4.1-flash', 'huggingface', 'deepseek-ai/DeepSeek-V4.1-Flash', NULL, 0, FALSE,
   'DeepSeek V4.1 Flash', 'Fast, with richer use of the crew.',
   'Best all-rounder in Nov 2026 testing: similar price to baseline, faster. 4 providers.', 10, FALSE, TRUE, NULL, 0.20, 0.60, NULL),
  ('llm-gpt-oss-120b', 'gpt-oss-120b', 'huggingface', 'openai/gpt-oss-120b', NULL, 0, FALSE,
   'gpt-oss 120B', 'Very fast open model.',
   'Fastest and cheapest. Reasoning model: spends extra output tokens, prose can leak dice mechanics. 6 providers.', 20, FALSE, TRUE, NULL, 0.05, 0.25, '{"maxTokens": 2000}'),
  ('llm-hermes-3-70b', 'hermes-3-70b', 'huggingface', 'NousResearch/Hermes-3-Llama-3.1-70B', NULL, 0, FALSE,
   'Hermes 3 70B', 'Strong character voices and dialogue. Uncensored.',
   'Neutrally aligned, follows the system prompt, handles adult content. Reliable JSON. 2 providers.', 30, TRUE, TRUE, NULL, 0.70, 0.70, NULL),
  ('llm-stheno-8b', 'stheno-8b', 'huggingface', 'Sao10K/L3-8B-Stheno-v3.2', NULL, 0, FALSE,
   'Stheno 8B', 'Small, fast roleplay model. Uncensored.',
   'NSFW roleplay fine-tune. Cheap and fast, but 8K context and no JSON mode: about half its narrative replies need JSON repair. Novita.', 40, TRUE, FALSE, 8192, 0.05, 0.05, NULL),
  ('llm-wizardlm-2-8x22b', 'wizardlm-2-8x22b', 'huggingface', 'alpindale/WizardLM-2-8x22B', NULL, 0, FALSE,
   'WizardLM-2 8x22B', 'Rich prose, slower turns. Uncensored.',
   'Permissive, strong prose, 65K context. Slow (~30s turns); no JSON mode, often wraps JSON in a code fence (handled). Novita.', 50, TRUE, FALSE, 65535, 0.62, 0.62, NULL)
ON CONFLICT (model_key) DO NOTHING;

-- Adult-capable models fall back to another adult-capable model rather than the default,
-- so a failed stage does not turn into a refusal mid-story. Only applied to untouched rows.
UPDATE llm_models SET fallback_model_key = 'hermes-3-70b'
 WHERE model_key IN ('stheno-8b', 'wizardlm-2-8x22b')
   AND fallback_model_key IS NULL
   AND created_at = updated_at;

COMMIT;
