# Game Walkthrough: From Start to Turn 3

**Purpose**: Step-by-step walkthrough showing how the PCE pipeline, orchestrator, and game/turn logic work together in practice, based on actual code implementation.

**Audience**: Engineers debugging turn processing, understanding the complete flow, or adding new features.

**Version**: 1.0 (January 2025)  
**Status**: Current and authoritative

---

## Table of Contents

1. [Overview](#overview)
2. [Game Start (Turn 0)](#game-start-turn-0)
3. [Turn 1](#turn-1)
4. [Turn 2](#turn-2)
5. [Turn 3](#turn-3)
6. [Key Code Paths](#key-code-paths)

---

## Overview

The system uses a **two-phase processing pattern** with **job-based orchestrator**:

- **Turn 0 (Intro)**: Synchronous processing, no orchestrator
- **Turn 1+**: Asynchronous via orchestrator with two-phase pattern:
  1. **PRECOMPUTE** (outside transaction): LLM calls, cache checks
  2. **APPLY** (inside transaction): Atomic state updates

**Key Components**:
- **PCE Pipeline**: Generates narrative, image prompt, and actions in one LLM call chain
- **Orchestrator**: Manages job queues (`turn-precompute`, `turn-apply`, `image`)
- **Workers**: Background processors that lease jobs and execute them

---

## Game Start (Turn 0)

### Client Request
```
POST /api/game/start
{ username: "alice", seed?: "...", absurdity?: 2 }
```

### Server Flow (routes.ts:32-59)

**1. Route Handler** (`server/routes.ts:32`)
- Validates auth via `requireAuth` middleware
- Validates username exists in database
- Parses request body

**2. Game Initialization** (`server/gameInitialization.ts:52`)
- Creates initial game state (day=1, turnNumber=0, stats=100)
- Persists empty state to database
- **Does NOT use orchestrator** - this is synchronous

**3. PRECOMPUTE PHASE** (outside transaction)
- Loads user preferences
- Calls `generateTurnContentWithFlag()` with `{ intro: true }`
  - Routes to PCE pipeline (`server/aiService.ts:1278`)
  - PCE generates: narrative + image prompt + actions **in one chain**
  - Returns `TurnContentResult` with all three
- Calls `prepareTurnImageMetadata()` for image cache check

**4. APPLY PHASE** (inside transaction)
- Calls `applyPrecomputedIntroTurn()` (`server/gameLogic.ts:419`)
- Uses `storage.processTurnWithTransaction()` for atomicity
- Creates turn 0 record with precomputed content
- Applies image metadata (or creates image job if cache miss)
- Sets `state.currentActions` from PCE pipeline output

**5. Response**
- Returns complete `GameState` with turn 0 narrative and actions
- Client can immediately display intro turn

### Key Code Paths

```110:116:server/routes.ts
      // Enqueue turn job and return immediately
      const job = await storage.createTurnJob({
        gameId: validated.gameId,
        actionPayload: validated,
        status: 'pending'
      }, (req as any).traceId, (req as any).requestId);

      res.json({ turnJobId: job.id, status: 'processing' });
```

**Note**: Turn 0 does NOT go through this path - it processes synchronously in `initializeNewGame()`.

---

## Turn 1

### Client Request
```
POST /api/game/action
{ gameId: "game-123", action: "action-id-1" }
```

### Server Flow

**1. Route Handler** (`server/routes.ts:88-121`)
- Validates game exists, belongs to user, not complete
- Calls `storage.createTurnJob()` to create job record

**2. Job Creation** (`server/storage.ts:1668-1718`)
- Inserts into `turn_jobs` table
- **Automatically enqueues to orchestrator**:
  ```typescript
  await orchestrator.enqueue({
    queue: 'turn-precompute',
    payload: { id: turnJob.id },
    idempotencyKey: generateIdempotencyKey(...),
    metadata: { gameId, turnNumber }
  });
  ```
- Emits PostgreSQL `NOTIFY queue_turn_precompute` to wake workers
- Returns immediately: `{ turnJobId, status: 'processing' }`

**3. Turn Precompute Worker** (`server/orchestrator/workers/turnPrecomputeWorker.ts:134-360`)

**Worker Claims Job**:
- Polls orchestrator queue (5s interval, or wakes on NOTIFY)
- Calls `orchestrator.claim('turn-precompute', workerId)`
- Receives `JobLease<TurnJob>` with payload `{ id: "job-123" }`

**PRECOMPUTE PHASE** (all outside transaction):

**Step 1: Load Game State** (line 154)
- Loads current game state from database
- Loads user preferences

**Step 2: Compute Turn Checks** (line 195)
- Calls `computeTurnChecks(state, action)` (`server/gameLogic.ts:503`)
- Determines: selected action, triggered events, skill, DC, dice roll, success
- All deterministic (no LLM calls)

**Step 3: Generate Turn Content** (line 203)
- Calls `generateTurnContentWithFlag()` (`server/aiService.ts:1278`)
- Routes to PCE pipeline via `ContentGenerationRouter.generateFullTurnContent()` (`server/pce/contentRouter.ts:137`)
- **PCE Pipeline executes 4 stages sequentially**:
  1. **Master Enrichment**: Context and variables
  2. **Narrative**: 6-7 sentence story
  3. **Image Prompt**: Synchronized image description
  4. **Actions**: Next turn action chips (6 actions)
- **All stages execute in one LLM call chain** - actions are NOT generated separately
- Returns `TurnContentResult` with:
  - `narration`: string
  - `imagePrompt`: string
  - `actions`: ActionChip[] ← **Actions come from here, generated in same PCE call**
  - `theme`, `style`, `promptChain`, etc.
- Duration tracked as `turnContentDuration` (includes all 4 stages)

**Step 4: Extract Actions from PCE** (line 249)
- Actions are already generated in Step 3 (PCE pipeline)
- Extracts `turnContent.actions` - **no additional LLM call**
- Validates actions array exists and is non-empty

**Step 5: Prepare Image Metadata** (line 267)
- Calls `prepareTurnImageMetadata()` (`server/gameLogic.ts:128`)
- Checks image cache (database + file system)
- Returns `{ imageUrl, templateName, promptSource } | null`

**Step 6: Build Precompute Section** (line 280)
- Calculates durations:
  - `deterministicDurationMs`: checks + image cache check
  - `llmDurationMs`: `turnContentDuration` (includes all PCE stages - note: code references undefined `actionsDuration` on line 278, but actual behavior uses `turnContentDuration` since all LLM work happens in one call)
- Builds manifest precompute section with all computed data

**Step 7: Create Manifest** (line 325)
- Updates manifest with precompute section
- Stores all computed data for apply phase

**Step 8: Enqueue Apply Job** (line 329)
```typescript
await orchestrator.enqueue({
  queue: 'turn-apply',
  payload: { id: job.id },
  metadata: { manifestId, precomputeHash, ... }
});
```

**4. Turn Apply Worker** (`server/orchestrator/workers/turnApplyWorker.ts:133-404`)

**Worker Claims Job**:
- Polls `turn-apply` queue
- Claims job with manifest ID

**APPLY PHASE** (inside transaction):

**Step 1: Load Manifest** (line 184)
- Loads precompute section from manifest
- Verifies precompute hash matches

**Step 2: Process Turn Logic** (line 248)
- Calls `storage.processTurnWithTransaction()` with precomputed data
- Calls `processTurnLogic(state, action, precomputed)` (`server/gameLogic.ts:692`)
- Uses precomputed:
  - `selectedAction`, `event`, `checks`, `success`
  - `turnContent.narration`
  - `turnContent.actions` ← Sets `state.currentActions`
- Applies stat changes, daily consumption, NPC affinities
- Creates turn record with narrative

**Step 3: Process Image** (line 271)
- Calls `processTurnImage()` with precomputed metadata
- If cache hit: applies image URL immediately
- If cache miss: creates image job atomically

**Step 4: Commit Transaction** (line 309)
- All state changes committed atomically
- Lock duration: ~5-50ms (very fast)

**Step 5: Notify Client** (line 348)
```typescript
this.io.to(job.gameId).emit('turnComplete', { 
  gameId, turnNumber: updatedState.turnNumber 
});
```

**5. Client Receives Notification**
- WebSocket event triggers React Query invalidation
- Client refetches game state
- UI displays new turn narrative and actions

### Key Code Paths

**Job Creation**:
```1668:1718:server/storage.ts
  async createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string): Promise<TurnJob> {
    const id = randomUUID();
    const result = await pool.query(
      `INSERT INTO turn_jobs (id, game_id, action_payload, status, error, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        job.gameId,
        JSON.stringify(job.actionPayload),
        job.status ?? 'pending',
        job.error || null,
        job.completedAt || null,
      ]
    );
    
    const turnJob = this.mapTurnJob(result.rows[0])!;

    if (!DISABLE_ORCHESTRATOR_ENQUEUE) {
      try {
        const gameState = await this.getGameState(job.gameId);
        if (!gameState) {
          console.warn(`[Storage] Unable to enqueue turn job ${turnJob.id}: game ${job.gameId} not found`);
        } else {
          const actionPayload = job.actionPayload as ActionInput;
          const idempotencyKey = generateIdempotencyKey(
            'turn-precompute',
            job.gameId,
            gameState.turnNumber,
            actionPayload
          );

          const orchestrator = getOrchestrator();
          await orchestrator.enqueue({
            queue: 'turn-precompute',
            payload: { id: turnJob.id },
            idempotencyKey,
            traceId,
            requestId,
            metadata: {
              gameId: job.gameId,
              turnNumber: gameState.turnNumber,
            },
          });
        }
      } catch (error) {
        console.error('[Storage] Failed to enqueue turn job to orchestrator:', error);
      }
    }

    return turnJob;
  }
```

**PCE Pipeline**:
```137:251:server/pce/contentRouter.ts
  async generateFullTurnContent(context: TurnGenerationContext): Promise<FullTurnContentResult> {
    const promptChain: StageMetadata[] = [];

    const master = await this.generateMasterEnrichment(context);
    promptChain.push(...master.metadata);

    if (!master.ok || !master.output?.enrichment) {
      // Extract actual error from metadata - log full details for debugging
      const hasMetadata = Array.isArray(master.metadata) && master.metadata.length > 0;
      console.error("[PCE] Master stage result details:", {
        ok: master.ok,
        hasOutput: !!master.output,
        hasEnrichment: !!master.output?.enrichment,
        metadataCount: hasMetadata ? master.metadata.length : 0,
        metadata: hasMetadata ? master.metadata : [],
        metadataEmpty: !hasMetadata
      });
      
      // Try to extract error from metadata
      let actualError = 'Stage failed';
      let errorMetadata: StageMetadata | undefined;
      
      if (hasMetadata) {
        errorMetadata = master.metadata.find(m => m.error) || master.metadata[0];
        actualError = errorMetadata?.error || (!master.ok ? 'Stage failed' : 'Missing enrichment');
      } else {
        // If no metadata, this is a critical issue - the stage didn't even create metadata
        actualError = !master.ok 
          ? 'Stage failed with no error metadata - possible exception in stage handler' 
          : 'Missing enrichment output';
      }
      
      const errorContext = {
        stage: 'master',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: master.output,
        metadata: hasMetadata ? master.metadata : [],
        metadataDetails: {
          errorMetadata: errorMetadata,
          allErrors: hasMetadata ? master.metadata.map(m => m.error).filter(Boolean) : [],
          hasMetadata: hasMetadata
        }
      };
      console.error("[PCE] Master stage failed", errorContext);
      throw new Error(`PCE turn generation failed: master stage failed. ${JSON.stringify(errorContext, null, 2)}`);
    }

    const narrativeStage = await this.generateNarrative(context, master.output);
    promptChain.push(...narrativeStage.metadata);

    if (!narrativeStage.ok || !narrativeStage.output) {
      // Extract actual error from metadata
      const errorMetadata = narrativeStage.metadata.find(m => m.error) || narrativeStage.metadata[0];
      const actualError = errorMetadata?.error || (!narrativeStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'narrative',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: narrativeStage.output,
        metadata: narrativeStage.metadata
      };
      console.error("[PCE] Narrative stage failed", errorContext);
      throw new Error(`PCE turn generation failed: narrative stage failed. ${JSON.stringify(errorContext)}`);
    }

    const imageStage = await this.generateImagePrompt(context, master.output, narrativeStage.output);
    promptChain.push(...imageStage.metadata);

    if (!imageStage.ok || !imageStage.output) {
      // Extract actual error from metadata
      const errorMetadata = imageStage.metadata.find(m => m.error) || imageStage.metadata[0];
      const actualError = errorMetadata?.error || (!imageStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'image',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: imageStage.output,
        metadata: imageStage.metadata
      };
      console.error("[PCE] Image stage failed", errorContext);
      throw new Error(`PCE turn generation failed: image stage failed. ${JSON.stringify(errorContext)}`);
    }

    const actionsStage = await this.generateActions(context, master.output, narrativeStage.output);
    promptChain.push(...actionsStage.metadata);

    if (!actionsStage.ok || !actionsStage.output) {
      // Extract actual error from metadata
      const errorMetadata = actionsStage.metadata.find(m => m.error) || actionsStage.metadata[0];
      const actualError = errorMetadata?.error || (!actionsStage.ok ? 'Stage failed' : 'Missing output');
      const errorContext = {
        stage: 'actions',
        gameId: context.state.id,
        turnNumber: context.state.turnNumber,
        error: actualError,
        output: actionsStage.output,
        metadata: actionsStage.metadata
      };
      console.error("[PCE] Actions stage failed", errorContext);
      throw new Error(`PCE turn generation failed: actions stage failed. ${JSON.stringify(errorContext)}`);
    }

    return {
      master,
      narrative: narrativeStage,
      image: imageStage,
      actions: actionsStage,
      promptChain,
      fallbackUsed: false
    };
  }
```

**Extracting Actions from PCE** (line 249):
```249:258:server/orchestrator/workers/turnPrecomputeWorker.ts
      // Step 3: Extract actions from PCE pipeline (already generated, no additional LLM calls)
      // The PCE pipeline always generates actions, so they should always be present
      if (!turnContent.actions || !Array.isArray(turnContent.actions) || turnContent.actions.length === 0) {
        throw new Error(`PCE pipeline failed to generate actions for turn ${computed.nextTurnNumber}. Actions missing from turnContent.`);
      }
      
      const nextActions = turnContent.actions;
      console.log('[TurnPrecomputeWorker] Using actions from PCE pipeline', {
        actionsCount: nextActions.length
      });
      // Note: Code line 278 references actionsDuration (undefined) but actual behavior
      // is that llmDurationMs = turnContentDuration since all LLM work happens in one PCE call
```

---

## Turn 2

**Flow is identical to Turn 1**:

1. Client sends action
2. Route creates turn job → auto-enqueues to orchestrator
3. TurnPrecomputeWorker:
   - Computes checks
   - Calls PCE pipeline (narrative + image + actions)
   - Checks image cache
   - Enqueues to `turn-apply`
4. TurnApplyWorker:
   - Applies precomputed data in transaction
   - Notifies client via WebSocket

**Key Difference**: Turn 2 state has turn 1's narrative as context for PCE pipeline.

---

## Turn 3

**Flow is identical to Turn 1 and Turn 2**.

**Special Behavior**: If turn 3 is even-numbered (turnNumber % 2 === 0), the apply phase also:
- Advances `day` counter
- Updates `segment` based on new day
- Applies daily resource consumption (oxygen, fuel, food, morale)

This happens in `processTurnLogic()`:
```820:836:server/gameLogic.ts
  // Advance day every 2 turns and apply daily consumption
  let consumptionChanges: any[] = [];
  if (state.turnNumber % 2 === 0) {
    state.day++;
    state.segment = getSegment(state.day);
    
    // Apply daily resource consumption
    const { deltaString: consumptionDelta } = calculateDailyConsumption(validEquippedItems);
    const { stats: statsAfterConsumption, changes: clampedChanges } = applyDelta(state.stats, consumptionDelta);
    state.stats = statsAfterConsumption;
    
    // Use clamped changes to ensure deltas match actual stat changes
    consumptionChanges = clampedChanges.map(change => ({
      ...change,
      note: 'Daily consumption'
    }));
  }
```

---

## Key Code Paths

### Orchestrator Enqueue Flow

**Job Creation** → **Auto-Enqueue**:
```typescript
// storage.createTurnJob() automatically:
1. Inserts into turn_jobs table
2. Calls orchestrator.enqueue({ queue: 'turn-precompute', ... })
3. Emits PostgreSQL NOTIFY queue_turn_precompute
4. Returns job to route handler
```

**Worker Claims**:
```typescript
// TurnPrecomputeWorker.start() polls every 5s:
1. orchestrator.claim('turn-precompute', workerId, { batchSize: 5 })
2. Receives JobLease<TurnJob> with payload { id: "job-123" }
3. Loads full job from database
4. Processes precompute phase
5. Enqueues to turn-apply queue
```

### PCE Pipeline Flow

**Single Call Chain** (all in one `generateTurnContentWithFlag()` call):
```typescript
generateTurnContentWithFlag()
  → generateTurnContent()
    → ContentGenerationRouter.generateFullTurnContent()
      → Master Enrichment Stage (LLM call)
      → Narrative Stage (LLM call, uses master output)
      → Image Prompt Stage (LLM call, uses narrative output)
      → Actions Stage (LLM call, uses narrative output)  ← All 4 stages in one call chain
      → Returns TurnContentResult with { narration, imagePrompt, actions, ... }
```

**Important**: 
- Actions are generated **as part of** the PCE pipeline in the same call chain
- The `generateActions()` function exists but is **not called separately** during normal turn processing
- Actions come from `turnContent.actions` which is populated by the PCE pipeline
- All LLM work (4 stages) is tracked as single `turnContentDuration`
- The code references `actionsDuration` (line 278) but it's undefined - the actual behavior is that `llmDurationMs = turnContentDuration` since all LLM work happens in one call

### Transaction Boundaries

**PRECOMPUTE** (outside transaction):
- LLM calls (PCE pipeline)
- Image cache checks
- Manifest creation
- Time: ~3-10 seconds

**APPLY** (inside transaction):
- State updates
- Turn record creation
- Image job creation (if cache miss)
- Time: ~5-50ms

### Image Processing

**During Precompute**:
- `prepareTurnImageMetadata()` checks cache
- Returns `{ imageUrl } | null`

**During Apply**:
- `processTurnImage()` receives precomputed metadata
- If cache hit: applies `imageUrl` immediately
- If cache miss: creates image job atomically

**Image Worker** (separate queue):
- Leases image jobs from `image` queue
- Generates image via OpenAI
- Updates turn record with image URL
- Emits `imageReady` WebSocket event

---

## Summary

**Turn 0 (Intro)**:
- Synchronous processing
- No orchestrator
- PCE pipeline generates narrative + image + actions
- Applied in transaction

**Turns 1+**:
- Asynchronous via orchestrator
- Two-phase: PRECOMPUTE → APPLY
- PCE pipeline generates everything in one call
- Actions come from `turnContent.actions` (not separate call)
- Image cache checked in precompute, applied in transaction
- WebSocket notifications for turn completion and image ready

**Key Insight**: The PCE pipeline is the **single source of truth** for turn content. It generates narrative, image prompt, and actions in one coordinated LLM call chain, ensuring consistency between all three outputs.

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Status**: Current and authoritative

