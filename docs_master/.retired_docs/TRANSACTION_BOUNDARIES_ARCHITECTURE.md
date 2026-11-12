# Transaction Boundaries Architecture: Game State Management

**Date:** 2024-12-19  
**Purpose:** Architectural design document for transaction boundaries, concurrency control, and game state management patterns  
**Status:** Proposal for Engineering Review Committee  
**Related Documents:** `INTRO_PROCESS_WORKFLOW_V2.md`, `ARCHITECTURE_WORKFLOW_AUDIT.md`, `BACKEND_ELEGANCE_RECOMMENDATIONS.md`

---

## Executive Summary

This document presents an architectural proposal to eliminate race conditions, standardize transaction boundaries, and create an elegant backend architecture that eliminates the need for frontend defensive patterns. The proposed changes will ensure database-level consistency guarantees while maintaining system performance through the **Precompute + Apply Pattern**.

### Problem Statement

Current architecture has **critical race condition vulnerabilities** in game initialization and turn processing:

1. **Race Conditions**: Concurrent game initialization can create duplicate intro turns
2. **Stale State**: Game state mutations occur outside transactions, leading to lost updates
3. **Inconsistent Patterns**: Three different patterns for image job creation across code paths
4. **Frontend Workarounds**: Frontend implements defensive polling and timeout patterns to mask backend issues

### Proposed Solution

Implement **transaction-boundary architecture** with these principles:

1. **LLM calls OUTSIDE transactions** (don't hold database locks during slow operations)
2. **State mutations INSIDE transactions** (atomic, consistent database updates)
3. **Single pattern per concern** (consistent behavior across all code paths)
4. **Event-driven communication** (replace polling with socket events)

### Impact

- **Eliminates race conditions** through proper transaction boundaries
- **Reduces frontend complexity** by 90% (remove polling, timeouts, validation)
- **Improves maintainability** through consistent patterns
- **Enhances performance** by avoiding long-held database locks

---

## Current Architecture & Issues

### Current Transaction Usage

The codebase currently has **inconsistent transaction boundaries**:

```61:90:server/gameInitialization.ts
export async function initializeNewGame(validated: InsertGameState): Promise<GameState> {
  // Create initial game state object (empty turns and actions)
  const gameState = await buildInitialGameState(validated);

  // Save empty state to DB first
  await storage.createGameState(gameState);

  try {
    // Load user preferences for intro processing
    const userPreferences = await storage.getUserPreferences(gameState.username);
    
    console.log('[GAME_FLOW] Processing intro turn outside transaction', {
      gameId: gameState.id,
      username: gameState.username,
      userPreferences
    });
    
    // Process intro turn - mutates gameState in place (adds turn and actions)
    // LLM calls happen here, but DB is NOT locked during this time
    await processIntroTurn(gameState, userPreferences);
    
    console.log('[GAME_FLOW] Intro turn processed', {
      gameId: gameState.id,
      hasNarration: !!gameState.turns[0]?.narrative,
      narrationLength: gameState.turns[0]?.narrative?.length || 0,
      actionsCount: gameState.currentActions.length
    });

    // Save populated gameState directly (no need for transaction/locking since we just created this game)
    await storage.updateGameState(gameState.id, gameState);
```

**Issues:**
- No transaction protection (`FOR UPDATE` lock missing)
- LLM calls (slow) happen while database is unlocked
- State mutations on potentially stale data
- Concurrent requests can both process intro turns

### Current Image Job Creation Patterns

Three different patterns exist across the codebase:

1. **Pattern A** (`processIntroTurn`): Creates image job outside transaction
2. **Pattern B** (`applyPrecomputedIntroTurn`): Creates image job inside transaction
3. **Pattern C** (`turnJobProcessor`): Creates image job after turn, attaches in separate transaction

This inconsistency leads to:
- Orphaned image jobs (if attachment fails)
- Race conditions (attachment window)
- Inconsistent frontend state

### Current Workflow Diagram (Problematic)

```
┌─────────────────────────────────────────────────────────────┐
│ CLIENT: POST /api/game/start                                │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ initializeNewGame()                                         │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 1. createGameState() - INSERT games                   │  │
│ │    (no transaction, no lock)                          │  │
│ └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 2. processIntroTurn(gameState, prefs)                 │  │
│ │    - generateTurnContentWithFlag() [LLM call]         │  │
│ │    - createImageJob() [OUTSIDE transaction]            │  │
│ │    - Mutate gameState object in memory                │  │
│ │    ⚠️ NO DATABASE LOCK                                │  │
│ └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 3. updateGameState(gameState)                         │  │
│ │    - UPDATE games SET ...                              │  │
│ │    ⚠️ May overwrite concurrent changes                │  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Race Condition Scenario:**
```
Time │ Request A                    │ Request B                    │ Database
─────┼──────────────────────────────┼──────────────────────────────┼──────────────
T1   │ createGameState(gameA)       │                              │ gameA created
T2   │                              │ createGameState(gameB)       │ gameB created  
T3   │ processIntroTurn(gameA)      │                              │ (mutating)
T4   │                              │ processIntroTurn(gameB)      │ (mutating)
T5   │ updateGameState(gameA)       │                              │ gameA saved
T6   │                              │ updateGameState(gameB)       │ gameB saved
```

**Problem:** Both requests can process intro turns concurrently, leading to:
- Duplicate intro turns if same game ID somehow created
- Stale state overwrites
- Inconsistent game state

---

## Proposed Architecture

### Architectural Decision Record: Transaction Boundaries

**Decision:** Implement Precompute + Apply Pattern for all game state mutations.

**Rationale:**
- LLM API calls are slow (1-5 seconds) - holding database locks during this time reduces concurrency
- Database operations are fast (milliseconds) - should be atomic
- Separating slow precomputation from fast database updates maximizes throughput

**Pattern:**
1. **Precompute phase** (outside transaction):
   - Generate turn content via LLM
   - Generate actions via LLM
   - Check image cache
   - No database locks held

2. **Apply phase** (inside transaction):
   - Lock game state row (`FOR UPDATE`)
   - Check-and-set (CAS) validation
   - Create image job (if needed)
   - Update game state atomically
   - Commit transaction

### Proposed Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ CLIENT: POST /api/game/start                                │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ initializeNewGame()                                         │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 1. createGameState() - INSERT games                   │  │
│ │    (no lock needed - new game creation)               │  │
│ └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 2. PRECOMPUTE PHASE (outside transaction)             │  │
│ │    - generateTurnContentWithFlag() [LLM ~2s]         │  │
│ │    - generateActions() [LLM ~1s]                      │  │
│ │    - checkImageCache() [fast]                         │  │
│ │    ✅ NO DATABASE LOCK                                │  │
│ │    ✅ Multiple requests can precompute in parallel     │  │
│ └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 3. APPLY PHASE (inside transaction)                   │  │
│ │    applyPrecomputedIntroTurn(gameId, precomputed)     │  │
│ │    ┌───────────────────────────────────────────────┐  │  │
│ │    │ BEGIN TRANSACTION                             │  │  │
│ │    │ SELECT ... FOR UPDATE (locks game row)        │  │  │
│ │    │ ┌─────────────────────────────────────────┐  │  │  │
│ │    │ │ CAS Check: if intro turn exists?        │  │  │  │
│ │    │ │ └─> Skip if found (idempotent)          │  │  │  │
│ │    │ └─────────────────────────────────────────┘  │  │  │
│ │    │ createImageJob() [if needed]                 │  │  │
│ │    │ turn.imageJobId = imageJob.id                │  │  │
│ │    │ state.turns.push(turn)                       │  │  │
│ │    │ state.currentActions = actions               │  │  │
│ │    │ UPDATE games SET ... (atomic)                │  │  │
│ │    │ COMMIT                                       │  │  │
│ │    └───────────────────────────────────────────────┘  │  │
│ │    ✅ DATABASE LOCK HELD ONLY DURING FAST OPS       │  │
│ │    ✅ FIRST REQUEST WINS (CAS prevents duplicates)   │  │
│ └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 4. Emit Socket Event                                  │  │
│ │    io.emit('introReady', { gameId })                 │  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Decision Record: Image Job Creation Pattern

**Decision:** Always create and attach image jobs inside the same transaction as turn creation.

**Rationale:**
- Ensures atomicity (job and turn reference created together)
- Eliminates orphaned jobs
- Eliminates attachment race conditions
- Single consistent pattern across all code paths

**Implementation:**
- Extract `processTurnImage()` helper function
- Call helper inside transaction for all turn creation paths
- Helper handles cache checking and job creation atomically

### Architectural Decision Record: Single Pattern Per Concern

**Decision:** Standardize on one pattern for each concern across the entire codebase.

**Patterns:**
1. **User Preferences**: Always load internally within function (simpler, `state.username` always available)
2. **Image Jobs**: Always create inside turn transaction
3. **Turn Processing**: Always via `processTurnWithTransaction` wrapper
4. **LLM Operations**: Always precompute outside, apply inside transaction

**Benefits:**
- Easier to understand (one way to do things)
- Easier to maintain (changes in one place)
- Easier to test (consistent behavior)

---

## Architecture Diagrams

### Current Architecture (Problematic)

```
┌──────────────────────────────────────────────────────────┐
│ Game Initialization Flow (Current)                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐                                        │
│  │ Create Game  │ ──┐                                   │
│  │ (No Lock)    │   │                                   │
│  └──────────────┘   │                                   │
│                     │                                   │
│  ┌──────────────┐   │                                   │
│  │ Process Intro │ ──┤ ⚠️ Race Condition Window         │
│  │ (No Lock)    │   │                                   │
│  │ - LLM calls  │   │ - Concurrent requests can both    │
│  │ - Create img │   │   process intro turns             │
│  │ - Mutate     │   │ - State may be stale              │
│  └──────────────┘   │                                   │
│                     │                                   │
│  ┌──────────────┐   │                                   │
│  │ Update State │ ──┘ ⚠️ May overwrite changes          │
│  │ (No Lock)    │                                       │
│  └──────────────┘                                       │
│                                                          │
│  Issues:                                                │
│  ⚠️ No transaction protection                           │
│  ⚠️ Race conditions possible                            │
│  ⚠️ Stale state mutations                               │
│  ⚠️ Duplicate intro turns                                │
└──────────────────────────────────────────────────────────┘
```

### Proposed Architecture (Elegant)

```
┌──────────────────────────────────────────────────────────┐
│ Game Initialization Flow (Proposed)                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐                                        │
│  │ Create Game  │                                        │
│  │ (No Lock)    │                                        │
│  └──────────────┘                                        │
│         │                                                │
│         │ PRECOMPUTE PHASE (No Lock)                    │
│         ▼                                                │
│  ┌──────────────────────────────────────┐              │
│  │ - generateTurnContentWithFlag()      │              │
│  │   [LLM call ~2s]                     │              │
│  │ - generateActions()                  │              │
│  │   [LLM call ~1s]                     │              │
│  │ - checkImageCache()                  │              │
│  │ ✅ Multiple requests can run        │              │
│  │    in parallel                       │              │
│  └──────────────────────────────────────┘              │
│         │                                                │
│         │ APPLY PHASE (With Lock)                       │
│         ▼                                                │
│  ┌──────────────────────────────────────┐              │
│  │ BEGIN TRANSACTION                    │              │
│  │ SELECT ... FOR UPDATE (lock)         │              │
│  │                                      │              │
│  │ CAS Check: intro turn exists?        │              │
│  │ └─> Skip if found (idempotent)      │              │
│  │                                      │              │
│  │ createImageJob() (if needed)         │              │
│  │ turn.imageJobId = imageJob.id        │              │
│  │ state.turns.push(turn)              │              │
│  │ UPDATE games SET ...                 │              │
│  │ COMMIT                               │              │
│  │                                      │              │
│  │ ✅ Lock held only during fast ops    │              │
│  │ ✅ First request wins (CAS)          │              │
│  │ ✅ Atomic operation                  │              │
│  └──────────────────────────────────────┘              │
│                                                          │
│  Benefits:                                              │
│  ✅ Transaction protection                               │
│  ✅ No race conditions                                   │
│  ✅ Always fresh state                                   │
│  ✅ Idempotent operations                                │
└──────────────────────────────────────────────────────────┘
```

### Transaction Boundary Visualization

```
Time →
│
│ [LLM Call 1] [LLM Call 2]          [DB Lock] [Update] [Commit]
│ ──────────── ────────────          ───────── ──────── ───────
│                                     ↑
│                                     └─ Lock held only during
│                                        fast database operations
│
│ ════════════════════════════════════════════════════════════
│ Total Time: ~3-5 seconds (LLM) + ~50ms (DB) = ~3-5 seconds
│ Lock Time:  ~50ms (only during DB operations)
│ Concurrency: High (multiple requests can precompute in parallel)
```

**Comparison:**
- **Current**: Lock held for entire operation (~3-5 seconds) = poor concurrency
- **Proposed**: Lock held only during DB ops (~50ms) = excellent concurrency

---

## Benefits & Trade-offs

### Benefits

1. **Correctness**
   - Eliminates race conditions through transaction boundaries
   - Eliminates duplicate intro turns through CAS checks
   - Eliminates stale state through locked reads
   - Ensures atomic operations

2. **Performance**
   - Better concurrency (multiple requests can precompute in parallel)
   - Shorter lock duration (only during fast DB operations)
   - Reduced database contention

3. **Maintainability**
   - Single pattern per concern
   - Consistent behavior across code paths
   - Easier to reason about code
   - Easier to test

4. **Frontend Simplification**
   - Remove polling patterns
   - Remove timeout workarounds
   - Remove defensive validation
   - Simple event listeners

### Trade-offs

1. **Complexity**
   - **Pro**: Separates concerns clearly (precompute vs apply)
   - **Con**: Two-phase pattern is slightly more complex than single-phase
   - **Mitigation**: Well-documented pattern, follows existing `applyPrecomputedIntroTurn` pattern

2. **Code Changes**
   - **Pro**: Minimal changes (refactor `initializeNewGame`, extract helper)
   - **Con**: Need to update multiple files
   - **Mitigation**: Phased rollout, backward compatibility during transition

3. **Testing**
   - **Pro**: More testable (can test precompute and apply separately)
   - **Con**: Need new tests for concurrent scenarios
   - **Mitigation**: Existing tests continue to pass, add focused concurrency tests

---

## Risk Assessment

### Implementation Risks

1. **Risk: Breaking existing functionality**
   - **Probability**: Low
   - **Impact**: High
   - **Mitigation**: 
     - Keep `processIntroTurn` for backward compatibility during transition
     - Comprehensive test suite
     - Staging deployment before production
     - Gradual rollout

2. **Risk: Performance regression**
   - **Probability**: Very Low
   - **Impact**: Medium
   - **Mitigation**: 
     - Lock duration is actually reduced (only during fast ops)
     - Precompute phase allows parallel execution
     - Performance testing in staging

3. **Risk: Transaction deadlocks**
   - **Probability**: Very Low
   - **Impact**: Medium
   - **Mitigation**: 
     - `FOR UPDATE` uses consistent ordering (by game ID)
     - Short lock duration minimizes deadlock window
     - Database retry logic for deadlock recovery

4. **Risk: Migration complexity**
   - **Probability**: Low
   - **Impact**: Low
   - **Mitigation**: 
     - No database schema changes required
     - No data migration needed
     - Code-only changes

### Rollback Plan

If issues arise:

1. **Immediate**: Revert code changes (Git rollback)
2. **Database**: No schema changes to revert
3. **Frontend**: No changes required initially (can rollback independently)
4. **Monitoring**: Watch for duplicate intro turns, orphaned jobs, transaction errors

### Success Criteria

1. **Zero race conditions**: No duplicate intro turns in production
2. **Zero orphaned jobs**: All image jobs attached atomically
3. **Performance maintained**: Response times within 10% of current
4. **Frontend simplified**: Remove polling code (separate frontend PR)

---

## Implementation Phases

### Phase 1: Critical Race Condition Fixes (Week 1)

**Deliverables:**
1. Refactor `initializeNewGame` to use precompute + apply pattern
2. Extract `processTurnImage` helper function
3. Standardize image job creation across all code paths
4. Add concurrent initialization tests

**Files Modified:**
- `server/gameInitialization.ts`
- `server/gameLogic.ts`
- `server/turnJobProcessor.ts`

**Testing:**
- Concurrent game initialization test (10 simultaneous calls)
- Image job atomicity test
- Socket event firing test

**Outcome:** Eliminates race conditions, frontend can remove defensive polling

### Phase 2: Code Cleanup (Week 2)

**Deliverables:**
1. Eliminate duplicate functions (`getItemById`, `getInitialNpcs`)
2. Standardize user preferences loading pattern
3. Remove deprecated `processIntroTurn` (optional)

**Files Modified:**
- `server/gameEngine.ts`
- `server/gameLogic.ts`
- `server/gameInitialization.ts`

**Testing:**
- Run existing test suite
- Verify game initialization still works
- Verify turn processing still works

**Outcome:** Cleaner codebase, easier maintenance

### Phase 3: Technical Debt (Backlog)

**Deliverables:**
1. Add database unique constraint for `(game_id, turn_number)`
2. Add idempotency check to `/api/game/start` endpoint

**Files Modified:**
- Database migration script
- `server/routes.ts`

**Testing:**
- Test duplicate game creation requests
- Verify constraint prevents duplicates

**Outcome:** Defense in depth, better error handling

---

## Success Metrics

### Correctness Metrics

- **Zero duplicate intro turns** in production logs (current: occasional duplicates observed)
- **Zero orphaned image jobs** (current: occasional orphaned jobs)
- **Zero stale state updates** (current: difficult to measure, but suspected)

### Performance Metrics

- **Lock duration**: < 100ms (target), < 50ms (optimal)
- **Concurrent requests**: Support 10+ simultaneous game initializations
- **Response time**: Within 10% of current (target: improve)

### Code Quality Metrics

- **Pattern consistency**: 100% (all turn creation uses same pattern)
- **Code duplication**: Eliminate duplicates (3 duplicate functions removed)
- **Test coverage**: Add concurrency tests (10+ new tests)

### Frontend Simplification Metrics

- **Polling code removed**: 100% (replace with socket events)
- **API calls reduced**: ~90% reduction (events vs polling)
- **Timeout workarounds removed**: 100%

---

## Architectural Principles

After implementation, the backend will follow these principles:

### 1. Transaction Boundaries
- **LLM calls OUTSIDE transactions** (slow, don't hold locks)
- **State mutations INSIDE transactions** (fast, atomic)
- **Precompute + apply pattern** for all turn processing

### 2. Single Pattern Per Concern
- **One pattern for image job creation** (always inside turn transaction)
- **One pattern for user preferences** (always load internally)
- **One pattern for turn processing** (always via transaction wrapper)

### 3. Idempotency & Consistency
- **CAS checks inside transactions** (check-and-set)
- **Database constraints** as defense in depth
- **Socket events for completion** (not polling)

### 4. Frontend Simplification
- **Backend guarantees correctness** (no frontend validation needed)
- **Events replace polling** (`introReady`, `turnComplete`, `imageReady`)
- **Consistent state** (no stale or partial data)

---

## Related Architectural Decisions

### ADR-001: Transaction Boundaries in Game State Management
This document serves as the ADR for transaction boundaries.

### ADR-002: Precompute + Apply Pattern for LLM Operations
Decision to move LLM calls outside transactions for better concurrency.

### ADR-003: Single Pattern per Concern
Decision to standardize patterns across codebase for maintainability.

### ADR-004: Event-Driven Frontend Communication
Decision to replace polling with socket events for real-time updates.

---

## References

- **Audit Documents:**
  - `ARCHITECTURE_WORKFLOW_AUDIT.md` - Detailed audit findings
  - `FRONTEND_WORKFLOW_IMPLICATIONS.md` - Frontend impact analysis
  - `BACKEND_ELEGANCE_RECOMMENDATIONS.md` - Triage and recommendations

- **Current Documentation:**
  - `INTRO_PROCESS_WORKFLOW_V2.md` - Current workflow documentation
  - `MODULE_STORAGE.md` - Storage layer architecture
  - `MODULE_ROUTES.md` - Routes architecture

- **Code References:**
  - `server/gameInitialization.ts:61-126` - Current `initializeNewGame` implementation
  - `server/gameLogic.ts:257-360` - `applyPrecomputedIntroTurn` (good example)
  - `server/storage.ts:1172-1252` - `processTurnWithTransaction` implementation

---

## Approval & Sign-off

**Engineering Review Committee:**

- [ ] Architecture Review
- [ ] Security Review  
- [ ] Performance Review
- [ ] Implementation Plan Approval

**Next Steps:**
1. Committee reviews and approves architecture
2. Create detailed implementation plan (already in `backend-elegance-phased-implementation.plan.md`)
3. Begin Phase 1 implementation
4. Monitor metrics and success criteria

---

**Document Version:** 1.0  
**Last Updated:** 2024-12-19  
**Status:** Pending Committee Approval

