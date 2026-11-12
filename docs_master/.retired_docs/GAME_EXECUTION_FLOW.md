# Game Execution Flow Architecture V2

**Purpose**: Comprehensive architectural and functional overview of the core game execution flow for engineers and architects working with the Uranus Dungeon Guide codebase.

**Audience**: Software architects, senior engineers, and developers who need to understand execution flow, data integrity patterns, and system design decisions.

**Version**: 2.0 (January 2025)  
**Status**: Current and authoritative  
**Previous Version**: V1 archived in `.retired_docs/GAME_EXECUTION_FLOW_V1.md`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Execution Patterns](#core-execution-patterns)
4. [Game Initialization Flow](#game-initialization-flow)
5. [Turn Processing Flow](#turn-processing-flow)
6. [Content Generation System](#content-generation-system)
7. [Image Processing System](#image-processing-system)
8. [Transaction Safety & Concurrency](#transaction-safety--concurrency)
9. [Data Models & State Management](#data-models--state-management)
10. [Key Design Decisions](#key-design-decisions)
11. [Performance & Scalability](#performance--scalability)

---

## Executive Summary

The game execution system follows a **two-phase processing pattern** with **job-based asynchronous architecture**:

- **Phase 1 (PRECOMPUTE)**: LLM calls, cache checks, and deterministic computations happen **outside** database transactions
- **Phase 2 (APPLY)**: Atomic state updates happen **inside** short database transactions (~5-50ms)

**Key Principles**:
1. **Transaction Safety**: All state mutations are atomic and isolated via row-level locking
2. **Asynchronous Processing**: Long operations (LLM calls) don't block API responses
3. **Deterministic Mechanics**: Reproducible game outcomes based on seed
4. **Separation of Concerns**: Clear boundaries between mechanics, logic, and infrastructure

**Performance**:
- Lock duration: **~5-50ms** (99%+ reduction from previous ~5-15 seconds)
- API response: **< 100ms** (immediate job creation)
- Turn completion: **~3-10 seconds** (background processing)
- Image generation: **~3-10 seconds** (separate async process)

---

## System Architecture

### High-Level Architecture

```
┌─────────────┐
│   Client    │ (React + Socket.IO)
└──────┬──────┘
       │ HTTP/WebSocket
       ▼
┌─────────────────────────────────────┐
│      Express API Server              │
│  ├─ Auth & Rate Limiting            │
│  ├─ Route Handlers                   │
│  └─ Job Queue Creation               │
└──────┬───────────────────────────────┘
       │
       ├──► PostgreSQL (game state, jobs)
       │
       ├──► Background Workers
       │    ├─ TurnPrecomputeWorker (orchestrator)
       │    ├─ TurnApplyWorker (orchestrator)
       │    └─ ImageWorker (orchestrator)
       │
       ├──► Reference System (filesystem)
       │    └─ releases/current/
       │
       └──► External Services
            ├─ OpenAI API (LLM + Images)
            └─ File System (generated_images/)
```

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **Game Engine** | `server/gameEngine.ts` | Pure game mechanics (deterministic, no side effects) |
| **Game Initialization** | `server/gameInitialization.ts` | Bootstrap new game instances |
| **Game Logic** | `server/gameLogic.ts` | Turn processing orchestration |
| **Turn Precompute Worker** | `server/orchestrator/workers/turnPrecomputeWorker.ts` | Leases turn jobs, executes deterministic compute + LLM calls, and enqueues apply stage |
| **Turn Apply Worker** | `server/orchestrator/workers/turnApplyWorker.ts` | Applies precomputed turns inside DB transactions and emits Socket.IO events |
| **Image Worker** | `server/orchestrator/workers/imageWorker.ts` | Background worker for cache-first image generation |
| **Storage Layer** | `server/storage.ts` | Database operations with transaction safety |
| **AI Service** | `server/aiService.ts` | LLM integration and content generation |
| **Reference Loader** | `server/reference/referenceLoader.ts` | Versioned content loading |

---

## Core Execution Patterns

### 1. Two-Phase Processing Pattern

**Problem**: LLM calls take 2-8 seconds, but database transactions should be short to avoid lock contention.

**Solution**: Separate expensive operations from atomic state updates.

#### Pattern Structure

```
┌─────────────────────────────────────────────────────────┐
│ PRECOMPUTE PHASE (OUTSIDE Transaction)                 │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 1. Compute Turn Checks (deterministic)           │   │
│ │ 2. Generate Turn Content (LLM call)              │   │
│ │ 3. Compute Post-Turn State                       │   │
│ │ 4. Generate Next Actions (LLM call)              │   │
│ │ 5. Prepare Image Metadata (cache check)          │   │
│ └───────────────────────────────────────────────────┘   │
│ Time: ~3-10 seconds (no locks held)                      │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│ APPLY PHASE (INSIDE Transaction)                        │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 1. Process Turn Logic (with precomputed data)    │   │
│ │ 2. Process Turn Image (with precomputed metadata) │   │
│ │ 3. Commit Transaction                             │   │
│ └───────────────────────────────────────────────────┘   │
│ Time: ~5-50ms (locks held only during atomic writes)   │
└─────────────────────────────────────────────────────────┘
```

#### Implementation Functions

**Precompute Functions** (outside transaction):
- `computeTurnChecks(state, action)`: Determines skill checks, dice rolls, success
- `generateTurnContentWithFlag(...)`: LLM call for narrative and image prompt
- `computePostTurnState(state, computed, items)`: Projects state after turn
- `generateActions(postTurnState, preferences)`: LLM call for next turn actions
- `prepareTurnImageMetadata(state, turn, preferences, turnNumber)`: Cache check

**Apply Functions** (inside transaction):
- `processTurnLogic(state, action, precomputed)`: Applies precomputed content to state
- `processTurnImage(state, turn, preferences, turnNumber, precomputedMetadata)`: Atomic image job creation

#### Benefits

- **99%+ reduction in lock duration**: From ~5-15 seconds to ~5-50ms
- **Better concurrency**: Multiple games can precompute in parallel
- **Backward compatible**: Functions work without precomputed data (less efficient)

### 2. Job-Based Asynchronous Processing

**Pattern**: Defer long-running operations to background workers.

```
Client Request → Create Job → Return Immediately (< 100ms)
                     │
                     ▼
            Background Worker (polling)
                     │
                     ▼
         Process Job → Update State
                     │
                     ▼
         WebSocket Notification
```

**Benefits**:
- Non-blocking API responses
- Independent worker scaling
- Fault tolerance (retryable jobs)
- Observable processing (job status tracking)

### 3. Transaction-Safe State Updates

**Pattern**: All game state mutations occur within database transactions with row-level locking.

**Implementation** (`storage.ts`):
```typescript
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
    
    const gameState = convertRowToGameState(result.rows[0]);
    const updatedState = await processor(gameState);
    
    await client.query('UPDATE games SET ... WHERE id = $17', [/* ... */]);
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

**Usage Points**:
- `gameInitialization.ts`: Intro turn processing
- `turnJobProcessor.ts`: Regular turn processing
- `imageJobProcessor.ts`: Image URL updates

---

## Game Initialization Flow

### Endpoint: `POST /api/game/start`

### Flow Diagram

```
1. Client Request
   └─► POST /api/game/start { username, seed?, absurdity? }
       │
       ▼
2. Validation & Auth
   ├─► requireAuth middleware
   ├─► gameStartRateLimit middleware
   ├─► Validate user exists
   └─► Parse request body
       │
       ▼
3. Build Initial State
   └─► buildInitialGameState(validated)
       ├─► Generate gameId (UUID)
       ├─► Generate/use seed (UUID)
       ├─► Set initial values:
       │   ├─ day: 1
       │   ├─ turnNumber: 0
       │   ├─ segment: 'Moon Flyby'
       │   ├─ stats: all 100 (hull, oxygen, fuel, food, morale)
       │   ├─ weirdness: 0
       │   └─ equippedItems: default items
       │
       └─► Load NPCs from reference data
           │
           ▼
4. Persist Empty State
   └─► storage.createGameState(emptyState)
       │
       ▼
5. Two-Phase Intro Turn Processing
   │
   ├─► PRECOMPUTE PHASE (outside transaction)
   │   ├─► storage.getUserPreferences(username)
   │   ├─► generateTurnContentWithFlag(..., { intro: true })
   │   │   └─► LLM call for intro narrative + image prompt
   │   ├─► generateActions(state, userPreferences)
   │   │   └─► LLM call for initial actions
   │   └─► prepareTurnImageMetadata(...)
   │       └─► Cache check (no lock held)
   │
   └─► APPLY PHASE (inside transaction)
       └─► applyPrecomputedIntroTurn(gameId, { turnContent, actions }, userPreferences, imageMetadata)
           ├─► CAS check: Verify turn 0 doesn't exist
           ├─► Create turn 0 with precomputed content
           ├─► processTurnImage(...) [atomic]
           │   └─► Apply metadata or create image job
           └─► Apply actions to state.currentActions
               │
               ▼
6. WebSocket Notification
   └─► Emit 'introReady' event to game room
       │
       ▼
7. Response
   └─► Return complete GameState (JSON)
       - Includes turn 0 narrative
       - Includes initial actions
       - Ready to play
```

### Initial State Schema

```typescript
{
  id: string                    // UUID
  username: string
  seed: string                  // UUID (deterministic randomness)
  day: 1
  turnNumber: 0
  segment: 'Moon Flyby'         // from getSegment(1)
  absurdity: number             // 1-5 (default 2)
  stats: {
    hull: 100
    oxygen: 100
    fuel: 100
    food: 100
    morale: 100
    weirdness: 0
  }
  npcs: NPC[]                   // from reference data
  equippedItems: string[]       // default: ['red_tape', 'universal_allen_key', 'nebula_freshener']
  turns: []                     // empty initially
  currentActions: []            // populated after intro turn
  runningGags: []
  eventHistory: []
  interviewResponses: {}
  isComplete: false
}
```

### Characteristics

- **Synchronous**: Client waits for complete initialization (~3-8 seconds)
- **Two-Phase**: LLM calls outside transaction, application inside transaction
- **Concurrent-Safe**: CAS-style check prevents duplicate intro turns
- **Error Handling**: Cleans up orphaned game state on failure

---

## Turn Processing Flow

### Endpoint: `POST /api/game/action`

### High-Level Flow

```
1. Client Request
   └─► POST /api/game/action { gameId, action, customText? }
       │
       ▼
2. Validation & Job Creation
   ├─► Parse and validate request
   ├─► Verify game exists and not complete
   └─► storage.createTurnJob({ gameId, actionPayload, status: 'pending' })
       │
       ▼
3. Immediate Response
   └─► Return { turnJobId, status: 'processing' }
       (Client does not wait)
       │
       ▼
4. Background Processing (Orchestrator Workers)
   ├─► TurnPrecomputeWorker leases job from orchestrator queue (poll fallback 5s)
   │   ├─► PRECOMPUTE PHASE (outside transaction) — see detailed flow below
   │   └─► Persist provisional manifest and enqueue apply stage
   └─► TurnApplyWorker leases job, runs APPLY PHASE inside `storage.processTurnWithTransaction(...)`
       ├─► processTurnLogic(state, action, precomputed)
       └─► processTurnImage(state, turn, ..., precomputedMetadata)
           │
           ▼
5. Completion
   ├─► Mark job as 'completed' within orchestrator + legacy tables
   └─► Emit WebSocket: 'turnComplete'
```

### Detailed Precompute Phase

```
Input: GameState (current), ActionInput
   │
   ├─► 1. Compute Turn Checks
   │   └─► computeTurnChecks(state, action)
   │       ├─► Find selected action or map custom text → intent
   │       ├─► Check triggered events: getTriggeredEvents(state)
   │       ├─► Determine skill & DC (with bonuses, advantage)
   │       ├─► Roll dice (deterministic): SeededRandom.rollD20(...)
   │       └─► Return: { selectedAction, event, skill, dc, checks, success, nextTurnNumber }
   │
   ├─► 2. Generate Turn Content
   │   └─► generateTurnContentWithFlag(state, selectedAction.action, checks, preferences, event)
   │       ├─► Routes to PCE or legacy path
   │       └─► Returns: { narration, imagePrompt, theme, style, promptChain, ... }
   │
   ├─► 3. Compute Post-Turn State
   │   └─► computePostTurnState(state, computed, equippedItems)
   │       ├─► Applies stat changes (same logic as processTurnLogic)
   │       ├─► Advances day if needed
   │       ├─► Applies daily consumption
   │       └─► Returns: Temporary state reflecting turn changes
   │
   ├─► 4. Generate Next Actions
   │   └─► generateActions(postTurnState, preferences)
   │       └─► Returns: ActionChip[] (6 actions for next turn)
   │
   └─► 5. Prepare Image Metadata
       └─► prepareTurnImageMetadata(state, turn, preferences, turnNumber)
           ├─► Check image cache (database queries, file reads)
           └─► Returns: { imageUrl, templateName, promptSource, modelKey } | null
```

### Detailed Apply Phase

```
Input: GameState (locked), ActionInput, PrecomputedContent
   │
   ├─► 1. Process Turn Logic
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
   ├─► 2. Process Turn Image
   │   └─► processTurnImage(state, turn, preferences, turnNumber, precomputedImageMetadata)
   │       ├─► If cache hit: Apply metadata (fast, no I/O)
   │       └─► If cache miss: Create image job atomically
   │
   └─► 3. Commit Transaction
       └─► Return: Updated GameState
```

### Turn Processing Steps (Detailed)

#### Step 1: Action Validation
- Load user preferences
- Handle intro turn (special path)
- Validate action (find in `currentActions` or map custom text)

#### Step 2: Event Detection
- `getTriggeredEvents(state)`: Evaluates all active events
- Takes first triggered event (if any)

#### Step 3: Skill Check Resolution
- Determine skill & DC (from event or action)
- Calculate bonuses (items, NPC affinities, advantage)
- Roll dice (deterministic using `SeededRandom`)
- Calculate success: `finalRoll >= dc`

#### Step 4: Content Generation
- See [Content Generation System](#content-generation-system) section

#### Step 5: State Updates
- Apply stat changes (from event or action consequences)
- Apply item scene effects
- Daily resource consumption (every 2 turns)
- Update NPC affinities
- Check win/loss conditions

#### Step 6: Turn Recording
- Create turn record with all computed data
- Append to `state.turns`

#### Step 7: Image Processing
- See [Image Processing System](#image-processing-system) section

---

## Content Generation System

### Overview

The system uses a **Prompt Composition Engine (PCE)** for synchronized narrative and image generation, with fallback to legacy templates.

### PCE Architecture

```
ContentGenerationRouter
   │
   ├─► Master Enrichment Stage
   │   └─► Generates context, variables, and guidance
   │
   ├─► Narrative Stage
   │   └─► Uses master enrichment to generate 6-7 sentence narrative
   │
   ├─► Image Prompt Stage
   │   └─► Generates synchronized image prompt using narrative
   │
   └─► Actions Stage
       └─► Generates next turn actions using narrative context
```

### PCE Pipeline Flow

```
1. Master Enrichment
   └─► runMasterStage(context)
       ├─► Build master prompt with game state variables
       ├─► Call LLM (gpt-4o-mini)
       └─► Returns: { enrichment: {...}, metadata: [...] }
       │
       └─► [If fails] → Fallback to legacy path
           │
           ▼
2. Narrative Generation
   └─► runNarrativeStage(context, master.output)
       ├─► Build narrative prompt with master enrichment
       ├─► Call LLM (gpt-4o-mini)
       └─► Returns: { narration: string, metadata: [...] }
       │
       └─► [If fails] → Fallback to legacy path
           │
           ▼
3. Image Prompt Generation
   └─► runImageStage(context, master.output, narrative.output)
       ├─► Build image prompt with narrative context
       ├─► Call LLM (gpt-4o-mini)
       └─► Returns: { imagePrompt: string, metadata: [...] }
       │
       └─► [If fails] → Fallback to legacy path
           │
           ▼
4. Actions Generation
   └─► runActionsStage(context, master.output, narrative.output)
       ├─► Build actions prompt with narrative context
       ├─► Call LLM (gpt-4o-mini)
       └─► Returns: { actions: ActionChip[], metadata: [...] }
       │
       └─► [If fails] → Fallback to legacy path
```

### Fallback Behavior

- **PCE Enabled**: Uses `ContentGenerationRouter.generateFullTurnContent()`
  - If any stage fails → falls back to legacy path
  - Tracks `fallbackUsed: true` in turn metadata
- **PCE Disabled**: Uses `legacyGenerateTurnContent()` directly
  - Separate prompt templates for narrative and image
  - No master enrichment stage

### Return Data Structure

```typescript
interface TurnContentResult {
  narration: string;
  imagePrompt: string;
  theme: string;
  style: string;
  imageModelKey: string;
  
  // PCE-specific fields
  promptChain: StageMetadata[];        // Tracks all stages executed
  masterEnrichment?: Record<string, unknown> | null;
  toneHints?: string[];
  fallbackUsed: boolean;
  imagePromptSource: 'pce' | 'template';
  imageMetadata?: Record<string, unknown> | null;
}
```

### Key Functions

- `generateTurnContentWithFlag(...)`: Main entry point (routes to PCE or legacy)
- `ContentGenerationRouter.generateFullTurnContent(...)`: PCE pipeline orchestration
- `legacyGenerateTurnContent(...)`: Fallback template-based generation

---

## Image Processing System

### Two-Phase Pattern

**Phase 1: Prepare Metadata** (OUTSIDE transaction)
- `prepareTurnImageMetadata(state, turn, userPreferences, turnNumber)`
- Selects image template
- Checks cache (database queries, file reads)
- Converts image URLs
- Returns: `{ imageUrl, templateName, promptSource, modelKey } | null`
- Time: ~50-500ms (no lock held)

**Phase 2: Process Image** (INSIDE transaction)
- `processTurnImage(state, turn, userPreferences, turnNumber, precomputedMetadata)`
- **Cache hit**: Apply metadata to turn (fast, no I/O)
- **Cache miss**: Create image job atomically
- Time: ~5-10ms (lock held only during job creation)

### Image Job Processing

```
ImageWorker (orchestrator worker)
   │
   ├─► Lease pending image jobs from orchestrator queue
   │
   ├─► Process Each Job:
   │   ├─► Load game state + user preferences
   │   ├─► Check cache (if not already checked)
   │   │
   │   ├─► If cache hit:
   │   │   └─► Convert URL and update turn (atomic transaction)
   │   │
   │   └─► If cache miss:
   │       ├─► Generate image (OpenAI DALL-E 3)
   │       ├─► Save to file system
   │       ├─► Update cache metadata
   │       └─► Update turn (atomic transaction)
   │           │
   │           ▼
   └─► Emit WebSocket: 'imageReady' or 'imageFailed'; complete or dead-letter orchestrator entry
```

### Image Cache System

- **Fingerprint**: Hash of template name + prompt + game state variables
- **Storage**: Database table (`image_cache`) + file system (`generated_images/`)
- **Cache Hit**: Returns existing image URL immediately
- **Cache Miss**: Creates job for generation

### Key Functions

- `prepareTurnImageMetadata(...)`: Cache check (outside transaction)
- `processTurnImage(...)`: Atomic job creation (inside transaction)
- `checkImageCache(...)`: Database lookup for cached images
- `convertImageUrlToStaticPath(...)`: URL conversion for static serving

---

## Transaction Safety & Concurrency

### Concurrency Scenarios

#### Scenario 1: Concurrent Action Requests

**Problem**: Two clients submit actions for same game simultaneously.

**Solution**: 
- `processTurnWithTransaction()` uses `FOR UPDATE` row lock
- First transaction acquires lock, second waits
- Sequential processing ensures state consistency

**Timeline**:
```
T0: Client A → Lock acquired (A)
T1: Client B → Wait for lock
T2: Client A → Processing...
T3: Client A → Commit, lock released
T4: Client B → Lock acquired (B)
T5: Client B → Processing...
```

#### Scenario 2: Image Job Updates During Turn Processing

**Problem**: Image job processor updates game state while turn job is processing.

**Solution**:
- Both use `processTurnWithTransaction()` with locking
- Image updates are transactional and atomic
- Turn processor reads latest state before updating

### Lock Acquisition Order

To prevent deadlocks, always acquire locks in consistent order:
1. Game state row (via `processTurnWithTransaction`)
2. Reference data (read-only, no locks)
3. Image jobs (separate table, no lock conflicts)

### Transaction Scope

**Inside Transaction**:
- Game state read (locked)
- Turn processing logic (deterministic, no LLM calls)
- Image processing (apply metadata or create job)
- Game state write

**Outside Transaction**:
- LLM API calls (turn content, actions)
- Image cache checks (database queries, file reads)
- Image generation (separate job queue)
- WebSocket notifications

**Rationale**:
- All turns (intro and regular) use two-phase pattern
- Moves slow LLM calls outside transaction
- Reduces lock duration from ~5-15 seconds to ~5-50ms (99%+ reduction)
- Image job creation always inside transaction for atomic linking

---

## Data Models & State Management

### Game State Structure

```typescript
interface GameState {
  // Identity
  id: string                    // UUID
  username: string
  seed: string                  // UUID (deterministic randomness)
  
  // Progression
  day: number                   // 1-12 (day 12 = arrival)
  turnNumber: number            // 0, 1, 2, ...
  segment: Segment              // 'Launch from Earth' | 'Moon Flyby' | ...
  
  // Configuration
  absurdity: number             // 1-5 (affects narrative tone)
  
  // Resources
  stats: {
    hull: number                // 0-100
    oxygen: number               // 0-100
    fuel: number                 // 0-100
    food: number                 // 0-100
    morale: number               // 0-100
    weirdness: number            // 0-5
  }
  
  // Characters
  npcs: NPC[]                   // Crew members with affinity
  
  // Inventory
  equippedItems: string[]       // Array of item IDs
  
  // History
  turns: Turn[]                 // All processed turns
  currentActions: ActionChip[]  // Available actions for next turn
  runningGags: string[]        // Recurring event names
  eventHistory: string[]        // Event IDs that have occurred
  
  // Customization
  interviewResponses: Record<string, string>
  
  // Completion
  isComplete: boolean
  failureReason?: string
}
```

### Turn Record Schema

```typescript
interface Turn {
  turnNumber: number
  action: string                // Action identifier or custom text
  narrative: string
  checks: Check[]
  delta: Change[]               // Stat changes
  timestamp: number
  
  // Image-related fields
  imagePrompt?: string
  imageStyle?: string
  imageModelKey?: string
  imageMetadata?: Record<string, unknown> | null
  imageTemplate?: string
  imagePromptSource?: 'pce' | 'template'
  imageJobId?: string           // If image job created
  imageStatus?: 'pending' | 'completed'
  imageUrl?: string             // If cache hit or generation complete
  
  // PCE enrichment fields
  promptChain?: StageMetadata[]
  masterEnrichment?: Record<string, unknown> | null
  toneHints?: string[]
  theme?: string
  style?: string
  fallbackUsed?: boolean
}
```

### State Mutation Points

1. **Game Creation**: `gameInitialization.ts` → Sets initial values
2. **Turn Processing**: `gameLogic.ts` → Updates stats, turns, actions
3. **Image Updates**: `imageJobProcessor.ts` → Updates `turn.imageUrl`
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

## Key Design Decisions

### 1. Why Two-Phase Processing?

**Decision**: Separate LLM-heavy operations from database transactions.

**Rationale**:
- **Performance**: Reduces lock duration by 99%+
- **Concurrency**: Multiple games can precompute in parallel
- **Scalability**: Better throughput under concurrent load

**Trade-offs**:
- Added complexity (precompute/apply separation)
- Requires careful state consistency (precomputed data must match final state)

### 2. Why Job-Based Architecture?

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

### 4. Why Deterministic Mechanics?

**Decision**: Use seeded randomness instead of true randomness.

**Rationale**:
- **Reproducibility**: Can debug specific game states
- **Fairness**: Same inputs produce same outputs
- **Testing**: Predictable test scenarios
- **Replay**: Can replay games from seed

**Trade-offs**:
- Less "randomness" in gameplay feel
- Seed must be carefully managed

### 5. Why Delta String Pattern?

**Decision**: Express stat changes as strings (`"hull+3,morale-1"`) instead of structured objects.

**Rationale**:
- **Human-readable**: Easy to edit in database/admin UI
- **Composable**: Can concatenate multiple delta strings
- **Storable**: Can be stored in events/items as text

**Trade-offs**:
- Requires parsing (potential for errors)
- Less type-safe (string parsing at runtime)

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

---

## Performance & Scalability

### Critical Path Latency

1. **Game Initialization**: ~3-8 seconds
   - Intro narrative generation: ~2-5s (outside transaction)
   - Action generation: ~1-3s (outside transaction)
   - Database writes: < 100ms (inside transaction)

2. **Turn Processing**: ~3-10 seconds total
   - **PRECOMPUTE Phase**: ~3-10 seconds (outside transaction)
     - Compute checks: < 100ms
     - Generate turn content: ~2-8s (LLM call)
     - Generate actions: ~1-3s (LLM call)
     - Prepare image metadata: ~50-500ms (cache check)
   - **APPLY Phase**: ~5-50ms (inside transaction)
     - Process turn logic: ~5-10ms
     - Process image: ~5-10ms
     - Commit transaction: ~5-10ms

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

1. **Database Lock Contention**: Mitigated by async job pattern and two-phase processing
2. **LLM API Rate Limits**: Handled by OpenAI SDK queuing
3. **Image Generation Cost**: Cached to reduce API calls
4. **WebSocket Connections**: Socket.IO handles scaling

### Monitoring Metrics

1. **Turn Processing Time**: Average latency per turn
2. **Job Queue Depth**: Pending jobs count
3. **Transaction Failures**: Failed turn processing attempts
4. **LLM Call Latency**: AI generation time
5. **Image Cache Hit Rate**: Cache effectiveness
6. **Concurrent Game Count**: Active games being processed

---

## Error Handling Patterns

### Transaction Failures

```typescript
try {
  await storage.processTurnWithTransaction(gameId, async (state) => {
    // If any step fails here, transaction rolls back
    return await processTurnLogic(state, action, precomputed);
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

## Summary

The game execution flow is built on four core principles:

1. **Transaction Safety**: All state mutations are atomic and isolated
2. **Asynchronous Processing**: Long operations don't block API responses
3. **Deterministic Mechanics**: Reproducible game outcomes
4. **Separation of Concerns**: Clear boundaries between mechanics, logic, and infrastructure

The architecture balances **consistency** (via transactions), **performance** (via async jobs and two-phase processing), and **maintainability** (via clear module boundaries).

**Understanding these patterns is critical for**:
- Debugging game state issues
- Adding new game mechanics
- Optimizing performance
- Ensuring data integrity

---

**Document Version**: 2.0  
**Last Updated**: January 2025  
**Status**: Current and authoritative
