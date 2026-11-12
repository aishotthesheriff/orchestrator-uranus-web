/**
 * LLM judges: a model reads part of a generated turn and scores it against a rubric.
 * Rubrics are in rubrics.ts; the judge model and any rubric overrides come from Dev Tools.
 */

import { storage } from "../storage";
import { describeLlmError, getLlmClient, maxTokensParam } from "../llm/clients";
import { diagnoseJson } from "../llm/json";
import { logLlmCall } from "../llm/jsonPrompt";
import { UTILITY_LLM_MODEL, adhocLlmModel, requestModelId, toResolvedLlmModel, type ResolvedLlmModel } from "../llm/models";
import { withSpan } from "../observability/langsmith";
import type { EvalScore, EvaluatorInfo, TurnEvalInput, TurnEvalOutput } from "./evaluators";
import { JUDGES, type JudgeSpec } from "./rubrics";

export const JUDGE_MODEL_SETTING = "eval_judge_model_key";

/** Enough for two or three sentences of reasoning; reasoning models may need more (catalog maxTokens). */
const JUDGE_MAX_TOKENS = 400;

export const JUDGE_INFO: EvaluatorInfo[] = JUDGES.map((judge) => ({
  key: judge.key,
  title: judge.title,
  kind: "judge",
  description: judge.description
}));

/** The model that grades. A catalog model chosen in Dev Tools, else the utility model. */
export async function resolveJudgeModel(): Promise<ResolvedLlmModel> {
  const setting = await storage.getSetting(JUDGE_MODEL_SETTING).catch(() => undefined);
  const key = setting?.active ? setting.value?.trim() : "";
  if (key) {
    const model = toResolvedLlmModel(await storage.getLlmModelByKey(key), "database");
    if (model) return model;
    console.warn(`[Evals] Judge model '${key}' is not in the catalog; using ${UTILITY_LLM_MODEL}.`);
  }
  return adhocLlmModel({ provider: "openai", modelName: UTILITY_LLM_MODEL });
}

/** The rubric in use: a Dev Tools prompt template named eval_judge_<key> if one exists. */
async function rubricFor(judge: JudgeSpec): Promise<{ text: string; source: "default" | "prompt-template" }> {
  try {
    const override = await storage.getActivePromptTemplate(`eval_judge_${judge.key}`);
    const text = (override?.systemContent || override?.content || "").trim();
    if (text) return { text, source: "prompt-template" };
  } catch (error) {
    console.warn(`[Evals] Could not read rubric override for ${judge.key}:`, error);
  }
  return { text: judge.rubric, source: "default" };
}

/** A 1-5 grade as a 0-1 score. */
function normalize(grade: number): number {
  return Number(((Math.min(5, Math.max(1, grade)) - 1) / 4).toFixed(4));
}

export async function runJudge(
  judge: JudgeSpec,
  input: TurnEvalInput,
  output: TurnEvalOutput,
  llm: ResolvedLlmModel,
  context: { gameId?: string; turnNumber?: number } = {}
): Promise<EvalScore> {
  if (!judge.applies(output)) {
    return { key: judge.key, score: null, comment: "Nothing to grade: the turn did not produce this output." };
  }

  const rubric = await rubricFor(judge);
  const material = judge.material(input, output);
  const model = requestModelId(llm);

  return withSpan(
    `judge.${judge.key}`,
    {
      inputs: { judge: judge.key, model, material },
      metadata: { judge: judge.key, rubricSource: rubric.source, judgeModel: model },
      tags: ["eval-judge"],
      outputs: (score) => ({ ...score })
    },
    async () => {
      const startedAt = Date.now();
      const logPrompt = `SYSTEM:\n${rubric.text}\n\nUSER:\n${material}`;
      try {
        const params: any = {
          model,
          messages: [
            { role: "system", content: rubric.text },
            { role: "user", content: material }
          ],
          [maxTokensParam(llm.provider)]: Math.max(JUDGE_MAX_TOKENS, llm.params.maxTokens ?? 0),
          // Grading should not vary run to run. (Some models only accept their default.)
          ...(llm.params.temperature === undefined ? { temperature: 0 } : { temperature: llm.params.temperature })
        };
        if (llm.supportsJsonMode) params.response_format = { type: "json_object" };

        const response: any = await getLlmClient(llm.provider).chat.completions.create(params);
        const content: string = response.choices?.[0]?.message?.content?.trim() ?? "";
        await logLlmCall(
          `eval.judge.${judge.key}`,
          logPrompt,
          content,
          { model, modelKey: llm.key, provider: llm.provider, rubricSource: rubric.source },
          Date.now() - startedAt,
          context.gameId,
          context.turnNumber
        );

        const parsed = diagnoseJson(content);
        const value = parsed.value as { score?: unknown; reasoning?: unknown } | undefined;
        const grade = Number(value?.score);
        if (parsed.quality === "failed" || !Number.isFinite(grade)) {
          return { key: judge.key, score: null, comment: `Judge reply could not be read: ${content.slice(0, 200)}` };
        }
        return {
          key: judge.key,
          score: normalize(grade),
          comment: typeof value?.reasoning === "string" ? value.reasoning : undefined
        };
      } catch (error) {
        const { message } = describeLlmError(error);
        return { key: judge.key, score: null, comment: `Judge call failed: ${message}` };
      }
    }
  );
}

/** Run the named judges (all of them by default) side by side. */
export async function runJudges(
  input: TurnEvalInput,
  output: TurnEvalOutput,
  options: { keys?: string[]; llm?: ResolvedLlmModel; gameId?: string; turnNumber?: number } = {}
): Promise<EvalScore[]> {
  const selected = options.keys ? JUDGES.filter((judge) => options.keys!.includes(judge.key)) : JUDGES;
  if (selected.length === 0) return [];
  const llm = options.llm ?? (await resolveJudgeModel());
  return Promise.all(
    selected.map((judge) => runJudge(judge, input, output, llm, { gameId: options.gameId, turnNumber: options.turnNumber }))
  );
}
