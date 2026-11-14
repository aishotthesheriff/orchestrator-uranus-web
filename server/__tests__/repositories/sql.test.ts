/** No-database tests for the repository SQL helpers and the content field maps. */
import { describe, it, expect } from 'vitest';
import { buildUpdateSet, encodeField, parseJsonColumn, type FieldMap } from '../../repositories/sql';
import { CONTENT_CONFIGS } from '../../repositories/content/contentFieldMaps';
import { getContentTableSpec } from '../../reference/contentTables';

type T = { a: string; b: string[]; c: string[] | null; d: number };
const fields: FieldMap<T> = {
  a: { column: 'col_a' },
  b: { column: 'col_b', json: 'always' },
  c: { column: 'col_c', json: 'nullable' },
  d: { column: 'col_d' },
};

describe('buildUpdateSet', () => {
  it('numbers placeholders in field order and adds updated_at', () => {
    const set = buildUpdateSet<T>({ d: 4, a: 'x' }, fields);
    expect(set.sql).toBe('col_a = $1, col_d = $2, updated_at = NOW(3)');
    expect(set.values).toEqual(['x', 4]);
    expect(set.nextIndex).toBe(3);
  });

  it('starts at a given index', () => {
    const set = buildUpdateSet<T>({ a: 'x' }, fields, 5);
    expect(set.sql).toBe('col_a = $5, updated_at = NOW(3)');
    expect(set.nextIndex).toBe(6);
  });

  it('an empty patch only sets updated_at', () => {
    expect(buildUpdateSet<T>({}, fields)).toEqual({ sql: 'updated_at = NOW(3)', values: [], nextIndex: 1 });
  });

  it('encodes both JSON modes', () => {
    expect(buildUpdateSet<T>({ b: ['1'], c: null }, fields).values).toEqual(['["1"]', null]);
    expect(buildUpdateSet<T>({ c: ['z'] }, fields).values).toEqual(['["z"]']);
  });
});

describe('encodeField and parseJsonColumn', () => {
  it('nullable JSON stores falsy values as NULL', () => {
    expect(encodeField({ column: 'x', json: 'nullable' }, undefined)).toBeNull();
    expect(encodeField({ column: 'x', json: 'always' }, [])).toBe('[]');
  });
  it('parses strings and passes parsed values through', () => {
    expect(parseJsonColumn('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonColumn({ a: 1 })).toEqual({ a: 1 });
    expect(parseJsonColumn(null)).toBeNull();
  });
});

describe('content field maps', () => {
  it.each(CONTENT_CONFIGS.map((c) => [c.table, c] as const))('%s JSON columns match the release spec', (table, config) => {
    const mapped = Object.values(config.fields as Record<string, { column: string; json?: string }>)
      .filter((f) => f.json)
      .map((f) => f.column)
      .sort();
    expect(mapped).toEqual([...getContentTableSpec(table).jsonColumns].sort());
  });
});
