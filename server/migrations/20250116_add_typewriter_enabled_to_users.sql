-- Migration: Add typewriter_enabled column to users table
-- Date: 2025-01-16
-- Description: Add user preference to control typewriter effect in optimized game page.
-- System default is TRUE (typewriter enabled) for better UX.

BEGIN;

-- Add typewriter_enabled column with default TRUE
ALTER TABLE users ADD COLUMN IF NOT EXISTS typewriter_enabled BOOLEAN DEFAULT TRUE;

-- Backfill existing users to have typewriter_enabled = TRUE (system default)
UPDATE users SET typewriter_enabled = TRUE WHERE typewriter_enabled IS NULL;

COMMIT;

