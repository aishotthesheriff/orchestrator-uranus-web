/**
 * The eval dataset: the saved PCE Inspector scenarios, mirrored into LangSmith.
 *
 * Postgres stays the source of truth. An example carries the scenario's id and the parts
 * of the request a reader needs to judge the result; the full game state is loaded from
 * Postgres by id when the experiment runs.
 */

import type { ParsedTestScenario } from "@shared/schema";
import { storage } from "../storage";
import { parseTestScenario } from "../pce/inspectorService";
import { getLangSmithClient, tracingEnabled } from "../observability/langsmith";

export const EVAL_DATASET_NAME = process.env.LANGSMITH_EVAL_DATASET || "uranus-pce-scenarios";

export interface ScenarioExampleInputs {
  scenarioId: string;
  scenario: string;
  playerAction: string;
  checks: unknown[];
  triggeredEvent: unknown | null;
  theme: string | null;
  style: string | null;
  turnNumber: number | null;
}

export function scenarioTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function exampleInputs(scenario: ParsedTestScenario): ScenarioExampleInputs {
  const turnNumber = (scenario.gameState as { turnNumber?: unknown } | null)?.turnNumber;
  return {
    scenarioId: scenario.id,
    scenario: scenario.name,
    playerAction: scenario.playerAction,
    checks: Array.isArray(scenario.checks) ? scenario.checks : [],
    triggeredEvent: scenario.triggeredEvent ?? null,
    theme: scenario.theme ?? null,
    style: scenario.style ?? null,
    turnNumber: typeof turnNumber === "number" ? turnNumber : null
  };
}

export async function loadScenarios(tag?: string | null): Promise<ParsedTestScenario[]> {
  const records = await storage.getPceTestScenarios({ limit: 500 });
  const scenarios = records.map(parseTestScenario);
  return tag ? scenarios.filter((scenario) => scenarioTags(scenario.tags).includes(tag)) : scenarios;
}

export interface DatasetSyncResult {
  dataset: string;
  total: number;
  created: number;
  updated: number;
  deleted: number;
  url: string | null;
}

function requireLangSmith(): void {
  if (!tracingEnabled()) {
    throw new Error("LangSmith is not configured on this server (set LANGSMITH_TRACING=true and LANGSMITH_API_KEY)");
  }
}

/** Make the LangSmith dataset match the saved scenarios: add new, update changed, remove deleted. */
export async function syncScenarioDataset(): Promise<DatasetSyncResult> {
  requireLangSmith();
  const client = getLangSmithClient();
  const scenarios = await loadScenarios();

  const dataset = (await client.hasDataset({ datasetName: EVAL_DATASET_NAME }))
    ? await client.readDataset({ datasetName: EVAL_DATASET_NAME })
    : await client.createDataset(EVAL_DATASET_NAME, {
        description: "Saved PCE Inspector scenarios from Quest to Uranus. Synced from the app; edit scenarios there."
      });

  const existing = new Map<string, { id: string; inputs: unknown; metadata: unknown }>();
  const orphans: string[] = [];
  for await (const example of client.listExamples({ datasetId: dataset.id })) {
    const scenarioId = (example.metadata as { scenarioId?: string } | undefined)?.scenarioId;
    if (scenarioId && !existing.has(scenarioId)) {
      existing.set(scenarioId, { id: example.id, inputs: example.inputs, metadata: example.metadata });
    } else {
      orphans.push(example.id);
    }
  }

  const toCreate: Array<{ inputs: ScenarioExampleInputs; metadata: Record<string, unknown>; dataset_id: string }> = [];
  const toUpdate: Array<{ id: string; inputs: ScenarioExampleInputs; metadata: Record<string, unknown>; dataset_id: string }> = [];
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    seen.add(scenario.id);
    const inputs = exampleInputs(scenario);
    const metadata = { scenarioId: scenario.id, tags: scenarioTags(scenario.tags), isPreset: scenario.isPreset };
    const current = existing.get(scenario.id);
    if (!current) {
      toCreate.push({ inputs, metadata, dataset_id: dataset.id });
    } else if (JSON.stringify(current.inputs) !== JSON.stringify(inputs) || !sameMetadata(current.metadata, metadata)) {
      toUpdate.push({ id: current.id, inputs, metadata, dataset_id: dataset.id });
    }
  }
  const toDelete = [...orphans, ...[...existing].filter(([scenarioId]) => !seen.has(scenarioId)).map(([, example]) => example.id)];

  if (toCreate.length) await client.createExamples(toCreate);
  if (toUpdate.length) await client.updateExamples(toUpdate);
  if (toDelete.length) await client.deleteExamples(toDelete);

  const url = await client.getDatasetUrl({ datasetId: dataset.id }).catch(() => null);
  return {
    dataset: EVAL_DATASET_NAME,
    total: scenarios.length,
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    url
  };
}

function sameMetadata(current: unknown, next: { scenarioId: string; tags: string[]; isPreset: boolean }): boolean {
  const c = (current ?? {}) as { scenarioId?: string; tags?: string[]; isPreset?: boolean };
  return c.scenarioId === next.scenarioId && c.isPreset === next.isPreset && JSON.stringify(c.tags ?? []) === JSON.stringify(next.tags);
}

/** How many examples the LangSmith dataset holds, or null if it does not exist or cannot be reached. */
export async function datasetExampleCount(): Promise<number | null> {
  if (!tracingEnabled()) return null;
  try {
    const client = getLangSmithClient();
    if (!(await client.hasDataset({ datasetName: EVAL_DATASET_NAME }))) return null;
    let count = 0;
    for await (const _ of client.listExamples({ datasetName: EVAL_DATASET_NAME })) count++;
    return count;
  } catch (error) {
    console.warn("[Evals] Could not read the LangSmith dataset:", error instanceof Error ? error.message : error);
    return null;
  }
}
