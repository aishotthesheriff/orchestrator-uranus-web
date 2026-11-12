/**
 * LangSmith tracing: the one place that knows whether tracing is on and how to reach it.
 *
 * Tracing is on only when LANGSMITH_TRACING=true, an API key is set, and this is not a
 * test run. When it is off every helper here is a pass-through, so callers never branch.
 *
 * What a trace looks like for one player turn (see docs_master/current/OBSERVABILITY_AND_EVALS.md):
 *
 *   turn                      root, started by the precompute worker
 *   ├── turn.checks
 *   ├── pce                   the four-stage story pipeline
 *   ├── turn.image_plan
 *   ├── turn.apply            continued in the apply worker (headers ride in queue metadata)
 *   └── turn.image            continued in the image worker
 */

import { RunTree, type Client } from "langsmith";
import { getCurrentRunTree, traceable, withRunTree } from "langsmith/traceable";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";

type KVMap = Record<string, unknown>;

const TRACING_ENV_VARS = ["LANGSMITH_TRACING", "LANGSMITH_TRACING_V2", "LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2"];

/** Key under which trace headers travel in a queue entry's metadata. */
export const QUEUE_TRACE_KEY = "langsmith";

function decideTracing(): { enabled: boolean; reason?: string } {
  const requested = TRACING_ENV_VARS.some((name) => process.env[name] === "true");
  if (!requested) return { enabled: false, reason: "LANGSMITH_TRACING is not set to true" };
  if (process.env.NODE_ENV === "test") return { enabled: false, reason: "disabled in tests" };
  if (!process.env.LANGSMITH_API_KEY && !process.env.LANGCHAIN_API_KEY) {
    return { enabled: false, reason: "LANGSMITH_API_KEY is not set" };
  }
  return { enabled: true };
}

const decision = decideTracing();
if (!decision.enabled) {
  // The LangSmith SDK and LangChain each read these variables themselves. Clearing them
  // keeps both off together, so a half-configured environment never sends partial traces.
  for (const name of TRACING_ENV_VARS) delete process.env[name];
}

export function tracingEnabled(): boolean {
  return decision.enabled;
}

export function tracingProject(): string {
  return process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || "default";
}

export interface TracingStatus {
  enabled: boolean;
  reason?: string;
  project: string;
  endpoint: string;
  hideInputs: boolean;
  hideOutputs: boolean;
  samplingRate: number | null;
}

export function tracingStatus(): TracingStatus {
  const rate = Number(process.env.LANGSMITH_TRACING_SAMPLING_RATE);
  return {
    enabled: decision.enabled,
    reason: decision.reason,
    project: tracingProject(),
    endpoint: process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
    hideInputs: process.env.LANGSMITH_HIDE_INPUTS === "true",
    hideOutputs: process.env.LANGSMITH_HIDE_OUTPUTS === "true",
    samplingRate: process.env.LANGSMITH_TRACING_SAMPLING_RATE && Number.isFinite(rate) ? rate : null
  };
}

/** The client that `traceable`, the OpenAI wrapper and the evals all share. */
export function getLangSmithClient(): Client {
  return RunTree.getSharedClient();
}

/** IDs that locate a run in LangSmith. Stored on manifests, LLM logs and Inspector runs. */
export interface TraceRef {
  runId: string;
  traceId: string;
}

/** The run this code is executing inside, if any. */
export function currentTraceRef(): TraceRef | undefined {
  if (!decision.enabled) return undefined;
  const run = getCurrentRunTree(true);
  return run ? { runId: run.id, traceId: run.trace_id } : undefined;
}

/** The root run of the current trace: the one feedback and "Open trace" links point at. */
export function currentRootTraceRef(): TraceRef | undefined {
  const ref = currentTraceRef();
  return ref ? { runId: ref.traceId, traceId: ref.traceId } : undefined;
}

export interface SpanOptions<T> {
  /** "chain" (default), "llm", "tool", "prompt", "parser" or "retriever". */
  runType?: string;
  /** Recorded as the run's inputs. Keep it small: no full game state. */
  inputs?: KVMap;
  metadata?: KVMap;
  tags?: string[];
  /** Recorded as the run's outputs. Defaults to nothing. */
  outputs?: (result: T) => KVMap;
}

/**
 * Run `fn` as a named run, nested under whatever run is current. Inputs and outputs are
 * what the caller chooses to record, never the function's raw arguments.
 * An error thrown by `fn` marks the run as failed and is rethrown.
 */
export async function withSpan<T>(name: string, options: SpanOptions<T>, fn: () => Promise<T>): Promise<T> {
  if (!decision.enabled) return fn();

  let result!: T;
  const traced = traceable(
    async (_inputs: KVMap) => {
      result = await fn();
      return options.outputs ? options.outputs(result) : {};
    },
    {
      name,
      run_type: options.runType ?? "chain",
      metadata: options.metadata,
      tags: options.tags
    }
  );
  await traced(options.inputs ?? {});
  return result;
}

/** Add metadata to the current run after the fact (e.g. a verdict known only at the end). */
export function annotateSpan(metadata: KVMap): void {
  if (!decision.enabled) return;
  const run = getCurrentRunTree(true);
  if (run) run.metadata = { ...run.metadata, ...metadata };
}

/** Headers that let another worker continue the current trace. Undefined outside a run. */
export function traceHeaders(): Record<string, string> | undefined {
  if (!decision.enabled) return undefined;
  const run = getCurrentRunTree(true);
  return run ? { ...run.toHeaders() } : undefined;
}

/**
 * Run `fn` inside the trace described by `headers` (as produced by `traceHeaders`).
 * Without usable headers `fn` simply runs, and any span it opens starts a new trace.
 */
export async function continueTrace<T>(headers: unknown, fn: () => Promise<T>): Promise<T> {
  if (!decision.enabled || !headers || typeof headers !== "object") return fn();
  let parent: RunTree | undefined;
  try {
    parent = RunTree.fromHeaders(headers as Record<string, string>);
  } catch (error) {
    console.warn("[Tracing] Could not read trace headers; starting a new trace:", error);
  }
  return parent ? withRunTree(parent, fn) : fn();
}

export interface JobSpanOptions<T> extends SpanOptions<T> {
  /** Span name when the job starts its own trace. */
  rootName: string;
  /** Span name when the job continues a trace started by an earlier worker. */
  childName: string;
}

/**
 * Trace one queue job. If the queue entry carries trace headers the job joins that trace;
 * otherwise it starts one.
 */
export async function traceJob<T>(
  queueMetadata: Record<string, unknown> | undefined,
  options: JobSpanOptions<T>,
  fn: () => Promise<T>
): Promise<T> {
  const headers = queueMetadata?.[QUEUE_TRACE_KEY];
  const { rootName, childName, ...span } = options;
  if (decision.enabled && headers) {
    return continueTrace(headers, () => withSpan(childName, span, fn));
  }
  return withSpan(rootName, span, fn);
}

let projectIdPromise: Promise<string | undefined> | null = null;

/** ID of the project traces are written to. Needed for feedback and run links. */
export async function tracingProjectId(): Promise<string | undefined> {
  if (!decision.enabled) return undefined;
  if (!projectIdPromise) {
    projectIdPromise = getLangSmithClient()
      .readProject({ projectName: tracingProject() })
      .then((project) => project.id)
      .catch((error) => {
        // The project is created by the first trace; until then there is nothing to link to.
        projectIdPromise = null;
        console.warn("[Tracing] Could not resolve LangSmith project:", error instanceof Error ? error.message : error);
        return undefined;
      });
  }
  return projectIdPromise;
}

/** Link to a run in the LangSmith UI, or null if tracing is off or the run is unknown. */
export async function traceUrl(ref: TraceRef): Promise<string | null> {
  const projectId = await tracingProjectId();
  if (!projectId) return null;
  try {
    const response = await getLangSmithClient().runs.getURL(ref.runId, {
      project_id: projectId,
      trace_id: ref.traceId
    });
    return response.url ?? null;
  } catch (error) {
    console.warn("[Tracing] Could not build run URL:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Send everything still buffered. Call before the process exits. */
export async function flushTraces(): Promise<void> {
  if (!decision.enabled) return;
  await Promise.allSettled([getLangSmithClient().awaitPendingTraceBatches(), awaitAllCallbacks()]);
}
