-- Live updates (turn complete, image ready) for players whose browser is connected to a
-- different app process than the one that did the work. A host may run more than one
-- process (Hostinger does); each process reads this table about once a second and passes
-- new rows on to its own connected browsers. Rows are deleted after a few minutes.
CREATE TABLE IF NOT EXISTS socket_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  event VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  payload JSON NOT NULL,
  origin VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_socket_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
