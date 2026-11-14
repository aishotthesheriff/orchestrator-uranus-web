import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { runMigrations } from '../db/migrate';
import { closeTestPool, setupTestSchema } from './setup/db';

describe('schema migrations', () => {
  const releaseVersions = [`migration-old-${randomUUID()}`, `migration-new-${randomUUID()}`];

  beforeAll(async () => {
    await setupTestSchema();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM reference_releases WHERE version IN ($1, $2)', releaseVersions);
    await runMigrations(pool);
    await closeTestPool();
  });

  it('cleans up duplicate current releases and serializes concurrent migration runs', async () => {
    await pool.query('DELETE FROM reference_releases');
    await pool.query(
      'ALTER TABLE reference_releases DROP INDEX uq_reference_releases_current_slot, DROP COLUMN current_release_slot',
    );
    await pool.query(
      "DELETE FROM schema_migrations WHERE version = '003_reference_current_unique.sql'",
    );
    await pool.query(
      `INSERT INTO reference_releases (version, published_by, published_at, is_current)
       VALUES ($1, 'test', '2020-01-01 00:00:00', 1), ($2, 'test', '2021-01-01 00:00:00', 1)`,
      releaseVersions,
    );

    const results = await Promise.allSettled([
      runMigrations(pool),
      runMigrations(pool),
    ]);

    expect(results.filter(result => result.status === 'rejected')).toEqual([]);
    expect((await pool.query(
      'SELECT version FROM reference_releases WHERE is_current = 1',
    )).rows).toEqual([{ version: releaseVersions[1] }]);
    expect((await pool.query(
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '003_reference_current_unique.sql'",
    )).rows[0].count).toBe(1);
  });
});
