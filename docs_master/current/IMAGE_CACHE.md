# Image Cache System Documentation

## Context & Overview

### Purpose

The Image Cache system is a performance optimization layer for the Quest to Uranus game that reduces AI image generation costs and latency by intelligently reusing previously generated images. Instead of generating a new image for every turn, the system checks for cached images that match the current scene context, dramatically reducing API calls to image generation providers (e.g., OpenAI DALL-E).

### Why It Exists

Image generation is one of the most expensive and time-consuming operations in the game pipeline:
- **Cost**: Each image generation costs money (API fees to providers)
- **Latency**: Image generation typically takes 5-15 seconds per image
- **User Experience**: Players expect responsive gameplay; waiting for images degrades experience
- **Scalability**: As player count grows, uncached image generation becomes prohibitively expensive

The cache system addresses these concerns by:
1. **Exact Matching**: Reusing images when prompts and variables are identical
2. **Similarity Matching**: Reusing images for similar scenes (e.g., same narrative context, similar game state)
3. **Access Tracking**: Maintaining usage statistics to inform cleanup policies
4. **Automatic Cleanup**: Removing stale or rarely-used images to manage storage

### System Integration

The Image Cache integrates with the broader game architecture as part of the **Image Processor Agent** (see `AGENTS.md`). It operates in the image generation pipeline:

```
Turn Processing → Image Prompt Generation → Cache Check → [Cache Hit: Return] OR [Cache Miss: Generate & Store]
```

The cache is consulted during:
- **Turn Processing**: When `processTurnImage` checks for cached metadata
- **Image Worker**: When `ImageWorker` processes queued image jobs
- **Image Job Processor**: When processing image generation requests

**Related:** For a standalone batch pipeline that generates images from a JSON file (no game DB; may copy reference from `releases/current`), see [`IMAGE_PREGENERATION_PIPELINE.md`](IMAGE_PREGENERATION_PIPELINE.md).

---

## Technical Details

### Architecture Components

#### 1. Cache Storage Layer

**Location**: `server/storage.ts`

The cache uses PostgreSQL for metadata storage and the filesystem for image files:

**Database Table**: `generated_images`
- **Primary Keys**: `prompt_hash` + `variables_hash` (for exact matches)
- **Indexes**: Template name, game ID, access timestamps for efficient queries
- **Metadata**: Stores scene fingerprints, generation settings, access counts

**File Storage**: `generated_images/` directory
- Images stored as PNG files with UUID-based filenames
- Filenames include template name and hash prefix for debugging
- Managed by `server/imageStorage.ts`

**Key Storage Methods**:
```typescript
// Exact hash lookup (fastest)
getGeneratedImageByHash(promptHash: string, variablesHash: string): Promise<GeneratedImage | undefined>

// Template-based lookup (for similarity matching)
getGeneratedImagesByTemplate(templateName: string): Promise<GeneratedImage[]>

// Access tracking
updateImageAccess(id: string): Promise<void>

// Cleanup operations
deleteGeneratedImages(filters?: {
  templateName?: string;
  gameId?: string;
  before?: Date;
  maxAccessCount?: number;
}): Promise<number>
```

#### 2. Cache Key Generation

**Location**: `server/cacheUtils.ts`, `server/aiService.ts`

The cache uses two-level hashing for exact matches:

**Prompt Hash**: SHA-256 hash of the final compiled image prompt
```typescript
generatePromptHash(prompt: string): string
```

**Variables Hash**: SHA-256 hash of sorted variable key-value pairs
```typescript
generateVariablesHash(variables: Record<string, any>): string
```

**Why Two Hashes?**
- **Prompt Hash**: Captures the exact text sent to the image model
- **Variables Hash**: Captures the game state context (stats, NPCs, equipped items, etc.)
- Together, they ensure cache hits only when both the prompt AND context are identical

#### 3. Scene Fingerprinting

**Location**: `server/cacheUtils.ts`

For similarity matching (when exact match fails), the system generates a **Scene Fingerprint** that captures the semantic context of a scene:

```typescript
interface SceneFingerprint {
  templateName: string;
  sceneTypes: string[];
  tags: string[];
  narrativeContext: {
    segment: string;
    day: number;
    absurdity: number;
    narrative: string;  // Current turn's narrative text
  };
  gameState: {
    stats: Record<string, number>;  // Hull, oxygen, fuel, etc.
    npcs: string[];                  // Active crew member names
    equippedItems: string[];         // Currently equipped item IDs
  };
  playerAction: string;              // Player's action for this turn
  visualSettings: ImageSettings;     // Size, quality, background, moderation
}
```

**Similarity Calculation**: `calculateSceneSimilarity()`

The system computes similarity scores across multiple dimensions:
- **Action Similarity** (35% weight): Player action text similarity
- **Narrative Similarity** (25% weight): Narrative text similarity
- **Context Similarity** (15% weight): Game state similarity (stats, NPCs, items)
- **Visual Similarity** (15% weight): Image settings similarity
- **Template Match** (10% weight): Same template name

**Threshold**: Images with ≥85% overall similarity are considered reusable.

**Special Handling**:
- Blank/empty player actions always result in cache miss (0.0 similarity) to ensure unique images for generic actions
- Different player actions will have low action similarity, encouraging cache misses for distinct gameplay moments

#### 4. Cache Lookup Flow

**Location**: `server/aiService.ts` → `checkImageCache()`

The cache lookup follows this sequence:

1. **Compute Cache Keys**: Generate `promptHash` and `variablesHash` from current context
2. **Exact Match Check**: Query database for `(promptHash, variablesHash)` match
   - If found: Update access time, return cached image
3. **Similarity Check** (if exact match fails and similarity caching enabled):
   - Load all images for the same template
   - Generate scene fingerprint for current context
   - Calculate similarity scores for all candidates
   - Return best match if similarity ≥ 85%
4. **Cache Miss**: Return `null`, triggering new image generation

**User Preference Override**: 
- If `userPreferences.skipImageCache === true` (system default), cache lookup is skipped entirely
- This allows users to opt-out of caching for testing or unique image generation

#### 5. Image Generation & Storage

**Location**: `server/aiService.ts` → `generateImage()`, `server/imageStorage.ts`

When cache miss occurs:

1. **Generate Image**: Call image provider API (e.g., OpenAI DALL-E)
2. **Save to File**: Convert base64 response to PNG file in `generated_images/`
3. **Store Metadata**: Insert record into `generated_images` table with:
   - File path and size
   - Prompt and variable hashes
   - Scene fingerprint
   - Generation metadata (model, settings, theme, style)
   - Access count initialized to 1

**File Naming Convention**:
```
{templateName}_{promptHashPrefix}_{uuid}.png
```

Example: `pce_generated_a1b2c3d4_e5f6g7h8.png`

#### 6. Cache Cleanup

**Location**: `server/imageCacheCleanup.ts`

Automatic cleanup runs daily at 2 AM to manage storage:

**Retention Policy** (configurable via database settings):
- `image_cache_retention_days`: Default 30 days
- `image_cache_min_access_count`: Default 5 accesses

**Cleanup Criteria**: Images are deleted if:
- Created more than `retentionDays` ago **AND**
- Accessed fewer than `minAccessCount` times

This policy preserves frequently-used images while removing stale or rarely-reused content.

**Manual Cleanup**: The `deleteGeneratedImages()` method supports filters for:
- Template name (delete all images for a specific template)
- Game ID (delete all images for a specific game)
- Date range (delete images older than a date)
- Access count (delete images with low access counts)

---

### Technologies & Frameworks

- **PostgreSQL**: Metadata storage with JSONB for flexible schema
- **Node.js File System (fs/promises)**: File I/O operations
- **Crypto (SHA-256)**: Hash generation for cache keys
- **TypeScript**: Type-safe interfaces and implementations
- **Drizzle ORM**: Database schema definitions and type inference

### Relationships & Interactions

#### Integration Points

1. **Game Logic** (`server/gameLogic.ts`):
   - `processTurnImage()` checks cache before creating image jobs
   - If cache hit: Applies metadata directly to turn (no job needed)
   - If cache miss: Creates image job for async processing

2. **Image Worker** (`server/orchestrator/workers/imageWorker.ts`):
   - Processes queued image jobs
   - Calls `checkImageCache()` before generation
   - Updates game state and emits WebSocket events on completion

3. **Image Job Processor** (`server/imageJobProcessor.ts`):
   - Legacy processor (may be deprecated in favor of ImageWorker)
   - Similar cache-check logic for backward compatibility

4. **URL Conversion** (`server/imageUrl.ts`):
   - `convertImageUrlToStaticPath()` converts data URLs to static file paths
   - Uses cache lookup to find existing file paths for data URLs

#### Data Flow

```
┌─────────────────┐
│  Turn Processing│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ processTurnImage│
└────────┬────────┘
         │
         ├─► Cache Check (checkImageCache)
         │   │
         │   ├─► Exact Match? ──► Return cached image
         │   │
         │   └─► Similarity Match? ──► Return similar image
         │
         └─► Cache Miss ──► Create Image Job
                            │
                            ▼
                    ┌───────────────┐
                    │  Image Worker │
                    └───────┬───────┘
                            │
                            ├─► Generate Image (generateImage)
                            │
                            ├─► Save to File (saveImageToFile)
                            │
                            └─► Store Metadata (createGeneratedImage)
```

### Configurations & Parameters

#### Environment Variables

- `IMAGE_SIMILARITY_CACHE_ENABLED`: Enable/disable similarity matching (default: `true`)
  - Set to `'false'` to disable similarity matching (only exact matches will be used)

#### Database Settings

- `image_cache_retention_days`: Number of days to retain images (default: 30)
- `image_cache_min_access_count`: Minimum access count to preserve images (default: 5)

#### User Preferences

- `skipImageCache`: Boolean flag to bypass cache entirely (default: `true` in system)
  - When `true`: Cache lookup is skipped, always generates new images
  - When `false`: Cache lookup is performed

#### Cache Thresholds

- **Similarity Threshold**: 0.85 (85%) - minimum similarity score for reuse
- **Action Similarity Weight**: 0.35 (35%) - highest weight to encourage unique images for different actions
- **Narrative Similarity Weight**: 0.25 (25%)
- **Context Similarity Weight**: 0.15 (15%)
- **Visual Similarity Weight**: 0.15 (15%)
- **Template Match Weight**: 0.10 (10%)

---

## Practical Guidance

### Step-by-Step: Cache Lookup Flow

1. **Turn Processing Initiates Image Check**:
   ```typescript
   // In gameLogic.ts:processTurnImage()
   const imageMetadata = await prepareTurnImageMetadata(state, turn, userPreferences, turnNumber);
   ```

2. **Compute Cache Keys**:
   ```typescript
   // In aiService.ts:checkImageCache()
   const { promptHash, variablesHash } = await computeImageKeys(
     templateName, gameState, userPreferences, options
   );
   ```

3. **Exact Match Query**:
   ```typescript
   const cachedImage = await storage.getGeneratedImageByHash(promptHash, variablesHash);
   ```

4. **If Exact Match Found**:
   - Update `accessed_at` timestamp
   - Increment `access_count`
   - Load image file from disk
   - Return image URL

5. **If No Exact Match, Try Similarity**:
   ```typescript
   const templateImages = await storage.getGeneratedImagesByTemplate(effectiveTemplateName);
   const sceneFingerprint = generateSceneFingerprint(...);
   const similarScenes = findSimilarScenes(sceneFingerprint, candidateFingerprints, 0.85);
   ```

6. **If Similarity Match Found**:
   - Return best match (highest similarity score)
   - Update access tracking

7. **If No Match**:
   - Return `null`
   - Trigger new image generation

### Code Examples

#### Checking Cache Before Generation

```typescript
// In imageWorker.ts
const skipCache = userPreferences.skipImageCache ?? true;

if (!skipCache) {
  const result = await checkImageCache(
    imagePrompt.trim(),
    gameState,
    userPreferences,
    { turnNumber: job.turnNumber }
  );
  
  if (result) {
    // Cache hit - use cached image
    imageCacheHits.inc();
    return result;
  }
}

// Cache miss - generate new image
const result = await generateImage(imagePrompt.trim(), gameState, userPreferences, {
  turnNumber: job.turnNumber
});
imageCacheMisses.inc();
```

#### Storing New Image in Cache

```typescript
// In aiService.ts:generateImage()
const { filePath, fileSize } = await saveImageToFile(imageUrl, {
  templateName: effectiveTemplateName,
  promptHash,
  variablesHash,
  gameId: gameState.id,
  turnNumber: gameState.turnNumber,
  generatedAt: new Date()
});

await storage.createGeneratedImage({
  templateName: effectiveTemplateName,
  promptHash,
  variablesHash,
  filePath,
  fileSize,
  mimeType: 'image/png',
  sceneFingerprint,
  metadata: {
    variables,
    settings,
    promptUsed: finalPrompt,
    model: modelKeyToUse,
    promptSource,
    theme: themeForMetadata,
    style: styleForMetadata
  },
  promptSource,
  promptText: finalPrompt,
  gameId: gameState.id,
  turnNumber: gameState.turnNumber,
  accessCount: 1
});
```

#### Manual Cache Cleanup

```typescript
// Delete images older than 60 days with fewer than 3 accesses
const deleted = await storage.deleteGeneratedImages({
  before: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
  maxAccessCount: 3
});

console.log(`Deleted ${deleted} stale images`);
```

### Best Practices

1. **Always Check Cache First**: Before generating new images, always call `checkImageCache()` to avoid unnecessary API calls.

2. **Update Access Tracking**: When serving cached images, always call `updateImageAccess()` to maintain accurate usage statistics.

3. **Handle Missing Files Gracefully**: If a cached image record exists but the file is missing (e.g., manual deletion), treat it as a cache miss rather than throwing an error.

4. **Monitor Cache Hit Rates**: Track `imageCacheHits` vs `imageCacheMisses` metrics to understand cache effectiveness.

5. **Tune Similarity Thresholds Carefully**: The 85% threshold balances reuse vs. uniqueness. Lower thresholds increase reuse but may show inappropriate images; higher thresholds reduce reuse but ensure better scene matching.

6. **Respect User Preferences**: Always check `skipImageCache` before performing cache lookups.

7. **Clean Up Orphaned Files**: Periodically run `cleanupOrphanedFiles()` to remove files that aren't referenced in the database.

### Common Patterns

#### Pattern 1: Cache-First Image Resolution

```typescript
async function resolveImage(
  imagePrompt: string,
  gameState: GameState,
  userPreferences: UserPreferences
): Promise<string> {
  // Check cache first
  const cached = await checkImageCache(imagePrompt, gameState, userPreferences);
  if (cached) {
    return cached.imageUrl;
  }
  
  // Generate if cache miss
  const generated = await generateImage(imagePrompt, gameState, userPreferences);
  return generated?.imageUrl || '';
}
```

#### Pattern 2: Batch Cache Warming

```typescript
// Pre-generate images for common scenarios
async function warmCache(commonScenarios: Array<{prompt: string, state: GameState}>) {
  for (const scenario of commonScenarios) {
    await generateImage(scenario.prompt, scenario.state, defaultPreferences);
  }
}
```

#### Pattern 3: Cache Invalidation

```typescript
// Invalidate cache for a specific game
async function invalidateGameCache(gameId: string) {
  await storage.deleteGeneratedImages({ gameId });
}
```

---

## Troubleshooting & Support

### Common Issues

#### Issue 1: Cache Not Being Used

**Symptoms**: All images are being generated, cache hit rate is 0%

**Possible Causes**:
1. `skipImageCache` is `true` in user preferences (system default)
2. Similarity caching is disabled (`IMAGE_SIMILARITY_CACHE_ENABLED='false'`)
3. Cache keys are not matching due to variable differences

**Solutions**:
- Check user preferences: `userPreferences.skipImageCache`
- Verify environment variable: `process.env.IMAGE_SIMILARITY_CACHE_ENABLED`
- Review cache key generation: Ensure variables are consistently serialized
- Check logs for cache lookup attempts

#### Issue 2: Inappropriate Images from Cache

**Symptoms**: Images don't match the current scene context

**Possible Causes**:
1. Similarity threshold too low (allowing poor matches)
2. Scene fingerprint not capturing important context
3. Stale cache entries with outdated fingerprints

**Solutions**:
- Increase similarity threshold (currently 0.85)
- Review scene fingerprint generation: Ensure all relevant context is included
- Clear cache for affected templates: `deleteGeneratedImages({ templateName: '...' })`
- Check similarity scores in logs to identify poor matches

#### Issue 3: Missing Image Files

**Symptoms**: Cache lookup succeeds but file is missing, causing errors

**Possible Causes**:
1. Manual file deletion outside the system
2. Filesystem cleanup removing images
3. Database and filesystem out of sync

**Solutions**:
- Code handles this gracefully: Missing files are treated as cache misses
- Run orphaned file cleanup: `cleanupOrphanedFiles(validFilePaths)`
- Verify file paths in database match actual filesystem structure
- Check file permissions on `generated_images/` directory

#### Issue 4: High Storage Usage

**Symptoms**: `generated_images/` directory growing too large

**Possible Causes**:
1. Cleanup service not running
2. Retention policy too permissive
3. High access counts preventing cleanup

**Solutions**:
- Verify cleanup service is running: Check `ImageCacheCleanup.start()` is called
- Adjust retention policy: Reduce `image_cache_retention_days` or increase `image_cache_min_access_count`
- Manually trigger cleanup: `await imageCacheCleanup.cleanupOldImages()`
- Review access patterns: Images with high access counts are intentionally preserved

#### Issue 5: Slow Cache Lookups

**Symptoms**: Cache checks taking longer than expected

**Possible Causes**:
1. Missing database indexes
2. Large number of template images for similarity matching
3. Inefficient similarity calculations

**Solutions**:
- Verify indexes exist: `idx_generated_images_hashes`, `idx_generated_images_template`
- Limit similarity candidate pool: Consider filtering by date or access count
- Profile similarity calculations: May need optimization for large candidate sets
- Consider disabling similarity matching if exact matches are sufficient

### Error Messages

#### "File missing for cached image, treating as miss"
- **Meaning**: Database record exists but file is missing
- **Action**: System automatically treats as cache miss and generates new image
- **Prevention**: Ensure filesystem and database stay in sync

#### "Cached image missing filePath, treating as miss"
- **Meaning**: Database record has null/empty `filePath`
- **Action**: System treats as cache miss
- **Prevention**: Ensure `filePath` is always set when creating cache entries

#### "Similar match missing filePath, skipping"
- **Meaning**: Similarity match found but file is missing
- **Action**: System skips to next candidate
- **Prevention**: Run orphaned file cleanup regularly

### Debugging Tips

1. **Enable Detailed Logging**:
   ```typescript
   // Check logs for cache hit/miss decisions
   console.log('[IMAGE_CACHE] Exact cache hit', { templateName, cachedImageId });
   console.log('[IMAGE_CACHE] Similarity cache hit', { similarityScore });
   ```

2. **Inspect Cache Keys**:
   ```typescript
   const keys = await computeImageKeys(templateName, gameState, userPreferences);
   console.log('Cache keys:', { promptHash: keys.promptHash, variablesHash: keys.variablesHash });
   ```

3. **Monitor Metrics**:
   - `imageCacheHits`: Number of cache hits
   - `imageCacheMisses`: Number of cache misses
   - `imageProcessingDuration`: Time spent in cache operations

4. **Query Database Directly**:
   ```sql
   -- Check cache entries for a template
   SELECT id, prompt_hash, variables_hash, access_count, accessed_at 
   FROM generated_images 
   WHERE template_name = 'pce_generated' 
   ORDER BY accessed_at DESC 
   LIMIT 10;
   ```

5. **Verify Scene Fingerprints**:
   ```typescript
   const fingerprint = generateSceneFingerprint(...);
   console.log('Scene fingerprint:', JSON.stringify(fingerprint, null, 2));
   ```

---

## Standards & Processes

### Quality Requirements

1. **Cache Hit Accuracy**: Exact matches must be 100% accurate (same prompt + variables = same image)
2. **Similarity Matching**: Similarity scores must be calculated consistently across all comparisons
3. **File Integrity**: All cached images must be valid PNG files readable by standard image viewers
4. **Metadata Completeness**: All cache entries must include required fields (hashes, fingerprints, metadata)

### Security Considerations

1. **File Path Validation**: Ensure file paths are relative and don't escape the `generated_images/` directory
2. **Hash Collision Resistance**: SHA-256 provides sufficient collision resistance for cache keys
3. **Access Control**: Cache files should be readable by the web server but not writable by external users
4. **Data Privacy**: Cache metadata may contain game state information; ensure database access is restricted

### Performance Implications

1. **Database Load**: Cache lookups add database queries; ensure indexes are optimized
2. **Filesystem I/O**: Loading cached images requires file reads; consider SSD storage for better performance
3. **Memory Usage**: Similarity matching loads all template images into memory; may need pagination for large sets
4. **Network Latency**: Cache hits eliminate external API calls, significantly reducing latency (5-15 seconds → <100ms)

### Testing & Validation

#### Unit Tests

Test cache key generation:
```typescript
describe('Cache Key Generation', () => {
  it('generates consistent hashes for same input', () => {
    const hash1 = generatePromptHash('test prompt');
    const hash2 = generatePromptHash('test prompt');
    expect(hash1).toBe(hash2);
  });
  
  it('generates different hashes for different inputs', () => {
    const hash1 = generatePromptHash('prompt 1');
    const hash2 = generatePromptHash('prompt 2');
    expect(hash1).not.toBe(hash2);
  });
});
```

Test similarity calculation:
```typescript
describe('Scene Similarity', () => {
  it('calculates high similarity for identical scenes', () => {
    const fp1 = generateSceneFingerprint(...);
    const fp2 = generateSceneFingerprint(...); // Same inputs
    const similarity = calculateSceneSimilarity(fp1, fp2);
    expect(similarity.overallSimilarity).toBeGreaterThan(0.95);
  });
});
```

#### Integration Tests

Test cache lookup flow:
```typescript
describe('Cache Lookup', () => {
  it('returns cached image on exact match', async () => {
    // Generate and cache an image
    const generated = await generateImage(...);
    
    // Lookup should return cached version
    const cached = await checkImageCache(...);
    expect(cached).not.toBeNull();
    expect(cached.imageUrl).toBe(generated.imageUrl);
  });
});
```

#### Performance Tests

Measure cache lookup latency:
```typescript
describe('Cache Performance', () => {
  it('cache lookup completes in <100ms', async () => {
    const start = Date.now();
    await checkImageCache(...);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

### Validation Checklist

Before deploying cache changes:
- [ ] All database indexes are created
- [ ] Cache cleanup service is scheduled
- [ ] File storage directory has correct permissions
- [ ] Similarity threshold is appropriate for use case
- [ ] User preference handling is tested
- [ ] Error handling for missing files is verified
- [ ] Metrics are being recorded correctly

---

## Visual Aids

### Recommended Diagrams

1. **Cache Lookup Flow Diagram**
   - Show decision tree: Exact Match → Similarity Match → Generate
   - Include timing information for each path

2. **Scene Fingerprint Structure**
   - Visual representation of the fingerprint JSON structure
   - Highlight which fields contribute to similarity scores

3. **Database Schema Diagram**
   - `generated_images` table structure
   - Relationships to other tables (games, turns)
   - Index locations

4. **System Integration Diagram**
   - How cache integrates with Image Worker, Game Logic, and Storage layers
   - Data flow from turn processing to image serving

5. **Similarity Calculation Flowchart**
   - Show how similarity scores are computed
   - Weight distribution visualization
   - Threshold decision point

### Sequence Diagram Example

```
Turn Processing → processTurnImage()
    │
    ├─► checkImageCache()
    │   │
    │   ├─► computeImageKeys()
    │   │
    │   ├─► getGeneratedImageByHash()
    │   │   │
    │   │   └─► [Hit] updateImageAccess() → Return cached image
    │   │
    │   └─► [Miss] getGeneratedImagesByTemplate()
    │       │
    │       ├─► generateSceneFingerprint()
    │       │
    │       ├─► findSimilarScenes()
    │       │   │
    │       │   └─► [Match] Return similar image
    │       │
    │       └─► [No Match] Return null
    │
    └─► [Cache Miss] Create Image Job
        │
        └─► Image Worker → generateImage() → Save & Store
```

---

## Cross-References

### Related Documentation

- **`AGENTS.md`**: Image Processor Agent responsibilities and integration
- **`SYSTEM_OVERVIEW.md`**: Overall system architecture and component relationships
- **`API_GUIDE.md`**: Image generation API endpoints
- **`DATABASE_ARCHITECTURE.md`**: Database schema and storage patterns
- **`GAME_EXECUTION_FLOW.md`**: Turn processing flow and image generation timing

### Related Code Modules

- **`server/aiService.ts`**: Core image generation and cache lookup logic
- **`server/cacheUtils.ts`**: Hash generation, fingerprinting, similarity calculation
- **`server/imageStorage.ts`**: File I/O operations for image storage
- **`server/imageCacheCleanup.ts`**: Automatic cleanup service
- **`server/storage.ts`**: Database operations for cache metadata
- **`server/orchestrator/workers/imageWorker.ts`**: Worker that processes image jobs with cache checks
- **`server/gameLogic.ts`**: Turn processing that initiates cache lookups

### Dependencies

- **PostgreSQL**: Database for cache metadata
- **Node.js fs/promises**: File system operations
- **Crypto**: Hash generation (SHA-256)
- **Image Generation Providers**: External APIs for generating new images (e.g., OpenAI)

---

## Appendix: Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_SIMILARITY_CACHE_ENABLED` | `true` | Enable/disable similarity matching |

### Database Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `image_cache_retention_days` | `30` | Days to retain images before cleanup |
| `image_cache_min_access_count` | `5` | Minimum accesses to preserve image |

### Cache Thresholds

| Threshold | Value | Description |
|-----------|-------|-------------|
| Similarity Threshold | `0.85` | Minimum similarity for reuse |
| Action Weight | `0.35` | Weight for action similarity |
| Narrative Weight | `0.25` | Weight for narrative similarity |
| Context Weight | `0.15` | Weight for game state similarity |
| Visual Weight | `0.15` | Weight for settings similarity |
| Template Weight | `0.10` | Weight for template match |

---

*Last Updated: [Current Date]*
*Maintained by: Engineering Team*

