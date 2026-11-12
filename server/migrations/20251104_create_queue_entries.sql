-- Create queue_entries table for orchestrator job tracking
CREATE TABLE IF NOT EXISTS queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  payload_table TEXT NOT NULL,
  payload_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_id UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMP,
  trace_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  idempotency_key TEXT,
  last_error JSONB
);

-- Primary claim path: partial index for pending jobs ordered by priority and run_at
CREATE INDEX IF NOT EXISTS idx_queue_pending 
ON queue_entries(queue, run_at, priority DESC) 
WHERE status = 'pending';

-- Idempotency: unique partial index on (queue, idempotency_key) where key is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_idempotency 
ON queue_entries(queue, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Stuck job scans: index for finding jobs by status and updated_at
CREATE INDEX IF NOT EXISTS idx_queue_status_updated 
ON queue_entries(queue, status, updated_at);

-- Index for finding jobs by payload reference
CREATE INDEX IF NOT EXISTS idx_queue_payload 
ON queue_entries(payload_table, payload_id);

-- Index for trace_id lookups
CREATE INDEX IF NOT EXISTS idx_queue_trace_id 
ON queue_entries(trace_id) 
WHERE trace_id IS NOT NULL;

