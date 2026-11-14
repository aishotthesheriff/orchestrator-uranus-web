import type { User, GameState, GameStats, NPC, Turn, ActionChip, Segment, PromptTemplate, Event, ItemRow, NpcTemplate, ImagePrompt, InterviewQuestion, GeneratedImage, ReferenceRelease, LlmLog, ImageJob, TurnJob, PceTestScenario, PceTestRun, PceTestMetrics, PceTemplateVersion } from '@shared/schema';
import { pool, type Queryable } from '../db';

export abstract class BaseRepository {
  /** For methods that open their own connection or transaction. */
  protected readonly pool = pool;

  /** Plain queries run here: the pool, or a transaction's client after withDb(). */
  constructor(protected readonly db: Queryable = pool) {}

  /** A copy of this repository whose plain queries run on `client` (for withTransaction). */
  withDb(client: Queryable): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { db: client });
  }

  protected query<Row = any>(sql: string, params?: readonly unknown[]) {
    return this.db.query<Row>(sql, params);
  }

  protected mapUser(row: any): User | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      password: row.password,
      theme: row.theme,
      style: row.style,
      imageModelKey: row.image_model_key ?? row.imageModelKey ?? null,
      llmModelKey: row.llm_model_key ?? row.llmModelKey ?? null,
      skipImageCache: row.skip_image_cache ?? null,
      typewriterEnabled: row.typewriter_enabled ?? null,
    };
  }

  protected mapGameRow(row: any): GameState | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      seed: row.seed,
      day: row.day,
      turnNumber: row.turn_number,
      segment: row.segment as Segment,
      absurdity: row.absurdity,
      stats: row.stats as GameStats,
      npcs: row.npcs as NPC[],
      equippedItems: row.equipped_items as string[],
      turns: row.turns as Turn[],
      currentActions: row.current_actions as ActionChip[],
      runningGags: row.running_gags as string[],
      eventHistory: row.event_history as string[],
      interviewResponses: (row.interview_responses as Record<string, string>) || {},
      isComplete: Number(row.is_complete) === 1,
      failureReason: row.failure_reason || undefined,
    };
  }







  protected mapGeneratedImage(row: any): GeneratedImage | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      templateName: row.template_name,
      promptHash: row.prompt_hash,
      variablesHash: row.variables_hash,
      filePath: row.file_path,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      sceneFingerprint: typeof row.scene_fingerprint === 'string' ? JSON.parse(row.scene_fingerprint) : row.scene_fingerprint,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      promptSource: row.prompt_source,
      promptText: row.prompt_text,
    };
  }

  protected mapReferenceRelease(row: any): ReferenceRelease | undefined {
    if (!row) return undefined;
    // Note: ReferenceRelease schema uses snake_case for some fields
    return {
      version: row.version,
      published_by: row.published_by,
      notes: row.notes,
      published_at: row.published_at,
      is_current: row.is_current,
    };
  }

  protected mapLlmLog(row: any): LlmLog | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      promptTemplateId: row.prompt_template_id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      functionName: row.function_name,
      prompt: row.prompt,
      response: row.response,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
    };
  }

  protected mapImageJob(row: any): ImageJob | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      gameId: row.game_id,
      turnNumber: row.turn_number,
      templateName: row.template_name,
      status: row.status,
      imageUrl: row.image_url,
      imageTemplate: row.image_template,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  protected mapTurnJob(row: any): TurnJob | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      gameId: row.game_id,
      actionPayload: typeof row.action_payload === 'string' ? JSON.parse(row.action_payload) : row.action_payload,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  protected mapPceTestScenario(row: any): PceTestScenario | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      gameStateJson: row.game_state_json,
      playerAction: row.player_action,
      checksJson: row.checks_json ?? undefined,
      triggeredEventJson: row.triggered_event_json ?? undefined,
      theme: row.theme ?? undefined,
      style: row.style ?? undefined,
      imageModelKey: row.image_model_key ?? undefined,
      tags: row.tags ?? undefined,
      isPreset: row.is_preset === 1 || row.is_preset === true,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected mapPceTestRun(row: any): PceTestRun | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      scenarioId: row.scenario_id,
      releaseVersion: row.release_version ?? undefined,
      templateMasterId: row.template_master_id ?? undefined,
      templateNarrativeId: row.template_narrative_id ?? undefined,
      templateImageId: row.template_image_id ?? undefined,
      templateActionsId: row.template_actions_id ?? undefined,
      status: row.status,
      stageResultsJson: row.stage_results_json,
      executedAt: row.executed_at,
      durationMs: row.duration_ms ?? undefined,
      totalTokensPrompt: row.total_tokens_prompt ?? undefined,
      totalTokensResponse: row.total_tokens_response ?? undefined,
      estimatedCostUsd: row.estimated_cost_usd ?? undefined,
      notes: row.notes ?? undefined,
      tags: row.tags ?? undefined,
      starred: row.starred === 1 || row.starred === true,
    };
  }

  protected mapPceTestMetrics(row: any): PceTestMetrics | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      testRunId: row.test_run_id,
      overallScore: row.overall_score,
      coherenceScore: row.coherence_score ?? undefined,
      thematicScore: row.thematic_score ?? undefined,
      varietyScore: row.variety_score ?? undefined,
      technicalScore: row.technical_score ?? undefined,
      playerImpactScore: row.player_impact_score ?? undefined,
      coherenceAnalysisJson: row.coherence_analysis_json ?? undefined,
      thematicAnalysisJson: row.thematic_analysis_json ?? undefined,
      varietyAnalysisJson: row.variety_analysis_json ?? undefined,
      technicalAnalysisJson: row.technical_analysis_json ?? undefined,
      playerImpactAnalysisJson: row.player_impact_analysis_json ?? undefined,
      computedAt: row.computed_at,
      computationDurationMs: row.computation_duration_ms ?? undefined,
    };
  }

  protected mapPceTemplateVersion(row: any): PceTemplateVersion | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      promptId: row.prompt_id,
      versionNumber: row.version_number,
      releaseVersion: row.release_version ?? undefined,
      systemContent: row.system_content ?? undefined,
      content: row.content ?? undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      notes: row.notes ?? undefined,
    };
  }
}
