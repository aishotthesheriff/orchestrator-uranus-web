# Job Orchestrator & Transaction Manifest Specification

**Audience:** Senior engineers, platform architects, and operators  
**Status:** Draft for review  
**Related Docs:** `docs_master/current/GAME_EXECUTION_FLOW.md`, `MODULE_STORAGE.md`, `TRANSACTION_BOUNDARIES_ARCHITECTURE.md`

---

## 1. Background

Turn and image processing currently rely on table-specific polling loops (`turn_jobs`, `image_jobs`). Each worker embeds queue semantics (batch size, retry logic, logging), and state capture is limited to ad hoc log statements. This spec defines:

1. A reusable `JobOrchestrator` abstraction that decouples queue management from worker logic while remaining compatible with the existing Postgres persistence model.
2. A transaction manifest schema that records deterministic precompute inputs, transactional writes, and emitted side effects for every turn/image attempt.

These foundations unlock future goals: richer observability, deterministic replay, easier scaling (e.g., Redis or cloud queue backends), and safer failure recovery.

---

## 2. Goals & Non-Goals

**Goals**
- Provide a typed, backend-agnostic interface for enqueuing and leasing jobs, including leasing, heartbeats, retries, priorities, and command signaling.
- Capture complete execution manifests for turn/image attempts to support replay, audit, and operator tooling.
- Maintain compatibility with current Postgres tables and allow gradual migration without downtime.
- Improve traceability by standardizing trace IDs, request IDs, and payload hashing.

**Non-Goals**
- Implement Redis or external queue backends (spec only). The interface must enable that future path.
- Redesign game logic or image generation code paths.
- Replace existing job tables immediately; instead, introduce additive metadata and wrappers.

---

## 3. Terminology

| Term | Definition |
|------|------------|
| **Job Payload** | Domain-specific record stored in `turn_jobs`, `image_jobs`, etc. |
| **Queue Entry** | Metadata record tracked by the orchestrator for a payload. |
| **Lease** | Time-bound ownership of a job by a worker instance. |
| **Attempt** | One execution try for a job (precompute + apply for turns). |
| **Manifest** | JSON document describing inputs, deterministic calculations, transactional effects, and emitted side effects for an attempt. |
| **Command Topic** | Lightweight signaling channel used to wake workers (Postgres `LISTEN/NOTIFY` in v1). |

---

## 4. Job Orchestrator Abstraction

### 4.1 Functional Requirements
- Named queues with per-queue configuration (visibility timeout, max attempts, concurrency limits, rate limiting).
- FIFO ordering with optional priority override and scheduled start time (`run_at`).
- Worker lease management (claim, extend, release, fail).
- Deduplication using caller-provided idempotency keys.
- Metrics hooks (queue depth, lease churn, success/failure counts, latency).
- Trace propagation (every job stores `trace_id`, `request_id`, and `source` metadata).
- Command topic for near-real-time wake-ups in addition to polling.

### 4.2 TypeScript Interface

```ts
type QueueName = 'turn-precompute' | 'turn-apply' | 'image' | string;

interface EnqueueOptions {
  queue: QueueName;
  payload: unknown;
  runAt?: Date;
  priority?: number;         // Higher value = higher priority
  idempotencyKey?: string;   // (queue, key) scoped dedupe
  traceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

interface JobLease<TPayload> {
  job: {
    id: string;
    queue: QueueName;
    payload: TPayload;
    attempts: number;
    traceId: string;
    requestId?: string;
    metadata: Record<string, unknown>;
    priority: number;
    runAt: Date;
  };
  leaseId: string;
  leaseExpiresAt: Date;
  extend(ms: number): Promise<void>;
  complete(result?: Record<string, unknown>): Promise<void>;
  fail(error: JobFailure, opts?: { retryDelayMs?: number }): Promise<void>;
  release(): Promise<void>;  // Return to pending without counting attempt
}

interface JobFailure {
  reason: 'transient' | 'permanent';
  message: string;
  details?: Record<string, unknown>;
}

interface JobOrchestrator {
  enqueue(opts: EnqueueOptions): Promise<string>; // returns job id
  claim(queue: QueueName, workerId: string, opts?: { batchSize?: number }): Promise<JobLease<any>[]>;
  heartbeat(leaseId: string, extensionMs: number): Promise<void>;
  markStuck(opts: { queue: QueueName; olderThan: Date }): Promise<string[]>; // for ops tooling
  publishCommand(queue: QueueName, command: 'wake' | 'drain' | 'pause'): Promise<void>;
  getQueueMetrics(queue: QueueName): Promise<QueueMetrics>;
}

interface QueueMetrics {
  queue: QueueName;
  pending: number;
  inProgress: number;
  delayed: number;
  deadLetter: number;
  oldestPendingCreatedAt?: Date;
}
```

Workers depend only on this interface. Queue-specific logic (e.g., turn precompute, image generation) lives outside the orchestrator.

### 4.3 Queue Configuration

| Queue | Purpose | Default lease | Max attempts | Notes |
|-------|---------|---------------|--------------|-------|
| `turn-precompute` | LLM + deterministic computation outside transaction | 2 minutes | 3 | Longest-running queue; requires heartbeat every 30s |
| `turn-apply` | DB transaction commit & Socket.IO emission | 30 seconds | 5 | Should not perform blocking I/O |
| `image` | Image cache + generation | 2 minutes | 4 | Supports exponential backoff for provider errors |

Configuration lives in `config/queues.ts` and is injected into orchestrator at startup.

### 4.4 Lifecycle & State Machine

State progression for a single queue entry:

```
      ┌──────────────┐
      │  scheduled   │ (run_at > now)
      └──────┬───────┘
             │ now >= run_at
        ┌────▼─────┐
        │ pending  │
        └────┬─────┘
             │ claim()
        ┌────▼─────┐
        │ leased   │
        └─┬──┬──┬──┘
          │  │  │
          │  │  ├─► release() ──► pending
          │  │
          │  ├─► complete() ──► completed
          │
          └─► fail()
                 │
                 ├─ transient + attempts < max → delayed (run_at += backoff)
                 └─ permanent or attempts exhausted → dead_letter
```

Lease expiration automatically returns a job to `pending` with `attempts += 1` and records a heartbeat timeout in the manifest.

### 4.5 Leasing & Heartbeats
- Lease durations are queue-specific. Workers must call `extend()` before `leaseExpiresAt - safetyWindow` (safety window default: 5 seconds).
- Recommended heartbeat interval: `min(leaseDuration / 3, 30s)` to balance freshness and write load; orchestrator exposes `extendMany([leaseIds], ms)` to batch renewals.
- Heartbeat metadata recorded in `queue_leases` table, including worker ID, hostname, and process start time for debugging. A lightweight mode can collapse lease history into `queue_entries` columns if deployments do not need per-heartbeat auditing (configurable).
- Workers emit structured logs on claim/extend/complete/fail with trace IDs.

### 4.6 Error Handling
- `fail(reason: 'transient')` schedules retry with exponential backoff (initial 5 seconds, cap 2 minutes).
- `fail(reason: 'permanent')` moves job to dead-letter immediately.
- Jobs exceeding `maxAttempts` transition to dead-letter with `final_error`.
- Ops API (`/api/admin/queues/:queue/dead-letter`) exposes dead-letter entries for inspection, replay, or purge.
- Dead-letter retention: auto-purge entries older than 30 days (configurable). Nightly job exports metadata to cold storage before deletion.

### 4.7 Observability
- Metrics emitted: `queue_pending`, `queue_in_progress`, `queue_completed_total`, `queue_failed_total`, `queue_lease_timeout_total`, `queue_attempts_histogram`, `queue_latency_histogram`.
- Tracing: each `enqueue` accepts `traceId`. If absent, orchestrator generates one. Workers propagate to manifests and downstream logs.
- Structured logging includes: `event`, `queue`, `jobId`, `leaseId`, `workerId`, `attempt`, `traceId`, `durationMs`, `result`.
- **Operational thresholds** (initial recommendation):
  - Warn when `queue_pending{queue="turn-precompute"} > 100`; page when `> 500`.
  - Warn when `queue_lease_timeout_total` increases by more than 10/hour.
  - Warn when `queue_dead_letter_total` grows by 50 jobs over 24 hours.
  - Target p99 latency SLOs: `turn-precompute < 10s`, `turn-apply < 1s`, `image < 15s`; availability ≥ 99.9%.
- Link dashboards/alerts to runbooks: “High queue depth” → scale workers, “Lease timeouts” → inspect worker health, “Dead letters” → triage + replay.

### 4.8 Postgres Reference Implementation

**Metadata Table (`queue_entries`)**

```sql
CREATE TABLE queue_entries (
  id UUID PRIMARY KEY,
  queue TEXT NOT NULL,
  payload_table TEXT NOT NULL,
  payload_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_id UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMP,
  trace_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  idempotency_key TEXT,
  last_error JSONB
);
```

Indexes:
- Primary claim path: partial index `CREATE INDEX idx_queue_pending ON queue_entries(queue, run_at, priority DESC) WHERE status = 'pending';`
- Idempotency: unique partial index on `(queue, idempotency_key)` where key is not null.
- Stuck job scans: `CREATE INDEX idx_queue_status_updated ON queue_entries(queue, status, updated_at);`
- Benchmark claim query plans with expected queue depth (1k+ rows). Adjust priority column order if profiling shows negligible benefit.

**Lease History (`queue_leases`)**

```sql
CREATE TABLE queue_leases (
  lease_id UUID PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  heartbeat_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMP,
  released_at TIMESTAMP,
  outcome TEXT,   -- 'completed' | 'failed' | 'released' | 'expired'
  outcome_details JSONB
);
```

**Payload Integration**
- `turn_jobs.id` and `image_jobs.id` become the `payload_id`. Enqueue inserts payload row first, then `queue_entries`.
- For backwards compatibility, existing code paths continue reading `turn_jobs` directly; orchestrator wrapper is introduced before removing legacy polling.
- When a job is claimed, orchestrator loads payload via `SELECT * FROM payload_table WHERE id = payload_id FOR UPDATE SKIP LOCKED` to avoid double processing.
- `status` transitions: `pending → leased → completed|dead_letter`; `delayed` is represented as `status='pending'` with `run_at` in future.
- Provide compatibility view `legacy_turn_jobs_v` mapping orchestrator states back to legacy `pending|processing|completed|failed` values so existing admin dashboards work during migration.

**Command Topic**
- `queue_entries` triggers `NOTIFY queue_$queue` on `INSERT` and `UPDATE status = 'pending'`.
- Workers `LISTEN` on relevant channels. They still poll every `pollFallbackMs` (default 5s) in case of dropped notifications.
- Reliability notes:
  - Treat `LISTEN/NOTIFY` as best-effort; commands are not durable.
  - On reconnect, workers immediately perform a full poll.
  - Provide optional Redis pub/sub hook for future upgrade; feature-flag controlled.

### 4.9 Future Backends
- Redis Streams or AWS SQS adapters implement the same interface.
- Queue configuration remains unchanged; only orchestrator binding switches.
- Migration strategy: dual-write manifests and queue entries during pilot phase, verify parity, then cut over.

### 4.10 Turn Queue Coordination
- **Responsibility:** Precompute worker enqueues the corresponding apply job after successfully persisting the provisional manifest and marking its lease complete.
- **Failure safeguards:**
  - Apply enqueue uses the same `traceId`, payload reference, and `idempotencyKey = ${gameId}:${turnNumber}:apply`.
  - If enqueue fails (DB error, crash), the precompute lease fails with `reason='transient'` so orchestrator retries. Manifest records `job.outcome='precompute_enqueued_apply_failed'`.
  - Apply jobs reference the same payload (`turn_jobs.id`) plus manifest `precompute_hash`. Apply retries do not require re-running precompute unless hash mismatch occurs.
- **Partial failures:** Apply worker failure triggers `fail({ reason: 'transient' })` until attempts exhausted. If apply enters dead-letter, precompute job is also requeued with forced rerun flag to regenerate deterministic payload.

### 4.11 Idempotency Keys
- Default convention: `${queue}:${gameId}:${turnNumber}:${actionFingerprint}` for turn queues, `${queue}:${imageJobId}` for image.
- Action fingerprint is SHA-256 digest of `actionPayload` canonical JSON.
- Idempotency scope is per queue; orchestrator enforces uniqueness via partial index.
- Retry semantics:
  - Re-enqueue with same idempotency key ignores duplicate inserts and returns existing job id.
  - Manual replay tools generate new key with suffix `:replay:${attempt}` to avoid collisions.

### 4.12 Worker Lifecycle
- Workers register a unique `workerId` (`${queue}-${hostname}-${pid}`) when starting; used in lease metadata.
- Graceful shutdown procedure:
  1. Signal orchestrator via `publishCommand(queue, 'pause')` or internal flag to stop new claims.
  2. Wait for active leases to finish (max two lease durations).
  3. Release remaining leases explicitly, logging outstanding job ids.
  4. Flush metrics/log buffers before exit.
- Crash recovery:
  - `markStuck` sweeper runs every minute, converting expired leases (`lease_expires_at < now()`) into pending jobs and recording timeout in manifest.
  - Lease metadata retained in `queue_leases.outcome_details` for postmortem.

### 4.13 Priority & Scheduling Semantics
- Higher `priority` values run ahead of lower values for jobs that are `pending` and whose `run_at <= now()`.
- Within the same priority, FIFO ordering on `run_at` then `created_at` is maintained.
- Priority does not preempt an already leased job; it only affects selection of the next claim.
- SLA-sensitive workloads (e.g., admin abort commands) should use high priority (≥ 90). Routine turns default to 0; image jobs default to 10 to prevent starvation when turn queues back up.

---

## 5. Transaction Manifest Schema

### 5.1 Objectives
- Persist deterministic snapshots of each turn/image attempt (precompute + apply).
- Support replay tools by storing inputs, outputs, and state digests.
- Provide operators with fast diagnostics for stuck or inconsistent games.
- Bridge orchestrator events, DB writes, and Socket.IO emissions under a shared trace ID.

### 5.2 Data Model (`turn_execution_manifests`)

```sql
CREATE TABLE turn_execution_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL,
  turn_number INTEGER NOT NULL,
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  attempt INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  manifest JSONB NOT NULL,
  manifest_hash BYTEA NOT NULL,
  precompute_hash BYTEA NOT NULL,
  trace_id TEXT,
  request_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Indexes:
- Unique `(game_id, turn_number, attempt)` to prevent duplicate manifests.
- `(queue_entry_id)` for join performance.
- `(trace_id)` to support tracing.

`manifest_hash` is `sha256(manifest::text)`; `precompute_hash` is `sha256(precompute_section::text)` enabling idempotency checks.

### 5.3 JSON Structure (`manifest` column)

```json5
{
  "version": "1.0.0",
  "job": {
    "queue": "turn-precompute",
    "queueEntryId": "5a9c…",
    "jobId": "5a9c…",             // payload id
    "attempt": 2,
    "leaseId": "8f21…",
    "workerId": "turn-precompute@ip-10-0-0-12",
    "claimedAt": "2025-02-10T05:10:21.523Z",
    "releasedAt": "2025-02-10T05:10:29.104Z"
  },
  "request": {
    "traceId": "trace-123",
    "requestId": "req-456",
    "issuedBy": "turn-controller",
    "action": {
      "type": "deploy_probe",
      "params": {...}
    },
    "sourceStateDigest": "sha256-abc123",
    "seed": "7d8b...",
    "preconditions": {
      "turnNumber": 12,
      "day": 7,
      "segment": "Mars Orbit"
    }
  },
  "precompute": {
    "startedAt": "2025-02-10T05:10:21.600Z",
    "completedAt": "2025-02-10T05:10:28.100Z",
    "durationMs": 6500,
    "deterministic": {
      "checks": [...],
      "selectedAction": {...},
      "event": {...},
      "rng": {"seed": "…", "rolls": [...]}
    },
    "llmCalls": [
      {"model": "gpt-4.5", "promptTemplate": "turn_narrative", "promptHash": "…", "latencyMs": 3200, "cache": "miss"},
      {"model": "gpt-4.5", "promptTemplate": "turn_actions", "promptHash": "…", "latencyMs": 1800, "cache": "hit"}
    ],
    "imagePlan": {
      "cacheKey": "…",
      "template": "crew-heroics",
      "style": "game_ega_vga",
      "cacheHit": false
    },
    "warnings": [],
    "precomputeHash": "sha256-zzz"
  },
  "apply": {
    "startedAt": "2025-02-10T05:10:28.150Z",
    "completedAt": "2025-02-10T05:10:28.340Z",
    "durationMs": 190,
    "transaction": {
      "id": "pg-xact-123",
      "tablesTouched": ["games", "turns", "turn_jobs"],
      "rowsWritten": 4
    },
    "stateDiff": {
      "previousDigest": "sha256-abc123",
      "nextDigest": "sha256-def456",
      "statChanges": {"oxygen": -5, "morale": +3},
      "turnRecordId": "turn-0013"
    },
    "imageJob": {
      "queueEntryId": "ae32...",
      "status": "enqueued",
      "precomputedMetadata": {...}
    },
    "socket": {"emitted": true, "namespace": "/game", "room": "game-123"},
    "errors": []
  },
  "postconditions": {
    "gameComplete": false,
    "failureResolved": null
  },
  "attachments": {
    "logs": "s3://…/trace-123.log",
    "promptArtifacts": "s3://…/prompts/trace-123.json"
  }
}
```

### 5.4 Data Capture Workflow
1. **Enqueue** attaches `traceId` and `requestId` to `queue_entries`.
2. **Precompute Worker**:
   - At claim: capture source state digest (`sha256(JSON.stringify(stateProjection))`).
   - After deterministic computations + LLM calls: build `precompute` section and persist provisional manifest (status `precompute_only`) with `precompute_hash`.
3. **Apply Worker**:
   - Before transaction: load provisional manifest and verify `precompute_hash` matches input payload (idempotency gate).
   - During transaction: compute `stateDiff`, `rowsWritten`, `imageJob` references.
   - After commit: update manifest row with `apply` section, set `manifest_hash`, bump `updated_at`.
4. **Failure Cases**:
   - Precompute failure → manifest row with `apply.errors` absent, `job.outcome = 'failed-precompute'`.
   - Apply failure → manifest row with `apply.errors` populated and `stateDiff` omitted. Transaction rollback ensures digest mismatch flagged.
- **Consistency Guarantees:**
  - Precompute manifest insert and lease completion occur in a single transaction; failure to persist manifest forces a retry and prevents apply enqueue.
  - Apply worker updates manifest within the same DB transaction used for `processTurnWithTransaction` via after-commit hook: if the transaction rolls back, manifest changes are discarded and job marked transient failure.
  - Manifest hash comparisons happen before commit to guarantee deterministic replay.

### 5.5 Retention & Access
- Retain manifests for 30 days in primary DB; archive older entries to cold storage nightly (NDJSON export to S3) while retaining hashes locally for dedupe.
- Table partitioning:
  - Range partition by `created_at` (monthly) to keep VACUUM fast and allow dropping old partitions cheaply.
  - Alternate strategy: hash partition on `game_id` if replay queries are predominantly game-scoped.
- Archive job includes verification step (row count + checksum) before dropping partition.
- Admin API: `/api/admin/games/:id/manifests?turn=12` returns latest manifest.
- CLI tooling: `npm run turn-manifest -- --game game123 --turn 12 --attempt 2 --write-to ./manifests/`.
- Dead-letter retention: keep dead-letter manifests in hot storage for 90 days; auto-purge queue payloads older than 30 days after successful archive.

### 5.6 Replay & Idempotency
- Replay runner reuses `precompute` payload to regenerate expected apply state and compares resulting digest with stored `apply.stateDiff.nextDigest`. Divergence triggers alert.
- On job retry, orchestrator fetches latest manifest. If `precompute_hash` already matches, skip recomputation and proceed directly to apply (idempotent resume).
- For cross-worker coordination, apply worker rejects payload if `precompute_hash` mismatches, causing orchestrator to requeue precompute phase.

### 5.7 Security & PII
- Manifest intentionally excludes user-entered free text beyond what already exists in game state to avoid storing additional PII.
- Sensitive errors (e.g., provider tokens) are redacted before writing `errors`.
- Access restricted to admin roles; API returns masked LLM prompts unless `includePrompts=true` and caller has `engineer` scope.

### 5.8 Versioning & Compatibility
- Manifest `version` follows semver; readers must support the latest minor release and the previous two.
- Schema evolution:
  - Backward-compatible changes (additive fields) bump minor version; incompatible changes bump major.
  - Provide TypeScript decoder per version with unit tests sourced from fixture manifests.
- Migration strategy:
  - Older manifests remain immutable; replay tooling dispatches to the decoder matching `manifest.version`.
  - If critical fields change, supply one-off migration script to emit transformed copies into cold storage while leaving originals intact.

### 5.9 Image Manifest Strategy
- Phase 1: Image job outcomes recorded inside the parent turn manifest (`apply.imageJob` and post-turn socket events).
- Phase 2 (opt-in): Introduce `image_execution_manifests` table for standalone image workflows (e.g., admin image regeneration). Table mirrors turn manifest schema minus game-specific fields.
- Standalone `/api/generate-image` requests create an image manifest even when no turn exists; turn manifest keeps pointer via `imageJob.queueEntryId`.
- Replay tooling reads image manifests to reconcile cache hits/misses independently of turn replay.

---

## 6. Rollout Plan

1. **Dual-Write Foundations (Week 0-1)**
   - Deploy schema for `queue_entries`, `queue_leases`, `turn_execution_manifests`.
   - Wrap enqueue sites to dual-write: legacy tables + orchestrator (idempotency keys ensure dedupe).
   - Turn on manifest persistence in staging and verify precompute/apply sections populate correctly.
2. **Parity Validation (Week 1-2)**
   - Compare queue depth metrics between legacy polling and orchestrator.
   - Run backfill script to mirror existing `turn_jobs` into `queue_entries`.
   - Document rollback: prepare branch with legacy processors to redeploy if critical issues emerge.
3. **Production Cutover (Week 2-3)**
   - Deploy orchestrator workers (`turn-precompute`, `turn-apply`, `image`) into production and stop scheduling legacy processors.
   - Track error rate, latency SLOs, dead-letter counts; rollback requires redeploying the legacy build.
4. **Apply & Image Stabilisation (Week 3-4)**
   - Exercise end-to-end flows (turns + imagery) under load; confirm manifests, socket events, and cache hits behave as expected.
   - Ensure compatibility wrapper for `turn_jobs.status` reads from orchestrator-backed view.
5. **Operational Hardening (Week 4-5)**
   - Add stuck-job sweeper using `markStuck`.
   - Pilot Replay Runner against production-like recordings and verify deterministic hashes.
   - Train on-call engineers using new runbooks.
6. **Cleanup & Decommissioning (Week 5-6)**
   - After two weeks of stable metrics, disable legacy polling loops.
   - Remove dual-write, keeping migration scripts for rollback.
   - Schedule quarterly disaster-recovery drill (simulate orchestrator outage + rollback).

---

## 7. Open Questions & Risks

- **Payload Schema Evolution:** How do we version `action_payload` and ensure manifests reference the correct decoder? Proposal: include `payload_version` column in `queue_entries.metadata`.
- **Trace ID Propagation:** Need agreement on standard header (`x-trace-id`) from Gateway → orchestrator.
- **Cold Storage Format:** Do we mirror manifest JSON as NDJSON files per day or push into data warehouse? Requires ops input.
- **Image Queue Alignment:** Image jobs currently created within DB transaction; evaluate whether to emit separate manifests (`image_execution_manifests`) or embed in turn manifest only.
- **High Availability:** Postgres `LISTEN/NOTIFY` is best-effort; ensure workers continue polling and evaluate need for dedicated notification service when scaling horizontally.

---

**Next Steps:** Review spec with platform leads, capture implementation tickets (schema migration, orchestrator wrapper, manifest writer, tooling), and schedule pilot deployment in staging.
