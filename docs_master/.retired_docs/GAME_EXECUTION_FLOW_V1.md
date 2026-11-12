# Game Execution Flow Architecture

**Purpose**: This document provides a comprehensive architectural and functional overview of the core game execution flow for engineers and architects working with the Uranus Dungeon Guide codebase.

**Audience**: Software architects, senior engineers, and developers who need to understand the execution flow, data integrity patterns, and system design decisions.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Components](#core-components)
3. [Architectural Patterns](#architectural-patterns)
4. [Execution Flows](#execution-flows)
5. [Data Flow & State Management](#data-flow--state-management)
6. [Transaction Safety & Concurrency](#transaction-safety--concurrency)
7. [Dependencies & External Services](#dependencies--external-services)
8. [Key Design Decisions](#key-design-decisions)

---

## System Overview

The game execution system is responsible for:

1. **Game Initialization**: Creating new game instances with proper initial state
2. **Turn Processing**: Executing player actions through deterministic game mechanics
3. **State Management**: Maintaining game state consistency across concurrent operations
4. **AI Integration**: Generating narrative content and player actions via LLM calls
5. **Resource Management**: Tracking and consuming game resources (oxygen, fuel, food, morale, hull, weirdness)
6. **Event System**: Triggering and resolving contextual events based on game conditions

The system follows a **job-based asynchronous architecture** with **transaction-safe synchronous processing** for critical game state updates.

---

## Core Components

### 1. `gameEngine.ts` - Core Game Mechanics

**Purpose**: Provides pure game logic functions without side effects (database, AI calls).

**Key Functions**:

```typescript
// Resource Management
calculateDailyConsumption(equippedItems: Item[]): { deltaString: string; changes: any[] }

// Progression & Scaling
getSegment(day: number): Segment
calculateDC(baseDC: number, turnNumber: number, morale: number): number
clampStat(value: number, min?: number, max?: number): number

// Win/Loss Conditions
checkFailState(stats: GameStats): string | null
checkWinCondition(state: GameState): boolean

// Event System
getTriggeredEvents(state: GameState): Promise<EventDefinition[]>
evaluateTriggerCondition(event: EventDefinition, state: GameState): boolean

// State Modification
applyDelta(stats: GameStats, deltaString: string): { stats: GameStats; changes: any[] }

// Deterministic Randomness
class SeededRandom { rollD20(gameId, turn, context): number }
```

**Architectural Characteristics**:
- **Stateless**: Functions are pure (except async data loading)
- **Deterministic**: Given same inputs, produces same outputs
- **Reference Data Loading**: Loads items, events, NPCs from reference system (not database)
- **No Side Effects**: Does not write to database or make external API calls

**Data Sources**:
- Loads active items, events, and NPCs via `getCurrentReference()` from reference release system
- Reference data is cached in-memory after first load

**Item Efficiency System**:
- Items can have `efficiency` property that reduces daily consumption
- Format: `{ oxygen: number, fuel: number, food: number, morale: number }`
- Example: `{ oxygen: 1, fuel: 2 }` reduces oxygen consumption by 1, fuel by 2
- Applied in `calculateDailyConsumption()` to reduce resource drain

---

### 2. `gameInitialization.ts` - Game Bootstrap

**Purpose**: Creates new game instances and prepares initial game state.

**Key Functions**:

```typescript
// Game Creation
initializeNewGame(validated: InsertGameState): Promise<GameState>
buildInitialGameState(validated: InsertGameState): Promise<GameState>

// Creative Selections (PCE System)
getCreativeSelections(overrides, defaults): Promise<CreativeSelectionInput>
```

**Execution Flow**:

1. **Generate Unique IDs**: Creates `gameId` (UUID) and `seed` (UUID or provided)
2. **Build Initial State**:
   - Day: `1`
   - Turn: `0`
   - Segment: `getSegment(1)` → `'Moon Flyby'`
   - Stats: All resources at `100` (hull, oxygen, fuel, food, morale), weirdness at `0`
   - NPCs: Loads from reference data with starting affinities
   - Equipped Items: Default items `['red_tape', 'universal_allen_key', 'nebula_freshener']`
3. **Persist Empty State**: Saves empty game state to database via `storage.createGameState()`
4. **Two-Phase Intro Turn Processing** (concurrency optimization):
   - **PRECOMPUTE PHASE** (outside transaction):
     - Load user preferences: `storage.getUserPreferences(username)`
     - Generate intro narrative: `generateTurnContentWithFlag(..., { intro: true })`
     - Generate initial actions: `generateActions(state, userPreferences)`
     - This phase allows concurrent requests to precompute in parallel without holding database locks
   - **APPLY PHASE** (inside transaction):
     - Call `applyPrecomputedIntroTurn(gameId, { turnContent, actions }, userPreferences)`
     - Creates turn 0 with precomputed content
     - Processes image (cache check or job creation) atomically
     - CAS-style check prevents duplicate intro turns under concurrent requests
5. **Error Handling**: On failure, cleans up orphaned game state
6. **WebSocket Notification**: Emits `introReady` event to game room
7. **Return Complete State**: Returns fully initialized game with intro narrative and actions

**Initial State Schema**:
```typescript
{
  id: string (UUID)
  username: string
  seed: string (UUID)
  day: 1
  turnNumber: 0
  segment: 'Moon Flyby' (from getSegment(1))
  absurdity: number (1-5, default 2)
  stats: { hull: 100, oxygen: 100, fuel: 100, food: 100, morale: 100, weirdness: 0 }
  npcs: NPC[] (from reference data via getInitialNpcs())
  equippedItems: ['red_tape', 'universal_allen_key', 'nebula_freshener'] (default items)
  turns: [] (empty initially)
  currentActions: [] (populated after intro turn)
  runningGags: []
  eventHistory: []
  interviewResponses: {}
  isComplete: false
}
```

---

### 3. `gameLogic.ts` - Turn Processing Logic

**Purpose**: Orchestrates the complete turn processing pipeline, including AI generation, game mechanics, and state updates.

**Key Functions**:

```typescript
// Entry Points
processTurnWithTransaction(gameId: string, action: ActionInput): Promise<GameState>
  // Note: This is a wrapper in gameLogic.ts that calls storage.processTurnWithTransaction()
  // The actual transaction implementation is in storage.ts (lines 1369-1449)

processTurnLogic(state: GameState, action: ActionInput): Promise<GameState>
  // Core turn processing logic (can be called inside or outside transaction)

prepareInitialGameState(state: GameState): Promise<GameState>
  // Legacy helper for intro turn processing

// Intro Turn Handling
processIntroTurn(state: GameState, userPreferences?): Promise<GameState>
  // Legacy intro turn processing (called outside transaction)

applyPrecomputedIntroTurn(gameId, precomputed, userPreferences): Promise<GameState>
  // New pattern: applies precomputed content inside transaction (CAS-style check)

buildIntroActionInput(gameId: string): ActionInput
  // Helper to create action input for intro turn

// Image Processing
processTurnImage(state, turn, userPreferences, turnNumber): Promise<void>
  // CRITICAL: Should be called INSIDE transaction for atomicity
  // Handles cache check + image job creation atomically
```

**Turn Processing Pipeline** (`processTurnLogic`):

#### Phase 1: Action Validation & Setup
1. **Load User Preferences**: `storage.getUserPreferences(username)` → Theme, style, image model preferences
2. **Handle Intro Turn**: Special path for turn 0 (routes to `processIntroTurn()`)
3. **Validate Action**: Find action in `currentActions` or map custom text to intent
4. **Increment Turn Number**: `state.turnNumber++`

#### Phase 2: Event Detection
5. **Check Triggered Events**: `getTriggeredEvents(state)`
   - Evaluates all active events against current game state
   - Returns events where `evaluateTriggerCondition()` returns `true`
   - Takes first triggered event (if any)

#### Phase 3: Skill Check Resolution
6. **Determine Skill & DC**:
   - If event triggered: Use event's skill and DC
   - Otherwise: Map action intent to skill, get base DC from risk level
7. **Calculate Final DC**: `calculateDC(baseDC, turnNumber, morale)`
   - Base DC increases by 1 every 3 turns
   - Low morale (< 30) adds +1 to DC
8. **Calculate Bonuses**:
   - Item bonuses: Sum skill bonuses from equipped items matching skill
   - NPC affinity bonuses: +2 (affinity ≥ 2), +1 (affinity = 1), -1 (affinity ≤ -1)
   - Advantage: Check for items with scene effects granting advantage
9. **Roll Dice**: Deterministic D20 roll using `SeededRandom`
   - Seed: `state.seed`
   - Context: `${gameId}-${turnNumber}-${action.action}`
   - Advantage: Roll twice, take higher (if applicable)
10. **Calculate Success**: `finalRoll >= dc`

#### Phase 4: Content Generation
11. **Generate Turn Narrative**: `generateTurnContentWithFlag()`
    - Routes to PCE or legacy path based on `isPceEnabled()` setting
    - **PCE Path** (when enabled):
      - Uses `ContentGenerationRouter` to orchestrate multi-stage pipeline:
        1. **Master Enrichment Stage**: Generates context, variables, and guidance
        2. **Narrative Stage**: Generates 6-7 sentence narrative using enrichment
        3. **Image Prompt Stage**: Generates synchronized image prompt
        4. **Actions Stage**: Generates next turn actions
      - Falls back to legacy if any PCE stage fails
      - Returns: `{ narration, imagePrompt, theme, style, promptChain, masterEnrichment, toneHints, fallbackUsed, ... }`
    - **Legacy Path** (when PCE disabled):
      - Uses separate prompt templates for narrative and image generation
      - Returns: `{ narration, imagePrompt, theme, style, fallbackUsed: false }`
    - See `server/pce/contentRouter.ts` and `server/aiService.ts` for implementation details

#### Phase 5: State Updates
12. **Apply Stat Changes**:
    - If event: Use `event.passEffect` or `event.failEffect`
    - Otherwise: Use `getActionConsequences(action, success)`
    - Apply item scene effects based on action/event tags
    - Execute: `applyDelta(state.stats, deltaString)`
13. **Daily Resource Consumption** (every 2 turns):
    - Advance day: `state.day++`, update segment: `getSegment(state.day)`
    - Calculate consumption: `calculateDailyConsumption(equippedItems)`
    - Apply consumption deltas (negative values)
14. **Update NPC Affinities**: Based on skill used and success/failure
15. **Check Win/Loss Conditions**:
    - `checkFailState()`: Returns failure reason if any stat critical
    - `checkWinCondition()`: Day 12, segment 'Arrival on Uranus', any stat ≥ 30
    - Set `isComplete: true` if either condition met

#### Phase 6: Turn Recording
16. **Create Turn Record**:
    ```typescript
    {
      turnNumber: number
      action: string (action identifier or custom text)
      narrative: string
      checks: Check[]
      delta: Change[] (combined action effects + daily consumption)
      timestamp: number
      // Image-related fields (PCE system)
      imagePrompt?: string
      imageStyle?: string
      imageModelKey?: string
      imageMetadata?: Record<string, unknown> | null
      imageTemplate?: string
      imagePromptSource?: 'pce' | 'template'
      imageJobId?: string (if image job created, set inside transaction)
      imageStatus?: 'pending' | 'completed' (set inside transaction)
      imageUrl?: string (if cache hit, set inside transaction)
      // PCE enrichment fields
      promptChain?: StageMetadata[] (tracks PCE pipeline stages)
      masterEnrichment?: Record<string, unknown> | null
      toneHints?: string[]
      theme?: string
      style?: string
      fallbackUsed?: boolean (true if PCE failed and legacy used)
    }
    ```
17. **Append to State**: `state.turns.push(turn)`

#### Phase 7: Image Processing (Two-Phase Pattern)
18. **Prepare Image Metadata** (OUTSIDE transaction):
    - Called via `prepareTurnImageMetadata(state, turn, userPreferences, turnNumber)`
    - Performs I/O operations without holding transaction locks:
      - Select template: `selectImageTemplate(state)`
      - Check image cache: `checkImageCache()` (database queries, file reads)
      - Convert image URLs: `convertImageUrlToStaticPath()` (database reads)
      - Returns: `{ imageUrl, templateName, promptSource, modelKey } | null`
    - **Time**: ~50-500ms (no lock held)

19. **Process Turn Image** (INSIDE transaction, atomic):
    - Called via `processTurnImage(state, turn, userPreferences, turnNumber, precomputedMetadata)`
    - **This is the FIRST-CLASS function used by ALL turns, including Turn 0 (Intro Turn)**
    - **Standard pattern**:
      1. Call `prepareTurnImageMetadata()` OUTSIDE transaction
      2. Call `processTurnImage()` with precomputed metadata INSIDE transaction
    - **If cache hit**: Apply metadata to turn (fast, no I/O)
      - Set `turn.imageUrl`, `turn.imageTemplate`, `turn.imageStatus = 'completed'`
    - **If cache miss**: Create image job atomically
      - `storage.createImageJob()` ← **Only this needs transaction**
      - Link to turn via `turn.imageJobId` (inside same transaction)
    - **Time**: ~5-10ms (lock held only during job creation)

#### Phase 8: Next Actions Generation
19. **Generate New Actions** (if game not complete):
    - `generateActions(state, userPreferences)`
    - LLM call that creates 6 action chips based on current state
    - Updates `state.currentActions`

**Special Case: Intro Turn** (`processIntroTurn`):

- Checks if turn 0 already exists (idempotency)
- Generates intro narrative via `generateTurnContentWithFlag(..., { intro: true })`
- **Uses standard two-phase pattern**:
  - Prepares image metadata via `prepareTurnImageMetadata()` (outside transaction)
  - Processes image via `processTurnImage()` with precomputed metadata (standard for all turns)
- Generates initial actions for player

**New Pattern: Precomputed Intro Turn** (`applyPrecomputedIntroTurn`):

- Used by `initializeNewGame()` for better concurrency
- Receives precomputed content (narrative, actions) generated outside transaction
- CAS-style check: Verifies turn 0 doesn't exist before applying (prevents duplicates)
- Processes image via `processTurnImage()` inside transaction (atomic)
- Applies precomputed content atomically in short transaction

---

### 4. `turnJobProcessor.ts` - Asynchronous Job Processor

**Purpose**: Processes player actions asynchronously via background job queue.

**Architecture Pattern**: Background worker with polling interval.

**Key Methods**:

```typescript
class TurnJobProcessor {
  start(intervalMs = 500): void
  stop(): void
  private processPendingJobs(): Promise<void>
  private processJob(job: TurnJob): Promise<void>
}
```

**Execution Flow**:

1. **Poll for Jobs** (every 500ms):
   - Claims up to 5 pending jobs: `storage.claimPendingTurnJobs(5)`
   - Jobs are atomically marked as 'processing' during claim
   - Processes sequentially (prevents concurrent processing flag)

2. **Process Each Job**:
   ```
   Job marked as 'processing' (during claim)
     ↓
   Execute turn and image processing in single transaction:
     storage.processTurnWithTransaction(gameId, async (state) => {
       const newState = await processTurnLogic(state, action)
       
       // Get user preferences for image processing
       const userPreferences = await storage.getUserPreferences(state.username)
       
       // Process image INSIDE transaction (atomic)
       const lastTurn = newState.turns[newState.turns.length - 1]
       if (lastTurn) {
         await processTurnImage(newState, lastTurn, userPreferences, newState.turnNumber)
       }
       
       return newState
     })
     ↓
   Mark turn job as 'completed'
     ↓
   Emit WebSocket: 'turnComplete'
   ```

3. **Error Handling**:
   - On failure: Mark job as `'failed'` with error message
   - Log error for debugging
   - Continue processing other jobs

**Job Queue Schema**:
```typescript
{
  id: string (UUID)
  gameId: string
  actionPayload: ActionInput (JSON)
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error?: string
  createdAt: timestamp
  completedAt?: timestamp
}
```

**Concurrency Control**:
- Processing flag prevents overlapping execution cycles
- Sequential job processing (one at a time per processor instance)
- Transaction-level locking prevents race conditions within turn processing

---

## Architectural Patterns

### 1. Transaction-Safe State Updates

**Pattern**: All game state mutations occur within database transactions with row-level locking.

**Implementation**:

```typescript
// storage.ts (lines 1369-1449) - AUTHORITATIVE IMPLEMENTATION
async processTurnWithTransaction(
  gameId: string,
  processor: (state: GameState) => Promise<GameState>
): Promise<GameState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Row-level lock prevents concurrent updates
    const result = await client.query(
      'SELECT * FROM games WHERE id = $1 FOR UPDATE',
      [gameId]
    );
    
    // Convert database row to GameState
    const gameState = convertRowToGameState(result.rows[0]);
    
    // Process turn logic
    const updatedState = await processor(gameState);
    
    // Update within transaction
    await client.query(
      `UPDATE games SET ... WHERE id = $17`,
      [/* updated state fields */]
    );
    
    await client.query('COMMIT');
    return updatedState;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Note**: `gameLogic.ts` exports a wrapper function `processTurnWithTransaction()` that delegates to `storage.processTurnWithTransaction()`. The actual transaction implementation is in `storage.ts`.

**Benefits**:
- Prevents race conditions when multiple requests target same game
- Ensures atomic state updates (all-or-nothing)
- Maintains referential integrity

**Usage Points**:
- `gameInitialization.ts`: Intro turn processing (via `applyPrecomputedIntroTurn()`)
- `gameLogic.ts`: `processTurnWithTransaction()` wrapper (delegates to storage)
- `turnJobProcessor.ts`: Job execution (includes image processing in transaction)
- `imageJobProcessor.ts`: Image URL updates to game state

### 2. Job-Based Asynchronous Processing

**Pattern**: Long-running operations (AI generation, image creation) are deferred to background workers.

**Flow**:
```
Client Request → Create Job → Return Immediately
                     ↓
            Background Worker
                     ↓
         Process Job → Update State
                     ↓
         WebSocket Notification
```

**Benefits**:
- Non-blocking API responses
- Better scalability (can scale workers independently)
- Fault tolerance (jobs can be retried)
- Observable processing (job status tracking)

**⚠️ CRITICAL ISSUE**: Image processing currently happens INSIDE the turn transaction, but it performs unnecessary I/O operations (database queries, file reads, logging) while holding the lock. Only the atomic operation of creating the image job and linking it to the turn needs to be in the transaction. The cache check should happen outside the transaction, similar to the intro turn's two-phase pattern.

### 2a. Two-Phase Processing Pattern (Intro Turn)

**Pattern**: Separate LLM-heavy operations from database transactions to improve concurrency.

**Flow**:
```
PRECOMPUTE PHASE (outside transaction):
  Generate LLM content → No database locks held
                     ↓
APPLY PHASE (inside transaction):
  Atomic update → Short transaction duration
                     ↓
         Complete State Returned
```

**Benefits**:
- Multiple concurrent requests can precompute in parallel
- Database locks held only during fast operations
- CAS-style checks prevent duplicate work
- Better throughput under concurrent load

### 3. Reference Data System

**Pattern**: Game content (items, events, NPCs, prompts) loaded from versioned reference releases, not database tables.

**Implementation**:

```typescript
// reference/referenceLoader.ts
getCurrentReference(): Promise<ReferenceData> {
  // In-memory cache (TTL: until server restart)
  if (cache) return cache;
  
  // Load from current reference release
  const release = await storage.getCurrentReferenceRelease();
  const data = await loadFromFilesystem(`releases/${release.version}/`);
  
  cache = { version: release.version, data, ... };
  return cache;
}
```

**Data Structure**:
- Reference releases stored in `releases/{version}/` directory
- Manifest file (`manifest.json`) lists all data files
- Data files: `items.json`, `events.json`, `npcs.json`, `prompts.json`, etc.
- Database tracks current active release version

**Data Normalization**:
- Events may have `triggerCondition` or `trigger_condition` (handles both formats)
- Events may have `passEffect` or `pass_effect` (handles both formats)
- Items may have `skillBonusSkill`/`skillBonusValue` or structured `skillBonus` object
- See `gameEngine.ts` `normalizeTriggerCondition()` and `getActiveEvents()` for normalization logic

**Benefits**:
- Versioned content updates (can rollback)
- Fast in-memory access (cached)
- Separation of game logic from content data
- Content can be tested in isolation

### 4. Deterministic Game Mechanics

**Pattern**: Game outcomes are deterministic based on seed and game state, not random chance.

**Implementation**:

```typescript
// SeededRandom class (gameEngine.ts)
class SeededRandom {
  constructor(seed: string) {
    this.seed = this.hashString(seed);
  }
  
  rollD20(gameId: string, turn: number, context: string): number {
    const contextSeed = `${gameId}-${turn}-${context}`;
    const rng = new SeededRandom(contextSeed);
    return rng.nextInt(1, 20);
  }
}
```

**Deterministic Elements**:
- Dice rolls: Based on game seed + turn + context (uses hash-based RNG)
- Event triggers: Based on stat values, day modulo, logical conditions
  - **⚠️ CLARIFICATION NEEDED**: Some events use `'random'` trigger type with `Math.random()` (non-deterministic). Document whether this is intentional or should use seeded RNG.
- DC scaling: Mathematical formula based on turn number and morale

**Benefits**:
- Reproducible game states (for debugging)
- Fair gameplay (same inputs = same outputs)
- Testable mechanics

### 5. Delta String Pattern

**Pattern**: Stat changes expressed as string-based delta commands, then parsed and applied.

**Format**: `"resource+amount,resource-amount"`

**Example**: `"hull+3,morale+2,weirdness+1"`

**Implementation**:

```typescript
applyDelta(stats: GameStats, deltaString: string): { stats: GameStats; changes: any[] } {
  // Parse: "hull+3,morale-1" → [{ stat: 'Hull', change: 3 }, { stat: 'Morale', change: -1 }]
  // Apply with clamping (0-100 for most stats, 0-5 for weirdness)
  // Return both updated stats and change list for UI display
}
```

**Benefits**:
- Human-readable stat change definitions (in events, items)
- Easy to compose (can concatenate deltas)
- Can be stored/logged for audit

---

## Execution Flows

### Flow 1: Game Initialization (Synchronous)

**Endpoint**: `POST /api/game/start`

**Steps**:

```
1. Client Request
   └─► POST /api/game/start { username, seed?, absurdity? }

2. Validation
   ├─► Auth check: requireAuth middleware
   ├─► Rate limit: gameStartRateLimit middleware
   ├─► Validate user exists: storage.getUserByUsername(username)
   └─► insertGameStateSchema.parse(req.body)

3. Game Creation
   └─► initializeNewGame(validated)
       ├─► buildInitialGameState()
       │   ├─► Generate gameId (UUID)
       │   ├─► Generate/use seed (UUID)
       │   ├─► Set initial stats (all 100)
       │   ├─► Load NPCs from reference
       │   └─► Set default equipped items
       │
       ├─► storage.createGameState(emptyState)
       │   └─► Save empty state first
       │
       └─► Two-Phase Intro Processing:
           │
           ├─► PRECOMPUTE PHASE (outside transaction)
           │   ├─► storage.getUserPreferences(username)
           │   ├─► generateTurnContentWithFlag(..., { intro: true })
           │   │   └─► LLM call for intro narrative + image prompt
           │   └─► generateActions(state, userPreferences)
           │       └─► LLM call for initial actions
           │
           └─► APPLY PHASE (inside transaction)
               └─► applyPrecomputedIntroTurn(gameId, { turnContent, actions }, userPreferences)
                   ├─► CAS check: Verify turn 0 doesn't exist
                   ├─► Create turn 0 with precomputed content
                   ├─► processTurnImage() [atomic]
                   │   ├─► checkImageCache()
                   │   ├─► If cache hit: Set imageUrl, imageStatus='completed'
                   │   └─► If cache miss: createImageJob() atomically
                   ├─► Apply actions to state.currentActions
                   └─► Return updated state

4. Error Handling (if intro creation fails)
   └─► storage.deleteGameState(gameId) [cleanup orphaned game]

5. WebSocket Notification
   └─► Emit 'introReady' event to game room

6. Response
   └─► Return complete GameState (JSON) with introApplied: true
       - Includes turn 0 narrative
       - Includes initial actions
       - Ready to play
```

**Characteristics**:
- **Synchronous**: Client waits for complete initialization
- **Two-Phase**: LLM calls outside transaction, application inside transaction
- **Concurrent-Safe**: CAS-style check prevents duplicate intro turns
- **Error Handling**: Cleans up orphaned game state on failure

**Time Complexity**: ~3-8 seconds (includes LLM calls for intro + actions, precomputed outside transaction)

---

### Flow 2: Player Action (Asynchronous Job-Based)

**Endpoint**: `POST /api/game/action`

**Steps**:

```
1. Client Request
   └─► POST /api/game/action { gameId, action, customText? }

2. Validation & Job Creation
   ├─► actionInputSchema.parse(req.body)
   ├─► Verify game exists and not complete
   └─► storage.createTurnJob({
         gameId,
         actionPayload: validated,
         status: 'pending'
       })

3. Immediate Response
   └─► Return { turnJobId, status: 'processing' }
       (Client does not wait for turn processing)

4. Background Processing (TurnJobProcessor)
   └─► Poll for pending jobs (every 500ms)
       └─► For each job:
           ├─► Claim job (atomically marked as 'processing')
           │   └─► storage.claimPendingTurnJobs(5)
           │
           ├─► Execute Turn Logic + Image Processing (Single Transaction)
           │   └─► storage.processTurnWithTransaction(gameId, async (state) => {
           │         const newState = await processTurnLogic(state, action)
           │         // [Full turn processing pipeline - see below]
           │         
           │         // Get user preferences for image processing
           │         const userPreferences = await storage.getUserPreferences(state.username)
           │         
           │         // Process image INSIDE transaction (atomic)
           │         const lastTurn = newState.turns[newState.turns.length - 1]
           │         if (lastTurn) {
           │           await processTurnImage(newState, lastTurn, userPreferences, newState.turnNumber)
           │           // Handles cache check + job creation atomically
           │         }
           │         
           │         return newState
           │       })
           │
           ├─► Mark turn job as 'completed'
           │
           └─► Emit WebSocket: 'turnComplete'
               └─► { gameId, turnNumber }

5. Image Processing (Separate Processor)
   └─► ImageJobProcessor polls image jobs
       ├─► Check cache first
       ├─► Generate if cache miss
       ├─► Update game state with imageUrl
       └─► Emit WebSocket: 'imageReady'
```

**Detailed Turn Processing Pipeline** (Two-Phase Pattern):

**PRECOMPUTE PHASE** (OUTSIDE transaction - no locks held):

```
Input: GameState (current), ActionInput
   │
   ├─► 1. Compute Turn Checks (deterministic, no LLM calls)
   │   └─► computeTurnChecks(state, action)
   │       ├─► Find selected action or map custom text → intent
   │       ├─► Check triggered events: getTriggeredEvents(state)
   │       ├─► Determine skill & DC (with bonuses, advantage)
   │       ├─► Roll dice (deterministic): SeededRandom.rollD20(...)
   │       └─► Return: { selectedAction, event, skill, dc, checks, success, nextTurnNumber }
   │
   ├─► 2. Generate Turn Content (LLM call - OUTSIDE transaction)
   │   └─► generateTurnContentWithFlag(state, selectedAction.action, checks, preferences, event)
   │       ├─► Routes to PCE or legacy path
   │       └─► Returns: { narration, imagePrompt, theme, style, promptChain, ... }
   │
   ├─► 3. Compute Post-Turn State (for accurate action generation)
   │   └─► computePostTurnState(state, computed, equippedItems)
   │       ├─► Applies stat changes (same logic as processTurnLogic)
   │       ├─► Advances day if needed
   │       ├─► Applies daily consumption
   │       └─► Returns: Temporary state reflecting turn changes
   │
   ├─► 4. Generate Next Actions (LLM call - OUTSIDE transaction)
   │   └─► generateActions(postTurnState, preferences)
   │       └─► Returns: ActionChip[] (6 actions for next turn)
   │
   └─► 5. Prepare Image Metadata (cache check - OUTSIDE transaction)
       └─► prepareTurnImageMetadata(state, turn, preferences, turnNumber)
           ├─► Check image cache (database queries, file reads)
           └─► Returns: { imageUrl, templateName, promptSource, modelKey } | null
```

**APPLY PHASE** (INSIDE transaction - atomic, fast):

```
Input: GameState (locked), ActionInput, PrecomputedContent
   │
   ├─► 6. Process Turn Logic (with precomputed content)
   │   └─► processTurnLogic(state, action, precomputed)
   │       ├─► Use precomputed: selectedAction, event, checks, success, turnContent, actions
   │       ├─► Increment turn: state.turnNumber++
   │       ├─► Calculate stat changes (deterministic logic)
   │       ├─► Apply daily consumption (if turnNumber % 2 === 0)
   │       ├─► Update NPC affinities
   │       ├─► Check win/loss conditions
   │       ├─► Create turn record with precomputed narrative
   │       └─► Apply precomputed actions (no LLM call)
   │
   ├─► 7. Process Turn Image (with precomputed metadata)
   │   └─► processTurnImage(state, turn, preferences, turnNumber, precomputedImageMetadata)
   │       ├─► If cache hit: Apply metadata (fast, no I/O)
   │       └─► If cache miss: Create image job atomically
   │
   └─► 8. Commit Transaction
       └─► Return: Updated GameState
```

**Backward Compatibility**:
- `processTurnLogic` can be called without precomputed content (less efficient)
- Will compute checks and generate content inline (LLM calls inside transaction)
- Maintains compatibility with test code and direct callers

**Characteristics**:
- **Asynchronous**: API returns immediately
- **Observable**: Client tracks job status via WebSocket
- **Resilient**: Failed jobs can be retried
- **Scalable**: Multiple workers can process jobs
- **Optimized**: Two-phase pattern moves LLM calls outside transaction

**Time Complexity**: 
- API Response: < 100ms
- **PRECOMPUTE Phase** (outside transaction): ~3-10 seconds
  - Compute checks: < 100ms
  - Generate turn content: ~2-8s (LLM call)
  - Generate actions: ~1-3s (LLM call)
  - Prepare image metadata: ~50-500ms (cache check)
- **APPLY Phase** (inside transaction): ~5-50ms
  - Process turn logic: ~5-10ms (deterministic, no LLM calls)
  - Process image: ~5-10ms (apply metadata or create job)
  - Commit transaction: ~5-10ms
- Image Generation: ~3-10 seconds (separate async process, after turn completes)

**Lock Duration**: Reduced from ~5-15 seconds to ~5-50ms (99%+ reduction)

---

## Data Flow & State Management

### Game State Structure

```typescript
interface GameState {
  // Identity
  id: string                    // UUID
  username: string              // Player identifier
  seed: string                  // Deterministic randomness seed
  
  // Progression
  day: number                   // 1-12 (day 12 = arrival)
  turnNumber: number             // 0, 1, 2, ...
  segment: Segment              // 'Launch from Earth' | 'Moon Flyby' | ...
  
  // Configuration
  absurdity: number             // 1-5 (affects narrative tone)
  
  // Resources
  stats: {
    hull: number                // 0-100 (ship integrity)
    oxygen: number               // 0-100 (life support)
    fuel: number                 // 0-100 (propulsion)
    food: number                 // 0-100 (sustenance)
    morale: number               // 0-100 (crew happiness)
    weirdness: number            // 0-5 (cosmic anomaly meter)
  }
  
  // Characters
  npcs: NPC[]                   // Crew members with affinity status
  
  // Inventory
  equippedItems: string[]       // Array of item IDs
  
  // History
  turns: Turn[]                  // All processed turns
  currentActions: ActionChip[]  // Available actions for next turn
  runningGags: string[]         // Recurring event names
  eventHistory: string[]         // Event IDs that have occurred
  
  // Customization
  interviewResponses: Record<string, string>  // Player choices
  
  // Completion
  isComplete: boolean
  failureReason?: string
}
```

### State Mutation Points

1. **Game Creation**: `gameInitialization.ts` → Sets initial values
2. **Turn Processing**: `gameLogic.ts` → Updates stats, turns, actions
3. **Image Updates**: `imageJobProcessor.ts` → Updates turn.imageUrl
4. **Item Equipping**: Direct API → Updates `equippedItems` array

### State Persistence

- **Storage**: PostgreSQL database (`games` table)
- **Serialization**: GameState stored as JSONB columns
- **Update Pattern**: Full state replacement (not incremental)
- **Transaction Safety**: All updates within transactions

### State Consistency Guarantees

1. **Transaction Isolation**: Turn processing locked via `FOR UPDATE`
2. **Atomic Updates**: Entire GameState updated in single transaction
3. **Deterministic Progression**: Same seed + actions = same state
4. **Referential Integrity**: NPCs, items loaded from reference (validated)

---

## Transaction Safety & Concurrency

### Concurrency Scenarios

#### Scenario 1: Concurrent Action Requests

**Problem**: Two clients submit actions for same game simultaneously.

**Solution**: 
- `processTurnWithTransaction()` uses `FOR UPDATE` row lock
- First transaction acquires lock, second waits
- Sequential processing ensures state consistency

**Example**:
```
Time  | Client A              | Client B              | Database
------|-----------------------|-----------------------|------------------
T0    | POST /action          |                       | Lock acquired (A)
T1    |                       | POST /action          | Wait for lock
T2    | processTurnLogic()    |                       | Processing (A)
T3    | Commit transaction    |                       | Lock released
T4    |                       | Lock acquired (B)      | Processing (B)
T5    |                       | processTurnLogic()     | ...
```

#### Scenario 2: Image Job Updates Turn State

**Problem**: Image job processor updates game state while turn job is processing.

**Solution**:
- Both use `processTurnWithTransaction()` with locking
- Image updates are transactional and atomic
- Turn processor reads latest state before updating

**Example**:
```typescript
// ImageJobProcessor
await storage.processTurnWithTransaction(gameId, async (latestState) => {
  // latestState is guaranteed to be most recent due to lock
  const turn = latestState.turns.find(t => t.turnNumber === job.turnNumber);
  turn.imageUrl = result.imageUrl;
  return latestState;
});
```

### Lock Acquisition Order

To prevent deadlocks, always acquire locks in consistent order:
1. Game state row (via `processTurnWithTransaction`)
2. Reference data (read-only, no locks)
3. Image jobs (separate table, no lock conflicts)

### Transaction Scope

**Inside Transaction**:
- Game state read (locked)
- Turn processing logic
- Image processing (cache check + job creation)
- Game state write

**Outside Transaction** (for intro turn only):
- LLM API calls for intro narrative and actions (precompute phase)
- Allows concurrent requests to proceed in parallel

**Outside Transaction** (for all turns):
- ✅ **OPTIMIZED**: LLM calls now happen outside transaction for regular turns (two-phase pattern)
- **PRECOMPUTE Phase** (outside transaction):
  - Compute turn checks: `computeTurnChecks()` (deterministic, fast)
  - Generate turn content: `generateTurnContentWithFlag()` (LLM call, ~2-8s)
  - Generate actions: `generateActions()` (LLM call, ~1-3s)
  - Prepare image metadata: `prepareTurnImageMetadata()` (cache check, ~50-500ms)
- Image generation (separate job queue, after turn completes)
- WebSocket notifications

**Inside Transaction** (for all turns):
- **APPLY Phase** (inside transaction, atomic):
  - Process turn logic: `processTurnLogic()` with precomputed content (no LLM calls)
  - Process image: `processTurnImage()` with precomputed metadata (fast, no I/O)
  - Commit state: Atomic update with all changes

**Rationale**: 
- ✅ **ALL turns** (intro and regular) now use two-phase pattern
- Moves slow LLM calls outside transaction to improve concurrency
- Reduces lock duration from ~5-15 seconds to ~5-50ms (99%+ reduction)
- Image job creation always inside transaction to ensure atomic linking
- Maintains backward compatibility (can call without precomputed content)

---

## Dependencies & External Services

### Internal Dependencies

```
gameEngine.ts
  ├─► reference/referenceLoader.ts (getCurrentReference)
  └─► @shared/schema (types)

gameInitialization.ts
  ├─► gameEngine.ts (getSegment, getInitialNpcs)
  ├─► gameLogic.ts (processIntroTurn, applyPrecomputedIntroTurn)
  ├─► storage.ts (createGameState, getUserPreferences)
  ├─► pce/settings.ts (resolvePceSelections)
  ├─► aiService.ts (generateTurnContentWithFlag, generateActions)
  └─► socketManager.ts (getSocketIO for WebSocket notifications)

gameLogic.ts
  ├─► gameEngine.ts (all utility functions: SeededRandom, getItemById, etc.)
  ├─► aiService.ts (generateTurnContentWithFlag, generateActions, checkImageCache)
  ├─► imageTemplate.ts (selectImageTemplate)
  ├─► storage.ts (getUserPreferences, processTurnWithTransaction, createImageJob)
  └─► imageUrl.ts (convertImageUrlToStaticPath)

turnJobProcessor.ts
  ├─► storage.ts (claimPendingTurnJobs, processTurnWithTransaction, updateTurnJob, getUserPreferences)
  ├─► gameLogic.ts (processTurnLogic, processTurnImage)
  └─► socket.io (WebSocket notifications)

aiService.ts (Content Generation)
  ├─► pce/contentRouter.ts (ContentGenerationRouter)
  ├─► pce/promptBuilder.ts (buildMetaPrompt, buildPcePrompt)
  ├─► pce/modelInstructions.ts (buildModelInstructionSet)
  ├─► pce/settings.ts (resolvePceSelections, getPceDefaults, isPceEnabled)
  ├─► storage.ts (getUserPreferences)
  └─► OpenAI SDK (LLM API calls)
```

### External Services

1. **OpenAI API** (via `aiService.ts`):
   - `gpt-4o-mini`: Turn narrative generation, action generation
   - `dall-e-3`: Image generation (via image job processor)
   - Rate limits: Handled by OpenAI SDK
   - Retry logic: Built into SDK

2. **PostgreSQL Database**:
   - Connection pooling: Via Drizzle ORM
   - Transactions: Manual control via `db.transaction()`
   - Row-level locking: `FOR UPDATE` clause

3. **File System**:
   - Reference releases: `releases/{version}/`
   - Generated images: `generated_images/`
   - Read operations: Async file I/O
   - Write operations: Image storage only

4. **WebSocket Server** (Socket.IO):
   - Event emission: `turnComplete`, `imageReady`
   - Room-based: Clients join game room (`gameId`)
   - Connection management: Handled by Socket.IO

### Dependency Injection Pattern

Most modules use direct imports, but some use dynamic imports for circular dependency avoidance:

```typescript
// gameLogic.ts
const { storage } = await import("./storage");
```

**Rationale**: Break circular dependencies (e.g., `storage` → `gameLogic` → `storage`).

---

## Key Design Decisions

### 1. Why Job-Based Architecture?

**Decision**: Use background job queue instead of synchronous processing.

**Rationale**:
- **Non-blocking API**: Clients don't wait for slow LLM calls
- **Scalability**: Can scale workers independently of API servers
- **Resilience**: Failed jobs can be retried
- **Observability**: Job status tracking

**Trade-offs**:
- Added complexity (job queue, workers, status tracking)
- Eventual consistency (state updates are async)
- Requires WebSocket for real-time updates

### 2. Why Transaction-Wrapped Processing?

**Decision**: Wrap entire turn processing in database transaction.

**Rationale**:
- **Atomicity**: All-or-nothing state updates
- **Consistency**: Prevents partial updates
- **Isolation**: Row locks prevent race conditions
- **Durability**: Database guarantees persistence

**Trade-offs**:
- Longer transaction times (includes LLM calls in some cases)
- Lock contention (but mitigated by async job pattern)

### 3. Why Reference Data System?

**Decision**: Load game content from filesystem releases instead of database.

**Rationale**:
- **Versioning**: Easy to rollback content changes
- **Performance**: In-memory caching
- **Testing**: Can test different content versions
- **Deployment**: Content updates don't require schema migrations

**Trade-offs**:
- Requires filesystem access (not pure database)
- Cache invalidation on server restart only
- Content changes require server restart (or cache clear mechanism)

### 4. Why Deterministic Mechanics?

**Decision**: Use seeded randomness instead of true randomness.

**Rationale**:
- **Reproducibility**: Can debug specific game states
- **Fairness**: Same inputs produce same outputs
- **Testing**: Predictable test scenarios
- **Replay**: Can replay games from seed

**Trade-offs**:
- Less "randomness" in gameplay feel
- Seed must be carefully managed (exposed to client for replay?)

### 5. Why Delta String Pattern?

**Decision**: Express stat changes as strings (`"hull+3,morale-1"`) instead of structured objects.

**Rationale**:
- **Human-readable**: Easy to edit in database/admin UI
- **Composable**: Can concatenate multiple delta strings
- **Storable**: Can be stored in events/items as text

**Trade-offs**:
- Requires parsing (potential for errors)
- Less type-safe (string parsing at runtime)
- Format changes require migration

### 6. Why Separate Image Job Queue?

**Decision**: Process images in separate queue from turn processing.

**Rationale**:
- **Non-blocking**: Turn processing doesn't wait for images
- **Independent scaling**: Image workers can scale separately
- **Cache optimization**: Image processor handles cache logic
- **Retry logic**: Failed images don't block turns

**Trade-offs**:
- More complex architecture (two job queues)
- Eventual consistency (images appear after turn)
- Requires linking mechanism (imageJobId in turn)

### 7. Why Atomic Image Job Creation?

**Decision**: Create image jobs inside the same transaction as turn creation.

**Rationale**:
- **Atomicity**: Image job and turn reference created together
- **No orphaned jobs**: Job always linked to turn
- **Consistent behavior**: Same pattern across all code paths
- **Simplified error handling**: Rollback handles cleanup

**Implementation**:
- Extracted `processTurnImage()` helper function
- Called inside transaction for all turn creation paths
- Handles cache checking and job creation atomically

---

## Error Handling Patterns

### Transaction Failures

```typescript
// If transaction fails, entire state update is rolled back
try {
  await storage.processTurnWithTransaction(gameId, async (state) => {
    // If any step fails here, transaction rolls back
    return await processTurnLogic(state, action);
  });
} catch (error) {
  // State is unchanged, can retry job
  await storage.updateTurnJob(jobId, { status: 'failed', error: ... });
}
```

### LLM Call Failures

```typescript
// LLM calls are outside transactions, failures don't rollback state
try {
  const content = await generateTurnContentWithFlag(...);
} catch (error) {
  // Use fallback narrative or return error
  // Turn processing continues with default content
}
```

### Image Generation Failures

```typescript
// Image failures don't affect turn processing
try {
  await generateImage(...);
} catch (error) {
  // Log error, mark job as failed
  // Game continues without image
}
```

---

## Performance Considerations

### Critical Path Latency

1. **Game Initialization**: ~3-8 seconds
   - Intro narrative generation: ~2-5s
   - Action generation: ~1-3s
   - Database writes: < 100ms

2. **Turn Processing**: ~5-15 seconds
   - Skill check calculation: < 10ms
   - Event detection: < 50ms
   - Narrative generation: ~2-8s
   - Action generation: ~1-3s
   - Database transaction: ~50-200ms

3. **Image Generation**: ~3-10 seconds (async)
   - Cache lookup: < 50ms
   - Generation: ~2-8s
   - File storage: < 100ms

### Optimization Strategies

1. **Reference Data Caching**: In-memory cache (no database queries)
2. **Image Caching**: Hash-based lookup prevents duplicate generations
3. **Transaction Minimization**: Keep transactions short (exclude LLM calls)
4. **Job Batching**: Process multiple jobs per cycle (up to 5)
5. **WebSocket Notifications**: Avoid polling for updates

### Scalability Bottlenecks

1. **Database Lock Contention**: Mitigated by async job pattern
2. **LLM API Rate Limits**: Handled by OpenAI SDK queuing
3. **Image Generation Cost**: Cached to reduce API calls
4. **WebSocket Connections**: Socket.IO handles scaling

---

## Testing Considerations

### Unit Testing

- **gameEngine.ts**: Pure functions, easily testable
- **gameLogic.ts**: Requires mocking (storage, AI service)
- **Reference data**: Can use test reference releases

### Integration Testing

- **Transaction safety**: Test concurrent turn processing
- **Job processing**: Test job queue end-to-end
- **State consistency**: Verify state after operations

### Deterministic Testing

- **Seeded randomness**: Same seed = reproducible results
- **Event triggers**: Test trigger conditions
- **State progression**: Test state changes

---

## Monitoring & Observability

### Key Metrics

1. **Turn Processing Time**: Average latency per turn
2. **Job Queue Depth**: Pending jobs count
3. **Transaction Failures**: Failed turn processing attempts
4. **LLM Call Latency**: AI generation time
5. **Image Cache Hit Rate**: Cache effectiveness
6. **Concurrent Game Count**: Active games being processed

### Logging Points

- Turn processing start/completion
- Transaction failures
- LLM call durations
- Image generation status
- Job processing errors

---

## Future Considerations

### Potential Improvements

1. **Streaming LLM Responses**: Real-time narrative generation
2. **Partial State Updates**: More efficient database writes
3. **Distributed Job Queue**: Redis-based job queue for horizontal scaling
4. **Reference Data Webhooks**: Cache invalidation without restart
5. **Turn Replay System**: Replay games from seed for debugging

### Migration Paths

- Current job queue can be replaced with Redis/RabbitMQ
- Reference system can migrate to CDN for global distribution
- Transaction pattern can be extended to multi-game operations

---

## Summary

The game execution flow is built on four core principles:

1. **Transaction Safety**: All state mutations are atomic and isolated
2. **Asynchronous Processing**: Long operations don't block API responses
3. **Deterministic Mechanics**: Reproducible game outcomes
4. **Separation of Concerns**: Clear boundaries between mechanics, logic, and infrastructure

The architecture balances **consistency** (via transactions), **performance** (via async jobs), and **maintainability** (via clear module boundaries).

Understanding these patterns is critical for:
- Debugging game state issues
- Adding new game mechanics
- Optimizing performance
- Ensuring data integrity

---

## Areas Requiring Clarification

The following areas in this document need additional clarification or verification:

1. **Transaction Lock Duration** (Section: Transaction Scope):
   - ✅ **RESOLVED**: Refactored to use two-phase pattern for regular turns
   - **SOLUTION IMPLEMENTED**:
     - `computeTurnChecks()` computes checks outside transaction
     - `processTurnLogic()` accepts optional precomputed content
     - `turnJobProcessor.ts` precomputes LLM content outside transaction
     - Lock duration reduced from ~5-15 seconds to ~5-50ms (99%+ reduction)
   - **RESULT**: All turns (intro and regular) now use optimized two-phase pattern

2. **Deterministic Randomness** (Section: Deterministic Game Mechanics):
   - ⚠️ **ISSUE**: Some events use `'random'` trigger type with `Math.random()` (non-deterministic)
   - **QUESTION**: Is this intentional or should all randomness use seeded RNG?
   - **ACTION**: Document which events use random triggers and whether they should be deterministic

3. **PCE System Architecture** (Section: Content Generation):
   - ⚠️ **ISSUE**: PCE system is mentioned but not fully explained
   - **ACTION**: Add dedicated section explaining:
     - PCE pipeline stages (master, narrative, image, actions)
     - ContentGenerationRouter architecture
     - Fallback behavior to legacy path
     - Relationship between PCE and legacy prompt systems

4. **Image Processing Transaction Boundaries** (Section: Image Processing):
   - ✅ **RESOLVED**: Refactored to use two-phase pattern
   - **SOLUTION IMPLEMENTED**: 
     - Created `prepareTurnImageMetadata()` function for cache checks OUTSIDE transaction
     - `processTurnImage()` now accepts optional precomputed metadata
     - All turn types (intro and regular) use the same pattern:
       1. `prepareTurnImageMetadata()` called OUTSIDE transaction (no lock during I/O)
       2. `processTurnImage()` called INSIDE transaction with precomputed metadata (atomic job creation)
   - **CURRENT STATE**:
     - ✅ **Intro turns**: `processIntroTurn()` uses two-phase pattern (prepares metadata, then calls `processTurnImage`)
     - ✅ **Intro turns**: `applyPrecomputedIntroTurn()` uses two-phase pattern (prepares metadata in precompute phase)
     - ✅ **Regular turns**: `turnJobProcessor.ts` uses two-phase pattern (prepares metadata before transaction)
   - **RESULT**: `processTurnImage()` is now the FIRST-CLASS function used by ALL turns, including Turn 0 (Intro Turn)

5. **Turn Record Schema** (Section: Turn Processing Pipeline):
   - ✅ **UPDATED**: Document now includes all PCE-related fields
   - **VERIFICATION**: Verify all fields match actual Turn type in `@shared/schema`

6. **Daily Resource Consumption** (Section: gameEngine.ts):
   - ✅ **UPDATED**: Document now explains item efficiency system
   - **VERIFICATION**: Verify efficiency calculation matches actual implementation

7. **Reference Data Normalization** (Section: Reference Data System):
   - ✅ **UPDATED**: Document now mentions normalization for snake_case/camelCase fields
   - **ACTION**: Consider adding examples of normalized data structures

8. **Storage.processTurnWithTransaction Location**:
   - ✅ **UPDATED**: Document now clarifies that wrapper is in `gameLogic.ts`, implementation is in `storage.ts`
   - **VERIFICATION**: Line numbers may need updating if code changes

---

**Document Version**: Refreshed January 2025
**Last Reviewed**: Check codebase for any changes since last update

