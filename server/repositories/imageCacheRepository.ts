import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';
import { randomUUID } from 'crypto';


export class ImageCacheRepository extends BaseRepository {
  async createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO generated_images (id, template_name, prompt_hash, variables_hash, file_path, file_size, mime_type, scene_fingerprint, metadata, game_id, turn_number, accessed_at, access_count, prompt_source, prompt_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        id,
        image.templateName,
        image.promptHash,
        image.variablesHash,
        image.filePath,
        image.fileSize,
        image.mimeType ?? 'image/png',
        JSON.stringify(image.sceneFingerprint),
        JSON.stringify(image.metadata),
        image.gameId || null,
        image.turnNumber || null,
        image.accessedAt || new Date(),
        image.accessCount ?? 1,
        image.promptSource ?? 'template',
        image.promptText || null,
      ]
    );
    return this.mapGeneratedImage(result.rows[0])!;
  }

  async getGeneratedImage(id: string): Promise<GeneratedImage | undefined> {
    const result = await this.query('SELECT * FROM generated_images WHERE id = $1', [id]);
    return this.mapGeneratedImage(result.rows[0]);
  }

  async getGeneratedImageByHash(promptHash: string, variablesHash: string): Promise<GeneratedImage | undefined> {
    const result = await this.query(
      'SELECT * FROM generated_images WHERE prompt_hash = $1 AND variables_hash = $2',
      [promptHash, variablesHash]
    );
    return this.mapGeneratedImage(result.rows[0]);
  }

  async getGeneratedImagesByTemplate(templateName: string): Promise<GeneratedImage[]> {
    const result = await this.query(
      'SELECT * FROM generated_images WHERE template_name = $1 ORDER BY created_at DESC',
      [templateName]
    );
    return result.rows.map(row => this.mapGeneratedImage(row)!);
  }

  async getAllGeneratedImages(): Promise<GeneratedImage[]> {
    const result = await this.query('SELECT * FROM generated_images ORDER BY created_at DESC');
    return result.rows.map(row => this.mapGeneratedImage(row)!);
  }

  async updateImageAccess(id: string): Promise<void> {
    await this.query(
      'UPDATE generated_images SET accessed_at = NOW(3), access_count = access_count + 1 WHERE id = $1',
      [id]
    );
  }

  async deleteGeneratedImage(id: string): Promise<void> {
    await this.query('DELETE FROM generated_images WHERE id = $1', [id]);
  }

  async deleteGeneratedImages(filters?: { templateName?: string; gameId?: string; before?: Date; maxAccessCount?: number }): Promise<number> {
    let query = 'DELETE FROM generated_images';
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
  
    if (filters?.templateName) {
      conditions.push(`template_name = $${paramIndex++}`);
      params.push(filters.templateName);
    }
    if (filters?.gameId) {
      conditions.push(`game_id = $${paramIndex++}`);
      params.push(filters.gameId);
    }
    if (filters?.before) {
      conditions.push(`created_at < $${paramIndex++}`);
      params.push(filters.before);
    }
    if (filters?.maxAccessCount !== undefined) {
      conditions.push(`access_count <= $${paramIndex++}`);
      params.push(filters.maxAccessCount);
    }
  
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
  
    query += ' RETURNING id';
    const result = await this.query(query, params);
    return result.rows.length;
  }

  async getImageCacheStats(): Promise<{ totalImages: number; totalSize: number; hitRate: number; averageGenerationTime: number }> {
    const [imageStats, generationStats] = await Promise.all([
      this.query(
        'SELECT COUNT(*) AS totalImages, COALESCE(SUM(file_size), 0) AS totalSize FROM generated_images',
      ),
      this.query(
        `SELECT COUNT(*) AS totalRequests,
                COALESCE(SUM(CASE
                  WHEN JSON_TYPE(JSON_EXTRACT(metadata, '$.cacheHit')) = 'BOOLEAN'
                   AND JSON_VALUE(metadata, '$.cacheHit') = 1 THEN 1
                  ELSE 0
                END), 0) AS cacheHits,
                AVG(execution_time_ms) AS averageGenerationTime
         FROM llm_logs
         WHERE function_name = 'generateImage'`,
      ),
    ]);
  
    const { totalImages, totalSize } = imageStats.rows[0];
    const { totalRequests, cacheHits, averageGenerationTime } = generationStats.rows[0];
  
    return {
      totalImages: Number(totalImages),
      totalSize: Number(totalSize),
      hitRate: Number(totalRequests) > 0 ? Number(cacheHits) / Number(totalRequests) : 0,
      averageGenerationTime: Number(averageGenerationTime ?? 0),
    };
  }
}
