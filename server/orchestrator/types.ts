/**
 * Type definitions for Job Orchestrator interface
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.2
 */

export type QueueName = 'turn-precompute' | 'turn-apply' | 'image' | string;

export interface EnqueueOptions {
  queue: QueueName;
  payload: unknown;
  runAt?: Date;
  priority?: number;         // Higher value = higher priority
  idempotencyKey?: string;   // (queue, key) scoped dedupe
  traceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface JobFailure {
  reason: 'transient' | 'permanent';
  message: string;
  details?: Record<string, unknown>;
}

export interface JobLease<TPayload> {
  job: {
    id: string;
    queue: QueueName;
    payload: TPayload;
    attempts: number;
    traceId: string;
    requestId?: string;
    metadata: Record<string, unknown>;
    priority: number;
    runAt: Date;
  };
  leaseId: string;
  leaseExpiresAt: Date;
  extend(ms: number): Promise<void>;
  complete(result?: Record<string, unknown>): Promise<void>;
  fail(error: JobFailure, opts?: { retryDelayMs?: number }): Promise<void>;
  release(): Promise<void>;  // Return to pending without counting attempt
}

export interface QueueMetrics {
  queue: QueueName;
  pending: number;
  inProgress: number;
  delayed: number;
  deadLetter: number;
  oldestPendingCreatedAt?: Date;
}

export interface JobOrchestrator {
  enqueue(opts: EnqueueOptions): Promise<string>; // returns job id
  claim(queue: QueueName, workerId: string, opts?: { batchSize?: number }): Promise<JobLease<any>[]>;
  heartbeat(leaseId: string, extensionMs: number): Promise<void>;
  markStuck(opts: { queue: QueueName; olderThan: Date }): Promise<string[]>; // for ops tooling
  publishCommand(queue: QueueName, command: 'wake' | 'drain' | 'pause'): Promise<void>;
  getQueueMetrics(queue: QueueName): Promise<QueueMetrics>;
}

