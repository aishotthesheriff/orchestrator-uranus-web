# Legacy Deprecation Checklist

This checklist tracks progress through the legacy deprecation plan. Check off items as they're completed.

**⚠️ Breaking Changes Approved**: API contracts, client-server interfaces, and data models may change.  
**⚠️ Non-Functionality Accepted**: Temporary service disruption during migration is acceptable.

---

## Team Review & Coordination

### Platform Architect Review

#### Infrastructure Impact
- [ ] Review database schema changes (removing legacy columns/types)
- [ ] Review API contract changes (removing legacy endpoints/parameters)
- [ ] Approve deployment strategy and coordination windows
- [ ] Review rollback procedures for infrastructure changes
- [ ] Review monitoring and alerting changes

#### Breaking Changes Assessment
- [ ] Identify all breaking API changes
- [ ] Document client-side impact
- [ ] Coordinate deployment windows for breaking changes
- [ ] Plan for temporary service disruption if needed

#### Data Migration
- [ ] Review any data migration needs
- [ ] Plan for handling existing games with legacy data
- [ ] Document cleanup procedures for legacy data

#### Performance & Scalability
- [ ] Verify PCE performance meets requirements
- [ ] Review load testing results
- [ ] Assess impact on database and LLM API usage

#### Review Schedule
- [ ] **Before Phase 3**: Review breaking changes plan
- [ ] **Before Phase 4**: Review implementation removal impact
- [ ] **Before Phase 6**: Final approval for production rollout

### Frontend Team Review

#### Client-Side Breaking Changes
- [ ] Identify all frontend code that references legacy APIs
- [ ] Review UI components that depend on legacy features
- [ ] Plan for removing `forceLegacy` UI elements
- [ ] Coordinate deployment with backend changes

#### API Contract Changes
- [ ] Review all API endpoint changes
- [ ] Verify response type changes are compatible
- [ ] Update TypeScript types in `shared/schema.ts`
- [ ] Test client-server compatibility

#### User Experience Impact
- [ ] Review any UI/UX changes from removing legacy paths
- [ ] Plan for graceful degradation during deployment
- [ ] Document any temporary user-facing changes

#### Testing & Validation
- [ ] Coordinate frontend testing with backend changes
- [ ] Verify end-to-end flows work correctly
- [ ] Test error handling and fallback scenarios

#### Review Schedule
- [ ] **Before Phase 3**: Review client-side changes needed
- [ ] **During Phase 3**: Coordinate frontend updates with backend routing removal
- [ ] **Before Phase 6**: Final validation of frontend-backend compatibility

### Deployment Coordination
- [ ] Decide on deployment strategy (Coordinated Big Bang vs Staged)
- [ ] Schedule deployment windows for breaking changes
- [ ] Plan rollback procedures for both frontend and backend
- [ ] Document communication plan for stakeholders

---

## Phase 1: Preparation & Validation (Week 1)

### 1.1 PCE Stability Validation

#### Metrics Collection
- [ ] Set up monitoring for PCE success rates vs legacy fallback rates
- [ ] Track `mode: "pce-fallback"` frequency in LLM logs
- [ ] Monitor PCE JSON parsing failure rates
- [ ] Track image prompt generation success rates
- [ ] Measure latency differences (PCE vs legacy)
- [ ] Create dashboard for PCE metrics

#### Test Coverage
- [ ] Verify all PCE stages have comprehensive unit tests
- [ ] Test all PCE fallback paths work correctly
- [ ] Integration tests for full turn generation with PCE
- [ ] Test image generation with PCE prompts
- [ ] Test action generation with PCE
- [ ] Test intro turn generation with PCE
- [ ] Test error scenarios (LLM failures, parse errors)

#### Production Validation
- [ ] Verify PCE is enabled for 100% of new games
- [ ] Monitor for 1-2 weeks with PCE as primary path
- [ ] Verify no increase in error rates
- [ ] Verify no degradation in content quality
- [ ] Collect user feedback on narrative quality
- [ ] Document baseline metrics

### 1.2 Documentation Audit
- [ ] Update all documentation to reflect PCE as primary path
- [ ] Document expected fallback behavior (should be rare)
- [ ] Update API documentation to remove legacy references
- [ ] Create migration guide for any external integrations
- [ ] Review and update code comments

### 1.3 Feature Flag Strategy
- [ ] Verify `pce_enabled` is set to `true` in production
- [ ] Create monitoring alert if `pce_enabled` is disabled
- [ ] Document rollback procedure (re-enable legacy via flag)
- [ ] Test feature flag toggle (if needed for rollback)

---

## Phase 2: Hardening PCE Fallbacks (Week 2)

### 2.1 Enhance PCE Error Handling
- [ ] Review all PCE stage failure scenarios
- [ ] Ensure comprehensive fallback chains within PCE
- [ ] Add retry logic for transient LLM failures
- [ ] Improve JSON parsing error recovery
- [ ] Add validation for all PCE stage outputs
- [ ] Add timeout handling for LLM calls
- [ ] Add rate limit handling

### 2.2 Test Fallback Scenarios
- [ ] Unit tests for each PCE stage failure mode
- [ ] Integration tests for full fallback chains
- [ ] Load tests to ensure fallbacks don't cause performance issues
- [ ] Test with malformed LLM responses
- [ ] Test with network failures
- [ ] Test with rate limit errors

### 2.3 Monitoring & Alerting
- [ ] Set up alerts for legacy fallback usage
- [ ] Dashboard for PCE vs legacy metrics
- [ ] Alert if legacy fallback rate exceeds threshold (e.g., >1%)
- [ ] Track fallback reasons (parse errors, validation failures, etc.)
- [ ] Set up alerts for PCE error rate spikes
- [ ] Create runbook for investigating PCE failures

---

## Phase 3: Remove Legacy Routing (Week 3)

**⚠️ BREAKING CHANGES**: This phase introduces breaking API changes. Coordination with Frontend Team required.

### 3.0 Pre-Phase Coordination
- [ ] Platform Architect Review: Approve breaking changes plan
- [ ] Frontend Team Review: Review required client-side changes
- [ ] Deployment Window: Coordinate frontend + backend deployment
- [ ] Communication: Notify stakeholders of breaking changes
- [ ] Rollback Plan: Document rollback procedure for breaking changes

### 3.1 Remove Legacy Routing Logic

#### File: `server/aiService.ts`
- [ ] Remove `isPceEnabled()` check from `generateTurnContentWithFlag()`
- [ ] Simplify `generateTurnContentWithFlag()` to always call PCE
- [ ] Remove legacy branch from `generateNarrative()`
- [ ] Simplify `generateNarrative()` to always use PCE
- [ ] Remove legacy fallback from `generateActions()`
- [ ] Remove `generateIntroTurnContent()` function
- [ ] Replace all `generateIntroTurnContent()` calls with `generateTurnContent()`
- [ ] Remove `runIntroPrompt()` function

#### File: `server/pce/contentRouter.ts`
- [ ] Remove `legacyFull` handler from `ContentGenerationRouter`
- [ ] Remove `legacyActions` handler
- [ ] Update `RouterHandlers` interface
- [ ] Simplify `generateFullTurnContent()` to remove legacy fallbacks
- [ ] Update `FullTurnContentResult` type if needed

#### File: `server/routes.ts`
- [ ] Remove `forceLegacy` parameter from `/api/admin/pipeline/run-stage`
- [ ] Remove legacy routing logic from admin endpoints
- [ ] Update API documentation

#### File: `client/src/hooks/usePipelineLab.ts`
- [ ] Remove `forceLegacy` parameter
- [ ] Update UI to remove legacy toggle

#### File: `client/src/pages/devtools/PceTab.tsx`
- [ ] Remove any legacy-related UI elements
- [ ] Update documentation/comments

### 3.2 Update Function Signatures
- [ ] Remove `isPceEnabled()` function
- [ ] Update all call sites to remove conditional logic
- [ ] Simplify function return types
- [ ] Update type definitions in `shared/schema.ts`

### 3.3 Validation
- [ ] Run full test suite
- [ ] Manual QA pass for all game flows
- [ ] Verify no legacy code paths are executed
- [ ] Check logs for any legacy references
- [ ] Verify no TypeScript errors
- [ ] Verify no linting errors

---

## Phase 4: Remove Legacy Implementation (Week 4)

**⚠️ BREAKING CHANGES**: This phase removes code that may be referenced by other systems. Careful audit required.

### 4.0 Pre-Phase Coordination
- [ ] Platform Architect Review: Verify no infrastructure dependencies
- [ ] Frontend Team Review: Confirm no client-side dependencies remain
- [ ] Audit: Verify all references to legacy functions are removed
- [ ] Deployment Window: Coordinate if deployment needed

### 4.1 Remove Legacy Functions

#### File: `server/aiService.ts`
- [ ] Delete `legacyGenerateNarrative()` (Lines 440-535)
- [ ] Delete `legacyGenerateActions()` (Lines 1879-1997)
- [ ] Delete `legacyGenerateTurnContent()` (Lines 1441-1695)
- [ ] Delete `generateIntroTurnContent()` (Lines 393-438)
- [ ] Delete `runIntroPrompt()` (Lines 318-387)
- [ ] Delete `runLegacyFullTurn()` (Lines 1350-1401)
- [ ] Delete `runLegacyActionsTurn()` (Lines 1403-1417)
- [ ] Delete `createLegacyMetadata()` (Lines 1333-1348)

### 4.2 Remove Legacy Infrastructure

#### Evaluate and Remove (if unused)
- [ ] Audit `getPromptFromCache()` usage
  - [ ] Check if used by `intent_mapping`
  - [ ] Check if used by `interview_answer`
  - [ ] Remove if only used by legacy
  - [ ] Document if kept for other systems

- [ ] Audit `replaceVariables()` usage
  - [ ] Check if used by non-legacy code
  - [ ] Remove if only used by legacy
  - [ ] Document if kept for other systems

- [ ] Audit `addInterviewResponsesToVariables()` usage
  - [ ] Check if used by interview system
  - [ ] Keep if needed for interviews
  - [ ] Document usage

### 4.3 Clean Up Type Definitions

#### File: `shared/schema.ts`
- [ ] Remove `'legacy'` from `PromptStageName` type
- [ ] Review and remove legacy-specific types
- [ ] Update `TurnContentResult` to remove legacy fields
- [ ] Remove `LegacyFullTurnResult` type if exists
- [ ] Clean up any legacy-related interfaces

### 4.4 Remove Legacy Prompt Templates

#### Archive Legacy Templates
- [ ] Archive `turn_generation` template
- [ ] Archive `intro_generation` template
- [ ] Archive `global_system_prompt` (if not used elsewhere)
- [ ] Archive `visual_style_prompt` (if not used elsewhere)
- [ ] Keep `action_generation` if used by PCE actions fallback
- [ ] Update reference publishing to exclude archived templates
- [ ] Document archived templates location

### 4.5 Image Template Fallback Decision
- [ ] Add validation to ensure PCE always generates `imagePrompt`
- [ ] Add monitoring/alerting if template fallback is used
- [ ] Document template fallback as emergency safety net
- [ ] Set up alert for template fallback usage
- [ ] Plan for future removal if never triggered

---

## Phase 5: Cleanup & Documentation (Week 5)

### 5.1 Code Cleanup
- [ ] Remove all `@deprecated` comments referencing legacy code
- [ ] Remove legacy-related comments and TODOs
- [ ] Clean up imports (remove unused legacy-related imports)
- [ ] Run linter and fix all issues
- [ ] Remove unused helper functions
- [ ] Remove unused type definitions
- [ ] Clean up console.log statements referencing legacy

### 5.2 Documentation Updates
- [ ] Update `SYSTEM_OVERVIEW.md` to remove legacy references
- [ ] Update `GAME_EXECUTION_FLOW.md` to document PCE-only flow
- [ ] Update `MODULE_AI_SERVICE.md` to remove legacy documentation
- [ ] Archive `PCE_COMPARISON.md` to `.retired_docs/`
- [ ] Create new `PCE_ARCHITECTURE.md` documenting PCE-only system
- [ ] Update API documentation to remove legacy endpoints/parameters
- [ ] Update DevTools documentation
- [ ] Update `AGENTS.md` if needed
- [ ] Update README if needed

### 5.3 Test Coverage
- [ ] Verify all tests pass
- [ ] Add tests for edge cases that were previously handled by legacy
- [ ] Add integration tests for full PCE pipeline
- [ ] Test error scenarios (LLM failures, parse errors, etc.)
- [ ] Performance tests to ensure PCE meets latency requirements
- [ ] Test coverage > 80% for PCE code paths

### 5.4 Monitoring & Observability
- [ ] Verify all metrics are working correctly
- [ ] Set up dashboards for PCE-only system
- [ ] Remove legacy-related metrics/alerts
- [ ] Document monitoring strategy for PCE
- [ ] Create runbooks for common PCE issues

---

## Phase 6: Final Validation & Rollout (Week 6)

### 6.1 Pre-Production Validation
- [ ] Full integration test suite passes
- [ ] Manual QA pass on all game flows
- [ ] Performance testing (latency, throughput)
- [ ] Load testing with expected production load
- [ ] Review all error logs from test period
- [ ] Security review if needed

### 6.2 Staging Deployment
- [ ] Deploy to staging with legacy code removed
- [ ] Run smoke tests
- [ ] Monitor for 24-48 hours
- [ ] Verify no errors or regressions
- [ ] Collect metrics and compare to baseline
- [ ] Get stakeholder approval

### 6.3 Production Rollout

**Rollout Strategy**: Coordinated Big Bang (frontend + backend simultaneously)  
**Non-Functionality Window**: Acceptable during deployment (estimated 5-15 minutes)

#### Pre-rollout Checklist
- [ ] All tests pass
- [ ] Staging validation complete
- [ ] Rollback plan documented (for both frontend and backend)
- [ ] Team notified (Platform Architects, Frontend Team, stakeholders)
- [ ] Monitoring dashboards ready
- [ ] On-call team briefed
- [ ] Communication plan ready
- [ ] Deployment window scheduled (off-peak hours recommended)
- [ ] Frontend and backend teams coordinated
- [ ] Users notified of planned maintenance window (if > 5 minutes)

#### Deployment
- [ ] Deploy frontend and backend simultaneously
- [ ] Verify deployment successful (both systems)
- [ ] Monitor error rates for first hour
- [ ] Monitor PCE success rates
- [ ] Check for any legacy-related errors
- [ ] Verify no regressions
- [ ] Verify frontend-backend compatibility

#### Post-rollout
- [ ] Monitor for 24-48 hours
- [ ] Review metrics and logs
- [ ] Verify no regressions
- [ ] Document any issues encountered
- [ ] Coordinate with Frontend Team on any issues
- [ ] Celebrate success! 🎉

### 6.4 Rollback Plan
- [ ] Document rollback procedure (for both frontend and backend)
- [ ] Test rollback procedure
- [ ] Have rollback ready (previous deployment for both systems)
- [ ] Communication template for rollback
- [ ] Coordinate rollback with Frontend Team
- [ ] Notify Platform Architects immediately on rollback

---

## Success Criteria Validation

### Must Have (Blocking)
- [ ] PCE success rate > 99.5%
- [ ] No increase in error rates after legacy removal
- [ ] All tests pass
- [ ] No user-facing regressions
- [ ] Latency within acceptable bounds (< 2x legacy latency)

### Should Have (Important)
- [ ] Template fallback usage < 0.1% of image generations
- [ ] PCE fallback chain usage < 1% of turns
- [ ] Content quality maintained or improved
- [ ] Code coverage > 80% for PCE code paths

### Nice to Have (Optional)
- [ ] Reduced codebase size
- [ ] Simplified architecture
- [ ] Improved maintainability
- [ ] Better observability

---

## Post-Deprecation (Week 7-8)

### Immediate Follow-up
- [ ] Monitor production metrics
- [ ] Address any issues discovered
- [ ] Collect user feedback
- [ ] Document lessons learned
- [ ] Team retrospective

### Long-term (Month 2+)
- [ ] Consider removing template fallback if never used
- [ ] Optimize PCE performance if needed
- [ ] Plan future PCE enhancements
- [ ] Archive all legacy documentation
- [ ] Update architecture diagrams

---

## Notes & Issues

Use this section to track any issues, questions, or deviations from the plan:

### Issues Encountered
- 

### Questions to Resolve
- 

### Decisions Made
- [ ] Deployment strategy selected (Coordinated Big Bang / Staged)
- [ ] Breaking changes approved
- [ ] Non-functionality periods approved

### Blockers
- 

### Team Review Status
- [ ] Platform Architect review complete
- [ ] Frontend Team review complete
- [ ] Coordination windows scheduled 

---

## Progress Tracking

- **Phase 1**: 0% complete
- **Phase 2**: 0% complete
- **Phase 3**: 0% complete
- **Phase 4**: 0% complete
- **Phase 5**: 0% complete
- **Phase 6**: 0% complete

**Overall Progress**: 0% complete

