# Intro Process Workflow Diagram

This document diagrams the complete workflow that occurs when a user clicks "START NEW VOYAGE" on the Main Menu, including all steps, API calls, database operations, async jobs, and background processes.

## Overview

The intro process initializes a new game, generates the opening narrative, creates action choices, and optionally processes scene images. The entire process is synchronous from the user's perspective but involves multiple async operations, database transactions, and potentially background job processing.

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
                              │ Validate with Zod schema
                              │ insertGameStateSchema.parse({ ...req.body, username })
                              ▼
        ┌─────────────────────────────────────┐
        │ initializeNewGame(validated)         │
        │ gameInitialization.ts                │
        └─────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌───────────────────────────┐            ┌──────────────────────────┐
│ buildInitialGameState()  │            │ ensureUser(username)     │
│                           │            │ storage.ts               │
│ - Generate gameId (UUID)  │            │                          │
│ - Generate seed (UUID)    │            │ - INSERT INTO users      │
│ - day: 1                  │            │   (with unique constraint│
│ - turnNumber: 0           │            │    handling)             │
│ - segment: getSegment(1)  │            │                          │
│ - stats: all 100          │            │ - Returns User record    │
│ - weirdness: 0            │            └──────────────────────────┘
│ - Load NPCs from ref      │                        │
│   (getInitialNpcs)        │                        │
│ - Default equipped items   │                        │
│   ['red_tape',            │                        │
│    'universal_allen_key', │                        │
│    'nebula_freshener']    │                        │
└───────────────────────────┘                        │
        │                                           │
        └─────────────────────┬─────────────────────┘
                              │
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
        │   summary: string,                  │
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
        │ res.json(initialState)               │
        │                                     │
        │ Returns complete GameState to client │
        └─────────────────────────────────────┘
                              │
                              │ HTTP 200 Response
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: MainMenuPage.tsx                                                    │
│                                                                             │
│ startGameMutation.onSuccess()                                              │
│ - queryClient.setQueryData([`/api/game/${data.id}`], data)                │
│ - setLocation(`/game/${data.id}`)                                          │
│                                                                             │
│ └─> Navigate to GamePage                                                   │
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
        │ ImageJobProcessor                    │
        │ imageJobProcessor.ts                 │
        │                                     │
        │ - Runs on interval (default 1s)     │
        │ - Polls for pending image jobs      │
        └─────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ SELECT FROM          │
                  │ image_jobs           │
                  │ WHERE status =       │
                  │ 'pending'            │
                  │ LIMIT 1              │
                  └───────────────────────┘
                              │
                              │ (If job found)
                              ▼
        ┌─────────────────────────────────────┐
        │ processJob(job: ImageJob)           │
        │                                     │
        │ 1. Update job status: 'processing'  │
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
        │ Note: On failure, emits 'imageFailed'│
        │   {                                 │
        │     jobId,                          │
        │     gameId,                         │
        │     turnNumber,                     │
        │     error                           │
        │   }                                 │
        │ )                                   │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Client receives image update]

```

---

## Detailed Step Breakdown

### 1. Client Click Handler

**File**: `client/src/pages/MainMenuPage.tsx`

- **Function**: `handleStartNewVoyage()` (line 252)
- **Action**: Calls `startGameMutation.mutate()`
- **HTTP Request**: `POST /api/game/start` with `{ username }`

### 2. Server Route Handler

**File**: `server/routes.ts` (line 31)

**Steps:**
1. **Auth Check**: `requireAuth` middleware validates session
2. **Rate Limit**: `gameStartRateLimit` middleware checks rate limits
3. **Validation**: `insertGameStateSchema.parse()` validates input
4. **Initialize**: Calls `initializeNewGame(validated)`

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

2. `storage.ensureUser(username)` - Creates user record if needed
   - `INSERT INTO users` with unique constraint handling
   - Handles race conditions gracefully

3. `storage.createGameState(initialState)` - Persists game to database
   - `INSERT INTO games` with all state as JSON

4. `processTurnWithTransaction()` - Processes intro turn
   - Wrapped in database transaction with row locking

### 4. Transaction Processing

**File**: `server/storage.ts` (line 1164)

**Function**: `processTurnWithTransaction()`

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
1. **Polling**: Runs every 1 second (configurable)
2. **Query**: `SELECT FROM image_jobs WHERE status='pending' LIMIT 1`
3. **Process Job**:
   - Update status to 'processing'
   - Load game state
   - Load user preferences
   - Check cache again (may have been cached while pending)
   - If still miss, call `generateImage()` to create new image
   - Save image to disk and database
4. **Update Turn**: Use transaction to update turn with image URL
5. **Notify Client**: Emit Socket.IO event `imageReady` on success (with payload: `{ jobId, gameId, turnNumber, imageUrl, imageTemplate, promptSource }`) or `imageFailed` on failure (with payload: `{ jobId, gameId, turnNumber, error }`)

**Standard Socket Events**:
- `turnComplete`: `{ gameId: string, turnNumber: number }` - Turn processing finished
- `imageReady`: `{ jobId: string, gameId: string, turnNumber: number, imageUrl: string, imageTemplate: string, promptSource: 'pce' | 'template' }` - Scene image generated successfully
- `imageFailed`: `{ jobId: string, gameId: string, turnNumber: number, error: string }` - Image generation failed

---

## Async Operations & Jobs

### Synchronous (User-Facing)

- All steps through `processTurnWithTransaction()` completion
- Game state returned to client immediately
- User can start interacting with game

### Asynchronous (Background)

1. **Image Generation** (if not cached):
   - Created as pending job
   - Processed by `ImageJobProcessor`
   - Client notified via Socket.IO when complete

2. **LLM API Calls**:
   - `generateTurnContentWithFlag()` - OpenAI API call (synchronous in request)
   - `generateActions()` - OpenAI API call (synchronous in request)

### Database Transactions

- **Game Creation**: Single transaction
- **Intro Turn Processing**: Wrapped in `processTurnWithTransaction()` with row locking
- **Image Job Updates**: Separate transaction when image completes

### Rate Limiting

- `gameStartRateLimit` middleware on `/api/game/start` endpoint
- Prevents rapid game creation

---

## Error Handling

### Client Side

- `startGameMutation.onError()` displays toast notification
- Mutation disabled while pending to prevent duplicate requests

### Server Side

- Transaction rollback on any error in `processTurnWithTransaction()`
- Try-catch around image processing (errors logged, don't fail turn)
- Fallback actions if action generation fails
- Graceful handling of missing cache entries

---

## State Flow Summary

```
Initial State (empty)
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
[Background] Image Job → Process image if needed
  ↓
[Background] Update Turn → Image URL added to turn
```

---

## Key Functions Reference

| Function | File | Purpose |
|----------|------|---------|
| `handleStartNewVoyage()` | `client/src/pages/MainMenuPage.tsx:252` | Client click handler |
| `initializeNewGame()` | `server/gameInitialization.ts:61` | Main initialization entry |
| `buildInitialGameState()` | `server/gameInitialization.ts:32` | Create initial state object |
| `processTurnWithTransaction()` | `server/gameLogic.ts:475` | Transaction wrapper |
| `processTurnLogic()` | `server/gameLogic.ts:269` | Main turn processing logic |
| `processIntroTurn()` | `server/gameLogic.ts:136` | Intro turn specific logic |
| `generateTurnContentWithFlag()` | `server/aiService.ts:1118` | Content generation router |
| `generateActions()` | `server/aiService.ts:1188` | Action generation |
| `checkImageCache()` | `server/aiService.ts:1712` | Image cache lookup |
| `createImageJob()` | `server/storage.ts:1247` | Create background image job |
| `ImageJobProcessor.processJob()` | `server/imageJobProcessor.ts:52` | Background image processing |

---

## Timing Estimates

- **Client Request → Response**: ~2-10 seconds (depends on LLM API latency)
- **Image Job Processing**: ~5-30 seconds (if not cached, depends on image API)
- **Total User Experience**: Immediate game availability, image loads later if needed

---

## Dependencies

### External APIs
- OpenAI GPT-4o (for narrative generation)
- OpenAI GPT-4o-mini (for action generation)
- OpenAI DALL-E / Replicate (for image generation, if needed)

### Database Tables
- `users` - User records
- `games` - Game state storage
- `image_jobs` - Background image processing queue
- `generated_images` - Cached image metadata

### Internal Services
- Reference data loader (`getCurrentReference()`)
- PCE system (if enabled)
- Image template system
- Cache utilities

