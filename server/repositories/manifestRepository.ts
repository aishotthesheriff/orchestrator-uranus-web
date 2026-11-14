import type { User, InsertUser, GameState, GameSummary, PromptTemplate, InsertPromptTemplate, LlmLog, InsertLlmLog, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate, ImagePrompt, InsertImagePrompt, GeneratedImage, InsertGeneratedImage, InterviewQuestion, InsertInterviewQuestion, ReferenceRelease, InsertReferenceRelease, ImageJob, InsertImageJob, TurnJob, InsertTurnJob, AppSetting, ImageModel, LlmModel, ModVisualStyles, ModStoryThemes, GameStats, NPC, Turn, ActionChip, Segment, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from "@shared/schema";
import { pool } from '../db';
import { BaseRepository } from './baseRepository';


export class ManifestRepository extends BaseRepository {
  async getTurnExecutionManifest(
    gameId: string,
    turnNumber: number,
    attempt?: number
  ): Promise<import('@shared/schema').TurnExecutionManifests | undefined> {
    let query = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 AND turn_number = $2';
    const params: any[] = [gameId, turnNumber];
    
    if (attempt !== undefined) {
      query += ' AND attempt = $3';
      params.push(attempt);
    } else {
      query += ' ORDER BY attempt DESC LIMIT 1';
    }
  
    const result = await this.query(query, params);
    if (result.rows.length === 0) return undefined;
  
    const row = result.rows[0];
    return {
      id: row.id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      queueEntryId: row.queue_entry_id,
      attempt: row.attempt,
      version: row.version,
      manifest: row.manifest,
      manifestHash: row.manifest_hash,
      precomputeHash: row.precompute_hash,
      traceId: row.trace_id,
      requestId: row.request_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getGameManifests(
    gameId: string,
    limit?: number
  ): Promise<import('@shared/schema').TurnExecutionManifests[]> {
    let query = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 ORDER BY turn_number DESC, attempt DESC';
    const params: any[] = [gameId];
    
    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }
  
    const result = await this.query(query, params);
    
    // Deduplicate: for each turn number, keep only the latest attempt
    const seen = new Set<number>();
    const manifests: import('@shared/schema').TurnExecutionManifests[] = [];
    
    for (const row of result.rows) {
      const turnNumber = row.turn_number;
      if (!seen.has(turnNumber)) {
        seen.add(turnNumber);
        manifests.push({
          id: row.id,
          gameId: row.game_id,
          turnNumber: row.turn_number,
          queueEntryId: row.queue_entry_id,
          attempt: row.attempt,
          version: row.version,
          manifest: row.manifest,
          manifestHash: row.manifest_hash,
          precomputeHash: row.precompute_hash,
          traceId: row.trace_id,
          requestId: row.request_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
    }
    
    // Sort by turn number ascending
    return manifests.sort((a, b) => a.turnNumber - b.turnNumber);
  }
}
