-- Migration: Add skip_image_cache column to users table
-- Date: 2025-01-15
-- Description: Add user preference to control whether image cache should be checked.
-- System default is TRUE (skip cache) to generate fresh images by default.

BEGIN;

-- Add skip_image_cache column with default TRUE
ALTER TABLE users ADD COLUMN IF NOT EXISTS skip_image_cache BOOLEAN DEFAULT TRUE;

-- Backfill existing users to have skip_image_cache = TRUE (system default)
UPDATE users SET skip_image_cache = TRUE WHERE skip_image_cache IS NULL;

COMMIT;

