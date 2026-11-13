/**
 * Database helpers for the integration tests.
 *
 * Tests use the app's own pool. Under Vitest that pool connects to DATABASE_URL_TEST and
 * refuses anything else (see server/db.ts), so a test can never touch game data. The
 * schema is created from server/db/schema/ the first time a test file needs it.
 */
import { pool, type DbPool } from '../../db';
import { runMigrations } from '../../db/migrate';
import { DatabaseStorage } from '../../storage';
import type { IStorage } from '../../storage';

// Avoid orchestrator enqueue side-effects during storage tests
process.env.DISABLE_ORCHESTRATOR_ENQUEUE = process.env.DISABLE_ORCHESTRATOR_ENQUEUE ?? 'true';

let schemaReady: Promise<unknown> | null = null;

function ensureSchema(): Promise<unknown> {
  if (!schemaReady) schemaReady = runMigrations(pool);
  return schemaReady;
}

/**
 * Get a test storage instance (uses the test database, like everything else here)
 */
export function getTestStorage(): IStorage {
  return new DatabaseStorage();
}

/** Tables the tests write to, children before parents so foreign keys are respected. */
const TEST_TABLES = [
  'queue_leases',
  'turn_execution_manifests',
  'queue_entries',
  'turn_jobs',
  'image_jobs',
  'games',
  'users',
];

/**
 * Empty the tables used in tests. Called between tests.
 */
export async function cleanupTestTables(): Promise<void> {
  await ensureSchema();
  for (const table of TEST_TABLES) {
    await pool.query(`DELETE FROM ${table}`);
  }
}

/**
 * Create the schema if it is not there yet
 */
export async function setupTestSchema(): Promise<void> {
  await ensureSchema();
}

/**
 * Close the pool's connections. A later query opens a new pool.
 */
export async function closeTestPool(): Promise<void> {
  await pool.end();
}

/**
 * The pool, for raw queries in tests
 */
export function getTestPool(): DbPool {
  return pool;
}
