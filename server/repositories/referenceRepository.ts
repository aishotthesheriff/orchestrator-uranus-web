import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool, withTransaction } from '../db';
import { BaseRepository } from './baseRepository';
import { getContentTableSpec } from '../reference/contentTables';


export class ReferenceRepository extends BaseRepository {
  async createReferenceRelease(release: InsertReferenceRelease): Promise<ReferenceRelease> {
    const result = await this.query(
      `INSERT INTO reference_releases (version, published_by, notes, is_current)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        release.version,
        release.published_by,
        release.notes || null,
        release.is_current ?? 0,
      ]
    );
    return this.mapReferenceRelease(result.rows[0])!;
  }

  async getReferenceRelease(version: string): Promise<ReferenceRelease | undefined> {
    const result = await this.query('SELECT * FROM reference_releases WHERE version = $1', [version]);
    return this.mapReferenceRelease(result.rows[0]);
  }

  async getCurrentReferenceRelease(): Promise<ReferenceRelease | undefined> {
    const result = await this.query('SELECT * FROM reference_releases WHERE is_current = 1');
    return this.mapReferenceRelease(result.rows[0]);
  }

  async getAllReferenceReleases(): Promise<ReferenceRelease[]> {
    const result = await this.query('SELECT * FROM reference_releases ORDER BY published_at DESC');
    return result.rows.map(row => this.mapReferenceRelease(row)!);
  }

  async updateReferenceRelease(version: string, updates: Partial<InsertReferenceRelease>): Promise<ReferenceRelease> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.published_by !== undefined) {
      updateFields.push(`published_by = $${paramIndex++}`);
      values.push(updates.published_by);
    }
    if (updates.notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      values.push(updates.notes);
    }
    if (updates.is_current !== undefined) {
      updateFields.push(`is_current = $${paramIndex++}`);
      values.push(updates.is_current);
    }
  
    if (updateFields.length === 0) {
      const existing = await this.getReferenceRelease(version);
      if (!existing) throw new Error(`Reference release ${version} not found`);
      return existing;
    }
  
    values.push(version);
    const result = await this.query(
      `UPDATE reference_releases SET ${updateFields.join(', ')} WHERE version = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapReferenceRelease(result.rows[0])!;
  }

  async setCurrentReferenceRelease(version: string): Promise<void> {
    await withTransaction(async client => {
      const existing = await client.query('SELECT version FROM reference_releases WHERE version = $1 FOR UPDATE', [version]);
      if (!existing.rows[0]) {
        throw new Error(`Reference release ${version} not found`);
      }
  
      await client.query('UPDATE reference_releases SET is_current = 0 WHERE is_current = 1');
      await client.query('UPDATE reference_releases SET is_current = 1 WHERE version = $1', [version]);
    });
  }

  async dumpContentTable(table: string): Promise<Record<string, unknown>[]> {
    // The table name is interpolated, so it must come from the fixed list.
    const spec = getContentTableSpec(table);
    const result = await this.query(`SELECT * FROM ${spec.table}`);
    // Sorted here, not in SQL, so the order is the same on every database and collation.
    const key = (row: Record<string, unknown>) => String(row[spec.primaryKey]);
    return [...result.rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
}

/** The ReferenceRepository methods the storage facade exposes. */
export interface IReferenceRepository extends Pick<ReferenceRepository,
  | 'createReferenceRelease'
  | 'getReferenceRelease'
  | 'getCurrentReferenceRelease'
  | 'getAllReferenceReleases'
  | 'updateReferenceRelease'
  | 'setCurrentReferenceRelease'
  | 'dumpContentTable'
> {}
