-- Migration: Eval experiments
-- Date: 2026-11-12
-- Description: One row per offline eval experiment (a model and prompt set run over the
--   saved PCE scenarios and scored). The runs and scores themselves live in LangSmith;
--   this table keeps the summary so Dev Tools can list and compare experiments without it.
-- Idempotent: safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS eval_experiments (
  id TEXT PRIMARY KEY,
  name TEXT,                                -- LangSmith experiment name, known once it starts
  status TEXT NOT NULL DEFAULT 'running',   -- 'running' | 'completed' | 'failed'
  model TEXT NOT NULL,                      -- model id sent to the provider
  model_key TEXT,                           -- catalog key, NULL for the built-in model
  prompt_source TEXT NOT NULL,              -- 'reference' (published) | 'database' (drafts)
  release_version TEXT,                     -- active reference release when it ran
  scenario_tag TEXT,                        -- NULL = all scenarios
  judges JSONB NOT NULL DEFAULT '[]',       -- judge keys that were run
  judge_model TEXT,
  example_count INTEGER,
  summary JSONB,                            -- { scores, verdicts, turnMsMean, costUsd, rows }
  langsmith_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_eval_experiments_created_at ON eval_experiments (created_at DESC);

COMMIT;
