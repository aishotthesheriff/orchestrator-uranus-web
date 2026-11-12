# API Endpoint Architecture

This document clearly distinguishes between **Reference endpoints** and **Admin/Public endpoint pairs** in the Quest to Uranus API.

## Overview

The Quest to Uranus API follows two distinct patterns:

1. **Reference Endpoints**: Public, read-only endpoints that read from the current active reference release
2. **Admin Endpoints**: Admin-only endpoints that provide full CRUD operations on the live database

These patterns work together: content is managed through admin endpoints (writing to the database), then published as reference releases, and consumed through reference endpoints (reading from the release).

---

## Reference Endpoints (`/api/reference/*`)

**Pattern**: Public, read-only endpoints that read from the active reference release.

**Characteristics**:
- ✅ **Public access** - No authentication required
- ✅ **Read-only** - **GET requests only** (no POST, PUT, DELETE, or PATCH supported)
- ✅ **Reference-based** - Read from the current active reference release (filesystem cache)
- ✅ **Deterministic** - Return the same data until a new release is activated
- ✅ **Runtime use** - Used by the game engine during gameplay

**Important**: All `/api/reference/*` endpoints support **only the GET method**. Any attempt to use POST, PUT, DELETE, or PATCH on these endpoints will result in a 404 or method not allowed error.

**All Reference Endpoints**:

| Endpoint | Description | Data Source |
|----------|-------------|-------------|
| `GET /api/reference/items` | Get all active items | `reference.data.items` |
| `GET /api/reference/events` | Get all active events | `reference.data.events` |
| `GET /api/reference/npc_templates` | Get all active NPC templates | `reference.data.npcs` |
| `GET /api/reference/prompt_templates` | Get all active prompt templates | `reference.data.prompts` |
| `GET /api/reference/image_prompts` | Get all active image prompt templates | `reference.data.image_prompts` |
| `GET /api/reference/image-models` | Get all active image models | `reference.data.image_models` |
| `GET /api/reference/story-themes` | Get all active story themes | `reference.data.mod_story_themes` |
| `GET /api/reference/visual-styles` | Get all active visual styles | `reference.data.mod_visual_styles` |
| `GET /api/reference/settings` | Get all active settings | `reference.data.settings` |

**Implementation Pattern**:
```typescript
// Example: server/routes/itemsReference.ts
import { getCurrentReference } from "../reference/referenceLoader";

itemsReference.get("/", async (_req, res) => {
  const reference = await getCurrentReference();
  // getCurrentReference() loads from releases/current/ directory
  // - Reads metadata.json for version, author, dates, notes (no database query)
  // - Reads all data files (items.json, events.json, etc.) from current/
  // - Returns cached data if available, otherwise loads from filesystem
  const items = (reference.data.items || []).filter(item => item.active === 1);
  res.json(items);
});
```

**Filesystem Structure**:
- All reference endpoints read from `releases/current/` directory
- Directory contains:
  - `metadata.json` - Release metadata (version, author, publishedAt, notes)
  - `manifest.json` - File path mappings
  - Data files: `items.json`, `events.json`, `npcs.json`, etc.
- This directory is a complete copy of the active release, updated during activation

**Data Flow**:
1. Request comes to `/api/reference/items`
2. `getCurrentReference()` loads data from `releases/current/` directory (cached in memory)
3. Reads `metadata.json` for release metadata (version, author, dates, notes) - **no database query**
4. Reads data files (items.json, etc.) from `releases/current/`
5. Returns filtered active items from the reference data
6. **Zero database queries** - completely filesystem-based

**Why Reference Endpoints Exist**:
- Ensures consistent game content across all players
- Enables content versioning and rollback
- Provides deterministic gameplay (same version = same content)
- Allows testing new content without affecting live gameplay
- **Zero database dependency** - completely filesystem-based for performance
- Cache performance (in-memory caching of reference data)

---

## Admin Endpoints (`/api/admin/*`)

**Pattern**: Admin-only endpoints that provide full CRUD operations on the live database.

**Characteristics**:
- 🔒 **Admin-only** - Requires admin authentication via `requireAdmin` middleware
- ✏️ **Full CRUD** - Create, Read, Update, Delete operations
- 💾 **Database-direct** - Read/write directly to the database (bypass reference releases)
- 🔄 **Live data** - Operate on current database state, including inactive records
- 🛠️ **Content management** - Used by admin tools for managing game content

**Admin Endpoint Pairs** (paired with Reference endpoints):

| Resource | Reference Endpoint (Public) | Admin Endpoint (Admin) |
|----------|----------------------------|------------------------|
| Items | `GET /api/reference/items` | `GET /api/admin/items`<br/>`POST /api/admin/items`<br/>`PUT /api/admin/items/:id` |
| Events | `GET /api/reference/events` | `GET /api/admin/events`<br/>`POST /api/admin/events`<br/>`PUT /api/admin/events/:id` |
| NPC Templates | `GET /api/reference/npc_templates` | `GET /api/admin/npc_templates`<br/>`POST /api/admin/npc_templates`<br/>`PUT /api/admin/npc_templates/:id` |
| Prompt Templates | `GET /api/reference/prompt_templates` | `GET /api/admin/prompt_templates`<br/>`GET /api/admin/prompt_templates/:name`<br/>`PUT /api/admin/prompt_templates/:id` |
| Image Prompts | `GET /api/reference/image_prompts` | `GET /api/admin/image_prompts`<br/>`POST /api/admin/image_prompts`<br/>`PUT /api/admin/image_prompts/:id` |
| Image Models | `GET /api/reference/image-models` | `GET /api/admin/image-models`<br/>`POST /api/admin/image-models`<br/>`PUT /api/admin/image-models/:modelKey`<br/>`DELETE /api/admin/image-models/:modelKey`<br/>`PUT /api/admin/image-models/reorder` |
| Story Themes | `GET /api/reference/story-themes` | `GET /api/admin/mod-story-themes`<br/>`POST /api/admin/mod-story-themes`<br/>`PUT /api/admin/mod-story-themes/:id`<br/>`DELETE /api/admin/mod-story-themes/:id` |
| Visual Styles | `GET /api/reference/visual-styles` | `GET /api/admin/mod-visual-styles`<br/>`POST /api/admin/mod-visual-styles`<br/>`PUT /api/admin/mod-visual-styles/:id`<br/>`DELETE /api/admin/mod-visual-styles/:id` |
| Settings | `GET /api/reference/settings` | `GET /api/settings`<br/>`PUT /api/settings/:key` |

**Implementation Pattern**:
```typescript
// Example: server/routes/itemsAdmin.ts
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";

itemsAdmin.use(requireAdmin);

itemsAdmin.get("/", async (_req, res) => {
  const items = await storage.getItems(); // Direct database access
  res.json(items);
});

itemsAdmin.post("/", async (req, res) => {
  const newItem = await storage.createItem(req.body);
  res.json(newItem);
});

itemsAdmin.put("/:id", async (req, res) => {
  const updated = await storage.updateItem(req.params.id, req.body);
  res.json(updated);
});
```

**Data Flow**:
1. Admin makes changes via `/api/admin/items` (POST/PUT)
2. Changes are written directly to the database
3. Changes are **not** immediately available to players
4. Admin publishes a new reference release
5. New release is activated
6. Players now see the changes via `/api/reference/items`

**Why Admin Endpoints Exist**:
- Content management workflow (create/edit content)
- Access to all records (including inactive)
- Direct database modification for admin tools
- Content development and testing before release

---

## Reference Release Management (`/api/admin/reference/*`)

**Pattern**: Special admin-only endpoints for managing the reference release system itself.

**Characteristics**:
- 🔒 **Admin-only** - Requires admin authentication
- 📦 **Release management** - Publish, activate, and query reference releases
- 🔄 **Version control** - Manage content versions
- 📋 **Metadata** - Track release authors, notes, timestamps

**Reference Release Management Endpoints**:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/reference/publish/:version` | POST | Publish current database state as a new reference release |
| `/api/admin/reference/:version/activate` | POST | Activate a specific release (makes it current) |
| `/api/admin/reference/releases` | GET | List all published releases |
| `/api/admin/reference/current` | GET | Get information about the currently active release |

**Workflow**:
1. Admin makes changes via `/api/admin/*` endpoints
2. Admin publishes a release: `POST /api/admin/reference/publish/v4.0.2`
   - Database state is exported to `releases/v4.0.2/`
   - Creates `metadata.json` with version, author, dates, notes
   - If `makeCurrent: true`, files are copied to `releases/current/`
3. Admin activates the release: `POST /api/admin/reference/v4.0.2/activate`
   - All files from `releases/v4.0.2/` are copied to `releases/current/`
   - Database flag updated (`is_current = 1`)
   - Cache cleared
4. Reference endpoints now load from `releases/current/` directory (no database queries)

**For complete documentation**, see: `docs_master/current/REFERENCE_RELEASES_API.md`

---

## Key Distinctions Summary

### Reference Endpoints vs Admin Endpoints

| Aspect | Reference Endpoints | Admin Endpoints |
|--------|-------------------|-----------------|
| **Authentication** | Public (none required) | Admin required |
| **Access Pattern** | Read-only | Full CRUD |
| **Data Source** | `releases/current/` directory (filesystem) | Database (direct) |
| **Database Queries** | **Zero queries** (completely filesystem-based) | Direct database access |
| **Purpose** | Runtime gameplay | Content management |
| **Determinism** | Fixed by release version | Live database state |
| **Cache** | In-memory reference cache | N/A (direct DB queries) |
| **Metadata Source** | `releases/current/metadata.json` file | Database tables |

### Why Both Patterns Exist

**Content Development Workflow**:
1. Admin creates/edits content → `/api/admin/*` (database)
2. Admin publishes release → `/api/admin/reference/publish/*`
   - Creates `releases/{version}/` directory with all files and `metadata.json`
3. Admin activates release → `/api/admin/reference/:version/activate`
   - Copies all files from `releases/{version}/` to `releases/current/`
4. Game engine reads content → `/api/reference/*` (from `releases/current/`, **no database queries**)

**Benefits**:
- ✅ **Separation of concerns**: Development (admin) vs Runtime (reference)
- ✅ **Version control**: Rollback to previous content versions
- ✅ **Testing**: Test new content without affecting live gameplay
- ✅ **Consistency**: All players see the same content from the same release
- ✅ **Performance**: In-memory caching of reference data
- ✅ **Zero database load**: Reference endpoints require no database queries
- ✅ **Scalability**: Filesystem-based loading scales independently of database

---

## Other API Endpoints (Not Reference or Admin Pairs)

The API also includes other endpoint categories that don't follow the Reference/Admin pattern:

### Game Management (`/api/game/*`, `/api/games/*`)
- `POST /api/game/start` - Start a new game (requires auth - uses session username)
- `GET /api/game/:id` - Get game state (requires auth - must own game)
- `POST /api/game/action` - Submit player action (async, enqueues turn processing) (requires auth - must own game)
- `DELETE /api/game/:id` - Delete game (requires auth - must own game)
- `GET /api/games/user/:username` - List user's games (requires auth - can only access own games)
- `PATCH /api/games/:id/equipped-items` - Update equipped items for a game (requires auth - must own game)
- `PATCH /api/games/:id/settings` - Update per-game runtime settings (absurdity) (requires auth - must own game)
- `PATCH /api/games/:id/interview-responses` - Persist interview responses for a game (requires auth - must own game)

**Characteristics**: All game endpoints require authentication - users can only access/modify their own games. Session-based game state management with ownership verification.

### Interview Questions (`/api/interview-questions/*`)
- `GET /api/interview-questions` - Get all (admin only)
- `GET /api/interview-questions/active` - Get active (public)
- `POST /api/interview-questions` - Create (admin only)
- `PUT /api/interview-questions/:id` - Update (admin only)

**Characteristics**: Mixed public/admin, not part of reference system

### Image Generation
- `POST /api/generate-image` - Generate or retrieve cached scene image (state-based, cache-aware) (requires auth)
- `POST /api/test-generate-image` - Test image generation with custom template and variables (rate limited, public)

**Characteristics**: `/api/generate-image` requires authentication and game ownership verification, `/api/test-generate-image` is public for testing

### Interview System
- `POST /api/interview/generate-answer` - Generate AI answer for interview question (requires auth)

**Characteristics**: Requires authentication for interview functionality

### PCE (Prompt Composition Engine)
- `GET /api/pce/catalogs` - Get PCE defaults (deprecated, use reference endpoints)
- `POST /api/pce/test` - Test PCE prompt composition (admin only)

**Characteristics**: Mixed public/admin, deprecated in favor of reference endpoints

### User Management (`/api/user/*`)
- `GET /api/user/search?pattern=xxx&limit=20` - Search users by username pattern (public)
- `GET /api/user/me` - Get current authenticated user info (requires auth)
- `GET /api/user/preferences` - Get user preferences (theme, style, imageModelKey) (requires auth)
- `POST /api/user/ensure` - Ensure user exists (create if needed) (public)
- `POST /api/user/logout` - Logout current session (requires auth)
- `PATCH /api/user/preferences` - Update user preferences (requires auth)

**User Search Endpoint Details**:
- **Query Parameters**:
  - `pattern` (required): Username search pattern (minimum 2 characters)
  - `limit` (optional): Maximum number of results (default: 20)
- **Response**: Array of user objects with only `id` and `username` (no passwords or sensitive data)
- **Validation**: Returns empty array if pattern is less than 2 characters
- **Security**: Public endpoint, but only returns safe user data (id and username)

**User Authentication Endpoints**:
- `GET /api/user/me` - Returns current authenticated user's `id`, `username`, `theme`, `style`, and `imageModelKey`
- `POST /api/user/logout` - Destroys current session and logs out user

**Characteristics**: Mixed public/authenticated endpoints - `/api/user/search` and `/api/user/ensure` are public, others require authentication

### Cache Management (`/api/cache/*`)
- `GET /api/cache/images` - List cached images (admin only)
- `GET /api/cache/images/:id` - Get cached image record (admin only)
- `GET /api/cache/stats` - Cache statistics (admin only)
- `DELETE /api/cache/images/:id` - Delete cached image (admin only)
- `DELETE /api/cache/images` - Bulk delete cached images (admin only)
- `POST /api/cache/clear` - Clear entire cache (admin only)
- `GET /api/cache/similar/:id` - Find similar images by fingerprint (admin only)

**Characteristics**: Admin-only endpoints for image cache management

### Cache Cleanup (`/api/admin/cache/*`)
- `POST /api/admin/cache/cleanup` - Manually trigger image cache cleanup based on retention policy (admin only)

**Characteristics**: Admin-only endpoint for maintenance operations

### LLM Logs (`/api/llm-logs`)
- `GET /api/llm-logs` - List recent LLM logs (admin only)
- `DELETE /api/llm-logs` - Clear all LLM logs (admin only)

**Characteristics**: Admin-only endpoints for debugging and monitoring

### Settings Management (`/api/settings`)
- `GET /api/settings` - Get all application settings (admin only)
- `PUT /api/settings/:key` - Update or create setting (admin only)

**Characteristics**: Admin-only endpoints for global application settings (note: separate from `/api/reference/settings` which is public and read-only)

### Static File Serving
- `GET /generated_images/*` - Serve generated scene images as static files

**Characteristics**: Public static file endpoint for serving cached/generated game images

### Health & Metrics
- `GET /api/health` - Health check (public)
- `GET /metrics` - Prometheus metrics (public)
- `GET /api/csrf-token` - CSRF token (public)

**Characteristics**: System endpoints, not content-related

---

## Complete Endpoint Inventory

### Reference Endpoints (Public, Read-Only)
- `GET /api/reference/items`
- `GET /api/reference/events`
- `GET /api/reference/npc_templates`
- `GET /api/reference/prompt_templates`
- `GET /api/reference/image_prompts`
- `GET /api/reference/image-models`
- `GET /api/reference/story-themes`
- `GET /api/reference/visual-styles`
- `GET /api/reference/settings`

### Admin Content Management Endpoints (Admin, CRUD)
- `/api/admin/items` (GET, POST, PUT /:id)
- `/api/admin/events` (GET, POST, PUT /:id)
- `/api/admin/npc_templates` (GET, POST, PUT /:id)
- `/api/admin/prompt_templates` (GET, GET /:name, PUT /:id)
- `/api/admin/image_prompts` (GET, POST, PUT /:id)
- `/api/admin/image-models` (GET, POST, PUT /:modelKey, DELETE /:modelKey, PUT /reorder)
- `/api/admin/mod-story-themes` (GET, POST, PUT /:id, DELETE /:id)
- `/api/admin/mod-visual-styles` (GET, POST, PUT /:id, DELETE /:id)
- `/api/settings` (GET, PUT /:key) - Settings management (admin-only)

### Reference Release Management Endpoints (Admin)
- `POST /api/admin/reference/publish/:version`
- `POST /api/admin/reference/:version/activate`
- `GET /api/admin/reference/releases`
- `GET /api/admin/reference/current`

### Other Endpoints (Not Reference/Admin Pattern)
- **Game Management**: `/api/game/*`, `/api/games/*` (all require auth - POST start, GET :id, POST action, DELETE :id, GET user/:username, PATCH :id/equipped-items, PATCH :id/settings, PATCH :id/interview-responses)
- **Interview Questions**: `/api/interview-questions/*` (GET all, GET active, POST create, PUT :id)
- **Interview Generation**: `/api/interview/generate-answer` (POST, requires auth)
- **Image Generation**: `/api/generate-image` (POST, requires auth), `/api/test-generate-image` (POST, public)
- **PCE**: `/api/pce/catalogs` (GET, deprecated), `/api/pce/test` (POST, admin)
- **User Management**: `/api/user/*` (GET search?pattern=xxx - public, GET me - auth, GET preferences - auth, POST ensure - public, POST logout - auth, PATCH preferences - auth)
- **Cache Management**: `/api/cache/*` (GET images, GET images/:id, GET stats, DELETE images/:id, DELETE images, POST clear, GET similar/:id) - all admin only
- **Cache Cleanup**: `/api/admin/cache/cleanup` (POST) - admin only, manual cache cleanup
- **LLM Logs**: `/api/llm-logs` (GET, DELETE) - admin only
- **Settings**: `/api/settings` (GET, PUT /:key) - admin only
- **Static Files**: `/generated_images/*` (GET) - serves generated scene images
- **Health & Metrics**: `/api/health` (GET), `/metrics` (GET), `/api/csrf-token` (GET)

---

## Best Practices

### For Developers

1. **Game runtime code**: Always use `/api/reference/*` endpoints
   - Ensures deterministic content
   - Uses cached data for performance
   - Respects active reference release
   - **Zero database queries** - completely filesystem-based
   - Fast, scalable, independent of database load

2. **Admin tools**: Use `/api/admin/*` for content management
   - Create/edit content via admin endpoints
   - Publish releases when ready
   - Activate releases to make them live

3. **Don't mix patterns**:
   - ❌ Don't use admin endpoints in game runtime code
   - ❌ Don't use reference endpoints in admin tools (except for preview)
   - ✅ Use reference endpoints for gameplay
   - ✅ Use admin endpoints for content management

### For API Consumers

1. **Public clients (game UI)**: Use `/api/reference/*`
   - No authentication needed
   - Fast, cached responses
   - Consistent data
   - **No database load** - completely filesystem-based
   - Metadata and data both loaded from `releases/current/` directory

2. **Admin tools**: Use `/api/admin/*` + `/api/admin/reference/*`
   - Manage content via admin endpoints
   - Publish and activate releases
   - Query release metadata

---

## Related Documentation

- **Reference Releases API**: `docs_master/current/REFERENCE_RELEASES_API.md` - Complete documentation for reference release management
- **Database Architecture**: `docs_master/current/DATABASE_ARCHITECTURE_V2.md` - Database schema and structure
- **Server Functional Documentation**: `docs_master/SERVER_FUNCTIONAL_DOCUMENTATION.md` - Overall server architecture
- **API Guide**: `docs_master/current/API_GUIDE.md` - Comprehensive API documentation

---

## Changelog

- **2025-01-28**: Initial document created
  - Clearly distinguishes reference endpoints from admin/public pairs
  - Documents all endpoint categories
  - Provides implementation patterns and best practices
- **2025-01-28 (Architecture Update)**: Updated to reflect filesystem-based current reference system
  - Reference endpoints now load from `releases/current/` directory (not version lookup)
  - Reference endpoints require zero database queries
  - Metadata loaded from `releases/current/metadata.json` file
  - Activation process copies files to `releases/current/` directory
  - Emphasized performance and scalability benefits of filesystem-based approach

