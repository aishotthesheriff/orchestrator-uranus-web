/**
 * MariaDB-backed Job Orchestrator implementation
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.8
 *
 * Workers find work by polling (see config/queues.ts); there is no push notification.
 * Every state change runs in a short transaction that is retried if InnoDB reports a
 * deadlock or a lock wait timeout.
 */

import { pool as defaultPool, withTransaction, type DbPool, type Queryable } from '../db';
import { randomUUID } from 'crypto';
import { getQueueConfig } from '../config/queues';
import {
  queueCompletedTotal,
  queueFailedTotal,
  queueDeadLetterTotal,
  queueAttemptsHistogram,
  queueLatencyHistogram,
} from '../metrics';
import { QUEUE_TRACE_KEY, traceHeaders } from '../observability/langsmith';
import type {
  JobOrchestrator,
  EnqueueOptions,
  JobLease,
  QueueName,
  QueueMetrics,
  JobFailure
} from './types';

/** The tables a queue entry's payload can live in. The name is interpolated into SQL, so it is checked against this list. */
const PAYLOAD_TABLES = new Set(['turn_jobs', 'image_jobs']);

class JobLeaseImpl<TPayload> implements JobLease<TPayload> {
  constructor(
    public job: JobLease<TPayload>['job'],
    public leaseId: string,
    public leaseExpiresAt: Date,
    private orchestrator: MariaDbOrchestrator
  ) {}

  async extend(ms: number): Promise<void> {
    await this.orchestrator.heartbeat(this.leaseId, ms);
    this.leaseExpiresAt = new Date(Date.now() + ms);
  }

  async complete(result?: Record<string, unknown>): Promise<void> {
    await this.orchestrator.complete(this.leaseId, result);
  }

  async fail(error: JobFailure, opts?: { retryDelayMs?: number }): Promise<void> {
    await this.orchestrator.fail(this.leaseId, error, opts);
  }

  async release(): Promise<void> {
    await this.orchestrator.release(this.leaseId);
  }
}

export class MariaDbOrchestrator implements JobOrchestrator {
  private pool: DbPool;

  constructor(pool?: DbPool) {
    // Use provided pool or default to the main pool from db.ts
    this.pool = pool || defaultPool;
  }

  /**
   * Enqueue a job into the orchestrator
   * Inserts into queue_entries using the caller's transaction when one is supplied.
   */
  async enqueue(opts: EnqueueOptions, client?: Queryable): Promise<string> {
    const queueEntryId = randomUUID();
    const payload = opts.payload as { id?: string };

    // Determine payload table name from queue
    let payloadTable: string;
    let payloadId: string;

    if (opts.queue === 'turn-precompute' || opts.queue === 'turn-apply') {
      payloadTable = 'turn_jobs';
      // Extract payload ID from payload object
      payloadId = payload.id || randomUUID();
    } else if (opts.queue === 'image') {
      payloadTable = 'image_jobs';
      payloadId = payload.id || randomUUID();
    } else {
      throw new Error(`Unknown queue: ${opts.queue}`);
    }

    // A job enqueued from inside a traced run carries that trace's headers, so the worker
    // that claims it continues the same trace (see server/observability/langsmith.ts).
    const headers = traceHeaders();
    const metadata = headers ? { ...(opts.metadata || {}), [QUEUE_TRACE_KEY]: headers } : opts.metadata || {};

    // Insert into queue_entries. A second entry with the same (queue, idempotency_key) is
    // refused by the unique index and surfaces as an error to the caller.
    await (client ?? this.pool).query(
      `INSERT INTO queue_entries (
        id, queue, payload_table, payload_id, status, attempts, priority,
        run_at, trace_id, request_id, metadata, idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW(3)), $9, $10, $11, $12, NOW(3), NOW(3))`,
      [
        queueEntryId,
        opts.queue,
        payloadTable,
        payloadId,
        'pending',
        0,
        opts.priority ?? 0,
        // "Now" is taken from the database clock, the same clock claim() compares against,
        // so a job is claimable at once even if this host's clock runs slightly ahead.
        opts.runAt ?? null,
        opts.traceId || null,
        opts.requestId || null,
        JSON.stringify(metadata),
        opts.idempotencyKey || null,
      ]
    );

    return queueEntryId;
  }

  /**
   * Claim jobs from a queue
   * Uses FOR UPDATE SKIP LOCKED so concurrent workers never claim the same entry
   */
  async claim(queue: QueueName, workerId: string, opts?: { batchSize?: number }): Promise<JobLease<any>[]> {
    const batchSize = opts?.batchSize ?? 5;
    const config = getQueueConfig(queue);

    return withTransaction(async (client) => {
      // Claim jobs, ordered by priority DESC, run_at ASC, created_at ASC
      const claimResult = await client.query(
        `SELECT * FROM queue_entries
         WHERE queue = $1 AND status = 'pending' AND run_at <= NOW(3)
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [queue, batchSize]
      );

      const leases: JobLease<any>[] = [];
      const leaseExpiresAt = new Date(Date.now() + config.leaseDurationMs);

      for (const row of claimResult.rows) {
        const entryId = row.id;

        // Load the payload. The entry row is locked by this transaction, which is what
        // makes the claim exclusive; the payload row needs no lock of its own.
        const payloadRow = PAYLOAD_TABLES.has(row.payload_table)
          ? (await client.query(`SELECT * FROM ${row.payload_table} WHERE id = $1`, [row.payload_id])).rows[0]
          : undefined;

        if (!payloadRow) {
          // Nothing to run: the entry can never succeed, so it goes to the dead letter
          // queue instead of being claimed again on every poll.
          console.warn(`[Orchestrator] Payload not found for ${row.payload_table}:${row.payload_id}; moving entry ${entryId} to dead letter`);
          await client.query(
            `UPDATE queue_entries
             SET status = 'dead_letter', last_error = $1, updated_at = NOW(3)
             WHERE id = $2`,
            [JSON.stringify({ reason: 'permanent', message: `Payload ${row.payload_table}:${row.payload_id} not found` }), entryId]
          );
          queueDeadLetterTotal.inc({ queue });
          continue;
        }

        const leaseId = randomUUID();

        // Create lease record
        await client.query(
          `INSERT INTO queue_leases (lease_id, entry_id, worker_id, heartbeat_expires_at, created_at)
           VALUES ($1, $2, $3, $4, NOW(3))`,
          [leaseId, entryId, workerId, leaseExpiresAt]
        );

        // Update queue entry to leased status
        await client.query(
          `UPDATE queue_entries
           SET status = 'leased', lease_id = $1, lease_owner = $2, lease_expires_at = $3, updated_at = NOW(3)
           WHERE id = $4`,
          [leaseId, workerId, leaseExpiresAt, entryId]
        );

        const job: JobLease<any>['job'] = {
          id: entryId,
          queue: row.queue as QueueName,
          payload: payloadRow,
          attempts: row.attempts,
          traceId: row.trace_id || '',
          requestId: row.request_id || undefined,
          metadata: row.metadata || {},
          priority: row.priority,
          runAt: new Date(row.run_at),
        };

        leases.push(new JobLeaseImpl(job, leaseId, leaseExpiresAt, this));
      }

      return leases;
    });
  }

  /**
   * Extend/heartbeat a lease
   */
  async heartbeat(leaseId: string, extensionMs: number): Promise<void> {
    await withTransaction(async (client) => {
      // Check lease exists and is not expired
      const leaseResult = await client.query(
        `SELECT ql.lease_id
         FROM queue_leases ql
         JOIN queue_entries qe ON ql.entry_id = qe.id
         WHERE ql.lease_id = $1 AND ql.heartbeat_expires_at > NOW(3)`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        throw new Error(`Lease ${leaseId} not found or expired`);
      }

      const newExpiresAt = new Date(Date.now() + extensionMs);

      // Update lease heartbeat
      await client.query(
        `UPDATE queue_leases
         SET heartbeat_expires_at = $1, renewed_at = NOW(3)
         WHERE lease_id = $2`,
        [newExpiresAt, leaseId]
      );

      // Update queue entry lease expiration
      await client.query(
        `UPDATE queue_entries
         SET lease_expires_at = $1, updated_at = NOW(3)
         WHERE lease_id = $2`,
        [newExpiresAt, leaseId]
      );
    });
  }

  /**
   * Complete a job
   */
  async complete(leaseId: string, result?: Record<string, unknown>): Promise<void> {
    const done = await withTransaction(async (client) => {
      // Get lease info
      const leaseResult = await client.query(
        `SELECT entry_id FROM queue_leases WHERE lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        throw new Error(`Lease ${leaseId} not found`);
      }

      const entryId = leaseResult.rows[0].entry_id;

      // Get queue name for metrics
      const queueResult = await client.query('SELECT queue, created_at, attempts FROM queue_entries WHERE id = $1', [entryId]);

      // Update queue entry to completed
      await client.query(
        `UPDATE queue_entries
         SET status = 'completed', lease_id = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW(3)
         WHERE id = $1`,
        [entryId]
      );

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'completed', outcome_details = $1, released_at = NOW(3)
         WHERE lease_id = $2`,
        [JSON.stringify(result || {}), leaseId]
      );

      return {
        queue: queueResult.rows[0]?.queue as QueueName,
        createdAt: queueResult.rows[0]?.created_at as Date | undefined,
        attempts: (queueResult.rows[0]?.attempts as number) || 0,
      };
    });

    // Emit metrics once, after the commit (the transaction may have been retried)
    queueCompletedTotal.inc({ queue: done.queue });
    queueAttemptsHistogram.observe({ queue: done.queue }, done.attempts);
    if (done.createdAt) {
      queueLatencyHistogram.observe({ queue: done.queue }, Date.now() - new Date(done.createdAt).getTime());
    }
  }

  /**
   * Fail a job
   */
  async fail(leaseId: string, error: JobFailure, opts?: { retryDelayMs?: number }): Promise<void> {
    const outcome = await withTransaction(async (client) => {
      // Get lease and entry info
      const leaseResult = await client.query(
        `SELECT ql.entry_id, qe.attempts, qe.queue
         FROM queue_leases ql
         JOIN queue_entries qe ON ql.entry_id = qe.id
         WHERE ql.lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        throw new Error(`Lease ${leaseId} not found`);
      }

      const { entry_id: entryId, attempts, queue } = leaseResult.rows[0];
      const config = getQueueConfig(queue as QueueName);
      const newAttempts = attempts + 1;
      const errorJson = JSON.stringify({ reason: error.reason, message: error.message, details: error.details });

      // Determine if we should retry or move to dead letter
      const shouldRetry = error.reason === 'transient' && newAttempts < config.maxAttempts;

      if (shouldRetry) {
        // Calculate exponential backoff
        const backoffMs = Math.min(5000 * Math.pow(2, newAttempts - 1), 120000); // min(5s * 2^(attempts-1), 120s)
        const runAt = new Date(Date.now() + (opts?.retryDelayMs || backoffMs));

        // Update queue entry to pending with backoff
        await client.query(
          `UPDATE queue_entries
           SET status = 'pending', attempts = $1, run_at = $2, lease_id = NULL, lease_owner = NULL,
               lease_expires_at = NULL, last_error = $3, updated_at = NOW(3)
           WHERE id = $4`,
          [newAttempts, runAt, errorJson, entryId]
        );
      } else {
        // Move to dead letter
        await client.query(
          `UPDATE queue_entries
           SET status = 'dead_letter', attempts = $1, lease_id = NULL, lease_owner = NULL,
               lease_expires_at = NULL, last_error = $2, updated_at = NOW(3)
           WHERE id = $3`,
          [newAttempts, errorJson, entryId]
        );
      }

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'failed', outcome_details = $1, released_at = NOW(3)
         WHERE lease_id = $2`,
        [errorJson, leaseId]
      );

      return { queue: queue as QueueName, deadLettered: !shouldRetry };
    });

    // Emit metrics once, after the commit
    queueFailedTotal.inc({ queue: outcome.queue });
    if (outcome.deadLettered) queueDeadLetterTotal.inc({ queue: outcome.queue });
  }

  /**
   * Release a lease (return to pending without counting attempt)
   */
  async release(leaseId: string): Promise<void> {
    await withTransaction(async (client) => {
      // Get entry ID
      const leaseResult = await client.query(
        `SELECT entry_id FROM queue_leases WHERE lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        throw new Error(`Lease ${leaseId} not found`);
      }

      const entryId = leaseResult.rows[0].entry_id;

      // Update queue entry back to pending
      await client.query(
        `UPDATE queue_entries
         SET status = 'pending', lease_id = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW(3)
         WHERE id = $1`,
        [entryId]
      );

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'released', released_at = NOW(3)
         WHERE lease_id = $1`,
        [leaseId]
      );
    });
  }

  /**
   * Mark stuck jobs (jobs with expired leases)
   */
  async markStuck(opts: { queue: QueueName; olderThan: Date }): Promise<string[]> {
    return withTransaction(async (client) => {
      // Find stuck jobs (leased but expired)
      const stuckResult = await client.query(
        `SELECT id FROM queue_entries
         WHERE queue = $1 AND status = 'leased' AND lease_expires_at < $2
         FOR UPDATE SKIP LOCKED`,
        [opts.queue, opts.olderThan]
      );

      const stuckJobIds: string[] = [];

      for (const row of stuckResult.rows) {
        const entryId = row.id;

        // Increment attempts and move back to pending
        await client.query(
          `UPDATE queue_entries
           SET status = 'pending', attempts = attempts + 1, lease_id = NULL, lease_owner = NULL,
               lease_expires_at = NULL, updated_at = NOW(3)
           WHERE id = $1`,
          [entryId]
        );

        // Update lease outcome
        await client.query(
          `UPDATE queue_leases
           SET outcome = 'expired', outcome_details = $1, released_at = NOW(3)
           WHERE entry_id = $2 AND outcome IS NULL`,
          [JSON.stringify({ timeout: true, olderThan: opts.olderThan.toISOString() }), entryId]
        );

        stuckJobIds.push(entryId);
      }

      return stuckJobIds;
    });
  }

  /**
   * Publish command to queue
   */
  async publishCommand(_queue: QueueName, _command: 'wake' | 'drain' | 'pause'): Promise<void> {
    // Nothing to do: workers poll their queue, so a new entry is picked up on the next poll.
    // TODO: Store pause/drain state in metadata table or in-memory flag
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(queue: QueueName): Promise<QueueMetrics> {
    const now = new Date();

    const result = await this.pool.query(
      `SELECT
        COUNT(CASE WHEN status = 'pending' AND run_at <= $2 THEN 1 END) AS pending,
        COUNT(CASE WHEN status = 'leased' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN status = 'pending' AND run_at > $2 THEN 1 END) AS delayed_count,
        COUNT(CASE WHEN status = 'dead_letter' THEN 1 END) AS dead_letter,
        MIN(CASE WHEN status = 'pending' AND run_at <= $2 THEN created_at END) AS oldest_pending_created_at
       FROM queue_entries
       WHERE queue = $1`,
      [queue, now]
    );

    const row = result.rows[0];
    return {
      queue,
      pending: Number(row.pending) || 0,
      inProgress: Number(row.in_progress) || 0,
      delayed: Number(row.delayed_count) || 0,
      deadLetter: Number(row.dead_letter) || 0,
      oldestPendingCreatedAt: row.oldest_pending_created_at ? new Date(row.oldest_pending_created_at) : undefined,
    };
  }
}
