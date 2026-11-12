import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Reset Game Data Script
 * 
 * Flushes all user data, game data, telemetry/logs, and cache tables:
 * - users (user accounts and profiles)
 * - games (game state)
 * - turn_jobs (async turn processing jobs)
 * - image_jobs (async image generation jobs)
 * - generated_images (image cache)
 * - session (Express session storage)
 * - llm_logs (AI interaction logs - optional)
 * - queue_entries (orchestrator job tracking/telemetry)
 * - queue_leases (job lease history/telemetry)
 * - turn_execution_manifests (turn execution manifests/logs)
 * 
 * Note: Security logs and Prometheus metrics are in-memory only and reset on server restart.
 * 
 * Usage:
 *   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/reset-game-data.ts
 * 
 *   Or inside Docker:
 *   docker-compose exec app-1 npx tsx scripts/reset-game-data.ts
 * 
 *   To also clear llm_logs:
 *   RESET_LLM_LOGS=true npx tsx scripts/reset-game-data.ts
 */
async function resetGameData() {
  let client;
  try {
    client = await pool.connect();
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    console.error('\nTip: If you are running locally, use localhost instead of postgres:');
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/reset-game-data.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app-1 npx tsx scripts/reset-game-data.ts');
    throw error;
  }
  
  const resetLlmLogs = process.env.RESET_LLM_LOGS === 'true';
  
  try {
    await client.query('BEGIN');
    
    console.log('\n🗑️  Resetting game data...\n');
    
    // Helper to get count before deletion and truncate
    const truncateAndReport = async (tableName: string): Promise<number> => {
      const countResult = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const count = parseInt(countResult.rows[0].count, 10);
      await client.query(`TRUNCATE TABLE ${tableName} CASCADE`);
      return count;
    };
    
    // Truncate in order respecting foreign key constraints
    // Using CASCADE to handle foreign keys automatically
    
    console.log('Clearing async job queues...');
    const turnJobsCount = await truncateAndReport('turn_jobs');
    console.log(`  ✓ Cleared ${turnJobsCount} turn_jobs`);
    
    const imageJobsCount = await truncateAndReport('image_jobs');
    console.log(`  ✓ Cleared ${imageJobsCount} image_jobs`);
    
    console.log('\nClearing orchestrator telemetry/logs...');
    // Clear in dependency order (child tables first, then parent)
    const turnManifestsCount = await truncateAndReport('turn_execution_manifests');
    console.log(`  ✓ Cleared ${turnManifestsCount} turn_execution_manifests`);
    
    const queueLeasesCount = await truncateAndReport('queue_leases');
    console.log(`  ✓ Cleared ${queueLeasesCount} queue_leases`);
    
    const queueEntriesCount = await truncateAndReport('queue_entries');
    console.log(`  ✓ Cleared ${queueEntriesCount} queue_entries`);
    
    console.log('\nClearing game data...');
    const gamesCount = await truncateAndReport('games');
    console.log(`  ✓ Cleared ${gamesCount} games`);
    
    console.log('\nClearing user data...');
    const usersCount = await truncateAndReport('users');
    console.log(`  ✓ Cleared ${usersCount} users`);
    
    console.log('\nClearing cache tables...');
    const generatedImagesCount = await truncateAndReport('generated_images');
    console.log(`  ✓ Cleared ${generatedImagesCount} generated_images (image cache)`);
    
    const sessionCount = await truncateAndReport('session');
    console.log(`  ✓ Cleared ${sessionCount} sessions`);
    
    let llmLogsCount = 0;
    if (resetLlmLogs) {
      llmLogsCount = await truncateAndReport('llm_logs');
      console.log(`  ✓ Cleared ${llmLogsCount} llm_logs`);
    } else {
      const llmLogsResult = await client.query('SELECT COUNT(*) as count FROM llm_logs');
      llmLogsCount = parseInt(llmLogsResult.rows[0].count, 10);
      console.log(`  ⚠ Skipped ${llmLogsCount} llm_logs (set RESET_LLM_LOGS=true to clear)`);
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Game data reset complete!');
    console.log('\nSummary:');
    console.log(`  - ${usersCount} users deleted`);
    console.log(`  - ${gamesCount} games deleted`);
    console.log(`  - ${turnJobsCount} turn jobs deleted`);
    console.log(`  - ${imageJobsCount} image jobs deleted`);
    console.log(`  - ${turnManifestsCount} turn execution manifests deleted`);
    console.log(`  - ${queueLeasesCount} queue leases deleted`);
    console.log(`  - ${queueEntriesCount} queue entries deleted`);
    console.log(`  - ${generatedImagesCount} cached images deleted`);
    console.log(`  - ${sessionCount} sessions deleted`);
    if (resetLlmLogs && llmLogsCount > 0) {
      console.log(`  - ${llmLogsCount} llm_logs deleted`);
    }
    console.log('\nNote: Security logs and Prometheus metrics are in-memory only and reset on server restart.');
    
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
    }
    console.error('✗ Failed to reset game data:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

resetGameData().catch(console.error);

