import type { LlmLog, InsertLlmLog } from '@shared/schema';
import { randomUUID } from 'crypto';
import { BaseRepository } from './baseRepository';

export class LlmLogRepository extends BaseRepository {
  async createLlmLog(log: InsertLlmLog): Promise<LlmLog> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO llm_logs (id, prompt_template_id, game_id, turn_number, function_name, prompt, response, metadata, execution_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        log.promptTemplateId || null,
        log.gameId || null,
        log.turnNumber || null,
        log.functionName,
        log.prompt,
        log.response,
        log.metadata ? JSON.stringify(log.metadata) : null,
        log.executionTimeMs || null,
      ]
    );
    return this.mapLlmLog(result.rows[0])!;
  }

  async getLlmLogs(filters?: { gameId?: string; limit?: number }): Promise<LlmLog[]> {
    const params: unknown[] = [];
    let sql = 'SELECT * FROM llm_logs';
    if (filters?.gameId) {
      params.push(filters.gameId);
      sql += ` WHERE game_id = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';
    if (typeof filters?.limit === 'number') {
      params.push(filters.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.query(sql, params);
    return result.rows.map(row => this.mapLlmLog(row)!);
  }

  async clearAllLlmLogs(): Promise<void> {
    await this.query('DELETE FROM llm_logs');
  }
}

/** The LlmLogRepository methods the storage facade exposes. */
export interface ILlmLogRepository extends Pick<LlmLogRepository,
  | 'createLlmLog'
  | 'getLlmLogs'
  | 'clearAllLlmLogs'
> {}
