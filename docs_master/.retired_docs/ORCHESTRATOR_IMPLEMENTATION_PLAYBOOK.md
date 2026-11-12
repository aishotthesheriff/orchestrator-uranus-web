# Orchestrator & Manifest Implementation Playbook

**Audience:** Implementation engineers, tech leads, SRE/on-call rotation  
**Status:** Draft for execution  
**Primary References:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`, `GUIDE_ORCHESTRATOR_WORKFLOWS.md`, `ORCHESTRATOR_SIGN_OFF.md`

---

## 1. Overview
- **Objective:** Deliver the new orchestrator + manifest control plane while preserving deterministic game flow and unlocking replay/observability.
- **Scope:** Turn and image queues, worker lifecycle, manifest capture, migrations, rollout, and operational readiness.
- **Non-Goals:** Rewriting turn logic, swapping to non-Postgres queue backends, or changing client-facing APIs beyond improved reliability.

---

## 2. Quick Reference Map
- **Architecture & API contract:** `SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md`
- **Runtime workflows & ops runbooks:** `GUIDE_ORCHESTRATOR_WORKFLOWS.md`
- **Audit outcomes & approvals:** `ORCHESTRATOR_DESIGN_AUDIT.md`, `ORCHESTRATOR_SIGN_OFF.md`
- **Supporting context:** `GAME_EXECUTION_FLOW.md`, `TRANSACTION_BOUNDARIES_ARCHITECTURE.md`

---

## 3. Architecture Snapshot
- **Queues:** `turn-precompute`, `turn-apply`, `image`; priority-aware, idempotent, `LISTEN/NOTIFY` + polling fallback.
- **Orchestrator:** Postgres-backed (`queue_entries`, `queue_leases`) with lease batching, command topics, dead-letter retention, priority scheduling (`SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4).
- **Workers:** Precompute (deterministic + LLM), Apply (transaction + sockets), Image (cache/generation) using orchestrator interface only (`GUIDE_ORCHESTRATOR_WORKFLOWS.md` §3-4).
- **Manifests:** `turn_execution_manifests` capturing precompute/apply payloads, hashes, state diffs, image links, retention + partitioning strategy (`SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §5).
- **Observability:** Metrics thresholds, tracing, structured logs, replay tooling, dead-letter policies.

---

## 4. Execution Workflows (Reference Highlights)
- **Turn Enqueue:** Route validates action, dual-writes payload + orchestrator entry, emits trace (`GUIDE_ORCHESTRATOR_WORKFLOWS.md` §4.1).
- **Precompute Worker:** Claims, calculates deterministic state, issues LLM calls, writes provisional manifest, enqueues apply (`SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md` §4.10).
- **Apply Worker:** Verifies manifest hash, executes `processTurnWithTransaction`, enriches manifest, emits socket/event, enqueues image job.
- **Image Worker:** Resolves cache/generation, updates turn + manifest, emits `imageReady`/`imageFailed`.
- **Replay & Recovery:** Manifest-driven reruns, idempotent apply retries, dead-letter + markStuck flows guard against crashes.

---

## 5. Implementation Plan

### Phase 0 — Kickoff (Week 0)
- Staff core squad (backend lead, infra/SRE partner, QA).
- Stand up weekly implementation sync + async status updates.
- Build tracker of engineering tasks (per phase below) and dependencies; ensure staging environment mirrors production settings.

### Phase 1 — Dual-Write Foundations (Weeks 1-2)
- Ship migrations: `queue_entries`, `queue_leases`, `turn_execution_manifests`, `legacy_turn_jobs_v`.
- Implement orchestrator client skeleton (enqueue/claim stubs) and wrap existing enqueue sites with dual-write + idempotency keys.
- Add trace/idempotency metadata plumbing, unit tests for canonical action hashing.
- Deploy to staging and verify legacy processors continue to run while dual-write stays idle; confirm orchestrator tables populate as expected.

### Phase 2 — Orchestrator Backend (Weeks 2-3)
- Complete Postgres orchestrator (claim/lease/extendMany/fail/metrics/commands).
- Add heartbeat batching, stuck-job sweeper, dead-letter retention, priority ordering.
- Instrument metrics + logging per §4.7 spec; expose admin APIs (`/api/admin/queues/...`).
- Stage deploy with orchestrator still off; smoke-test command channel and metrics.

### Phase 3 — Manifest Writer Integration (Weeks 3-4)
- Precompute integration: manifest insert + hash, image plan capture, error states.
- Apply integration: transactional manifest update via commit hook, state diff digests, image/job references.
- Tooling: admin API/CLI for manifest fetch, replay harness baseline.
- Expand automated tests (unit + property) to cover manifest replays and hash validation.

### Phase 4 — Staging Pilot & Resilience Drills (Weeks 4-5)
- Enable dual-write + manifests in staging; monitor parity dashboards vs. legacy polling.
- Run failure scenarios: LLM outage (force transient failures), worker crash loop, lease timeout.
- Validate alert thresholds, runbook links, dead-letter exports, archive jobs.
- Document lessons + tighten instrumentation if gaps found.

### Phase 5 — Production Cutover (Weeks 5-7)
- Deploy orchestrator workers (`turn-precompute`, `turn-apply`, `image`) to production and stop scheduling legacy processors.
- Monitor SLOs (error rate, latency, dead letters); rollback requires redeploying the previous legacy build.
- Keep replay harness auditing sample turns nightly; compare manifest digests vs. live state.

### Phase 6 — Hardening, Cleanup, Handover (Weeks 7-8)
- Train on-call team using new runbooks, metrics dashboards, replay tooling.
- Execute pilot DR drill (simulate orchestrator outage + rollback).
- Disable legacy polling loops, remove dual-write paths once metrics stable.
- Archive implementation docs as “implemented”, schedule retro + backlog for deferred ideas (e.g., Redis backend, image manifest split).

---

## 6. Timeline & Milestones
- **Week 0:** Kickoff complete, tickets prioritized, staging flags ready.
- **Weeks 1-2:** Migrations + dual-write scaffolding merged; staging validation.
- **Weeks 2-3:** Orchestrator backend functional in staging.
- **Weeks 3-4:** Manifest end-to-end capture functional; tooling available.
- **Weeks 4-5:** Staging pilot finished with failure drills; readiness gate.
- **Weeks 5-7:** Production rollout across queues with monitoring.
- **Weeks 7-8:** Legacy decommission, DR drill, operational handoff.
- **Beyond:** Optional backlog—alternate queue backends, image manifests v2, data warehouse exports.

---

## 7. Operational Guardrails
- **Metrics & Alerts:** `queue_pending`, `queue_dead_letter_total`, `queue_lease_timeout_total`, `turn_manifest_*` latencies with thresholds per spec §4.7.
- **Runbooks:** Stuck job triage, dead-letter replay, LLM outage response, rollback procedure (`GUIDE_ORCHESTRATOR_WORKFLOWS.md` §5-6).
- **Feature Flags:** Fine-grained toggles per queue plus manifest/priority. Maintain ability to flip back to legacy polling at any phase until cleanup.
- **Data Retention:** 30-day hot manifests, NDJSON archive to S3, dead letters auto-purged after 30 days (manifests retained 90 days hot).

---

## 8. Risks & Mitigations
- **Migration Drift:** Dual-write parity dashboards + compatibility view ensure legacy tooling stays accurate.
- **Performance Regression:** Benchmark claim/lease queries; adjust indexes if queue depth >1k impacts latency.
- **Provider Outages:** Backoff + pause commands; manifests preserve context for retries.
- **Operational Complexity:** Early runbook training + DR drills minimize on-call surprise.
- **Future Backend Swap:** Interface remains backend-agnostic; document lessons learned for Redis/SQS evaluation.

---

## 9. Checklists

### Engineering
- [ ] All migrations applied and reversible.
- [ ] Orchestrator API covered by integration tests (claim/extend/fail paths).
- [ ] Workers refactored off legacy polling.
- [ ] Manifest writer + replay harness verified against fixtures.
- [ ] Feature flag toggles tested (on/off) per queue.

### Operations
- [ ] Dashboards + alert rules deployed.
- [ ] Runbooks reviewed and linked from alerts.
- [ ] Dead-letter purge + archive job scheduled.
- [ ] On-call training session completed.
- [ ] DR drill planned with success criteria.

---

## 10. Next Actions
- Approve playbook and assign phase ownership.
- Create implementation tickets aligned with sections above.
- Schedule kickoff (Week 0) and lock staging readiness tasks.
- Begin Phase 1 once migrations reviewed and staging environment prepared.
