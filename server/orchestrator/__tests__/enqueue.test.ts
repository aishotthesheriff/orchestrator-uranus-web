/**
 * Unit tests for orchestrator enqueue functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresOrchestrator } from '../postgresOrchestrator';
import { getTestPool, cleanupTestTables } from '../../__tests__/setup/db';
import { randomUUID } from 'crypto';

const pool = getTestPool();

describe('PostgresOrchestrator.enqueue', () => {
  let orchestrator: PostgresOrchestrator;

  beforeEach(async () => {
    await cleanupTestTables();
    // Use test pool for orchestrator
    orchestrator = new PostgresOrchestrator(pool);
  });

  afterEach(async () => {
    // Clean up test data - cast UUID to text for LIKE comparison
    await pool.query('DELETE FROM queue_entries WHERE id::text LIKE $1', ['test-%']);
  });

  it('should enqueue a job successfully', async () => {
    const jobId = await orchestrator.enqueue({
      queue: 'turn-precompute',
      payload: { id: randomUUID(), gameId: 'test-game', actionPayload: {} },
      idempotencyKey: 'test-key-1',
      traceId: 'test-trace-1',
    });

    expect(jobId).toBeTruthy();

    // Verify job was inserted
    const result = await pool.query('SELECT * FROM queue_entries WHERE id = $1', [jobId]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].queue).toBe('turn-precompute');
    expect(result.rows[0].status).toBe('pending');
    expect(result.rows[0].idempotency_key).toBe('test-key-1');
    expect(result.rows[0].trace_id).toBe('test-trace-1');
  });

  it('should handle duplicate idempotency keys (database constraint)', async () => {
    const idempotencyKey = 'test-duplicate-key';
    
    // First enqueue should succeed
    const jobId1 = await orchestrator.enqueue({
      queue: 'turn-precompute',
      payload: { id: randomUUID() },
      idempotencyKey,
    });

    expect(jobId1).toBeTruthy();

    // Second enqueue with same idempotency key should fail (unique constraint)
    await expect(
      orchestrator.enqueue({
        queue: 'turn-precompute',
        payload: { id: randomUUID() },
        idempotencyKey,
      })
    ).rejects.toThrow();
  });

  it('should set default priority to 0', async () => {
    const jobId = await orchestrator.enqueue({
      queue: 'image',
      payload: { id: randomUUID() },
    });

    const result = await pool.query('SELECT priority FROM queue_entries WHERE id = $1', [jobId]);
    expect(result.rows[0].priority).toBe(0);
  });

  it('should respect custom priority', async () => {
    const jobId = await orchestrator.enqueue({
      queue: 'turn-apply',
      payload: { id: randomUUID() },
      priority: 10,
    });

    const result = await pool.query('SELECT priority FROM queue_entries WHERE id = $1', [jobId]);
    expect(result.rows[0].priority).toBe(10);
  });

  it('should set run_at to future date when provided', async () => {
    const futureDate = new Date(Date.now() + 60000); // 1 minute from now
    const jobId = await orchestrator.enqueue({
      queue: 'turn-precompute',
      payload: { id: randomUUID() },
      runAt: futureDate,
    });

    const result = await pool.query('SELECT run_at FROM queue_entries WHERE id = $1', [jobId]);
    expect(new Date(result.rows[0].run_at).getTime()).toBeGreaterThanOrEqual(futureDate.getTime() - 1000);
  });
});
