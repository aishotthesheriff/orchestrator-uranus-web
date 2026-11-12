# Job Orchestrator & Manifest Design Audit

**Date:** 2025-01-XX  
**Audience:** Platform architects, engineering leads, and implementation team  
**Status:** Design review for `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` and `GUIDE_ORCHESTRATOR_WORKFLOWS.md`  
**Related Docs:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`, `GUIDE_ORCHESTRATOR_WORKFLOWS.md`, `TRANSACTION_BOUNDARIES_ARCHITECTURE.md`, `GAME_EXECUTION_FLOW.md`

---

## Executive Summary

This audit reviews the Job Orchestrator & Manifest proposal for platform architects. The design is **well-structured and architecturally sound**, with clear separation of concerns and future-proof abstractions. However, **critical operational details are missing** that must be addressed before implementation.

**Overall Assessment:** ✅ **Approve with conditions**

**Key Findings:**
- ✅ Strong architectural foundation aligned with current patterns
- ⚠️ Missing migration strategy and rollback procedures
- ⚠️ Unclear consistency guarantees for manifest writes
- ⚠️ Operational concerns (dead-letter management, stuck jobs) need specification
- ⚠️ Performance validation needed for index design and manifest storage

**Estimated Implementation Effort:** 4-6 weeks for senior engineer (assuming high-priority items addressed)

---

## 1. Architecture Alignment Assessment

### ✅ Strengths

1. **Clear Separation of Concerns**
   - Precompute/Apply split aligns with `TRANSACTION_BOUNDARIES_ARCHITECTURE.md`
   - Orchestrator abstraction decouples queue semantics from worker logic
   - Manifest capture provides rich observability without coupling to execution

2. **Backward Compatibility**
   - Wrapping existing workers behind feature flags is a safe migration path
   - Existing code paths continue working during transition
   - Gradual rollout possible without downtime

3. **Observability Foundation**
   - Structured manifests enable replay and debugging
   - Trace ID propagation creates end-to-end visibility
   - Metrics hooks provide operational insights

4. **Future Flexibility**
   - Interface design allows backend swap (Redis, SQS) without changing workers
   - Queue configuration is externalized and version-controlled
   - Manifest schema versioning supports evolution

### ⚠️ Architectural Concerns

#### 1.1 State Machine Complexity vs. Current Model

**Current System:**
- `turn_jobs`: `pending` → `processing` → `completed`/`failed`
- `image_jobs`: `pending` → `processing` → `completed`/`failed`

**Proposed System:**
- `scheduled` → `pending` → `leased` → `completed`/`delayed`/`dead_letter`

**Gap:** The proposal introduces new states (`scheduled`, `leased`, `delayed`, `dead_letter`) without clearly defining migration strategy for existing jobs. The spec (§4.4) notes that `delayed` is represented as `pending` with `run_at > now`, which could conflict with existing polling logic.

**Recommendation:** Add migration strategy section covering:
- How to handle in-flight `processing` jobs during cutover
- Dual-write period duration and rollback procedures
- Compatibility layer for code paths that read `turn_jobs.status` directly

#### 1.2 Lease Management Overhead

**Current:** Simple `FOR UPDATE SKIP LOCKED` with `processing` status flag.

**Proposed:** Separate `queue_leases` table with heartbeats, expiration tracking, and renewal logic.

**Concern:** Adds significant overhead:
- Additional table writes per claim/renewal cycle
- More complex queries (JOINs between `queue_entries` and `queue_leases`)
- Risk of orphaned leases if workers crash mid-heartbeat

**Recommendation:** Validate necessity before scaling horizontally. Consider:
- Simpler initial model (lease metadata in `queue_entries` columns)
- Separate `queue_leases` table only if multi-worker coordination requires it
- Performance benchmarks showing lease overhead is acceptable

#### 1.3 Precompute/Apply Queue Split

**Proposal:** Splits turn processing into two queues:
- `turn-precompute`: LLM calls, deterministic compute
- `turn-apply`: DB transaction, Socket.IO emission

**Current:** Both phases run sequentially in `TurnJobProcessor.processJob()`.

**Gap:** The guide (§4.2-4.3) shows precompute enqueuing apply jobs, but spec doesn't clarify:
- Who enqueues apply job (orchestrator callback vs. precompute worker)
- How to handle precompute success but apply enqueue failure
- Whether apply jobs can be retried independently of precompute

**Recommendation:** Clarify in spec:
- Enqueue responsibility (precompute worker calls `orchestrator.enqueue('turn-apply', ...)`)
- Failure handling if apply enqueue fails after precompute succeeds
- Whether apply jobs reference precompute manifest or payload directly
- How to handle partial failures (precompute succeeds, apply fails repeatedly)

---

## 2. Data Consistency & Transaction Safety

### 2.1 Manifest Write Timing and Consistency

**Spec (§5.4):** Precompute worker writes provisional manifest, apply worker updates it.

**Concern:** Manifest writes are not transactional with queue state transitions:
- If precompute writes manifest but `complete()` fails, manifest exists but job is retried
- If apply updates manifest but transaction rolls back, manifest reflects failed state
- No atomicity guarantees between manifest and job completion

**Recommendation:** Specify in spec:
- Whether manifest writes occur inside or outside transactions
- How to handle manifest/job state divergence (cleanup job? reconciliation?)
- Whether to use optimistic locking (`updated_at` checks) for manifest updates
- Whether to use `queue_entry_id` as foreign key constraint for consistency

### 2.2 Idempotency Key Scope and Generation

**Spec (§4.1):** `idempotencyKey` is scoped to `(queue, key)` with unique partial index.

**Current Enqueue (`routes.ts:104`):** No idempotency keys used.

**Proposed Format:** `${gameId}:${turnNumber}:${actionHash}` (§4.1)

**Questions:**
- If turn is retried with different action, key changes → not idempotent
- Should idempotency prevent duplicate turns (same `gameId` + `turnNumber`) regardless of action?
- How to handle action changes between retries?

**Recommendation:** Clarify in spec:
- Whether idempotency keys should include only `gameId` and `turnNumber` (prevent duplicate turns)
- Whether action changes should be allowed (or require new job)
- Whether idempotency applies across all attempts or only within a queue
- Example key generation for common scenarios (retry, duplicate prevention, scheduled turns)

### 2.3 Payload Schema Versioning

**Open Question (§7):** How to version `action_payload` and ensure manifests reference correct decoder.

**Current:** `turn_jobs.action_payload` is JSONB without versioning.

**Recommendation:** Add to spec:
- `payload_version` field in `queue_entries.metadata` (as proposed)
- Decoder registry mapping versions to deserializers
- Validation that payload versions match expected schemas
- Migration path for old payloads without version field

---

## 3. Operational Risks & Gaps

### 3.1 Dead-Letter Queue Growth

**Spec (§4.6):** Jobs exceeding `maxAttempts` transition to dead-letter immediately.

**Risk:** If a bug causes permanent failures (e.g., invalid action payload format), dead-letter could grow unbounded.

**Recommendation:** Add to spec:
- Dead-letter retention policy (auto-purge after N days, default 30)
- Alerting on dead-letter growth rate (threshold: > 10 jobs/hour)
- Admin tools to bulk-replay or purge dead letters
- Dead-letter analysis dashboard (group by error type, time range)

### 3.2 Stuck Job Detection and Recovery

**Spec (§4.1):** `markStuck()` method for ops tooling, but no specification for:
- How often to run stuck-job sweeps
- Whether sweeps are automatic or manual
- What happens to stuck jobs (release, fail, escalate)

**Recommendation:** Define in spec:
- Automatic sweeper schedule (every 5 minutes recommended)
- Stuck job threshold (lease expired > 5 minutes, configurable)
- Action policy (release to pending vs. fail with `transient` reason)
- Alerting when stuck job count exceeds threshold

### 3.3 LISTEN/NOTIFY Reliability

**Spec (§4.8):** Uses Postgres `LISTEN/NOTIFY` for near-real-time wake-ups with polling fallback.

**Concerns:**
- `NOTIFY` is best-effort and can be lost (connection drops, buffer overflow)
- No guaranteed delivery semantics
- Polling fallback interval (5s) may be too slow for high-throughput scenarios

**Recommendation:** Document in spec:
- Expected notification loss rate (typically < 1% for healthy connections)
- Polling fallback interval (make configurable, default 5s)
- Whether lost notifications are acceptable (likely yes, given polling fallback)
- Consider Redis pub/sub or message broker for future if notification loss becomes issue

### 3.4 Metrics and Alerting Thresholds

**Spec (§4.7):** Lists metrics but doesn't specify alerting thresholds or SLOs.

**Recommendation:** Add to spec:
- Recommended alert thresholds:
  - `queue_pending{queue="turn-precompute"} > 100` (warning)
  - `queue_pending{queue="turn-precompute"} > 500` (critical)
  - `queue_lease_timeout_total > 10/hour` (warning)
  - `queue_dead_letter_total > 50` (warning)
- SLO targets:
  - p99 latency: `turn-precompute < 10s`, `turn-apply < 1s`, `image < 15s`
  - Availability: 99.9% (queue processing operational)
- Runbook links for common alerts (e.g., "High queue depth" → scale workers)

---

## 4. Migration Path Clarifications

### 4.1 Dual-Write Strategy

**Spec (§6.1):** "Wrap existing enqueue sites with `JobOrchestrator.enqueue`" but doesn't specify:
- Whether to dual-write to both `turn_jobs` and `queue_entries` during migration
- How long dual-write period should last
- How to verify parity before cutting over

**Recommendation:** Add migration checklist to spec:
1. **Phase 1:** Dual-write to both `turn_jobs` and `queue_entries` (1 week)
2. **Phase 2:** Verify queue depth parity, monitor for discrepancies
3. **Phase 3:** Enable orchestrator workers via feature flag (10% → 50% → 100%)
4. **Phase 4:** Monitor for 1 week, validate metrics match
5. **Phase 5:** Cut over to orchestrator-only (remove legacy `turn_jobs` polling)
6. **Phase 6:** Remove dual-write after 2 weeks of stability

### 4.2 Feature Flag Strategy

**Spec (§6):** Mentions `FEATURE_ORCHESTRATOR_PILOT` but doesn't specify (final rollout removed these toggles; guidance retained for historical context):
- Whether to enable per-queue or globally
- How to handle partial rollout (some workers use orchestrator, others don't)
- Rollback procedure if issues are found

**Recommendation:** Define in spec:
- Per-queue feature flags:
  - `FEATURE_ORCHESTRATOR_TURN_PRECOMPUTE`
  - `FEATURE_ORCHESTRATOR_TURN_APPLY`
  - `FEATURE_ORCHESTRATOR_IMAGE`
- Gradual rollout plan:
  - 10% of traffic → monitor for 24 hours
  - 50% of traffic → monitor for 48 hours
  - 100% of traffic → monitor for 1 week
- Automated rollback triggers:
  - Error rate > baseline + 10%
  - p99 latency > baseline + 50%
  - Dead-letter growth > 5 jobs/hour

### 4.3 Legacy Code Compatibility

**Current:** Code paths read `turn_jobs.status` directly (e.g., admin dashboards, health checks).

**Gap:** No compatibility layer for legacy code during migration.

**Recommendation:** Add to spec:
- Compatibility wrapper: `storage.getTurnJobStatus(id)` reads from `queue_entries` if orchestrator enabled
- Migration script to backfill `queue_entries` from existing `turn_jobs` (one-time)
- Deprecation timeline for direct `turn_jobs` access (remove after 3 months)

---

## 5. Performance Considerations

### 5.1 Index Design Validation

**Spec (§4.8):** Index on `(queue, status, run_at, priority DESC)` for efficient claims.

**Concern:** This index may not be optimal if:
- Most queries are `status='pending'` (should be first in WHERE clause)
- Priority ordering is rarely used (adds index size without benefit)

**Recommendation:** Validate index design with EXPLAIN ANALYZE on expected query patterns. Consider:
- Partial index: `CREATE INDEX idx_queue_pending ON queue_entries(queue, run_at, priority DESC) WHERE status='pending'`
- Separate index for stuck-job scans: `(queue, status, updated_at)` if different pattern
- Benchmark claim performance with expected queue depth (1000s of pending jobs)

### 5.2 Manifest Table Size and Partitioning

**Spec (§5.5):** Retain manifests for 30 days, then archive to cold storage.

**Risk:** If manifests average 10KB each and you process 1000 turns/day:
- 30 days = ~300MB active manifests
- 1 year = ~3.6GB (if not archived)
- Query performance degrades as table grows

**Recommendation:** Add to spec:
- Partitioning strategy:
  - Partition by `created_at` (monthly partitions)
  - Or partition by `game_id` hash (if game-based queries are common)
- Archive process:
  - Nightly export to S3 (NDJSON format)
  - Retention policy: 30 days in DB, 1 year in S3, then delete
- Query performance considerations:
  - Index on `(game_id, turn_number, attempt)` for replay queries
  - Index on `(trace_id)` for trace correlation
  - Consider materialized views for common queries

### 5.3 Lease Heartbeat Frequency

**Spec (§4.5):** Workers must call `extend()` before `leaseExpiresAt - safetyWindow` (default 5s).

**Concern:** If lease duration is 2 minutes and safety window is 5s, workers must heartbeat every ~55s. For high-concurrency queues, this creates significant write load.

**Recommendation:** Add to spec:
- Configurable heartbeat interval (default: lease duration / 3)
- Batch heartbeat extension (extend multiple leases in one query)
- Consider reducing heartbeat frequency if lease duration is long (e.g., 1 heartbeat per 30s for 2min lease)

---

## 6. Missing Specifications

### 6.1 Worker Lifecycle Management

**Not Specified:**
- How workers register/unregister (service discovery?)
- How to handle worker crashes (lease cleanup procedure)
- Whether to support graceful shutdown (complete in-flight jobs before exit)

**Recommendation:** Add to spec:
- Worker registration: Optional `worker_registry` table or use `worker_id` from lease metadata
- Lease cleanup job: Runs every minute, releases leases where `lease_expires_at < NOW() - 1 minute` and no recent heartbeat
- Graceful shutdown procedure:
  - Stop claiming new jobs
  - Wait for in-flight jobs to complete (max 2x lease duration)
  - Release any remaining leases
  - Exit

### 6.2 Priority Ordering Guarantees

**Spec (§4.1):** "FIFO ordering with optional priority override."

**Question:** If a high-priority job is enqueued while low-priority jobs are pending, does it jump the queue?

**Recommendation:** Clarify in spec:
- Priority comparison logic: Higher number = higher priority (confirm)
- Whether priority affects scheduling or only within the same `run_at` window
- Whether to support priority preemption (cancel low-priority job for high-priority) - likely not needed initially

### 6.3 Image Manifest Placement

**Spec (§5.1):** Mentions `image_execution_manifests` as future extension.

**Current:** Image jobs are created during turn apply and reference the turn.

**Recommendation:** Clarify in spec:
- Phase 1: Image references nested in turn manifests (simpler)
- Phase 2 (future): Separate `image_execution_manifests` table if image jobs become independent
- How to handle image jobs not tied to turns (direct `/api/generate-image` calls) - need standalone manifests

### 6.4 Manifest Schema Evolution

**Spec (§5.2):** Manifest includes `version` field, but no migration strategy.

**Concern:** If manifest structure changes, how do replay tools handle old manifests?

**Recommendation:** Add to spec:
- Version compatibility matrix (e.g., v1.0.0 → v1.1.0 is backward compatible)
- Migration path for old manifests (transformation script or version-aware readers)
- Backward compatibility guarantees (support last 3 versions)

---

## 7. Implementation Checklist

### High Priority (Must Address Before Implementation)

- [ ] Add migration strategy section (§6) covering dual-write and rollback
- [ ] Clarify precompute→apply enqueue responsibility and failure handling
- [ ] Specify manifest write consistency guarantees (transactional or eventual)
- [ ] Define dead-letter retention and auto-purge policies
- [ ] Document `LISTEN/NOTIFY` reliability expectations and fallback behavior
- [ ] Clarify idempotency key generation strategy and scope

### Medium Priority (Address During Implementation)

- [ ] Add index performance validation and optimization recommendations
- [ ] Define worker lifecycle management and graceful shutdown
- [ ] Specify priority ordering semantics and preemption behavior
- [ ] Add manifest schema versioning and migration strategy
- [ ] Define alerting thresholds and SLOs
- [ ] Add partitioning strategy for manifest tables

### Low Priority (Nice to Have)

- [ ] Consider Redis pub/sub alternative to `LISTEN/NOTIFY` for future
- [ ] Add batch heartbeat extension for high-concurrency queues
- [ ] Design image manifest placement strategy (separate vs. nested)
- [ ] Create replay tooling specifications and CLI interface

---

## 8. Recommendations Summary

### Approve with Conditions

**Before Implementation:**
1. Address all high-priority items in spec
2. Create detailed migration runbook with rollback procedures
3. Design manifest schema versioning strategy
4. Define operational runbooks (dead-letter management, stuck jobs)

**During Pilot:**
1. Deploy to staging with feature flags
2. Monitor for 2 weeks with baseline metrics
3. Validate performance improvements (lock duration, queue depth)
4. Test rollback procedure

**Before Production:**
1. Complete medium-priority items
2. Load test with expected production traffic
3. Validate index performance with realistic queue depths
4. Train on-call engineers on new observability tools

### Estimated Timeline

- **Week 1-2:** Spec updates and architecture review
- **Week 3-4:** Core orchestrator implementation
- **Week 5:** Manifest writer and integration
- **Week 6:** Testing, migration tooling, documentation
- **Week 7-8:** Staging pilot and refinement
- **Week 9+:** Production rollout (gradual)

---

## 9. Open Questions for Platform Team

1. **Multi-Region Deployment:** If workers run in multiple regions, how do we handle lease coordination? (Postgres `LISTEN/NOTIFY` is single-region)

2. **Queue Backend Migration:** What's the timeline for Redis/SQS migration? Should we design orchestrator interface to support this from day one?

3. **Manifest Storage:** Should manifests be stored in separate database (read replicas) or same instance? What's the query pattern?

4. **Replay Tooling:** What's the priority for replay tooling? Should it be built in Phase 1 or deferred?

5. **Cost Impact:** What's the expected cost of manifest storage (30 days retention)? Should we consider compression or more aggressive archiving?

---

**Next Steps:** Review this audit with platform leads, prioritize spec updates, and schedule implementation planning session.
