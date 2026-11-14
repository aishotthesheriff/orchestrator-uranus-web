/**
 * Round-trip tests for the smaller repositories behind the storage facade:
 * users, games, settings, LLM models, story themes and visual styles.
 * Rows outside the cleaned test tables are created with PREFIX and deleted afterwards.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getTestStorage, setupTestSchema, cleanupTestTables, getTestPool } from '../setup/db';
import { createTestGameState } from '../setup/helpers';

const PREFIX = `rtest_${randomUUID().slice(0, 8)}_`;
const storage = getTestStorage();

beforeAll(async () => {
  await setupTestSchema();
});

beforeEach(async () => {
  await cleanupTestTables();
});

afterEach(async () => {
  const pool = getTestPool();
  await pool.query('DELETE FROM app_settings WHERE `key` LIKE $1', [`${PREFIX}%`]);
  await pool.query('DELETE FROM llm_models WHERE model_key LIKE $1', [`${PREFIX}%`]);
  await pool.query('DELETE FROM mod_story_themes WHERE story_theme_key LIKE $1', [`${PREFIX}%`]);
  await pool.query('DELETE FROM mod_visual_styles WHERE visual_style_key LIKE $1', [`${PREFIX}%`]);
});

describe('UserRepository', () => {
  it('ensureUser is idempotent', async () => {
    const first = await storage.ensureUser('rt_user');
    const second = await storage.ensureUser('rt_user');
    expect(second.id).toBe(first.id);
    const rows = await getTestPool().query('SELECT id FROM users WHERE username = $1', ['rt_user']);
    expect(rows.rows).toHaveLength(1);
  });

  it('preferences survive an update and a read back', async () => {
    await storage.ensureUser('rt_prefs');
    await storage.updateUserPreferences('rt_prefs', { skipImageCache: false, typewriterEnabled: false } as any);
    const prefs = await storage.getUserPreferences('rt_prefs');
    expect(prefs.skipImageCache).toBe(false);
    expect(prefs.typewriterEnabled).toBe(false);
  });
});

describe('GameRepository', () => {
  it('creates, reads, lists and deletes a game', async () => {
    const game = await createTestGameState({ username: 'rt_game' });
    const read = await storage.getGameState(game.id);
    expect(read).toMatchObject({ id: game.id, username: 'rt_game', isComplete: false, interviewResponses: {} });
    expect((await storage.getGamesByUsername('rt_game')).map((g) => g.id)).toEqual([game.id]);
    await storage.deleteGameState(game.id);
    expect(await storage.getGameState(game.id)).toBeUndefined();
  });

  it('a turn transaction saves the processor result', async () => {
    const game = await createTestGameState({ username: 'rt_tx' });
    await storage.processTurnWithTransaction(game.id, async (state) => ({ ...state, day: 5 }));
    expect((await storage.getGameState(game.id))?.day).toBe(5);
  });

  it('a turn transaction rolls back when the processor throws', async () => {
    const game = await createTestGameState({ username: 'rt_rollback' });
    await expect(
      storage.processTurnWithTransaction(game.id, async (state, client) => {
        await client.query('UPDATE games SET day = 9 WHERE id = $1', [state.id]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await storage.getGameState(game.id))?.day).toBe(1);
  });
});

describe('SettingsRepository', () => {
  it('upsert inserts, then updates the same key and keeps the description', async () => {
    const key = `${PREFIX}setting`;
    const created = await storage.upsertSetting(key, 'one', 'about it');
    expect(created).toMatchObject({ key, value: 'one', description: 'about it' });
    const updated = await storage.upsertSetting(key, 'two');
    expect(updated).toMatchObject({ key, value: 'two', description: 'about it' });
    expect((await storage.getSetting(key))?.value).toBe('two');
  });
});

describe('CatalogRepository: LLM models', () => {
  it('upsert inserts and then updates by model key', async () => {
    const modelKey = `${PREFIX}llm`;
    const created = await storage.upsertLlmModel({
      modelKey, provider: 'openrouter', modelName: 'x/y', displayName: 'X', active: 1, sortOrder: 1,
    } as any);
    expect(created).toMatchObject({ modelKey, modelName: 'x/y', displayName: 'X' });
    const updated = await storage.upsertLlmModel({ modelKey, displayName: 'Renamed' } as any);
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({ modelKey, modelName: 'x/y', displayName: 'Renamed' });
  });
});

describe('CatalogRepository: story themes and visual styles', () => {
  it('a story theme without its required fields is refused', async () => {
    await expect(storage.upsertStoryTheme({ label: 'no key' } as any)).rejects.toThrow(/storyThemeKey/);
  });

  it("a story theme's empty llmModelKey is stored as null", async () => {
    const created = await storage.upsertStoryTheme({
      storyThemeKey: `${PREFIX}theme`, label: 'T', narratorTemplate: 'n', tags: 'a', active: 1, llmModelKey: 'm',
    } as any);
    expect(created.llmModelKey).toBe('m');
    const cleared = await storage.upsertStoryTheme({ id: created.id, llmModelKey: '' } as any);
    expect(cleared.llmModelKey).toBeNull();
  });

  it('a visual style without its required fields is refused', async () => {
    await expect(
      storage.upsertVisualStyle({ category: 'c', visualStyleKey: `${PREFIX}style`, label: 'L' } as any),
    ).rejects.toThrow(/exemplifiedBy/);
  });
});
