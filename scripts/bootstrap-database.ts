/**
 * Bootstrap an empty database: create all tables from temp/schema-introspection.json
 * and run migration SQL files. Use after the database has been wiped.
 *
 * Prerequisites:
 * - temp/schema-introspection.json exists (from a previous run of introspect-architecture.ts
 *   against a live DB, or from another source).
 * - DATABASE_URL set (e.g. in .env).
 *
 * Usage: npx tsx scripts/bootstrap-database.ts
 */

import pkg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const dbUrlArg = process.argv.find((arg) => arg.startsWith("DATABASE_URL="));
if (dbUrlArg) {
  process.env.DATABASE_URL = dbUrlArg.split("=").slice(1).join("=");
}

if (existsSync(join(process.cwd(), ".env"))) {
  const envContent = readFileSync(join(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error("\n❌ DATABASE_URL must be set (e.g. in .env).");
  process.exit(1);
}

const { Pool } = pkg;

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  ordinal_position: number;
}

interface ForeignKeyInfo {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface TableSchema {
  table_name: string;
  columns: ColumnInfo[];
  primary_keys: string[];
  foreign_keys: ForeignKeyInfo[];
  unique_constraints: string[];
}

function formatColumnType(col: ColumnInfo): string {
  if (col.data_type === "character varying" || col.data_type === "varchar") {
    if (col.character_maximum_length) {
      return `VARCHAR(${col.character_maximum_length})`;
    }
    return "VARCHAR";
  }
  if (col.data_type === "numeric" || col.data_type === "decimal") {
    if (col.numeric_precision && col.numeric_scale !== null) {
      return `NUMERIC(${col.numeric_precision},${col.numeric_scale})`;
    }
    return "NUMERIC";
  }
  if (col.udt_name === "int4") return "INTEGER";
  if (col.udt_name === "int8") return "BIGINT";
  if (col.udt_name === "int2") return "SMALLINT";
  if (col.data_type === "timestamp without time zone") return "TIMESTAMP";
  if (col.data_type === "timestamp with time zone") return "TIMESTAMPTZ";
  if (col.udt_name === "jsonb") return "JSONB";
  if (col.udt_name === "json") return "JSON";
  return col.data_type.toUpperCase();
}

function formatDefault(defaultValue: string): string {
  if (defaultValue.includes("gen_random_uuid()")) return "gen_random_uuid()";
  if (defaultValue.includes("now()") || defaultValue.includes("CURRENT_TIMESTAMP")) return "NOW()";
  if (defaultValue.match(/^nextval\(/)) {
    return defaultValue.replace(/::\w+/g, "");
  }
  return defaultValue.replace(/::\w+/g, "");
}

const RESERVED_WORDS = new Set(["default", "order", "user", "key", "session", "group", "check"]);

function quoteCol(name: string): string {
  return RESERVED_WORDS.has(name.toLowerCase()) ? `"${name}"` : name;
}

function generateCreateTableSQL(table: TableSchema, ifNotExists: boolean): string {
  const lines: string[] = [];
  const ifNotExistsClause = ifNotExists ? " IF NOT EXISTS" : "";
  lines.push(`CREATE TABLE${ifNotExistsClause} ${table.table_name} (`);

  for (let i = 0; i < table.columns.length; i++) {
    const col = table.columns[i];
    const colName = quoteCol(col.column_name);
    const typeStr = formatColumnType(col);
    const nullable = col.is_nullable === "YES" ? "" : " NOT NULL";
    const defaultStr = col.column_default ? ` DEFAULT ${formatDefault(col.column_default)}` : "";
    const isLast = i === table.columns.length - 1;
    lines.push(`  ${colName} ${typeStr}${nullable}${defaultStr}${isLast ? "" : ","}`);
  }

  lines.push(");");
  return lines.join("\n");
}

function generateAlterPrimaryKey(table: TableSchema): string | null {
  if (table.primary_keys.length === 0) return null;
  const pkCols = table.primary_keys.map(quoteCol).join(", ");
  return `ALTER TABLE ${table.table_name} ADD PRIMARY KEY (${pkCols});`;
}

function generateAlterFKs(table: TableSchema): string[] {
  const statements: string[] = [];
  for (const fk of table.foreign_keys) {
    const col = quoteCol(fk.column_name);
    const refCol = quoteCol(fk.foreign_column_name);
    statements.push(
      `ALTER TABLE ${table.table_name} ADD CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${col}) REFERENCES ${fk.foreign_table_name}(${refCol});`
    );
  }
  return statements;
}

function topologicalSort(tables: TableSchema[]): TableSchema[] {
  const byName = new Map(tables.map((t) => [t.table_name, t]));
  const order: TableSchema[] = [];
  const visited = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const table = byName.get(name);
    if (!table) return;
    for (const fk of table.foreign_keys) {
      if (byName.has(fk.foreign_table_name)) {
        visit(fk.foreign_table_name);
      }
    }
    order.push(table);
  }

  for (const t of tables) {
    visit(t.table_name);
  }
  return order;
}

async function main() {
  const introspectionPath = join(process.cwd(), "temp", "schema-introspection.json");
  if (!existsSync(introspectionPath)) {
    console.error(`\n❌ ${introspectionPath} not found. Run introspect-architecture.ts against a live DB first to generate it.`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(introspectionPath, "utf-8"));
  const tables: TableSchema[] = raw.tables || [];

  if (tables.length === 0) {
    console.error("\n❌ No tables in schema-introspection.json.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log("\n--- Creating tables from introspection (IF NOT EXISTS) ---");
    const sorted = topologicalSort(tables);
    for (const table of sorted) {
      const createSQL = generateCreateTableSQL(table, true);
      try {
        await client.query(createSQL);
        console.log(`  ✓ ${table.table_name}`);
      } catch (e: any) {
        if (e.code === "42P07") {
          console.log(`  (exists) ${table.table_name}`);
        } else {
          throw e;
        }
      }
    }

    console.log("\n--- Adding primary keys ---");
    for (const table of sorted) {
      const pkSQL = generateAlterPrimaryKey(table);
      if (pkSQL) {
        try {
          await client.query(pkSQL);
          console.log(`  ✓ ${table.table_name} PK`);
        } catch (e: any) {
          if (e.code === "42710" || e.code === "42P16") {
            // 42P16: the table already has a primary key (re-running on an existing database)
            console.log(`  (exists) ${table.table_name} PK`);
          } else {
            throw e;
          }
        }
      }
    }

    console.log("\n--- Adding foreign keys and unique constraints ---");
    for (const table of sorted) {
      const alterFKs = generateAlterFKs(table);
      for (const sql of alterFKs) {
        try {
          await client.query(sql);
          console.log(`  ✓ ${table.table_name} FK`);
        } catch (e: any) {
          if (e.code === "42710") {
            console.log(`  (constraint exists) ${table.table_name}`);
          } else {
            throw e;
          }
        }
      }
      for (const unique of table.unique_constraints) {
        const constraintName = `${table.table_name}_${unique}_key`;
        const uniqueQuoted = quoteCol(unique);
        try {
          await client.query(
            `ALTER TABLE ${table.table_name} ADD CONSTRAINT ${constraintName} UNIQUE (${uniqueQuoted});`
          );
          console.log(`  ✓ ${table.table_name} UNIQUE (${unique})`);
        } catch (e: any) {
          if (e.code === "42710" || e.code === "42P07") {
            console.log(`  (constraint exists) ${table.table_name} ${unique}`);
          } else {
            throw e;
          }
        }
      }
    }

    const migrationsDir = join(process.cwd(), "server", "migrations");
    const migrationOrder = [
      "20251104_create_queue_entries.sql",
      "20251104_create_queue_leases.sql",
      "20251104_create_turn_execution_manifests.sql",
      "20251104_create_legacy_turn_jobs_view.sql",
      "20251101_add_unique_active_image_job_index.sql",
      "20250127_add_pce_inspector.sql",
      "20250115_add_games_username_fk.sql",
      "20250116_add_typewriter_enabled_to_users.sql",
      "20251031_remove_mood_from_users.sql",
      "20250115_add_skip_image_cache_to_users.sql",
      "20251103_update_user_defaults.sql",
      "20261112_add_llm_models.sql",
    ];

    console.log("\n--- Running migrations ---");
    for (const name of migrationOrder) {
      const path = join(migrationsDir, name);
      if (!existsSync(path)) continue;
      const sql = readFileSync(path, "utf-8");
      try {
        await client.query(sql);
        console.log(`  ✓ ${name}`);
      } catch (e: any) {
        if (e.code === "42P07" || e.code === "42710" || e.message?.includes("already exists")) {
          console.log(`  (skipped) ${name}`);
        } else {
          console.warn(`  ⚠ ${name}: ${e.message}`);
        }
      }
    }

    console.log("\n✓ Bootstrap complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
