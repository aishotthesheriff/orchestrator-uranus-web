/**
 * Reset Game Data Script
 *
 * Deletes all player and run-time data:
 * - users, games
 * - turn_jobs, image_jobs (async jobs)
 * - queue_entries, queue_leases, turn_execution_manifests (orchestrator history)
 * - generated_images (image cache rows; the files in generated_images/ are not touched)
 * - llm_logs (only with RESET_LLM_LOGS=true)
 *
 * Content (prompts, items, models, themes, releases) is not touched; that is what
 * `npm run db:init` manages. All deletes happen in one transaction.
 *
 * Note: Security logs and Prometheus metrics are in-memory only and reset on server restart.
 *
 * Usage:
 *   npx tsx scripts/reset-game-data.ts                 (DATABASE_URL from the environment or .env)
 *   docker compose exec app npx tsx scripts/reset-game-data.ts
 *   RESET_LLM_LOGS=true npx tsx scripts/reset-game-data.ts
 */
import { loadEnv } from './lib/env';

loadEnv();

/** Children before parents, so foreign keys are respected. */
const TABLES = [
  'turn_execution_manifests',
  'queue_leases',
  'queue_entries',
  'turn_jobs',
  'image_jobs',
  'games',
  'users',
  'generated_images',
];

async function resetGameData() {
  const { pool, withTransaction } = await import('../server/db');
  const resetLlmLogs = process.env.RESET_LLM_LOGS === 'true';

  try {
    console.log('\n🗑️  Resetting game data...\n');
    const deleted = await withTransaction(async (client) => {
      const counts: Record<string, number> = {};
      for (const table of resetLlmLogs ? [...TABLES, 'llm_logs'] : TABLES) {
        counts[table] = (await client.query(`DELETE FROM ${table}`)).rowCount;
      }
      return counts;
    });

    for (const [table, count] of Object.entries(deleted)) {
      console.log(`  ✓ Cleared ${count} ${table}`);
    }
    if (!resetLlmLogs) {
      const kept = (await pool.query('SELECT COUNT(*) AS n FROM llm_logs')).rows[0].n;
      console.log(`  ⚠ Kept ${kept} llm_logs (set RESET_LLM_LOGS=true to clear)`);
    }
    console.log('\n✅ Game data reset complete!');
    console.log('Note: Security logs and Prometheus metrics are in-memory only and reset on server restart.');
  } finally {
    await pool.end();
  }
}

resetGameData().catch((error) => {
  console.error('✗ Failed to reset game data (nothing was deleted):', error?.message ?? error);
  process.exit(1);
});
