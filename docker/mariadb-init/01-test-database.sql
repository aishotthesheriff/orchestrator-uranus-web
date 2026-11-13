-- Runs once, when the MariaDB data volume is first created.
-- The integration tests use their own database so they can never touch game data.
CREATE DATABASE IF NOT EXISTS uranus_dungeon_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON uranus_dungeon_test.* TO 'uranus'@'%';
