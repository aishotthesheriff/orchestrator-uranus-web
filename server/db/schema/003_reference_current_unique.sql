-- Keep the most recently published current release, then enforce at most one current row.
UPDATE reference_releases
SET is_current = 0
WHERE is_current = 1
  AND version <> (
    SELECT version
    FROM (
      SELECT version
      FROM reference_releases
      WHERE is_current = 1
      ORDER BY published_at DESC, version DESC
      LIMIT 1
    ) AS selected_current
  );

ALTER TABLE reference_releases
  ADD COLUMN IF NOT EXISTS current_release_slot TINYINT
    GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN 1 ELSE NULL END) STORED;

ALTER TABLE reference_releases
  ADD UNIQUE INDEX IF NOT EXISTS uq_reference_releases_current_slot (current_release_slot);
