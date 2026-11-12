# Job Orchestrator & Manifest Specification — Sign-Off

**Date:** 2025-01-XX  
**Reviewer:** Platform Architecture Team  
**Documents Reviewed:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`, `GUIDE_ORCHESTRATOR_WORKFLOWS.md`  
**Related Audit:** `ORCHESTRATOR_DESIGN_AUDIT.md`

---

## ✅ Sign-Off Status: **APPROVED**

The updated specification and guide documents address all high-priority concerns identified in the design audit. The proposal is **ready for implementation** with the following conditions met.

---

## Audit Items — Resolution Status

### High Priority Items — ✅ All Addressed

#### ✅ 1. Migration Strategy & Rollback Procedures
**Status:** RESOLVED  
**Location:** 
- `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §6 — Detailed 6-week rollout plan
- `GUIDE_ORCHESTRATOR_WORKFLOWS.md` §5 "Schema Migration Order" — Step-by-step migration with rollback triggers

**Evidence:**
- Dual-write strategy defined (Week 0-1)
- Parity validation plan (Week 1-2)
- Gradual rollout (10% → 50% → 100%)
- Automated rollback triggers (error rate +10%, SLO degraded ≥50%)
- Legacy polling decommissioning plan (Week 5-6)

#### ✅ 2. Precompute→Apply Enqueue Responsibility
**Status:** RESOLVED  
**Location:** 
- `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.10 "Turn Queue Coordination"
- `GUIDE_ORCHESTRATOR_WORKFLOWS.md` §4.6 "Precompute ↔ Apply Coupling"

**Evidence:**
- Clear responsibility: Precompute worker enqueues apply job after manifest persistence
- Failure handling: Precompute lease marked transient if apply enqueue fails
- Idempotency: Apply jobs use `${gameId}:${turnNumber}:apply` key
- Dead-letter handling: Dead-lettered apply jobs trigger precompute requeue

#### ✅ 3. Manifest Write Consistency Guarantees
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §5.4 "Consistency Guarantees"

**Evidence:**
- Precompute manifest insert and lease completion occur in single transaction
- Apply worker updates manifest within same DB transaction as `processTurnWithTransaction`
- Transaction rollback ensures manifest changes are discarded
- Manifest hash comparisons happen before commit for deterministic replay

#### ✅ 4. Dead-Letter Retention & Auto-Purge
**Status:** RESOLVED  
**Location:** 
- `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.6 — Auto-purge entries older than 30 days
- `GUIDE_ORCHESTRATOR_WORKFLOWS.md` §5 — Nightly job exports >30 day dead letters before purge

**Evidence:**
- Retention policy: 30 days configurable
- Archive process: Nightly export to cold storage before deletion
- Dead-letter manifests: 90 days in hot storage
- Admin API: `/api/admin/queues/:queue/dead-letter` for inspection/replay

#### ✅ 5. LISTEN/NOTIFY Reliability Documentation
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.8 "Command Topic"

**Evidence:**
- Reliability notes: Best-effort, not durable
- Polling fallback: Every 5s (configurable `pollFallbackMs`)
- Reconnect handling: Immediate full poll on reconnect
- Future path: Optional Redis pub/sub hook (feature-flag controlled)

#### ✅ 6. Idempotency Key Generation Strategy
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.11 "Idempotency Keys"

**Evidence:**
- Default convention: `${queue}:${gameId}:${turnNumber}:${actionFingerprint}`
- Action fingerprint: SHA-256 digest of `actionPayload` canonical JSON
- Scope: Per queue, enforced via partial unique index
- Retry semantics: Re-enqueue with same key returns existing job id
- Replay tools: Generate new key with `:replay:${attempt}` suffix

### Medium Priority Items — ✅ Mostly Addressed

#### ✅ 7. Worker Lifecycle Management
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.12 "Worker Lifecycle"

**Evidence:**
- Worker registration: `${queue}-${hostname}-${pid}` format
- Graceful shutdown: 4-step procedure (pause, wait, release, flush)
- Crash recovery: `markStuck` sweeper runs every minute
- Lease cleanup: Expired leases converted to pending with timeout recorded

#### ✅ 8. Alerting Thresholds & SLOs
**Status:** RESOLVED  
**Location:** 
- `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.7 "Operational thresholds"
- `GUIDE_ORCHESTRATOR_WORKFLOWS.md` §5 "Metrics Dashboard"

**Evidence:**
- Queue depth: Warn at 100, page at 500
- Lease timeouts: Warn when >10/hour
- Dead-letter growth: Warn when >50 jobs/24h
- SLO targets: p99 latencies and availability ≥99.9%
- Runbook links: "High queue depth" → scale workers

#### ✅ 9. Feature Flag Strategy
**Status:** RESOLVED  
**Location:** `GUIDE_ORCHESTRATOR_WORKFLOWS.md` §5 "Feature Flags"

**Evidence:**
- Per-queue flags: (superseded) orchestrator workers now run unconditionally; feature toggles removed in final implementation.
- Manifest flag: (superseded) manifest capture is always enabled.
- Priority flag: (superseded) priority scheduling is always active; no toggle exposed.
- Rollout plan: 10% → 50% → 100% with automated rollback

#### ✅ 10. Priority Ordering Semantics
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.13 "Priority & Scheduling Semantics"

**Evidence:**
- Higher priority runs ahead of lower (for pending jobs with `run_at <= now()`)
- FIFO within same priority (on `run_at` then `created_at`)
- No preemption: Priority only affects next claim selection
- Default priorities: Routine turns = 0, image jobs = 10, admin commands ≥ 90

#### ✅ 11. Index Design Recommendations
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.8

**Evidence:**
- Primary claim path: Partial index `(queue, run_at, priority DESC) WHERE status='pending'`
- Stuck job scans: Index on `(queue, status, updated_at)`
- Benchmark guidance: Test with expected queue depth (1k+ rows)
- Performance note: Adjust priority column order if profiling shows negligible benefit

#### ✅ 12. Manifest Partitioning Strategy
**Status:** RESOLVED  
**Location:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §5.5 "Retention & Access"

**Evidence:**
- Partitioning: Range partition by `created_at` (monthly) or hash on `game_id`
- Archive process: Nightly NDJSON export to S3
- Retention: 30 days in DB, 1 year in S3, then delete
- Verification: Row count + checksum before dropping partition

---

## Remaining Open Questions (Non-Blocking)

These items were identified in the audit but are acceptable to defer to implementation:

1. **Payload Schema Versioning** (§7): `payload_version` in `queue_entries.metadata` is proposed — acceptable to implement during Phase 1
2. **Trace ID Propagation** (§7): Standard header (`x-trace-id`) — acceptable to define during implementation
3. **Cold Storage Format** (§7): NDJSON vs. data warehouse — acceptable to defer to ops team input
4. **Image Manifest Placement** (§7): Phase 1 uses nested manifests, Phase 2 separate table — acceptable phased approach
5. **Multi-Region Deployment**: Postgres `LISTEN/NOTIFY` is single-region — acceptable for current scope, future consideration

---

## Implementation Readiness Checklist

- [x] Migration strategy defined with rollback procedures
- [x] Precompute/Apply coordination clearly specified
- [x] Manifest consistency guarantees documented
- [x] Dead-letter management policies defined
- [x] Worker lifecycle and graceful shutdown specified
- [x] Alerting thresholds and SLOs defined
- [x] Feature flag strategy for gradual rollout
- [x] Index design recommendations provided
- [x] Manifest partitioning and archiving strategy defined
- [x] Operational runbooks referenced

---

## Approval Conditions

### ✅ Pre-Implementation
All high-priority audit items have been addressed in the specification documents.

### ✅ During Pilot
- Deploy to staging with feature flags enabled
- Monitor for 2 weeks with baseline metrics
- Validate performance improvements (lock duration, queue depth)
- Test rollback procedure

### ✅ Before Production
- Complete medium-priority items (if not already done)
- Load test with expected production traffic
- Validate index performance with realistic queue depths
- Train on-call engineers on new observability tools

---

## Estimated Timeline

- **Week 1-2:** Spec finalization and architecture review ✅
- **Week 3-4:** Core orchestrator implementation
- **Week 5:** Manifest writer and integration
- **Week 6:** Testing, migration tooling, documentation
- **Week 7-8:** Staging pilot and refinement
- **Week 9+:** Production rollout (gradual)

---

## Sign-Off

**Platform Architecture Team:** ✅ **APPROVED**

The specification is comprehensive, addresses all critical concerns, and provides a clear path for implementation. The design is architecturally sound and aligns with existing system patterns. The phased rollout plan with automated rollback triggers provides appropriate risk mitigation.

**Recommendation:** Proceed with implementation following the rollout plan in §6.

---

**Next Steps:**
1. Schedule implementation kickoff meeting
2. Assign engineering resources
3. Create implementation tickets from checklist
4. Set up staging environment for pilot

