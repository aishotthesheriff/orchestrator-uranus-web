/**
 * Postgres-backed Job Orchestrator implementation
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.8
 */

import { pool as defaultPool } from '../db';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getQueueConfig } from '../config/queues';
import {
  queueCompletedTotal,
  queueFailedTotal,
  queueDeadLetterTotal,
  queueLeaseTimeoutTotal,
  queueAttemptsHistogram,
  queueLatencyHistogram,
} from '../metrics';
import { log } from '../logger';
import type { 
  JobOrchestrator, 
  EnqueueOptions, 
  JobLease, 
  QueueName, 
  QueueMetrics,
  JobFailure 
} from './types';

class JobLeaseImpl<TPayload> implements JobLease<TPayload> {
  constructor(
    public job: JobLease<TPayload>['job'],
    public leaseId: string,
    public leaseExpiresAt: Date,
    private orchestrator: PostgresOrchestrator
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

export class PostgresOrchestrator implements JobOrchestrator {
  private pool: Pool;

  constructor(pool?: Pool) {
    // Use provided pool or default to the main pool from db.ts
    this.pool = pool || defaultPool;
  }

  /**
   * Enqueue a job into the orchestrator
   * Inserts into queue_entries and the legacy payload table
   */
  async enqueue(opts: EnqueueOptions): Promise<string> {
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

    // Insert into queue_entries
    await this.pool.query(
      `INSERT INTO queue_entries (
        id, queue, payload_table, payload_id, status, attempts, priority, 
        run_at, trace_id, request_id, metadata, idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        queueEntryId,
        opts.queue,
        payloadTable,
        payloadId,
        'pending',
        0,
        opts.priority ?? 0,
        opts.runAt ?? new Date(),
        opts.traceId || null,
        opts.requestId || null,
        JSON.stringify(opts.metadata || {}),
        opts.idempotencyKey || null,
      ]
    );

    // Emit NOTIFY for wake command
    await this.pool.query(`NOTIFY queue_${opts.queue.replace(/-/g, '_')}`);

    return queueEntryId;
  }

  /**
   * Claim jobs from a queue
   * Uses FOR UPDATE SKIP LOCKED to atomically claim jobs
   */
  async claim(queue: QueueName, workerId: string, opts?: { batchSize?: number }): Promise<JobLease<any>[]> {
    const batchSize = opts?.batchSize ?? 5;
    const config = getQueueConfig(queue);
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Claim jobs with FOR UPDATE SKIP LOCKED, ordered by priority DESC, run_at ASC, created_at ASC
      const claimResult = await client.query(
        `SELECT * FROM queue_entries
         WHERE queue = $1 AND status = 'pending' AND run_at <= NOW()
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [queue, batchSize]
      );

      if (claimResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return [];
      }

      const leases: JobLease<any>[] = [];
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + config.leaseDurationMs);

      for (const row of claimResult.rows) {
        const leaseId = randomUUID();
        const entryId = row.id;
        
        // Create lease record
        await client.query(
          `INSERT INTO queue_leases (lease_id, entry_id, worker_id, heartbeat_expires_at, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [leaseId, entryId, workerId, leaseExpiresAt]
        );

        // Update queue entry to leased status
        await client.query(
          `UPDATE queue_entries
           SET status = 'leased', lease_id = $1, lease_owner = $2, lease_expires_at = $3, updated_at = NOW()
           WHERE id = $4`,
          [leaseId, workerId, leaseExpiresAt, entryId]
        );

        // Load payload from payload table
        let payload: any;
        try {
          const payloadResult = await client.query(
            `SELECT * FROM ${row.payload_table} WHERE id = $1 FOR UPDATE SKIP LOCKED`,
            [row.payload_id]
          );
          
          if (payloadResult.rows.length === 0) {
            console.warn(`[Orchestrator] Payload not found for ${row.payload_table}:${row.payload_id}`);
            // Release the lease and continue
            await client.query('ROLLBACK');
            await this.release(leaseId);
            continue;
          }
          
          payload = payloadResult.rows[0];
        } catch (error) {
          console.error(`[Orchestrator] Failed to load payload from ${row.payload_table}:`, error);
          await client.query('ROLLBACK');
          await this.release(leaseId);
          continue;
        }

        const job: JobLease<any>['job'] = {
          id: entryId,
          queue: row.queue as QueueName,
          payload,
          attempts: row.attempts,
          traceId: row.trace_id || '',
          requestId: row.request_id || undefined,
          metadata: row.metadata || {},
          priority: row.priority,
          runAt: new Date(row.run_at),
        };

        leases.push(new JobLeaseImpl(job, leaseId, leaseExpiresAt, this));
      }

      await client.query('COMMIT');
      return leases;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Extend/heartbeat a lease
   */
  async heartbeat(leaseId: string, extensionMs: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check lease exists and is not expired
      const leaseResult = await client.query(
        `SELECT ql.*, qe.id as entry_id, qe.queue
         FROM queue_leases ql
         JOIN queue_entries qe ON ql.entry_id = qe.id
         WHERE ql.lease_id = $1 AND ql.heartbeat_expires_at > NOW()`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Lease ${leaseId} not found or expired`);
      }

      const newExpiresAt = new Date(Date.now() + extensionMs);
      const config = getQueueConfig(leaseResult.rows[0].queue as QueueName);

      // Update lease heartbeat
      await client.query(
        `UPDATE queue_leases
         SET heartbeat_expires_at = $1, renewed_at = NOW()
         WHERE lease_id = $2`,
        [newExpiresAt, leaseId]
      );

      // Update queue entry lease expiration
      await client.query(
        `UPDATE queue_entries
         SET lease_expires_at = $1, updated_at = NOW()
         WHERE lease_id = $2`,
        [newExpiresAt, leaseId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete a job
   */
  async complete(leaseId: string, result?: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get lease info
      const leaseResult = await client.query(
        `SELECT entry_id FROM queue_leases WHERE lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Lease ${leaseId} not found`);
      }

      const entryId = leaseResult.rows[0].entry_id;

      // Get queue name for metrics
      const queueResult = await client.query('SELECT queue, created_at, attempts FROM queue_entries WHERE id = $1', [entryId]);
      const queue = queueResult.rows[0]?.queue as QueueName;
      const createdAt = queueResult.rows[0]?.created_at;
      const attempts = queueResult.rows[0]?.attempts || 0;

      // Update queue entry to completed
      await client.query(
        `UPDATE queue_entries
         SET status = 'completed', lease_id = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [entryId]
      );

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'completed', outcome_details = $1, released_at = NOW()
         WHERE lease_id = $2`,
        [JSON.stringify(result || {}), leaseId]
      );

      await client.query('COMMIT');

      // Emit metrics
      queueCompletedTotal.inc({ queue });
      queueAttemptsHistogram.observe({ queue }, attempts);
      if (createdAt) {
        const latency = Date.now() - new Date(createdAt).getTime();
        queueLatencyHistogram.observe({ queue }, latency);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fail a job
   */
  async fail(leaseId: string, error: JobFailure, opts?: { retryDelayMs?: number }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get lease and entry info
      const leaseResult = await client.query(
        `SELECT ql.entry_id, qe.attempts, qe.queue
         FROM queue_leases ql
         JOIN queue_entries qe ON ql.entry_id = qe.id
         WHERE ql.lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Lease ${leaseId} not found`);
      }

      const { entry_id: entryId, attempts, queue } = leaseResult.rows[0];
      const config = getQueueConfig(queue as QueueName);
      const newAttempts = attempts + 1;

      // Determine if we should retry or move to dead letter
      const shouldRetry = error.reason === 'transient' && newAttempts < config.maxAttempts;
      
      // Emit metrics
      queueFailedTotal.inc({ queue });
      
      if (shouldRetry) {
        // Calculate exponential backoff
        const backoffMs = Math.min(5000 * Math.pow(2, newAttempts - 1), 120000); // min(5s * 2^(attempts-1), 120s)
        const runAt = new Date(Date.now() + (opts?.retryDelayMs || backoffMs));

        // Update queue entry to pending with backoff
        await client.query(
          `UPDATE queue_entries
           SET status = 'pending', attempts = $1, run_at = $2, lease_id = NULL, lease_owner = NULL, 
               lease_expires_at = NULL, last_error = $3, updated_at = NOW()
           WHERE id = $4`,
          [newAttempts, runAt, JSON.stringify({ reason: error.reason, message: error.message, details: error.details }), entryId]
        );
      } else {
        // Move to dead letter
        await client.query(
          `UPDATE queue_entries
           SET status = 'dead_letter', attempts = $1, lease_id = NULL, lease_owner = NULL,
               lease_expires_at = NULL, last_error = $2, updated_at = NOW()
           WHERE id = $3`,
          [newAttempts, JSON.stringify({ reason: error.reason, message: error.message, details: error.details }), entryId]
        );
        
        queueDeadLetterTotal.inc({ queue });
      }

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'failed', outcome_details = $1, released_at = NOW()
         WHERE lease_id = $2`,
        [JSON.stringify({ reason: error.reason, message: error.message, details: error.details }), leaseId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Release a lease (return to pending without counting attempt)
   */
  async release(leaseId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get entry ID
      const leaseResult = await client.query(
        `SELECT entry_id FROM queue_leases WHERE lease_id = $1`,
        [leaseId]
      );

      if (leaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Lease ${leaseId} not found`);
      }

      const entryId = leaseResult.rows[0].entry_id;

      // Update queue entry back to pending
      await client.query(
        `UPDATE queue_entries
         SET status = 'pending', lease_id = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [entryId]
      );

      // Update lease outcome
      await client.query(
        `UPDATE queue_leases
         SET outcome = 'released', released_at = NOW()
         WHERE lease_id = $1`,
        [leaseId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark stuck jobs (jobs with expired leases)
   */
  async markStuck(opts: { queue: QueueName; olderThan: Date }): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
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
               lease_expires_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [entryId]
        );

        // Update lease outcome
        await client.query(
          `UPDATE queue_leases
           SET outcome = 'expired', outcome_details = $1, released_at = NOW()
           WHERE entry_id = $2 AND outcome IS NULL`,
          [JSON.stringify({ timeout: true, olderThan: opts.olderThan.toISOString() }), entryId]
        );

        stuckJobIds.push(entryId);
      }

      await client.query('COMMIT');
      return stuckJobIds;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Publish command to queue
   */
  async publishCommand(queue: QueueName, command: 'wake' | 'drain' | 'pause'): Promise<void> {
    // For now, just emit NOTIFY for wake
    // TODO: Store pause/drain state in metadata table or in-memory flag
    if (command === 'wake') {
      await this.pool.query(`NOTIFY queue_${queue.replace(/-/g, '_')}`);
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(queue: QueueName): Promise<QueueMetrics> {
    const now = new Date();
    
    const result = await this.pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending' AND run_at <= $2) as pending,
        COUNT(*) FILTER (WHERE status = 'leased') as in_progress,
        COUNT(*) FILTER (WHERE status = 'pending' AND run_at > $2) as delayed,
        COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter,
        MIN(created_at) FILTER (WHERE status = 'pending' AND run_at <= $2) as oldest_pending_created_at
       FROM queue_entries
       WHERE queue = $1`,
      [queue, now]
    );

    const row = result.rows[0];
    return {
      queue,
      pending: parseInt(row.pending) || 0,
      inProgress: parseInt(row.in_progress) || 0,
      delayed: parseInt(row.delayed) || 0,
      deadLetter: parseInt(row.dead_letter) || 0,
      oldestPendingCreatedAt: row.oldest_pending_created_at ? new Date(row.oldest_pending_created_at) : undefined,
    };
  }
}
