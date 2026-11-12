# Game Start to Turn 3: Frontend-Backend Communication Simulation

**Purpose**: Comprehensive documentation of frontend-backend communication and procedures from Game Start through Turn 3, designed for architects and game mechanics specialists.

**Audience**: System architects, game mechanics specialists, senior engineers  
**Version**: 1.0  
**Status**: Current and authoritative  
**Last Updated**: January 2025

---

## Table of Contents

1. [Context & Overview](#context--overview)
2. [Technical Details](#technical-details)
3. [Practical Guidance](#practical-guidance)
4. [Troubleshooting & Support](#troubleshooting--support)
5. [Standards & Processes](#standards--processes)
6. [Visual Aids](#visual-aids)
7. [Cross-References](#cross-references)

---

## Context & Overview

### What It Is

Quest to Uranus is a narrative-driven management game where players make choices that affect their journey through a procedurally generated story. The system uses a **two-phase processing pattern** with asynchronous job orchestration to handle turn processing efficiently.

### Why It Exists

The architecture separates **expensive operations** (LLM calls, image generation) from **fast operations** (database transactions) to:
- Minimize database lock time (transactions are <50ms)
- Enable parallel processing of multiple games
- Provide responsive UI feedback via WebSocket notifications
- Ensure data consistency through atomic transactions
- Support scalability via job-based queues

### System Purpose

The communication flow from Game Start to Turn 3 demonstrates:
1. **Synchronous game initialization** (Turn 0) with inline LLM generation
2. **Asynchronous turn processing** (Turns 1+) via orchestrator queues
3. **Real-time updates** via Socket.IO WebSocket events
4. **Optimistic UI updates** with React Query cache invalidation

---

## Technical Details

### Architecture Overview

The system follows a **client-server-worker** architecture:

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Client    │◄──WS───►│   Server     │◄───────►│   Workers   │
│  (React)    │   HTTP  │  (Express)   │  Queue  │ (Orchestrator)
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              ▼
                        ┌─────────────┐
                        │  Postgres   │
                        │  + Socket.IO│
                        └─────────────┘
```

### Components

#### Frontend Components

1. **Player Client Agent** (`client/src/hooks/useGameLogic.ts`)
   - Manages game state via React Query
   - Handles action submissions
   - Listens to WebSocket events
   - Coordinates optimistic UI updates

2. **Socket Client** (`client/src/lib/socket.ts`)
   - Socket.IO client connection
   - Room management (joinGame/leaveGame)
   - Event listeners (turnComplete, imageReady, imageFailed)

3. **Query Client** (`client/src/lib/queryClient.ts`)
   - React Query configuration
   - CSRF token management
   - API request wrapper (`apiRequest`)

#### Backend Components

1. **Gateway & Security Agent** (`server/index.ts`, `server/middleware/`)
   - HTTP ingress with Helmet, CSRF, rate limiting
   - Session management
   - Health and metrics endpoints

2. **Game Orchestrator Agent** (`server/routes.ts`)
   - REST API endpoints
   - Socket.IO namespace registration
   - Worker bootstrap

3. **Data Persistence Agent** (`server/storage.ts`)
   - Postgres abstraction layer
   - Transactional helpers (`processTurnWithTransaction`)
   - Job queue management

4. **Turn Processor Agent** (`server/orchestrator/workers/`)
   - `TurnPrecomputeWorker`: Deterministic checks + LLM calls
   - `TurnApplyWorker`: Transactional state updates

5. **Image Processor Agent** (`server/orchestrator/workers/imageWorker.ts`)
   - Cache-first image generation
   - OpenAI integration

### Technologies

- **Frontend**: React 18, TypeScript, Vite, React Query 5, Socket.IO Client, Tailwind CSS
- **Backend**: Node.js 20+, Express 4, TypeScript (ESM), Socket.IO 4, Postgres 15+
- **AI**: OpenAI GPT-4.5 (text), DALL-E 3 (images)
- **Queue System**: PostgreSQL-based orchestrator with NOTIFY/LISTEN
- **State Management**: React Query (client), Postgres JSONB (server)

### Relationships and Interactions

#### Request Flow (Turn 1+)

```
Client → HTTP POST → Route Handler → Job Creation → Orchestrator Queue
                                                         │
                                                         ▼
                                        TurnPrecomputeWorker (PRECOMPUTE)
                                                         │
                                                         ▼
                                        TurnApplyWorker (APPLY + Transaction)
                                                         │
                                                         ▼
                                        WebSocket Event → Client
```

#### Data Flow

```
GameState (Postgres JSONB)
    ├── turns: Turn[]
    ├── currentActions: ActionChip[]
    ├── stats: Stats
    └── ...metadata

Turn
    ├── narrative: string
    ├── imagePrompt: string
    ├── imageUrl?: string
    ├── checks: Check[]
    └── delta: StatChange[]
```

### Configurations and Parameters

#### Environment Variables

- `DATABASE_URL`: Postgres connection string
- `SESSION_SECRET`: Session encryption key
- `OPENAI_API_KEY`: OpenAI API credentials
- `DISABLE_ORCHESTRATOR_ENQUEUE`: Disable queue (testing)

#### Queue Configuration (`server/config/queues.ts`)

- `turn-precompute`: Poll interval 5s, lease duration 60s
- `turn-apply`: Poll interval 5s, lease duration 30s
- `image`: Poll interval 5s, lease duration 120s

#### Rate Limits (`server/middleware/rateLimiting.ts`)

- `gameStartRateLimit`: 10 requests/10 minutes
- `gameActionRateLimit`: 30 requests/minute
- `gameReadRateLimit`: 100 requests/minute

---

## Practical Guidance

### Step-by-Step: Game Start (Turn 0)

#### 1. Client Initiates Game Start

**File**: `client/src/pages/MainMenuPage.tsx`

```typescript
const startGameMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest('POST', '/api/game/start', { username });
    return (await res.json()) as GameState;
  },
  onSuccess: (data: GameState) => {
    // Verify intro turn is ready before navigating
    const introTurn = data.turns.find(t => t.turnNumber === 0);
    const hasNarrative = introTurn?.narrative?.trim().length > 0;
    const hasActions = Array.isArray(data.currentActions) && data.currentActions.length > 0;
    
    if (hasNarrative && hasActions) {
      setLocation(`/game/${data.id}`);
    } else {
      // Poll for readiness
      pollForReadiness(data.id);
    }
  }
});
```

**HTTP Request**:
```
POST /api/game/start
Headers: Cookie (session), X-CSRF-Token
Body: { username: "alice", seed?: "...", absurdity?: 2 }
```

#### 2. Server Route Handler

**File**: `server/routes.ts:32-59`

```typescript
app.post("/api/game/start", requireAuth, gameStartRateLimit, async (req, res) => {
  const username = req.session.username;
  const validated = insertGameStateSchema.parse({ ...req.body, username });
  
  // Validate user exists
  const user = await storage.getUserByUsername(username);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  
  const readyState = await initializeNewGame(validated);
  res.json({ ...readyState, introApplied: true });
});
```

#### 3. Game Initialization

**File**: `server/gameInitialization.ts:52-181`

**Step 3.1: Build Initial State**
```typescript
const gameState = await buildInitialGameState(validated);
// Creates: day=1, turnNumber=0, stats=100, empty turns array
await storage.createGameState(gameState);
```

**Step 3.2: PRECOMPUTE PHASE (Outside Transaction)**
```typescript
const userPreferences = await storage.getUserPreferences(gameState.username);

// Generate LLM content (PCE pipeline)
const turnContent = await generateTurnContentWithFlag(
  gameState,
  "Beginning the voyage to Uranus",
  [],
  userPreferences,
  { intro: true },
  null
);
// Returns: { narration, imagePrompt, actions, theme, style, ... }

// Check image cache
const precomputedImageMetadata = await prepareTurnImageMetadata(
  gameState,
  tempIntroTurn,
  userPreferences,
  0
);
```

**Step 3.3: APPLY PHASE (Inside Transaction)**
```typescript
const updatedState = await applyPrecomputedIntroTurn(
  gameState.id,
  { turnContent, actions: turnContent.actions },
  userPreferences,
  precomputedImageMetadata
);
// Uses storage.processTurnWithTransaction() for atomicity
```

#### 4. Response to Client

**Response Body**:
```json
{
  "id": "game-123",
  "username": "alice",
  "day": 1,
  "turnNumber": 0,
  "stats": { "hull": 100, "oxygen": 100, ... },
  "turns": [
    {
      "turnNumber": 0,
      "narrative": "You stand at the edge of the launch pad...",
      "imagePrompt": "A futuristic space launch pad...",
      "checks": [],
      "delta": []
    }
  ],
  "currentActions": [
    { "id": "action-1", "text": "Inspect the ship" },
    { "id": "action-2", "text": "Talk to the crew" },
    ...
  ],
  "introApplied": true
}
```

#### 5. Client Navigation

**File**: `client/src/pages/MainMenuPage.tsx`

```typescript
if (hasNarrative && hasActions) {
  setLocation(`/game/${data.id}`);
} else {
  // Poll until ready
  const checkReady = async () => {
    const res = await apiRequest('GET', `/api/game/${data.id}`);
    const state = await res.json();
    if (state.turns[0]?.narrative && state.currentActions?.length > 0) {
      setLocation(`/game/${data.id}`);
    } else {
      setTimeout(checkReady, 1000);
    }
  };
  checkReady();
}
```

### Step-by-Step: Turn 1

#### 1. Client Submits Action

**File**: `client/src/hooks/useGameLogic.ts:425-436`

```typescript
const handleActionClick = (action: string) => {
  if (!gameId || actionMutation.isPending) return;
  
  // Clear UI state immediately
  setShowPreviousTurns(false);
  setCustomAction('');
  setGeneratedImage(null);
  
  // Submit action
  actionMutation.mutate({ action });
};
```

**HTTP Request**:
```
POST /api/game/action
Headers: Cookie (session), X-CSRF-Token
Body: { gameId: "game-123", action: "action-id-1" }
```

#### 2. Server Enqueues Job

**File**: `server/routes.ts:88-121`

```typescript
app.post("/api/game/action", requireAuth, gameActionRateLimit, async (req, res) => {
  const validated = actionInputSchema.parse(req.body);
  
  // Verify ownership
  const existingState = await storage.getGameState(validated.gameId);
  if (existingState.username !== username) {
    return res.status(403).json({ error: "Access denied" });
  }
  
  // Create job (auto-enqueues to orchestrator)
  const job = await storage.createTurnJob({
    gameId: validated.gameId,
    actionPayload: validated,
    status: 'pending'
  }, traceId, requestId);
  
  res.json({ turnJobId: job.id, status: 'processing' });
});
```

**Job Creation** (`server/storage.ts:1668-1718`):
```typescript
async createTurnJob(job: InsertTurnJob, traceId?: string, requestId?: string) {
  // Insert into turn_jobs table
  const turnJob = await pool.query(/* INSERT ... */);
  
  // Auto-enqueue to orchestrator
  await orchestrator.enqueue({
    queue: 'turn-precompute',
    payload: { id: turnJob.id },
    idempotencyKey: generateIdempotencyKey(...),
    metadata: { gameId, turnNumber }
  });
  
  // Emit PostgreSQL NOTIFY to wake workers
  await pool.query(`NOTIFY queue_turn_precompute`);
  
  return turnJob;
}
```

#### 3. Turn Precompute Worker

**File**: `server/orchestrator/workers/turnPrecomputeWorker.ts:134-360`

**Step 3.1: Claim Job**
```typescript
// Polls every 5s (or wakes on NOTIFY)
const leases = await orchestrator.claim('turn-precompute', workerId, { batchSize: 5 });
const job = await storage.getTurnJob(lease.job.payload.id);
```

**Step 3.2: Compute Turn Checks (Deterministic)**
```typescript
const computed = await computeTurnChecks(currentState, action);
// Returns: { selectedAction, event, skill, dc, checks, success, nextTurnNumber }
// All deterministic - no LLM calls
```

**Step 3.3: Generate Turn Content (PCE Pipeline)**
```typescript
const turnContent = await generateTurnContentWithFlag(
  currentState,
  computed.selectedAction.action,
  computed.checks,
  userPreferences,
  {},
  computed.event ? { name: computed.event.name, ... } : null
);
// PCE pipeline executes 4 stages sequentially:
// 1. Master Enrichment
// 2. Narrative
// 3. Image Prompt
// 4. Actions (6 action chips)
// All in one LLM call chain
```

**Step 3.4: Prepare Image Metadata**
```typescript
const precomputedImageMetadata = await prepareTurnImageMetadata(
  currentState,
  tempTurn,
  userPreferences,
  computed.nextTurnNumber
);
// Checks cache, returns { imageUrl, templateName } | null
```

**Step 3.5: Create Manifest and Enqueue Apply**
```typescript
const manifestId = await createProvisionalManifest(...);
await updatePrecomputeSection(manifestId, precomputeSection);

await orchestrator.enqueue({
  queue: 'turn-apply',
  payload: { id: job.id },
  metadata: { manifestId, precomputeHash }
});
```

#### 4. Turn Apply Worker

**File**: `server/orchestrator/workers/turnApplyWorker.ts:133-404`

**Step 4.1: Load Manifest**
```typescript
const manifest = await storage.getTurnExecutionManifest(...);
const precomputeSection = manifest.manifest.precompute;
```

**Step 4.2: Apply Turn Logic (Inside Transaction)**
```typescript
const updatedState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
  // Process turn with precomputed data
  const newState = await processTurnLogic(state, action, {
    turnContent: precomputeSection.turnContent,
    actions: precomputeSection.actions,
    checks: precomputeSection.deterministic.checks,
    selectedAction: precomputeSection.deterministic.selectedAction,
    event: precomputeSection.deterministic.event,
    skill: precomputeSection.deterministic.skill,
    success: precomputeSection.deterministic.success
  });
  
  // Apply image metadata
  const finalTurn = newState.turns[newState.turns.length - 1];
  await processTurnImage(newState, finalTurn, userPreferences, newState.turnNumber, precomputedImageMetadata);
  
  return newState;
});
// Transaction duration: ~5-50ms (very fast)
```

**Step 4.3: Emit WebSocket Event**
```typescript
this.io.to(job.gameId).emit('turnComplete', { 
  gameId: job.gameId, 
  turnNumber: updatedState.turnNumber 
});
```

#### 5. Client Receives Notification

**File**: `client/src/hooks/useGameLogic.ts:330-337`

```typescript
socket.on('turnComplete', (data: { gameId: string; turnNumber: number }) => {
  // Invalidate React Query cache
  queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
  
  // Show toast notification
  toast({
    title: "Next Turn Ready",
    description: `Turn ${data.turnNumber} narrative is ready`,
  });
});
```

**React Query Refetch**:
- Query automatically refetches when invalidated
- `GET /api/game/:id` returns updated game state
- UI re-renders with new turn narrative and actions

### Step-by-Step: Turn 2

**Flow is identical to Turn 1**, with the following differences:

1. **State Context**: Turn 2 state includes Turn 1's narrative as context for the PCE pipeline
2. **Action Availability**: Different actions may be generated based on story progression

### Step-by-Step: Turn 3

**Flow is identical to Turn 1 and Turn 2**, with special behavior:

**Daily Resource Consumption** (`server/gameLogic.ts:786-800`):
```typescript
if (state.turnNumber % 2 === 0) {
  state.day++;
  state.segment = getSegment(state.day);
  
  // Apply daily resource consumption
  const { deltaString: consumptionDelta } = calculateDailyConsumption(validEquippedItems);
  const { stats: statsAfterConsumption, changes: clampedChanges } = 
    applyDelta(state.stats, consumptionDelta);
  state.stats = statsAfterConsumption;
  
  consumptionChanges = clampedChanges.map(change => ({
    ...change,
    note: 'Daily consumption'
  }));
}
```

**Applied During Apply Phase**: Turn 3 (turnNumber 2) triggers day advancement and resource consumption within the transaction.

### Code Examples

#### Complete Turn Processing Flow

```typescript
// 1. Client submits action
actionMutation.mutate({ action: "action-id-1" });

// 2. Server creates job
const job = await storage.createTurnJob({ gameId, actionPayload: { action } });

// 3. Precompute worker (outside transaction)
const computed = await computeTurnChecks(state, action);
const turnContent = await generateTurnContentWithFlag(...);
const imageMetadata = await prepareTurnImageMetadata(...);

// 4. Apply worker (inside transaction)
await storage.processTurnWithTransaction(gameId, async (state) => {
  return await processTurnLogic(state, action, {
    turnContent,
    actions: turnContent.actions,
    checks: computed.checks,
    ...
  });
});

// 5. WebSocket notification
io.to(gameId).emit('turnComplete', { gameId, turnNumber });

// 6. Client updates
queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
```

### Best Practices

1. **Always use `apiRequest` wrapper** for HTTP calls (handles CSRF automatically)
2. **Check `actionMutation.isPending`** before submitting actions (prevents duplicates)
3. **Invalidate queries on WebSocket events** (ensures UI stays in sync)
4. **Use optimistic updates** for equipment changes (better UX)
5. **Handle errors gracefully** with toast notifications
6. **Verify game ownership** on all mutating endpoints
7. **Use transactions** for all state updates (atomicity)

---

## Troubleshooting & Support

### Common Issues

#### Issue 1: Turn Not Processing

**Symptoms**: Action submitted, but no `turnComplete` event received

**Diagnosis**:
1. Check server logs for job creation: `[Storage] Created turn job`
2. Check orchestrator queue: `SELECT * FROM orchestrator_queue WHERE queue = 'turn-precompute'`
3. Check worker logs: `[TurnPrecomputeWorker] Processing job`

**Solutions**:
- Verify orchestrator is running: Check `server/routes.ts` worker initialization
- Check PostgreSQL NOTIFY: Ensure `NOTIFY queue_turn_precompute` is working
- Verify worker is polling: Check `[TurnPrecomputeWorker] Started` log
- Check for stuck jobs: Query `turn_jobs` table for `status = 'processing'` with old timestamps

#### Issue 2: WebSocket Not Receiving Events

**Symptoms**: Turn completes on server, but client doesn't update

**Diagnosis**:
1. Check Socket.IO connection: Browser console → Network → WS tab
2. Verify room join: Server logs should show `joinGame` event
3. Check event emission: Server logs should show `turnComplete` emission

**Solutions**:
- Verify socket connection: `socket.connected === true`
- Check room membership: Server logs should show `socket.join(gameId)`
- Verify event name: Must match `'turnComplete'` exactly
- Check CORS: Ensure Socket.IO CORS allows client origin

#### Issue 3: Image Not Generating

**Symptoms**: Turn completes, but image remains placeholder

**Diagnosis**:
1. Check image job creation: `SELECT * FROM image_jobs WHERE turn_number = ?`
2. Check image worker logs: `[ImageWorker] Processing job`
3. Check cache: `SELECT * FROM generated_images WHERE cache_key = ?`

**Solutions**:
- Verify image worker is running: Check worker initialization
- Check OpenAI API key: Ensure `OPENAI_API_KEY` is set
- Check image cache: Query `generated_images` table for cache hits
- Verify image job queue: Check `orchestrator_queue` for `queue = 'image'`

#### Issue 4: Stale Game State

**Symptoms**: Client shows old state after turn completes

**Diagnosis**:
1. Check React Query cache: `queryClient.getQueryData(['api', 'game', gameId])`
2. Verify query invalidation: Check `invalidateQueries` calls
3. Check refetch: Verify `GET /api/game/:id` returns latest state

**Solutions**:
- Force refetch: `queryClient.refetchQueries({ queryKey: ['api', 'game', gameId] })`
- Clear cache: `queryClient.removeQueries({ queryKey: ['api', 'game', gameId] })`
- Verify WebSocket handler: Ensure `turnComplete` triggers invalidation

### Error Messages

#### "Game not found" (404)
- **Cause**: Game ID doesn't exist in database
- **Solution**: Verify game ID matches database record

#### "Access denied" (403)
- **Cause**: Username mismatch between session and game owner
- **Solution**: Verify session username matches game username

#### "Game is already complete" (400)
- **Cause**: Attempting action on completed game
- **Solution**: Check `gameState.isComplete` before allowing actions

#### "PCE pipeline failed to generate actions"
- **Cause**: LLM call failed or returned invalid format
- **Solution**: Check OpenAI API key, verify PCE pipeline logs

### Debugging Tips

1. **Enable LLM Logging**: Set `CONSOLE_LLM_LOG=true` to see LLM calls in browser console
2. **Check Manifest**: Query `turn_execution_manifests` table for detailed turn processing logs
3. **Monitor Queue Depth**: Query `SELECT COUNT(*) FROM orchestrator_queue WHERE queue = 'turn-precompute'`
4. **Check Transaction Duration**: Look for `turnApplyPhaseDuration` metrics
5. **Verify Precompute Hash**: Compare manifest `precomputeHash` with expected hash

### Debugging Commands

```sql
-- Check pending jobs
SELECT * FROM turn_jobs WHERE status = 'pending' ORDER BY created_at DESC;

-- Check queue depth
SELECT queue, COUNT(*) FROM orchestrator_queue GROUP BY queue;

-- Check recent turns
SELECT turn_number, created_at FROM games, jsonb_array_elements(turns) AS turn 
WHERE id = 'game-123' ORDER BY turn->>'turnNumber';

-- Check image jobs
SELECT * FROM image_jobs WHERE game_id = 'game-123' ORDER BY created_at DESC;
```

---

## Standards & Processes

### Quality Requirements

1. **Transaction Duration**: Must be <100ms (typical: 5-50ms)
2. **Precompute Duration**: Typical: 3-10 seconds (LLM calls)
3. **End-to-End Latency**: Turn processing: 5-15 seconds total
4. **WebSocket Latency**: Event emission: <10ms after transaction commit

### Security Considerations

1. **Authentication**: All endpoints require `requireAuth` middleware
2. **Authorization**: Verify game ownership on all mutating endpoints
3. **CSRF Protection**: All POST/PATCH requests require CSRF token
4. **Rate Limiting**: Applied per-endpoint (see `server/middleware/rateLimiting.ts`)
5. **Input Validation**: All inputs validated with Zod schemas
6. **SQL Injection**: Parameterized queries only (no string concatenation)

### Performance Implications

1. **Database Locks**: Minimized via two-phase pattern (precompute outside transaction)
2. **LLM Calls**: Executed outside transactions (3-10 seconds don't block DB)
3. **Cache Strategy**: Image cache checked in precompute phase (avoids transaction I/O)
4. **Queue Backpressure**: Workers process jobs in batches (max 5 concurrent)

### Testing Approaches

1. **Unit Tests**: Test deterministic functions (`computeTurnChecks`, `applyDelta`)
2. **Integration Tests**: Test transaction boundaries (`processTurnWithTransaction`)
3. **E2E Tests**: Test complete flow (client → server → worker → client)
4. **Load Tests**: Test queue behavior under high concurrency

### Validation Steps

1. **Turn Processing**:
   - Verify turn number increments
   - Verify narrative is generated
   - Verify actions are generated (6 actions)
   - Verify stats are updated correctly

2. **Image Processing**:
   - Verify cache hit applies immediately
   - Verify cache miss creates image job
   - Verify image URL is set on turn record

3. **WebSocket Events**:
   - Verify `turnComplete` emitted after transaction
   - Verify `imageReady` emitted after image generation
   - Verify client receives events and updates UI

---

## Visual Aids

### Sequence Diagram: Game Start (Turn 0)

```
Client          Server          DB          Workers
  │              │              │              │
  │ POST /start  │              │              │
  │─────────────>│              │              │
  │              │ createGame() │              │
  │              │─────────────>│              │
  │              │              │              │
  │              │ generateTurnContent()       │
  │              │─────────────────────────────>│
  │              │<─────────────────────────────│
  │              │              │              │
  │              │ applyIntroTurn()            │
  │              │─────────────>│              │
  │              │<──────────────│              │
  │              │              │              │
  │<─────────────│              │              │
  │ GameState    │              │              │
```

### Sequence Diagram: Turn 1

```
Client          Server          DB          Precompute      Apply
  │              │              │              │              │
  │ POST /action │              │              │              │
  │─────────────>│              │              │              │
  │              │ createJob()  │              │              │
  │              │─────────────>│              │              │
  │              │              │              │              │
  │              │ enqueue(precompute)         │              │
  │              │──────────────────────────────>│              │
  │              │              │              │              │
  │<─────────────│              │              │              │
  │ {processing} │              │              │              │
  │              │              │              │              │
  │              │              │              │ claimJob()   │
  │              │              │              │<─────────────│
  │              │              │              │              │
  │              │              │              │ computeChecks │
  │              │              │              │ generateContent │
  │              │              │              │              │
  │              │              │              │ enqueue(apply)│
  │              │              │              │──────────────>│
  │              │              │              │              │
  │              │              │              │              │ claimJob()
  │              │              │              │              │<───────────
  │              │              │              │              │
  │              │              │              │              │ processTurn()
  │              │              │<──────────────────────────────│
  │              │              │              │              │
  │              │              │              │              │ emit(turnComplete)
  │              │<───────────────────────────────────────────│
  │              │              │              │              │
  │<─────────────│              │              │              │
  │ WS:turnComplete             │              │              │
  │              │              │              │              │
  │ GET /game/:id               │              │              │
  │─────────────────────────────────────────────>│              │
  │<─────────────────────────────────────────────│              │
  │ GameState    │              │              │              │
```

### State Transition Diagram

```
[Game Start]
    │
    ▼
[Turn 0: Intro]
    │ (action submitted)
    ▼
[Turn 1: Precompute]
    │
    ├─► Compute Checks
    ├─► Generate Content (PCE)
    ├─► Check Image Cache
    └─► Enqueue Apply
         │
         ▼
[Turn 1: Apply]
    │
    ├─► Process Turn Logic
    ├─► Apply Image Metadata
    └─► Emit WebSocket Event
         │
         ▼
[Turn 1: Complete]
    │ (action submitted)
    ▼
[Turn 2: ...]
    │
    ▼
[Turn 3: ...]
    │ (if turnNumber % 2 === 0)
    ├─► Advance Day
    └─► Apply Daily Consumption
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ React UI     │  │ React Query │  │ Socket.IO    │      │
│  │ Components   │  │ Cache        │  │ Client       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                          │ HTTP           │ WebSocket
                          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                      SERVER LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Routes       │  │ Storage      │  │ Socket.IO    │      │
│  │ (Express)    │  │ (Postgres)   │  │ Server       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Precompute   │  │ Apply        │  │ Image        │      │
│  │ Worker       │  │ Worker       │  │ Worker       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                        │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │ OpenAI API   │  │ File System   │                         │
│  │ (LLM/Images) │  │ (Cache)       │                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Cross-References

### Related Documentation

1. **System Overview**: [`SYSTEM_OVERVIEW.md`](./SYSTEM_OVERVIEW.md)
   - High-level architecture and runtime responsibilities

2. **Agents**: [`AGENTS.md`](../AGENTS.md)
   - Agent catalog and communication patterns

3. **Game Walkthrough**: [`GAME_WALKTHROUGH.md`](./GAME_WALKTHROUGH.md)
   - Detailed code path references for turns 0-3

4. **Game Execution Flow**: [`GAME_EXECUTION_FLOW.md`](./GAME_EXECUTION_FLOW.md)
   - Two-phase processing pattern and orchestrator details

5. **Client Game Interaction**: [`CLIENT_GAME_INTERACTION.md`](./CLIENT_GAME_INTERACTION.md)
   - Client-side state management and UI updates

6. **Transaction Boundaries**: [`TRANSACTION_BOUNDARIES_ARCHITECTURE.md`](./TRANSACTION_BOUNDARIES_ARCHITECTURE.md)
   - Transaction design and optimization strategies

7. **Image System**: [`IMAGE_SYSTEM_ARCHITECTURE.md`](./IMAGE_SYSTEM_ARCHITECTURE.md)
   - Image generation and caching details

### Key Code Files

- `server/routes.ts`: API endpoints
- `server/gameInitialization.ts`: Game start logic
- `server/gameLogic.ts`: Turn processing logic
- `server/orchestrator/workers/turnPrecomputeWorker.ts`: Precompute phase
- `server/orchestrator/workers/turnApplyWorker.ts`: Apply phase
- `client/src/hooks/useGameLogic.ts`: Client game state management
- `client/src/lib/socket.ts`: WebSocket client
- `server/storage.ts`: Database abstraction

### Dependencies

- **React Query**: Client-side state management
- **Socket.IO**: Real-time communication
- **Postgres**: Database and queue system
- **OpenAI API**: LLM and image generation
- **Zod**: Input validation

---

## Summary

This document provides a comprehensive simulation of frontend-backend communication from Game Start through Turn 3. Key takeaways:

1. **Game Start (Turn 0)**: Synchronous processing with inline LLM generation
2. **Turns 1+**: Asynchronous two-phase processing via orchestrator
3. **Communication**: HTTP for requests, WebSocket for real-time updates
4. **Performance**: Transactions <50ms, precompute 3-10s, total latency 5-15s
5. **Reliability**: Transactional guarantees, idempotent jobs, error handling

The architecture separates expensive operations (LLM calls) from fast operations (database transactions), enabling responsive UI updates while maintaining data consistency.

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Status**: Current and authoritative  
**Maintainer**: Engineering Team

