/**
 * Checks the statements that had to be rewritten for MariaDB, against a real database:
 * value types, the UPDATE ... RETURNING replacement, job claiming, the queue, and the
 * JSON merges. Uses DATABASE_URL_TEST only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../db';
import { isMissingTable, isUniqueViolation, missingTableName } from '../db/errors';
import { MariaDbOrchestrator } from '../orchestrator/mariaDbOrchestrator';
import { getQueueConfig } from '../config/queues';
import { cleanupTestTables, closeTestPool, getTestStorage } from './setup/db';

const storage = getTestStorage();
const orchestrator = new MariaDbOrchestrator();

async function clearContentRows() {
  await pool.query("DELETE FROM app_settings WHERE `key` LIKE 'porttest_%'");
  await pool.query("DELETE FROM llm_models WHERE model_key LIKE 'porttest-%'");
}

beforeEach(async () => {
  await cleanupTestTables();
  await clearContentRows();
});

afterAll(async () => {
  await clearContentRows();
  await closeTestPool();
});

async function insertTurnJob(createdAt = new Date()): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO turn_jobs (id, game_id, action_payload, status, created_at) VALUES ($1, $2, $3, 'pending', $4)",
    [id, randomUUID(), JSON.stringify({ action: 'wait' }), createdAt]
  );
  return id;
}

describe('value types', () => {
  it('returns JSON parsed, booleans as booleans, dates as UTC Dates, binary as Buffers', async () => {
    const turnJobId = await insertTurnJob(new Date('2026-11-13T10:20:30.123Z'));
    const entryId = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: turnJobId }, traceId: 't', metadata: { nested: { ok: true } } });
    const manifestId = randomUUID();
    await pool.query(
      `INSERT INTO turn_execution_manifests (id, game_id, turn_number, queue_entry_id, attempt, manifest, manifest_hash, precompute_hash)
       VALUES ($1, $2, 1, $3, 1, $4, $5, $6)`,
      [manifestId, randomUUID(), entryId, JSON.stringify({ request: { a: 1 } }), Buffer.alloc(32, 7), Buffer.from([])]
    );

    const job = (await pool.query('SELECT * FROM turn_jobs WHERE id = $1', [turnJobId])).rows[0];
    expect(job.action_payload).toEqual({ action: 'wait' });
    expect(job.created_at).toBeInstanceOf(Date);
    expect(job.created_at.toISOString()).toBe('2026-11-13T10:20:30.123Z');
    expect(job.completed_at).toBeNull();

    const entry = (await pool.query('SELECT * FROM queue_entries WHERE id = $1', [entryId])).rows[0];
    expect(entry.metadata).toEqual({ nested: { ok: true } });
    expect(entry.attempts).toBe(0);

    const manifest = (await pool.query('SELECT * FROM turn_execution_manifests WHERE id = $1', [manifestId])).rows[0];
    expect(manifest.manifest).toEqual({ request: { a: 1 } });
    expect(Buffer.isBuffer(manifest.manifest_hash)).toBe(true);
    expect(manifest.manifest_hash.length).toBe(32);
    expect(manifest.precompute_hash.length).toBe(0);

    const count = (await pool.query('SELECT COUNT(*) AS n FROM turn_jobs')).rows[0].n;
    expect(count).toBe(1);

    const user = await storage.ensureUser('TypeCheck');
    const row = (await pool.query('SELECT typewriter_enabled, skip_image_cache FROM users WHERE id = $1', [user.id])).rows[0];
    expect(row.typewriter_enabled).toBe(true);
    expect(row.skip_image_cache).toBe(true);
  });

  it('sets one key of a JSON document in place, as an object', async () => {
    const entryId = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 't' });
    const manifestId = randomUUID();
    await pool.query(
      `INSERT INTO turn_execution_manifests (id, game_id, turn_number, queue_entry_id, attempt, manifest, manifest_hash, precompute_hash)
       VALUES ($1, $2, 1, $3, 1, $4, $5, $5)`,
      [manifestId, randomUUID(), entryId, JSON.stringify({ request: { text: 'it\'s "quoted" 🚀' }, apply: null }), Buffer.alloc(32)]
    );
    // The statement server/evals/liveSampler.ts runs
    await pool.query(
      `UPDATE turn_execution_manifests
          SET manifest = JSON_SET(manifest, '$.evals', JSON_QUERY($2, '$')), updated_at = NOW(3)
        WHERE id = $1`,
      [manifestId, JSON.stringify({ scores: [{ key: 'narration', score: 0.5 }] })]
    );
    const manifest = (await pool.query('SELECT manifest FROM turn_execution_manifests WHERE id = $1', [manifestId])).rows[0].manifest;
    expect(manifest).toEqual({
      request: { text: 'it\'s "quoted" 🚀' },
      apply: null,
      evals: { scores: [{ key: 'narration', score: 0.5 }] },
    });
  });
});

describe('users', () => {
  it('treats usernames as case-sensitive and returns the existing user on a duplicate', async () => {
    const upper = await storage.ensureUser('Joey');
    const lower = await storage.ensureUser('joey');
    const again = await storage.ensureUser('Joey');
    expect(lower.id).not.toBe(upper.id);
    expect(again.id).toBe(upper.id);
    expect((await storage.getUserByUsername('JOEY'))).toBeUndefined();
  });

  it('reports a duplicate key and a missing table in the terms the app checks for', async () => {
    await storage.ensureUser('dup');
    const duplicate = await pool
      .query("INSERT INTO users (id, username, password) VALUES ($1, 'dup', 'x')", [randomUUID()])
      .catch((error) => error);
    expect(isUniqueViolation(duplicate)).toBe(true);

    const missing = await pool.query('SELECT * FROM no_such_table_here').catch((error) => error);
    expect(isMissingTable(missing)).toBe(true);
    expect(missingTableName(missing)).toBe('no_such_table_here');
  });

  it('refuses a username longer than the column, instead of cutting it short', async () => {
    await expect(storage.ensureUser('x'.repeat(65))).rejects.toThrow();
  });
});

describe('UPDATE ... RETURNING replacement', () => {
  it('returns the updated row for settings (insert, then update)', async () => {
    const created = await storage.upsertSetting('porttest_rate', '0.1', 'first');
    expect(created).toMatchObject({ key: 'porttest_rate', value: '0.1', description: 'first', active: 1 });

    const updated = await storage.upsertSetting('porttest_rate', '0.5');
    expect(updated).toMatchObject({ key: 'porttest_rate', value: '0.5', description: 'first' });
    expect(updated.updated_at).toBeInstanceOf(Date);
    expect((await storage.getSetting('porttest_rate'))?.value).toBe('0.5');
  });

  it('returns nothing when the key matches no row', async () => {
    const result = await pool.query("UPDATE app_settings SET value = $1 WHERE `key` = $2 RETURNING *", ['x', 'porttest_absent']);
    expect(result.rows).toEqual([]);
  });

  it('works inside a transaction and sees that transaction\'s own change', async () => {
    await storage.upsertSetting('porttest_tx', 'before');
    await expect(
      withTransaction(async (client) => {
        const result = await client.query("UPDATE app_settings SET value = $1 WHERE `key` = $2 RETURNING *", ['inside', 'porttest_tx']);
        expect(result.rows[0].value).toBe('inside');
        throw new Error('roll back');
      })
    ).rejects.toThrow('roll back');
    expect((await storage.getSetting('porttest_tx'))?.value).toBe('before');
  });
});

describe('story model catalog', () => {
  it('creates, updates and keeps a single default', async () => {
    const a = await storage.upsertLlmModel({ modelKey: 'porttest-a', modelName: 'model-a', isDefault: true, priceInput: 0.15, params: { temperature: 0.7 } });
    expect(a).toMatchObject({ modelKey: 'porttest-a', isDefault: true, priceInput: 0.15, params: { temperature: 0.7 }, adult: false, supportsJsonMode: true });

    const b = await storage.upsertLlmModel({ modelKey: 'porttest-b', modelName: 'model-b', isDefault: true });
    expect(b.isDefault).toBe(true);
    expect((await storage.getLlmModelByKey('porttest-a'))?.isDefault).toBe(false);

    const renamed = await storage.upsertLlmModel({ modelKey: 'porttest-a', displayName: 'Model A' });
    expect(renamed.displayName).toBe('Model A');
    expect(renamed.modelName).toBe('model-a');
  });

  it('merges check results over the stored summary without losing earlier keys', async () => {
    await storage.upsertLlmModel({ modelKey: 'porttest-c', modelName: 'model-c' });
    await storage.recordLlmModelCheck('porttest-c', true, { latencyMs: 120 });
    await storage.recordLlmModelCheck('porttest-c', null, { qualification: { passed: 3 } });

    const model = await storage.getLlmModelByKey('porttest-c');
    expect(model?.lastCheckOk).toBe(true);
    expect(model?.lastCheckSummary).toEqual({ latencyMs: 120, qualification: { passed: 3 } });
    expect(typeof model?.lastCheckAt).toBe('string');

    await storage.recordLlmModelCheck('porttest-c', false, { latencyMs: 900 });
    const failed = await storage.getLlmModelByKey('porttest-c');
    expect(failed?.lastCheckOk).toBe(false);
    expect(failed?.lastCheckSummary).toEqual({ latencyMs: 900, qualification: { passed: 3 } });
  });
});

describe('claiming pending jobs', () => {
  it('never hands the same job to two claimers', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) ids.add(await insertTurnJob(new Date(Date.now() - (40 - i) * 10)));

    const claims = await Promise.all(Array.from({ length: 8 }, () => storage.claimPendingTurnJobs(10)));
    const claimed = claims.flat().map((job) => job.id);

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.every((id) => ids.has(id))).toBe(true);
    const left = (await pool.query("SELECT COUNT(*) AS n FROM turn_jobs WHERE status = 'pending'")).rows[0].n;
    expect(claimed.length + left).toBe(40);
    expect(claims.flat().every((job) => job.status === 'processing')).toBe(true);
  });
});

describe('orchestrator queue', () => {
  it('claims in priority then age order, and completes', async () => {
    const low = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'a' });
    const high = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'b', priority: 5 });

    const leases = await orchestrator.claim('turn-precompute', 'worker-1', { batchSize: 5 });
    expect(leases.map((l) => l.job.id)).toEqual([high, low]);
    expect(leases[0].job.payload.action_payload).toEqual({ action: 'wait' });
    expect(await orchestrator.claim('turn-precompute', 'worker-2')).toEqual([]);

    await leases[0].extend(60000);
    await leases[0].complete({ ok: true });
    const entry = (await pool.query('SELECT status, lease_id FROM queue_entries WHERE id = $1', [high])).rows[0];
    expect(entry).toEqual({ status: 'completed', lease_id: null });
    const lease = (await pool.query('SELECT outcome, outcome_details FROM queue_leases WHERE lease_id = $1', [leases[0].leaseId])).rows[0];
    expect(lease).toEqual({ outcome: 'completed', outcome_details: { ok: true } });

    const metrics = await orchestrator.getQueueMetrics('turn-precompute');
    expect(metrics).toMatchObject({ pending: 0, inProgress: 1, delayed: 0, deadLetter: 0 });
  });

  it('never leases one entry to two concurrent workers', async () => {
    for (let i = 0; i < 30; i++) {
      await orchestrator.enqueue({ queue: 'image', payload: { id: await insertTurnJob() }, traceId: `t${i}` }).catch(() => {});
    }
    // The image queue reads image_jobs; these entries point at turn_jobs ids, so use the turn queue instead
    await pool.query("UPDATE queue_entries SET queue = 'turn-apply', payload_table = 'turn_jobs'");

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => orchestrator.claim('turn-apply', `worker-${i}`, { batchSize: 6 }))
    );
    const entryIds = claims.flat().map((lease) => lease.job.id);
    expect(new Set(entryIds).size).toBe(entryIds.length);
    const leased = (await pool.query("SELECT COUNT(*) AS n FROM queue_entries WHERE status = 'leased'")).rows[0].n;
    expect(leased).toBe(entryIds.length);
    const leaseRows = (await pool.query('SELECT COUNT(*) AS n FROM queue_leases')).rows[0].n;
    expect(leaseRows).toBe(entryIds.length);
  });

  it('retries a transient failure with a delay, then dead-letters at the attempt limit', async () => {
    const entryId = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'f' });
    const maxAttempts = getQueueConfig('turn-precompute').maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await pool.query('UPDATE queue_entries SET run_at = NOW(3) WHERE id = $1', [entryId]);
      const [lease] = await orchestrator.claim('turn-precompute', 'worker-1');
      await lease.fail({ reason: 'transient', message: `boom ${attempt}` });
      const entry = (await pool.query('SELECT status, attempts, last_error, run_at FROM queue_entries WHERE id = $1', [entryId])).rows[0];
      expect(entry.attempts).toBe(attempt);
      expect(entry.last_error.message).toBe(`boom ${attempt}`);
      if (attempt < maxAttempts) {
        expect(entry.status).toBe('pending');
        expect(entry.run_at.getTime()).toBeGreaterThan(Date.now());
      } else {
        expect(entry.status).toBe('dead_letter');
      }
    }
    expect((await orchestrator.getQueueMetrics('turn-precompute')).deadLetter).toBe(1);
  });

  it('returns an expired lease to the queue and counts the attempt', async () => {
    const entryId = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 's' });
    const [lease] = await orchestrator.claim('turn-precompute', 'worker-1');

    expect(await orchestrator.markStuck({ queue: 'turn-precompute', olderThan: new Date() })).toEqual([]);
    const stuck = await orchestrator.markStuck({ queue: 'turn-precompute', olderThan: new Date(lease.leaseExpiresAt.getTime() + 1000) });
    expect(stuck).toEqual([entryId]);

    const entry = (await pool.query('SELECT status, attempts FROM queue_entries WHERE id = $1', [entryId])).rows[0];
    expect(entry).toEqual({ status: 'pending', attempts: 1 });
    const outcome = (await pool.query('SELECT outcome FROM queue_leases WHERE lease_id = $1', [lease.leaseId])).rows[0].outcome;
    expect(outcome).toBe('expired');
  });

  it('dead-letters an entry whose payload row is gone, and still claims the rest', async () => {
    const orphan = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: randomUUID() }, traceId: 'o', priority: 9 });
    const good = await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'g' });

    const leases = await orchestrator.claim('turn-precompute', 'worker-1');
    expect(leases.map((l) => l.job.id)).toEqual([good]);
    const entry = (await pool.query('SELECT status, last_error FROM queue_entries WHERE id = $1', [orphan])).rows[0];
    expect(entry.status).toBe('dead_letter');
    expect(entry.last_error.message).toContain('not found');
  });

  it('refuses a second entry with the same idempotency key, and allows entries without one', async () => {
    const first = { queue: 'turn-precompute' as const, payload: { id: await insertTurnJob() }, traceId: 'i', idempotencyKey: 'same-key' };
    await orchestrator.enqueue(first);
    const duplicate = await orchestrator.enqueue({ ...first, payload: { id: await insertTurnJob() } }).catch((error) => error);
    expect(isUniqueViolation(duplicate)).toBe(true);

    await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'n1' });
    await orchestrator.enqueue({ queue: 'turn-precompute', payload: { id: await insertTurnJob() }, traceId: 'n2' });
    expect((await pool.query('SELECT COUNT(*) AS n FROM queue_entries')).rows[0].n).toBe(3);
  });
});
