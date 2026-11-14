# AGENTS

## Overview
This document enumerates the major runtime agents that collaborate to deliver Quest to Uranus. Use it together with [`SYSTEM_OVERVIEW.md`](docs_master/current/SYSTEM_OVERVIEW.md) to understand how each actor is scoped, where it lives in the codebase, and how it communicates with peers.

## Agent Catalog
| Agent | Mandate | Key Entry Points |
| --- | --- | --- |
| Player Client Agent | Drive gameplay UI, network calls, and socket reactions. | `client/src/hooks/useGameLogic.ts:23`, `client/src/lib/queryClient.ts:1`, `client/src/lib/socket.ts:1` |
| Gateway & Security Agent | Terminate HTTP, enforce security controls, and expose system health. | `server/index.ts:1`, `server/middleware/rateLimiting.ts:1`, `server/middleware/securityLogging.ts:1` |
| Game Orchestrator Agent | Provide REST/WS APIs, validate input, and bootstrap background services. | `server/routes.ts:28` |
| Data Persistence Agent | Translate domain models to MariaDB, guarantee transactional safety. | `server/storage.ts:1` |
| Turn Processor Agent | Execute queued player actions and emit completed turns. | `server/orchestrator/workers/turnPrecomputeWorker.ts:1`, `server/orchestrator/workers/turnApplyWorker.ts:1`, `server/gameLogic.ts:26`, `server/pce/graph/index.ts:1`, `server/llm/models.ts:1` |
| Image Processor Agent | Resolve scene art via cache-first generation and notify clients. | `server/orchestrator/workers/imageWorker.ts:1`, `server/aiService.ts:1`, `server/imageStorage.ts:1` |
| Reference Steward Agent | Load, cache, and activate reference releases and defaults. | `server/reference/referenceLoader.ts:1`, `server/reference/publishReference.ts:1` |
| Maintenance & Observability Agent | Purge stale assets, expose metrics, trace turns, and surface health signals. | `server/imageCacheCleanup.ts:1`, `server/metrics.ts:1`, `server/observability/langsmith.ts:1`, `server/index.ts:152` |
| Evaluation Agent | Score generated turns: offline experiments on saved scenarios and a sample of live turns. | `server/evals/runner.ts:1`, `server/evals/liveSampler.ts:1`, `server/evals/evaluators.ts:1`, `server/evals/rubrics.ts:1` |

---

### Player Client Agent
**Mandate:** Present the game, manage optimistic UI state, and react to server pushes.  
**Primary Modules:** `client/src/hooks/useGameLogic.ts:23`, `client/src/lib/queryClient.ts:1`, `client/src/lib/socket.ts:1`.

- Issues HTTP requests through `apiRequest`, which transparently applies CSRF headers and admin tokens before calling the Gateway agent.
- Subscribes to Socket.IO events (`turnComplete`, `imageReady`, `imageFailed`) and transforms them into React Query invalidations so the UI refreshes instantly.
- Coordinates page-specific logic—loading states, toasts, equipment updates—while guarding against duplicate submissions and enforcing client-side limits.
- Falls back to `/welcome` when sessions expire, ensuring failed requests do not leave the UI in an inconsistent state.

### Gateway & Security Agent
**Mandate:** Own the HTTP ingress layer, enforce security policy, and expose diagnostics.  
**Primary Modules:** `server/index.ts:1`, `server/middleware/rateLimiting.ts:1`, `server/middleware/securityLogging.ts:1`.

- Boots Express with Helmet CSP, cookie parsing, session storage, and CSRF protection before any route logic executes.
- Applies layered rate limits (`globalRateLimit`, `gameActionRateLimit`, etc.) and logs anomalies or oversized payloads for later analysis.
- Hosts `/api/health` and `/metrics`, giving operators insight into DB latency, queue depth, memory usage, and security counters.
- Serves static assets (`/generated_images`) and, in production, the compiled client bundle, while delegating application routing to the Game Orchestrator agent.

### Game Orchestrator Agent
**Mandate:** Validate requests, route them to downstream agents, and coordinate background services.  
**Primary Module:** `server/routes.ts:28`.

- Owns the public API surface: game lifecycle, interview tools, DevTools catalog management, and image generation endpoints.
- On startup, instantiates orchestrator workers (`TurnPrecomputeWorker`, `TurnApplyWorker`, `ImageWorker`) alongside the image cache cleanup service, then registers the Socket.IO namespace for client communication.
- Bridges synchronous HTTP work with async pipelines by enqueuing jobs in MariaDB and returning lightweight receipts (e.g., `{ turnJobId, status: 'processing' }`).
- Handles admin workflows—publishing/activating reference data—and exposes safe read-only endpoints for client defaults.

### Data Persistence Agent
**Mandate:** Provide a transactional abstraction over MariaDB while translating between snake_case rows and TypeScript models.  
**Primary Module:** `server/storage.ts:1`.

- Offers typed getters/setters covering users, games, jobs, prompts, interview content, image cache metadata, and reference releases.
- Implements `processTurnWithTransaction` to lock a game row, apply turn logic, and persist updates atomically, preventing double-processing when multiple workers compete.
- Manages cache-friendly helpers (e.g., user preference memoization) and handles unique-index conflicts gracefully by retrieving existing records.
- Supplies maintenance utilities (e.g., generated-image deletion, reference release activation) consumed by other agents.
- Talks to MariaDB through the pool in `server/db.ts`; the schema is `server/db/schema/`. A new database is set up from the newest published release with `npm run db:init`. See [`DATABASE.md`](docs_master/current/DATABASE.md).
- Production runs on Hostinger at https://3rdiaudio.com. How to deploy, and what differs there (two app processes, CSRF and rate limits on), is in [`HOSTINGER_DEPLOYMENT.md`](docs_master/current/HOSTINGER_DEPLOYMENT.md).

### Turn Processor Agent
**Mandate:** Drain the turn job queue, run deterministic game logic, and broadcast completed turns.  
**Primary Modules:** `server/orchestrator/workers/turnPrecomputeWorker.ts:1`, `server/orchestrator/workers/turnApplyWorker.ts:1`, `server/gameLogic.ts:26`, `server/pce/graph/index.ts:1`.

- `TurnPrecomputeWorker` leases jobs from the orchestrator, executes deterministic checks and LLM calls, persists a provisional manifest, and enqueues the apply stage.
- The LLM calls are the four-stage story pipeline, a LangGraph graph (`server/pce/graph/`): master, then narrative, then actions and image side by side, each with retry and fallback-model recovery. Live turns, the PCE Inspector, model qualification and evals all enter through `runPceGraph`.
- `TurnApplyWorker` rehydrates precompute artifacts, runs `processTurnWithTransaction`, applies image metadata, and finalizes the manifest.
- Both workers enforce idempotency via manifest hashes and lease management, emitting `turnComplete` events over Socket.IO when successful or dead-lettering with diagnostics on failure.
- The story model for each turn is resolved by `resolveLlmModel` (`server/llm/models.ts`): theme-forced model, then the player's choice, then the release default. See [`LLM_MODELS.md`](docs_master/current/LLM_MODELS.md).

### Image Processor Agent
**Mandate:** Resolve imagery for turns, preferring cache hits and falling back to on-demand generation.  
**Primary Modules:** `server/orchestrator/workers/imageWorker.ts:1`, `server/aiService.ts:1`, `server/imageStorage.ts:1`.

- Leases image jobs through the orchestrator, loads the latest game state and user preferences, and checks fingerprinted cache entries via `checkImageCache`.
- On cache miss, builds prompts with `generateImage`, relays to the configured provider (OpenAI by default), then persists the asset using `saveImageToFile`.
- Updates both the job record and corresponding turn inside a transaction, ensuring any consumer sees a consistent image URL and metadata.
- Emits `imageReady` or `imageFailed` events and records Prometheus counters (`imageCacheHits`, `imageJobsFailed`, etc.) for monitoring.
- Workers send live updates with `emitToRoom` (`server/socketRelay.ts`), not `io.to().emit` directly, so they also reach browsers connected to another app process.

### Reference Steward Agent
**Mandate:** Manage the game’s content catalog independent of code deployments.  
**Primary Modules:** `server/reference/referenceLoader.ts:1`, `server/reference/publishReference.ts:1`.

- Loads the active release from `releases/current`, caching prompts, events, items, image templates, the image and story (LLM) model catalogs, and default settings for low-latency access.
- Supplies helper APIs (`getCurrentReference`, `getReferenceByVersion`) that all downstream agents use when they need authoritative content.
- Provides admin endpoints for publishing new versions, toggling the active release, and listing release history, enabling content teams to iterate safely.
- Falls back gracefully when metadata files are missing, logging warnings rather than crashing the server at startup.
- A release also carries every content row (`workspace/`), so an empty database can be loaded from it and checked against it (`server/reference/importRelease.ts`, Verify in Dev Tools).

### Maintenance & Observability Agent
**Mandate:** Keep the image cache healthy and expose the telemetry operators rely on.  
**Primary Modules:** `server/imageCacheCleanup.ts:1`, `server/metrics.ts:1`, `server/index.ts:152`.

- Runs the hourly cleanup scheduler, deleting generated images that fall outside policy thresholds sourced from settings.
- Registers Prometheus metrics (queue depth, job durations, cache hit/miss counts, memory gauges) and ensures the `/metrics` endpoint exports them.
- Contributes to the `/api/health` report by aggregating queue length, reference status, memory utilization, and security counters, giving a single place to spot regressions.
- Works side-by-side with centralized logging (file-backed console output and optional Socket.IO LLM logs) so operators can trace issues end-to-end.
- When LangSmith is configured, traces each player turn as one trace across the precompute, apply and image workers (trace headers ride in queue-entry metadata) and stores a trace reference on manifests, LLM logs and Inspector runs. Off by default. See [`OBSERVABILITY_AND_EVALS.md`](docs_master/current/OBSERVABILITY_AND_EVALS.md).

### Evaluation Agent
**Mandate:** Measure the quality of generated turns so a model or prompt change can be judged before players see it.  
**Primary Modules:** `server/evals/runner.ts:1`, `server/evals/liveSampler.ts:1`, `server/evals/evaluators.ts:1`, `server/evals/rubrics.ts:1`.

- Scores a turn with rule checks (structural verdict, action validity, narration length) and LLM judges (narration quality, action relevance, image-prompt fidelity); every score is 0 to 1 with a comment.
- Runs offline experiments over the saved PCE Inspector scenarios, on published or draft prompts, from Dev Tools > Evals or `npm run evals`. Results go to LangSmith, with a summary in `eval_experiments`.
- Scores a configurable share of live turns in the background after they are committed, writing scores to the turn manifest and to the turn's trace. Never delays a turn.
- Judge model, sample rate and rubric overrides are set in Dev Tools and take effect without a release.

---

For deeper implementation notes, consult the module-specific docs referenced in [`SYSTEM_OVERVIEW.md`](docs_master/current/SYSTEM_OVERVIEW.md#where-to-dive-deeper).
