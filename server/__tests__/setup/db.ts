import pkg from 'pg';
import fs from 'fs';
import { DatabaseStorage, type IStorage } from '../../storage';

if (!process.env.DISABLE_ORCHESTRATOR_ENQUEUE) {
  process.env.DISABLE_ORCHESTRATOR_ENQUEUE = 'true';
}

async function ensureOrchestratorTables(client: pkg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS queue_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      queue TEXT NOT NULL,
      payload_table TEXT NOT NULL,
      payload_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      run_at TIMESTAMP NOT NULL DEFAULT NOW(),
      lease_id UUID,
      lease_owner TEXT,
      lease_expires_at TIMESTAMP,
      trace_id TEXT,
      request_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      idempotency_key TEXT,
      last_error JSONB
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS queue_leases (
      lease_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
      worker_id TEXT NOT NULL,
      heartbeat_expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      renewed_at TIMESTAMP,
      released_at TIMESTAMP,
      outcome TEXT,
      outcome_details JSONB
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS turn_execution_manifests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID NOT NULL,
      turn_number INTEGER NOT NULL,
      queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      manifest JSONB NOT NULL,
      manifest_hash BYTEA NOT NULL,
      precompute_hash BYTEA NOT NULL,
      trace_id TEXT,
      request_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_queue_pending ON queue_entries(queue, run_at, priority DESC) WHERE status = 'pending'`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_idempotency ON queue_entries(queue, idempotency_key) WHERE idempotency_key IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_queue_status_updated ON queue_entries(queue, status, updated_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_queue_payload ON queue_entries(payload_table, payload_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_queue_trace_id ON queue_entries(trace_id) WHERE trace_id IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_lease_entry_id ON queue_leases(entry_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_lease_worker_id ON queue_leases(worker_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_lease_expires_at ON queue_leases(heartbeat_expires_at) WHERE outcome IS NULL`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_manifest_game_turn_attempt ON turn_execution_manifests(game_id, turn_number, attempt)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_manifest_queue_entry ON turn_execution_manifests(queue_entry_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_manifest_trace_id ON turn_execution_manifests(trace_id) WHERE trace_id IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_manifest_game_turn ON turn_execution_manifests(game_id, turn_number)`);
}

const { Pool } = pkg;
type PgPool = pkg.Pool;

// Use test database URL if provided, otherwise use regular database with test schema
let testDatabaseUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "DATABASE_URL_TEST or DATABASE_URL must be set for tests. Did you forget to provision a database?",
  );
}

// Convert Docker hostnames to localhost for tests ONLY when running outside Docker
// Docker hostnames like "postgres", "postgres-1", etc. won't resolve outside Docker
// But inside Docker, we should use the service name (postgres) directly
if (testDatabaseUrl && !process.env.DATABASE_URL_TEST) {
  // Detect if we're running inside Docker by checking common indicators
  let isInsideDocker = false;
  try {
    // Check for /.dockerenv file (most reliable indicator)
    isInsideDocker = fs.existsSync('/.dockerenv');
  } catch {
    // If we can't check, assume we're not in Docker
  }
  
  // Also check environment variables
  if (!isInsideDocker) {
    isInsideDocker = 
      process.env.DOCKER_CONTAINER === 'true' ||
      process.env.HOSTNAME?.includes('docker') ||
      process.env.HOSTNAME?.includes('container') ||
      false;
  }
  
  // Only convert if we're NOT inside Docker
  if (!isInsideDocker) {
    // Check for common Docker hostname patterns
    const dockerHostnamePatterns = [
      /@postgres(-\d+)?:/,  // postgres, postgres-1, postgres-2, etc.
      /@postgresql(-\d+)?:/,
      /@db(-\d+)?:/,
    ];
    
    for (const pattern of dockerHostnamePatterns) {
      if (pattern.test(testDatabaseUrl)) {
        // Replace Docker hostname with localhost
        testDatabaseUrl = testDatabaseUrl.replace(pattern, '@localhost:');
        console.log(`[test setup] Converted Docker hostname to localhost: ${testDatabaseUrl}`);
        break;
      }
    }
  } else {
    console.log(`[test setup] Running inside Docker, keeping original hostname: ${testDatabaseUrl}`);
  }
}

// Ensure DATABASE_URL is set before db.ts is imported by other modules
// This allows DatabaseStorage to use the test database connection
if (!process.env.DATABASE_URL && testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

// Create test pool using testDatabaseUrl
// Always create a separate pool for tests to avoid conflicts
const testPool = new Pool({
  connectionString: testDatabaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

/**
 * Get a test storage instance
 * If using test schema, sets search_path; otherwise uses separate DB
 */
export function getTestStorage(): IStorage {
  // For now, use the regular storage instance with the shared pool
  // Tests will rely on cleanup between tests for isolation
  // TODO: Refactor DatabaseStorage to accept a pool parameter for better testability
  return new DatabaseStorage();
}

/**
 * Clean up test tables between tests
 * Truncates the main tables used in tests
 * Uses CASCADE to handle foreign key constraints
 */
export async function cleanupTestTables(): Promise<void> {
  // Use testPool instead of pool from db.ts to avoid connection issues
  // testPool is configured with DATABASE_URL_TEST or DATABASE_URL
  const client = await testPool.connect();
  try {
    await ensureOrchestratorTables(client);
    await client.query('BEGIN');
    // Truncate in order respecting foreign keys
    // Note: CASCADE will handle foreign key constraints
    await client.query('TRUNCATE TABLE queue_leases CASCADE');
    await client.query('TRUNCATE TABLE queue_entries CASCADE');
    await client.query('TRUNCATE TABLE turn_execution_manifests CASCADE');
    await client.query('TRUNCATE TABLE turn_jobs CASCADE');
    await client.query('TRUNCATE TABLE image_jobs CASCADE');
    await client.query('TRUNCATE TABLE games CASCADE');
    await client.query('TRUNCATE TABLE users CASCADE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Setup test schema if needed
 * Currently assumes tables already exist - extend this if you need schema creation
 */
export async function setupTestSchema(): Promise<void> {
  // Tables should already exist from migrations
  // If using a separate test schema, create it here
  // For now, we'll just verify connection
  const client = await testPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * Close test pool connections
 */
export async function closeTestPool(): Promise<void> {
  await testPool.end();
}

/**
 * Get the test pool directly for raw queries if needed
 */
export function getTestPool(): PgPool {
  return testPool;
}
