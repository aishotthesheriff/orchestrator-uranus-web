/**
 * Run an offline eval experiment from the command line.
 *
 *   npm run evals -- [--model <catalog key>] [--prompts published|draft] [--tag <scenario tag>]
 *                    [--judges all|none|<key,key>]
 *
 * Runs every saved PCE scenario (or those with --tag) through the story pipeline, scores
 * each turn, and prints the summary. Needs DATABASE_URL, the model provider keys, and
 * LangSmith configured (LANGSMITH_TRACING=true, LANGSMITH_API_KEY).
 *
 * Exits non-zero if the experiment fails to run or any turn's structural verdict is "failed".
 */

import { runExperiment } from "../server/evals/runner";
import { JUDGES } from "../server/evals/rubrics";
import { pool } from "../server/db";
import { flushTraces } from "../server/observability/langsmith";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const match = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unexpected argument: ${argv[i]}`);
    const value = match[2] ?? argv[++i];
    if (value === undefined) throw new Error(`--${match[1]} needs a value`);
    args[match[1]] = value;
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const prompts = args.prompts ?? "published";
  if (prompts !== "published" && prompts !== "draft") {
    throw new Error(`--prompts must be "published" or "draft", not "${prompts}"`);
  }
  const judges =
    args.judges === undefined || args.judges === "all"
      ? undefined
      : args.judges === "none"
      ? []
      : args.judges.split(",").map((key) => key.trim()).filter(Boolean);

  console.log(
    `Running eval experiment: model=${args.model ?? "(catalog default)"} prompts=${prompts}` +
      ` tag=${args.tag ?? "(all scenarios)"} judges=${judges ? judges.join(",") || "none" : JUDGES.map((j) => j.key).join(",")}`
  );

  const experiment = await runExperiment({
    modelKey: args.model ?? null,
    promptSource: prompts === "draft" ? "database" : "reference",
    judges,
    scenarioTag: args.tag ?? null
  });

  if (experiment.status !== "completed" || !experiment.summary) {
    console.error(`\nExperiment failed: ${experiment.error ?? "unknown error"}`);
    return 1;
  }

  const { summary } = experiment;
  console.log(`\nExperiment ${experiment.name}`);
  console.log(`Model ${experiment.model}, ${prompts} prompts, ${summary.rows.length} scenarios`);
  console.log(
    `Verdicts: ${Object.entries(summary.verdicts).map(([verdict, n]) => `${verdict} ${n}`).join(", ")}` +
      `   Mean turn ${summary.turnMsMean ?? "?"} ms   Cost ${summary.costUsd === null ? "n/a" : `$${summary.costUsd.toFixed(4)}`}`
  );
  console.log("\nMean scores (0-1):");
  for (const [key, { mean, n }] of Object.entries(summary.scores)) {
    console.log(`  ${key.padEnd(24)} ${mean === null ? "n/a " : mean.toFixed(2)}  (${n} scored)`);
  }
  console.log("\nPer scenario:");
  for (const row of summary.rows) {
    const scores = row.scores.map((s) => `${s.key}=${s.score === null ? "n/a" : s.score.toFixed(2)}`).join("  ");
    console.log(`  ${row.verdict.padEnd(9)} ${row.scenario}${row.error ? `  ERROR: ${row.error}` : ""}\n            ${scores}`);
  }
  if (experiment.langsmithUrl) console.log(`\nCompare in LangSmith: ${experiment.langsmithUrl}`);

  return summary.verdicts.failed > 0 ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  })
  .then(async (code) => {
    await flushTraces().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(code);
  });
