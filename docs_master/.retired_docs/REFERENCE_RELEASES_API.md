# Reference Releases API Documentation

This document provides comprehensive documentation for all `/api/admin/reference/releases` endpoints and the reference release system functionality in Quest to Uranus.

## Overview

The reference release system provides versioned snapshots of game content data (items, events, NPCs, prompts, image models, settings, etc.). Releases are published from the current database state, stored as JSON files on the filesystem, and can be activated to become the current active reference version. This enables:

- **Version Control**: Track and manage content versions
- **Rollback Capability**: Revert to previous content versions if needed
- **Deterministic Gameplay**: Ensure consistent game content across sessions
- **Content Testing**: Test new content versions without affecting live gameplay
- **Cache Performance**: In-memory caching of reference data for fast access

## System Architecture

### Directory Structure

Releases are stored in the `releases/` directory with the following structure:

```
releases/
├── current/                   # Active release (copy of current version)
│   ├── manifest.json          # Metadata mapping table names to files
│   ├── metadata.json          # Release metadata (version, author, dates, notes)
│   ├── items.json             # Item definitions
│   ├── events.json             # Event definitions
│   ├── npcs.json               # NPC template definitions
│   ├── prompts.json            # Prompt template definitions
│   ├── image_prompts.json      # Image prompt template definitions
│   ├── settings.json           # Application settings (key-value map)
│   ├── image_models.json       # Image model configurations
│   ├── mod_story_themes.json   # Story theme modifiers
│   └── mod_visual_styles.json  # Visual style modifiers
├── v4.0.1/
│   ├── manifest.json          # Metadata mapping table names to files
│   ├── metadata.json          # Release metadata (version, author, dates, notes)
│   ├── items.json             # Item definitions
│   ├── events.json             # Event definitions
│   ├── npcs.json               # NPC template definitions
│   ├── prompts.json            # Prompt template definitions
│   ├── image_prompts.json      # Image prompt template definitions
│   ├── settings.json           # Application settings (key-value map)
│   ├── image_models.json       # Image model configurations
│   ├── mod_story_themes.json   # Story theme modifiers
│   └── mod_visual_styles.json  # Visual style modifiers
└── v4.0.0/
    └── ...
```

**Key Points:**
- Each version directory contains all release files plus `metadata.json`
- The `current/` directory is a complete copy of the active release's files
- Runtime reference loading reads from `current/` directory (no database queries needed)
- The database is only used for tracking release metadata and listing releases

### Data Flow

1. **Publish**: Export current database state → Create version directory → Generate JSON files and `metadata.json` → Create database record
2. **Activate**: Copy all files from version directory to `releases/current/` → Update database flag → Clear in-memory cache
3. **Runtime**: Load current reference from `releases/current/` directory (reads `metadata.json` and data files) → Use for game logic

**Important**: The `current/` directory is always kept in sync with the active release. When a release is activated, all its files are copied to `current/`, ensuring runtime code can load reference data without querying the database.

### Caching

The reference system uses an in-memory cache (no TTL) that is:
- **Populated**: On first request after server start or cache clear
- **Cleared**: Explicitly when publishing or activating a release
- **Invalidated**: Automatically when a new release is activated

## Authentication

All release management endpoints require admin authentication via the `requireAdmin` middleware. This middleware checks for:
- Valid session with admin privileges
- Admin role in the session

## Endpoints

### 1. Publish Reference Release

**POST** `/api/admin/reference/publish/:version`

Publishes a new reference release by exporting all active reference data from the database to JSON files and creating a database record.

#### Path Parameters

- `version` (string, required): Version identifier for the release (e.g., `v4.0.2`, `20250128-120000`)

#### Request Body

```json
{
  "author": "string (required)",
  "notes": "string (optional)",
  "makeCurrent": "boolean (optional, default: false)"
}
```

**Fields:**
- `author` (required): Username or identifier of the person publishing the release
- `notes` (optional): Notes or changelog for this release
- `makeCurrent` (optional): If `true`, automatically activates this release after publishing

#### Response

**Success (200 OK):**
```json
{
  "success": true,
  "message": "Reference v4.0.2 published successfully",
  "version": "v4.0.2",
  "manifest": {
    "items": "/path/to/releases/v4.0.2/items.json",
    "events": "/path/to/releases/v4.0.2/events.json",
    "npcs": "/path/to/releases/v4.0.2/npcs.json",
    "prompts": "/path/to/releases/v4.0.2/prompts.json",
    "image_prompts": "/path/to/releases/v4.0.2/image_prompts.json",
    "settings": "/path/to/releases/v4.0.2/settings.json",
    "image_models": "/path/to/releases/v4.0.2/image_models.json",
    "mod_story_themes": "/path/to/releases/v4.0.2/mod_story_themes.json",
    "mod_visual_styles": "/path/to/releases/v4.0.2/mod_visual_styles.json"
  },
  "publishedAt": "2025-01-28T12:00:00.000Z"
}
```

**Error (400 Bad Request):**
```json
{
  "error": "author is required"
}
```

**Error (500 Internal Server Error):**
```json
{
  "error": "Failed to publish reference",
  "details": "Error message details"
}
```

#### Behavior

1. Creates `releases/<version>/` directory if it doesn't exist
2. Exports the following tables to JSON:
   - `items`: Active items (`active = 1`)
   - `events`: Active events (`active = 1`)
   - `npcs`: Active NPC templates (`active = 1`)
   - `prompts`: Active prompt templates (`active = 1`)
   - `image_prompts`: Active image prompt templates (`active = 1`)
   - `settings`: Active settings as key-value map (`active = 1`)
   - `image_models`: Active image models (`active = 1`)
   - `mod_story_themes`: Active story themes (`active = 1`)
   - `mod_visual_styles`: Active visual styles (`active = 1`)
3. Creates `manifest.json` mapping table names to file paths
4. Creates `metadata.json` with release metadata (version, author, publishedAt, notes)
5. Validates that at least one image model has `isDefault = true` (warning if not)
6. Creates or updates database record in `reference_releases` table
7. If `makeCurrent = true`, copies all files to `releases/current/`, updates database flag, and clears cache

#### Notes

- If a release with the same version already exists, it will be updated (not duplicated)
- Settings are exported as a single JSON object (key-value pairs), not an array
- Empty arrays are created for tables that fail to export (to maintain manifest consistency)
- The version identifier can be any string format (semantic versioning recommended)

#### Example Request

```bash
curl -X POST http://localhost:5001/api/admin/reference/publish/v4.0.2 \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "author": "developer",
    "notes": "Added new space station event",
    "makeCurrent": true
  }'
```

---

### 2. Activate Reference Release

**POST** `/api/admin/reference/:version/activate`

Activates an existing reference release by setting it as the current active version. This clears the in-memory cache and causes the next request to load data from the activated release.

#### Path Parameters

- `version` (string, required): Version identifier of the release to activate

#### Request Body

None

#### Response

**Success (200 OK):**
```json
{
  "success": true,
  "message": "Reference v4.0.1 activated successfully",
  "version": "v4.0.1",
  "isCurrent": true
}
```

**Error (500 Internal Server Error):**
If the release doesn't exist, the error response will be:
```json
{
  "error": "Failed to activate reference",
  "details": "Reference release 'v4.0.1' not found"
}
```

**Other Error (500 Internal Server Error):**
```json
{
  "error": "Failed to activate reference",
  "details": "Error message details"
}
```

#### Behavior

1. Verifies the release exists in the database
2. **Clears `releases/current/` directory** (if it exists)
3. **Copies all files from `releases/<version>/` to `releases/current/`**
4. Sets all releases to `is_current = 0` in database
5. Sets the specified release to `is_current = 1` in database
6. Clears the in-memory reference cache
7. Next request to `getCurrentReference()` will load from `releases/current/` directory

#### Notes

- Activation is immediate and affects all new game sessions
- Existing game sessions continue using the reference data they loaded at start
- Cache clearing ensures the new version is loaded on the next request

#### Example Request

```bash
curl -X POST http://localhost:5001/api/admin/reference/v4.0.1/activate \
  -H "Cookie: session=..."
```

---

### 3. Get All Reference Releases

**GET** `/api/admin/reference/releases`

Retrieves all published reference releases from the database, ordered by publication date (newest first).

#### Response

**Success (200 OK):**
```json
{
  "success": true,
  "releases": [
    {
      "version": "v4.0.2",
      "published_by": "developer",
      "notes": "Added new space station event",
      "published_at": "2025-01-28T12:00:00.000Z",
      "is_current": 1
    },
    {
      "version": "v4.0.1",
      "published_by": "content-team",
      "notes": "Updated NPC dialogue",
      "published_at": "2025-01-25T10:30:00.000Z",
      "is_current": 0
    },
    {
      "version": "v4.0.0",
      "published_by": "developer",
      "notes": null,
      "published_at": "2025-01-20T08:00:00.000Z",
      "is_current": 0
    }
  ]
}
```

**Error (500 Internal Server Error):**
```json
{
  "error": "Failed to fetch reference releases",
  "details": "Error message details"
}
```

#### Response Fields

- `version` (string): Version identifier
- `published_by` (string): Username who published the release
- `notes` (string | null): Optional notes/changelog
- `published_at` (ISO 8601 timestamp): Publication timestamp
- `is_current` (0 | 1): Whether this is the currently active release (1 = active, 0 = inactive)

#### Notes

- Results are ordered by `published_at` descending (newest first)
- Only one release can have `is_current = 1` at a time
- Returns all releases regardless of whether their filesystem data exists

#### Example Request

```bash
curl http://localhost:5001/api/admin/reference/releases \
  -H "Cookie: session=..."
```

---

### 4. Get Current Reference Release

**GET** `/api/admin/reference/current`

Retrieves information about the currently active reference release.

#### Response

**Success (200 OK):**
When a current release exists:
```json
{
  "success": true,
  "current": {
    "version": "v4.0.2",
    "published_by": "developer",
    "notes": "Added new space station event",
    "published_at": "2025-01-28T12:00:00.000Z",
    "is_current": 1
  }
}
```

When no current release is set:
```json
{
  "success": true,
  "current": undefined
}
```

**Error (500 Internal Server Error):**
```json
{
  "error": "Failed to fetch current reference",
  "details": "Error message details"
}
```

#### Response Fields

Same as individual release object in "Get All Reference Releases"

#### Notes

- Returns the release where `is_current = 1`
- If no current release is set, returns `success: true` with `current: undefined`
- This endpoint does not return an error when no current release exists; check if `current` is defined
- This is the release that will be used for new game sessions

#### Example Request

```bash
curl http://localhost:5001/api/admin/reference/current \
  -H "Cookie: session=..."
```

---

## Data Structures

### Reference Release Database Schema

The `reference_releases` table structure:

```typescript
interface ReferenceRelease {
  version: string;              // Primary key, version identifier
  published_by: string;         // Username/identifier of publisher
  notes: string | null;         // Optional release notes
  published_at: Date;           // Publication timestamp
  is_current: 0 | 1;            // Whether this is the active release
}
```

### Manifest Structure

Each release directory contains a `manifest.json` file mapping table names to file paths:

```json
{
  "items": "/absolute/path/to/releases/v4.0.2/items.json",
  "events": "/absolute/path/to/releases/v4.0.2/events.json",
  "npcs": "/absolute/path/to/releases/v4.0.2/npcs.json",
  "prompts": "/absolute/path/to/releases/v4.0.2/prompts.json",
  "image_prompts": "/absolute/path/to/releases/v4.0.2/image_prompts.json",
  "settings": "/absolute/path/to/releases/v4.0.2/settings.json",
  "image_models": "/absolute/path/to/releases/v4.0.2/image_models.json",
  "mod_story_themes": "/absolute/path/to/releases/v4.0.2/mod_story_themes.json",
  "mod_visual_styles": "/absolute/path/to/releases/v4.0.2/mod_visual_styles.json"
}
```

**Note**: When files are copied to `releases/current/`, the manifest is updated to point to the files in the `current/` directory.

### Metadata Structure

Each release directory contains a `metadata.json` file with release information:

```json
{
  "version": "v4.0.2",
  "publishedBy": "developer",
  "publishedAt": "2025-01-28T12:00:00.000Z",
  "notes": "Added new space station event"
}
```

This metadata is used by `getCurrentReference()` to avoid database queries. The database is still used for listing releases and tracking which version is current, but runtime data loading is completely filesystem-based.

### Settings File Format

The `settings.json` file is a key-value map (not an array):

```json
{
  "pce_enabled": "true",
  "max_turns_per_day": "50",
  "absurdity_max": "3"
}
```

All other data files are JSON arrays of objects.

---

## Workflows

### Publishing a New Release

1. Make changes to game content via admin interfaces or direct database updates
2. Test changes to ensure they work correctly
3. Publish a new release:
   ```bash
   POST /api/admin/reference/publish/v4.0.3
   {
     "author": "developer",
     "notes": "Added new events and updated item descriptions",
     "makeCurrent": false
   }
   ```
4. Verify the release files were created in `releases/v4.0.3/`
5. Activate the release when ready:
   ```bash
   POST /api/admin/reference/v4.0.3/activate
   ```

### Rolling Back to a Previous Release

1. List all releases to find the target version:
   ```bash
   GET /api/admin/reference/releases
   ```
2. Activate the desired previous version:
   ```bash
   POST /api/admin/reference/v4.0.1/activate
   ```
3. Verify the current release:
   ```bash
   GET /api/admin/reference/current
   ```

### Publishing and Activating in One Step

If you're confident in your changes, publish and activate simultaneously:

```bash
POST /api/admin/reference/publish/v4.0.3
{
  "author": "developer",
  "notes": "Quick bugfix release",
  "makeCurrent": true
}
```

This will:
1. Publish the release (creates version directory with all files and `metadata.json`)
2. Copy all files to `releases/current/`
3. Update database to mark it as current
4. Clear the cache so it's immediately available

---

## Error Handling

All endpoints follow consistent error handling patterns:

### Authentication Errors

If admin authentication fails, the `requireAdmin` middleware will return:
- **Status**: 401 Unauthorized or 403 Forbidden
- **Response**: Standard Express error response

### Validation Errors

- **Status**: 400 Bad Request
- **Response**: `{ "error": "Error description" }`

### Not Found Errors

- **Status**: 500 Internal Server Error (for activate endpoint when release doesn't exist)
- **Response**: `{ "error": "Failed to activate reference", "details": "Reference release 'X' not found" }`
- **Note**: The activate endpoint treats a missing release as a server error (500) rather than a not found error (404)

### Server Errors

- **Status**: 500 Internal Server Error
- **Response**: `{ "error": "Error summary", "details": "Detailed error message" }`

### Common Error Scenarios

1. **Publishing with missing author**:
   ```json
   {
     "error": "author is required"
   }
   ```

2. **Activating non-existent release** (returns 500, not 404):
   ```json
   {
     "error": "Failed to activate reference",
     "details": "Reference release 'v99.0.0' not found"
   }
   ```

3. **Getting current reference when none is set**:
   ```json
   {
     "success": true,
     "current": undefined
   }
   ```

4. **Filesystem errors** (permissions, disk full, etc.):
   ```json
   {
     "error": "Failed to publish reference",
     "details": "EACCES: permission denied, mkdir '/app/releases'"
   }
   ```

---

## Integration with Runtime System

### Loading Reference Data

At runtime, the game engine uses `getCurrentReference()` from `server/reference/referenceLoader.ts` to load reference data. **This process requires no database queries**:

1. **Cache Check**: Returns cached data if available
2. **Load Metadata**: Reads `releases/current/metadata.json` for version, author, dates, notes
3. **Load Manifest**: Reads `releases/current/manifest.json` to get file paths
4. **Load Data Files**: Reads all JSON data files from `releases/current/` directory
5. **Cache Population**: Stores loaded data (including metadata) in memory
6. **Return**: Returns structured `ReferenceData` object

**Performance Benefits:**
- Zero database queries for reference data loading
- Fast filesystem-based access
- Deterministic data (same files = same data)
- No database dependency for runtime game logic

### Cache Invalidation

The cache is cleared in the following scenarios:
- Publishing a release with `makeCurrent: true`
- Activating an existing release
- Explicit cache clear (testing/debugging)

### Public Reference Endpoints

The public API provides read-only access to current reference data. **All reference endpoints support only the GET method** (POST, PUT, DELETE, and PATCH are not supported):
- `GET /api/reference/items` - Get items from current reference
- `GET /api/reference/events` - Get events from current reference
- `GET /api/reference/npc_templates` - Get NPC templates from current reference
- `GET /api/reference/prompt_templates` - Get prompt templates from current reference
- `GET /api/reference/image_prompts` - Get image prompts from current reference
- `GET /api/reference/image-models` - Get image models from current reference
- `GET /api/reference/story-themes` - Get story themes from current reference
- `GET /api/reference/visual-styles` - Get visual styles from current reference
- `GET /api/reference/settings` - Get settings from current reference

These endpoints read from the cached current reference data, which is loaded from `releases/current/` directory. No database queries are performed when loading reference data.

**Note:** To get current reference metadata (version, author, published date, notes), use the admin endpoint `GET /api/admin/reference/current` (requires admin authentication).

---

## Best Practices

### Version Naming

- Use semantic versioning: `v4.0.1`, `v4.1.0`, `v5.0.0`
- Use timestamp-based versions for quick iterations: `20250128-120000`
- Document version naming convention in your team

### Release Notes

Always provide meaningful `notes` when publishing:
- Summary of changes
- Breaking changes
- New features added
- Bug fixes included

### Testing Before Activation

1. Publish with `makeCurrent: false`
2. Manually verify files in `releases/<version>/`
3. Test with a specific version if needed
4. Activate when confident

### Backup Strategy

Before activating a major release:
1. Publish current state as a backup version
2. Then publish and activate the new release
3. This enables quick rollback if needed

### Monitoring

- Monitor `GET /api/admin/reference/current` to ensure current release is set
- Log activation events for audit trail
- Track release publication frequency

---

## Related Documentation

- **API Guide**: `docs_master/current/API_GUIDE.md` - General API documentation
- **Server Functional Documentation**: `docs_master/SERVER_FUNCTIONAL_DOCUMENTATION.md` - Server architecture
- **Maintainer Guide**: `docs_master/MAINTAINER_GUIDE.md` - System maintenance procedures
- **Reference Loader**: `server/reference/referenceLoader.ts` - Runtime reference loading implementation
- **Publish Reference**: `server/reference/publishReference.ts` - Publishing implementation

---

## Changelog

- **2025-01-28**: Initial documentation created
  - Documents all four release management endpoints
  - Includes data structures, workflows, and best practices
- **2025-01-28 (Updated)**: Corrected documentation to match actual code implementation
  - Fixed: Activate endpoint returns 500 (not 404) when release not found
  - Fixed: Get Current endpoint returns 200 with `current: undefined` (not 404) when no current release exists
  - Fixed: Prompts are exported as active prompts only (`active = 1`), not all prompts
  - Updated error handling section to reflect actual status codes
- **2025-01-28 (Architecture Update)**: Updated to reflect filesystem-based current reference system
  - Added `releases/current/` directory structure and purpose
  - Documented `metadata.json` file format
  - Updated data flow to show file copying during activation
  - Updated loading process to show filesystem-only loading (no database queries)
  - Clarified that database is only used for tracking and listing releases, not runtime data loading

