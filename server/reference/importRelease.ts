/**
 * Loads a published release into the database, and checks that the database matches one.
 *
 * `initFromRelease` is what makes an empty database usable: it reads a release from
 * releases/, validates it before touching anything, loads every content table in one
 * transaction, records the release as current, and then verifies the result.
 *
 * `verifyRelease` is the proof: it re-exports the database the same way publishing does
 * and compares the output with the release, value by value. It changes nothing.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { pool, type DbClient, type Queryable } from "../db";
import { storage } from "../storage";
import { CONTENT_TABLES, assertValidReleaseVersion, type ContentTableSpec } from "./contentTables";
import { copyVersionToCurrent, exportReferenceTables, type ReleaseMetadata } from "./publishReference";
import { clearReferenceCache, getCurrentReference } from "./referenceLoader";

type Row = Record<string, unknown>;

const PRESET_SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "seeds", "pce_presets.json");

function releasesRoot(): string {
  return path.join(process.cwd(), "releases");
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Finding releases on disk
// ---------------------------------------------------------------------------

export interface ReleaseOnDisk {
  /** Folder under releases/ the files are read from (a version folder, or `current`). */
  dirName: string;
  metadata: ReleaseMetadata;
}

/** Every release folder that has a metadata.json, newest first. `current` is not listed. */
export async function listReleasesOnDisk(): Promise<ReleaseOnDisk[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(releasesRoot());
  } catch {
    return [];
  }
  const found: ReleaseOnDisk[] = [];
  for (const dirName of entries) {
    if (dirName === "current" || dirName.startsWith(".")) continue;
    const metadataFile = path.join(releasesRoot(), dirName, "metadata.json");
    if (!(await exists(metadataFile))) continue;
    try {
      const metadata = await readJson<ReleaseMetadata>(metadataFile);
      if (metadata.version === dirName && !Number.isNaN(Date.parse(metadata.publishedAt))) {
        found.push({ dirName, metadata });
      }
    } catch {
      // unreadable metadata: not a usable release
    }
  }
  return found.sort((a, b) => Date.parse(b.metadata.publishedAt) - Date.parse(a.metadata.publishedAt));
}

async function readCurrentOnDisk(): Promise<ReleaseOnDisk | null> {
  try {
    const metadata = await readJson<ReleaseMetadata>(path.join(releasesRoot(), "current", "metadata.json"));
    return { dirName: "current", metadata };
  } catch {
    return null;
  }
}

/**
 * The release to load: the named version, or the most recently published one. A release
 * whose own folder is missing can still be read from releases/current when that copy is
 * the same version (a fresh clone tracks only current/ and the newest version folder).
 */
export async function resolveRelease(version?: string): Promise<ReleaseOnDisk> {
  const onDisk = await listReleasesOnDisk();
  const current = await readCurrentOnDisk();

  if (version) {
    assertValidReleaseVersion(version);
    const match = onDisk.find((r) => r.metadata.version === version);
    if (match) return match;
    if (current?.metadata.version === version) return current;
    throw new Error(`Release '${version}' was not found under releases/ (no folder with a metadata.json for it).`);
  }

  const candidates = [...onDisk];
  if (current && !onDisk.some((r) => r.metadata.version === current.metadata.version)) candidates.push(current);
  candidates.sort((a, b) => Date.parse(b.metadata.publishedAt) - Date.parse(a.metadata.publishedAt));
  if (candidates.length === 0) {
    throw new Error("No published release was found under releases/. A release folder needs a metadata.json.");
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Reading a release into rows
// ---------------------------------------------------------------------------

interface ReleaseContent {
  release: ReleaseOnDisk;
  formatVersion: number;
  /** Rows to insert, per content table, as snake_case database rows. */
  rows: Map<string, Row[]>;
  problems: string[];
}

function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

async function readFormat2(release: ReleaseOnDisk, content: ReleaseContent): Promise<void> {
  const dir = path.join(releasesRoot(), release.dirName);
  for (const spec of CONTENT_TABLES) {
    const info = release.metadata.workspace?.[spec.table];
    if (!info) {
      content.problems.push(`metadata.json does not list a workspace file for ${spec.table}`);
      continue;
    }
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, info.file), "utf8");
    } catch {
      content.problems.push(`${info.file} is missing`);
      continue;
    }
    const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
    if (sha256 !== info.sha256) {
      content.problems.push(`${info.file} does not match its checksum (the file was changed after publishing)`);
      continue;
    }
    let rows: Row[];
    try {
      rows = JSON.parse(text);
    } catch {
      content.problems.push(`${info.file} is not valid JSON`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== info.rows) {
      content.problems.push(`${info.file} holds ${Array.isArray(rows) ? rows.length : "no"} rows, metadata.json says ${info.rows}`);
      continue;
    }
    content.rows.set(spec.table, rows);
  }
}

/**
 * Older releases hold only the runtime files: active rows, in the camelCase shape the game
 * reads. They are mapped back to database rows. Interview questions are not in such a
 * release, and the Inspector presets come from the seed file.
 */
async function readFormat1(release: ReleaseOnDisk, content: ReleaseContent): Promise<void> {
  const dir = path.join(releasesRoot(), release.dirName);
  for (const spec of CONTENT_TABLES) {
    if (!spec.runtimeFile) {
      content.rows.set(spec.table, []);
      continue;
    }
    const file = path.join(dir, spec.runtimeFile);
    if (!(await exists(file))) {
      // Releases older than a table simply do not have its file.
      content.rows.set(spec.table, []);
      continue;
    }
    let data: unknown;
    try {
      data = await readJson(file);
    } catch {
      content.problems.push(`${spec.runtimeFile} is not valid JSON`);
      continue;
    }
    if (spec.table === "app_settings") {
      content.rows.set(
        spec.table,
        Object.entries(data as Record<string, string>).map(([key, value]) => ({ key, value, active: 1 }))
      );
      continue;
    }
    if (!Array.isArray(data)) {
      content.problems.push(`${spec.runtimeFile} should hold a list of rows`);
      continue;
    }
    content.rows.set(
      spec.table,
      (data as Row[]).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camelToSnake(k), v])))
    );
  }

  // system_defaults.json names the default model, style and theme.
  const defaultsFile = path.join(dir, "system_defaults.json");
  if (await exists(defaultsFile)) {
    const defaults = await readJson<Record<string, string | undefined>>(defaultsFile);
    const mark = (table: string, keyColumn: string, key: string | undefined, flag: string) => {
      if (!key) return;
      for (const row of content.rows.get(table) ?? []) row[flag] = row[keyColumn] === key;
    };
    mark("image_models", "model_key", defaults.image_model_key, "is_default");
    mark("llm_models", "model_key", defaults.llm_model_key, "is_default");
    mark("mod_visual_styles", "visual_style_key", defaults.visual_style_key, "default");
    mark("mod_story_themes", "story_theme_key", defaults.story_theme_key, "default");
  }

  content.rows.set("pce_test_scenarios", await readJson<Row[]>(PRESET_SEED_FILE));
}

async function readRelease(release: ReleaseOnDisk): Promise<ReleaseContent> {
  const formatVersion = release.metadata.formatVersion ?? 1;
  const content: ReleaseContent = { release, formatVersion, rows: new Map(), problems: [] };
  if (formatVersion >= 2) await readFormat2(release, content);
  else await readFormat1(release, content);
  return content;
}

// ---------------------------------------------------------------------------
// Checking rows against the live schema, and converting values
// ---------------------------------------------------------------------------

interface LiveColumn {
  name: string;
  /** NOT NULL with no default: a row must supply it. */
  required: boolean;
}

async function liveColumns(db: Queryable, table: string): Promise<LiveColumn[]> {
  const result = await db.query(
    `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS default_value, EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = $1
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return result.rows
    // Generated columns are computed by the database and cannot be inserted.
    .filter((c: any) => !/GENERATED/i.test(String(c.extra ?? "")))
    .map((c: any) => ({ name: c.name, required: c.nullable === "NO" && c.default_value === null }));
}

function toDatabaseValue(spec: ContentTableSpec, column: string, value: unknown, where: string): unknown {
  if (value === null || value === undefined) return null;
  if (spec.jsonColumns.includes(column)) return JSON.stringify(value);
  if (spec.dateColumns.includes(column)) {
    const date = new Date(value as string);
    if (Number.isNaN(date.getTime())) throw new Error(`${where}: '${String(value)}' is not a date`);
    return date;
  }
  if (typeof value === "object") {
    throw new Error(`${where}: holds an object, but ${column} is not a JSON column`);
  }
  return value;
}

async function validateAgainstSchema(db: Queryable, content: ReleaseContent): Promise<void> {
  for (const spec of CONTENT_TABLES) {
    const rows = content.rows.get(spec.table);
    if (!rows) continue;
    const columns = await liveColumns(db, spec.table);
    if (columns.length === 0) {
      content.problems.push(`Table ${spec.table} does not exist. Run: npm run db:migrate`);
      continue;
    }
    const known = new Set(columns.map((c) => c.name));
    const unknown = new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) if (!known.has(key)) unknown.add(key);
      const id = String(row[spec.primaryKey] ?? "");
      if (!id) content.problems.push(`${spec.table}: a row has no ${spec.primaryKey}`);
      else if (seen.has(id)) content.problems.push(`${spec.table}: ${spec.primaryKey} '${id}' appears twice`);
      seen.add(id);
      for (const column of columns) {
        if (column.required && (row[column.name] === null || row[column.name] === undefined)) {
          content.problems.push(`${spec.table} '${id}': required column ${column.name} has no value`);
        }
      }
    }
    for (const column of unknown) {
      content.problems.push(`${spec.table}: the release has a column '${column}' that the database table does not`);
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface InitOptions {
  /** Release to load. Default: the most recently published one on disk. */
  version?: string;
  /** Replace existing content. Without it, a database that already has content is refused. */
  replace?: boolean;
  /** Allow releases/current to be switched to the release being loaded. */
  activate?: boolean;
  log?: (message: string) => void;
}

export interface InitResult {
  version: string;
  formatVersion: number;
  rowsLoaded: Record<string, number>;
  verification: VerifyResult;
}

async function contentRowCounts(db: Queryable): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const spec of CONTENT_TABLES) {
    const result = await db.query(`SELECT COUNT(*) AS n FROM ${spec.table}`);
    counts[spec.table] = Number(result.rows[0].n);
  }
  return counts;
}

async function insertRows(client: DbClient, spec: ContentTableSpec, rows: Row[]): Promise<void> {
  for (const row of rows) {
    const id = String(row[spec.primaryKey]);
    const columns = Object.keys(row);
    const values = columns.map((column) => toDatabaseValue(spec, column, row[column], `${spec.table} '${id}', ${column}`));
    const columnList = columns.map((c) => `\`${c}\``).join(", ");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    try {
      await client.query(`INSERT INTO ${spec.table} (${columnList}) VALUES (${placeholders})`, values);
    } catch (error: any) {
      throw new Error(`${spec.table} '${id}' could not be inserted: ${error?.sqlMessage ?? error?.message ?? error}`);
    }
  }
}

/**
 * Loads a release into the database and makes it the current one.
 * Nothing is written unless every check passes, and the load is one transaction.
 */
export async function initFromRelease(options: InitOptions = {}): Promise<InitResult> {
  const log = options.log ?? (() => {});

  // 1. Pick the release
  const release = await resolveRelease(options.version);
  const version = release.metadata.version;
  log(`Release ${version} (published ${release.metadata.publishedAt} by ${release.metadata.publishedBy}), read from releases/${release.dirName}`);

  const current = await readCurrentOnDisk();
  const needsActivation = current?.metadata.version !== version;
  if (needsActivation && current && !options.activate) {
    throw new Error(
      `releases/current is ${current.metadata.version}, not ${version}. ` +
        `Pass --activate to switch the game to ${version}, or --version ${current.metadata.version} to load what is active.`
    );
  }

  // 2. Validate before touching the database
  const content = await readRelease(release);
  await validateAgainstSchema(pool, content);
  if (content.problems.length > 0) {
    throw new Error(`Release ${version} cannot be loaded:\n  - ${content.problems.join("\n  - ")}`);
  }
  if (content.formatVersion < 2) {
    log(`This is an older release (format ${content.formatVersion}): it holds active rows only, and no interview questions.`);
  }

  // 3. Refuse a database that already has content
  const before = await contentRowCounts(pool);
  const occupied = Object.entries(before).filter(([, n]) => n > 0);
  if (occupied.length > 0 && !options.replace) {
    throw new Error(
      `The database already has content (${occupied.map(([t, n]) => `${t}: ${n}`).join(", ")}). ` +
        `Nothing was changed. Pass --replace to delete that content and load ${version} instead.`
    );
  }

  // 4. Load, in one transaction
  const rowsLoaded: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (occupied.length > 0) {
      // Rows that point at content (Inspector runs, prompt version history) are kept: with
      // the checks off, deleting a scenario or prompt does not cascade to them.
      await client.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const spec of CONTENT_TABLES) await client.query(`DELETE FROM ${spec.table}`);
    }
    for (const spec of CONTENT_TABLES) {
      const rows = content.rows.get(spec.table) ?? [];
      await insertRows(client, spec, rows);
      rowsLoaded[spec.table] = rows.length;
    }

    // 5. Record the releases: every release on disk is listed, the loaded one is current
    await client.query("UPDATE reference_releases SET is_current = 0");
    const known = await listReleasesOnDisk();
    if (!known.some((r) => r.metadata.version === version)) known.push(release);
    for (const r of known) {
      const isCurrent = r.metadata.version === version ? 1 : 0;
      const existing = await client.query("SELECT version FROM reference_releases WHERE version = $1", [r.metadata.version]);
      if (existing.rows.length > 0) {
        await client.query(
          "UPDATE reference_releases SET published_by = $2, notes = $3, published_at = $4, is_current = $5 WHERE version = $1",
          [r.metadata.version, r.metadata.publishedBy, r.metadata.notes ?? null, new Date(r.metadata.publishedAt), isCurrent]
        );
      } else {
        await client.query(
          "INSERT INTO reference_releases (version, published_by, notes, published_at, is_current) VALUES ($1, $2, $3, $4, $5)",
          [r.metadata.version, r.metadata.publishedBy, r.metadata.notes ?? null, new Date(r.metadata.publishedAt), isCurrent]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // The connection goes back to the pool, so the session setting must not leak.
    await client.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    client.release();
  }
  for (const [table, n] of Object.entries(rowsLoaded)) log(`  ${table}: ${n} rows`);

  // 6. Make the files on disk agree: releases/<version>/ exists and releases/current is that version
  const versionDir = path.join(releasesRoot(), version);
  if (!(await exists(path.join(versionDir, "manifest.json")))) {
    await fs.cp(path.join(releasesRoot(), "current"), versionDir, { recursive: true });
    log(`Recreated releases/${version}/ from releases/current/`);
  }
  if (needsActivation) {
    await copyVersionToCurrent(version);
    log(`releases/current now holds ${version}`);
  }
  clearReferenceCache();

  // 7. Verify
  const verification = await verifyRelease(version);
  return { version, formatVersion: content.formatVersion, rowsLoaded, verification };
}

// ---------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------

export interface TableCheck {
  /** What was compared, e.g. "items (what the game loads)" or "items (all rows)". */
  name: string;
  ok: boolean;
  expected: number;
  actual: number;
  /** The first few differences, in words. */
  differences: string[];
}

export interface VerifyResult {
  ok: boolean;
  version: string | null;
  formatVersion: number | null;
  checks: TableCheck[];
  /** Problems that are not about one table (no current release, files missing, ...). */
  problems: string[];
}

const MAX_DIFFERENCES = 5;

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === "object") {
    const out: Row = {};
    for (const key of Object.keys(value as Row).sort()) out[key] = normalise((value as Row)[key]);
    return out;
  }
  return value === undefined ? null : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function show(value: unknown): string {
  const text = JSON.stringify(normalise(value));
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Compares two lists of rows by key and describes how they differ. */
function compareRows(
  name: string,
  keyField: string,
  expected: Row[],
  actual: Row[],
  prepare: (row: Row) => Row = (row) => row
): TableCheck {
  const differences: string[] = [];
  const note = (text: string) => {
    if (differences.length < MAX_DIFFERENCES) differences.push(text);
    else if (differences.length === MAX_DIFFERENCES) differences.push("(more differences not shown)");
  };
  const actualByKey = new Map(actual.map((row) => [String(row[keyField]), row]));
  const expectedKeys = new Set(expected.map((row) => String(row[keyField])));

  for (const row of expected) {
    const key = String(row[keyField]);
    const other = actualByKey.get(key);
    if (!other) {
      note(`'${key}' is in the release but not in the database`);
      continue;
    }
    const a = prepare(row);
    const b = prepare(other);
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!sameValue(a[field], b[field])) {
        note(`'${key}' ${field}: release has ${show(a[field])}, database has ${show(b[field])}`);
      }
    }
  }
  for (const key of actualByKey.keys()) {
    if (!expectedKeys.has(key)) note(`'${key}' is in the database but not in the release`);
  }
  return { name, ok: differences.length === 0, expected: expected.length, actual: actual.length, differences };
}

/** Workspace rows are compared as stored, except that equal decimals may be written differently. */
function prepareWorkspaceRow(spec: ContentTableSpec): (row: Row) => Row {
  return (row) => {
    const out: Row = { ...row };
    for (const column of spec.decimalColumns ?? []) {
      if (out[column] !== null && out[column] !== undefined) out[column] = Number(out[column]);
    }
    return out;
  };
}

/**
 * Checks that the database holds exactly what a release holds. Default: the release the
 * database says is current. Read-only.
 */
export async function verifyRelease(version?: string): Promise<VerifyResult> {
  const result: VerifyResult = { ok: false, version: null, formatVersion: null, checks: [], problems: [] };

  const dbCurrent = await storage.getCurrentReferenceRelease();
  const target = version ?? dbCurrent?.version;
  if (!target) {
    result.problems.push("The database has no current release. Run: npm run db:init");
    return result;
  }
  result.version = target;

  let release: ReleaseOnDisk;
  try {
    release = await resolveRelease(target);
  } catch (error: any) {
    result.problems.push(error.message);
    return result;
  }
  const dir = path.join(releasesRoot(), release.dirName);
  result.formatVersion = release.metadata.formatVersion ?? 1;

  if (dbCurrent?.version !== target) {
    result.problems.push(`The database's current release is ${dbCurrent?.version ?? "not set"}, not ${target}`);
  }
  try {
    clearReferenceCache();
    const loaded = await getCurrentReference();
    if (loaded.version !== target) {
      result.problems.push(`The game is loading release ${loaded.version} from releases/current, not ${target}`);
    }
  } catch (error: any) {
    result.problems.push(`releases/current cannot be loaded: ${error.message}`);
  }

  // What the database would publish now, against what the release published
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uranus-verify-"));
  try {
    const exported = await exportReferenceTables(tempDir, { quiet: true });
    for (const problem of exported.errors) result.problems.push(problem);

    for (const spec of CONTENT_TABLES) {
      if (!spec.runtimeFile) continue;
      const releaseFile = path.join(dir, spec.runtimeFile);
      if (!(await exists(releaseFile))) continue; // the release predates this table
      const expected = await readJson<unknown>(releaseFile);
      const actual = await readJson<unknown>(path.join(tempDir, spec.runtimeFile));
      const name = `${spec.table} (what the game loads)`;
      if (spec.table === "app_settings") {
        const toRows = (map: unknown) => Object.entries(map as Row).map(([key, value]) => ({ key, value }));
        result.checks.push(compareRows(name, "key", toRows(expected), toRows(actual)));
      } else {
        result.checks.push(compareRows(name, "id", expected as Row[], actual as Row[]));
      }
    }

    const defaultsFile = path.join(dir, "system_defaults.json");
    if (await exists(defaultsFile)) {
      const expected = await readJson<Row>(defaultsFile);
      const actual = await readJson<Row>(path.join(tempDir, "system_defaults.json"));
      result.checks.push(compareRows("default model, style and theme", "id", [{ id: "defaults", ...expected }], [{ id: "defaults", ...actual }]));
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  // Every row, active or not (format 2 releases only)
  if (release.metadata.workspace) {
    for (const spec of CONTENT_TABLES) {
      const info = release.metadata.workspace[spec.table];
      if (!info) continue;
      const expected = await readJson<Row[]>(path.join(dir, info.file));
      const actual = await storage.dumpContentTable(spec.table);
      result.checks.push(compareRows(`${spec.table} (all rows)`, spec.primaryKey, expected, actual, prepareWorkspaceRow(spec)));
    }
  }

  result.ok = result.problems.length === 0 && result.checks.every((c) => c.ok);
  return result;
}

/** A cheap check for the health endpoint: do the database and releases/current name the same release? */
export async function referenceSyncStatus(): Promise<{ version: string | null; dbVersion: string | null; inSync: boolean }> {
  let version: string | null = null;
  try {
    version = (await getCurrentReference()).version;
  } catch {
    version = null;
  }
  const dbVersion = (await storage.getCurrentReferenceRelease())?.version ?? null;
  return { version, dbVersion, inSync: version !== null && version === dbVersion };
}
