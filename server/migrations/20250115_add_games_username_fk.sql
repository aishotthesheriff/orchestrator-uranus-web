-- Migration: Add foreign key constraint from games.username to users.username
-- Date: 2025-01-15
-- Description: Enforces referential integrity at the database level between games and users tables

-- First, check for any orphaned records (games with usernames not in users table)
-- This should not find any records since the application flow guarantees users exist before game creation
DO $$
DECLARE
  orphaned_count INTEGER;
  orphaned_usernames TEXT;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM games g
  LEFT JOIN users u ON g.username = u.username
  WHERE u.username IS NULL;
  
  IF orphaned_count > 0 THEN
    -- Get list of orphaned usernames for error message
    SELECT string_agg(DISTINCT username, ', ') INTO orphaned_usernames
    FROM games 
    WHERE username NOT IN (SELECT username FROM users);
    
    RAISE EXCEPTION 'Found % orphaned game record(s) with usernames not in users table. Orphaned usernames: %. Please delete these games or create the missing users before adding the foreign key constraint. Example: DELETE FROM games WHERE username IN (''IntegrationTester'', ''Joey'');', 
      orphaned_count, orphaned_usernames;
  ELSE
    RAISE NOTICE 'No orphaned records found. Proceeding with foreign key constraint creation.';
  END IF;
END $$;

-- Add foreign key constraint
-- Using ON DELETE RESTRICT to prevent accidental deletion of users with active games
-- Using NO ACTION on UPDATE since usernames should not change (they are unique identifiers)
ALTER TABLE games
ADD CONSTRAINT fk_games_username
FOREIGN KEY (username) 
REFERENCES users(username)
ON DELETE RESTRICT
ON UPDATE NO ACTION;

-- Add an index on games.username if it doesn't already exist for better join performance
-- Note: PostgreSQL does NOT automatically create indexes on foreign key columns
CREATE INDEX IF NOT EXISTS idx_games_username ON games(username);

