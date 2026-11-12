# Reference & Release Publishing

## Context & Overview

### What It Is

The Reference & Release Publishing system is Quest to Uranus's content versioning and deployment mechanism. It enables game designers and content creators to manage game content (items, events, NPCs, prompts, settings, etc.) independently of code deployments. This separation allows content teams to iterate on game mechanics, narrative elements, and configuration without requiring engineering deployments.

### Why It Exists

**Content Independence**: Game content changes frequently during development and live operations. The reference system decouples content updates from code releases, enabling faster iteration cycles and reducing deployment risk.

**Version Control for Game Data**: Just as code uses Git for versioning, reference releases provide versioning for game content. This enables:
- Rollback to previous content versions if issues arise
- A/B testing different content configurations
- Historical tracking of content evolution
- Safe experimentation without affecting production

**Performance Optimization**: Reference data is loaded once at server startup and cached in memory, providing fast access to game content without database queries during gameplay. The file-based approach (`releases/current/`) ensures consistent, fast reads.

**Multi-Environment Support**: Different environments (development, staging, production) can run different reference versions, enabling safe testing before production activation.

### Purpose Within the Larger System

The Reference Steward Agent (as defined in `AGENTS.md`) is responsible for managing this system. It serves as the authoritative source of truth for:

- **Game Content**: Items, events, NPCs, and their properties
- **AI Prompts**: System prompts, user prompts, and prompt templates used by the Prompt Composition Engine (PCE)
- **Image Configuration**: Image models, visual styles, and image generation prompts
- **Game Settings**: System-wide configuration values
- **Modifiers**: Story themes and visual styles that affect gameplay and narrative

All game logic, turn processing, and client UI components consume reference data through the `getCurrentReference()` API, ensuring consistent behavior across the system.

---

## Technical Details

### Architecture

The system uses a **dual-storage architecture** combining database persistence with file-based distribution:

1. **Database Layer** (`reference_releases` table): Tracks release metadata (version, author, publish date, notes, current flag)
2. **File System Layer** (`releases/` directory): Stores actual content data as JSON files, organized by version

This design provides:
- **Fast reads**: File-based access with in-memory caching
- **Version history**: Each release stored in its own directory
- **Atomic activation**: The `releases/current/` symlink/copy pattern ensures zero-downtime switches

### Components

#### Core Modules

**1. **`server/reference/publishReference.ts`** - Publishing Engine**
   - `publishReference()`: Exports active database records to JSON files and creates release metadata
   - `activateReferenceRelease()`: Copies a version's files to `releases/current/` and updates database flags
   - `getAllReferenceReleases()`: Lists all published releases
   - `getCurrentReferenceRelease()`: Returns metadata for the active release

**2. **`server/reference/referenceLoader.ts`** - Loading & Caching**
   - `getCurrentReference()`: Loads and caches reference data from `releases/current/`
   - `getReferenceByVersion()`: Loads a specific version (bypasses cache)
   - `clearReferenceCache()`: Invalidates the in-memory cache

**3. **`server/storage.ts`** - Database Operations**
   - `createReferenceRelease()`: Inserts new release record
   - `getReferenceRelease()`: Retrieves release by version
   - `getCurrentReferenceRelease()`: Gets active release
   - `getAllReferenceReleases()`: Lists all releases
   - `updateReferenceRelease()`: Updates release metadata
   - `setCurrentReferenceRelease()`: Atomically switches current release

**4. **`server/routes.ts`** - HTTP API Endpoints**
   - `POST /api/admin/reference/publish/:version`: Publish new release
   - `POST /api/admin/reference/:version/activate`: Activate existing release
   - `GET /api/admin/reference/releases`: List all releases
   - `GET /api/admin/reference/current`: Get current release metadata

**5. **`client/src/components/DevToolsReferencePublisher.tsx`** - Admin UI**
   - React component for publishing and activating releases
   - Displays current release and release history
   - Handles form submission and query invalidation

### Data Structure

#### Release Directory Structure

```
releases/
├── current/              # Active release (symlink or copy)
│   ├── manifest.json     # Maps table names to file paths
│   ├── metadata.json     # Version, author, publish date, notes
│   ├── items.json
│   ├── events.json
│   ├── npcs.json
│   ├── prompts.json
│   ├── image_prompts.json
│   ├── settings.json
│   ├── image_models.json
│   ├── mod_story_themes.json
│   ├── mod_visual_styles.json
│   └── system_defaults.json
├── v10.1.0/              # Versioned releases
│   ├── manifest.json
│   ├── metadata.json
│   └── [same JSON files]
└── v10.0.0/
    └── ...
```

#### Database Schema

```sql
CREATE TABLE reference_releases (
  version VARCHAR(255) PRIMARY KEY,
  published_by VARCHAR(255) NOT NULL,
  published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  is_current INTEGER DEFAULT 0  -- 0 or 1, only one can be 1
);
```

#### Reference Data Interface

```typescript
interface ReferenceData {
  version: string;
  data: {
    items: any[];
    events: any[];
    npcs: any[];
    prompts: any[];
    image_prompts: any[];
    settings: Record<string, string>;
    image_models: any[];
    mod_story_themes?: any[];
    mod_visual_styles?: any[];
    system_defaults?: {
      image_model_key?: string;
      visual_style_key?: string;
      story_theme_key?: string;
    };
  };
  publishedAt: string;
  publishedBy: string;
  notes?: string;
}
```

### Technologies & Frameworks

- **Node.js `fs/promises`**: File system operations for reading/writing JSON files
- **PostgreSQL**: Metadata persistence via `storage` abstraction
- **Express.js**: REST API endpoints for admin operations
- **React Query**: Client-side caching and invalidation
- **TypeScript**: Type safety across server and client

### Relationships & Interactions

#### Publishing Flow

```
1. Admin calls POST /api/admin/reference/publish/:version
   ↓
2. publishReference() exports active DB records to JSON
   ↓
3. Creates releases/{version}/ directory with all files
   ↓
4. Writes manifest.json and metadata.json
   ↓
5. Creates/updates reference_releases DB record
   ↓
6. If makeCurrent=true, copies to releases/current/ and clears cache
```

#### Activation Flow

```
1. Admin calls POST /api/admin/reference/:version/activate
   ↓
2. activateReferenceRelease() copies version files to releases/current/
   ↓
3. Updates database: sets all is_current=0, then target version=1
   ↓
4. clearReferenceCache() invalidates in-memory cache
   ↓
5. Next getCurrentReference() call loads new version from disk
```

#### Consumption Flow

```
Game Logic / AI Service / Client
   ↓
getCurrentReference() [checks cache]
   ↓
Cache miss → Load from releases/current/
   ↓
Parse manifest.json → Load all referenced JSON files
   ↓
Build ReferenceData object → Cache in memory
   ↓
Return to consumer
```

### Configurations & Parameters

#### Publishing Options

```typescript
interface PublishReferenceOptions {
  version: string;        // Version identifier (e.g., "v10.1.0", "20250128-120000")
  author: string;         // Username or identifier of publisher
  notes?: string;         // Optional changelog or description
  makeCurrent?: boolean;   // If true, automatically activate after publishing
}
```

#### Exported Tables

The following database tables are exported during publishing:

- `items` → `items.json` (array of item objects)
- `events` → `events.json` (array of event definitions)
- `npcs` → `npcs.json` (array of NPC templates)
- `prompts` → `prompts.json` (array of prompt templates)
- `image_prompts` → `image_prompts.json` (array of image prompt templates)
- `settings` → `settings.json` (key-value object)
- `image_models` → `image_models.json` (array of image model configs)
- `llm_models` → `llm_models.json` (array of story model configs; the default key is written to `system_defaults.json` as `llm_model_key`). See [LLM_MODELS.md](LLM_MODELS.md)
- `mod_story_themes` → `mod_story_themes.json` (array of story theme modifiers)
- `mod_visual_styles` → `mod_visual_styles.json` (array of visual style modifiers)
- `system_defaults` → `system_defaults.json` (computed from default flags)

**Note**: Only records with `active = 1` (or equivalent active flag) are exported.

---

## Practical Guidance

### Step-by-Step Instructions

#### Publishing a New Release

**Via Admin UI (Recommended)**

1. Navigate to DevTools → Reference Publisher
2. Enter version identifier (e.g., `v10.2.0`)
3. Enter author name
4. Optionally add release notes describing changes
5. Click "Publish & Activate"
6. Wait for success toast notification

**Via API**

```bash
curl -X POST http://localhost:3000/api/admin/reference/publish/v10.2.0 \
  -H "Content-Type: application/json" \
  -H "Cookie: [admin session cookie]" \
  -d '{
    "author": "content-team",
    "notes": "Added new space station events and updated item descriptions",
    "makeCurrent": true
  }'
```

**Programmatically (Server-Side)**

```typescript
import { publishReference } from './reference/publishReference';

const result = await publishReference({
  version: 'v10.2.0',
  author: 'content-team',
  notes: 'Added new space station events',
  makeCurrent: true
});

console.log(`Published ${result.version} at ${result.publishedAt}`);
```

#### Activating an Existing Release

**Via Admin UI**

1. Navigate to DevTools → Reference Publisher
2. Find the desired release in "All Reference Releases"
3. Click "Activate" button
4. Wait for success notification

**Via API**

```bash
curl -X POST http://localhost:3000/api/admin/reference/v10.1.0/activate \
  -H "Cookie: [admin session cookie]"
```

**Programmatically**

```typescript
import { activateReferenceRelease } from './reference/publishReference';

await activateReferenceRelease('v10.1.0');
console.log('Release activated and cache cleared');
```

#### Accessing Reference Data in Code

**Server-Side (Game Logic, AI Service, etc.)**

```typescript
import { getCurrentReference } from './reference/referenceLoader';

// Get all reference data
const reference = await getCurrentReference();

// Access specific data
const items = reference.data.items;
const prompts = reference.data.prompts;
const settings = reference.data.settings;

// Find specific prompt
const turnPrompt = reference.data.prompts.find(
  p => p.name === 'turn_generation' && p.active === 1
);
```

**Client-Side (React Components)**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

// Fetch reference data via API
const { data: items } = useQuery({
  queryKey: ['api', 'reference', 'items'],
  queryFn: async () => {
    const response = await apiRequest('GET', '/api/reference/items');
    return response.json();
  },
});
```

### Code Examples & Usage Patterns

#### Publishing with Validation

```typescript
async function publishWithValidation(version: string, author: string) {
  // Check if version already exists
  const existing = await storage.getReferenceRelease(version);
  if (existing) {
    throw new Error(`Version ${version} already exists. Use update or choose new version.`);
  }

  // Validate database state before publishing
  const activeItems = await storage.getActiveItems();
  if (activeItems.length === 0) {
    throw new Error('Cannot publish: no active items found');
  }

  // Publish
  const result = await publishReference({
    version,
    author,
    notes: 'Validated release',
    makeCurrent: false, // Publish first, activate separately
  });

  return result;
}
```

#### Loading Specific Version for Comparison

```typescript
import { getReferenceByVersion } from './reference/referenceLoader';

async function compareVersions(v1: string, v2: string) {
  const release1 = await getReferenceByVersion(v1);
  const release2 = await getReferenceByVersion(v2);

  // Compare item counts
  console.log(`Items in ${v1}: ${release1.data.items.length}`);
  console.log(`Items in ${v2}: ${release2.data.items.length}`);

  // Find differences
  const items1 = new Set(release1.data.items.map(i => i.id));
  const items2 = new Set(release2.data.items.map(i => i.id));
  const added = [...items2].filter(id => !items1.has(id));
  const removed = [...items1].filter(id => !items2.has(id));

  return { added, removed };
}
```

#### Cache Management

```typescript
import { clearReferenceCache, getCurrentReference } from './reference/referenceLoader';

// Force reload after manual file edits
async function reloadReference() {
  clearReferenceCache();
  const reference = await getCurrentReference();
  console.log(`Reloaded reference version ${reference.version}`);
}
```

### Best Practices & Guidelines

#### Version Naming

- **Semantic Versioning**: Use `v{major}.{minor}.{patch}` (e.g., `v10.2.0`)
- **Date-Based**: Use `YYYYMMDD-HHMMSS` for timestamped releases (e.g., `20250128-120000`)
- **Descriptive**: Include purpose in notes, not version name (e.g., `v10.2.0` with notes "Space station expansion")

#### Publishing Workflow

1. **Test First**: Always test content changes in development before publishing
2. **Incremental Releases**: Publish small, focused releases rather than large batches
3. **Document Changes**: Always include meaningful notes describing what changed
4. **Staged Activation**: Publish with `makeCurrent: false`, review, then activate separately
5. **Monitor After Activation**: Watch logs and metrics after activating a new release

#### Content Management

- **Active Flags**: Only content with `active = 1` is exported. Use this to stage content without publishing
- **Default Validation**: Ensure at least one image model has `isDefault = true` before publishing
- **Backward Compatibility**: When adding new fields to content, make them optional to avoid breaking existing releases

#### File System Considerations

- **Docker Paths**: The system handles both relative and absolute paths (including Docker `/app/releases/` paths)
- **Manifest Consistency**: Never manually edit `manifest.json`; always use publishing functions
- **Current Directory**: The `releases/current/` directory is managed automatically; don't edit it manually

---

## Troubleshooting & Support

### Common Issues & Solutions

#### Issue: "No current reference directory found"

**Symptoms**: Server fails to start or `getCurrentReference()` throws error

**Cause**: No release has been activated, or `releases/current/` was deleted

**Solution**:
```typescript
// Activate an existing release
await activateReferenceRelease('v10.1.0');

// Or publish a new one
await publishReference({
  version: 'v10.1.0',
  author: 'admin',
  makeCurrent: true
});
```

#### Issue: "Failed to load {table} from {path}"

**Symptoms**: Warning in logs, missing data in reference

**Cause**: File missing or corrupted, or path resolution issue

**Solution**:
1. Check that file exists: `ls releases/current/{table}.json`
2. Validate JSON syntax: `cat releases/current/{table}.json | jq .`
3. If file is missing, republish the release
4. Check for Docker path issues (system handles `/app/releases/` automatically)

#### Issue: Cache Not Clearing After Activation

**Symptoms**: Old reference data still being used after activation

**Cause**: Cache not invalidated, or multiple server instances

**Solution**:
```typescript
// Manually clear cache
import { clearReferenceCache } from './reference/referenceLoader';
clearReferenceCache();

// Or restart server (cache is in-memory, per process)
```

**Note**: In multi-instance deployments, ensure all instances restart or use shared cache invalidation.

#### Issue: "Version already exists" Error

**Symptoms**: Cannot publish with existing version name

**Cause**: Version identifier collision

**Solution**:
- Use different version name (e.g., `v10.2.1` instead of `v10.2.0`)
- Or update existing release: `publishReference()` will update if version exists

#### Issue: Empty or Missing Data in Published Release

**Symptoms**: Published release has empty arrays or missing tables

**Cause**: No active records in database, or export error

**Solution**:
1. Check database: `SELECT COUNT(*) FROM items WHERE active = 1;`
2. Review publish logs for export errors
3. Ensure all tables have active records before publishing
4. Check that `storage.getActiveItems()` etc. return expected data

### Error Messages & Meanings

| Error Message | Meaning | Resolution |
|--------------|---------|------------|
| `No current reference directory found` | `releases/current/` missing | Activate a release |
| `Failed to load metadata.json` | Metadata file missing or invalid | Republish the release |
| `Reference release 'X' not found` | Version doesn't exist in database | Check version name, list releases |
| `author is required` | Publishing API missing author field | Provide author in request body |
| `Failed to load {table} from {path}` | JSON file missing or unreadable | Check file exists, validate JSON syntax |
| `No image model with isDefault=true` | Validation warning (not fatal) | Set default image model in database |

### Debugging Tips & Strategies

#### Inspect Current Reference

```typescript
import { getCurrentReference } from './reference/referenceLoader';

const ref = await getCurrentReference();
console.log('Version:', ref.version);
console.log('Items:', ref.data.items.length);
console.log('Prompts:', ref.data.prompts.length);
console.log('Published:', ref.publishedAt);
```

#### Validate Release Files

```bash
# Check manifest structure
cat releases/current/manifest.json | jq .

# Validate all JSON files
for file in releases/current/*.json; do
  echo "Validating $file"
  jq . "$file" > /dev/null || echo "ERROR: $file is invalid JSON"
done
```

#### Database Inspection

```sql
-- List all releases
SELECT version, published_by, published_at, is_current 
FROM reference_releases 
ORDER BY published_at DESC;

-- Find current release
SELECT * FROM reference_releases WHERE is_current = 1;

-- Check active content counts
SELECT 
  (SELECT COUNT(*) FROM items WHERE active = 1) as items,
  (SELECT COUNT(*) FROM events WHERE active = 1) as events,
  (SELECT COUNT(*) FROM prompts WHERE active = 1) as prompts;
```

#### Logging & Monitoring

- **Publish Logs**: Check server logs for `[publish]` prefixed messages
- **Activation Logs**: Look for `[activate]` messages
- **Cache Behavior**: Monitor `getCurrentReference()` call frequency (should hit cache after first load)
- **File System**: Ensure `releases/` directory is writable and has sufficient disk space

---

## Standards & Processes

### Quality Requirements & Criteria

#### Pre-Publish Validation

Before publishing, ensure:

1. **Content Completeness**: All required tables have active records
2. **Default Configuration**: At least one image model, visual style, and story theme marked as default
3. **Data Integrity**: All JSON files are valid and parseable
4. **Version Uniqueness**: Version identifier doesn't conflict with existing releases
5. **Metadata Completeness**: Author and notes provided for traceability

#### Post-Publish Verification

After publishing, verify:

1. **File Existence**: All files listed in `manifest.json` exist
2. **Metadata Accuracy**: `metadata.json` matches database record
3. **Data Consistency**: Exported data matches active database records
4. **Activation Success**: If `makeCurrent=true`, verify `releases/current/` is populated

#### Release Readiness Checklist

- [ ] All content changes tested in development
- [ ] Version identifier follows naming convention
- [ ] Author and notes fields populated
- [ ] Database has active records for all tables
- [ ] Default configurations set (image model, visual style, story theme)
- [ ] Release tested in staging before production activation

### Security Considerations

#### Authentication & Authorization

- **Admin-Only Access**: All publishing/activation endpoints require `requireAdmin` middleware
- **Session Validation**: Admin sessions validated via Express session middleware
- **CSRF Protection**: All POST requests require valid CSRF tokens (handled by `apiRequest`)

#### File System Security

- **Path Traversal Prevention**: Version names validated to prevent directory traversal
- **Read-Only for Clients**: Client components only read reference data via read-only API endpoints
- **Write Permissions**: Only server process should have write access to `releases/` directory

#### Data Validation

- **Input Sanitization**: Version names, author fields validated before use
- **JSON Injection Prevention**: All JSON files written with `JSON.stringify()` (safe serialization)
- **File Size Limits**: Monitor for unusually large JSON files (potential DoS vector)

### Performance Implications

#### Caching Strategy

- **In-Memory Cache**: Reference data cached in process memory after first load
- **Cache Lifetime**: Cache persists until explicit `clearReferenceCache()` or server restart
- **Cache Invalidation**: Automatically cleared on publish/activate with `makeCurrent=true`

#### File I/O Optimization

- **Lazy Loading**: Reference data loaded on-demand (first `getCurrentReference()` call)
- **Batch Reads**: All JSON files read in parallel during load
- **Error Resilience**: Missing files default to empty arrays/objects, preventing crashes

#### Database Impact

- **Publishing**: Heavy read operation (queries all active tables); consider off-peak publishing
- **Activation**: Lightweight (only updates `is_current` flags)
- **Query Frequency**: Reference data queries eliminated after cache population

#### Scalability Considerations

- **Multi-Instance Deployments**: Each server instance maintains its own cache; coordinate restarts or use shared cache
- **File System Limits**: Large releases (1000+ items/events) may slow file I/O; monitor disk performance
- **Memory Usage**: Cached reference data consumes RAM; monitor for large datasets

### Testing & Validation Approaches

#### Unit Testing

```typescript
import { publishReference, activateReferenceRelease } from './reference/publishReference';
import { getCurrentReference, clearReferenceCache } from './reference/referenceLoader';

describe('Reference Publishing', () => {
  beforeEach(() => {
    clearReferenceCache();
  });

  it('should publish a new release', async () => {
    const result = await publishReference({
      version: 'test-v1.0.0',
      author: 'test-user',
      makeCurrent: false,
    });

    expect(result.version).toBe('test-v1.0.0');
    expect(result.manifest).toHaveProperty('items');
  });

  it('should activate a release', async () => {
    await publishReference({
      version: 'test-v1.0.0',
      author: 'test-user',
      makeCurrent: false,
    });

    await activateReferenceRelease('test-v1.0.0');

    const reference = await getCurrentReference();
    expect(reference.version).toBe('test-v1.0.0');
  });
});
```

#### Integration Testing

- **End-to-End Publishing**: Test full publish → activate → consume flow
- **Cache Behavior**: Verify cache invalidation on activation
- **File System**: Ensure files created in correct locations with valid JSON
- **Database Consistency**: Verify `is_current` flags updated atomically

#### Manual Testing Checklist

1. Publish new release with `makeCurrent: false`
2. Verify files created in `releases/{version}/`
3. Verify database record created
4. Activate release
5. Verify `releases/current/` populated
6. Verify cache cleared and new data loaded
7. Verify game logic uses new reference data
8. Test rollback by activating previous version

---

## Visual Aids

### Recommended Diagrams

#### 1. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Reference Publishing System                │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Database   │         │  File System │         │   In-Memory   │
│              │         │              │         │     Cache    │
│ reference_   │◄───────►│ releases/    │◄───────►│ ReferenceData│
│ releases     │  Write  │ {version}/   │  Read   │              │
│              │         │ current/     │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
      ▲                         ▲                         ▲
      │                         │                         │
      │                         │                         │
┌─────┴─────┐           ┌───────┴──────┐          ┌──────┴──────┐
│ Publishing│           │   Activation │          │   Loading   │
│  Engine   │           │    Engine    │          │   Engine    │
└───────────┘           └──────────────┘          └─────────────┘
```

#### 2. Publishing Flow Sequence Diagram

```
Admin → API → publishReference() → Storage → File System
  │       │          │                │            │
  │       │          ├─► Export items ──┐          │
  │       │          ├─► Export events ─┤          │
  │       │          ├─► Export prompts─┤          │
  │       │          └─► ...            │          │
  │       │                              ▼          │
  │       │                    Write JSON files     │
  │       │                              │          │
  │       │                              ▼          │
  │       │                    Create manifest.json │
  │       │                              │          │
  │       │                              ▼          │
  │       │                    Create metadata.json │
  │       │                              │          │
  │       │                              ▼          │
  │       │                    Insert DB record    │
  │       │                              │          │
  │       │                    (if makeCurrent)     │
  │       │                              │          │
  │       │                              ▼          │
  │       │                    Copy to current/     │
  │       │                              │          │
  │       │                              ▼          │
  │       │                    Clear cache          │
  │       │                              │          │
  │       └──────────────────────────────┴──────────┘
  │
  └─◄ Success Response
```

#### 3. Activation Flow Sequence Diagram

```
Admin → API → activateReferenceRelease() → File System → Database → Cache
  │       │              │                    │            │         │
  │       │              ├─► Check release exists        │         │
  │       │              │                    │            │         │
  │       │              ├─► Copy version files            │         │
  │       │              │    to current/                  │         │
  │       │              │                    │            │         │
  │       │              ├─► Update manifest paths         │         │
  │       │              │                    │            │         │
  │       │              ├─► Set all is_current=0          │         │
  │       │              │                    │            │         │
  │       │              ├─► Set target is_current=1        │         │
  │       │              │                    │            │         │
  │       │              └─► clearReferenceCache()          │         │
  │       │                              │            │         │
  │       └──────────────────────────────┴────────────┴─────────┘
  │
  └─◄ Success Response
```

#### 4. Consumption Flow Diagram

```
Game Logic / AI Service / Client
         │
         ▼
  getCurrentReference()
         │
         ├─► Cache Hit? ──Yes──► Return Cached Data
         │
         No
         │
         ▼
  Load releases/current/manifest.json
         │
         ▼
  For each entry in manifest:
         │
         ├─► Read JSON file
         ├─► Parse JSON
         └─► Add to data object
         │
         ▼
  Build ReferenceData object
         │
         ▼
  Store in cache
         │
         ▼
  Return ReferenceData
```

### File Structure Visualization

```
releases/
│
├── current/                    [Active Release]
│   ├── manifest.json           Maps table names → file paths
│   ├── metadata.json           Version, author, date, notes
│   ├── items.json              Array of item objects
│   ├── events.json             Array of event definitions
│   ├── npcs.json               Array of NPC templates
│   ├── prompts.json            Array of prompt templates
│   ├── image_prompts.json      Array of image prompt templates
│   ├── settings.json           Key-value configuration
│   ├── image_models.json       Array of image model configs
│   ├── mod_story_themes.json   Array of story theme modifiers
│   ├── mod_visual_styles.json  Array of visual style modifiers
│   └── system_defaults.json    Default selections (computed)
│
├── v10.1.0/                    [Versioned Release]
│   └── [same structure]
│
├── v10.0.0/
│   └── [same structure]
│
└── v9.0.0/
    └── [same structure]
```

---

## Cross-References

### Related Documentation

- **`AGENTS.md`**: Reference Steward Agent overview and responsibilities
- **`docs_master/current/API_GUIDE.md`**: Complete API endpoint documentation
- **`docs_master/current/PROMPT_COMPOSITION_ENGINE.md`**: How prompts are loaded from reference
- **`client/src/components/DevToolsReferencePublisher.md`**: Admin UI component documentation

### Dependent Systems

- **Game Logic** (`server/gameLogic.ts`): Consumes items, events, NPCs from reference
- **AI Service** (`server/aiService.ts`): Loads prompts from reference via `getCurrentReference()`
- **Prompt Composition Engine** (`server/pce/promptBuilder.ts`): Uses reference prompts for PCE templates
- **Image Processing** (`server/orchestrator/workers/imageWorker.ts`): Uses image models and visual styles from reference
- **Client UI** (`client/src/hooks/useGameLogic.ts`): Fetches reference data for dropdowns and preferences

### Database Dependencies

The publishing system reads from these tables (only active records exported):

- `items` (WHERE `active = 1`)
- `events` (WHERE `active = 1`)
- `npcs` (WHERE `active = 1`)
- `prompts` (WHERE `active = 1`)
- `image_prompts` (WHERE `active = 1`)
- `settings` (all records, exported as key-value object)
- `image_models` (WHERE `active = 1`)
- `mod_story_themes` (WHERE `active = 1`)
- `mod_visual_styles` (WHERE `active = 1`)

And writes to:

- `reference_releases` (metadata tracking)

### Key Code Locations

| Component | File Path |
|-----------|-----------|
| Publishing Logic | `server/reference/publishReference.ts` |
| Loading & Caching | `server/reference/referenceLoader.ts` |
| Database Operations | `server/storage.ts` (lines 1332-1398) |
| HTTP Endpoints | `server/routes.ts` (lines 1458-1539) |
| Admin UI | `client/src/components/DevToolsReferencePublisher.tsx` |
| Client Query Config | `client/src/lib/queryClient.ts` |

---

## Summary

The Reference & Release Publishing system is a critical infrastructure component that enables content versioning, safe deployment, and performance optimization. It separates game content from code deployments, allowing content teams to iterate independently while maintaining version history and rollback capabilities.

Key takeaways for architects and game mechanics specialists:

1. **Content Independence**: Reference releases enable content updates without code deployments
2. **Version Control**: Full versioning and rollback capabilities for game data
3. **Performance**: File-based caching eliminates database queries during gameplay
4. **Safety**: Staged publishing and activation workflows prevent production issues
5. **Consistency**: Single source of truth (`releases/current/`) ensures all systems use same content

For implementation details, refer to the code locations listed above and the related documentation files.

