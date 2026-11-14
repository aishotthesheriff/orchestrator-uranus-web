import { randomUUID } from 'crypto';
import { BaseRepository } from '../baseRepository';
import { buildUpdateSet, encodeField, parseJsonColumn, type FieldMap } from '../sql';
import type { Queryable } from '../../db';

export interface ContentTableConfig<TInsert> {
  table: string;
  fields: FieldMap<TInsert>;
  orderBy: string;
}

/**
 * CRUD for one content table (events, items, npc_templates, image_prompts,
 * interview_questions, prompt_templates). Rows come back as `id`, every mapped field,
 * `createdAt` and `updatedAt`.
 */
export class ContentRepository<TRow, TInsert> extends BaseRepository {
  constructor(protected readonly config: ContentTableConfig<TInsert>, db?: Queryable) {
    super(db);
  }

  protected mapRow(row: any): TRow | undefined {
    if (!row) return undefined;
    const out: Record<string, unknown> = { id: row.id };
    for (const [key, spec] of Object.entries(this.config.fields) as [string, FieldMap<TInsert>[keyof TInsert]][]) {
      const value = row[spec.column];
      out[key] = spec.json ? parseJsonColumn(value) : value;
    }
    out.createdAt = row.created_at;
    out.updatedAt = row.updated_at;
    return out as TRow;
  }

  protected mapRows(rows: any[]): TRow[] {
    return rows.map((row) => this.mapRow(row)!);
  }

  async list(): Promise<TRow[]> {
    const { table, orderBy } = this.config;
    const result = await this.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    return this.mapRows(result.rows);
  }

  async listActive(): Promise<TRow[]> {
    const { table, orderBy } = this.config;
    const result = await this.query(`SELECT * FROM ${table} WHERE active = 1 ORDER BY ${orderBy}`);
    return this.mapRows(result.rows);
  }

  async getById(id: string): Promise<TRow | undefined> {
    const result = await this.query(`SELECT * FROM ${this.config.table} WHERE id = $1`, [id]);
    return this.mapRow(result.rows[0]);
  }

  async create(input: TInsert): Promise<TRow> {
    const entries = Object.entries(this.config.fields) as [keyof TInsert, FieldMap<TInsert>[keyof TInsert]][];
    const columns = ['id', ...entries.map(([, spec]) => spec.column)];
    const values = [
      randomUUID(),
      ...entries.map(([key, spec]) => {
        const raw = spec.onCreate ? spec.onCreate(input[key]) : input[key];
        return encodeField(spec, raw);
      }),
    ];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.query(
      `INSERT INTO ${this.config.table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return this.mapRow(result.rows[0])!;
  }

  async update(id: string, patch: Partial<TInsert>): Promise<TRow> {
    const set = buildUpdateSet(patch, this.config.fields);
    const result = await this.query(
      `UPDATE ${this.config.table} SET ${set.sql} WHERE id = $${set.nextIndex} RETURNING *`,
      [...set.values, id],
    );
    return this.mapRow(result.rows[0])!;
  }
}
