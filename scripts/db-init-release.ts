/**
 * Loads a published release into the database, or checks that the database matches one.
 *
 * Usage:
 *   npm run db:init                       schema + newest release into an empty database
 *   npm run db:init -- --version v10.7.0  a specific release
 *   npm run db:init -- --replace          delete existing content and load the release
 *   npm run db:init -- --activate         also switch releases/current to that release
 *   npm run db:verify-release             compare the database with its current release
 *
 * Game data (users, games, logs, the image cache) is never touched.
 * Exit code 0: loaded and verified (or, with --verify-only, verified). 1 otherwise.
 */
import { flagValue, hasFlag, loadEnv } from "./lib/env";

loadEnv();

async function main(): Promise<number> {
  const { pool } = await import("../server/db");
  const { initFromRelease, verifyRelease } = await import("../server/reference/importRelease");
  const log = (message: string) => console.log(message);

  try {
    let verification;
    if (hasFlag("verify-only")) {
      verification = await verifyRelease(flagValue("version"));
    } else {
      const result = await initFromRelease({
        version: flagValue("version"),
        replace: hasFlag("replace"),
        activate: hasFlag("activate"),
        log,
      });
      const total = Object.values(result.rowsLoaded).reduce((sum, n) => sum + n, 0);
      console.log(`Loaded ${total} rows from release ${result.version}.`);
      verification = result.verification;
    }

    console.log(`\nVerification against release ${verification.version ?? "(none)"}:`);
    for (const check of verification.checks) {
      console.log(`  ${check.ok ? "OK  " : "DIFF"}  ${check.name}: ${check.actual} of ${check.expected}`);
      for (const difference of check.differences) console.log(`          ${difference}`);
    }
    for (const problem of verification.problems) console.log(`  PROBLEM  ${problem}`);
    console.log(
      verification.ok
        ? `\nThe database matches release ${verification.version}.`
        : `\nThe database does NOT match release ${verification.version ?? "(none)"}.`
    );
    return verification.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\n${error?.message ?? error}`);
    process.exit(1);
  });
