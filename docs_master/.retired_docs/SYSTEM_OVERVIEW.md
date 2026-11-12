# SYSTEM OVERVIEW

## Purpose
Quest to Uranus is a narrative-driven management game. The experience spans:
- **Player UI (React)** that presents turns, assets, and async updates.
- **Backend API (Express + Postgres)** that safeguards sessions, orchestrates story generation, and enforces security.
- **Background processors (Socket.IO workers)** that finalize turns and render illustrations on a decoupled clock.
- **Reference releases** that supply prompts, content catalogs, and defaults without redeploying code.

This guide gives new contributors a high-level map before diving into module-specific docs.

## Runtime Architecture
```mermaid
flowchart LR
  subgraph Client
    UI[React UI]
    Queries[React Query]
    Socket[Socket.IO Client]
  end
  subgraph HTTP
    Express[Express Router]
    Middleware[Security & Rate Limits]
  end
  subgraph Jobs
    TurnProc[TurnJobProcessor]
    ImageProc[ImageJobProcessor]
  end
  subgraph Persistence
    DB[(Postgres)]
    References[releases/current]
  end
  subgraph Services
    AI[OpenAI APIs]
    Files[/generated_images]
    Metrics[[Prometheus Metrics]]
  end

  UI --> Queries --> Express
  Socket --> Express
  Express --> Middleware
  Middleware --> Express
  Express --> DB
  Express --> References
  Express --> TurnProc
  Express --> ImageProc
  TurnProc --> DB
  TurnProc --> ImageProc
  TurnProc --> Socket
  ImageProc --> DB
  ImageProc --> Files
  ImageProc --> Socket
  ImageProc --> AI
  Express --> Metrics
  Express --> Files
```

### Server Bootstrap (`server/index.ts`)
- Sets up logging, Helmet, cookie/session handling, CSRF tokens, and rate limits.
- Validates critical env vars (`DATABASE_URL`, `SESSION_SECRET`) and mounts middleware for suspicious request logging and payload inspection.
- Skips Vite dev tooling in production; otherwise serves the bundle via `serveStatic`.
- Exposes health (`/api/health`) and Prometheus metrics (`/metrics`) endpoints.
- Delegates all routing + Socket.IO setup to `registerRoutes`.

### Route Layer (`server/routes.ts`)
- **Game lifecycle**: start, fetch, act, delete games; edit equipment/interview responses; request interview answers; generate images; adjust settings.
- **Reference admin**: publish/activate releases and query archived versions.
- **PCE tooling**: prompt testing, theme/style catalog APIs, and DevTools utilities.
- Mounts Socket.IO, then starts orchestrator workers plus cleanup service:
  1. `TurnPrecomputeWorker` for deterministic checks + LLM precompute.
  2. `TurnApplyWorker` for transactional state updates and Socket.IO emission.
  3. `ImageWorker` for cache-first art generation.
  4. `ImageCacheCleanup` for pruning stale renderings.
- Pre-warms the reference cache at startup for predictable latency.

## Turn Execution Path
1. **Action submission** (`POST /api/game/action`):
   - `requireAuth` checks the session cookie, then `gameActionRateLimit` throttles abusive clients.
   - The route validates the request (`actionInputSchema`), confirms game ownership, and enqueues a `turn_jobs` row via `storage.createTurnJob`.
   - Response returns `{ turnJobId, status: 'processing' }` so the client can show progress.
2. **Turn processing** (Orchestrator workers):
   - `TurnPrecomputeWorker` leases the job, runs deterministic checks + LLM calls, writes a provisional manifest, and enqueues the apply phase.
   - `TurnApplyWorker` rehydrates the manifest, executes `processTurnWithTransaction`, seeds image metadata (creating an `image_job` on cache miss), and finalizes the manifest.
   - Upon success, the apply worker emits `turnComplete` via Socket.IO; failures surface through dead-letter queues with diagnostics.
3. **Client follow-up** (`useGameLogic`):
   - Listens for `turnComplete` and invalidates `['api','game',gameId]`, triggering React Query to refetch the updated game state.

## Image Generation Path
1. **Trigger**:
   - Either `processTurnImage` (during turn processing) or direct `/api/generate-image` calls enqueue/claim `image_jobs`.
2. **Cache-first execution** (`ImageWorker.processJob`):
   - Loads the game state + user preferences, then checks cached renders using prompt + variable hashes (`checkImageCache`).
   - On hit, converts stored data URLs into static paths via `convertImageUrlToStaticPath`.
   - On miss, calls `generateImage` → `OpenAI` (or other configured providers), saves assets with `saveImageToFile`, and records metadata.
3. **State sync**:
   - Updates the job record, patches the relevant turn inside a transaction, and emits `imageReady` (or `imageFailed`) to the game room.
   - Client receives the event, refetches the game query, and displays toast feedback.

## Client Responsibilities
- **Routing**: `App.tsx` wires Wouter routes; `GamePage` chooses desktop/mobile layouts.
- **State/query management**: `useGameLogic` handles fetching, mutations, optimistic updates, and socket lifecycle. React Query ensures in-flight requests include CSRF/header configuration (`apiRequest`).
- **Session & Security**:
  - CSRF tokens fetched lazily (`/api/csrf-token`) and cached client-side.
  - Admin JWT (if present) stored and broadcast via localStorage events.
- **UI components**: Scenes, actions, NPCs, inventory, and DevTools all consume the same query cache, keeping gameplay and admin tooling consistent.

## Data & Reference Model
- **Postgres** (managed via `storage`):
  - Tables for `users`, `games`, `turn_jobs`, `image_jobs`, `generated_images`, interview questions, mod catalogs, and reference releases.
  - `processTurnWithTransaction` enforces atomic game updates; unique partial indexes prevent duplicate pending jobs.
- **Reference releases**:
  - Stored under `releases/<version>` with a symlinked `current` directory.
  - `referenceLoader` reads `metadata.json` + `manifest.json`, caching the active dataset (prompts, events, items, defaults).
  - Admin endpoints publish/activate new datasets without code deploys.
- **Generated images**:
  - Files stored in `/generated_images`; API exposes them via static Express hosting.
  - Metadata persists in `generated_images` for cache lookup and statistics.

## Supporting Infrastructure
- **Security middleware**:
  - Helmet CSP, CSRF cookies, express-session backed by `connect-pg-simple`.
  - Rate limiting tiers (`global`, `game`, `image`, `ai`) and anomaly logging (`suspiciousRequestDetection`, `logLargePayload`, etc.).
- **Monitoring**:
  - Prometheus metrics (`turn_job_duration_ms`, `image_job_duration_ms`, queue depths, cache hits/misses).
  - `/api/health` checks DB latency, queue depth, reference status, memory usage, and recent security events.
- **Logging**:
  - Centralized console logging pipes to disk (`setupConsoleLogging`), augmented by Socket.IO `llmLog` broadcasts when enabled.

## Technology Stack
- **Runtime**: Node 20+, Express 4, Socket.IO 4, Postgres 15+, TypeScript (ESM).
- **Frontend**: React 18, Vite 5, React Query 5, Tailwind CSS 3, Radix UI.
- **AI integrations**: OpenAI text + images, HuggingFace utilities (future proofing).
- **Build/Tooling**: Vite for client bundling, esbuild for server, Vitest + Happy DOM for testing, Docker for deployment.

## Where to Dive Deeper
- Backend modules: [`MODULE_SERVER_ENTRY.md`](./MODULE_SERVER_ENTRY.md), [`MODULE_ROUTES.md`](./MODULE_ROUTES.md), [`MODULE_STORAGE.md`](./MODULE_STORAGE.md), [`MODULE_AI_SERVICE.md`](./MODULE_AI_SERVICE.md).
- Execution specifics: [`GAME_EXECUTION_FLOW.md`](./GAME_EXECUTION_FLOW.md) (V2 - current), [`TRANSACTION_BOUNDARIES_ARCHITECTURE.md`](./TRANSACTION_BOUNDARIES_ARCHITECTURE.md).
- Client internals: [`CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md`](./CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md).
- Image subsystem: [`IMAGE_SYSTEM_ARCHITECTURE.md`](./IMAGE_SYSTEM_ARCHITECTURE.md).
- Settings & content: [`SETTINGS_SYSTEM.md`](../SETTINGS_SYSTEM.md), [`DEVTOOLS_USER_GUIDE.md`](./DEVTOOLS_USER_GUIDE.md).

Use this overview to choose the right deep-dive doc, then consult code in `server/`, `client/`, and `shared/` for implementation details.
