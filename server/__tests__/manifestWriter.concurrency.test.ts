import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import {
  createProvisionalManifest,
  updateApplySection,
  updateRequestSection,
} from '../orchestrator/manifest/writer';
import { cleanupTestTables, closeTestPool } from './setup/db';

describe('manifest writer concurrency', () => {
  beforeEach(async () => {
    await cleanupTestTables();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('preserves independently updated manifest sections', async () => {
    const queueEntryId = randomUUID();
    await pool.query(
      `INSERT INTO queue_entries (id, queue, payload_table, payload_id)
       VALUES ($1, 'turn-precompute', 'turn_jobs', $2)`,
      [queueEntryId, randomUUID()],
    );
    const manifestId = await createProvisionalManifest(
      randomUUID(),
      1,
      queueEntryId,
      1,
      randomUUID(),
    );

    await Promise.all([
      updateRequestSection(manifestId, { sourceStateDigest: 'state-digest' }),
      updateApplySection(manifestId, {
        startedAt: new Date().toISOString(),
        errors: [],
      }),
    ]);

    const result = await pool.query(
      'SELECT manifest FROM turn_execution_manifests WHERE id = $1',
      [manifestId],
    );
    const manifest = typeof result.rows[0].manifest === 'string'
      ? JSON.parse(result.rows[0].manifest)
      : result.rows[0].manifest;

    expect(manifest.request.sourceStateDigest).toBe('state-digest');
    expect(manifest.apply.errors).toEqual([]);
  });
});
