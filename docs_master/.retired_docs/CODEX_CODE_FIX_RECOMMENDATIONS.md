# CODEX Code Fix Recommendations

**Generated:** 2025-01-27  
**Scope:** Independent Codex review of `docs_master/current/` references

This addendum de-duplicates the original recommendations, adds sourcing, and notes whether each item is primarily an engineering change or an operational/configuration task.

---

## Methodology

- Cross-referenced every recommendation with its originating document/line range.  
- Collapsed duplicate entries (e.g., template cache metrics) into a single action with shared sources.  
- Flagged operational items (`Operational`) that require environment/config updates rather than code changes.

---

## 1. Prompt & Template System

### High Priority (Engineering)

1. **Automate template cache invalidation**  
   - *Issue:* `templateCache` never refreshes after file edits.  
   - *Action:* Add file watcher or timestamp-based invalidation in `server/pce/promptBuilder.ts`.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:598-600`, `server/pce/promptBuilder.ts:7-94`

2. **Improve PCE error messaging and variable validation**  
   - *Issues:* Missing variable names in errors; no preflight validation; unsafe `RegExp` construction.  
   - *Actions:* Include offending placeholder in errors, add optional validation pass, sanitize regex keys.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:602-614`, `PCE_TECHNICAL_AUDIT.md:528`

3. **Instrument template performance metrics**  
   - *Issue:* No timing or cache hit-rate visibility for prompt generation.  
   - *Action:* Log load duration + hit/miss counters around `loadTemplate()`; expose metrics via `logLlmCall`.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:616-618`, `MODULE_AI_SERVICE.md:582-614`

4. **Document template contract and exported APIs**  
   - *Issue:* Missing JSDoc on PCE exports; template variables undocumented.  
   - *Action:* Add JSDoc to `promptBuilder.ts`, `settings.ts`, `modelInstructions.ts`; annotate `masterPrompt.txt`.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:606-608`

### Medium / Long Term

5. **Template evolution roadmap**  
   - *Actions:* Introduce template version metadata, consider richer templating engine, allow configurable instruction sets.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:620-632`

---

## 2. Reference & Storage Caching

### High Priority (Engineering)

1. **Reference cache invalidation**  
   - *Issue:* Runtime cache requires restart when reference data changes.  
   - *Action:* Add webhook or watcher to refresh `referenceLoader`.  
   - *Source:* `GAME_EXECUTION_FLOW.md:1073-1079`, `MODULE_ROUTES.md:734-739`

### Medium Priority (Engineering)

2. **Add in-memory/Redis caching for storage hot paths**  
   - *Actions:* Introduce lightweight cache for frequently accessed queries; evaluate Redis layer.  
   - *Source:* `MODULE_STORAGE.md:964-970`

---

## 3. Error Handling & APIs

### High Priority (Engineering)

1. **Return detailed admin API errors**  
   - *Issue:* Admin image model endpoints emit generic 500 messages.  
   - *Action:* Include error message/metadata (guarded in production).  
   - *Source:* `MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:509-555`, `server/routes/imageModelsAdmin.ts:509-554`

2. **Handle image cache persistence failures robustly**  
   - *Issue:* Cache save failures only warn; downstream flows continue silently.  
   - *Action:* Add retry/backoff or escalate failure state.  
   - *Source:* `MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:1040-1067`, `server/aiService.ts:1461-1535`

---

## 4. Testing Coverage

### High Priority (Engineering)

1. **Expand PCE unit tests**  
   - *Coverage gaps:* Null/undefined placeholder replacement, nested variable paths, template load failures.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:592-600`

2. **Add end-to-end PCE flow tests**  
   - *Scope:* Settings resolution → meta prompt → JSON validation.  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:592-600`, `MODULE_AI_SERVICE.md` (PCE flow description)

### Medium Priority

3. **Snapshot & performance regression testing for prompts**  
   - *Source:* `PCE_TECHNICAL_AUDIT.md:616-636`

---

## 5. Job Queue & Asynchronous Processing

### High Priority (Engineering)

1. **Automatic retries and graceful shutdown**  
   - *Issue:* Job processors lack retry backoff and graceful termination.  
   - *Action:* Implement retry policy + shutdown hooks in `imageJobProcessor` / `turnJobProcessor`.  
   - *Source:* `IMAGE_SYSTEM_ARCHITECTURE.md:824-837`, `MODULE_ROUTES.md:725-739`, `MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:1052-1067`

### Medium Priority

2. **Job cleanup & dead-letter support**  
   - *Actions:* Periodically purge completed jobs; persist permanently failed jobs for review.  
   - *Source:* `MODULE_ROUTES.md:734-739`, `IMAGE_SYSTEM_ARCHITECTURE.md:837`

### Long Term

3. **Queue scalability initiatives**  
   - *Ideas:* Redis-backed queue, batch image generation, cross-provider fallbacks.  
   - *Source:* `IMAGE_SYSTEM_ARCHITECTURE.md:726-731`, `MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:1052-1053`

---

## 6. Security & Configuration

### High Priority (Operational)

1. **ALLOWED_ORIGINS hardening**  
   - *Action:* Ensure production env uses explicit domain list (no `*`).  
   - *Source:* `API_SECURITY.md:54-89`

2. **Admin key rotation discipline**  
   - *Action:* Establish rotation schedule and deployment checklist.  
   - *Source:* `API_SECURITY.md:24-33`

### Medium Priority (Engineering/Operational)

3. **Expose security event exports**  
   - *Action:* Wire `getSecurityMetrics` / `getRecentSecurityEvents` to monitoring or dashboard.  
   - *Source:* `API_SECURITY.md:63-68`

---

## 7. Documentation & Cross-References

### High Priority (Engineering / Docs)

1. **Cross-link gameplay & image docs**  
   - *Action:* Add references between ACTION_UI_AUTOMATION, PROMPT_UI_FLOW_PCE, and IMAGE_SYSTEM_ARCHITECTURE.  
   - *Source:* `DOCUMENTATION_COMPARISON_ANALYSIS.md:356-363`

2. **Verify “Priority 1” doc updates landed**  
   - *Action:* Audit codebase for the ✅ items called out in the docs and mark completion.  
   - *Source:* `DOCUMENTATION_COMPARISON_ANALYSIS.md:420-438`

---

## 8. Client & Developer Experience

### Medium Priority (Engineering)

1. **Adopt route-based code splitting when bundle size grows**  
   - *Action:* Evaluate `React.lazy()` for router-level chunks.  
   - *Source:* `CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md:679`

---

## 9. Data Management

### Medium Priority (Engineering)

1. **Automate soft-delete cleanup & auditing**  
   - *Actions:* Schedule archival of soft-deleted rows; add change audits.  
   - *Source:* `MODULE_STORAGE.md:969-971`

---

## Summary Matrix

| Area | Priority | Type | Source |
|------|----------|------|--------|
| Template cache invalidation | High | Engineering | PCE_TECHNICAL_AUDIT.md:598-600 |
| PCE error/validation improvements | High | Engineering | PCE_TECHNICAL_AUDIT.md:528-614 |
| Template metrics | High | Engineering | PCE_TECHNICAL_AUDIT.md:616-618 |
| Reference cache invalidation | High | Engineering | GAME_EXECUTION_FLOW.md:1073-1079 |
| Admin API error detail | High | Engineering | MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:509-555 |
| Image cache failure handling | High | Engineering | MULTI_MODEL_IMAGE_ARCHITECTURE_V2.md:1040-1067 |
| Job processor reliability | High | Engineering | IMAGE_SYSTEM_ARCHITECTURE.md:824-837 |
| ALLOWED_ORIGINS hardening | High | Operational | API_SECURITY.md:54-89 |

---

**Next Steps:** Prioritize engineering fixes marked High, track Operational tasks with platform/DevOps owners, and update this document as items are delivered.
