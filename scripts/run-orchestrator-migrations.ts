/**
 * Run orchestrator database migrations
 * Executes the SQL migration files for the orchestrator system
 */

import pkg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const migrations = [
  '20251104_create_queue_entries.sql',
  '20251104_create_queue_leases.sql',
  '20251104_create_turn_execution_manifests.sql',
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    console.log('✓ Connected to database');
    
    for (const migrationFile of migrations) {
      const migrationPath = join(__dirname, '../server/migrations', migrationFile);
      console.log(`\n📄 Running migration: ${migrationFile}`);
      
      const sql = readFileSync(migrationPath, 'utf-8');
      await client.query(sql);
      
      console.log(`✓ Completed: ${migrationFile}`);
    }
    
    await client.query('COMMIT');
    console.log('\n✅ All migrations completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n✗ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});

