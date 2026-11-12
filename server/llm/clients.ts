import OpenAI from "openai";

/**
 * One place that knows how to reach each text-model provider.
 * Used by the story pipeline, the PCE Inspector and the Dev Tools tester alike.
 *
 * - openai:      OpenAI API (AI_INTEGRATIONS_OPENAI_* env, falling back to OPENAI_API_KEY)
 * - huggingface: Hugging Face Inference Providers router (OpenAI-compatible), HF_TOKEN.
 *                A model id may carry a provider suffix, e.g. "meta-llama/Llama-3.1-8B-Instruct:groq".
 */

export type LlmProvider = "openai" | "huggingface";

export const LLM_PROVIDERS: readonly LlmProvider[] = ["openai", "huggingface"];

export const HF_ROUTER_BASE_URL = "https://router.huggingface.co/v1";

/** Per-request ceiling. The SDK default is 10 minutes, far longer than a turn should wait. */
export const LLM_REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 90_000);

/** The provider is not configured on this server (missing key). */
export class LlmConfigError extends Error {
  readonly status = 400;
}

const clients = new Map<LlmProvider, OpenAI>();

export function getLlmClient(provider: LlmProvider): OpenAI {
  const cached = clients.get(provider);
  if (cached) return cached;

  let client: OpenAI;
  if (provider === "huggingface") {
    const token = process.env.HF_TOKEN;
    if (!token) throw new LlmConfigError("HF_TOKEN is not set in the server environment");
    client = new OpenAI({ baseURL: HF_ROUTER_BASE_URL, apiKey: token, timeout: LLM_REQUEST_TIMEOUT_MS });
  } else {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new LlmConfigError("No OpenAI API key is set in the server environment");
    client = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
      apiKey,
      timeout: LLM_REQUEST_TIMEOUT_MS,
    });
  }
  clients.set(provider, client);
  return client;
}

/** OpenAI's newer models only accept max_completion_tokens; the HF router expects max_tokens. */
export function maxTokensParam(provider: LlmProvider): "max_completion_tokens" | "max_tokens" {
  return provider === "openai" ? "max_completion_tokens" : "max_tokens";
}

/** What was being called when a provider request failed. */
export interface LlmCallInfo {
  model: string;
  modelKey: string | null;
  provider: string;
  maxTokens?: number;
}

const LLM_CALL_INFO = Symbol("llmCallInfo");

/** Mark an error as coming from a provider call, so callers can tell it from a bug in our own code. */
export function tagLlmCallError(error: unknown, info: LlmCallInfo): void {
  if (error && typeof error === "object") (error as any)[LLM_CALL_INFO] = info;
}

/**
 * Stage-metadata fields for an error thrown by a provider call: which model was being
 * called, and `providerError: true`. Empty for any other error.
 */
export function llmCallErrorInfo(error: unknown): Partial<LlmCallInfo> & { providerError?: true } {
  const info: LlmCallInfo | undefined = error && typeof error === "object" ? (error as any)[LLM_CALL_INFO] : undefined;
  return info ? { ...info, providerError: true } : {};
}

/** Normalise an SDK/upstream error into a status and a readable message. */
export function describeLlmError(error: unknown): { status: number | null; message: string } {
  if (error instanceof LlmConfigError) return { status: error.status, message: error.message };
  const anyErr = error as any;
  const status: number | null = typeof anyErr?.status === "number" ? anyErr.status : null;
  let message: string = anyErr?.error?.message || anyErr?.message || String(error);
  if (status === 404 || /not supported|does not exist|not found/i.test(message)) {
    message += " — the model may not exist, or (Hugging Face) no Inference Provider you have enabled serves it.";
  }
  return { status, message };
}
