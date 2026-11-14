import { randomUUID } from 'crypto';
import type { InsertImageJob, InsertTurnJob } from '@shared/schema';
import { withTransaction, type DbClient, type QueryResult } from '../db';
import { isUniqueViolation } from '../db/errors';
import { generateIdempotencyKey, generateImageJobIdempotencyKey } from './idempotency';
import { getOrchestrator } from './index';
import type { JobOrchestrator } from './types';

export type JobOptions = {
  traceId?: string;
  requestId?: string;
  enqueue?: boolean;
  client?: DbClient;
};

type DatabaseRow = Record<string, unknown>;

export class JobService {
  constructor(private readonly orchestrator: JobOrchestrator = getOrchestrator()) {}

  async createImageJob(job: InsertImageJob, options: JobOptions = {}): Promise<DatabaseRow> {
    const id = randomUUID();

    return this.withTransaction(options.client, async client => {
      let result: QueryResult<DatabaseRow>;
      try {
        result = await client.query<DatabaseRow>(
          `INSERT INTO image_jobs (id, game_id, turn_number, template_name, status, image_url, image_template, error, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            id,
            job.gameId,
            job.turnNumber,
            job.templateName,
            job.status ?? 'pending',
            job.imageUrl || null,
            job.imageTemplate || null,
            job.error || null,
            job.completedAt || null,
          ],
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const existing = await client.query<DatabaseRow>(
          `SELECT * FROM image_jobs
           WHERE game_id = $1 AND turn_number = $2
             AND status IN ('pending', 'processing')
           ORDER BY created_at
           LIMIT 1`,
          [job.gameId, job.turnNumber],
        );
        if (!existing.rows[0]) throw error;
        return existing.rows[0];
      }

      const created = result.rows[0];
      if (options.enqueue !== false) {
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

  async createTurnJob(job: InsertTurnJob, options: JobOptions = {}): Promise<DatabaseRow> {
    const id = randomUUID();

    return this.withTransaction(options.client, async client => {
      const result = await client.query<DatabaseRow>(
        `INSERT INTO turn_jobs (id, game_id, action_payload, status, error, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id,
          job.gameId,
          JSON.stringify(job.actionPayload),
          job.status ?? 'pending',
          job.error || null,
          job.completedAt || null,
        ],
      );

      if (options.enqueue !== false) {
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

      return result.rows[0];
    });
  }

  private withTransaction<T>(
    client: DbClient | undefined,
    operation: (transaction: DbClient) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : withTransaction(operation);
  }
}
