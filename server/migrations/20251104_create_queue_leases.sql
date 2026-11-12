-- Create queue_leases table for lease history tracking
CREATE TABLE IF NOT EXISTS queue_leases (
  lease_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  heartbeat_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMP,
  released_at TIMESTAMP,
  outcome TEXT,   -- 'completed' | 'failed' | 'released' | 'expired'
  outcome_details JSONB
);

-- Index for finding leases by entry_id
CREATE INDEX IF NOT EXISTS idx_lease_entry_id 
ON queue_leases(entry_id);

-- Index for finding leases by worker_id
CREATE INDEX IF NOT EXISTS idx_lease_worker_id 
ON queue_leases(worker_id);

-- Index for finding expired leases
CREATE INDEX IF NOT EXISTS idx_lease_expires_at 
ON queue_leases(heartbeat_expires_at) 
WHERE outcome IS NULL;

