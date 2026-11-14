import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { getTestStorage, cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState } from './setup/helpers';
import { JobService } from '../orchestrator/jobService';
import { MariaDbOrchestrator } from '../orchestrator/mariaDbOrchestrator';
import type { Queryable } from '../db';
import type { EnqueueOptions } from '../orchestrator/types';

class FailingEnqueueOrchestrator extends MariaDbOrchestrator {
  payloadId?: string;

  override async enqueue(opts: EnqueueOptions, client?: Queryable): Promise<string> {
    this.payloadId = String((opts.payload as { id?: unknown }).id);
    await super.enqueue(opts, client);
    throw new Error('simulated enqueue failure');
  }
}

describe('job creation transactions', () => {
  const storage = getTestStorage();
  const jobService = new JobService(new MariaDbOrchestrator(pool));

  beforeEach(async () => {
    await cleanupTestTables();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('commits an image job and its queue entry with the game update', async () => {
    const game = await createTestGameState();
    let imageJobId: string | undefined;

    await storage.processTurnWithTransaction(game.id, async (state, client) => {
      state.day = 2;
      const imageJob = await jobService.createImageJob({
        gameId: game.id,
        turnNumber: 1,
        templateName: 'test-image',
        status: 'pending',
      }, { client });
      imageJobId = String(imageJob.id);
      return state;
    });

    expect((await storage.getGameState(game.id))?.day).toBe(2);
    expect((await pool.query(
      'SELECT id FROM image_jobs WHERE id = $1',
      [imageJobId],
    )).rows).toHaveLength(1);
    expect((await pool.query(
      "SELECT id FROM queue_entries WHERE queue = 'image' AND payload_id = $1",
      [imageJobId],
    )).rows).toHaveLength(1);
  });

  it('rolls back the game update, image job, and queue entry together on failure', async () => {
    const game = await createTestGameState();
    let imageJobId: string | undefined;

    await expect(storage.processTurnWithTransaction(game.id, async (state, client) => {
      state.day = 2;
      const imageJob = await jobService.createImageJob({
        gameId: game.id,
        turnNumber: 1,
        templateName: 'test-image',
        status: 'pending',
      }, { client });
      imageJobId = String(imageJob.id);
      throw new Error('simulated transaction failure');
    })).rejects.toThrow('simulated transaction failure');

    expect((await storage.getGameState(game.id))?.day).toBe(1);
    expect((await pool.query(
      'SELECT id FROM image_jobs WHERE id = $1',
      [imageJobId],
    )).rows).toHaveLength(0);
    expect((await pool.query(
      "SELECT id FROM queue_entries WHERE queue = 'image' AND payload_id = $1",
      [imageJobId],
    )).rows).toHaveLength(0);
  });

  it('does not leave an image job or queue entry when enqueue fails', async () => {
    const game = await createTestGameState();
    const failingOrchestrator = new FailingEnqueueOrchestrator(pool);
    const failingService = new JobService(failingOrchestrator);

    await expect(failingService.createImageJob({
      gameId: game.id,
      turnNumber: 1,
      templateName: 'test-image',
      status: 'pending',
    })).rejects.toThrow('simulated enqueue failure');

    expect((await pool.query(
      'SELECT id FROM image_jobs WHERE game_id = $1 AND turn_number = 1',
      [game.id],
    )).rows).toHaveLength(0);
    expect((await pool.query(
      'SELECT id FROM queue_entries WHERE payload_id = $1',
      [failingOrchestrator.payloadId],
    )).rows).toHaveLength(0);
  });

  it('returns the existing active image job instead of creating a duplicate', async () => {
    const game = await createTestGameState();
    const input = {
      gameId: game.id,
      turnNumber: 1,
      templateName: 'test-image',
      status: 'pending',
    };

    const first = await jobService.createImageJob(input);
    const duplicate = await jobService.createImageJob(input);

    expect(duplicate.id).toBe(first.id);
    expect((await pool.query(
      "SELECT id FROM queue_entries WHERE queue = 'image' AND payload_id = $1",
      [first.id],
    )).rows).toHaveLength(1);
  });

  it('creates turn jobs and their queue entries in one transaction', async () => {
    const game = await createTestGameState();

    const turnJob = await jobService.createTurnJob({
      gameId: game.id,
      actionPayload: { gameId: game.id, action: 'test-action' },
      status: 'pending',
    });

    expect((await pool.query(
      'SELECT id FROM turn_jobs WHERE id = $1',
      [turnJob.id],
    )).rows).toHaveLength(1);
    expect((await pool.query(
      "SELECT id FROM queue_entries WHERE queue = 'turn-precompute' AND payload_id = $1",
      [turnJob.id],
    )).rows).toHaveLength(1);
  });
});
