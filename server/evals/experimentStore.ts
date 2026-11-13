/**
 * Local record of eval experiments (table eval_experiments). LangSmith holds the runs
 * and scores; this keeps what Dev Tools needs to list and compare experiments.
 */

import { randomUUID } from "crypto";
import { pool } from "../db";
import type { StructuralVerdict } from "../pce/verdict";
import type { EvalScore } from "./evaluators";

export interface ExperimentRow {
  scenarioId: string;
  scenario: string;
  verdict: StructuralVerdict;
  turnMs: number;
  costUsd: number | null;
  scores: EvalScore[];
  /** Set when the turn itself could not be run. */
  error?: string;
}

export interface ExperimentSummary {
  /** Mean of each score across scenarios. */
  scores: Record<string, { mean: number | null; n: number }>;
  verdicts: Record<StructuralVerdict, number>;
  turnMsMean: number | null;
  /** Total model cost of the scored turns (judge calls not included). Null if the model has no price. */
  costUsd: number | null;
  rows: ExperimentRow[];
}

export interface EvalExperiment {
  id: string;
  name: string | null;
  status: "running" | "completed" | "failed";
  model: string;
  modelKey: string | null;
  promptSource: "reference" | "database";
  releaseVersion: string | null;
  scenarioTag: string | null;
  judges: string[];
  judgeModel: string | null;
  exampleCount: number | null;
  summary: ExperimentSummary | null;
  langsmithUrl: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

function mapRow(row: any): EvalExperiment {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    model: row.model,
    modelKey: row.model_key,
    promptSource: row.prompt_source,
    releaseVersion: row.release_version,
    scenarioTag: row.scenario_tag,
    judges: row.judges ?? [],
    judgeModel: row.judge_model,
    exampleCount: row.example_count,
    summary: row.summary ?? null,
    langsmithUrl: row.langsmith_url,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

export async function createExperiment(input: {
  model: string;
  modelKey: string | null;
  promptSource: "reference" | "database";
  releaseVersion: string | null;
  scenarioTag: string | null;
  judges: string[];
  judgeModel: string | null;
  exampleCount: number;
}): Promise<EvalExperiment> {
  const result = await pool.query(
    `INSERT INTO eval_experiments
       (id, status, model, model_key, prompt_source, release_version, scenario_tag, judges, judge_model, example_count)
     VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      randomUUID(),
      input.model,
      input.modelKey,
      input.promptSource,
      input.releaseVersion,
      input.scenarioTag,
      JSON.stringify(input.judges),
      input.judgeModel,
      input.exampleCount
    ]
  );
  return mapRow(result.rows[0]);
}

export async function finishExperiment(
  id: string,
  update: { name?: string | null; summary?: ExperimentSummary | null; langsmithUrl?: string | null; error?: string | null }
): Promise<EvalExperiment> {
  const result = await pool.query(
    `UPDATE eval_experiments
        SET status = $2, name = COALESCE($3, name), summary = $4, langsmith_url = $5, error = $6, completed_at = NOW(3)
      WHERE id = $1
      RETURNING *`,
    [
      id,
      update.error ? "failed" : "completed",
      update.name ?? null,
      update.summary ? JSON.stringify(update.summary) : null,
      update.langsmithUrl ?? null,
      update.error ?? null
    ]
  );
  return mapRow(result.rows[0]);
}

export async function listExperiments(limit = 30): Promise<EvalExperiment[]> {
  const result = await pool.query("SELECT * FROM eval_experiments ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows.map(mapRow);
}

export async function getExperiment(id: string): Promise<EvalExperiment | null> {
  const result = await pool.query("SELECT * FROM eval_experiments WHERE id = $1", [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/** An experiment still marked running when the server starts was cut off by a restart. */
export async function failInterruptedExperiments(): Promise<number> {
  const result = await pool.query(
    `UPDATE eval_experiments
        SET status = 'failed', error = 'Interrupted by a server restart', completed_at = NOW(3)
      WHERE status = 'running'`
  );
  return result.rowCount ?? 0;
}
