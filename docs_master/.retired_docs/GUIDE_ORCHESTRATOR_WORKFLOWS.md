# Orchestrator & Manifest Architecture Guide

**Audience:** Gameplay backend engineers, platform SREs, and tech leads  
**Status:** Draft for review (aligns with `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`)  
**Related Docs:** `GAME_EXECUTION_FLOW.md`, `TRANSACTION_BOUNDARIES_ARCHITECTURE.md`, `MODULE_STORAGE.md`

---

## 1. Why This Exists

We are replacing ad hoc polling workers with a shared control plane that:

- Centralizes queue semantics in a `JobOrchestrator` interface.
- Splits turn processing into explicit **Precompute** and **Apply** queues while keeping image work separate.
- Captures rich execution manifests for every attempt to support replay, audits, and rapid troubleshooting.

This guide walks through the runtime architecture and day-to-day workflows so teams can implement, operate, and extend the system confidently.

---

## 2. Architecture At A Glance

```
┌────────────────────────────────────────────────────────────────────┐
│                          Control Plane                             │
│                                                                    │
│  ┌─────────────┐   claims/leases   ┌─────────────┐                │
│  │ JobProducer │ ─────────────────►│ JobOrchestr.│◄─ LISTEN/NOTIFY │
│  └─────────────┘   (enqueue, wake) └─────┬───────┘                │
│                                          │                        │
│                     queue_entries / leases│                        │
│                                          ▼                        │
│                                    PostgreSQL                      │
└──────────────┬────────────────────────────┬────────────────────────┘
               │                            │
       turn-precompute               turn-apply                image
      ┌────────────────┐          ┌────────────────┐      ┌────────────────┐
      │ Precompute Wkr │          │ Apply Worker   │      │ Image Worker   │
      └──────┬─────────┘          └──────┬─────────┘      └──────┬─────────┘
             │                           │                        │
             │ manifest: precompute      │ manifest: apply        │ manifest: image
             ▼                           ▼                        ▼
      turn_execution_manifests   turn_execution_manifests   image_execution_manifests*
             │                           │                        │
             ▼                           ▼                        ▼
      Storage layer / game state    Socket.IO events        Generated assets
```

*`image_execution_manifests` can be a future extension; initial rollout nests image references inside turn manifests.

**Key roles**
- **Job Producers:** Routes (REST + Socket.IO), background schedulers, or admin tooling that enqueue work with trace metadata and idempotency keys.
- **Job Orchestrator:** Shared library that abstracts queue operations across backends. The first implementation uses Postgres tables (`queue_entries`, `queue_leases`) plus `LISTEN/NOTIFY`.
- **Workers:** Queue-specific executors (turn precompute/apply, image) that only depend on the orchestrator interface and the storage layer.
- **Manifest Store:** Tables (`turn_execution_manifests`, `image_execution_manifests`) holding structured records for each attempt.

---

## 3. Component Inventory

- **`JobOrchestrator` interface** (`SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4):
  - Normalizes enqueue/claim/lease semantics.
  - Emits queue metrics and structured logs.
  - Supports command topics for wake/drain/pause.
  - Applies per-queue idempotency keys (`${queue}:${gameId}:${turnNumber}:${actionFingerprint}`) so retries stay safe.
- **Postgres backend (`queue_entries`, `queue_leases`)**:
  - Stores queue metadata, lease ownership, and retry state.
  - Provides dedupe via `idempotency_key`.
  - Uses partial indexes (`queue + status='pending'`) for fast claims and `LISTEN/NOTIFY` to wake workers; polling fallback remains every 5s.
  - Lease history can run in full-audit mode (writes to `queue_leases`) or lightweight mode (store expiry columns directly) based on configuration.
- **Workers**:
  - `TurnPrecomputeWorker`: deterministic compute, LLM calls, image metadata planning.
  - `TurnApplyWorker`: executes transactional updates via `storage.processTurnWithTransaction`, triggers sockets, enqueues image jobs.
  - `ImageWorker`: resolves cached/generative assets and updates turns.
- **Manifest writer**:
  - Precompute worker creates/updates manifest rows with deterministic payloads and hashes.
  - Apply worker enriches manifest with transaction diff, socket/image side effects, and overall outcome.
- **Observability adapters**:
  - Metrics: `queue_*` gauges and histograms, turn/image latency, manifest counts.
  - Logging: JSON logs keyed by `traceId`, `jobId`, `leaseId`.
  - Tracing: trace IDs propagate from HTTP requests through queue entries to manifests.

---

## 4. End-to-End Workflows

### 4.1 Enqueueing a Turn
1. **Route handler** validates `ActionInput`, resolves player/session, and generates `traceId`/`requestId` (propagated from gateway when present).
2. **Turn job payload** (existing `turn_jobs` row) inserted; orchestrator `enqueue` called with:
   - `queue='turn-precompute'`
   - `payload` reference (`payload_table='turn_jobs'`, `payload_id`)
   - `idempotencyKey = ${gameId}:${turnNumber}:${actionHash}`
   - Optional `runAt` for delayed turns (interview scheduling).
3. Postgres trigger emits `NOTIFY queue_turn-precompute`; workers wake immediately instead of waiting for polling interval.

### 4.2 Turn Precompute Worker
1. Calls `claim('turn-precompute', workerId, { batchSize })` to receive leases.
2. For each lease:
   - Loads payload via `SELECT ... FOR UPDATE SKIP LOCKED`.
   - Computes `sourceStateDigest` (hash of projected game state).
   - Runs deterministic checks + seeded randomness.
   - Performs LLM calls using cached prompt plans (record latency + cache hits).
   - Prepares image metadata (cache lookup only).
   - Writes/updates manifest:
     - `job` section (lease, attempt, timing).
     - `request` and `precompute` sections including `precompute_hash`.
   - Calls `complete()` on lease, optionally passing summary metrics.
3. If LLM fails transiently:
   - Calls `fail({ reason: 'transient', ... }, { retryDelayMs })`.
   - Manifest still records failure (no apply section); orchestrator requeues after backoff.
4. On unexpected crash:
   - Lease expires → orchestrator increments attempt count, returns job to pending, manifest notes heartbeat timeout on next attempt.

### 4.3 Turn Apply Worker
1. Listens on `turn-apply` queue; orchestrator enqueues apply jobs from precompute completion (same payload id).
2. On claim:
   - Loads latest manifest and verifies `precompute_hash` matches payload’s computed hash; mismatch triggers `fail(permanent)` and requests fresh precompute.
   - Executes `storage.processTurnWithTransaction`, injecting precomputed artifacts (`turnContent`, `actions`, `checks`, etc.).
   - Calculates `stateDiff` (stat deltas, turn record IDs, digest before/after).
   - Enqueues image job via orchestrator (capturing `traceId`).
   - Emits Socket.IO event (recorded in manifest).
   - Updates manifest `apply` section, sets `manifest_hash`, and marks success.
3. If transaction fails (constraint, deadlock):
   - Manifest records error with `apply.errors`.
   - Worker invokes `fail({ reason: 'transient' })` so orchestrator retries after backoff.

### 4.4 Image Workflow
1. Image enqueue occurs during turn apply; orchestrator stores payload reference in `image_jobs`.
2. Image worker claim flow mirrors precompute:
   - Respects cache hits (manifest notes `cacheHit` true).
   - On generation success, updates turn + manifest; on failure, marks job as dead-letter but turn remains complete.
3. Image status updates emit Socket.IO `imageReady` / `imageFailed`, enabling UI refresh and manifest audit.

### 4.5 Replay / Resume
- Replay tooling fetches manifest by `gameId`/`turnNumber` and re-runs deterministic functions with stored `precompute` payload; compares digests to assert determinism.
- If an apply attempt crashes mid-flight, next attempt verifies `precompute_hash` and can skip recompute if payload unchanged.

### 4.6 Precompute ↔ Apply Coupling
- Precompute worker is the gatekeeper: it only calls `orchestrator.enqueue('turn-apply', …)` after persisting the provisional manifest and completing its lease.
- Apply enqueue uses the same `traceId` and an `apply`-scoped idempotency key (`${gameId}:${turnNumber}:apply`); failures mark the precompute lease as transient so the job retries.
- Apply worker refuses to run unless the manifest hash matches; mismatch triggers a forced precompute replay.
- Dead-lettered apply jobs automatically flip the original precompute job back to pending with `forceRerun=true` so the deterministic payload can be regenerated.

---

## 5. Operational Guidance

- **Metrics Dashboard**
  - Monitor `queue_pending{queue="turn-precompute"}`; warn at 100, page at 500.
  - Track `turn_manifest_apply_duration_ms` vs. `turn_manifest_precompute_duration_ms` to spot LLM slowness or DB contention.
  - Alert on `queue_dead_letter_total` growth (>50/24h) and `queue_lease_timeout_total` spikes (>10/hour).
  - SLO targets: p99 `turn-precompute < 10s`, `turn-apply < 1s`, `image < 15s`; processing availability ≥ 99.9%.
- **Logs & Traces**
  - Standard log fields: `traceId`, `queue`, `jobId`, `leaseId`, `workerId`, `attempt`, `event`.
  - Use `traceId` to stitch API request → manifest → worker logs → client socket events.
- **Stuck Jobs**
  - Run `markStuck({ queue, olderThan })` via ops CLI to surface stale entries.
  - Inspect manifest for last successful attempt; decide between replay or manual fix.
- **Dead Letters**
  - Admin endpoint exposes dead-letter payloads; choose replay (re-enqueue) or discard after triage.
  - Manifest retains context even after replay, enabling forensic comparison. Nightly job exports >30 day dead letters before purge.
- **Schema Migration Order**
  1. Deploy `queue_entries`, `queue_leases`, `turn_execution_manifests` (dual-write still disabled).
  2. Enable dual-write in staging; verify parity between `turn_jobs` polling and orchestrator metrics.
  3. Perform production cutover by deploying orchestrator workers and retiring legacy processors; rollback requires redeploying the previous release.
  4. After two stable weeks, remove dual-write and delete legacy polling code.

---

## 6. Failure Scenarios & Playbooks

- **LLM Provider Outage**
  - Precompute worker marks jobs `transient` with exponential backoff.
  - Operators can use `publishCommand('turn-precompute', 'pause')` to stop claims temporarily.
  - Manifest highlights repeated provider errors, aiding comms with vendor.
- **Database Slowdown**
  - Apply workers observe rising transaction durations; manifests show increased `apply.durationMs`.
  - Use `markStuck` to detect expired leases; consider reducing concurrency or performing DB maintenance.
- **Worker Crash Loop**
  - Lease expirations increment attempt counts; monitor `queue_lease_timeout_total`.
  - Replay manifests to reproduce crash locally; include `payload_id` and `precompute_hash`.
- **Inconsistent Turn State**
  - Compare manifest `stateDiff.nextDigest` with current game snapshot; mismatch indicates manual DB edits or bug → triggers replay investigation.

---

## 7. Implementation Checklist

- [ ] Add orchestrator config (`config/queues.ts`) with lease durations and attempt limits.
- [ ] Wrap existing enqueue sites with `JobOrchestrator.enqueue`.
- [ ] Refactor workers to depend on orchestration interface (ensure heartbeats).
- [ ] Implement manifest writer (precompute + apply) with hash validation.
- [ ] Instrument metrics, structured logging, and tracing propagation.
- [ ] Document ops commands (`publishCommand`, `markStuck`, dead-letter replay).
- [ ] Build compatibility layer for legacy `turn_jobs` reads (dashboards/Admin APIs).
- [ ] Update runbooks and training for on-call engineers; include rollback drills.

---

## 8. References

- `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` — API surface and schema definitions.
- `GAME_EXECUTION_FLOW.md` — Core turn/image processing model.
- `TRANSACTION_BOUNDARIES_ARCHITECTURE.md` — Guidance on minimizing transaction scope.
- `MODULE_STORAGE.md` — Storage-layer primitives (`processTurnWithTransaction`, job CRUD).

Review this guide side-by-side with the spec when implementing to ensure architecture and workflow decisions stay aligned.
