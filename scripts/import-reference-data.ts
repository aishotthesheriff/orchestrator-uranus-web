/**
 * Import reference data from releases/current into the database.
 * Run after bootstrap-database.ts when the DB was wiped and you want to
 * repopulate reference tables and set the current release.
 *
 * Prerequisites:
 * - Database schema exists (run bootstrap-database.ts first).
 * - releases/current/ has manifest.json, metadata.json, and the JSON data files.
 *
 * Usage: npx tsx scripts/import-reference-data.ts
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

const currentDir = join(process.cwd(), "releases", "current");

const RESERVED_WORDS = new Set(["default", "order", "user", "key", "session", "group", "check"]);

function quoteCol(name: string): string {
  return RESERVED_WORDS.has(name.toLowerCase()) ? `"${name}"` : name;
}

/** camelCase -> snake_case */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Get value from row by snake_case or camelCase key */
function getCol(row: Record<string, unknown>, columnName: string): unknown {
  if (columnName in row) return row[columnName];
  const camel = columnName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return row[camel];
}

/** Normalize value for JSONB/JSON columns: always pass valid JSON string or null so pg never sees invalid JSON */
function normalizeJsonCol(value: unknown, udtName: string): unknown {
  const isJson = udtName === "jsonb" || udtName === "json";
  if (!isJson) return value != null ? value : null;
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        JSON.parse(value);
        return value;
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof value === "object" && (Array.isArray(value) || value.constructor === Object)) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

/** Map manifest table key to DB table name */
const manifestToDbTable: Record<string, string> = {
  items: "items",
  events: "events",
  npcs: "npc_templates",
  prompts: "prompt_templates",
  image_prompts: "image_prompts",
  settings: "app_settings",
  image_models: "image_models",
  mod_story_themes: "mod_story_themes",
  mod_visual_styles: "mod_visual_styles",
  llm_models: "llm_models",
};

async function main() {
  const manifestPath = join(currentDir, "manifest.json");
  const metadataPath = join(currentDir, "metadata.json");
  if (!existsSync(manifestPath) || !existsSync(metadataPath)) {
    console.error("\n❌ releases/current/manifest.json and metadata.json must exist.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, string>;
  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as {
    version: string;
    publishedBy: string;
    publishedAt: string;
    notes?: string | null;
  };

  // Resolve file paths: use releases/current/<filename> regardless of manifest path
  const introspectionPath = join(process.cwd(), "temp", "schema-introspection.json");
  if (!existsSync(introspectionPath)) {
    console.error("\n❌ temp/schema-introspection.json not found (needed for column order).");
    process.exit(1);
  }
  const introspection = JSON.parse(readFileSync(introspectionPath, "utf-8"));
  const tablesSchema = (introspection.tables || []) as {
    table_name: string;
    columns: { column_name: string; data_type?: string; udt_name?: string }[];
  }[];
  const columnsByTable = new Map(tablesSchema.map((t) => [t.table_name, t.columns.map((c) => c.column_name)]));
  const columnTypesByTable = new Map(
    tablesSchema.map((t) => [
      t.table_name,
      new Map(t.columns.map((c) => [c.column_name, (c.udt_name || c.data_type || "").toLowerCase()])),
    ])
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Import array tables (items, events, npcs, prompts, image_prompts, image_models, mod_story_themes, mod_visual_styles)
    const arrayTables = [
      "items",
      "events",
      "npc_templates",
      "prompt_templates",
      "image_prompts",
      "image_models",
      "mod_story_themes",
      "mod_visual_styles",
      "llm_models",
    ];
    for (const dbTable of arrayTables) {
      const manifestKey = Object.entries(manifestToDbTable).find(([, v]) => v === dbTable)?.[0] ?? dbTable;
      const fileName = manifestKey === "npc_templates" ? "npcs" : manifestKey === "prompt_templates" ? "prompts" : manifestKey;
      const filePath = join(currentDir, `${fileName}.json`);
      if (!existsSync(filePath)) {
        console.log(`  (skip) ${dbTable}: no ${fileName}.json`);
        continue;
      }
      const rows = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>[];
      // Prefer the live table definition, so tables and columns added by migrations after the
      // introspection snapshot (e.g. llm_models, mod_story_themes.llm_model_key) are imported too.
      const live = await client.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
        [dbTable]
      );
      if (live.rows.length > 0) {
        columnsByTable.set(dbTable, live.rows.map((c: any) => c.column_name));
        columnTypesByTable.set(dbTable, new Map(live.rows.map((c: any) => [c.column_name, String(c.udt_name || "").toLowerCase()])));
      }
      const columns = columnsByTable.get(dbTable);
      if (!columns || columns.length === 0) {
        console.warn(`  (skip) ${dbTable}: no columns in schema`);
        continue;
      }
      // Only insert columns that appear in the data (export may omit optional migration columns)
      const rowKeysSnake = new Set(rows.flatMap((r) => Object.keys(r).map(camelToSnake)));
      const colsToInsert = columns.filter((c) => rowKeysSnake.has(c) || rows.some((r) => getCol(r, c) != null));
      if (colsToInsert.length === 0) {
        console.warn(`  (skip) ${dbTable}: no matching columns`);
        continue;
      }
      const typeMap = columnTypesByTable.get(dbTable);
      let inserted = 0;
      for (const row of rows) {
        const values = colsToInsert.map((col) => {
          const raw = getCol(row, col) ?? null;
          const udt = typeMap?.get(col) ?? "";
          return normalizeJsonCol(raw, udt);
        });
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        const colsQuoted = colsToInsert.map(quoteCol).join(", ");
        const sql = `INSERT INTO ${dbTable} (${colsQuoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        try {
          const r = await client.query(sql, values);
          if (r.rowCount && r.rowCount > 0) inserted++;
        } catch (e: any) {
          if (e.code === "23505") {
            // unique violation - row already exists
          } else {
            throw e;
          }
        }
      }
      console.log(`  ✓ ${dbTable}: ${inserted} new rows (${rows.length} in file)`);
    }

    // Settings: key-value object -> app_settings
    const settingsPath = join(currentDir, "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, string>;
      const cols = columnsByTable.get("app_settings") || ["key", "value", "description", "active", "updated_at"];
      let settingsInserted = 0;
      for (const [key, value] of Object.entries(settings)) {
        const sql = `INSERT INTO app_settings (key, value, description, active, updated_at)
          VALUES ($1, $2, NULL, 1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
        await client.query(sql, [key, value]);
        settingsInserted++;
      }
      console.log(`  ✓ app_settings: ${settingsInserted} keys`);
    }

    // reference_releases: insert current version and set is_current=1
    await client.query(`UPDATE reference_releases SET is_current = 0`);
    await client.query(
      `INSERT INTO reference_releases (version, published_by, published_at, notes, is_current)
       VALUES ($1, $2, $3::timestamp, $4, 1)
       ON CONFLICT (version) DO UPDATE SET published_by = EXCLUDED.published_by, published_at = EXCLUDED.published_at, notes = EXCLUDED.notes, is_current = 1`,
      [metadata.version, metadata.publishedBy, metadata.publishedAt, metadata.notes ?? null]
    );
    console.log(`  ✓ reference_releases: ${metadata.version} set as current`);

    // Optionally set is_default on image_models, mod_visual_styles, mod_story_themes from system_defaults
    const defaultsPath = join(currentDir, "system_defaults.json");
    if (existsSync(defaultsPath)) {
      const defaults = JSON.parse(readFileSync(defaultsPath, "utf-8")) as {
        image_model_key?: string;
        visual_style_key?: string;
        story_theme_key?: string;
        llm_model_key?: string;
      };
      if (defaults.llm_model_key) {
        await client.query(`UPDATE llm_models SET is_default = false`);
        await client.query(`UPDATE llm_models SET is_default = true WHERE model_key = $1`, [defaults.llm_model_key]);
      }
      if (defaults.image_model_key) {
        await client.query(`UPDATE image_models SET is_default = false`);
        await client.query(`UPDATE image_models SET is_default = true WHERE model_key = $1`, [defaults.image_model_key]);
      }
      if (defaults.visual_style_key) {
        await client.query(`UPDATE mod_visual_styles SET "default" = false`);
        await client.query(`UPDATE mod_visual_styles SET "default" = true WHERE visual_style_key = $1`, [defaults.visual_style_key]);
      }
      if (defaults.story_theme_key) {
        await client.query(`UPDATE mod_story_themes SET "default" = false`);
        await client.query(`UPDATE mod_story_themes SET "default" = true WHERE story_theme_key = $1`, [defaults.story_theme_key]);
      }
      console.log(`  ✓ system_defaults applied`);
    }

    console.log("\n✓ Import complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
