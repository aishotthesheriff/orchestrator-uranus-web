# API Guide
_Last updated: 2025-01-27 UTC_

## Routes

### GET /api/csrf-token
**Handler:** `server/index.ts:133`, `server/index.ts:138`
**Description:** CSRF token endpoint that returns a fresh token when CSRF protection is enabled and a `{ csrfEnabled: false }` marker otherwise.
**Middlewares:** None (public; relies on global csurf configuration when enabled)
**Params:** None
**Response:** JSON containing either `{ csrfToken: "<token>" }` or `{ csrfToken: null, csrfEnabled: false }`.
**Sample Response:**
```json
{
  "csrfToken": "Q8p3R6fwL0a7nY=="
}
```

---

### GET /api/health
**Handler:** `server/index.ts:152`
**Description:** Enhanced health check that probes the database, reference loader, job queues, memory usage, and security counters.
**Middlewares:** None (public; often firewalled at deployment level)
**Params:** None
**Response:** JSON with `status`, `timestamp`, and a `checks` object summarizing subsystem metrics.
**Sample Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-03T02:47:11.123Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 9 },
    "reference": { "status": "ok" },
    "queues": { "turnJobs": 0, "imageJobs": 0 },
    "memory": { "rss": 21585920, "heapUsed": 10485760, "heapTotal": 20971520, "heapUsedPercent": "50.0" },
    "security": {
      "rateLimitEnabled": true,
      "csrfEnabled": true,
      "eventsLastHour": 3,
      "rateLimitHits": 0,
      "csrfFailures": 0,
      "suspiciousRequests": 0
    }
  }
}
```

---

### GET /metrics
**Handler:** `server/index.ts:211`
**Description:** Prometheus metrics export endpoint.
**Middlewares:** None (public; protect with infrastructure auth/restrictions)
**Params:** None
**Response:** Plain-text metrics from `metricsRegister.metrics()`, or HTTP 500 on failure.
**Sample Response:**
```text
# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 123.456
```

---

### POST /api/game/start
**Handler:** `server/routes.ts:31`
**Description:** Start a new game (requires auth - uses session username).
**Middlewares:** `requireAuth`, `gameStartRateLimit` (authenticated player session with rate limiting)
**Params:** Body validated by `insertGameStateSchema`; username is injected from the session.
**Response:** JSON game state payload with `introApplied: true`, or error status on validation/auth failures.
**Sample Response:**
```json
{
  "id": "game_3f2c7d",
  "username": "captain-elara",
  "turnNumber": 0,
  "day": 1,
  "segment": "Launch from Earth",
  "equippedItems": [],
  "absurdity": 2,
  "introApplied": true
}
```

---

### GET /api/game/:id
**Handler:** `server/routes.ts:56`
**Description:** Get game state (requires auth - verifies the game belongs to the session user).
**Middlewares:** `requireAuth`, `gameReadRateLimit` (authenticated player session; must own the game)
**Params:** Path `id`; session username must match the game owner.
**Response:** Requested game state JSON or 404/403/401 errors when not accessible.
**Sample Response:**
```json
{
  "id": "game_3f2c7d",
  "username": "captain-elara",
  "turnNumber": 4,
  "day": 2,
  "segment": "En route to Uranus",
  "equippedItems": ["stasis_charm", "quantum_fork"],
  "stats": { "hull": 96, "oxygen": 82, "fuel": 71, "food": 88, "morale": 90 },
  "isComplete": false
}
```

---

### POST /api/game/action
**Handler:** `server/routes.ts:81`
**Description:** Take an action by enqueuing a turn job while enforcing ownership and completion checks.
**Middlewares:** `requireAuth`, `gameActionRateLimit` (authenticated player session with action rate limiting)
**Params:** Body validated by `actionInputSchema` (must include `gameId` and action payload).
**Response:** `{ turnJobId, status: "processing" }` on success, or relevant error JSON.
**Sample Response:**
```json
{
  "turnJobId": "turnjob_f47ac10b",
  "status": "processing"
}
```

---

### PATCH /api/games/:id/equipped-items
**Handler:** `server/routes.ts:117`
**Description:** Update equipped items for a game (requires auth and ownership verification).
**Middlewares:** `requireAuth` (authenticated player session; must own the game)
**Params:** Path `id`; Body `equippedItems` array (deduped, trimmed, max length 3).
**Response:** Updated game state reflecting the new equipment, or validation error details.
**Sample Response:**
```json
{
  "id": "game_3f2c7d",
  "equippedItems": ["stasis_charm", "quantum_fork", "gravity_boots"],
  "turnNumber": 4,
  "segment": "En route to Uranus"
}
```

---

### DELETE /api/game/:id
**Handler:** `server/routes.ts:188`
**Description:** Delete a game save for the authenticated player.
**Middlewares:** `requireAuth` (authenticated player session; must own the game)
**Params:** Path `id` (must belong to the session user).
**Response:** `{ success: true }` after deletion, or error JSON when not authorized/found.
**Sample Response:**
```json
{
  "success": true
}
```

---

### GET /api/games/user/:username
**Handler:** `server/routes.ts:215`
**Description:** List all games for the logged-in user.
**Middlewares:** `requireAuth`, `gameReadRateLimit` (authenticated player session; username must match)
**Params:** Path `username` (must equal the session username).
**Response:** Array of game state summaries.
**Sample Response:**
```json
[
  {
    "id": "game_3f2c7d",
    "turnNumber": 4,
    "segment": "En route to Uranus",
    "isComplete": false
  },
  {
    "id": "game_a1b9ff",
    "turnNumber": 12,
    "segment": "Arrival on Uranus",
    "isComplete": true
  }
]
```

---

### GET /api/interview-questions
**Handler:** `server/routes.ts:236`
**Description:** Admin endpoint to fetch all interview questions.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** Array returned from `storage.getInterviewQuestions()`.
**Sample Response:**
```json
[
  {
    "id": "iq_01H",
    "question": "How would you handle a rapid decompression event?",
    "category": "operations",
    "active": true
  },
  {
    "id": "iq_02H",
    "question": "Describe a time you mediated a crew conflict.",
    "category": "leadership",
    "active": true
  }
]
```

---

### GET /api/interview-questions/active
**Handler:** `server/routes.ts:246`
**Description:** Public endpoint for active interview questions.
**Middlewares:** None (public)
**Params:** None
**Response:** Array from `storage.getActiveInterviewQuestions()`.
**Sample Response:**
```json
[
  {
    "id": "iq_02H",
    "question": "Describe a time you mediated a crew conflict.",
    "category": "leadership"
  }
]
```

---

### POST /api/interview-questions
**Handler:** `server/routes.ts:256`
**Description:** Admin-only creation of interview questions.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body with question fields forwarded to `storage.createInterviewQuestion()`.
**Response:** Newly created interview question document.
**Sample Response:**
```json
{
  "id": "iq_03H",
  "question": "What systems would you audit before departure?",
  "category": "readiness",
  "active": true,
  "createdAt": "2025-11-03T02:45:00.000Z"
}
```

---

### PUT /api/interview-questions/:id
**Handler:** `server/routes.ts:266`
**Description:** Admin-only update of an interview question.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `id`; Body with fields to update.
**Response:** Updated interview question record.
**Sample Response:**
```json
{
  "id": "iq_03H",
  "question": "What systems do you audit before departure?",
  "category": "readiness",
  "active": true,
  "updatedAt": "2025-11-03T02:46:12.000Z"
}
```

---

### PATCH /api/games/:id/interview-responses
**Handler:** `server/routes.ts:278`
**Description:** Update interview responses (requires auth and ownership verification).
**Middlewares:** `requireAuth` (authenticated player session; must own the game)
**Params:** Path `id`; Body containing the interview responses object.
**Response:** Updated game state with persisted interview responses.
**Sample Response:**
```json
{
  "id": "game_3f2c7d",
  "interviewResponses": {
    "q_readiness": "Run diagnostics on nav, life support, and AI co-pilot.",
    "q_leadership": "Hold a pre-flight stand-up to align the crew."
  },
  "turnNumber": 4
}
```

---

### POST /api/interview/generate-answer
**Handler:** `server/routes.ts:306`
**Description:** Generate an AI-crafted answer for a provided interview question.
**Middlewares:** `requireAuth` (authenticated player session)
**Params:** Body `{ question: string }`.
**Response:** `{ answer }` from `generateInterviewAnswer()`.
**Sample Response:**
```json
{
  "answer": "I would stabilize the crew, seal the breach, and reroute life support within 90 seconds."
}
```

---

### POST /api/generate-image
**Handler:** `server/routes.ts:323`
**Description:** Generate or retrieve a cached turn image for the authenticated user.
**Middlewares:** `requireAuth` (authenticated player session; must own the game)
**Params:** Body `{ templateName, gameId, turnNumber? }`; session username must own the game.
**Response:** Image metadata from `generateImage()` or error JSON if generation fails.
**Sample Response:**
```json
{
  "imageUrl": "https://cdn.example.com/generated_images/game_3f2c7d_turn_4.png",
  "templateName": "uranus_dawn_bridge",
  "cacheHit": false,
  "metadata": {
    "model": "openai:gpt-image-1",
    "size": "1024x1024",
    "quality": "high"
  }
}
```

---

### POST /api/test-generate-image
**Handler:** `server/routes.ts:366`
**Description:** Developer/test hook to render an image template with supplied variables.
**Middlewares:** `imageGenerationRateLimit` (public; rate limiting applied when enabled)
**Params:** Body `{ templateName, variables }` where `variables` is an object.
**Response:** Result from `testGenerateImage()` including rendered data or error details.
**Sample Response:**
```json
{
  "metaPrompt": "Render the Uranus bridge bathed in cyan light...",
  "variables": {
    "THEME": "Discovery",
    "STYLE": "Neo Deco"
  },
  "example": { "title": "Bridge dawn" },
  "llmResponse": null
}
```

---

### POST /api/pce/test
**Handler:** `server/routes.ts:397`
**Description:** PCE prompt testing endpoint for admins to preview meta prompts and optional LLM output.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body accepts `theme`, `style`, optional `imageModelKey`, `modelClass`, `sendToLlm`, and `context` values.
**Response:** JSON containing `metaPrompt`, resolved `variables`, selected catalog rows, and optional `llmResponse`.
**Sample Response:**
```json
{
  "metaPrompt": "You are the narrative engine for a space exploration game...",
  "variables": {
    "THEME": "Discovery",
    "STYLE": "Neo Deco",
    "TURN_NUMBER": 7
  },
  "theme": { "label": "Discovery", "storyThemeKey": "discovery" },
  "style": { "label": "Neo Deco", "visualStyleKey": "neo_deco" },
  "imageModel": { "modelKey": "dall-e-3", "class": "diffuser" },
  "llmResponse": {
    "raw": "{\n  "prompt": ...
}",
    "parsed": { "prompt": "Captain, chart the methane seas..." },
    "usage": { "total_tokens": 320 }
  }
}
```

---

### GET /api/admin/pce/master-prompt
**Handler:** `server/routes.ts:595`
**Description:** Admin endpoint to retrieve the current master prompt template content.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** JSON containing the master prompt template content.
**Sample Response:**
```json
{
  "content": "You are the narrative engine for a space exploration game..."
}
```

---

### PUT /api/admin/pce/master-prompt
**Handler:** `server/routes.ts:618`
**Description:** Admin endpoint to update the master prompt template content.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ content: string }`.
**Response:** JSON with success status and message.
**Sample Response:**
```json
{
  "success": true,
  "message": "Master prompt updated and cache cleared"
}
```

---

### POST /api/admin/pce/master-prompt/preview
**Handler:** `server/routes.ts:652`
**Description:** Admin endpoint to preview a master prompt template with sample variables.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ template: string, modelClass?: string }`.
**Response:** JSON containing resolved prompt preview, variables, and metadata.
**Sample Response:**
```json
{
  "preview": "You are the narrative engine...",
  "variables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery"
  },
  "variablesKeys": ["STYLE", "THEME", "TURN_NUMBER"],
  "theme": { "key": "discovery", "label": "Discovery" },
  "style": { "key": "neo_deco", "label": "Neo Deco" },
  "modelClass": "transformer"
}
```

---

### GET /api/pce/catalogs
**Handler:** `server/routes.ts:579`
**Description:** Returns cached PCE defaults (players should prefer reference endpoints).
**Middlewares:** None (public)
**Params:** None
**Response:** `{ defaults }` from `getPceDefaults()`.
**Sample Response:**
```json
{
  "defaults": {
    "theme": "Discovery",
    "style": "Neo Deco",
    "imageModelKey": "dall-e-3"
  }
}
```

---

### GET /api/settings
**Handler:** `server/routes.ts:590`
**Description:** Admin settings listing endpoint.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** Array of settings from `storage.getAllSettings()`.
**Sample Response:**
```json
[
  {
    "key": "feature_flags.llmLogging",
    "value": "true",
    "description": "Enable LLM request capture",
    "active": 1
  }
]
```

---

### PUT /api/settings/:key
**Handler:** `server/routes.ts:600`
**Description:** Upsert a named setting value.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `key`; Body `{ value: string, description?, active? }`.
**Response:** Updated/created setting row from `storage.upsertSetting()`.
**Sample Response:**
```json
{
  "key": "feature_flags.llmLogging",
  "value": "false",
  "description": "Enable LLM request capture",
  "active": 1,
  "updatedAt": "2025-11-03T02:47:44.000Z"
}
```

---

### PATCH /api/games/:id/settings
**Handler:** `server/routes.ts:617`
**Description:** Update per-game settings (absurdity only - preferences moved to user level).
**Middlewares:** `requireAuth` (authenticated player session; must own the game)
**Params:** Path `id`; Body may include `absurdity` number/string.
**Response:** Updated game state with adjusted absurdity value.
**Sample Response:**
```json
{
  "id": "game_3f2c7d",
  "absurdity": 3,
  "turnNumber": 4
}
```

---

### GET /api/user/preferences
**Handler:** `server/routes.ts:655`
**Description:** Fetch stored user preferences for the authenticated session.
**Middlewares:** `requireAuth` (authenticated player session)
**Params:** None (username sourced from session).
**Response:** Preferences object from `storage.getUserPreferences()`.
**Sample Response:**
```json
{
  "username": "captain-elara",
  "theme": "Discovery",
  "style": "Neo Deco",
  "imageModelKey": "dall-e-3"
}
```

---

### GET /api/user/search
**Handler:** `server/routes.ts:671`
**Description:** Public search for users by username pattern (used on welcome page).
**Middlewares:** None (public)
**Params:** Query `pattern` (min length 2), optional `limit` (defaults to 20).
**Response:** Array of `{ id, username }` matches.
**Sample Response:**
```json
[
  { "id": "user_01H", "username": "captain-elara" },
  { "id": "user_02H", "username": "chief-engineer" }
]
```

---

### PUT /api/user
**Handler:** `server/routes.ts:697`
**Description:** Create or ensure a user record and establish a browser session.
**Middlewares:** None (public; establishes session on success)
**Params:** Body `{ username }` (non-empty string).
**Response:** `{ id, username }`; also seeds session cookies.
**Sample Response:**
```json
{
  "id": "user_01H",
  "username": "captain-elara"
}
```

---

### GET /api/user/me
**Handler:** `server/routes.ts:736`
**Description:** Retrieve the authenticated user's profile and preference defaults.
**Middlewares:** `requireAuth` (authenticated player session)
**Params:** None
**Response:** `{ id, username, theme, style, imageModelKey }` or 401 if session invalid.
**Sample Response:**
```json
{
  "id": "user_01H",
  "username": "captain-elara",
  "theme": "Discovery",
  "style": "Neo Deco",
  "imageModelKey": "dall-e-3"
}
```

---

### POST /api/user/logout
**Handler:** `server/routes.ts:764`
**Description:** Destroy the current session and log the user out.
**Middlewares:** `requireAuth` (authenticated player session)
**Params:** None
**Response:** `{ success: true, message }` once the session is cleared.
**Sample Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### PATCH /api/user/preferences
**Handler:** `server/routes.ts:780`
**Description:** Update user-level visual preferences after validating theme/style against active catalogs.
**Middlewares:** `requireAuth` (authenticated player session)
**Params:** Body may include `theme`, `style`, `imageModelKey`.
**Response:** Sanitized `{ theme?, style?, imageModelKey? }` reflecting stored preferences.
**Sample Response:**
```json
{
  "theme": "Discovery",
  "style": "Neo Deco",
  "imageModelKey": "dall-e-3"
}
```

---

### GET /api/llm-logs
**Handler:** `server/routes.ts:874`
**Description:** Admin access to LLM interaction logs with optional filtering.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `gameId?`, `limit?` (defaults to 100).
**Response:** Array from `storage.getLlmLogs()`.
**Sample Response:**
```json
[
  {
    "id": "log_01H",
    "gameId": "game_3f2c7d",
    "event": "generateImage",
    "payload": { "prompt": "Render the bridge..." },
    "createdAt": "2025-11-03T02:10:00.000Z"
  }
]
```

---

### DELETE /api/llm-logs
**Handler:** `server/routes.ts:887`
**Description:** Purge all recorded LLM logs.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** `{ success: true, message: "All logs cleared" }`.
**Sample Response:**
```json
{
  "success": true,
  "message": "All logs cleared"
}
```

---

### GET /api/cache/images
**Handler:** `server/routes.ts:898`
**Description:** Inspect generated image cache entries with optional filters.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `templateName?`, `gameId?`, `limit?` (default 100).
**Response:** Array of generated image records (post-filter and limit).
**Sample Response:**
```json
[
  {
    "id": "img_01H",
    "templateName": "uranus_dawn_bridge",
    "gameId": "game_3f2c7d",
    "filePath": "generated_images/game_3f2c7d_turn_4.png",
    "accessCount": 3
  }
]
```

---

### GET /api/cache/images/:id
**Handler:** `server/routes.ts:926`
**Description:** Retrieve a specific cached image by ID.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `id`.
**Response:** Image record or `{ error: "Image not found" }` with 404 status.
**Sample Response:**
```json
{
  "id": "img_01H",
  "templateName": "uranus_dawn_bridge",
  "gameId": "game_3f2c7d",
  "metadata": { "model": "openai:gpt-image-1" },
  "filePath": "generated_images/game_3f2c7d_turn_4.png"
}
```

---

### GET /api/cache/stats
**Handler:** `server/routes.ts:939`
**Description:** Fetch aggregate metrics about the generated image cache.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** Stats object from `storage.getImageCacheStats()`.
**Sample Response:**
```json
{
  "totalImages": 128,
  "totalSizeBytes": 73400320,
  "cacheHitRate": 0.42
}
```

---

### DELETE /api/cache/images/:id
**Handler:** `server/routes.ts:949`
**Description:** Delete a single cached image (database and file system).
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `id`.
**Response:** `{ success: true, message: "Image deleted" }` or 404 if missing.
**Sample Response:**
```json
{
  "success": true,
  "message": "Image deleted"
}
```

---

### DELETE /api/cache/images
**Handler:** `server/routes.ts:970`
**Description:** Bulk-delete cached images using optional filters and clean up orphaned files.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body supports `templateName?`, `gameId?`, `before?` (ISO date), `maxAccessCount?`.
**Response:** `{ success, message, deletedCount, orphanedCount }`.
**Sample Response:**
```json
{
  "success": true,
  "message": "Deleted 12 images and 4 orphaned files",
  "deletedCount": 12,
  "orphanedCount": 4
}
```

---

### POST /api/cache/clear
**Handler:** `server/routes.ts:1000`
**Description:** Clear the entire image cache and associated files.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** `{ success, message, deletedCount, orphanedCount }`.
**Sample Response:**
```json
{
  "success": true,
  "message": "Cleared entire cache: 128 database records and 18 files deleted",
  "deletedCount": 128,
  "orphanedCount": 18
}
```

---

### GET /api/cache/similar/:id
**Handler:** `server/routes.ts:1020`
**Description:** Identify cached images with similar scene fingerprints.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `id`; Query `threshold?` (defaults to 0.7).
**Response:** Array of `{ image, similarity }` matches.
**Sample Response:**
```json
[
  {
    "image": {
      "id": "img_02H",
      "templateName": "uranus_dawn_bridge",
      "gameId": "game_1ab4ff"
    },
    "similarity": 0.82
  }
]
```

---

### POST /api/admin/cache/cleanup
**Handler:** `server/routes.ts:1058`
**Description:** Manually trigger the cache cleanup job and report results.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** `{ success, deletedCount, message, timestamp }` or failure details.
**Sample Response:**
```json
{
  "success": true,
  "deletedCount": 9,
  "message": "Cleaned up 9 images",
  "timestamp": "2025-11-03T02:40:00.000Z"
}
```

---

### POST /api/admin/reference/publish/:version
**Handler:** `server/routes.ts:1081`
**Description:** Publish a new reference release with optional activation.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `version`; Body `{ author, notes?, makeCurrent? }`.
**Response:** Success payload from `publishReference()` including metadata.
**Sample Response:**
```json
{
  "success": true,
  "message": "Reference 2025.11 published successfully",
  "version": "2025.11",
  "author": "ops-team",
  "notes": "Adds new NPC templates",
  "makeCurrent": false
}
```

---

### POST /api/admin/reference/:version/activate
**Handler:** `server/routes.ts:1111`
**Description:** Activate an existing reference release.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Path `version`.
**Response:** `{ success: true, message, version, isCurrent: true }`.
**Sample Response:**
```json
{
  "success": true,
  "message": "Reference 2025.11 activated successfully",
  "version": "2025.11",
  "isCurrent": true
}
```

---

### GET /api/admin/reference/releases
**Handler:** `server/routes.ts:1132`
**Description:** List all reference releases for admin review.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** `{ success: true, releases }`.
**Sample Response:**
```json
{
  "success": true,
  "releases": [
    { "version": "2025.10", "author": "ops-team", "releasedAt": "2025-10-15T18:00:00.000Z" },
    { "version": "2025.11", "author": "ops-team", "releasedAt": "2025-11-01T18:00:00.000Z" }
  ]
}
```

---

### GET /api/admin/reference/current
**Handler:** `server/routes.ts:1148`
**Description:** Fetch the currently active reference release snapshot.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** None
**Response:** `{ success: true, current }`.
**Sample Response:**
```json
{
  "success": true,
  "current": {
    "version": "2025.11",
    "author": "ops-team",
    "activatedAt": "2025-11-02T09:30:00.000Z"
  }
}
```

---

### GET /api/reference/image-models
**Handler:** `server/routes/imageModelsReference.ts:6`
**Description:** Return active image models from the current reference release, normalized to camelCase fields.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of image model descriptors sourced from `getCurrentReference()`.
**Sample Response:**
```json
[
  {
    "modelKey": "dall-e-3",
    "displayName": "DALL·E 3",
    "class": "diffuser",
    "active": 1
  }
]
```

---

### GET /api/admin/image-models
**Handler:** `server/routes/imageModelsAdmin.ts:9`
**Description:** Admin listing of all stored image models.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.listImageModels()`.
**Sample Response:**
```json
[
  {
    "modelKey": "dall-e-3",
    "displayName": "DALL·E 3",
    "provider": "openai",
    "active": 1
  }
]
```

---

### POST /api/admin/image-models
**Handler:** `server/routes/imageModelsAdmin.ts:19`
**Description:** Upsert or create an image model definition.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body payload accepted by `storage.upsertImageModel()`.
**Response:** Persisted image model row.
**Sample Response:**
```json
{
  "modelKey": "stable-diffusion-xl",
  "displayName": "Stable Diffusion XL",
  "provider": "stability",
  "active": 1
}
```

---

### PUT /api/admin/image-models/:modelKey
**Handler:** `server/routes/imageModelsAdmin.ts:28`
**Description:** Update an image model identified by `modelKey`.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `modelKey`; Body with fields to update.
**Response:** Updated image model row from storage.
**Sample Response:**
```json
{
  "modelKey": "stable-diffusion-xl",
  "displayName": "Stable Diffusion XL",
  "provider": "stability",
  "active": 1,
  "updatedAt": "2025-11-03T02:43:00.000Z"
}
```

---

### DELETE /api/admin/image-models/:modelKey
**Handler:** `server/routes/imageModelsAdmin.ts:38`
**Description:** Deactivate an image model.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `modelKey`.
**Response:** `{ success: true }` once deactivated.
**Sample Response:**
```json
{
  "success": true
}
```

---

### PUT /api/admin/image-models/reorder
**Handler:** `server/routes/imageModelsAdmin.ts:47`
**Description:** Reorder image models by updating their sort order in bulk.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body array of `{ modelKey, sortOrder }`.
**Response:** `{ success: true }` after reordering.
**Sample Response:**
```json
{
  "success": true
}
```

---

### GET /api/reference/items
**Handler:** `server/routes/itemsReference.ts:6`
**Description:** Fetch active item definitions from the current reference data.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of active items (filtered where `active === 1`).
**Sample Response:**
```json
[
  {
    "id": "ion_anchor",
    "name": "Ion Anchor",
    "description": "Stabilizes the ship during gravity storms.",
    "active": 1
  }
]
```

---

### GET /api/admin/items
**Handler:** `server/routes/itemsAdmin.ts:9`
**Description:** Admin listing of all item records.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.getItems()`.
**Sample Response:**
```json
[
  {
    "id": "ion_anchor",
    "name": "Ion Anchor",
    "description": "Stabilizes the ship during gravity storms.",
    "tags": ["defense"],
    "active": 1
  }
]
```

---

### POST /api/admin/items
**Handler:** `server/routes/itemsAdmin.ts:19`
**Description:** Create a new item record.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body forwarded to `storage.createItem()`.
**Response:** Newly created item row.
**Sample Response:**
```json
{
  "id": "chrono_flare",
  "name": "Chrono Flare",
  "description": "Briefly slows time around the ship.",
  "tags": ["utility"],
  "active": 1
}
```

---

### PUT /api/admin/items/:id
**Handler:** `server/routes/itemsAdmin.ts:29`
**Description:** Update an existing item by ID.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body with item updates.
**Response:** Updated item row from storage.
**Sample Response:**
```json
{
  "id": "chrono_flare",
  "name": "Chrono Flare",
  "description": "Slows time around the ship for 10s.",
  "tags": ["utility"],
  "active": 1
}
```

---

### GET /api/reference/events
**Handler:** `server/routes/eventsReference.ts:6`
**Description:** Return active event definitions from the reference snapshot.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of events where `active === 1`.
**Sample Response:**
```json
[
  {
    "id": "event_methane_storm",
    "name": "Methane Storm",
    "segment": "Arrival on Uranus",
    "skill": "engineering",
    "dc": 15,
    "active": 1
  }
]
```

---

### GET /api/admin/events
**Handler:** `server/routes/eventsAdmin.ts:9`
**Description:** Admin listing of all game events.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.getAllEvents()`.
**Sample Response:**
```json
[
  {
    "id": "event_methane_storm",
    "name": "Methane Storm",
    "segment": "Arrival on Uranus",
    "skill": "engineering",
    "dc": 15,
    "active": 1
  }
]
```

---

### POST /api/admin/events
**Handler:** `server/routes/eventsAdmin.ts:19`
**Description:** Create a new event definition.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body accepts fields such as `name`, `segment`, `skill`, `dc`, `triggerCondition`, `passEffect`, `failEffect`, `tags`, `active`.
**Response:** Newly created event row.
**Sample Response:**
```json
{
  "id": "event_gravity_rift",
  "name": "Gravity Rift",
  "segment": "En route to Uranus",
  "skill": "navigation",
  "dc": 16,
  "active": 1
}
```

---

### PUT /api/admin/events/:id
**Handler:** `server/routes/eventsAdmin.ts:40`
**Description:** Update an event with selective field changes.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body may include any event attributes to modify.
**Response:** Updated event row from storage.
**Sample Response:**
```json
{
  "id": "event_gravity_rift",
  "name": "Gravity Rift",
  "segment": "En route to Uranus",
  "skill": "navigation",
  "dc": 18,
  "active": 1
}
```

---

### GET /api/reference/npc_templates
**Handler:** `server/routes/npcTemplatesReference.ts:6`
**Description:** Return active NPC templates from the current reference data.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of NPC templates filtered by `active === 1`.
**Sample Response:**
```json
[
  {
    "id": "npc_helia",
    "name": "Helia Quill",
    "role": "Navigator",
    "active": 1
  }
]
```

---

### GET /api/admin/npc_templates
**Handler:** `server/routes/npcTemplatesAdmin.ts:9`
**Description:** Admin listing of NPC templates.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.getNpcTemplates()`.
**Sample Response:**
```json
[
  {
    "id": "npc_helia",
    "name": "Helia Quill",
    "role": "Navigator",
    "tags": ["crew"],
    "active": 1
  }
]
```

---

### POST /api/admin/npc_templates
**Handler:** `server/routes/npcTemplatesAdmin.ts:19`
**Description:** Create a new NPC template.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body forwarded to `storage.createNpcTemplate()`.
**Response:** Newly created NPC template row.
**Sample Response:**
```json
{
  "id": "npc_orin",
  "name": "Orin Voss",
  "role": "Engineer",
  "tags": ["crew"],
  "active": 1
}
```

---

### PUT /api/admin/npc_templates/:id
**Handler:** `server/routes/npcTemplatesAdmin.ts:29`
**Description:** Update an NPC template by ID.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body with template updates.
**Response:** Updated NPC template row.
**Sample Response:**
```json
{
  "id": "npc_orin",
  "name": "Orin Voss",
  "role": "Chief Engineer",
  "tags": ["crew"],
  "active": 1
}
```

---

### GET /api/reference/prompt_templates
**Handler:** `server/routes/promptTemplatesReference.ts:6`
**Description:** Retrieve prompt templates from the current reference release.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of prompt template documents.
**Sample Response:**
```json
[
  {
    "name": "turn_summary",
    "description": "Narrative turn summary",
    "active": true
  }
]
```

---

### GET /api/admin/prompt_templates
**Handler:** `server/routes/promptTemplatesAdmin.ts:9`
**Description:** Admin listing of all prompt templates.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.getAllPromptTemplates()`.
**Sample Response:**
```json
[
  {
    "id": "prompt_turn_summary",
    "name": "turn_summary",
    "description": "Narrative turn summary",
    "active": true
  }
]
```

---

### GET /api/admin/prompt_templates/:name
**Handler:** `server/routes/promptTemplatesAdmin.ts:19`
**Description:** Fetch the active prompt template by name.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `name`.
**Response:** Prompt template JSON or 404 when not found.
**Sample Response:**
```json
{
  "id": "prompt_turn_summary",
  "name": "turn_summary",
  "content": "Summarize the latest turn...",
  "active": true
}
```

---

### PUT /api/admin/prompt_templates/:id
**Handler:** `server/routes/promptTemplatesAdmin.ts:32`
**Description:** Update a prompt template's content, system prompt, description, or active flag.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body fields such as `content`, `systemContent`, `inheritGlobalPrompt`, `description`, `active`.
**Response:** Updated prompt template row.
**Sample Response:**
```json
{
  "id": "prompt_turn_summary",
  "name": "turn_summary",
  "description": "Narrative turn summary",
  "active": true,
  "updatedAt": "2025-11-03T02:44:12.000Z"
}
```

---

### GET /api/reference/image_prompts
**Handler:** `server/routes/imagePromptsReference.ts:6`
**Description:** Fetch active image prompt definitions from current reference data.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of image prompts with `active === 1`.
**Sample Response:**
```json
[
  {
    "id": "prompt_aurora_bridge",
    "templateName": "uranus_dawn_bridge",
    "active": 1
  }
]
```

---

### GET /api/admin/image_prompts
**Handler:** `server/routes/imagePromptsAdmin.ts:9`
**Description:** Admin listing of stored image prompts.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.getImagePrompts()`.
**Sample Response:**
```json
[
  {
    "id": "prompt_aurora_bridge",
    "templateName": "uranus_dawn_bridge",
    "modifiers": { "diffusion": "cyan glow" },
    "active": 1
  }
]
```

---

### POST /api/admin/image_prompts
**Handler:** `server/routes/imagePromptsAdmin.ts:19`
**Description:** Create a new image prompt definition.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body forwarded to `storage.createImagePrompt()`.
**Response:** Newly created image prompt row.
**Sample Response:**
```json
{
  "id": "prompt_void_rift",
  "templateName": "uranus_dawn_bridge",
  "prompt": "Describe the starfield beyond the observation deck...",
  "modifiers": { "diffusion": "violet aurora" },
  "active": 1
}
```

---

### PUT /api/admin/image_prompts/:id
**Handler:** `server/routes/imagePromptsAdmin.ts:29`
**Description:** Update an existing image prompt.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body with prompt updates.
**Response:** Updated image prompt row.
**Sample Response:**
```json
{
  "id": "prompt_void_rift",
  "templateName": "uranus_dawn_bridge",
  "prompt": "Describe the starfield beyond the observation deck...",
  "modifiers": { "diffusion": "violet aurora", "transformer": "wide-angle" },
  "active": 1
}
```

---

### GET /api/reference/story-themes
**Handler:** `server/routes/storyThemesReference.ts:6`
**Description:** Return active story themes from reference data (mirrors `storage.getActiveStoryThemes()` output shape).
**Middlewares:** None (public)
**Params:** None
**Response:** Array of story theme entries where `active === 1`.
**Sample Response:**
```json
[
  {
    "id": "theme_discovery",
    "storyThemeKey": "discovery",
    "label": "Discovery",
    "active": 1
  }
]
```

---

### GET /api/reference/visual-styles
**Handler:** `server/routes/visualStylesReference.ts:6`
**Description:** Return active visual styles from reference data with diffusion/transformer modifiers.
**Middlewares:** None (public)
**Params:** None
**Response:** Array of visual style entries where `active === 1`.
**Sample Response:**
```json
[
  {
    "id": "style_neo_deco",
    "visualStyleKey": "neo_deco",
    "label": "Neo Deco",
    "modifiersDiffusion": "cyan ambient glow",
    "active": 1
  }
]
```

---

### GET /api/admin/mod-story-themes
**Handler:** `server/routes/storyThemesAdmin.ts:9`
**Description:** Admin listing of mod-managed story themes.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.listStoryThemes()`.
**Sample Response:**
```json
[
  {
    "id": "theme_discovery",
    "storyThemeKey": "discovery",
    "label": "Discovery",
    "active": 1
  }
]
```

---

### POST /api/admin/mod-story-themes
**Handler:** `server/routes/storyThemesAdmin.ts:22`
**Description:** Upsert a story theme record.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body forwarded to `storage.upsertStoryTheme()`.
**Response:** Upserted story theme row.
**Sample Response:**
```json
{
  "id": "theme_survival",
  "storyThemeKey": "survival",
  "label": "Survival",
  "active": 1
}
```

---

### PUT /api/admin/mod-story-themes/:id
**Handler:** `server/routes/storyThemesAdmin.ts:31`
**Description:** Update a specific story theme by ID.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body includes fields to upsert (merged with `id`).
**Response:** Updated story theme row.
**Sample Response:**
```json
{
  "id": "theme_survival",
  "storyThemeKey": "survival",
  "label": "Survival",
  "active": 1
}
```

---

### DELETE /api/admin/mod-story-themes/:id
**Handler:** `server/routes/storyThemesAdmin.ts:41`
**Description:** Deactivate a story theme.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`.
**Response:** `{ success: true }` after deactivation.
**Sample Response:**
```json
{
  "success": true
}
```

---

### GET /api/admin/mod-visual-styles
**Handler:** `server/routes/visualStylesAdmin.ts:9`
**Description:** Admin listing of mod-managed visual styles.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** None
**Response:** Array from `storage.listVisualStyles()`.
**Sample Response:**
```json
[
  {
    "id": "style_neo_deco",
    "visualStyleKey": "neo_deco",
    "label": "Neo Deco",
    "active": 1
  }
]
```

---

### POST /api/admin/mod-visual-styles
**Handler:** `server/routes/visualStylesAdmin.ts:22`
**Description:** Upsert a visual style record.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Body forwarded to `storage.upsertVisualStyle()`.
**Response:** Upserted visual style row.
**Sample Response:**
```json
{
  "id": "style_void_rave",
  "visualStyleKey": "void_rave",
  "label": "Void Rave",
  "active": 1
}
```

---

### PUT /api/admin/mod-visual-styles/:id
**Handler:** `server/routes/visualStylesAdmin.ts:31`
**Description:** Update a visual style by ID.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`; Body with fields to upsert (merged with `id`).
**Response:** Updated visual style row.
**Sample Response:**
```json
{
  "id": "style_void_rave",
  "visualStyleKey": "void_rave",
  "label": "Void Rave",
  "active": 1
}
```

---

### DELETE /api/admin/mod-visual-styles/:id
**Handler:** `server/routes/visualStylesAdmin.ts:41`
**Description:** Deactivate a visual style.
**Middlewares:** `requireAdmin` (router-level; admin session required)
**Params:** Path `id`.
**Response:** `{ success: true }` after deactivation.
**Sample Response:**
```json
{
  "success": true
}
```

---

### GET /api/reference/settings
**Handler:** `server/routes/settingsReference.ts:6`
**Description:** Expose reference-backed system settings snapshot.
**Middlewares:** None (public)
**Params:** None
**Response:** Settings object from `getCurrentReference()`.
**Sample Response:**
```json
{
  "feature_flags": { "llmLogging": true },
  "image_defaults": { "size": "1024x1024" }
}
```

---

### GET /api/reference/system-defaults
**Handler:** `server/routes/systemDefaultsReference.ts:6`
**Description:** Provide system default values from the current reference release.
**Middlewares:** None (public)
**Params:** None
**Response:** Object of `system_defaults` values.
**Sample Response:**
```json
{
  "theme": "Discovery",
  "style": "Neo Deco",
  "image_model_key": "dall-e-3"
}
```

---

### GET /api/admin/pipeline/context
**Handler:** `server/routes.ts:1369`
**Description:** Admin endpoint to load game/turn context for pipeline operations.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `gameId?`, `turnNumber?`, `fixture?`, `fixtureId?`, `playerAction?`, `checks?`, `triggeredEvent?`.
**Response:** JSON containing `contextId`, game info, preferences, turn summary, and template variables.
**Sample Response:**
```json
{
  "contextId": "ctx_abc123",
  "game": {
    "id": "game_3f2c7d",
    "username": "captain-elara",
    "turnNumber": 4,
    "day": 2,
    "segment": "En route to Uranus"
  },
  "preferences": {
    "theme": "Discovery",
    "style": "Neo Deco"
  },
  "turnSummary": {
    "turnNumber": 4,
    "action": "Navigate through asteroid field",
    "narration": "The ship glides gracefully..."
  },
  "templateVariables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery"
  },
  "source": { "type": "game", "id": "game_3f2c7d" }
}
```

---

### POST /api/admin/pipeline/context/custom
**Handler:** `server/routes.ts:1518`
**Description:** Admin endpoint to create ad-hoc pipeline context from custom game state.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ gameState, userPreferences?, playerAction?, checks?, triggeredEvent?, masterEnrichment? }`.
**Response:** JSON containing `contextId` and context metadata.
**Sample Response:**
```json
{
  "contextId": "ctx_xyz789",
  "game": {
    "id": "game_custom",
    "username": "test-user",
    "turnNumber": 1,
    "day": 1,
    "segment": "Launch from Earth"
  },
  "preferences": {
    "theme": "Discovery",
    "style": "Neo Deco"
  },
  "templateVariables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery"
  },
  "source": { "type": "custom" }
}
```

---

### GET /api/admin/games/search
**Handler:** `server/routes.ts:1630`
**Description:** Admin endpoint to search games by username or game ID.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `q` (search pattern, min 2 chars), `limit?` (defaults to 20).
**Response:** JSON containing array of matching games.
**Sample Response:**
```json
{
  "games": [
    {
      "id": "game_3f2c7d",
      "username": "captain-elara",
      "turnNumber": 4,
      "day": 2,
      "segment": "En route to Uranus",
      "isComplete": false
    }
  ]
}
```

---

### GET /api/admin/pipeline/fixtures
**Handler:** `server/routes.ts:1689`
**Description:** Admin endpoint to list or retrieve pipeline fixture contexts.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `id?` (specific fixture ID).
**Response:** If `id` provided, returns fixture data; otherwise returns list of available fixtures.
**Sample Response:**
```json
{
  "fixtures": [
    {
      "id": "fresh_game",
      "name": "Fresh Game",
      "description": "A new game starting state",
      "legacyId": "fixture_1"
    }
  ]
}
```

---

### GET /api/admin/pipeline/template-variables
**Handler:** `server/routes.ts:1723`
**Description:** Admin endpoint to get sample template variables for scenario builder.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `fixtureId?` (defaults to first available fixture).
**Response:** JSON containing game state, preferences, and template variables from fixture.
**Sample Response:**
```json
{
  "baseFixture": "fresh_game",
  "gameState": {
    "id": "game_fixture",
    "turnNumber": 0
  },
  "userPreferences": {
    "theme": "Discovery",
    "style": "Neo Deco"
  },
  "playerAction": "Assess the situation carefully",
  "checks": [],
  "triggeredEvent": null,
  "templateVariables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery"
  }
}
```

---

### POST /api/admin/pipeline/run-stage
**Handler:** `server/routes.ts:1779`
**Description:** Admin endpoint to execute a single pipeline stage (master, narrative, image, or actions).
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ contextId: string, stage: "master" | "narrative" | "image" | "actions", overrides?, forceLegacy? }`.
**Response:** JSON containing stage result, timeline, and applied overrides.
**Sample Response:**
```json
{
  "stageResult": {
    "ok": true,
    "output": {
      "narration": "The ship glides through space..."
    },
    "metadata": [
      {
        "stage": "narrative",
        "durationMs": 1234,
        "template": "turn_summary"
      }
    ]
  },
  "timeline": [
    {
      "id": "narrative",
      "title": "Narrative",
      "status": "success",
      "durationMs": 1234,
      "template": "turn_summary",
      "timestamp": "2025-11-03T02:45:00.000Z"
    }
  ],
  "appliedOverrides": {
    "variables": {}
  }
}
```

---

### POST /api/admin/pipeline/run-all
**Handler:** `server/routes.ts:1959`
**Description:** Admin endpoint to execute the full pipeline (all stages in sequence).
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ contextId: string, overrides? }`.
**Response:** JSON containing results for all stages (master, narrative, image, actions), prompt chain, and diff with existing turn.
**Sample Response:**
```json
{
  "master": {
    "ok": true,
    "output": { "enrichment": {} },
    "metadata": []
  },
  "narrative": {
    "ok": true,
    "output": { "narration": "The ship glides..." },
    "metadata": []
  },
  "image": {
    "ok": true,
    "output": { "imagePrompt": "A spaceship in deep space..." },
    "metadata": []
  },
  "actions": {
    "ok": true,
    "output": { "actions": [] },
    "metadata": []
  },
  "promptChain": [],
  "diff": {
    "narrative": {
      "old": "Previous narration",
      "new": "The ship glides..."
    }
  },
  "appliedOverrides": {
    "variables": {}
  }
}
```

---

### POST /api/admin/pipeline/preview/apply
**Handler:** `server/routes.ts:2043`
**Description:** Admin endpoint to apply pipeline results to a game turn.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Body `{ contextId: string, pipelineResult: { narrative?, image?, actions?, master? } }`.
**Response:** HTTP 204 No Content on success.
**Sample Response:**
_No content (204 status)_

---

### GET /api/admin/pipeline/logs
**Handler:** `server/routes.ts:2094`
**Description:** Admin endpoint to query LLM logs for a pipeline context.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `contextId: string`, `limit?` (defaults to 50), `after?` (ISO timestamp).
**Response:** Array of pipeline log entries with stage, type, and snippets.
**Sample Response:**
```json
[
  {
    "id": "log_01H",
    "stage": "narrative",
    "type": "llm",
    "timestamp": "2025-11-03T02:45:00.000Z",
    "status": "ok",
    "requestSnippet": "Generate narrative...",
    "responseSnippet": "The ship glides...",
    "metadata": {}
  }
]
```

---

### GET /api/admin/pipeline/variables
**Handler:** `server/routes.ts:2175`
**Description:** Admin endpoint to resolve template variables for a specific pipeline stage.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `contextId: string`, `stage: "master" | "narrative" | "image" | "actions"`.
**Response:** JSON containing resolved variables and flattened master enrichment (if applicable).
**Sample Response:**
```json
{
  "variables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery",
    "TURN_NUMBER": 7
  },
  "flattened": {
    "theme": "Discovery",
    "style": "Neo Deco"
  }
}
```

---

### GET /api/admin/pipeline/stage-result
**Handler:** `server/routes.ts:2255`
**Description:** Admin endpoint to retrieve cached stage result for a pipeline context.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `contextId: string`, `stage: "master" | "narrative" | "image" | "actions"`.
**Response:** JSON containing the stage result with output and metadata.
**Sample Response:**
```json
{
  "ok": true,
  "output": {
    "narration": "The ship glides through space..."
  },
  "metadata": [
    {
      "stage": "narrative",
      "durationMs": 1234,
      "template": "turn_summary"
    }
  ]
}
```

---

### GET /api/admin/pipeline/resolved-prompt
**Handler:** `server/routes.ts:2292`
**Description:** Admin endpoint to get the resolved prompt template for a pipeline stage.
**Middlewares:** `requireAdmin` (admin session required)
**Params:** Query `contextId: string`, `stage: "master" | "narrative" | "image" | "actions"`.
**Response:** JSON containing the resolved prompt, variables used, and variable usage list.
**Sample Response:**
```json
{
  "prompt": "You are the narrative engine...",
  "variables": {
    "STYLE": "Neo Deco",
    "THEME": "Discovery"
  },
  "variableUsage": ["STYLE", "THEME", "TURN_NUMBER"]
}
```

---

### GET /__test__/setup-session
**Handler:** `server/__tests__/api/gameFlow.test.ts:142`
**Description:** Test-only helper endpoint to seed an authenticated session during integration tests.
**Middlewares:** None (test harness only; not exposed in production builds)
**Params:** None
**Response:** `{ ok: true }` after populating the in-memory session.
**Sample Response:**
```json
{
  "ok": true
}
```

---
