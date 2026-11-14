/**
 * Round-trip tests for the content tables behind the storage facade.
 *
 * Written against the pre-split storage.ts so they pin its behaviour: create defaults,
 * partial updates, JSON columns, the active filter and the list order.
 * Each test deletes only the rows it created (names start with PREFIX).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getTestStorage, setupTestSchema, getTestPool } from '../setup/db';
import type { IStorage } from '../../storage';

const PREFIX = `ctest_${randomUUID().slice(0, 8)}_`;
const storage: IStorage = getTestStorage();
const name = (s: string) => `${PREFIX}${s}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Case {
  table: string;
  nameColumn: string;
  create: (n: string, extra?: Record<string, unknown>) => Promise<any>;
  update: (id: string, patch: Record<string, unknown>) => Promise<any>;
  list: () => Promise<any[]>;
  listActive: () => Promise<any[]>;
  nameOf: (row: any) => string;
  defaults: Record<string, unknown>;
  scalarPatch: Record<string, unknown>;
  jsonPatch: Record<string, unknown>;
  orderBy: 'updated_at' | 'display_order';
}

const cases: Case[] = [
  {
    table: 'events',
    nameColumn: 'name',
    create: (n, extra = {}) =>
      storage.createEvent({
        name: n, segment: 'morning', skill: 'charm', dc: 10, triggerCondition: { any: true },
        passEffect: 'pass', failEffect: 'fail', tags: ['a'], ...extra,
      } as any),
    update: (id, p) => storage.updateEvent(id, p as any),
    list: () => storage.getAllEvents(),
    listActive: () => storage.getActiveEvents(),
    nameOf: (r) => r.name,
    defaults: { active: 1 },
    scalarPatch: { dc: 15 },
    jsonPatch: { tags: ['x', 'y'] },
    orderBy: 'updated_at',
  },
  {
    table: 'items',
    nameColumn: 'name',
    create: (n, extra = {}) =>
      storage.createItem({ name: n, description: 'd', icon: 'i', tags: ['a'], skillBonusValue: 0, ...extra } as any),
    update: (id, p) => storage.updateItem(id, p as any),
    list: () => storage.getItems(),
    listActive: () => storage.getActiveItems(),
    nameOf: (r) => r.name,
    defaults: { active: 1, skillBonusValue: null, skillBonusSkill: null, sceneEffectTags: null, efficiency: null },
    scalarPatch: { description: 'changed' },
    jsonPatch: { sceneEffectTags: ['dark'] },
    orderBy: 'updated_at',
  },
  {
    table: 'npc_templates',
    nameColumn: 'name',
    create: (n, extra = {}) => storage.createNpcTemplate({ name: n, role: 'r', tags: ['a'], ...extra } as any),
    update: (id, p) => storage.updateNpcTemplate(id, p as any),
    list: () => storage.getNpcTemplates(),
    listActive: () => storage.getActiveNpcTemplates(),
    nameOf: (r) => r.name,
    defaults: { active: 1, startingAffinity: 0, bio: null },
    scalarPatch: { role: 'new role' },
    jsonPatch: { tags: ['x'] },
    orderBy: 'updated_at',
  },
  {
    table: 'image_prompts',
    nameColumn: 'name',
    create: (n, extra = {}) =>
      storage.createImagePrompt({ name: n, promptTemplate: 'p', sceneTypes: ['s'], tags: ['a'], ...extra } as any),
    update: (id, p) => storage.updateImagePrompt(id, p as any),
    list: () => storage.getImagePrompts(),
    listActive: () => storage.getActiveImagePrompts(),
    nameOf: (r) => r.name,
    defaults: { active: 1, size: '1024x1024', quality: 'auto', inheritVisualStyle: 1, description: null },
    scalarPatch: { quality: 'high' },
    jsonPatch: { sceneTypes: ['a', 'b'] },
    orderBy: 'updated_at',
  },
  {
    table: 'interview_questions',
    nameColumn: 'variable_name',
    create: (n, extra = {}) =>
      storage.createInterviewQuestion({ question: 'q?', variableName: n, tags: ['a'], ...extra } as any),
    update: (id, p) => storage.updateInterviewQuestion(id, p as any),
    list: () => storage.getInterviewQuestions(),
    listActive: () => storage.getActiveInterviewQuestions(),
    nameOf: (r) => r.variableName,
    defaults: { active: 1, displayOrder: 0, description: null },
    scalarPatch: { question: 'changed?' },
    jsonPatch: { tags: ['x'] },
    orderBy: 'display_order',
  },
  {
    table: 'prompt_templates',
    nameColumn: 'name',
    create: (n, extra = {}) => storage.createPromptTemplate({ name: n, content: 'c', ...extra } as any),
    update: (id, p) => storage.updatePromptTemplate(id, p as any),
    list: () => storage.getAllPromptTemplates(),
    listActive: () => storage.getActivePromptTemplates(),
    nameOf: (r) => r.name,
    defaults: { active: 1, version: 1, inheritGlobalPrompt: 1, systemContent: null, description: null },
    scalarPatch: { content: 'changed' },
    jsonPatch: {},
    orderBy: 'updated_at',
  },
];

beforeAll(async () => {
  await setupTestSchema();
});

afterEach(async () => {
  const pool = getTestPool();
  for (const c of cases) {
    await pool.query(`DELETE FROM ${c.table} WHERE ${c.nameColumn} LIKE $1`, [`${PREFIX}%`]);
  }
});

const ours = (rows: any[], c: Case) => rows.filter((r) => c.nameOf(r).startsWith(PREFIX));

describe.each(cases)('content table $table', (c) => {
  it('sets every default on create with minimal input', async () => {
    const row = await c.create(name('min'));
    expect(row.id).toEqual(expect.any(String));
    for (const [key, value] of Object.entries(c.defaults)) {
      expect(row[key], key).toEqual(value);
    }
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('updates one field, keeps the others and moves updatedAt forward', async () => {
    const created = await c.create(name('upd'));
    await sleep(15);
    const updated = await c.update(created.id, c.scalarPatch);
    const [key, value] = Object.entries(c.scalarPatch)[0];
    expect(updated[key]).toEqual(value);
    for (const other of Object.keys(created)) {
      if (other === key || other === 'updatedAt') continue;
      expect(updated[other], other).toEqual(created[other]);
    }
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  it('an empty patch still moves updatedAt forward', async () => {
    const created = await c.create(name('empty'));
    await sleep(15);
    const updated = await c.update(created.id, {});
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  it('updates a JSON field', async () => {
    const entries = Object.entries(c.jsonPatch);
    if (entries.length === 0) return;
    const created = await c.create(name('json'));
    const updated = await c.update(created.id, c.jsonPatch);
    const [key, value] = entries[0];
    expect(updated[key]).toEqual(value);
    const listed = ours(await c.list(), c).find((r) => r.id === created.id);
    expect(listed[key]).toEqual(value);
  });

  it('a row set to active=0 drops out of the active list', async () => {
    const created = await c.create(name('act'));
    expect(ours(await c.listActive(), c).map((r) => r.id)).toContain(created.id);
    await c.update(created.id, { active: 0 });
    expect(ours(await c.listActive(), c).map((r) => r.id)).not.toContain(created.id);
    expect(ours(await c.list(), c).map((r) => r.id)).toContain(created.id);
  });

  it('lists in the right order', async () => {
    if (c.orderBy === 'display_order') {
      await c.create(name('b'), { displayOrder: 900002 });
      await c.create(name('a'), { displayOrder: 900001 });
      expect(ours(await c.list(), c).map(c.nameOf)).toEqual([name('a'), name('b')]);
    } else {
      await c.create(name('first'));
      await sleep(15);
      await c.create(name('second'));
      expect(ours(await c.list(), c).map(c.nameOf)).toEqual([name('second'), name('first')]);
    }
  });
});

describe('prompt template lookups', () => {
  it('getPromptTemplate and getActivePromptTemplate find by name', async () => {
    const created = await storage.createPromptTemplate({ name: name('lookup'), content: 'c' } as any);
    expect((await storage.getPromptTemplate(name('lookup')))?.id).toBe(created.id);
    expect((await storage.getActivePromptTemplate(name('lookup')))?.id).toBe(created.id);
    await storage.updatePromptTemplate(created.id, { active: 0 } as any);
    expect(await storage.getActivePromptTemplate(name('lookup'))).toBeUndefined();
  });
});
