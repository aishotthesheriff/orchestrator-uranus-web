-- Add unique partial index to prevent duplicate image jobs per turn
-- Only applies to jobs with status 'pending' or 'processing'
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_image_job 
ON image_jobs (game_id, turn_number) 
WHERE status IN ('pending','processing');

