# Orchestrator & Manifest Implementation Playbook (Simplified)

**Audience:** Implementation engineers, tech leads, SRE/on-call rotation  
**Status:** Simplified plan without backward compatibility  
**Primary References:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`, `GUIDE_ORCHESTRATOR_WORKFLOWS.md`

---

## 1. Overview
- **Objective:** Deliver the new orchestrator + manifest control plane while preserving deterministic game flow and unlocking replay/observability.
- **Scope:** Turn and image queues, worker lifecycle, manifest capture, migrations, rollout, and operational readiness.
- **Approach:** Hard cutover - no feature flags, no dual-write, no gradual rollout. System will be broken during transition until complete.

---

## 2. Implementation Plan

### Phase 0 — Kickoff (Week 0)

**Objectives:**
- Prepare infrastructure and planning
- Establish team coordination processes

**Tasks:**
- Create implementation ticket tracker (GitHub issues/linear)
- Document dependencies between phases
- Establish weekly sync meeting cadence
- Verify staging database access
- Confirm migration rollback procedures

---

### Phase 1 — Foundation & Schema (Weeks 1-2)

**Objectives:**
- Deploy database schema for orchestrator and manifests
- Create orchestrator interface skeleton
- Replace legacy enqueue sites with orchestrator calls
- Add idempotency and trace ID plumbing

**Tasks:**

#### 1.1 Database Migrations
- **Files:** `server/migrations/YYYYMMDD_create_queue_entries.sql`, `server/migrations/YYYYMMDD_create_queue_leases.sql`, `server/migrations/YYYYMMDD_create_turn_execution_manifests.sql`
- **Actions:**
  - Create `queue_entries` table per spec §4.8
  - Create partial indexes: `idx_queue_pending` on `(queue, run_at, priority DESC) WHERE status = 'pending'`
  - Create unique partial index on `(queue, idempotency_key)` WHERE idempotency_key IS NOT NULL
  - Create `idx_queue_status_updated` on `(queue, status, updated_at)`
  - Create `queue_leases` table per spec §4.8
  - Create `turn_execution_manifests` table per spec §5.2
  - Create unique index on `(game_id, turn_number, attempt)`
  - Create indexes on `(queue_entry_id)` and `(trace_id)`
- **Rollback:** Document rollback SQL scripts

#### 1.2 Orchestrator Type Definitions
- **File:** `server/orchestrator/types.ts` (new)
- **Action:** Define TypeScript interfaces per spec §4.2:
  - `QueueName`, `EnqueueOptions`, `JobLease<TPayload>`, `JobFailure`, `JobOrchestrator`, `QueueMetrics`

#### 1.3 Orchestrator Interface Skeleton
- **File:** `server/orchestrator/postgresOrchestrator.ts` (new)
- **Action:** Implement `JobOrchestrator` interface with stub methods:
  - `enqueue()` - insert into `queue_entries` + legacy payload table (payload table needed for worker data access)
  - `claim()` - placeholder that returns empty array (orchestrator disabled until Phase 2)
  - `heartbeat()`, `markStuck()`, `publishCommand()`, `getQueueMetrics()` - stubs
- **Note:** Still insert into legacy `turn_jobs`/`image_jobs` tables because workers need to load payload data. This is the data model, not dual-write for compatibility.

#### 1.4 Idempotency Key Generation
- **File:** `server/orchestrator/idempotency.ts` (new)
- **Action:** Implement canonical action hashing:
  - Function `generateIdempotencyKey(queue: QueueName, gameId: string, turnNumber: number, actionPayload: ActionInput): string`
  - Use SHA-256 digest of canonical JSON stringified `actionPayload`
  - Format: `${queue}:${gameId}:${turnNumber}:${actionHash}`
- **Tests:** `server/orchestrator/__tests__/idempotency.test.ts`

#### 1.5 Trace ID Propagation
- **File:** `server/middleware/tracing.ts` (new)
- **Action:** 
  - Extract `x-trace-id` header from requests (or generate UUID)
  - Attach to request object: `req.traceId`
  - Pass through to orchestrator `enqueue()` calls
- **Integration:** Add middleware to `server/index.ts` before routes

#### 1.6 Replace Turn Job Enqueue
- **File:** `server/storage.ts`
- **Action:** Replace `createTurnJob()` to:
  - Insert legacy `turn_jobs` row (payload storage)
  - Call `orchestrator.enqueue()` with:
    - `queue: 'turn-precompute'`
    - `payload_table: 'turn_jobs'`, `payload_id: job.id`
    - Generated `idempotencyKey`
    - `traceId` from request context
- **Note:** No feature flag check—this is the only path.

#### 1.7 Replace Image Job Enqueue
- **File:** `server/storage.ts`
- **Action:** Replace `createImageJob()` to:
  - Insert legacy `image_jobs` row (payload storage)
  - Call `orchestrator.enqueue()` with:
    - `queue: 'image'`
    - `payload_table: 'image_jobs'`, `payload_id: job.id`
    - Generated `idempotencyKey: 'image:${job.id}'`
    - `traceId` from request context

#### 1.8 Orchestrator Initialization
- **File:** `server/orchestrator/index.ts` (new)
- **Action:** 
  - Export singleton `JobOrchestrator` instance (Postgres backend)
  - Initialize on server startup
- **Integration:** Import in `server/index.ts`, pass to `storage` or route handlers

#### 1.9 Unit Tests
- **Files:** `server/orchestrator/__tests__/idempotency.test.ts`, `server/orchestrator/__tests__/enqueue.test.ts`
- **Action:** Test idempotency key generation, enqueue behavior, deduplication

#### 1.10 Staging Deployment
- Deploy migrations to staging
- Deploy orchestrator enqueue (workers still use legacy polling until Phase 3)
- Verify `queue_entries` populated when jobs created
- Legacy workers continue processing from `turn_jobs`/`image_jobs` tables

---

### Phase 2 — Orchestrator Backend (Weeks 2-3)

**Objectives:**
- Complete Postgres orchestrator implementation
- Add lease management, heartbeat batching, stuck-job sweeper
- Implement priority ordering and dead-letter handling
- Expose admin APIs and metrics

**Tasks:**

#### 2.1 Queue Configuration
- **File:** `server/config/queues.ts` (new)
- **Action:** Define queue configs per spec §4.3:
  - `turn-precompute`: lease 2min, max attempts 3
  - `turn-apply`: lease 30s, max attempts 5
  - `image`: lease 2min, max attempts 4

#### 2.2 Implement `claim()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Query `queue_entries` with `FOR UPDATE SKIP LOCKED` on `status='pending'` and `run_at <= NOW()`
  - Order by `priority DESC, run_at ASC, created_at ASC`
  - Limit by `batchSize` (default 5)
  - Create `queue_leases` row for each claimed job
  - Update `queue_entries` status to 'leased', set `lease_id`, `lease_owner`, `lease_expires_at`
  - Load payload via `SELECT * FROM ${payload_table} WHERE id = ${payload_id} FOR UPDATE SKIP LOCKED`
  - Return `JobLease[]` with `extend()`, `complete()`, `fail()`, `release()` methods
- **Tests:** `server/orchestrator/__tests__/claim.test.ts`

#### 2.3 Implement `extend()` / `heartbeat()` Methods
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - `extend(leaseId, extensionMs)` updates `queue_leases.heartbeat_expires_at` and `renewed_at`
  - `extendMany([leaseIds], ms)` batches updates in single transaction
  - Validate lease exists and not expired
- **Tests:** `server/orchestrator/__tests__/heartbeat.test.ts`

#### 2.4 Implement `complete()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Update `queue_entries.status = 'completed'`, clear lease fields
  - Update `queue_leases.outcome = 'completed'`, `outcome_details` with optional result
  - Emit metrics: `queue_completed_total`
- **Tests:** `server/orchestrator/__tests__/complete.test.ts`

#### 2.5 Implement `fail()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - If `reason='transient'` and `attempts < maxAttempts`:
    - Calculate exponential backoff: `min(5s * 2^(attempts-1), 120s)`
    - Update `queue_entries.status='pending'`, `run_at = NOW() + backoff`, `attempts += 1`
  - If `reason='permanent'` or `attempts >= maxAttempts`:
    - Update `queue_entries.status='dead_letter'`, store `last_error`
  - Update `queue_leases.outcome = 'failed'`, `outcome_details` with error
  - Emit metrics: `queue_failed_total`, `queue_dead_letter_total`
- **Tests:** `server/orchestrator/__tests__/fail.test.ts`

#### 2.6 Implement `release()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Update `queue_entries.status='pending'`, clear lease fields (no attempt increment)
  - Update `queue_leases.outcome='released'`
- **Tests:** `server/orchestrator/__tests__/release.test.ts`

#### 2.7 Implement `markStuck()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Query `queue_entries` where `status='leased'` and `lease_expires_at < olderThan`
  - Update to `status='pending'`, `attempts += 1`, clear lease fields
  - Record timeout in `queue_leases.outcome_details`
  - Return list of job IDs
- **Tests:** `server/orchestrator/__tests__/markStuck.test.ts`

#### 2.8 Implement `publishCommand()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Use Postgres `NOTIFY queue_${queue}` for 'wake' command
  - Store 'pause' / 'drain' state in metadata table or in-memory flag
  - Workers `LISTEN` on channels and poll every 5s as fallback

#### 2.9 Implement `getQueueMetrics()` Method
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:**
  - Query counts: `pending`, `in_progress` (leased), `delayed` (pending with run_at > NOW()), `dead_letter`
  - Find `oldestPendingCreatedAt` for oldest pending job
  - Return `QueueMetrics` object
- **Tests:** `server/orchestrator/__tests__/metrics.test.ts`

#### 2.10 Stuck-Job Sweeper Service
- **File:** `server/orchestrator/stuckJobSweeper.ts` (new)
- **Action:**
  - Run `markStuck()` every 60 seconds via `setInterval`
  - Log found stuck jobs
  - Emit `queue_lease_timeout_total` metric
- **Integration:** Start in `server/index.ts` after orchestrator init

#### 2.11 Prometheus Metrics Integration
- **File:** `server/metrics.ts`
- **Action:** Add metrics per spec §4.7:
  - `queue_pending{queue}` (gauge), `queue_in_progress{queue}` (gauge)
  - `queue_completed_total{queue}` (counter), `queue_failed_total{queue}` (counter)
  - `queue_dead_letter_total{queue}` (counter), `queue_lease_timeout_total{queue}` (counter)
  - `queue_attempts_histogram{queue}` (histogram), `queue_latency_histogram{queue}` (histogram)

#### 2.12 Structured Logging
- **File:** `server/orchestrator/postgresOrchestrator.ts`
- **Action:** Add JSON logs with fields:
  - `event` (enqueue/claim/complete/fail), `queue`, `jobId`, `leaseId`, `workerId`, `attempt`, `traceId`, `durationMs`, `result`

#### 2.13 Admin API Endpoints
- **File:** `server/routes.ts` or `server/routes/adminQueues.ts` (new)
- **Action:** Add endpoints:
  - `GET /api/admin/queues/:queue/metrics` - return queue metrics
  - `GET /api/admin/queues/:queue/dead-letter` - list dead-letter jobs
  - `POST /api/admin/queues/:queue/dead-letter/:jobId/replay` - re-enqueue dead-letter job
  - `POST /api/admin/queues/:queue/command` - publish command (wake/drain/pause)
  - `POST /api/admin/queues/:queue/mark-stuck` - manually trigger stuck job sweep
- **Auth:** Require `requireAdmin` middleware

#### 2.14 Integration Tests
- **File:** `server/orchestrator/__tests__/integration.test.ts`
- **Action:** Test full workflow: enqueue → claim → extend → complete/fail cycles

#### 2.15 Staging Deployment
- Deploy orchestrator backend to staging
- Smoke-test admin APIs
- Verify `LISTEN/NOTIFY` command channel
- Test metrics collection

---

### Phase 3 — Manifest Writer Integration & Worker Replacement (Weeks 3-4)

**Objectives:**
- Integrate manifest capture into precompute and apply workers
- Implement hash validation and idempotency checks
- Build replay tooling and admin APIs
- **Replace legacy workers with orchestrator workers (hard cutover)**

**Tasks:**

#### 3.1 Manifest Schema Types
- **File:** `server/orchestrator/manifest/types.ts` (new)
- **Action:** Define TypeScript types for manifest JSON structure per spec §5.3

#### 3.2 Manifest Writer Module
- **File:** `server/orchestrator/manifest/writer.ts` (new)
- **Action:** Implement functions:
  - `createProvisionalManifest()`, `updatePrecomputeSection()`, `updateApplySection()`
  - `computePrecomputeHash()`, `computeManifestHash()` (SHA-256)

#### 3.3 Storage Methods for Manifests
- **File:** `server/storage.ts`
- **Action:** Add methods:
  - `createTurnExecutionManifest()`, `getTurnExecutionManifest()`, `updateTurnExecutionManifest()`
- **Schema:** Add `TurnExecutionManifest`, `InsertTurnExecutionManifest` to `shared/schema.ts`

#### 3.4 Precompute Worker Integration
- **File:** `server/orchestrator/workers/turnPrecomputeWorker.ts` (new)
- **Action:** 
  - Claim jobs from `turn-precompute` queue
  - Load game state, compute `sourceStateDigest`
  - Run deterministic checks + LLM calls (existing logic from `turnJobProcessor.ts`)
  - Build `precompute` section with LLM call metadata, image plan, warnings
  - Call `manifestWriter.updatePrecomputeSection()` with `precompute_hash`
  - On success: `lease.complete()`, then `orchestrator.enqueue('turn-apply', ...)`
  - On failure: `lease.fail(reason)`, record error in manifest

#### 3.5 Apply Worker Integration
- **File:** `server/orchestrator/workers/turnApplyWorker.ts` (new)
- **Action:**
  - Claim jobs from `turn-apply` queue
  - Load provisional manifest, verify `precompute_hash` matches payload
  - Execute `storage.processTurnWithTransaction()` with precomputed artifacts
  - Compute `stateDiff` (stat deltas, digest before/after)
  - Enqueue image job via orchestrator
  - Emit Socket.IO event
  - Update manifest `apply` section, set `manifest_hash`
  - `lease.complete()` on success, `lease.fail()` on transaction failure

#### 3.6 Image Worker Integration
- **File:** `server/orchestrator/workers/imageWorker.ts` (new)
- **Action:**
  - Claim jobs from `image` queue
  - Check cache, generate if miss (existing logic from `imageJobProcessor.ts`)
  - Update turn + manifest with image URL/metadata
  - Emit `imageReady`/`imageFailed` socket events
  - `lease.complete()` or `lease.fail()` accordingly

#### 3.7 Worker Lifecycle Management
- **File:** `server/orchestrator/workers/baseWorker.ts` (new)
- **Action:** 
  - Abstract worker class with:
    - `workerId` generation (`${queue}-${hostname}-${pid}`)
    - `LISTEN` setup for command topics
    - Polling loop with `claim()` → process → `complete()`/`fail()`
    - Heartbeat batching (`extendMany()` every 30s)
    - Graceful shutdown handling
- **Integration:** Extend by `TurnPrecomputeWorker`, `TurnApplyWorker`, `ImageWorker`

#### 3.8 Worker Startup Integration (HARD CUTOVER)
- **File:** `server/index.ts`
- **Action:**
  - Start orchestrator workers: `TurnPrecomputeWorker`, `TurnApplyWorker`, `ImageWorker`
  - **Stop/remove legacy `TurnJobProcessor` and `ImageJobProcessor` startup**
  - **Remove legacy polling intervals**
- **Note:** This breaks the system until orchestrator workers are functional. No feature flags.

#### 3.9 Manifest Replay Tooling
- **File:** `server/orchestrator/manifest/replay.ts` (new)
- **Action:**
  - `replayManifest(manifestId): Promise<ReplayResult>`
  - Re-run deterministic functions with stored `precompute` payload
  - Compare resulting digest with stored `apply.stateDiff.nextDigest`
  - Return divergence alerts if mismatch
- **CLI:** `scripts/replay-manifest.ts` for command-line usage

#### 3.10 Admin API for Manifests
- **File:** `server/routes.ts` or `server/routes/adminManifests.ts` (new)
- **Action:** Add endpoints:
  - `GET /api/admin/games/:gameId/manifests?turn=12&attempt=1` - fetch manifest
  - `POST /api/admin/manifests/:id/replay` - trigger replay
- **Auth:** Require `requireAdmin` middleware
- **Security:** Mask LLM prompts unless `includePrompts=true` and `engineer` scope

#### 3.11 Hash Validation Tests
- **Files:** `server/orchestrator/__tests__/manifest.test.ts`, `server/orchestrator/__tests__/replay.test.ts`
- **Action:** Test manifest hash computation, precompute hash validation, replay determinism

#### 3.12 Property-Based Tests
- **File:** `server/orchestrator/__tests__/manifestProperty.test.ts`
- **Action:** Use property-based testing to verify manifest replay matches original execution

#### 3.13 Staging Deployment
- Deploy orchestrator workers to staging (hard cutover from legacy)
- Verify manifests created for test turns
- Test replay tooling against fixtures
- Validate hash consistency

---

### Phase 4 — Staging Pilot & Resilience Drills (Weeks 4-5)

**Objectives:**
- Deploy orchestrator to staging environment
- Run failure scenario drills
- Validate alert thresholds and runbooks
- Document operational learnings

**Tasks:**

#### 4.1 Staging Deployment
- **Action:** Orchestrator workers already deployed in Phase 3
- **Monitoring:** Set up orchestrator metrics dashboards
- **Validation:** Verify queue depth, processing rate, error rates are healthy

#### 4.2 Failure Scenario: LLM Outage
- **Action:** Simulate OpenAI API failures (timeout/inject errors)
- **Expected:** Precompute workers mark jobs `transient`, exponential backoff
- **Validation:** Verify `queue_pending` grows, `queue_failed_total` increases, dead-letter count stable
- **Runbook:** Document `publishCommand('turn-precompute', 'pause')` procedure

#### 4.3 Failure Scenario: Worker Crash Loop
- **Action:** Kill worker processes repeatedly
- **Expected:** Lease expirations trigger `markStuck()`, jobs retry
- **Validation:** Monitor `queue_lease_timeout_total`, verify jobs eventually complete
- **Runbook:** Document worker restart procedure

#### 4.4 Failure Scenario: Database Slowdown
- **Action:** Inject DB latency (pg_sleep or connection pool exhaustion)
- **Expected:** Apply workers observe rising transaction durations
- **Validation:** Manifest `apply.durationMs` increases, alert thresholds trigger
- **Runbook:** Document DB maintenance procedures

#### 4.5 Failure Scenario: Lease Timeout
- **Action:** Stop heartbeats on active leases
- **Expected:** Stuck-job sweeper converts to pending after lease expiry
- **Validation:** Verify `markStuck()` runs, jobs retry
- **Runbook:** Document stuck job triage procedure

#### 4.6 Alert Threshold Validation
- **Action:** Verify Prometheus alerts trigger at:
  - `queue_pending{queue="turn-precompute"} > 100` (warn), `> 500` (page)
  - `queue_lease_timeout_total` increases >10/hour
  - `queue_dead_letter_total` grows >50 jobs/24h
- **Integration:** Link alerts to runbook docs

#### 4.7 Runbook Documentation
- **File:** `docs_master/current/ORCHESTRATOR_RUNBOOKS.md` (new)
- **Action:** Document:
  - High queue depth → scale workers
  - Lease timeouts → inspect worker health
  - Dead letters → triage + replay
  - LLM outage → pause queue, backoff
  - Database slowdown → reduce concurrency, maintenance

#### 4.8 Dead-Letter Export Job
- **File:** `server/orchestrator/deadLetterExporter.ts` (new)
- **Action:** Nightly job that:
  - Exports dead-letter metadata to NDJSON file (S3 or local)
  - Purges dead-letter entries older than 30 days
  - Retains manifests for 90 days
- **Integration:** Schedule via cron or `setInterval` in `server/index.ts`

#### 4.9 Archive Job for Manifests
- **File:** `server/orchestrator/manifestArchiver.ts` (new)
- **Action:** Nightly job that:
  - Exports manifests older than 30 days to NDJSON (S3)
  - Drops partitioned table partitions (if partitioned)
  - Verifies row count + checksum before deletion
- **Integration:** Schedule via cron or `setInterval`

#### 4.10 Lessons Learned Documentation
- **File:** `docs_master/current/ORCHESTRATOR_STAGING_LEARNINGS.md` (new)
- **Action:** Document performance bottlenecks, instrumentation gaps, runbook improvements

#### 4.11 Readiness Gate
- **Action:** Verify:
  - All failure scenarios handled gracefully
  - Alert thresholds tested and linked to runbooks
  - Dead-letter export/archive jobs running
  - On-call team trained on runbooks

---

### Phase 5 — Production Deployment (Weeks 5-6)

**Objectives:**
- Deploy orchestrator to production (hard cutover)
- Monitor error rates, latency, dead letters
- Validate system stability

**Tasks:**

#### 5.1 Production Deployment
- **Action:** Deploy orchestrator workers to production (hard cutover from legacy)
- **Rollback plan:** Keep previous deployment ready for quick rollback if needed
- **Monitor:** Error rate, p99 latency, dead-letter count for 24-48h
- **Rollback criteria:** Error rate +10%, p99 latency +50%, dead letters >5/hr
- **Note:** If issues occur, rollback via code deployment (no feature flags needed)

#### 5.2 Production Metrics Dashboard
- **Action:** Create Grafana/observability dashboard with:
  - Queue depth per queue
  - Processing rate (jobs/sec)
  - p50/p95/p99 latency per queue
  - Dead-letter counts
  - Lease timeout rates
  - Manifest counts

#### 5.3 Rollback Procedures
- **Action:** Document rollback steps:
  1. Revert code deployment to previous version (legacy workers)
  2. Verify queue processing resumes
  3. Investigate orchestrator issues in staging
- **File:** `docs_master/current/ORCHESTRATOR_ROLLBACK.md` (new)

#### 5.4 Replay Harness Auditing
- **File:** `server/orchestrator/manifest/audit.ts` (new)
- **Action:** Nightly job that:
  - Samples 1% of completed turns
  - Runs replay against manifests
  - Compares manifest digests vs live game state
  - Alerts on divergence
- **Integration:** Schedule in `server/index.ts`

#### 5.5 Stability Verification
- **Action:** After 2 weeks in production:
  - Verify error rates < baseline +5%
  - Verify latency SLOs met (p99 < 10s precompute, <1s apply, <15s image)
  - Verify dead-letter rate < 5/hour
  - Verify replay audits show <0.1% divergence

---

### Phase 6 — Hardening, Cleanup, Handover (Weeks 6-7)

**Objectives:**
- Train on-call team on new system
- Execute disaster recovery drill
- Remove legacy code (verify completeness)
- Archive implementation docs

**Tasks:**

#### 6.1 On-Call Training
- **Action:** Conduct training session covering:
  - Orchestrator architecture overview
  - Runbook procedures (high queue depth, lease timeouts, dead letters)
  - Admin API usage (`/api/admin/queues/*`)
  - Manifest replay tooling
  - Rollback procedures (code deployment)
- **Materials:** Runbook docs, architecture diagrams, video recording

#### 6.2 Disaster Recovery Drill
- **Scenario:** Simulate orchestrator outage (kill all workers)
- **Action:**
  1. Kill orchestrator worker processes
  2. Monitor stuck jobs accumulating
  3. Restart workers after 30 minutes
  4. Verify queue catch-up via `markStuck()` sweeper
  5. Verify jobs complete successfully
- **Documentation:** Record drill outcomes, update runbooks if needed

#### 6.3 Legacy Code Cleanup Verification
- **Files:** `server/turnJobProcessor.ts`, `server/imageJobProcessor.ts`
- **Action:**
  - Verify legacy processors are not imported or started anywhere
  - Remove files if completely unused (or mark as deprecated)
  - Search codebase for any remaining references
- **Validation:** Verify no code paths reference legacy processors

#### 6.4 Code Simplification
- **Files:** `server/storage.ts` (`createTurnJob`, `createImageJob`)
- **Action:**
  - Verify orchestrator `enqueue()` is the only path (no conditional logic)
  - Simplify error handling (no dual-write conflicts)
  - Remove any leftover feature flag checks
- **Validation:** Verify all jobs flow through orchestrator only

#### 6.5 Documentation Archive
- **Action:** Move implementation docs to "implemented" status:
  - Update `ORCHESTRATOR_IMPLEMENTATION_PLAYBOOK.md` with completion status
  - Archive staging learnings to historical folder
  - Update `SYSTEM_OVERVIEW.md` with orchestrator architecture
- **File:** `docs_master/current/ORCHESTRATOR_COMPLETION.md` (new)

#### 6.6 Retrospective
- **Action:** Conduct team retrospective:
  - What went well?
  - What could be improved?
  - Deferred ideas (Redis backend, image manifest split) → backlog
- **File:** `docs_master/current/ORCHESTRATOR_RETRO.md` (new)

#### 6.7 Backlog for Future Enhancements
- **Action:** Document deferred ideas:
  - Redis Streams or AWS SQS backend adapter
  - Separate `image_execution_manifests` table (Phase 2)
  - Data warehouse exports for analytics
  - Cross-worker coordination improvements
- **File:** `docs_master/current/ORCHESTRATOR_FUTURE.md` (new)

#### 6.8 Final Sign-Off
- **Action:** Verify:
  - All checklists completed
  - On-call team trained
  - Runbooks reviewed and accessible
  - Metrics dashboards deployed
  - DR drill completed successfully
  - Legacy code removed/verified unused
  - Documentation updated

---

## 3. Implementation Notes

### Dependencies Between Phases
- Phase 1 must complete before Phase 2 (schema required)
- Phase 2 must complete before Phase 3 (orchestrator interface required)
- Phase 3 must complete before Phase 4 (workers required)
- Phase 4 must complete before Phase 5 (staging validation required)
- Phase 5 must complete before Phase 6 (production stability required)

### Risk Mitigation
- Staging deployment before production (Phase 4)
- Rollback via code deployment if issues occur
- Comprehensive testing at each phase boundary
- Keep previous deployment ready for quick rollback

### Success Criteria
- Zero downtime during cutover (deploy orchestrator workers, stop legacy workers)
- Error rates within 5% of baseline
- Latency SLOs met (p99 targets per queue)
- Dead-letter rate < 5/hour
- On-call team confident operating new system

### Simplified Approach Benefits
- No feature flag infrastructure to maintain
- No dual-write complexity
- No parity monitoring overhead
- Cleaner codebase (single code path)
- Faster implementation (fewer moving parts)
- Easier testing (one system, not two)

### What Was Removed (vs Original Plan)
- **Feature flags:** No gradual rollout, no toggle between systems
- **Dual-write:** No writing to both orchestrator and legacy tables simultaneously
- **Compatibility view:** No `legacy_turn_jobs_v` mapping view
- **Parity monitoring:** No dashboards comparing legacy vs orchestrator
- **Gradual rollout:** No 10% → 50% → 100% phased approach
- **Legacy workers in parallel:** Hard cutover - legacy stops when orchestrator starts

---

## 4. Timeline & Milestones
- **Week 0:** Kickoff complete, tickets prioritized
- **Weeks 1-2:** Migrations + orchestrator enqueue merged; staging validation
- **Weeks 2-3:** Orchestrator backend functional in staging
- **Weeks 3-4:** Manifest end-to-end capture functional; workers replaced (hard cutover in staging)
- **Weeks 4-5:** Staging pilot finished with failure drills; readiness gate
- **Weeks 5-6:** Production deployment (hard cutover)
- **Weeks 6-7:** Legacy cleanup, DR drill, operational handoff
- **Beyond:** Optional backlog—alternate queue backends, image manifests v2, data warehouse exports

---

## 5. Checklists

### Engineering
- [ ] All migrations applied and reversible
- [ ] Orchestrator API covered by integration tests (claim/extend/fail paths)
- [ ] Workers refactored to orchestrator (legacy removed)
- [ ] Manifest writer + replay harness verified against fixtures

### Operations
- [ ] Dashboards + alert rules deployed
- [ ] Runbooks reviewed and linked from alerts
- [ ] Dead-letter purge + archive job scheduled
- [ ] On-call training session completed
- [ ] DR drill planned with success criteria

---

## 6. Next Actions
- Approve simplified playbook and assign phase ownership
- Create implementation tickets aligned with sections above
- Schedule kickoff (Week 0)
- Begin Phase 1 once migrations reviewed and staging environment prepared

