-- Migration: Remove mood column from users table
-- Date: 2025-10-31
-- Description: The mood attribute is no longer used in the application

ALTER TABLE users DROP COLUMN IF EXISTS mood;

