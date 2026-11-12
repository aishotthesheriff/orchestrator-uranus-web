# Observability and Evals

**Audience:** anyone debugging a turn, changing a prompt or model, or operating the server.
**Related:** [`ORCHESTRATOR.md`](ORCHESTRATOR.md), [`AI_SERVICE.md`](AI_SERVICE.md), [`LLM_MODELS.md`](LLM_MODELS.md), [`PROMPT_COMPOSITION_ENGINE.md`](PROMPT_COMPOSITION_ENGINE.md)

This covers three things added together:

1. The story pipeline runs as a **LangGraph** graph.
2. Every turn can be **traced** to LangSmith, end to end across the job queue.
3. **Evals** score generated turns, offline on saved scenarios and on a sample of live turns.

Tracing and offline experiments need a LangSmith account. Everything else works without one.

---

## 1. Setup

Add to `.env` and recreate the app container (`docker compose up -d app`):

| Variable | Purpose |
| --- | --- |
| `LANGSMITH_TRACING=true` | Turns tracing on. Off by default. |
| `LANGSMITH_API_KEY` | Required when tracing is on. |
| `LANGSMITH_PROJECT` | Project traces are written to (default `quest-to-uranus`). |
| `LANGSMITH_ENDPOINT` | Only outside the US region, e.g. `https://eu.api.smith.langchain.com`. |
| `LANGSMITH_HIDE_INPUTS`, `LANGSMITH_HIDE_OUTPUTS` | Set to `true` to send run structure and timings without prompt or response text. |
| `LANGSMITH_TRACING_SAMPLING_RATE` | Fraction of traces to keep, 0 to 1. |
| `LANGSMITH_EVAL_DATASET` | Name of the eval dataset (default `uranus-pce-scenarios`). |

Tracing is on only when `LANGSMITH_TRACING=true`, a key is set, and `NODE_ENV` is not `test`. The server logs which at startup (`LangSmith tracing on (project "...")` or `LangSmith tracing off: <reason>`). `GET /api/admin/observability/status` reports the same.

**What leaves the machine when tracing is on:** rendered prompts and their variables, model replies, narration, player-typed actions, interview answers, image prompts and resulting image paths. Image data is never sent. Use the `HIDE` variables if that is too much.

**What stays local regardless:** the `llm_logs` table, the Socket.IO log feed, Prometheus metrics and turn manifests are unchanged, and remain the record when tracing is off or a trace has aged out of LangSmith's retention.

Database: apply `server/migrations/20261112_add_eval_experiments.sql` (included in `npm run db:bootstrap`).

---

## 2. The pipeline graph

Code: `server/pce/graph/`.

```
          ┌────────┐     ┌───────────┐     ┌─────────┐
START ───▶│ master │────▶│ narrative │──┬─▶│ actions │──▶ END
          └────────┘     └───────────┘  │  └─────────┘
              │ unusable       │        │  ┌─────────┐
              ▼                ▼        └─▶│  image  │──▶ END
             END              END          └─────────┘
```

| File | Role |
| --- | --- |
| `graph.ts` | The `StateGraph`: four nodes, the routing between them. |
| `stages.ts` | `runStage`: one function for all four stages (variables → prompt → model call → JSON → validation). What differs per stage is a table at the top of the file. |
| `recovery.ts` | `withRecovery`: retry the same model once (doubling the token limit if the reply was cut off), then the fallback model once. |
| `index.ts` | `runPceGraph(context, options)`: the only entry point. |

All callers go through `runPceGraph` and differ only in options:

| Caller | Options |
| --- | --- |
| Live turns (`generateTurnContent` in `server/aiService.ts`) | defaults: published prompts, strict |
| PCE Inspector, full run | `promptSource: "database"` |
| PCE Inspector, single stage | `promptSource: "database"`, `target`, `upstream` (mock or saved data), `recover: false`, lenient |
| Model qualification, eval experiments | `promptSource: "database"` or `"reference"`, `mode: "lenient"` |

- **`promptSource`**: `"reference"` is the published release (what players get); `"database"` is the drafts being edited in Dev Tools.
- **`mode`**: `"strict"` throws if a stage that should have run produced nothing (a live turn needs all four). `"lenient"` returns what was produced.
- **`target` / `upstream`**: stop after one stage, and supply earlier stages' output instead of running them.

Design points worth knowing before changing it:

- **State holds only stage results**, so it is serializable. The turn context (game state, the closures that build prompt variables) travels in `config.configurable.pce`. This keeps a LangGraph checkpointer possible later; none is used today because the Postgres job queue already provides retries and durability.
- **Recovery is not LangGraph's `retryPolicy`.** That re-runs a node unchanged; recovery changes the request (higher token limit, then a different model) and keeps every attempt.
- **A stage never throws.** It returns `{ ok: false }` with metadata, so the parallel `actions` and `image` nodes cannot cancel each other.
- **A node and a state channel cannot share a name**, hence channels named `masterResult`, `narrativeResult`, and so on.
- **`promptChain` order is fixed** (master, narrative, actions, image) regardless of which parallel stage finished first.

Tests: `server/pce/graph/graph.test.ts` (routing, parallelism, partial runs) and `recovery.test.ts`. Both use scripted stages; no model or database is needed.

---

## 3. Traces

Code: `server/observability/langsmith.ts`.

One player turn is one trace, even though three workers handle it:

```
turn                              precompute worker starts the trace
├── turn.checks                   dice and event selection
├── pce                           the story pipeline
│   └── pce.graph                 LangGraph run
│       ├── master
│       │   └── master.attempt
│       │       ├── prompt.render     template name, hash, source, variables → rendered prompt
│       │       └── ChatOpenAI        the model call, with token counts
│       ├── narrative
│       │   ├── narrative.attempt     (unusable reply)
│       │   └── narrative.retry       a retry or fallback is its own run
│       ├── actions                   overlaps image
│       └── image
├── turn.image_plan
├── turn.apply                    apply worker, same trace
└── turn.image                    image worker, same trace
    ├── image.cache_lookup
    └── image.generate
```

How the trace crosses the queue: `PostgresOrchestrator.enqueue` adds the current run's headers to the queue entry's `metadata.langsmith` whenever a job is enqueued from inside a traced run. `runTracedJob` (`server/orchestrator/workers/jobTracing.ts`) reads them when a worker claims the job and continues that trace; without headers it starts a new one. Nothing else in the queue changed.

Other things to know:

- **Game as a thread.** Turn runs carry `thread_id = gameId`, so a game's turns group together in LangSmith.
- **Failed jobs show as failed runs.** A worker reports the failure to its lease, then throws `HandledJobFailure` so the run is marked as an error; the wrapper swallows it.
- **Model calls** are traced by wrapping the OpenAI-compatible clients (`getLlmClient` in `server/llm/clients.ts`, and the utility client in `server/aiService.ts`). That covers the four stages, intent mapping, interview answers, eval judges, and the Dev Tools tester and health check.
- **Image generation** is traced by hand so that image data is never uploaded.
- **Prompt versions.** `buildPcePrompt` returns `template: { name, source, hash }`. The hash is of the unrendered template, so it changes exactly when the wording does. It is on the `prompt.render` run, on each stage's metadata (`templateHash`, `templateSource`, `promptHash`) and in the manifest's `llmCalls`.
- **Shutdown.** `SIGTERM` and `SIGINT` flush pending trace batches (5 second limit) before exit.

### Finding a trace from the app

A trace reference (`{ runId, traceId }`) is stored wherever a record is made:

| Record | Where | Dev Tools |
| --- | --- | --- |
| Turn | `manifest.request.langsmith` | Game Telemetry: "Open trace" on each turn |
| Model call | `llm_logs.metadata.langsmith` | LLM Logs: "Open trace" on each row |
| Inspector run | `stageResultsJson.trace` | PCE Inspector: next to the run's time and cost |
| Qualification run | `trace` in the response | LLM Models > Qualify: on each run |

"Open trace" appears only on records made while tracing was on. The link is resolved on click through `GET /api/admin/observability/trace-url`.

To add a span elsewhere, use `withSpan(name, { inputs, outputs, metadata }, fn)`. Inputs and outputs are what you pass, never the function's raw arguments; keep them small (no full game state).

---

## 4. Evals

Code: `server/evals/`.

Every evaluator returns a score from 0 to 1 and a comment. Offline experiments and live sampling use the same evaluators, so their scores are comparable.

| Key | Kind | What it checks |
| --- | --- | --- |
| `structural_verdict` | rule | clean 1, repaired 0.67, fallback 0.33, failed 0 (same verdicts as model qualification; `server/pce/verdict.ts`) |
| `actions_valid` | rule | actions distinct, known intents and risks, summaries of at most 18 words |
| `narration_length` | rule | narration near the 6-7 sentences the prompt asks for |
| `narration_quality` | judge | narration follows the action and the dice, includes the event, fits the theme |
| `action_relevance` | judge | actions follow from the narration, are distinct, vary in risk |
| `image_prompt_fidelity` | judge | image prompt depicts the narrated scene in the chosen style |

Rules are free and always run. Judges are model calls (`judges.ts`), graded 1-5 and normalized.

- **Judge model:** chosen in Dev Tools > Evals (setting `eval_judge_model_key`); defaults to `gpt-4o-mini`.
- **Rubrics:** defaults are in `rubrics.ts`. To change one without a deploy, create a prompt template named `eval_judge_<key>` (for example `eval_judge_narration_quality`) in Dev Tools > Prompts; its system content replaces the default.
- **Adding an evaluator:** a rule goes in `CODE_EVALUATORS` in `evaluators.ts`; a judge goes in `JUDGES` in `rubrics.ts`. Both then appear in Dev Tools, the CLI and live sampling without further wiring.

### Offline experiments

An experiment runs every saved PCE Inspector scenario once through the full pipeline with one model and one prompt set, and scores each turn.

- **Dataset.** The scenarios are mirrored to a LangSmith dataset (`dataset.ts`). Postgres stays the source of truth; the dataset is re-synced before every experiment, and each example carries only the scenario id and what a judge needs.
- **Draft versus published.** Choosing "Draft" prompts scores the edits in the Prompts tab before a release is published. Run one experiment on Published as the baseline and one on Draft, then compare.
- **Where results go.** LangSmith holds the experiment (runs, traces, scores, side-by-side comparison). A summary is kept in the `eval_experiments` table so Dev Tools can list and compare without LangSmith.
- **One at a time.** An experiment runs inside the server process; a second request while one is running is refused, and a restart marks a running experiment as failed.

Run from **Dev Tools > Evals** (model, prompts, scenario tag, which judges), or from the command line:

```bash
npm run evals -- --model <catalog key> --prompts published|draft [--tag <scenario tag>] [--judges all|none|key,key]
```

The command prints mean scores and per-scenario results and exits non-zero if any turn's verdict is `failed`, so it can gate a release.

Cost: about `scenarios × (4 + number of judges)` model calls per experiment.

### Live sampling

After a turn is committed and announced, the apply worker may hand it to `liveSampler.ts`:

- With probability `eval_live_sample_rate` (Dev Tools > Evals, default 0 = off) the turn is scored in the background.
- One sample at a time; if one is still being scored, the next turn is skipped. A turn is never delayed, and a sample lost to a restart is not retried.
- Scores are written to the turn's manifest (`manifest.evals`, shown in Game Telemetry) and, when tracing is on, attached as feedback to the turn's trace.
- Intro turns are not sampled (they have no precompute manifest).

Each sampled turn costs one judge call per judge.

### Admin API

All under `/api/admin/evals`, admin token required.

| Route | Purpose |
| --- | --- |
| `GET /status` | Tracing state, dataset counts and tags, evaluator list, settings, running experiment |
| `POST /dataset/sync` | Sync scenarios to the LangSmith dataset |
| `GET /experiments`, `GET /experiments/:id` | List and read experiments |
| `POST /experiments` | Start one: `{ modelKey?, promptSource, judges?, scenarioTag? }` |
| `PUT /settings` | `{ liveSampleRate?, judgeModelKey? }`; takes effect within 30 seconds |

---

## 5. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No traces appear | Check the startup log line and `GET /api/admin/observability/status`. A missing key or `NODE_ENV=test` turns tracing off. |
| "Open trace" says the trace was not found | The record predates the project's first trace, or the trace is past LangSmith's retention. `llm_logs` and the manifest still have the data. |
| A turn shows as two traces | The apply or image job was enqueued outside a traced run (for example a replayed dead-letter job), so it had no headers to continue. |
| Experiment refused with "not configured" | Offline experiments need LangSmith. Live sampling does not. |
| A judge score is `n/a` | The turn did not produce what that judge grades, or the judge's reply could not be read; the comment says which. |
| `app` fails to start with "Cannot find package 'langsmith'" | The container's `node_modules` is its own volume and predates the new dependencies. Rebuild with fresh volumes: `docker compose up -d --build -V app`. |
