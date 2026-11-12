import express from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/adminAuth";
import { logLlmCall } from "../aiService";
import { LlmConfigError, describeLlmError, getLlmClient, maxTokensParam, type LlmProvider } from "../llm/clients";

/**
 * DevTools LLM tester: send a one-off prompt to an arbitrary text model.
 * Testing only — does not change which model the game uses.
 * Providers and credentials live in server/llm/clients.ts.
 */

type Provider = LlmProvider;

const RunSchema = z.object({
  provider: z.enum(["openai", "huggingface"]),
  model: z.string().trim().min(1, "model is required"),
  systemPrompt: z.string().optional().default(""),
  userPrompt: z.string().optional().default(""),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  jsonMode: z.boolean().optional().default(false),
}).refine((v) => v.systemPrompt.trim() || v.userPrompt.trim(), {
  message: "Provide a system prompt, a user prompt, or both",
});

export const llmTestAdmin = express.Router();
llmTestAdmin.use(requireAdmin);

/** List model ids the provider reports (best effort; used for suggestions only). */
llmTestAdmin.get("/models", async (req, res) => {
  try {
    const provider = (req.query.provider === "huggingface" ? "huggingface" : "openai") as Provider;
    const client = getLlmClient(provider);
    const ids: string[] = [];
    for await (const m of client.models.list()) {
      ids.push(m.id);
      if (ids.length >= 2000) break;
    }
    ids.sort((a, b) => a.localeCompare(b));
    res.json({ provider, models: ids });
  } catch (error) {
    sendError(res, error, "Failed to list models");
  }
});

/** Run one prompt against one model. */
llmTestAdmin.post("/run", async (req, res) => {
  let parsed: z.infer<typeof RunSchema>;
  try {
    parsed = RunSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors.map((e) => e.message).join("; ") });
    }
    throw error;
  }

  const { provider, model, systemPrompt, userPrompt, temperature, maxTokens, jsonMode } = parsed;

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt });
  if (userPrompt.trim()) messages.push({ role: "user", content: userPrompt });

  const params: Record<string, unknown> = { model, messages };
  if (temperature !== undefined) params.temperature = temperature;
  if (maxTokens !== undefined) {
    params[maxTokensParam(provider)] = maxTokens;
  }
  if (jsonMode) params.response_format = { type: "json_object" };

  const start = Date.now();
  try {
    const client = getLlmClient(provider);
    const response: any = await client.chat.completions.create(params as any);
    const durationMs = Date.now() - start;
    const choice = response.choices?.[0];
    const output: string = choice?.message?.content ?? "";

    const fullPrompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
    await logLlmCall(
      "devtools.llm_test",
      fullPrompt,
      output,
      { mode: "llm_test", provider, model, temperature, maxTokens, jsonMode },
      durationMs
    ).catch(() => undefined);

    res.json({
      ok: true,
      provider,
      model,
      resolvedModel: response.model ?? model,
      output,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens ?? null,
            completionTokens: response.usage.completion_tokens ?? null,
            totalTokens: response.usage.total_tokens ?? null,
          }
        : null,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - start;
    const { status, message } = describeLlmError(error);
    res.status(200).json({ ok: false, provider, model, error: message, upstreamStatus: status, durationMs });
  }
});

function sendError(res: express.Response, error: unknown, fallback: string) {
  const { status, message } = describeLlmError(error);
  const code = error instanceof LlmConfigError ? error.status : 502;
  res.status(code).json({ error: `${fallback}: ${message}`, upstreamStatus: status });
}
