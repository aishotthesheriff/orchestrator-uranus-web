-- Migration: Stop hardcoding theme/style defaults on the users table
-- Description:
-- - Theme and style catalogs come from the reference release (mod_story_themes /
--   mod_visual_styles) and the release's system_defaults decide the default.
--   Hardcoded column defaults ('discovery', 'neo_deco') did not exist in the
--   catalogs and broke game start for every new user.
-- - New users now get NULL, which resolves to the reference system default.
-- - Idempotent: also clears rows holding the legacy invalid values.

BEGIN;

ALTER TABLE users ALTER COLUMN theme DROP DEFAULT;
ALTER TABLE users ALTER COLUMN style DROP DEFAULT;

UPDATE users
SET theme = NULL
WHERE trim(coalesce(theme, '')) = ''
   OR lower(theme) IN ('discovery', 'corporate ai satire');

UPDATE users
SET style = NULL
WHERE trim(coalesce(style, '')) = ''
   OR style IN ('neo_deco', 'Sierra VGA 1989');

COMMIT;
