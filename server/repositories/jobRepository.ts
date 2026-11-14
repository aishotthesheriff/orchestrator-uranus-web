import type { ImageJob, InsertImageJob, TurnJob, InsertTurnJob } from "@shared/schema";
import { BaseRepository } from './baseRepository';

/**
 * Plain SQL for image_jobs and turn_jobs. Creating a job together with its queue entry
 * is done by server/orchestrator/jobService.ts, which runs these inserts via withDb(client).
 */
export class JobRepository extends BaseRepository {
  /** Inserts an image job. A duplicate active job for the same turn raises a unique violation. */
  async insertImageJob(id: string, job: InsertImageJob): Promise<ImageJob> {
    const result = await this.query(
      `INSERT INTO image_jobs (id, game_id, turn_number, template_name, status, image_url, image_template, error, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        job.gameId,
        job.turnNumber,
        job.templateName,
        job.status ?? 'pending',
        job.imageUrl || null,
        job.imageTemplate || null,
        job.error || null,
        job.completedAt || null,
      ],
    );
    return this.mapImageJob(result.rows[0])!;
  }

  /** The oldest pending or processing image job for a turn, if any. */
  async getActiveImageJob(gameId: string, turnNumber: number): Promise<ImageJob | undefined> {
    const result = await this.query(
      `SELECT * FROM image_jobs
       WHERE game_id = $1 AND turn_number = $2
         AND status IN ('pending', 'processing')
       ORDER BY created_at
       LIMIT 1`,
      [gameId, turnNumber],
    );
    return this.mapImageJob(result.rows[0]);
  }

  async insertTurnJob(id: string, job: InsertTurnJob): Promise<TurnJob> {
    const result = await this.query(
      `INSERT INTO turn_jobs (id, game_id, action_payload, status, error, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        job.gameId,
        JSON.stringify(job.actionPayload),
        job.status ?? 'pending',
        job.error || null,
        job.completedAt || null,
      ],
    );
    return this.mapTurnJob(result.rows[0])!;
  }

  async getImageJob(id: string): Promise<ImageJob | undefined> {
    const result = await this.query('SELECT * FROM image_jobs WHERE id = $1', [id]);
    return this.mapImageJob(result.rows[0]);
  }

  async countPendingJobs(): Promise<{ turnJobs: number; imageJobs: number }> {
    const [turnJobs, imageJobs] = await Promise.all([
      this.query("SELECT COUNT(*) AS count FROM turn_jobs WHERE status = 'pending'"),
      this.query("SELECT COUNT(*) AS count FROM image_jobs WHERE status = 'pending'"),
    ]);
  
    return {
      turnJobs: Number(turnJobs.rows[0]?.count ?? 0),
      imageJobs: Number(imageJobs.rows[0]?.count ?? 0),
    };
  }

  async updateImageJob(id: string, updates: Partial<InsertImageJob>): Promise<ImageJob> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.gameId !== undefined) {
      updateFields.push(`game_id = $${paramIndex++}`);
      values.push(updates.gameId);
    }
    if (updates.turnNumber !== undefined) {
      updateFields.push(`turn_number = $${paramIndex++}`);
      values.push(updates.turnNumber);
    }
    if (updates.templateName !== undefined) {
      updateFields.push(`template_name = $${paramIndex++}`);
      values.push(updates.templateName);
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.imageUrl !== undefined) {
      updateFields.push(`image_url = $${paramIndex++}`);
      values.push(updates.imageUrl);
    }
    if (updates.imageTemplate !== undefined) {
      updateFields.push(`image_template = $${paramIndex++}`);
      values.push(updates.imageTemplate);
    }
    if (updates.error !== undefined) {
      updateFields.push(`error = $${paramIndex++}`);
      values.push(updates.error);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }
  
    if (updateFields.length === 0) {
      const existing = await this.getImageJob(id);
      if (!existing) throw new Error(`Image job ${id} not found`);
      return existing;
    }
  
    values.push(id);
    const result = await this.query(
      `UPDATE image_jobs SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return this.mapImageJob(result.rows[0])!;
  }

  async getTurnJob(id: string): Promise<TurnJob | undefined> {
    const result = await this.query('SELECT * FROM turn_jobs WHERE id = $1', [id]);
    return this.mapTurnJob(result.rows[0]);
  }

  async updateTurnJob(id: string, updates: Partial<InsertTurnJob>): Promise<TurnJob> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updates.gameId !== undefined) {
      updateFields.push(`game_id = $${paramIndex++}`);
      values.push(updates.gameId);
    }
    if (updates.actionPayload !== undefined) {
      updateFields.push(`action_payload = $${paramIndex++}`);
      values.push(JSON.stringify(updates.actionPayload));
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.error !== undefined) {
      updateFields.push(`error = $${paramIndex++}`);
      values.push(updates.error);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }
  
    if (updateFields.length === 0) {
      const existing = await this.getTurnJob(id);
      if (!existing) throw new Error(`Turn job ${id} not found`);
      return existing;
    }
  
    values.push(id);
    const result = await this.query(
      `UPDATE turn_jobs SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    return this.mapTurnJob(result.rows[0])!;
  }
}

/** The JobRepository methods the storage facade exposes. */
export interface IJobRepository extends Pick<JobRepository,
  | 'getImageJob'
  | 'countPendingJobs'
  | 'updateImageJob'
  | 'getTurnJob'
  | 'updateTurnJob'
> {}
