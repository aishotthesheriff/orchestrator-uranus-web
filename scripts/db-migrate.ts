/**
 * Creates or updates the database schema (server/db/schema/*.sql). Safe to run again:
 * files that were already applied are skipped.
 *
 * Usage: npm run db:migrate          (uses DATABASE_URL from the environment or .env)
 */
import { loadEnv } from "./lib/env";

loadEnv();

async function main() {
  const { pool } = await import("../server/db");
  const { runMigrations } = await import("../server/db/migrate");
  try {
    const result = await runMigrations(pool, (message) => console.log(`  ${message}`));
    console.log(
      result.applied.length > 0
        ? `Schema updated: ${result.applied.length} file(s) applied, ${result.alreadyApplied.length} already in place.`
        : `Schema is up to date (${result.alreadyApplied.length} file(s) already applied).`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Schema migration failed: ${error?.message ?? error}`);
  process.exit(1);
});
