import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { getTestStorage, cleanupTestTables, closeTestPool } from './setup/db';
import { createTestGameState, createTestUser } from './setup/helpers';

describe('storage correctness', () => {
  beforeEach(async () => {
    await cleanupTestTables();
    await pool.query('DELETE FROM reference_releases');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM reference_releases');
    await closeTestPool();
  });

  it('reads fresh user preferences across storage instances', async () => {
    const username = `preferences_${randomUUID()}`;
    await createTestUser(username);
    const firstInstance = getTestStorage();
    const secondInstance = getTestStorage();

    await firstInstance.getUserPreferences(username);
    await secondInstance.updateUserPreferences(username, { theme: 'fresh-theme' });

    await expect(firstInstance.getUserPreferences(username)).resolves.toMatchObject({
      theme: 'fresh-theme',
    });
  });

  it('treats LIKE wildcard characters in username searches literally', async () => {
    const base = `search-${randomUUID()}`;
    const storage = getTestStorage();
    const cases = ['%', '_', '\\'];

    for (const character of cases) {
      const literalPrefix = `${base}${character}`;
      const matchingUsername = `${literalPrefix}match`;
      await createTestUser(matchingUsername);
      await createTestUser(`${base}xmatch`);

      const results = await storage.searchUsersByUsername(literalPrefix);
      expect(results.map(user => user.username)).toContain(matchingUsername);
      expect(results.map(user => user.username)).not.toContain(`${base}xmatch`);
    }
  });

  it('switches the current reference release atomically and rejects unknown versions', async () => {
    const firstVersion = `test-${randomUUID()}`;
    const secondVersion = `test-${randomUUID()}`;
    const storage = getTestStorage();

    await storage.createReferenceRelease({
      version: firstVersion,
      published_by: 'test',
      is_current: 1,
    });
    await storage.createReferenceRelease({
      version: secondVersion,
      published_by: 'test',
      is_current: 0,
    });

    await expect(storage.setCurrentReferenceRelease('unknown-version')).rejects.toThrow(
      'Reference release unknown-version not found',
    );
    expect((await pool.query(
      'SELECT version FROM reference_releases WHERE is_current = 1',
    )).rows).toEqual([{ version: firstVersion }]);

    await storage.setCurrentReferenceRelease(secondVersion);
    expect((await pool.query(
      'SELECT version FROM reference_releases WHERE is_current = 1',
    )).rows).toEqual([{ version: secondVersion }]);
  });

  it('returns camel-cased image-model fields when updating an existing model', async () => {
    const modelKey = `test-model-${randomUUID()}`;
    const storage = getTestStorage();

    try {
      await storage.upsertImageModel({
        modelKey,
        modelName: 'test-model',
        displayName: 'Initial name',
      });

      const updated = await storage.upsertImageModel({
        modelKey,
        displayName: 'Updated name',
      });

      expect(updated.modelKey).toBe(modelKey);
      expect(updated.displayName).toBe('Updated name');
    } finally {
      await pool.query('DELETE FROM image_models WHERE model_key = $1', [modelKey]);
    }
  });

  it('keeps only the selected image model as default', async () => {
    const firstModelKey = `test-model-${randomUUID()}`;
    const secondModelKey = `test-model-${randomUUID()}`;
    const storage = getTestStorage();

    try {
      await storage.upsertImageModel({
        modelKey: firstModelKey,
        modelName: 'first-model',
        isDefault: true,
      });
      await storage.upsertImageModel({
        modelKey: secondModelKey,
        modelName: 'second-model',
        isDefault: true,
      });

      expect((await storage.getImageModelByKey(firstModelKey))?.isDefault).toBe(false);
      expect((await storage.getImageModelByKey(secondModelKey))?.isDefault).toBe(true);
    } finally {
      await pool.query('DELETE FROM image_models WHERE model_key IN ($1, $2)', [
        firstModelKey,
        secondModelKey,
      ]);
    }
  });

  it('counts pending turn and image jobs without loading job rows', async () => {
    const turnJobId = randomUUID();
    const imageJobId = randomUUID();
    const storage = getTestStorage();

    await pool.query(
      `INSERT INTO turn_jobs (id, game_id, action_payload, status)
       VALUES ($1, $2, '{}', 'pending'), ($3, $2, '{}', 'completed')`,
      [turnJobId, randomUUID(), randomUUID()],
    );
    await pool.query(
      `INSERT INTO image_jobs (id, game_id, turn_number, template_name, status)
       VALUES ($1, $2, 1, 'test-prompt', 'pending'), ($3, $2, 2, 'test-prompt', 'failed')`,
      [imageJobId, randomUUID(), randomUUID()],
    );

    await expect(storage.countPendingJobs()).resolves.toEqual({
      turnJobs: 1,
      imageJobs: 1,
    });
  });

  it('calculates cache stats from aggregate-equivalent values', async () => {
    const imageIds = [randomUUID(), randomUUID()];
    const logIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const storage = getTestStorage();

    try {
      for (const [index, id] of imageIds.entries()) {
        await pool.query(
          `INSERT INTO generated_images
             (id, template_name, prompt_hash, variables_hash, file_path, file_size, scene_fingerprint, metadata)
           VALUES ($1, 'stats-test', $2, $3, '/tmp/test.png', $4, '{}', '{}')`,
          [id, randomUUID(), randomUUID(), index === 0 ? 100 : 200],
        );
      }

      const logRows = [
        [logIds[0], JSON.stringify({ cacheHit: true }), 120],
        [logIds[1], JSON.stringify({ cacheHit: false }), 300],
        [logIds[2], null, null],
        [logIds[3], JSON.stringify({ cacheHit: 1 }), 30],
      ];
      for (const [id, metadata, executionTime] of logRows) {
        await pool.query(
          `INSERT INTO llm_logs (id, function_name, prompt, response, metadata, execution_time_ms)
           VALUES ($1, 'generateImage', 'prompt', 'response', $2, $3)`,
          [id, metadata, executionTime],
        );
      }

      const images = (await pool.query('SELECT file_size FROM generated_images')).rows;
      const logs = (await pool.query(
        "SELECT metadata, execution_time_ms FROM llm_logs WHERE function_name = 'generateImage'",
      )).rows;
      const cacheHits = logs.filter((log: any) => {
        const metadata = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
        return metadata?.cacheHit === true;
      }).length;
      const generationTimes = logs
        .map((log: any) => log.execution_time_ms)
        .filter((time: number | null) => time !== null);
      const expected = {
        totalImages: images.length,
        totalSize: images.reduce((total: number, image: any) => total + image.file_size, 0),
        hitRate: logs.length > 0 ? cacheHits / logs.length : 0,
        averageGenerationTime: generationTimes.length > 0
          ? generationTimes.reduce((total: number, time: number) => total + time, 0) / generationTimes.length
          : 0,
      };

      expect(await storage.getImageCacheStats()).toEqual(expected);
    } finally {
      await pool.query('DELETE FROM generated_images WHERE id IN ($1, $2)', imageIds);
      await pool.query('DELETE FROM llm_logs WHERE id IN ($1, $2, $3, $4)', logIds);
    }
  });

  it('returns game summaries without loading turn histories', async () => {
    const firstUsername = `summary_${randomUUID()}`;
    const secondUsername = `summary_${randomUUID()}`;
    await createTestUser(firstUsername);
    await createTestUser(secondUsername);
    const firstGame = await createTestGameState({ username: firstUsername });
    const secondGame = await createTestGameState({ username: secondUsername });

    const storage = getTestStorage();
    const firstSummaries = await storage.getGameSummariesByUsername(firstUsername);
    const batchedSummaries = await storage.getGameSummariesByUsernames([
      firstUsername,
      secondUsername,
    ]);

    expect(firstSummaries).toEqual([{
      id: firstGame.id,
      username: firstUsername,
      day: 1,
      turnNumber: 0,
      segment: 'Launch from Earth',
      isComplete: false,
      failureReason: undefined,
    }]);
    expect(batchedSummaries.map(({ id }) => id).sort()).toEqual(
      [firstGame.id, secondGame.id].sort(),
    );
    expect(batchedSummaries.every(summary => !('turns' in summary))).toBe(true);
  });
});
