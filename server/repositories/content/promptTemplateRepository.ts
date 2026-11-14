import type { PromptTemplate, InsertPromptTemplate } from '@shared/schema';
import type { Queryable } from '../../db';
import { ContentRepository } from './contentRepository';
import { PROMPT_TEMPLATES } from './contentFieldMaps';

/** Prompt templates are content rows that are also looked up by name. */
export class PromptTemplateRepository extends ContentRepository<PromptTemplate, InsertPromptTemplate> {
  constructor(db?: Queryable) {
    super(PROMPT_TEMPLATES, db);
  }

  async getByName(name: string): Promise<PromptTemplate | undefined> {
    const result = await this.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    return this.mapRow(result.rows[0]);
  }

  async getActiveByName(name: string): Promise<PromptTemplate | undefined> {
    const result = await this.query('SELECT * FROM prompt_templates WHERE name = $1', [name]);
    const active = result.rows.find((t: any) => Number(t.active) === 1);
    return this.mapRow(active);
  }
}
