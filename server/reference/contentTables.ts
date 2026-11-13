/**
 * The content tables: everything an admin edits in Dev Tools that the game is built from.
 *
 * A release (format 2) stores every row of each of these tables under `workspace/`, so an
 * empty database can be loaded from a release alone. Game data (users, games, jobs, logs,
 * image cache, test runs) is not content and is never part of a release.
 *
 * This list is the single place that names the tables and their JSON, date and boolean
 * columns; the publisher, the importer and the verifier all read it.
 */

export interface ContentTableSpec {
  /** Database table name; also the workspace file name (`workspace/<table>.json`). */
  table: string;
  /** Primary key column. */
  primaryKey: string;
  /** Columns holding JSON documents (objects or arrays). */
  jsonColumns: readonly string[];
  /** Columns holding timestamps (ISO strings in the file, UTC). */
  dateColumns: readonly string[];
  /** Columns holding true/false (not the 0/1 integer flags such as `active`). */
  booleanColumns: readonly string[];
}

export const CONTENT_TABLES: readonly ContentTableSpec[] = [
  {
    table: "items",
    primaryKey: "id",
    jsonColumns: ["scene_effect_tags", "efficiency", "tags"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
  {
    table: "events",
    primaryKey: "id",
    jsonColumns: ["trigger_condition", "tags"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
  {
    table: "npc_templates",
    primaryKey: "id",
    jsonColumns: ["tags"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
  {
    table: "prompt_templates",
    primaryKey: "id",
    jsonColumns: [],
    dateColumns: ["created_at", "updated_at", "last_tested_at"],
    booleanColumns: [],
  },
  {
    table: "image_prompts",
    primaryKey: "id",
    jsonColumns: ["scene_types", "tags"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
  {
    table: "image_models",
    primaryKey: "id",
    jsonColumns: ["allowed_sizes", "capabilities", "provider_params"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: ["is_default"],
  },
  {
    table: "llm_models",
    primaryKey: "id",
    jsonColumns: ["params", "last_check_summary"],
    dateColumns: ["last_check_at", "created_at", "updated_at"],
    booleanColumns: ["is_default", "adult", "supports_json_mode", "last_check_ok"],
  },
  {
    table: "mod_story_themes",
    primaryKey: "id",
    jsonColumns: [],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: ["default"],
  },
  {
    table: "mod_visual_styles",
    primaryKey: "id",
    jsonColumns: [],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: ["default"],
  },
  {
    table: "app_settings",
    primaryKey: "key",
    jsonColumns: [],
    dateColumns: ["updated_at"],
    booleanColumns: [],
  },
  {
    table: "interview_questions",
    primaryKey: "id",
    jsonColumns: ["tags"],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
  {
    // The *_json columns of this table are plain text that happens to hold JSON; they stay strings.
    table: "pce_test_scenarios",
    primaryKey: "id",
    jsonColumns: [],
    dateColumns: ["created_at", "updated_at"],
    booleanColumns: [],
  },
];

export const CONTENT_TABLE_NAMES: readonly string[] = CONTENT_TABLES.map((t) => t.table);

export function getContentTableSpec(table: string): ContentTableSpec {
  const spec = CONTENT_TABLES.find((t) => t.table === table);
  if (!spec) throw new Error(`'${table}' is not a content table`);
  return spec;
}

/** The format a release is written in today. Releases without `formatVersion` are format 1. */
export const RELEASE_FORMAT_VERSION = 2;

/**
 * A release version doubles as a directory name under releases/, so it is restricted to
 * characters that are safe in a path. `current` is reserved for the active copy.
 */
export function assertValidReleaseVersion(version: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version) || version === "current" || version.includes("..")) {
    throw new Error(
      `Invalid release version '${version}': use 1 to 64 letters, digits, dots, dashes or underscores, starting with a letter or digit ('current' is reserved)`
    );
  }
}
