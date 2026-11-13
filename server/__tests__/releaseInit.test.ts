/**
 * Setting up an empty database from a published release, and proving the result.
 *
 * Runs against DATABASE_URL_TEST. The release files are a copy of the tracked release in a
 * temp folder (cwd is pointed there), so the real releases/ folder is never written to.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pool } from '../db';
import { CONTENT_TABLES } from '../reference/contentTables';
import { initFromRelease, referenceSyncStatus, resolveRelease, verifyRelease } from '../reference/importRelease';
import { clearReferenceCache } from '../reference/referenceLoader';
import { closeTestPool, setupTestSchema } from './setup/db';

const repoReleases = path.join(process.cwd(), 'releases');
let root: string;
let version: string;

async function emptyContent() {
  await pool.query('DELETE FROM pce_test_metrics');
  await pool.query('DELETE FROM pce_test_runs');
  await pool.query('DELETE FROM pce_template_versions');
  for (const spec of CONTENT_TABLES) await pool.query(`DELETE FROM ${spec.table}`);
  await pool.query('DELETE FROM reference_releases');
}

beforeAll(async () => {
  await setupTestSchema();
  version = JSON.parse(await fs.readFile(path.join(repoReleases, 'current', 'metadata.json'), 'utf8')).version;
});

beforeEach(async () => {
  await emptyContent();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'uranus-init-'));
  await fs.cp(path.join(repoReleases, 'current'), path.join(root, 'releases', 'current'), { recursive: true });
  await fs.cp(path.join(repoReleases, 'current'), path.join(root, 'releases', version), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  clearReferenceCache();
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearReferenceCache();
  await fs.rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await emptyContent();
  await closeTestPool();
});

describe('initFromRelease', () => {
  it('loads the newest published release into an empty database and verifies it', async () => {
    const result = await initFromRelease();

    expect(result.version).toBe(version);
    expect(result.formatVersion).toBe(2);
    expect(result.rowsLoaded.prompt_templates).toBeGreaterThan(0);
    expect(result.verification.problems).toEqual([]);
    expect(result.verification.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.verification.ok).toBe(true);

    // Every content table was compared in full, and the runtime tables as the game loads them
    const names = result.verification.checks.map((c) => c.name);
    for (const spec of CONTENT_TABLES) expect(names).toContain(`${spec.table} (all rows)`);
    expect(names).toContain('default model, style and theme');

    const current = (await pool.query('SELECT version FROM reference_releases WHERE is_current = 1')).rows;
    expect(current).toEqual([{ version }]);
    expect(await referenceSyncStatus()).toEqual({ version, dbVersion: version, inSync: true });
  });

  it('refuses a database that already has content, and changes nothing', async () => {
    await initFromRelease();
    await pool.query("UPDATE items SET name = 'edited locally' LIMIT 1");

    await expect(initFromRelease()).rejects.toThrow('already has content');

    const edited = (await pool.query("SELECT COUNT(*) AS n FROM items WHERE name = 'edited locally'")).rows[0].n;
    expect(edited).toBe(1);
  });

  it('replaces existing content when asked, keeping rows that point at it', async () => {
    await initFromRelease();
    const scenario = (await pool.query('SELECT id FROM pce_test_scenarios LIMIT 1')).rows[0].id;
    await pool.query(
      "INSERT INTO pce_test_runs (id, scenario_id, status, stage_results_json) VALUES ('run-kept', $1, 'success', '{}')",
      [scenario]
    );
    await pool.query("UPDATE items SET name = 'edited locally'");
    await pool.query("INSERT INTO app_settings (`key`, value) VALUES ('not_in_release', 'x')");

    const result = await initFromRelease({ replace: true });

    expect(result.verification.ok).toBe(true);
    expect((await pool.query("SELECT COUNT(*) AS n FROM app_settings WHERE `key` = 'not_in_release'")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT COUNT(*) AS n FROM pce_test_runs WHERE id = 'run-kept'")).rows[0].n).toBe(1);
    // Foreign key checks are back on for the pooled connections
    await expect(
      pool.query("INSERT INTO pce_test_runs (id, scenario_id, status, stage_results_json) VALUES ('run-bad', 'no-such-scenario', 'success', '{}')")
    ).rejects.toThrow();
  });

  it('loads nothing when a release file was changed after publishing', async () => {
    const file = path.join(root, 'releases', version, 'workspace', 'items.json');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('"active": 1', '"active": 0'));

    await expect(initFromRelease()).rejects.toThrow('does not match its checksum');

    expect((await pool.query('SELECT COUNT(*) AS n FROM items')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*) AS n FROM prompt_templates')).rows[0].n).toBe(0);
  });

  it('rolls everything back when a row cannot be inserted', async () => {
    // A row the checks accept but the database refuses: a second default theme.
    const dir = path.join(root, 'releases', version);
    const file = path.join(dir, 'workspace', 'mod_story_themes.json');
    const rows = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const row of rows) row.default = true;
    const text = JSON.stringify(rows, null, 2);
    await fs.writeFile(file, text);
    const metadataFile = path.join(dir, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    const { createHash } = await import('crypto');
    metadata.workspace.mod_story_themes.sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));

    await expect(initFromRelease()).rejects.toThrow('could not be inserted');

    for (const spec of CONTENT_TABLES) {
      expect((await pool.query(`SELECT COUNT(*) AS n FROM ${spec.table}`)).rows[0].n).toBe(0);
    }
    expect((await pool.query('SELECT COUNT(*) AS n FROM reference_releases')).rows[0].n).toBe(0);
  });

  it('will not switch the active release unless asked', async () => {
    const other = 'v0.0.1-other';
    await fs.cp(path.join(root, 'releases', version), path.join(root, 'releases', other), { recursive: true });
    const metadataFile = path.join(root, 'releases', other, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    await fs.writeFile(metadataFile, JSON.stringify({ ...metadata, version: other, publishedAt: '2099-01-01T00:00:00.000Z' }));

    // It is the newest, so it is the one picked...
    expect((await resolveRelease()).metadata.version).toBe(other);
    // ...but releases/current is still the old one
    await expect(initFromRelease()).rejects.toThrow('--activate');
    expect((await pool.query('SELECT COUNT(*) AS n FROM items')).rows[0].n).toBe(0);

    const result = await initFromRelease({ activate: true });
    expect(result.version).toBe(other);
    expect(result.verification.ok).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(root, 'releases', 'current', 'metadata.json'), 'utf8')).version).toBe(other);
    const listed = (await pool.query('SELECT version, is_current FROM reference_releases ORDER BY version')).rows;
    expect(listed).toEqual([
      { version: other, is_current: 1 },
      { version, is_current: 0 },
    ]);
  });

  it('loads an older release that has only the runtime files', async () => {
    // Make the release look like one published before the workspace existed
    for (const dirName of ['current', version]) {
      const dir = path.join(root, 'releases', dirName);
      await fs.rm(path.join(dir, 'workspace'), { recursive: true });
      const metadata = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
      delete metadata.formatVersion;
      delete metadata.workspace;
      await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
    }

    const result = await initFromRelease();

    expect(result.formatVersion).toBe(1);
    expect(result.verification.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.verification.ok).toBe(true);
    // The Inspector presets come from the seed file
    expect((await pool.query('SELECT COUNT(*) AS n FROM pce_test_scenarios WHERE is_preset = 1')).rows[0].n).toBe(4);
  });
});

describe('verifyRelease', () => {
  it('names what differs when the database has drifted from the release', async () => {
    await initFromRelease();
    const item = (await pool.query('SELECT id FROM items ORDER BY id LIMIT 1')).rows[0].id;
    await pool.query("UPDATE items SET name = 'Renamed in the database' WHERE id = $1", [item]);
    const prompt = (await pool.query('SELECT id FROM prompt_templates ORDER BY id LIMIT 1')).rows[0].id;
    await pool.query('DELETE FROM prompt_templates WHERE id = $1', [prompt]);
    await pool.query("INSERT INTO app_settings (`key`, value) VALUES ('added_later', '1')");

    const result = await verifyRelease();

    expect(result.ok).toBe(false);
    const failed = Object.fromEntries(result.checks.filter((c) => !c.ok).map((c) => [c.name, c.differences.join(' | ')]));
    expect(failed['items (all rows)']).toContain(`'${item}' name`);
    expect(failed['items (all rows)']).toContain('Renamed in the database');
    expect(failed['items (what the game loads)']).toContain(`'${item}' name`);
    expect(failed['prompt_templates (all rows)']).toContain(`'${prompt}' is in the release but not in the database`);
    expect(failed['app_settings (all rows)']).toContain("'added_later' is in the database but not in the release");
  });

  it('reports a database that has no current release', async () => {
    const result = await verifyRelease();
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('no current release');
    expect((await referenceSyncStatus()).inSync).toBe(false);
  });
});
