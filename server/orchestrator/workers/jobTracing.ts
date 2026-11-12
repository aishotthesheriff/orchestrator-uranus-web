/**
 * Tracing for queue workers. A worker handles its own failures (it reports them to the
 * lease and returns), which would leave the run looking successful. Throwing
 * HandledJobFailure after the lease has been failed marks the run as an error; this
 * wrapper then swallows it, so the worker's callers see what they always saw.
 */

import { traceJob, type JobSpanOptions } from '../../observability/langsmith';
import type { JobLease } from '../types';

export class HandledJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandledJobFailure';
  }
}

export async function runTracedJob(
  lease: JobLease<unknown>,
  options: Omit<JobSpanOptions<void>, 'metadata'> & { metadata?: Record<string, unknown> },
  fn: () => Promise<void>
): Promise<void> {
  try {
    await traceJob(
      lease.job.metadata,
      {
        ...options,
        metadata: {
          queue: lease.job.queue,
          queueEntryId: lease.job.id,
          attempt: lease.job.attempts,
          app_trace_id: lease.job.traceId || undefined,
          app_request_id: lease.job.requestId,
          ...options.metadata
        }
      },
      fn
    );
  } catch (error) {
    if (!(error instanceof HandledJobFailure)) throw error;
  }
}
