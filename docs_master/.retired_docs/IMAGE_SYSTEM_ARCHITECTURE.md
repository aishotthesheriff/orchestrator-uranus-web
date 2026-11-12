# Image Generation System Architecture & Execution Flow

**Audience**: Architects and engineers tracing execution flow

**Last Updated**: 2025-01-27

## Overview

The image generation system is a multi-layered architecture that handles template selection, file storage, asynchronous job processing, and cache cleanup. The system integrates with the game engine to automatically generate visual representations of game scenes.

## Component Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Game Engine / Routes                      │
│  (gameLogic.ts, routes.ts)                                   │
└──────────────┬───────────────────────────────────────────────┘
               │
               │ 1. Template Selection
               ▼
┌─────────────────────────────────────────────────────────────┐
│              imageTemplate.ts                                │
│  • selectImageTemplate(state, event) → templateName         │
│  • mapIntentToSkill(intent) → skillName                     │
└──────────────┬───────────────────────────────────────────────┘
               │
               │ 2. Create Image Job
               ▼
┌─────────────────────────────────────────────────────────────┐
│              storage.ts (DatabaseStorage)                    │
│  • createImageJob() → ImageJob                               │
│  • getPendingImageJobs() → ImageJob[]                        │
└──────────────┬───────────────────────────────────────────────┘
               │
               │ 3. Job Processing (Async Queue)
               ▼
┌─────────────────────────────────────────────────────────────┐
│              imageJobProcessor.ts                            │
│  • ImageJobProcessor.processJob()                            │
│    ├─ Check Cache (aiService.checkImageCache)               │
│    ├─ Generate if Miss (aiService.generateImage)           │
│    ├─ Save to Storage (imageStorage.saveImageToFile)         │
│    └─ Update Game State                                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               │ 4. File Operations
               ▼
┌─────────────────────────────────────────────────────────────┐
│              imageStorage.ts                                 │
│  • saveImageToFile(base64, metadata) → filePath             │
│  • loadImageFromFile(filePath) → base64                     │
│  • deleteImageFile(filePath)                                 │
│  • getStorageStats() → StorageStats                          │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              imageCacheCleanup.ts                            │
│  • cleanupOldImages() → deletedCount                         │
│  • Runs daily at 2 AM (scheduled)                           │
└───────────────────────────────────────────────────────────────┘
```

---

## PCE Integration: Image Prompt Handling

When PCE (Prompt Composition Engine) is enabled, image generation prioritizes stored `turn.imagePrompt` over template-based prompts:

**Priority Order** (in `buildImagePromptContext()`):
1. **PCE Path**: If `turn.imagePrompt` exists, use it directly
   - `promptSource: 'pce'`
   - `effectiveTemplateName: 'pce_turn'`
   - Prompt is already optimized for the selected image model (includes trigger words, style modifiers)
   - No additional variable substitution needed

2. **Template Path**: If `turn.imagePrompt` is missing (legacy turn or error)
   - Uses named template (e.g., `'day_launch'`, `'general_scene'`)
   - `promptSource: 'template'`
   - Variables interpolated from game state

**Code Reference**: `server/aiService.ts` → `buildImagePromptContext()`

**Note**: The `promptSource` field is included in image job results and WebSocket events for observability and cache key generation.

---

## Component Details

### 1. `imageTemplate.ts` - Template Selection Logic

**Purpose**: Determines which image template to use based on game state and events.

**Key Functions**:

```typescript
selectImageTemplate(state: GameState, event?: any): string
```

**Selection Priority** (executed in order):
1. **Segment-based**: 
   - `state.segment === 'Launch from Earth'` → `'day_launch'`
   - `state.segment === 'Arrival on Uranus'` → `'day_arrival'`
2. **Event-based** (if `event` provided):
   - `tags.includes('technical')` → `'technical_problem'`
   - `tags.includes('cosmic')` → `'cosmic_encounter'`
   - `tags.includes('crisis')` → `'crisis_moment'`
3. **Content-based** (narrative analysis):
   - Last narrative contains `'crew'` AND `'yell'` → `'character_interaction'`
4. **Default fallback**: `'general_scene'`

**Dependencies**:
- `@shared/schema` - `GameState`, `Intent` types

**Usage Context**:
- Called from `gameLogic.ts` when processing turns
- Template name is used to create image jobs via `storage.createImageJob()`

---

### 2. `imageStorage.ts` - File System Operations

**Purpose**: Manages physical file storage for generated images on the filesystem.

**Storage Location**: `{process.cwd()}/generated_images/`

**Key Functions**:

#### `saveImageToFile(base64Data: string, metadata: ImageMetadata)`
- Converts base64 to buffer
- Generates filename: `{templateName}_{promptHash}_{uuid}.png`
- Writes to filesystem
- Returns: `{ filePath, fileSize }`

**Filename Format**:
```
{templateName}_{promptHash_first8chars}_{uuid_first8chars}.png
```

**Example**: `day_launch_25f353c7_8a02795f.png`

#### `loadImageFromFile(filePath: string)`
- Reads file from disk
- Converts buffer to base64 data URL
- Returns: `data:image/png;base64,{base64Content}`

#### `deleteImageFile(filePath: string)`
- Deletes file from filesystem
- Gracefully handles ENOENT (file not found)

#### `getStorageStats()`
- Scans `generated_images/` directory
- Returns aggregate statistics:
  - Total file count
  - Total size in bytes
  - Average file size
  - Oldest/newest file timestamps

#### `cleanupOrphanedFiles(validFilePaths: string[])`
- Compares filesystem files with valid references
- Deletes files not in `validFilePaths` list
- Used for maintenance operations

**Dependencies**:
- `fs/promises` - File system operations
- `path` - Path manipulation
- `crypto` - UUID generation

**Error Handling**:
- File operations include try/catch with descriptive error messages
- Non-existent files are handled gracefully (ENOENT ignored)

---

### 3. `imageJobProcessor.ts` - Asynchronous Job Queue Processor

**Purpose**: Processes image generation jobs asynchronously from a queue. Handles cache checking, image generation, database updates, and WebSocket notifications.

**Architecture Pattern**: Polling-based queue processor with interval-based execution.

#### Class: `ImageJobProcessor`

**Constructor**:
```typescript
constructor(io: SocketIOServer)
```
- Requires Socket.IO server instance for client notifications

**Key Methods**:

##### `start(intervalMs = 1000)`
- Starts polling loop (default: 1 second interval)
- Fetches pending jobs from database
- Processes jobs sequentially (up to 5 per cycle)

##### `stop()`
- Clears polling interval
- Stops processing

##### `processPendingJobs()` (private)
- Fetches up to 5 pending jobs: `storage.getPendingImageJobs(5)`
- Updates metrics: `queueDepthImage.set(pendingJobs.length)`
- Processes each job via `processJob()`
- Prevents concurrent execution with `processing` flag

##### `processJob(job: ImageJob)` (private)

**Execution Flow**:

```
1. Start performance timer
2. Mark job as 'processing' in database
3. Load game state: storage.getGameState(job.gameId)
4. Load user preferences: storage.getUserByUsername()
5. Cache Check Phase:
   ├─ aiService.checkImageCache()
   │  ├─ Exact match lookup (promptHash + variablesHash)
   │  └─ Similar scene matching (if no exact match)
   └─ If cache hit:
      ├─ Convert database filePath to static URL: /generated_images/{filename}
      └─ Increment imageCacheHits metric
6. Cache Miss Phase (if no cache hit):
   ├─ aiService.generateImage()
   │  ├─ buildImagePromptContext()
   │  │  ├─ Checks turn.imagePrompt first (PCE path)
   │  │  │  └─ If present: uses directly (promptSource: 'pce', effectiveTemplateName: 'pce_turn')
   │  │  └─ If missing: uses template with variables (promptSource: 'template')
   │  ├─ Generate image via provider
   │  ├─ Save to file: imageStorage.saveImageToFile()
   │  └─ Save metadata to database (includes promptSource)
   └─ Convert data URL to static path
   └─ Increment imageCacheMisses metric
7. Update Job Status:
   ├─ Update job: status='completed', imageUrl, imageTemplate
   └─ Update game state turn with imageUrl (transactional)
8. Notify Client:
   └─ io.to(gameId).emit('imageReady', { jobId, gameId, turnNumber, imageUrl, imageTemplate, promptSource })
9. Error Handling:
   └─ On error: mark job as 'failed', emit 'imageFailed' event
```

**Cache Resolution Strategy**:

When `checkImageCache()` returns a result (cache hit):
1. Extract `promptHash` and `variablesHash` from computed keys
2. Look up image record: `storage.getGeneratedImageByHash(promptHash, variablesHash)`
3. If not found, fall back to similarity search:
   - Get all images for template: `storage.getGeneratedImagesByTemplate()`
   - Generate scene fingerprint
   - Find similar scenes (threshold: 0.85)
   - Use best match
4. Convert `filePath` from database to static URL: `/generated_images/{basename}`

**URL Format Conversion**:
- Database stores: `/full/path/to/generated_images/file.png`
- Static URL served: `/generated_images/file.png`
- Client receives: `http://server/generated_images/file.png`

**Game State Updates**:
- Uses `storage.processTurnWithTransaction()` for atomic updates
- Prevents race conditions with row-level locking
- Updates turn object: `turn.imageUrl`, `turn.imageTemplate`, `turn.imageStatus`
- Clears `turn.imageJobId` after completion

**Metrics Tracked**:
- `imageJobDuration` - Processing time histogram
- `imageJobsCompleted` - Success counter
- `imageJobsFailed` - Failure counter
- `queueDepthImage` - Queue length gauge
- `imageCacheHits` - Cache hit counter
- `imageCacheMisses` - Cache miss counter

**Dependencies**:
- `storage` - Database operations
- `aiService` - `checkImageCache()`, `generateImage()`, `computeImageKeys()`
- `cacheUtils` - `generatePromptHash()`, `generateVariablesHash()`, `generateSceneFingerprint()`, `findSimilarScenes()`
- `imageStorage` - File operations (indirectly via aiService)
- `path` - Path manipulation
- `metrics` - Prometheus metrics

**WebSocket Events Emitted**:
- `imageReady` - Job completed successfully
- `imageFailed` - Job failed with error

**Client Event Format**:
```typescript
// Success
{
  jobId: string;
  gameId: string;
  turnNumber: number;
  imageUrl: string;  // Static URL: /generated_images/{filename}
  imageTemplate: string;
  promptSource: 'pce' | 'template';
}

// Failure
{
  jobId: string;
  gameId: string;
  turnNumber: number;
  error: string;
}
```

---

### 4. `imageCacheCleanup.ts` - Automated Cache Maintenance

**Purpose**: Periodically cleans up old or rarely-accessed images from the cache to manage storage growth.

**Architecture Pattern**: Scheduled task with configurable retention policy.

#### Class: `ImageCacheCleanup`

**Key Methods**:

##### `getRetentionPolicy()`
- Reads settings from database:
  - `image_cache_retention_days` (default: 30)
  - `image_cache_min_access_count` (default: 5)
- Returns retention policy configuration

##### `cleanupOldImages()`
**Deletion Criteria**:
- Images older than `retentionDays`
- AND accessed fewer than `minAccessCount` times

**Execution**:
1. Calculate cutoff date: `now - retentionDays`
2. Call `storage.deleteGeneratedImages()` with filters:
   ```typescript
   {
     before: cutoffDate,
     maxAccessCount: minAccessCount
   }
   ```
3. Returns count of deleted images

##### `start()`
- Runs cleanup check every hour
- Executes cleanup if current hour is 2 AM
- Schedules: `setInterval(..., 60 * 60 * 1000)`

##### `stop()`
- Clears interval
- Stops scheduled cleanup

**Retention Policy Logic**:
- Images must meet BOTH criteria to be deleted:
  - Created before cutoff date (age threshold)
  - Access count ≤ minAccessCount (popularity threshold)
- Popular images (high access count) are preserved regardless of age
- Recent images (newer than retention period) are preserved regardless of access count

**Dependencies**:
- `storage` - Database operations, settings retrieval

**Configuration**:
- Settings are stored in `app_settings` table
- Can be updated via admin interface or database directly

---

## Intro Turn Special Handling

**Important Difference**: Intro turns (Turn 0) check image cache **synchronously** during turn creation, unlike regular turns which always create asynchronous jobs.

**Intro Turn Flow** (`server/gameLogic.ts` → `processIntroTurn()`):
1. Turn created with narrative and `imagePrompt` (from PCE)
2. **Synchronous cache check**: `checkImageCache()` called immediately
3. If cache hit: `turn.imageUrl` set directly (no job created)
4. If cache miss: Image job created and processed asynchronously

**Regular Turn Flow** (`server/turnJobProcessor.ts`):
1. Turn processed, narrative generated
2. Image job **always created** (no immediate cache check)
3. Job processed asynchronously by `ImageJobProcessor`

**Rationale**: Intro turn needs to be display-ready immediately when game starts, so synchronous cache check avoids showing a placeholder image if the cache is available.

---

## Execution Flow Traces

### Flow 1: Job Creation (Turn Processing Completion)

```
[turnJobProcessor.ts: processJob()]
  │
  ├─ processTurnLogic(state, action)
  │  └─ [Turn narrative generated, stats updated, etc.]
  │
  ├─ selectImageTemplate(updatedState, null)
  │  ├─ Checks state.segment
  │  ├─ Checks last narrative content
  │  └─ Returns: 'day_launch' (example)
  │
  ├─ storage.createImageJob({
  │     gameId: 'abc123',
  │     turnNumber: 5,
  │     templateName: 'day_launch',
  │     status: 'pending'
  │   })
  │  └─ Returns: ImageJob { id: 'job1', ... }
  │
  ├─ lastTurn.imageJobId = 'job1'
  ├─ lastTurn.imageStatus = 'pending'
  └─ storage.updateGameState(...)  // Persist job reference
```

### Flow 2: Automatic Image Generation (Job Processing)

```
[ImageJobProcessor - Polling Loop]
  │
  ├─ storage.getPendingImageJobs(5)
  │  └─ Returns: [ImageJob { id: 'job1', ... }]
  │
  ├─ processJob(job1)
  │  │
  │  ├─ storage.getGameState('abc123')
  │  ├─ storage.getUserByUsername('player')
  │  │
  │  ├─ checkImageCache('day_launch', gameState, userPreferences)
  │  │  ├─ computeImageKeys() → { promptHash, variablesHash, ... }
  │  │  ├─ storage.getGeneratedImageByHash(promptHash, variablesHash)
  │  │  └─ [Cache Miss]
  │  │
   │  ├─ generateImage('day_launch', gameState, userPreferences)
   │  │  ├─ buildImagePromptContext()
   │  │  │  ├─ Checks turn.imagePrompt (PCE path if available)
   │  │  │  └─ Falls back to template path if missing
   │  │  ├─ generateWithModelKey(modelKey, prompt, size, quality, ...)
  │  │  ├─ [Provider returns base64 image]
  │  │  ├─ saveImageToFile(base64, metadata)
  │  │  │  ├─ Buffer.from(base64Content, 'base64')
  │  │  │  ├─ fs.writeFile(filePath, buffer)
  │  │  │  └─ Returns: { filePath: '/path/to/day_launch_abc123_xyz.png', fileSize: 245760 }
  │  │  ├─ storage.createGeneratedImage({ filePath, promptHash, ... })
  │  │  └─ Returns: { imageUrl: 'data:image/png;base64,...', ... }
  │  │
  │  ├─ Convert data URL to static path
  │  │  ├─ storage.getGeneratedImageByHash(promptHash, variablesHash)
  │  │  └─ result.imageUrl = '/generated_images/day_launch_abc123_xyz.png'
  │  │
  │  ├─ storage.updateImageJob(job1, {
  │  │     status: 'completed',
  │  │     imageUrl: '/generated_images/day_launch_abc123_xyz.png',
  │  │     completedAt: new Date()
  │  │   })
  │  │
  │  ├─ storage.processTurnWithTransaction('abc123', async (state) => {
  │  │     turn.imageUrl = '/generated_images/day_launch_abc123_xyz.png'
  │  │     turn.imageTemplate = 'day_launch'
  │  │     return state
  │  │   })
  │  │
   │  └─ io.to('abc123').emit('imageReady', {
   │       jobId: 'job1',
   │       gameId: 'abc123',
   │       turnNumber: 5,
   │       imageUrl: '/generated_images/day_launch_abc123_xyz.png',
   │       imageTemplate: 'day_launch' (or 'pce_turn' if PCE),
   │       promptSource: 'pce' | 'template'
   │     })
```

### Flow 3: Cache Hit Scenario

```
[ImageJobProcessor.processJob()]
  │
  ├─ checkImageCache('day_launch', gameState, userPreferences)
  │  ├─ computeImageKeys() → { promptHash: 'abc123', variablesHash: 'def456', ... }
  │  ├─ storage.getGeneratedImageByHash('abc123', 'def456')
  │  │  └─ Returns: GeneratedImage {
  │  │       id: 'img1',
  │  │       filePath: '/full/path/to/day_launch_abc123_xyz.png',
  │  │       promptHash: 'abc123',
  │  │       variablesHash: 'def456',
  │  │       ...
  │  │     }
  │  ├─ storage.updateImageAccess('img1')  // Increment accessCount
  │  ├─ loadImageFromFile('/full/path/to/day_launch_abc123_xyz.png')
  │  │  └─ Returns: 'data:image/png;base64,...'
  │  └─ Returns: { imageUrl: 'data:image/png;base64,...', ... }
  │
  ├─ Convert to static URL
  │  ├─ path.basename(cachedImage.filePath) → 'day_launch_abc123_xyz.png'
  │  └─ result.imageUrl = '/generated_images/day_launch_abc123_xyz.png'
  │
  ├─ imageCacheHits.inc()
  └─ [Continue with job update and notification]
```

### Flow 4: Similar Scene Matching (Cache Hit Alternative)

```
[ImageJobProcessor.processJob()]
  │
  ├─ checkImageCache('day_launch', gameState, userPreferences)
  │  ├─ computeImageKeys() → { promptHash: 'abc123', variablesHash: 'def456', ... }
  │  ├─ storage.getGeneratedImageByHash('abc123', 'def456')
  │  │  └─ Returns: undefined  // No exact match
  │  │
  │  ├─ storage.getGeneratedImagesByTemplate('day_launch')
  │  │  └─ Returns: [GeneratedImage {...}, GeneratedImage {...}, ...]
  │  │
  │  ├─ generateSceneFingerprint(templateName, gameState, variables, settings, ...)
  │  │  └─ Returns: SceneFingerprint { segment, day, stats, ... }
  │  │
  │  ├─ findSimilarScenes(targetFingerprint, candidateFingerprints, 0.85)
  │  │  ├─ For each candidate:
  │  │  │  ├─ calculateSceneSimilarity(target, candidate)
  │  │  │  │  ├─ Weighted comparison of segment, day, stats, variables
  │  │  │  │  └─ Returns: similarity score (0.0 - 1.0)
  │  │  │  └─ Filter: score >= 0.85
  │  │  └─ Returns: [{ fingerprint: {...}, similarity: {...} }, ...] sorted by score
  │  │
  │  ├─ [Best match found: similarity = 0.87]
  │  ├─ storage.updateImageAccess(matchedImage.id)
  │  ├─ loadImageFromFile(matchedImage.filePath)
  │  └─ Returns: { imageUrl: 'data:image/png;base64,...', ... }
  │
  └─ [Continue with URL conversion and job update]
```

### Flow 5: Cache Cleanup (Scheduled Task)

```
[ImageCacheCleanup.start()]
  │
  └─ setInterval(async () => {
      if (new Date().getHours() === 2) {
        │
        ├─ getRetentionPolicy()
        │  ├─ storage.getSetting('image_cache_retention_days') → 30
        │  ├─ storage.getSetting('image_cache_min_access_count') → 5
        │  └─ Returns: { retentionDays: 30, minAccessCount: 5 }
        │
        ├─ cleanupOldImages()
        │  ├─ cutoffDate = now - 30 days
        │  ├─ storage.deleteGeneratedImages({
        │  │     before: cutoffDate,
        │  │     maxAccessCount: 5
        │  │   })
        │  │  └─ SQL: DELETE FROM generated_images
        │  │         WHERE created_at < cutoffDate
        │  │         AND access_count <= 5
        │  │  └─ Returns: 15 (deleted count)
        │  │
        │  └─ console.log('Image cache cleanup: deleted 15 images...')
      }
    }, 60 * 60 * 1000)  // Every hour
```

---

## Data Structures

### `ImageMetadata` (imageStorage.ts)
```typescript
{
  templateName: string;
  promptHash: string;
  variablesHash: string;
  gameId?: string;
  turnNumber?: number;
  generatedAt: Date;
}
```

### `ImageJob` (from @shared/schema)
```typescript
{
  id: string;
  gameId: string;
  templateName: string;
  turnNumber: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  imageUrl?: string;
  imageTemplate?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

### `StorageStats` (imageStorage.ts)
```typescript
{
  totalFiles: number;
  totalSizeBytes: number;
  averageFileSize: number;
  oldestFile: Date | null;
  newestFile: Date | null;
}
```

---

## Dependencies Graph

```
imageTemplate.ts
  └─ @shared/schema (GameState, Intent)

imageStorage.ts
  └─ fs/promises, path, crypto

imageJobProcessor.ts
  ├─ storage (DatabaseStorage)
  ├─ aiService (checkImageCache, generateImage, computeImageKeys)
  ├─ cacheUtils (generatePromptHash, generateVariablesHash, generateSceneFingerprint, findSimilarScenes)
  ├─ imageStorage (indirectly via aiService)
  ├─ path
  ├─ metrics (Prometheus)
  └─ Socket.IO Server

imageCacheCleanup.ts
  └─ storage (DatabaseStorage)
```

---

## Key Design Patterns

### 1. **Queue-Based Asynchronous Processing**
- Jobs are persisted to database before processing
- Polling-based processor avoids complexity of message queues
- Sequential processing prevents resource exhaustion

### 2. **Cache-First Strategy**
- Always check cache before generating
- Multi-level cache: exact match → similarity match → generation
- Reduces API costs and improves response time

### 3. **Transaction-Based State Updates**
- Game state updates use database transactions
- Row-level locking prevents race conditions
- Atomic updates ensure consistency

### 4. **URL Format Conversion**
- Internal storage uses full file paths
- Client-facing URLs use static path format
- Conversion happens at job completion time

### 5. **Similarity-Based Caching**
- Scene fingerprints capture semantic meaning
- Weighted scoring enables fuzzy matching
- Threshold-based filtering (0.85) balances reuse vs. accuracy

### 6. **Retention Policy Management**
- Age-based deletion (older than N days)
- Popularity-based preservation (high access count)
- Configurable via database settings

---

## Error Handling

### ImageJobProcessor Errors

**Job Processing Failures**:
- Game not found → Mark job as 'failed', emit 'imageFailed'
- Image generation failure → Mark job as 'failed', emit 'imageFailed'
- File system errors → Logged, job marked as 'failed'

**Cache Resolution Failures**:
- Missing file path → Fallback to data URL, log warning
- Database inconsistency → Attempt similarity search, fallback if needed

### imageStorage Errors

**File Operations**:
- `ENOENT` (file not found) → Gracefully ignored (for delete operations)
- Other errors → Thrown with descriptive messages

### imageCacheCleanup Errors

**Cleanup Failures**:
- Database errors → Logged, cleanup skipped
- Settings missing → Use defaults (30 days, 5 accesses)

---

## Performance Considerations

### Job Processing
- **Batch Size**: 5 jobs per polling cycle (configurable via `getPendingImageJobs(5)`)
- **Polling Interval**: 1 second default (configurable via `start(intervalMs)`)
- **Concurrency**: Single job at a time (prevents resource exhaustion)
- **Metrics**: Tracked via Prometheus for monitoring

### Cache Lookup
- **Exact Match**: O(1) database lookup (indexed hash columns)
- **Similarity Match**: O(n) where n = images for template
- **Threshold**: 0.85 similarity score for acceptable matches

### File Operations
- **Synchronous I/O**: Uses `fs/promises` for async file operations
- **Base64 Conversion**: Happens in memory (watch for large images)
- **Directory Scanning**: Used for stats and cleanup (can be slow for large directories)

---

## Initialization & Startup

### Server Startup (routes.ts)

The image processing system is initialized during server startup:

```typescript
// Create Socket.IO server
const io = new SocketIOServer(httpServer, { cors: {...} });

// Start image job processor
const imageProcessor = new ImageJobProcessor(io);
imageProcessor.start();  // Default: 1 second polling interval

// Start cleanup service
const cleanupService = new ImageCacheCleanup();
cleanupService.start();  // Checks hourly, runs cleanup at 2 AM
```

**Lifecycle**:
1. Server starts → `registerRoutes()` called
2. Socket.IO server created
3. `ImageJobProcessor` instantiated with Socket.IO instance
4. Processor starts polling loop (1 second interval)
5. `ImageCacheCleanup` instantiated and scheduled (hourly checks)
6. System ready to process jobs

**Shutdown**:
- Processors should call `stop()` methods during graceful shutdown
- Currently relies on process termination to stop intervals

---

## Integration Points

### With Game Engine
- `gameLogic.ts` calls `selectImageTemplate()` during turn processing
- Creates image jobs via `storage.createImageJob()`
- Receives image URLs via WebSocket `imageReady` event

### With Turn Processing
- `turnJobProcessor.ts` creates image jobs after processing turns:
  ```typescript
  // After turn processing completes
  const templateName = selectImageTemplate(updatedState, null);
  const imgJob = await storage.createImageJob({
    gameId: updatedState.id,
    turnNumber: updatedState.turnNumber,
    templateName,
    status: 'pending'
  });
  ```
- Turn object stores `imageJobId` reference for tracking

### With AI Service
- `aiService.checkImageCache()` provides cache checking logic
- `aiService.generateImage()` handles image generation
- `aiService.computeImageKeys()` computes cache keys

### With Database
- `storage` provides all database operations
- Image metadata stored in `generated_images` table
- Jobs stored in `image_jobs` table
- Settings stored in `app_settings` table

### With WebSocket
- `ImageJobProcessor` requires Socket.IO server instance
- Emits `imageReady` and `imageFailed` events to game rooms
- Clients subscribe to room via `gameId`

---

## Configuration

### Settings (app_settings table)

| Key | Default | Description |
|-----|---------|-------------|
| `image_cache_retention_days` | 30 | Days before images become eligible for deletion |
| `image_cache_min_access_count` | 5 | Minimum access count to preserve image regardless of age |

### Job Processor Settings

- Polling interval: `start(intervalMs)` - default 1000ms
- Batch size: `getPendingImageJobs(limit)` - default 5

### Storage Location

- Directory: `{process.cwd()}/generated_images/`
- Filename format: `{templateName}_{promptHash}_{uuid}.png`

---

## Monitoring & Metrics

### Prometheus Metrics

- `imageJobDuration` - Histogram of job processing times
- `imageJobsCompleted` - Counter of successful jobs
- `imageJobsFailed` - Counter of failed jobs
- `queueDepthImage` - Gauge of pending jobs in queue
- `imageCacheHits` - Counter of cache hits
- `imageCacheMisses` - Counter of cache misses

### Logging

- Job lifecycle: Processing, completion, failure
- Cache operations: Hits, misses, similarity matches
- Cleanup operations: Deletion counts and retention policy
- Errors: Full stack traces with context

---

## Future Considerations

### Scalability
- Current polling approach may not scale to high job volumes
- Consider message queue (Redis, RabbitMQ) for distributed processing
- File storage may need object storage (S3, Azure Blob) for cloud deployments

### Cache Efficiency
- Current similarity threshold (0.85) may need tuning
- Consider LRU eviction in addition to age/popularity
- Metadata indexing could improve similarity search performance

### Error Recovery
- Failed jobs could implement retry logic with exponential backoff
- Partial failures (generation succeeds, database update fails) need better handling
- Dead letter queue for permanently failed jobs

---

## References

- **AI Service**: `docs_master/AI_SERVICES.md` - Image generation details
- **Database Schema**: `docs_master/DATABASE_ARCHITECTURE.md` - Table structures
- **Cache Utilities**: `server/cacheUtils.ts` - Fingerprint and similarity logic
- **Game Logic**: `server/gameLogic.ts` - Turn processing and job creation

