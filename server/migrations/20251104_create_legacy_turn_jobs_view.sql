-- Compatibility view mapping orchestrator states to legacy status values
-- This allows existing admin dashboards to work during migration
CREATE OR REPLACE VIEW legacy_turn_jobs_v AS
SELECT 
  tj.id,
  tj.game_id,
  tj.action_payload,
  tj.status AS legacy_status,
  tj.error,
  tj.completed_at,
  tj.created_at,
  -- Map orchestrator status to legacy status
  CASE 
    WHEN qe.status = 'pending' AND qe.run_at > NOW() THEN 'pending'
    WHEN qe.status = 'pending' THEN 'pending'
    WHEN qe.status = 'leased' THEN 'processing'
    WHEN qe.status = 'completed' THEN 'completed'
    WHEN qe.status = 'dead_letter' THEN 'failed'
    ELSE COALESCE(tj.status, 'pending')
  END AS orchestrator_status,
  qe.status AS queue_status,
  qe.attempts,
  qe.priority,
  qe.lease_id,
  qe.lease_owner,
  qe.lease_expires_at,
  qe.trace_id,
  qe.request_id,
  qe.metadata
FROM turn_jobs tj
LEFT JOIN queue_entries qe ON qe.payload_table = 'turn_jobs' AND qe.payload_id = tj.id;

