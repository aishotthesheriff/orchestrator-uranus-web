-- Create turn_execution_manifests table for execution manifest storage
CREATE TABLE IF NOT EXISTS turn_execution_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL,
  turn_number INTEGER NOT NULL,
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  attempt INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  manifest JSONB NOT NULL,
  manifest_hash BYTEA NOT NULL,
  precompute_hash BYTEA NOT NULL,
  trace_id TEXT,
  request_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint on (game_id, turn_number, attempt) to prevent duplicate manifests
CREATE UNIQUE INDEX IF NOT EXISTS idx_manifest_game_turn_attempt 
ON turn_execution_manifests(game_id, turn_number, attempt);

-- Index for finding manifests by queue_entry_id
CREATE INDEX IF NOT EXISTS idx_manifest_queue_entry 
ON turn_execution_manifests(queue_entry_id);

-- Index for trace_id lookups
CREATE INDEX IF NOT EXISTS idx_manifest_trace_id 
ON turn_execution_manifests(trace_id) 
WHERE trace_id IS NOT NULL;

-- Index for finding manifests by game and turn
CREATE INDEX IF NOT EXISTS idx_manifest_game_turn 
ON turn_execution_manifests(game_id, turn_number);

