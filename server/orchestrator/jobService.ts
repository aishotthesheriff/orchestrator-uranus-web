import { randomUUID } from 'crypto';
import type { ImageJob, InsertImageJob, TurnJob, InsertTurnJob } from '@shared/schema';
import { withTransaction, type DbClient } from '../db';
import { isUniqueViolation } from '../db/errors';
import { JobRepository } from '../repositories/jobRepository';
import { generateIdempotencyKey, generateImageJobIdempotencyKey } from './idempotency';
import { getOrchestrator } from './index';
import type { JobOrchestrator } from './types';

export type JobOptions = {
  traceId?: string;
  requestId?: string;
  /** Defaults to the service's setting (the shared service: off under DISABLE_ORCHESTRATOR_ENQUEUE=true or NODE_ENV=test). */
  enqueue?: boolean;
  /** Run inside the caller's transaction instead of opening one. */
  client?: DbClient;
};

/** For the shared service. Read when a job is created, not when the module loads. */
function enqueueUnlessDisabled(): boolean {
  return !(process.env.DISABLE_ORCHESTRATOR_ENQUEUE === 'true' || process.env.NODE_ENV === 'test');
}

/**
 * Creates a job row and its queue entry in one transaction: either both exist or neither.
 * This is the only place outside the orchestrator that talks to the queue.
 */
export class JobService {
  private readonly jobs = new JobRepository();

  constructor(
    private readonly orchestratorOverride?: JobOrchestrator,
    private readonly enqueueByDefault: () => boolean = () => true,
  ) {}

  private get orchestrator(): JobOrchestrator {
    return this.orchestratorOverride ?? getOrchestrator();
  }

  async createImageJob(job: InsertImageJob, options: JobOptions = {}): Promise<ImageJob> {
    const id = randomUUID();
    const enqueue = options.enqueue ?? this.enqueueByDefault();

    return this.inTransaction(options.client, async client => {
      const jobs = this.jobs.withDb(client);
      let created: ImageJob;
      try {
        created = await jobs.insertImageJob(id, job);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // One active image job per turn: hand back the one already there.
        const existing = await jobs.getActiveImageJob(job.gameId, job.turnNumber);
        if (!existing) throw error;
        return existing;
      }

      if (enqueue) {
        await this.orchestrator.enqueue({
          queue: 'image',
          payload: { id },
          idempotencyKey: generateImageJobIdempotencyKey(id),
          traceId: options.traceId,
          requestId: options.requestId,
          metadata: {
            gameId: job.gameId,
            turnNumber: job.turnNumber,
            templateName: job.templateName,
          },
        }, client);
      }

      return created;
    });
  }

  async createTurnJob(job: InsertTurnJob, options: JobOptions = {}): Promise<TurnJob> {
    const id = randomUUID();
    const enqueue = options.enqueue ?? this.enqueueByDefault();

    return this.inTransaction(options.client, async client => {
      const created = await this.jobs.withDb(client).insertTurnJob(id, job);

      if (enqueue) {
        const game = await client.query<{ turn_number: number }>(
          'SELECT turn_number FROM games WHERE id = $1',
          [job.gameId],
        );
        if (!game.rows[0]) {
          throw new Error(`Game ${job.gameId} not found while creating turn job`);
        }
        const turnNumber = Number(game.rows[0].turn_number);
        const idempotencyKey = generateIdempotencyKey(
          'turn-precompute',
          job.gameId,
          turnNumber,
          job.actionPayload,
        );
        await this.orchestrator.enqueue({
          queue: 'turn-precompute',
          payload: { id },
          idempotencyKey,
          traceId: options.traceId,
          requestId: options.requestId,
          metadata: {
            gameId: job.gameId,
            turnNumber,
          },
        }, client);
      }

      return created;
    });
  }

  private inTransaction<T>(
    client: DbClient | undefined,
    operation: (transaction: DbClient) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : withTransaction(operation);
  }
}

let instance: JobService | null = null;

/** The shared JobService, using the app's orchestrator. */
export function getJobService(): JobService {
  if (!instance) instance = new JobService(undefined, enqueueUnlessDisabled);
  return instance;
}
