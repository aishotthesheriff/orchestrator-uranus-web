/**
 * The single place a story-pipeline prompt is sent to a model, and the single place a
 * model call is written to the LLM log. Used by the pipeline stages (server/pce/graph),
 * the PCE Inspector and the Dev Tools tester.
 */

import { storage } from "../storage.js";
import { getSocketIO } from "../socketManager.js";
import { generatePromptHash } from "../cacheUtils.js";
import { getTemplateLoadMetrics } from "../pce/promptBuilder.js";
import type { PromptStage, StageMetadata } from "../pce/contentRouter.js";
import { llmCallDuration } from "../metrics.js";
import { currentTraceRef } from "../observability/langsmith.js";
import { describeLlmError, getLlmClient, maxTokensParam, tagLlmCallError } from "./clients.js";
import { recoverStageOutput } from "./json.js";
import { BUILTIN_LLM_MODEL, adhocLlmModel, requestModelId, type ResolvedLlmModel } from "./models.js";

let lastTemplateLoadCountLogged = 0;

export async function logLlmCall(
  functionName: string,
  prompt: string,
  response: string,
  metadata: any = {},
  executionTimeMs: number,
  gameId?: string,
  turnNumber?: number
) {
  try {
    const baseMetadata =
      metadata && typeof metadata === "object" ? { ...metadata } : {};
    // Lets Dev Tools link a log row to its trace. Absent when tracing is off.
    const traceRef = currentTraceRef();
    if (traceRef && !baseMetadata.langsmith) {
      baseMetadata.langsmith = traceRef;
    }
    const templateMetricsSnapshot = getTemplateLoadMetrics();
    let metadataWithMetrics = baseMetadata;

    if (templateMetricsSnapshot.totalLoads > lastTemplateLoadCountLogged) {
      metadataWithMetrics = {
        ...baseMetadata,
        templateLoadMetrics: {
          cacheHits: templateMetricsSnapshot.cacheHits,
          cacheMisses: templateMetricsSnapshot.cacheMisses,
          totalLoads: templateMetricsSnapshot.totalLoads,
          lastLoadDurationMs: templateMetricsSnapshot.lastLoadDurationMs,
          lastLoadTimestamp: templateMetricsSnapshot.lastLoadTimestamp,
          lastLoadWasCacheHit: templateMetricsSnapshot.lastLoadWasCacheHit
        }
      };
      lastTemplateLoadCountLogged = templateMetricsSnapshot.totalLoads;
    }

    // Always log to database
    await storage.createLlmLog({
      functionName,
      prompt,
      response,
      metadata: metadataWithMetrics,
      executionTimeMs,
      gameId: gameId || null,
      turnNumber: turnNumber || null,
      promptTemplateId: null,
    });
    
    // Conditionally emit log data to browser console via Socket.IO (if CONSOLE_LLM_LOG is enabled)
    if (process.env.CONSOLE_LLM_LOG === 'true') {
      const io = getSocketIO();
      if (io) {
        const logData = {
          functionName,
          prompt,
          response,
          metadata: metadataWithMetrics,
          executionTimeMs,
          gameId: gameId || null,
          turnNumber: turnNumber || null,
          timestamp: new Date().toISOString(),
        };
        // Prompts and replies are one player's story: send them to that game's room only
        // (members are checked in server/socketAuth.ts). Calls with no game are not sent.
        if (gameId) {
          io.to(gameId).emit('llmLog', logData);
        }
      }
    }
  } catch (error) {
    console.error("Error logging LLM call:", error);
  }
}

export interface PromptExecutionOptions {
  stage: PromptStage;
  template: string;
  systemPrompt?: string;  // NEW: system prompt
  userPrompt?: string;    // NEW: user prompt
  prompt?: string;         // DEPRECATED: single prompt (backward compat)
  /** Story model to call. Defaults to the built-in model. */
  llm?: ResolvedLlmModel;
  model?: string;          // DEPRECATED: bare OpenAI model name; prefer `llm`
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  metadata?: Record<string, unknown>;
  gameId?: string;
  turnNumber?: number;
  logName?: string;
}

export async function executeJsonPrompt(
  promptOrOptions: string | PromptExecutionOptions,
  options?: PromptExecutionOptions
): Promise<{ rawContent: string; metadata: StageMetadata }> {
  // Handle both old (string) and new (options) signatures
  let opts: PromptExecutionOptions;
  if (typeof promptOrOptions === "string") {
    // Legacy: single prompt string
    opts = { ...options!, prompt: promptOrOptions };
  } else {
    opts = promptOrOptions;
  }

  // Story model: an explicit catalog/ad-hoc model wins; a bare `model` name is treated as
  // an OpenAI model (legacy callers); otherwise the built-in default.
  const llm: ResolvedLlmModel = opts.llm
    ?? (opts.model ? adhocLlmModel({ provider: "openai", modelName: opts.model }) : BUILTIN_LLM_MODEL);
  const model = requestModelId(llm);
  const startTime = Date.now();

  // Build messages array
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  // System prompt (required)
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  } else if (opts.prompt) {
    // Backward compatibility: use prompt as system message
    messages.push({ role: "system", content: opts.prompt });
  } else {
    throw new Error("Either systemPrompt or prompt must be provided");
  }

  // User prompt (optional - only add if provided and not empty)
  if (opts.userPrompt && opts.userPrompt.trim()) {
    messages.push({ role: "user", content: opts.userPrompt });
  }

  // A catalog entry may raise the output limit (reasoning models spend tokens before answering).
  const maxTokens = Math.max(opts.maxTokens ?? 600, llm.params.maxTokens ?? 0);
  const requestParams: any = {
    model,
    messages,
    [maxTokensParam(llm.provider)]: maxTokens
  };
  // Models without a JSON mode reject response_format; they rely on the prompt alone.
  if (llm.supportsJsonMode) {
    requestParams.response_format = { type: "json_object" };
  }

  // Apply optional request parameter overrides
  const temperature = opts.temperature ?? llm.params.temperature;
  if (temperature !== undefined) {
    requestParams.temperature = temperature;
  }
  if (opts.topP !== undefined) {
    requestParams.top_p = opts.topP;
  }
  if (opts.frequencyPenalty !== undefined) {
    requestParams.frequency_penalty = opts.frequencyPenalty;
  }
  if (opts.presencePenalty !== undefined) {
    requestParams.presence_penalty = opts.presencePenalty;
  }

  // Instrument LLM call duration
  const llmTimer = llmCallDuration.startTimer({
    model,
    stage: opts.stage || "unknown",
    cache: "na" // PCE stages don't use cache yet
  });

  // Build full prompt string for logging
  const fullPrompt = opts.userPrompt
    ? `SYSTEM:\n${opts.systemPrompt || opts.prompt}\n\nUSER:\n${opts.userPrompt}`
    : opts.systemPrompt || opts.prompt || "";
  const logName = opts.logName ?? `pce.${opts.stage}`;
  const modelInfo = { model, modelKey: llm.key, provider: llm.provider };
  const promptHash = generatePromptHash(fullPrompt);
  const templateInfo = {
    templateHash: typeof opts.metadata?.templateHash === "string" ? opts.metadata.templateHash : undefined,
    templateSource: opts.metadata?.templateSource as StageMetadata["templateSource"]
  };

  try {
    const response: any = await getLlmClient(llm.provider).chat.completions.create(requestParams);
    llmTimer();

    const choice = response.choices?.[0];
    const content: string = choice?.message?.content?.trim() ?? "";
    const finishReason: string | null = choice?.finish_reason ?? null;
    // Measured on what the model actually returned, before the empty-response substitution.
    const jsonQuality = recoverStageOutput(content, { stage: opts.stage, finishReason }).quality;
    const emptyResponse = content.length === 0;
    const rawContent = content || "{}";
    const executionTime = Date.now() - startTime;
    const timestamp = new Date().toISOString();
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens ?? null,
          completionTokens: response.usage.completion_tokens ?? null
        }
      : undefined;

    await logLlmCall(
      logName,
      fullPrompt,
      rawContent,
      {
        ...modelInfo,
        stage: opts.stage,
        template: opts.template,
        usage,
        finishReason,
        jsonQuality,
        ...opts.metadata
      },
      executionTime,
      opts.gameId,
      opts.turnNumber
    );

    const metadata: StageMetadata = {
      stage: opts.stage,
      template: opts.template,
      ...modelInfo,
      prompt: fullPrompt,
      promptHash,
      ...templateInfo,
      rawResponse: rawContent,
      durationMs: executionTime,
      timestamp,
      usage,
      finishReason,
      maxTokens,
      ...(emptyResponse ? { emptyResponse: true } : {}),
      jsonQuality,
      extras: opts.metadata
    };

    return { rawContent, metadata };
  } catch (error) {
    llmTimer(); // Record duration even on error
    // Lets the stage runner record which model failed, and the router fall back.
    tagLlmCallError(error, { ...modelInfo, maxTokens });
    // Record the failed call too, so a model that errors is visible in LLM Logs.
    const { status, message } = describeLlmError(error);
    await logLlmCall(
      logName,
      fullPrompt,
      `ERROR: ${message}`,
      { ...modelInfo, stage: opts.stage, template: opts.template, error: message, upstreamStatus: status, ...opts.metadata },
      Date.now() - startTime,
      opts.gameId,
      opts.turnNumber
    ).catch(() => undefined);
    throw error;
  }
}
