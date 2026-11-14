import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool, type DbClient } from '../db';
import { BaseRepository } from './baseRepository';
import { JobService } from '../orchestrator/jobService';
const DISABLE_ORCHESTRATOR_ENQUEUE = process.env.DISABLE_ORCHESTRATOR_ENQUEUE === 'true' || process.env.NODE_ENV === 'test';

export class JobRepository extends BaseRepository {
  private readonly jobService = new JobService();

  async createImageJob(job: InsertImageJob, traceId?: string, requestId?: string, client?: DbClient): Promise<ImageJob> {
    const row = await this.jobService.createImageJob(job, {
      traceId,
      requestId,
      enqueue: !DISABLE_ORCHESTRATOR_ENQUEUE,
      client,
    });
    return this.mapImageJob(row)!;
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

  async createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string, client?: DbClient): Promise<TurnJob> {
    const row = await this.jobService.createTurnJob(job, {
      traceId,
      requestId,
      enqueue: !DISABLE_ORCHESTRATOR_ENQUEUE,
      client,
    });
    return this.mapTurnJob(row)!;
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
