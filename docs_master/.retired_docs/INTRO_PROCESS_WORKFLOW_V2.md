# Intro Process Workflow Diagram V2

This document diagrams the complete workflow that occurs when a user clicks "START NEW VOYAGE" on the Main Menu, including all steps, API calls, database operations, async jobs, and background processes.

**Version 2 Updates:**
- User validation now occurs at the route level (`POST /api/game/start`) before game initialization
- Removed `ensureUser()` call from `initializeNewGame()` - user record is validated explicitly at route handler
- Improved error handling with explicit user existence check (404 if user not found)

## Overview

The intro process initializes a new game, generates the opening narrative, creates action choices, and optionally processes scene images. The entire process is synchronous from the user's perspective but involves multiple async operations, database transactions, and potentially background job processing.

**Key Principle**: Users must be authenticated and their record must exist in the database before game creation can proceed. This validation happens explicitly at the API boundary, not deep in the initialization logic.

---

## Complete Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: MainMenuPage.tsx                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │ User clicks "START NEW VOYAGE"
                              ▼
        ┌─────────────────────────────────────┐
        │ handleStartNewVoyage()               │
        │ └─ startGameMutation.mutate()        │
        └─────────────────────────────────────┘
                              │
                              │ POST /api/game/start
                              │ { username }
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVER: routes.ts                                                           │
│ POST /api/game/start                                                         │
│ - requireAuth (session validation)                                          │
│ - gameStartRateLimit (rate limiting)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │ Extract username from session
                              │ req.session.username
                              ▼
        ┌─────────────────────────────────────┐
        │ Validate User Exists                 │
        │ storage.getUserByUsername(username) │
        │                                     │
        │ - SELECT FROM users                 │
        │   WHERE username = ?                │
        │ - Returns User | undefined          │
        │                                     │
        │ If user not found:                  │
        │ └─> Return 404 "User not found"     │
        └─────────────────────────────────────┘
                              │
                              │ User validated ✓
                              ▼
                  ┌───────────────────────┐
                  │ Validate Input         │
                  │                       │
                  │ insertGameStateSchema │
                  │ .parse({ ...req.body, │
                  │   username })         │
                  └───────────────────────┘
                              │
                              │ validated
                              ▼
        ┌─────────────────────────────────────┐
        │ initializeNewGame(validated)         │
        │ gameInitialization.ts                │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ buildInitialGameState(validated)    │
        │                                     │
        │ - Generate gameId (UUID)            │
        │ - Generate seed (UUID)              │
        │ - day: 1                            │
        │ - turnNumber: 0                     │
        │ - segment: getSegment(1)            │
        │ - stats: all 100                    │
        │ - weirdness: 0                      │
        │ - Load NPCs from reference          │
        │   (getInitialNpcs)                  │
        │ - Default equipped items:            │
        │   ['red_tape',                       │
        │    'universal_allen_key',           │
        │    'nebula_freshener']              │
        └─────────────────────────────────────┘
                              │
                              │ initialState
                              ▼
                  ┌───────────────────────┐
                  │ createGameState()     │
                  │ storage.ts            │
                  │                       │
                  │ INSERT INTO games    │
                  │ (with all state data)│
                  └───────────────────────┘
                              │
                              │ State persisted to DB
                              ▼
        ┌─────────────────────────────────────┐
        │ processTurnWithTransaction()        │
        │ gameLogic.ts                         │
        │                                     │
        │ - Begin DB transaction               │
        │ - SELECT ... FOR UPDATE             │
        │ - Lock game row                     │
        │ - Call processor callback           │
        └─────────────────────────────────────┘
                              │
                              │ processor = buildIntroActionInput(gameId)
                              │ action = { gameId, action: "__intro_turn__" }
                              ▼
        ┌─────────────────────────────────────┐
        │ processTurnLogic(state, action)     │
        │ gameLogic.ts                        │
        │                                     │
        │ - Load user preferences             │
        └─────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ getUserPreferences()  │
                  │ storage.ts            │
                  │                       │
                  │ SELECT FROM users     │
                  │ WHERE username = ?    │
                  │                       │
                  │ Returns:              │
                  │ { theme?, style?,     │
                  │  imageModelKey? }     │
                  └───────────────────────┘
                              │
                              │ userPreferences
                              ▼
        ┌─────────────────────────────────────┐
        │ processIntroTurn()                   │
        │ gameLogic.ts                        │
        │                                     │
        │ Check: if intro turn already exists │
        │ └─> Skip if found                   │
        └─────────────────────────────────────┘
                              │
                              │ (New intro turn)
                              ▼
        ┌─────────────────────────────────────┐
        │ generateTurnContentWithFlag()      │
        │ aiService.ts                        │
        │                                     │
        │ Parameters:                         │
        │ - state: GameState                  │
        │ - playerAction: "Beginning voyage"  │
        │ - checks: []                        │
        │ - userPreferences                   │
        │ - options: { intro: true }          │
        │ - triggeredEvent: null              │
        └─────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ isPceEnabled()        │
                  │ Check PCE setting     │
                  └───────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
        PCE Enabled?         │         PCE Disabled
                  │                       │
                  ▼                       ▼
        ┌──────────────────┐   ┌───────────────────────┐
        │ generateTurnContent()│   │ generateIntroTurnContent()│
        │ (PCE path)          │   │ (Legacy path)       │
        │                     │   │                     │
        │ Uses PCE master     │   │ Uses legacy prompts │
        │ prompt system       │   │ from prompts.ts     │
        └──────────────────┘   └───────────────────────┘
                  │                       │
                  └───────────┬───────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ LLM API Call (OpenAI)                │
        │                                     │
        │ - Model: Determined by PCE/user pref │
        │ - Generate:                          │
        │   • Narrative text                   │
        │   • Image prompt                     │
        │   • Theme/style selections           │
        │                                     │
        │ Returns: TurnContentResult           │
        │ {                                    │
        │   narration: string,                │
        │   imagePrompt: string,              │
        │   theme: string,                    │
        │   style: string,                    │
        │   rawResponse: string               │
        │ }                                    │
        └─────────────────────────────────────┘
                              │
                              │ turnContent
                              ▼
        ┌─────────────────────────────────────┐
        │ Create Turn Object                  │
        │                                     │
        │ turn = {                            │
        │   turnNumber: 0,                    │
        │   narrative: turnContent.narration, │
        │   checks: [],                       │
        │   delta: [],                       │
        │   timestamp: Date.now(),            │
        │   imagePrompt: turnContent.imagePrompt,│
        │   imageStyle: turnContent.style     │
        │ }                                   │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ Image Processing                     │
        │ processIntroTurn() continues        │
        │                                     │
        │ 1. selectImageTemplate(state)      │
        │    └─> Returns template name        │
        │                                     │
        │ 2. checkImageCache()                │
        │    aiService.ts                     │
        │    └─> Check for cached image      │
        └─────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ checkImageCache()     │
                  │ aiService.ts         │
                  │                       │
                  │ 1. computeImageKeys() │
                  │    - Generate prompt  │
                  │    - Hash prompt      │
                  │    - Hash variables   │
                  │                       │
                  │ 2. Check exact match: │
                  │    getGeneratedImageByHash()│
                  │                       │
                  │ 3. Check similar scenes:│
                  │    getGeneratedImagesByTemplate()│
                  │    └─> findSimilarScenes()│
                  │                       │
                  │ Returns:              │
                  │ - ImageResult | null  │
                  └───────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
           Cache Hit?         │      Cache Miss
                  │                       │
                  ▼                       ▼
        ┌──────────────────┐   ┌───────────────────────┐
        │ Image Found      │   │ Create Image Job      │
        │                 │   │                       │
        │ - Load from file│   │ storage.createImageJob()│
        │ - Convert to URL│   │                       │
        │ - Set turn.imageUrl││ Insert INTO image_jobs│
        │ - Set status:    │   │ status = 'pending'    │
        │   'completed'    │   │                       │
        │                 │   │ - Set turn.imageJobId │
        │                 │   │ - Set turn.imageStatus│
        │                 │   │   = 'pending'         │
        └──────────────────┘   └───────────────────────┘
                  │                       │
                  └───────────┬───────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ generateActions()                    │
        │ aiService.ts                        │
        │                                     │
        │ - Build action generation prompt     │
        │ - Call OpenAI API (gpt-4o-mini)     │
        │ - Parse JSON response                │
        │ - Validate actions (6 actions)       │
        │ - Fill with fallbacks if needed      │
        │                                     │
        │ Returns: ActionChip[] (6 actions)   │
        │ Each action: {                       │
        │   action: string,                   │
        │   summary: string,                   │
        │   risk: 'Safe'|'Risky'|'Wild',     │
        │   intent: Intent                    │
        │ }                                   │
        └─────────────────────────────────────┘
                              │
                              │ state.currentActions = actions
                              ▼
        ┌─────────────────────────────────────┐
        │ state.turns.push(turn)              │
        │                                     │
        │ Final state update:                 │
        │ - turns: [turn]                     │
        │ - currentActions: [6 actions]       │
        │ - All other state persisted          │
        └─────────────────────────────────────┘
                              │
                              │ Return updatedState
                              ▼
        ┌─────────────────────────────────────┐
        │ Transaction Commit                   │
        │ storage.ts                          │
        │                                     │
        │ UPDATE games SET ...                │
        │ (Save complete state to DB)         │
        │                                     │
        │ COMMIT                              │
        │ Release row lock                    │
        └─────────────────────────────────────┘
                              │
                              │ Return readyState
                              ▼
        ┌─────────────────────────────────────┐
        │ routes.ts                           │
        │ res.json(readyState)                │
        │                                     │
        │ Returns complete GameState to client │
        │ (variable named readyState contains │
        │  fully processed game state post-intro)│
        └─────────────────────────────────────┘
                              │
                              │ HTTP 200 Response
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: MainMenuPage.tsx                                                    │
│                                                                             │
│ startGameMutation.onSuccess()                                              │
│ - queryClient.setQueryData(['api', 'game', data.id], data)                │
│ - setLocation(`/game/${data.id}`)                                          │
│                                                                             │
│ └─> Navigate to GamePage                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: GamePage.tsx / useGameLogic.ts                                      │
│                                                                             │
│ Client-side Intro Readiness Validation (NEW in V2)                         │
│                                                                             │
│ 1. useQuery fetches game state: ['api', 'game', gameId]                    │
│                                                                             │
│ 2. isIntroReady validation (useMemo):                                      │
│    - gameState exists                                                      │
│    - gameState.turns.length > 0 (intro turn exists)                       │
│    - Intro turn (turnNumber === 0) found                                   │
│    - Intro turn.narrative exists and is non-empty                         │
│    - gameState.currentActions is array with length > 0                    │
│                                                                             │
│ 3. If !isIntroReady: Show GameDataLoading component                        │
│                                                                             │
│ 4. If isIntroReady: Render DesktopGamePage/MobileGamePage                  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    [User sees game page with intro]

─────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKGROUND PROCESS: Image Job Processing (If image was NOT cached)          │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────────────────────┐
        │ ImageWorker                          │
        │ orchestrator/workers/imageWorker.ts │
        │                                     │
        │ - Leases jobs via orchestrator      │
        │ - Polls only as fallback            │
        └─────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ SELECT FROM          │
                  │ image_jobs           │
                  │ WHERE status =       │
                  │ 'pending'            │
                  │ ORDER BY created_at  │
                  │ LIMIT 5              │
                  │ (polls up to 5 jobs) │
                  └───────────────────────┘
                              │
                              │ (If job found)
                              ▼
        ┌─────────────────────────────────────┐
        │ processJob(job: ImageJob)           │
        │                                     │
        │ 1. Acquire orchestrator lease       │
        │    (queue_entries.status='leased')  │
        │                                     │
        │ 2. Get game state:                  │
        │    storage.getGameState(job.gameId) │
        │                                     │
        │ 3. Load user preferences:           │
        │    getUserPreferences(username)     │
        │                                     │
        │ 4. Check cache again:               │
        │    checkImageCache()                │
        │    (In case cached while pending)  │
        └─────────────────────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
           Cache Hit?         │      Still Miss
                  │                       │
                  ▼                       ▼
        ┌──────────────────┐   ┌───────────────────────┐
        │ Use cached image │   │ generateImage()       │
        │                  │   │ aiService.ts         │
        │                  │   │                      │
        │ - Load from file │   │ 1. computeImageKeys()│
        │ - Update job     │   │ 2. Check cache       │
        │   imageUrl       │   │ 3. Call image API    │
        │ - Set completed  │   │    (OpenAI/Replicate)│
        │                  │   │ 4. Save to disk      │
        │                  │   │ 5. Save to DB        │
        │                  │   │    (generated_images)│
        │                  │   │                      │
        │                  │   │ Returns: imageUrl     │
        └──────────────────┘   └───────────────────────┘
                  │                       │
                  └───────────┬───────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ Update Image Job                     │
        │                                     │
        │ UPDATE image_jobs SET               │
        │   status = 'completed',             │
        │   image_url = ?,                    │
        │   completed_at = NOW()              │
        │ WHERE id = ?                        │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ Update Game Turn                     │
        │                                     │
        │ processTurnWithTransaction()        │
        │ - Lock game row                     │
        │ - Update turn.imageUrl              │
        │ - Update turn.imageStatus = 'completed'│
        │ - Save to DB                        │
        │ - COMMIT                            │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │ Notify Client (Socket.IO)           │
        │                                     │
        │ io.to(gameId).emit('imageReady',    │
        │   {                                 │
        │     jobId,                          │
        │     gameId,                         │
        │     turnNumber,                     │
        │     imageUrl,                       │
        │     imageTemplate,                  │
        │     promptSource                    │
        │   }                                 │
        │ )                                   │
        │                                     │
        │ Note: On failure, emits 'imageFailed'│
        │ with { jobId, gameId, turnNumber, error }│
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Client receives image update]

```

---

## Detailed Step Breakdown

### 1. Client Click Handler

**File**: `client/src/pages/MainMenuPage.tsx`

- **Function**: `handleStartNewVoyage()` (line 233)
- **Action**: Calls `startGameMutation.mutate()`
- **HTTP Request**: `POST /api/game/start` with `{ username }`
- **Loading State**: Button shows "INITIALIZING VOYAGE..." with spinner while `isPending`

### 2. Server Route Handler

**File**: `server/routes.ts` (line 31)

**Steps:**
1. **Auth Check**: `requireAuth` middleware validates session
   - Checks `req.session.userId` and `req.session.username` exist
   - Returns 401 if not authenticated

2. **Rate Limit**: `gameStartRateLimit` middleware checks rate limits
   - Prevents rapid game creation

3. **Extract Username**: Get username from session
   - `const username = req.session.username`
   - Returns 401 if username not in session

4. **Validate User Exists**: **NEW in V2**
   - `const user = await storage.getUserByUsername(username)`
   - Explicitly checks database for user record
   - Returns 404 "User not found" if user doesn't exist
   - This ensures data integrity before proceeding

5. **Validate Input**: `insertGameStateSchema.parse()` validates request body
   - Merges session username into validated data

6. **Initialize**: Calls `initializeNewGame(validated)`

### 3. Game Initialization

**File**: `server/gameInitialization.ts`

**Function**: `initializeNewGame()`

**Sub-steps:**
1. `buildInitialGameState()` - Creates initial game state object
   - Generates UUIDs for `id` and `seed`
   - Sets day=1, turnNumber=0
   - Loads NPCs from reference data
   - Sets default equipped items
   - Initializes all stats to 100

2. ~~`storage.ensureUser(username)`~~ - **REMOVED in V2**
   - User validation now happens at route level
   - No longer creates users implicitly

3. `storage.createGameState(initialState)` - Persists game to database
   - `INSERT INTO games` with all state as JSON

4. `processTurnWithTransaction()` - Processes intro turn
   - Wrapped in database transaction with row locking

### 4. Transaction Processing

**Function**: `processTurnWithTransaction()`

**Locations:**
- **Wrapper**: `server/gameLogic.ts:475` - `processTurnWithTransaction()` delegates to storage implementation
- **Actual transaction**: `server/storage.ts:1170` - Authoritative implementation with `SELECT ... FOR UPDATE` locking

**File**: `server/storage.ts` (line 1170)

**Transaction Flow:**
1. **BEGIN** - Start database transaction
2. **SELECT ... FOR UPDATE** - Lock game row to prevent race conditions
3. **Process** - Execute processor callback with locked state
4. **UPDATE** - Write updated state back to database
5. **COMMIT** - Commit transaction and release lock

### 5. Intro Turn Processing

**File**: `server/gameLogic.ts` (line 136)

**Function**: `processIntroTurn()`

**Steps:**
1. **Load Preferences**: `storage.getUserPreferences(state.username)`
   - Queries user record for theme/style/imageModelKey
   - User record guaranteed to exist (validated at route level)

2. **Check Existing**: Verify intro turn doesn't already exist
   - If exists, only regenerate actions if needed

3. **Generate Content**: `generateTurnContentWithFlag()`
   - Determines if PCE is enabled
   - Calls appropriate generation path (PCE or Legacy)

4. **Create Turn Object**: Builds turn 0 with narrative and image prompt

5. **Image Processing**:
   - Selects appropriate image template
   - Checks cache for existing image
   - If cached: Sets `imageUrl` and `imageStatus = 'completed'`
   - If not cached: Creates image job and sets `imageStatus = 'pending'`

6. **Generate Actions**: `generateActions()`
   - Calls OpenAI API to generate 6 action choices
   - Validates and fills fallbacks if needed

7. **Update State**: Adds turn to state and sets currentActions

### 6. Content Generation

**File**: `server/aiService.ts`

**Functions:**
- `generateTurnContentWithFlag()` (line 1118)
- `generateTurnContent()` (line 847) - PCE path
- `generateIntroTurnContent()` (line 353) - Legacy path

**Process:**
1. Resolves creative selections (theme, style, image model)
2. Builds prompt with game state context
3. Calls OpenAI LLM API
4. Parses response for narrative and image prompt
5. Returns `TurnContentResult`

### 7. Action Generation

**File**: `server/aiService.ts` (line 1188)

**Function**: `generateActions()`

**Process:**
1. Builds action generation prompt with game context
2. Calls OpenAI API (gpt-4o-mini) with JSON format
3. Parses JSON response
4. Validates actions have required fields
5. Fills to 6 actions with fallbacks if needed
6. Returns `ActionChip[]`

### 8. Image Cache Check

**File**: `server/aiService.ts` (line 1712)

**Function**: `checkImageCache()`

**Process:**
1. **Compute Keys**: `computeImageKeys()` generates prompt and variable hashes
2. **Exact Match**: Check `getGeneratedImageByHash(promptHash, variablesHash)`
3. **Similar Match**: If no exact match, check for similar scenes using fingerprinting
4. **Load Image**: If found, load from file system and return data URL
5. **Return**: `ImageGenerationResult | null`

### 9. Image Job Creation (If Cache Miss)

**File**: `server/storage.ts` (line 1247)

**Function**: `createImageJob()`

**Process:**
1. Generate UUID for job ID
2. `INSERT INTO image_jobs` with status='pending'`
3. Returns `ImageJob` object
4. Turn object stores `imageJobId` for later reference

### 10. Background Image Processing

**File**: `server/imageJobProcessor.ts`

**Process:**
1. **Polling**: Runs every 1 second (configurable), polls up to 5 jobs per cycle
2. **Query**: `SELECT FROM image_jobs WHERE status='pending' ORDER BY created_at LIMIT 5`
3. **Process Job**:
   - Update status to 'processing'
   - Load game state
   - Load user preferences
   - Check cache again (may have been cached while pending)
   - If still miss, call `generateImage()` to create new image
   - Save image to disk and database
4. **Update Turn**: Use transaction to update turn with image URL
5. **Notify Client**: Emit Socket.IO event `imageReady` on success (with payload: `{ jobId, gameId, turnNumber, imageUrl, imageTemplate, promptSource }`) or `imageFailed` on failure (with payload: `{ jobId, gameId, turnNumber, error }`)

---

## Changes from V1 to V2

### User Validation

**V1**: User creation/validation was implicit in `initializeNewGame()` via `ensureUser()`
- User could be created on-the-fly during game initialization
- Validation happened deep in the initialization logic

**V2**: User validation is explicit at the route handler level
- User record must exist before game initialization begins
- Returns clear 404 error if user doesn't exist
- Better separation of concerns: authentication/validation happens at API boundary

### Code Changes

**Removed from `initializeNewGame()`**:
```typescript
// REMOVED - no longer needed
await storage.ensureUser(initialState.username);
```

**Added to `routes.ts` POST /api/game/start**:
```typescript
// NEW - explicit validation
const user = await storage.getUserByUsername(username);
if (!user) {
  return res.status(404).json({ error: "User not found" });
}
```

### Benefits

1. **Explicit Error Handling**: Clear 404 response if user doesn't exist
2. **Data Integrity**: Catches data inconsistencies early at the API boundary
3. **Better Separation of Concerns**: Authentication/validation at route level, not in business logic
4. **Performance**: One less database query during initialization (user already validated)
5. **Clarity**: Makes it obvious that user must exist before game creation

---

## Async Operations & Jobs

### Synchronous (User-Facing)

- All steps through `processTurnWithTransaction()` completion
- Game state returned to client immediately
- User can start interacting with game

### Asynchronous (Background)

1. **Image Generation** (if not cached):
   - Created as pending job
   - Processed by `ImageWorker`
   - Client notified via Socket.IO when complete

2. **LLM API Calls**:
   - `generateTurnContentWithFlag()` - OpenAI API call (synchronous in request)
   - `generateActions()` - OpenAI API call (synchronous in request)

### Database Transactions

- **User Validation**: Simple SELECT query (no transaction needed)
- **Game Creation**: Single INSERT operation
- **Intro Turn Processing**: Wrapped in `processTurnWithTransaction()` with row locking
- **Image Job Updates**: Separate transaction when image completes

### Rate Limiting

- `gameStartRateLimit` middleware on `/api/game/start` endpoint
- Prevents rapid game creation

---

## Error Handling

### Client Side

**MainMenuPage**:
- `startGameMutation.onError()` displays toast notification
- Mutation disabled while pending to prevent duplicate requests
- Button shows "INITIALIZING VOYAGE..." loading state

**GamePage**:
- **Intro Readiness Validation** (NEW in V2):
  - `useGameLogic` hook checks `isIntroReady` before rendering game content
  - Validation ensures:
    1. Game state exists and is loaded
    2. Intro turn (turnNumber 0) exists
    3. Intro turn has non-empty narrative
    4. `currentActions` array is populated
  - Shows `GameDataLoading` component until all conditions are met
  - Prevents rendering incomplete game state to user
- Both `DesktopGamePage` and `MobileGamePage` use this validation

### Server Side

- **User Validation**: Returns 404 if user not found (explicit check in V2)
- **Session Validation**: Returns 401 if not authenticated
- **Transaction rollback**: On any error in `processTurnWithTransaction()`
- **Image Processing**: Try-catch around image processing (errors logged, don't fail turn)
- **Action Generation**: Fallback actions if generation fails
- **Cache Handling**: Graceful handling of missing cache entries

---

## State Flow Summary

```
Session Validation
  ↓
User Existence Check (NEW in V2)
  ↓
Input Validation
  ↓
buildInitialGameState() → GameState with defaults
  ↓
createGameState() → Saved to DB
  ↓
processTurnWithTransaction() → Locked row, process
  ↓
processIntroTurn() → Generate content & actions
  ↓
Transaction Commit → Updated state saved
  ↓
Return to Client → Complete GameState
  ↓
Client Navigation → GamePage renders
  ↓
Client Validation (NEW in V2) → isIntroReady check
  ↓
If ready: Render game UI | If not ready: Show loading
  ↓
[Background] Image Job → Process image if needed
  ↓
[Background] Update Turn → Image URL added to turn
```

---

## Key Functions Reference

| Function | File | Purpose |
|----------|------|---------|
| `handleStartNewVoyage()` | `client/src/pages/MainMenuPage.tsx:233` | Client click handler |
| `useGameLogic.isIntroReady` | `client/src/hooks/useGameLogic.ts:107` | **NEW in V2** - Client-side intro readiness validation |
| `storage.getUserByUsername()` | `server/storage.ts:157` | **NEW in V2** - User validation at route |
| `initializeNewGame()` | `server/gameInitialization.ts:62` | Main initialization entry |
| `buildInitialGameState()` | `server/gameInitialization.ts:33` | Create initial state object |
| `processTurnWithTransaction()` | `server/gameLogic.ts:475` (wrapper) / `server/storage.ts:1170` (authoritative) | Transaction wrapper delegates to storage implementation with SELECT ... FOR UPDATE |
| `processTurnLogic()` | `server/gameLogic.ts:372` | Main turn processing logic |
| `processIntroTurn()` | `server/gameLogic.ts:138` | Intro turn specific logic |
| `generateTurnContentWithFlag()` | `server/aiService.ts:1118` | Content generation router |
| `generateActions()` | `server/aiService.ts:1188` | Action generation |
| `checkImageCache()` | `server/aiService.ts:1712` | Image cache lookup |
| `createImageJob()` | `server/storage.ts:1247` | Create background image job |
| `ImageWorker.processJob()` | `server/orchestrator/workers/imageWorker.ts:1` | Background image processing |

---

## Timing Estimates

- **Client Request → Response**: ~2-10 seconds (depends on LLM API latency)
- **Image Job Processing**: ~5-30 seconds (if not cached, depends on image API)
- **Total User Experience**: Immediate game availability, image loads later if needed
- **User Validation Overhead**: Minimal (~1-5ms database query)

---

## Dependencies

### External APIs
- OpenAI GPT-4o (for narrative generation)
- OpenAI GPT-4o-mini (for action generation)
- OpenAI DALL-E / Replicate (for image generation, if needed)

### Database Tables
- `users` - User records (validated before game creation in V2)
- `games` - Game state storage
- `image_jobs` - Background image processing queue
- `generated_images` - Cached image metadata

### Internal Services
- Reference data loader (`getCurrentReference()`)
- PCE system (if enabled)
- Image template system
- Cache utilities

---

## Security Considerations

### V2 Improvements

1. **Explicit User Validation**: User record must exist before any game operations
   - Prevents creation of games for non-existent users
   - Returns clear 404 error instead of silently creating users

2. **Session-Based Authentication**: Username always comes from session
   - Route handler overrides any username in request body
   - `req.session.username` is the source of truth

3. **Rate Limiting**: Applied at route level
   - Prevents abuse of game creation endpoint

### Data Integrity

- User validation happens before game creation
- No implicit user creation during game initialization
- Clear error messages if user doesn't exist
- Foreign key constraints could be added in future (currently uses application-level validation)
