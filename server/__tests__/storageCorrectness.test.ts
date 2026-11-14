import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { getTestStorage, cleanupTestTables, closeTestPool } from './setup/db';
import { createTestUser } from './setup/helpers';

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
});
