/**
 * Recovery for one story stage: the steps that need a second model call.
 * (Cheaper fixes, such as stripping a code fence, already happened inside the stage:
 * see server/llm/json.ts.)
 *
 *  1. If the model answered but the answer was unusable, ask it once more. A reply cut
 *     off at the token limit is retried with a doubled limit.
 *  2. If that fails too, or the provider itself failed (the SDK has already retried
 *     transport errors), ask the fallback model once.
 *
 * Every attempt is kept in the result's metadata, in order; the last entry is the one
 * whose output was used. On a trace each attempt is its own run.
 *
 * LangGraph's node retry policy is not used for this: it re-runs a node unchanged, and
 * these steps change the request (a higher token limit, then a different model).
 */

import type { PromptStage, StageMetadata, StageResult, TurnGenerationContext } from "../contentRouter";
import { BUILTIN_LLM_MODEL, requestModelId } from "../../llm/models";
import { llmStageRecoveryTotal } from "../../metrics";
import { withSpan } from "../../observability/langsmith";

/**
 * Ceiling for the raised token limit when a cut-off reply is retried. A reply that was
 * cut off at or above this limit is not retried (it would be the same request again).
 */
export const MAX_RETRY_TOKENS = 16000;

type AttemptKind = "first" | "retry" | "fallback";

export async function withRecovery<T>(
  stage: PromptStage,
  context: TurnGenerationContext,
  run: (ctx: TurnGenerationContext) => Promise<StageResult<T>>
): Promise<StageResult<T>> {
  const usable = (r: StageResult<T>) => r.ok && r.output !== null && r.output !== undefined;

  const attempt = (kind: AttemptKind, ctx: TurnGenerationContext) =>
    withSpan(
      `${stage}.${kind === "first" ? "attempt" : kind}`,
      {
        inputs: { stage, attempt: kind, model: requestModelId(ctx.llmModel ?? BUILTIN_LLM_MODEL) },
        metadata: { stage, attempt: kind },
        outputs: (r) => {
          const meta = r.metadata[r.metadata.length - 1];
          return {
            ok: usable(r),
            error: meta?.error ?? null,
            jsonQuality: meta?.jsonQuality ?? null,
            finishReason: meta?.finishReason ?? null,
            templateHash: meta?.templateHash ?? null,
            templateSource: meta?.templateSource ?? null
          };
        }
      },
      () => run(ctx)
    );

  const first = await attempt("first", context);
  if (usable(first)) return first;

  const attempts: StageMetadata[] = [...first.metadata];
  // A stage without an explicit model runs on the built-in one.
  const primary = context.llmModel ?? BUILTIN_LLM_MODEL;
  const primaryId = requestModelId(primary);
  let last = first;

  const lastMeta = first.metadata[first.metadata.length - 1];
  const modelAnswered = lastMeta?.rawResponse !== null && lastMeta?.rawResponse !== undefined;
  // Neither an unusable answer nor a provider failure: the stage failed in our own code
  // (e.g. building the prompt). Another model would fail the same way.
  if (!modelAnswered && !lastMeta?.providerError) return first;

  // A cut-off reply is only worth retrying if the limit can actually be raised.
  const cutOff = lastMeta?.finishReason === "length" && typeof lastMeta.maxTokens === "number";
  const raisedLimit = cutOff ? Math.min(lastMeta!.maxTokens! * 2, MAX_RETRY_TOKENS) : undefined;
  const retryWorthwhile = modelAnswered && (!cutOff || raisedLimit! > lastMeta!.maxTokens!);
  if (retryWorthwhile) {
    const retryModel = raisedLimit
      ? { ...primary, params: { ...primary.params, maxTokens: raisedLimit } }
      : primary;
    const retry = await attempt("retry", { ...context, llmModel: retryModel });
    retry.metadata.forEach((m) => { m.recovery = "retry"; });
    attempts.push(...retry.metadata);
    if (usable(retry)) {
      llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: "retry_ok" });
      console.warn(`[LLM] ${stage} stage recovered on retry (${primaryId}): ${lastMeta?.error ?? "unusable output"}`);
      return { ...retry, metadata: attempts };
    }
    last = retry;
  }

  const fallback = context.llmFallback;
  if (fallback && requestModelId(fallback) !== primaryId) {
    const fallbackId = requestModelId(fallback);
    const result = await attempt("fallback", { ...context, llmModel: fallback });
    result.metadata.forEach((m) => { m.recovery = "fallback"; });
    attempts.push(...result.metadata);
    const ok = usable(result);
    llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: ok ? "fallback_ok" : "failed" });
    console.warn(
      `[LLM] ${stage} stage ${ok ? "served by fallback" : "failed on fallback"} ${fallbackId} after ${primaryId} failed: ` +
        `${lastMeta?.error ?? "unusable output"}`
    );
    return { ...result, metadata: attempts };
  }

  llmStageRecoveryTotal.inc({ stage, model: primaryId, outcome: "failed" });
  return { ...last, metadata: attempts };
}
