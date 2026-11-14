/**
 * Small SQL helpers shared by the repositories.
 *
 * Table and column names come only from constant field maps in this folder, never from
 * input, so building them into SQL text is safe. Values always go in as parameters.
 */

/** How a field is stored when it holds JSON. 'nullable' stores a falsy value as NULL. */
export type JsonMode = 'always' | 'nullable';

export interface FieldSpec {
  column: string;
  json?: JsonMode;
  /** Turns the input value into the stored value on create only (defaults such as `?? 1`). */
  onCreate?: (value: unknown) => unknown;
}

/** One entry per insert field. A new schema field fails to compile until it is mapped. */
export type FieldMap<TInsert> = { [K in keyof Required<TInsert>]-?: FieldSpec };

/** Reads a JSON column: the driver may hand back a string or an already parsed value. */
export function parseJsonColumn(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/** Turns a value into what is written to its column. */
export function encodeField(spec: FieldSpec, value: unknown): unknown {
  if (spec.json === 'always') return JSON.stringify(value);
  if (spec.json === 'nullable') return value ? JSON.stringify(value) : null;
  return value;
}

/**
 * Builds the SET list of an UPDATE from the fields present in `patch`.
 * `updated_at = NOW(3)` is always added, so an empty patch still touches the row.
 * Placeholders start at `$startIndex`; `nextIndex` is the first one not used.
 */
export function buildUpdateSet<TInsert>(
  patch: Partial<TInsert>,
  fields: FieldMap<TInsert>,
  startIndex = 1,
): { sql: string; values: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const values: unknown[] = [];
  let index = startIndex;
  for (const key of Object.keys(fields) as (keyof TInsert)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const spec = fields[key];
    parts.push(`${spec.column} = $${index++}`);
    values.push(encodeField(spec, value));
  }
  parts.push('updated_at = NOW(3)');
  return { sql: parts.join(', '), values, nextIndex: index };
}
