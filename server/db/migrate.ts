/**
 * Applies the schema files in server/db/schema/ in name order, once each.
 *
 * What has been applied is recorded in the `schema_migrations` table with a checksum.
 * MariaDB commits every DDL statement on its own, so a file cannot be rolled back; the
 * statements are written to be safe to repeat (IF NOT EXISTS), and a file that stopped
 * halfway is simply applied again on the next run.
 */
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Queryable } from "../db";

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema");

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Splits a schema file into statements: one per `;` at the end of a line, comments removed. */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(/;[ \t]*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export async function runMigrations(db: Queryable, log: (message: string) => void = () => {}): Promise<MigrationResult> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
       checksum CHAR(64) NOT NULL,
       applied_at DATETIME(3) NOT NULL DEFAULT NOW(3),
       PRIMARY KEY (version)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  const done = new Map<string, string>(
    (await db.query("SELECT version, checksum FROM schema_migrations")).rows.map((r: any) => [r.version, r.checksum])
  );

  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = readFileSync(path.join(SCHEMA_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    const recorded = done.get(file);
    if (recorded) {
      if (recorded !== checksum) {
        throw new Error(
          `Schema file ${file} was changed after it was applied to this database. ` +
            `Applied files must not be edited; add a new file for the change.`
        );
      }
      result.alreadyApplied.push(file);
      continue;
    }

    const statements = splitStatements(sql);
    for (let i = 0; i < statements.length; i++) {
      try {
        await db.query(statements[i]);
      } catch (error: any) {
        const firstLine = statements[i].split("\n")[0];
        throw new Error(`${file}, statement ${i + 1} (${firstLine}) failed: ${error?.sqlMessage ?? error?.message ?? error}`);
      }
    }
    await db.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
    log(`applied ${file} (${statements.length} statements)`);
    result.applied.push(file);
  }
  return result;
}
