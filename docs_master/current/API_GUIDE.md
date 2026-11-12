# API Guide
_Comprehensive technical documentation for Quest to Uranus API_

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** 2025-01-08 UTC

---

## Table of Contents

1. [Context & Overview](#context--overview)
2. [Technical Details](#technical-details)
3. [Practical Guidance](#practical-guidance)
4. [Troubleshooting & Support](#troubleshooting--support)
5. [Standards & Processes](#standards--processes)
6. [Visual Aids & Diagrams](#visual-aids--diagrams)
7. [Cross-References](#cross-references)

---

## Context & Overview

### What is the Quest to Uranus API?

The Quest to Uranus API is a RESTful HTTP API with WebSocket support that powers an AI-driven narrative space exploration game. It provides endpoints for game state management, content generation, user authentication, and administrative operations. The API serves as the bridge between the React-based client application and the game's backend services, orchestrating turn processing, image generation, and content delivery.

### Why It Exists

The API exists to:

1. **Decouple client and server logic** - Enables independent scaling and deployment of frontend and backend components
2. **Enable asynchronous game processing** - Turn actions are processed asynchronously via job queues, allowing the client to remain responsive during LLM calls and image generation
3. **Provide content versioning** - Reference release system allows content updates without code deployments
4. **Ensure security and reliability** - Layered security controls, rate limiting, and transactional guarantees protect both the system and player data
5. **Support game mechanics** - Provides structured endpoints for turn-based gameplay, equipment management, skill checks, and narrative progression

### Purpose Within the Larger System

The API sits at the center of a multi-agent architecture (see [`AGENTS.md`](../AGENTS.md)):

- **Gateway & Security Agent** - Terminates HTTP connections, enforces security policies
- **Game Orchestrator Agent** - Routes requests, validates input, coordinates background services
- **Data Persistence Agent** - Manages transactional database operations
- **Turn Processor Agent** - Executes queued player actions asynchronously
- **Image Processor Agent** - Generates and caches scene imagery
- **Reference Steward Agent** - Manages versioned content releases
- **Maintenance & Observability Agent** - Provides health checks and metrics

The API coordinates these agents through HTTP endpoints, WebSocket events, and job queue enqueuing.

---

## Technical Details

### Components, Structure, and Architecture

#### API Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Application                        │
│              (React + React Query + Socket.IO)              │
└──────────────────────┬──────────────────────────────────────┘
                        │ HTTP/WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Gateway & Security Agent                        │
│  • Helmet CSP, CSRF Protection                               │
│  • Rate Limiting                                             │
│  • JWT Cookie Authentication                                  │
│  • Security Logging                                          │
└──────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│            Game Orchestrator Agent (routes.ts)               │
│  • Route Registration                                        │
│  • Request Validation                                        │
│  • Job Enqueuing                                            │
│  • WebSocket Event Broadcasting                             │
└──────────────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Storage    │ │ Orchestrator │ │  AI Service  │
│   (Postgres) │ │   (Queues)   │ │   (LLM/Img)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

#### Request Flow Patterns

**Synchronous Operations** (Immediate Response)
- Game state retrieval (`GET /api/game/:id`)
- User preferences (`GET /api/user/preferences`)
- Reference data (`GET /api/reference/*`)
- Health checks (`GET /api/health`)

**Asynchronous Operations** (Job Queue Pattern)
- Turn actions (`POST /api/game/action`) → Enqueues turn job → Returns `{ turnJobId, status: 'processing' }` → WebSocket notification on completion
- Image generation (`POST /api/generate-image`) → Enqueues image job → Returns immediately → WebSocket notification when ready

**WebSocket Events**
- `turnComplete` - Emitted when a turn job completes
- `imageReady` - Emitted when an image is generated/cached
- `imageFailed` - Emitted when image generation fails

#### Endpoint Categories

1. **Game Lifecycle** (`/api/game/*`, `/api/games/*`)
   - Start, retrieve, update, delete game states
   - Submit actions, manage equipment, update settings
   - All require authentication and ownership verification

2. **Reference Data** (`/api/reference/*`)
   - Public, read-only endpoints serving versioned content
   - Items, events, NPCs, prompts, themes, styles
   - Filesystem-cached for performance

3. **Admin Content Management** (`/api/admin/*`)
   - Full CRUD operations on game content
   - Reference release publishing and activation

4. **User Management** (`/api/user/*`)
   - Authentication, preferences, profile management
   - JWT cookie-based authentication (`auth_token`)

5. **Image Generation** (`/api/generate-image`, `/api/test-generate-image`)
   - Cache-aware image generation
   - Template-based scene rendering

6. **System Operations** (`/api/health`, `/metrics`, `/api/csrf-token`)
   - Health checks, metrics, security tokens

### Technologies, Tools, and Frameworks

**Core Stack:**
- **Express.js** - HTTP server framework
- **Socket.IO** - WebSocket server for real-time notifications
- **PostgreSQL** - Primary data store with `pg` driver
- **TypeScript** - Type-safe implementation
- **Zod** - Runtime schema validation

**Security & Middleware:**
- **Helmet** - HTTP security headers (CSP, XSS protection)
- **csurf** - CSRF token validation
- **cookie-parser** + custom `jwtMiddleware` - Parse cookies and attach `req.user`
- **jsonwebtoken** - Signing and verifying stateless auth tokens
- **express-rate-limit** - Rate limiting middleware

**Background Processing:**
- **Custom Orchestrator** - Postgres-based job queue system
- **Workers** - TurnPrecomputeWorker, TurnApplyWorker, ImageWorker

**AI Integration:**
- **OpenAI SDK** - LLM completions and image generation
- **Custom Prompt Builder** - PCE (Prompt Composition Engine)

**Observability:**
- **Prometheus Client** - Metrics collection
- **Custom Logging** - File-backed with security event tracking

### Relationships and Interactions

#### Authentication Flow

```
Client Request
    │
    ├─→ GET /api/csrf-token (if CSRF enabled)
    │   └─→ Returns { csrfToken: "..." }
    │
├─→ PUT /api/user { username }
│   └─→ Creates/retrieves user
│   └─→ Issues signed JWT `auth_token` cookie
│
└─→ Subsequent requests include:
    • `auth_token` cookie (automatic)
    • X-CSRF-Token header (for state-changing requests)
    • Authorization: Bearer <token> (for admin endpoints)
```

#### Turn Processing Flow

```
1. Client: POST /api/game/action { gameId, action, ... }
   │
   ├─→ Game Orchestrator validates request
   ├─→ Verifies game ownership
   ├─→ Creates turn job in database
   ├─→ Enqueues job to 'turn-precompute' queue
   └─→ Returns { turnJobId, status: 'processing' }

2. TurnPrecomputeWorker claims job
   │
   ├─→ Loads game state
   ├─→ Executes deterministic checks
   ├─→ Calls LLM for narrative generation
   ├─→ Creates provisional manifest
   └─→ Enqueues to 'turn-apply' queue

3. TurnApplyWorker claims job
   │
   ├─→ Loads manifest
   ├─→ Applies turn logic in transaction
   ├─→ Updates game state atomically
   └─→ Emits 'turnComplete' WebSocket event

4. Client receives WebSocket event
   │
   └─→ Invalidates React Query cache
   └─→ UI updates with new game state
```

#### Reference Data Flow

```
Content Team
    │
    ├─→ Admin UI: POST /api/admin/items { ... }
    │   └─→ Writes to database
    │
    ├─→ Admin UI: POST /api/admin/reference/publish/:version
    │   └─→ Snapshot database → filesystem release
    │
    └─→ Admin UI: POST /api/admin/reference/:version/activate
        └─→ Updates 'releases/current' symlink

Game Runtime
    │
    └─→ GET /api/reference/items
        └─→ Reads from filesystem cache
        └─→ Zero database queries
        └─→ Fast, deterministic, scalable
```

### Configurations and Parameters

#### Environment Variables

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` (or `JWT_SECRET`) - Secret for JWT signing

**Security:**
- `CSRF_ENABLED` - Enable/disable CSRF protection (default: `true`)
- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting (default: `true`)
- `ADMIN_API_KEYS` - Comma-separated admin API keys
- `ALLOWED_ORIGINS` - Comma-separated CORS origins for Socket.IO

**AI Integration:**
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI API base URL
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key

**Feature Flags:**
- `DISABLE_ORCHESTRATOR_ENQUEUE` - Disable job queue (for testing)
- `NODE_ENV` - Environment mode (`development` | `production`)

#### Rate Limit Profiles

Defined in `server/middleware/rateLimiting.ts`:

- **Global Rate Limit**: 100 requests per 15 minutes per IP
- **Game Start Rate Limit**: 5 requests per 15 minutes per authenticated user (falls back to IP)
- **Game Read Rate Limit**: 200 requests per 15 minutes per authenticated user (falls back to IP)
- **Game Action Rate Limit**: 20 requests per 15 minutes per authenticated user (falls back to IP)
- **Image Generation Rate Limit**: 20 requests per minute per IP

#### JWT Cookie Configuration

- **Name**: `auth_token`
- **Max Age**: 24 hours
- **Cookie Flags**: `HttpOnly`, `SameSite=Lax`, `Secure` in production
- **Storage**: Stateless JWT signed with `SESSION_SECRET`/`JWT_SECRET`
- **Refresh**: Client re-calls `PUT /api/user` when token expires

---

## Practical Guidance

### Step-by-Step Instructions

#### Starting a New Game

```typescript
// 1. Ensure auth cookie exists (issues JWT)
const userResponse = await fetch('/api/user', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'captain-elara' }),
  credentials: 'include'
});

// 2. Start game
const gameResponse = await fetch('/api/game/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': await getCSRFToken()
  },
  body: JSON.stringify({
    // Optional: initial preferences
  }),
  credentials: 'include'
});

const gameState = await gameResponse.json();
// { id, username, turnNumber, day, segment, ... }
```

#### Submitting a Turn Action

```typescript
// 1. Submit action (returns immediately)
const actionResponse = await fetch('/api/game/action', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': await getCSRFToken()
  },
  body: JSON.stringify({
    gameId: 'game_3f2c7d',
    action: 'Navigate through the asteroid field',
    intent: 'explore',
    risk: 'Risky'
  }),
  credentials: 'include'
});

const { turnJobId, status } = await actionResponse.json();
// { turnJobId: 'turnjob_abc123', status: 'processing' }

// 2. Listen for WebSocket completion
socket.on('turnComplete', ({ gameId, turnNumber }) => {
  if (gameId === 'game_3f2c7d') {
    // Invalidate React Query cache
    queryClient.invalidateQueries(['game', gameId]);
    // UI will refetch and display new state
  }
});
```

#### Updating Equipment

```typescript
const response = await fetch('/api/games/game_3f2c7d/equipped-items', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': await getCSRFToken()
  },
  body: JSON.stringify({
    equippedItems: ['stasis_charm', 'quantum_fork', 'gravity_boots']
  }),
  credentials: 'include'
});

const updatedGame = await response.json();
// Equipment validated against active reference items
// Max 3 items enforced
```

#### Accessing Reference Data

```typescript
// Public endpoint, no authentication required
const itemsResponse = await fetch('/api/reference/items');
const items = await itemsResponse.json();
// Array of active items from current reference release

const eventsResponse = await fetch('/api/reference/events');
const events = await eventsResponse.json();
// Array of active events from current reference release
```

### Code Examples and Usage Patterns

#### React Query Integration

```typescript
// client/src/hooks/useGameLogic.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { socket } from '@/lib/socket';

export function useGame(gameId: string) {
  const queryClient = useQueryClient();
  
  // Subscribe to WebSocket events
  useEffect(() => {
    socket.on('turnComplete', ({ gameId: eventGameId, turnNumber }) => {
      if (eventGameId === gameId) {
        queryClient.invalidateQueries(['game', gameId]);
      }
    });
    
    return () => {
      socket.off('turnComplete');
    };
  }, [gameId, queryClient]);
  
  return useQuery({
    queryKey: ['game', gameId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/game/${gameId}`);
      return res.json();
    }
  });
}

export function useSubmitAction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (action: ActionInput) => {
      const res = await apiRequest('POST', '/api/game/action', action);
      return res.json();
    },
    onSuccess: (data, variables) => {
      // Optimistic update or show loading state
      // WebSocket will trigger actual refresh
    }
  });
}
```

#### Error Handling Pattern

```typescript
async function apiRequestWithRetry(
  method: string,
  url: string,
  data?: unknown,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await apiRequest(method, url, data);
      
      if (response.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      // Network error - retry with backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  
  throw new Error('Max retries exceeded');
}
```

#### Admin API Usage

```typescript
// Admin endpoints require Bearer token
const adminHeaders = {
  'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`,
  'Content-Type': 'application/json'
};

// Publish new reference release
const publishResponse = await fetch('/api/admin/reference/publish/2025.11', {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    author: 'content-team',
    notes: 'Adds new NPC templates',
    makeCurrent: false
  })
});

// Activate release
const activateResponse = await fetch('/api/admin/reference/2025.11/activate', {
  method: 'POST',
  headers: adminHeaders
});
```

### Best Practices and Guidelines

#### For Game Mechanics Integration

1. **Always use reference endpoints for runtime data**
   - `/api/reference/*` endpoints are filesystem-cached and deterministic
   - Zero database load during gameplay
   - Content updates require reference release activation

2. **Handle asynchronous operations correctly**
   - Turn actions return immediately with `turnJobId`
   - Listen for WebSocket events to detect completion
   - Don't poll for job status - use WebSocket notifications

3. **Validate client-side, trust server-side**
   - Client can validate equipment limits, action formats
   - Server enforces ownership, validates against reference data
   - Never trust client data for security decisions

4. **Use transactions for state updates**
   - Equipment updates, turn processing use `processTurnWithTransaction`
   - Ensures atomicity and prevents race conditions

#### For API Consumers

1. **Respect rate limits**
   - Implement exponential backoff on 429 responses
   - Cache reference data client-side
   - Batch operations when possible

2. **Handle WebSocket reconnection**
   - Rejoin game rooms on reconnect
   - Re-validate game state after connection loss
   - Show connection status to users

3. **CSRF token management**
   - Fetch token before state-changing requests
   - Include in `X-CSRF-Token` header
   - Handle token expiration gracefully

4. **Error handling**
   - Distinguish between 4xx (client error) and 5xx (server error)
   - Log errors with context (gameId, turnNumber, etc.)
   - Provide user-friendly error messages

#### For Content Management

1. **Reference release workflow**
   - Make changes via admin endpoints
   - Test in staging environment
   - Publish as new version
   - Activate when ready (can rollback by activating previous version)

2. **Content validation**
   - Validate theme/style keys against active catalogs
   - Ensure item IDs exist before referencing
   - Test image prompts before publishing

### Common Patterns and Conventions

#### Request/Response Patterns

**Standard Success Response:**
```json
{
  "id": "resource_id",
  "field1": "value1",
  "field2": "value2"
}
```

**Job Enqueue Response:**
```json
{
  "turnJobId": "turnjob_abc123",
  "status": "processing"
}
```

**Error Response:**
```json
{
  "error": "Human-readable error message",
  "details": "Optional technical details"
}
```

**List Response:**
```json
[
  { "id": "item1", ... },
  { "id": "item2", ... }
]
```

#### WebSocket Event Patterns

**Turn Complete:**
```typescript
socket.on('turnComplete', (payload: { gameId: string; turnNumber: number }) => {
  // Invalidate cache, refetch game state
});
```

**Image Ready:**
```typescript
socket.on('imageReady', (payload: {
  jobId: string;
  gameId: string;
  turnNumber: number;
  imageUrl: string;
  imageTemplate: string;
  promptSource: string;
}) => {
  // Update UI with new image
});
```

**Image Failed:**
```typescript
socket.on('imageFailed', (payload: {
  jobId: string;
  gameId: string;
  turnNumber: number;
  error: string;
}) => {
  // Show error message, use fallback image
});
```

---

## Troubleshooting & Support

### Common Issues and Solutions

#### Issue: CSRF Token Errors

**Symptoms:**
- `403 Forbidden` on POST/PUT/DELETE requests
- Error message: "Invalid CSRF token"

**Solutions:**
1. Ensure `GET /api/csrf-token` is called before state-changing requests
2. Include token in `X-CSRF-Token` header (not in body)
3. Verify auth cookie is being sent (`credentials: 'include'`)
4. Check `CSRF_ENABLED` environment variable matches client expectations

**Debug Steps:**
```typescript
// Verify CSRF token retrieval
const tokenRes = await fetch('/api/csrf-token', { credentials: 'include' });
const { csrfToken, csrfEnabled } = await tokenRes.json();
console.log('CSRF enabled:', csrfEnabled, 'Token:', csrfToken);
```

#### Issue: Rate Limit Exceeded

**Symptoms:**
- `429 Too Many Requests` responses
- Rate limit headers in response

**Solutions:**
1. Implement exponential backoff
2. Reduce request frequency
3. Cache reference data client-side
4. Use WebSocket events instead of polling

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1704067200
```

#### Issue: Turn Job Stuck in Processing

**Symptoms:**
- Turn action returns `turnJobId` but WebSocket event never arrives
- Game state doesn't update

**Solutions:**
1. Check worker logs for errors
2. Verify orchestrator is running (`/api/health` shows queue metrics)
3. Check for dead-letter jobs: `GET /api/admin/queues/turn-apply/dead-letter`
4. Replay stuck job: `POST /api/admin/queues/turn-apply/dead-letter/:jobId/replay`

**Debug Steps:**
```typescript
// Check job status (admin only)
const jobRes = await fetch(`/api/admin/queues/turn-apply/dead-letter`, {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});
const deadLetterJobs = await jobRes.json();
```

#### Issue: Image Generation Fails

**Symptoms:**
- `imageFailed` WebSocket event received
- Image URL missing from turn data

**Solutions:**
1. Check OpenAI API key and quota
2. Verify image prompt is valid (not empty, proper format)
3. Check image cache for similar scenes (may indicate prompt issue)
4. Review image generation logs: `GET /api/llm-logs?gameId=...`

**Fallback Pattern:**
```typescript
socket.on('imageFailed', ({ gameId, turnNumber, error }) => {
  // Use fallback image template
  const fallbackUrl = `/generated_images/fallback_${turnNumber}.png`;
  updateGameStateImage(gameId, turnNumber, fallbackUrl);
});
```

#### Issue: Reference Data Not Updating

**Symptoms:**
- Changes via admin endpoints don't appear in `/api/reference/*`
- Old content still being served

**Solutions:**
1. Verify reference release was published: `GET /api/admin/reference/releases`
2. Check current active release: `GET /api/admin/reference/current`
3. Activate new release: `POST /api/admin/reference/:version/activate`
4. Clear reference cache (restart server if in-memory cache)

**Workflow:**
```typescript
// 1. Make changes via admin endpoints
await updateItem('item_id', { name: 'New Name' });

// 2. Publish release
await publishReference('2025.11', { author: 'team', makeCurrent: false });

// 3. Activate (when ready)
await activateReference('2025.11');

// 4. Verify
const current = await getCurrentReference();
console.log('Active release:', current.version);
```

### Error Messages and Their Meanings

| HTTP Status | Error Message | Meaning | Resolution |
|------------|---------------|---------|------------|
| 400 | "Game is already complete" | Attempted action on completed game | Start new game |
| 401 | "Not authenticated" | Missing or invalid auth token | Call `PUT /api/user` to refresh cookie |
| 403 | "Access denied" | Game doesn't belong to user | Verify game ownership |
| 404 | "Game not found" | Invalid game ID | Check game ID, verify user has access |
| 409 | "Duplicate idempotency key" | Job already enqueued | Wait for existing job to complete |
| 429 | "Too many requests" | Rate limit exceeded | Implement backoff, reduce frequency |
| 500 | "Failed to process action" | Server error | Check server logs, retry with backoff |
| 503 | "Admin API not configured" | Missing `ADMIN_API_KEYS` | Set environment variable |

### Debugging Tips and Strategies

#### Enable Detailed Logging

```typescript
// Server-side: Set log level
process.env.LOG_LEVEL = 'debug';

// Client-side: Enable React Query devtools
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

function App() {
  return (
    <>
      <YourApp />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  );
}
```

#### Inspect WebSocket Events

```typescript
// Log all Socket.IO events
socket.onAny((event, ...args) => {
  console.log('[Socket.IO]', event, args);
});

// Monitor specific game room
socket.emit('joinGame', 'game_3f2c7d');
socket.on('turnComplete', (payload) => {
  console.log('[Turn Complete]', payload);
});
```

#### Trace Request Flow

```typescript
// Add request ID to trace across services
const traceId = crypto.randomUUID();

const response = await fetch('/api/game/action', {
  method: 'POST',
  headers: {
    'X-Trace-Id': traceId,
    'Content-Type': 'application/json',
    'X-CSRF-Token': token
  },
  body: JSON.stringify(action)
});

// Server logs will include trace ID
// Check logs: grep "traceId: abc-123" server/logs/app-*.log
```

#### Health Check Diagnostics

```typescript
// Comprehensive health check
const health = await fetch('/api/health').then(r => r.json());

console.log('Database:', health.checks.database.status);
console.log('Queue depth:', health.checks.queues);
console.log('Memory:', health.checks.memory.heapUsedPercent);
console.log('Security events:', health.checks.security.eventsLastHour);

// If unhealthy, check:
// - Database connectivity
// - Queue worker status
// - Memory leaks
// - Security anomalies
```

---

## Standards & Processes

### Quality Requirements and Criteria

#### API Response Time Targets

- **Synchronous endpoints**: < 200ms (p95)
- **Job enqueue**: < 50ms (p95)
- **Reference data**: < 10ms (p95, filesystem cache)
- **Health check**: < 100ms (p95)

#### Availability Targets

- **Uptime**: 99.9% (excluding planned maintenance)
- **Error rate**: < 0.1% of requests
- **Queue processing**: < 5s average latency

#### Data Consistency

- **Game state updates**: Atomic transactions via `processTurnWithTransaction`
- **Reference data**: Immutable after activation (read-only)
- **Job processing**: Idempotent via manifest hashing

### Security Considerations

#### Authentication & Authorization

1. **JWT cookie auth** for players
   - `auth_token` HttpOnly cookie (secure in production, SameSite=Lax)
   - 24-hour expiration enforced via JWT `exp` claim
   - No server-side storage; tokens signed with `SESSION_SECRET`/`JWT_SECRET`

2. **Bearer token auth** for admins
   - `Authorization: Bearer <token>` header
   - Or `x-admin-token` header
   - Keys from `ADMIN_API_KEYS` environment variable
   - Rotate regularly

3. **Ownership verification**
   - All game endpoints verify `game.username === req.user!.username`
   - Prevents unauthorized access to other players' games

#### CSRF Protection

- Enabled by default (`CSRF_ENABLED=true`)
- Token required for state-changing requests (POST, PUT, DELETE, PATCH)
- Exempt endpoints: `/api/health`, `/metrics`, `/api/csrf-token`
- Token retrieved via `GET /api/csrf-token`

#### Input Validation

- **Zod schemas** for all request bodies
- **Path parameter validation** (UUID format, etc.)
- **Reference data validation** (active items, valid themes/styles)
- **Size limits**: 10MB JSON body, 5MB triggers security event

#### Rate Limiting

- **IP-based** for public/anonymous endpoints
- **User-based** identifiers for authenticated endpoints (`req.user?.userId || req.ip`)
- **Per-endpoint profiles** (game actions more restrictive than reads)
- **429 responses** with retry-after headers

#### Security Logging

- **Suspicious request detection** (bot patterns, scan attempts)
- **Oversized payload logging** (>5MB)
- **Rate limit hit tracking**
- **CSRF failure tracking**
- **Admin action audit trail**

### Performance Implications

#### Caching Strategy

1. **Reference data**: Filesystem cache, loaded at startup
   - Zero database queries during gameplay
   - Deterministic, versioned content
   - Fast, scalable

2. **User preferences**: In-memory cache in storage layer
   - Reduces database queries
   - Cache invalidation on update

3. **Image cache**: Fingerprint-based deduplication
   - Scene fingerprints prevent duplicate generation
   - File system storage with database metadata

#### Database Optimization

- **Indexed queries**: Game lookups by ID, user lookups by username
- **Connection pooling**: Reuse connections via `pg.Pool`
- **Transaction batching**: Multiple updates in single transaction
- **Read replicas**: Consider for read-heavy workloads (future)

#### Job Queue Performance

- **Lease-based processing**: Prevents duplicate processing
- **Idempotency keys**: Prevents duplicate enqueuing
- **Manifest hashing**: Detects state changes between precompute/apply
- **Worker scaling**: Multiple workers can process jobs in parallel

#### WebSocket Efficiency

- **Room-based broadcasting**: Only notify relevant clients
- **Event filtering**: Clients join game rooms, receive only their game events
- **Reconnection handling**: Automatic rejoin on disconnect

### Testing and Validation Approaches

#### Unit Testing

```typescript
// Example: Test route handler
describe('POST /api/game/action', () => {
  it('enqueues turn job and returns receipt', async () => {
    const response = await request(app)
      .post('/api/game/action')
      .set('Cookie', authCookie)
      .send({ gameId: 'test-game', action: 'Test action' });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('turnJobId');
    expect(response.body.status).toBe('processing');
  });
  
  it('rejects action on completed game', async () => {
    // Setup completed game
    // Attempt action
    // Verify 400 response
  });
});
```

#### Integration Testing

```typescript
// Test full turn processing flow
describe('Turn Processing Flow', () => {
  it('processes turn from action to completion', async () => {
    // 1. Start game
    const game = await startGame('test-user');
    
    // 2. Submit action
    const { turnJobId } = await submitAction(game.id, 'Test action');
    
    // 3. Wait for WebSocket event
    await waitForEvent('turnComplete', { gameId: game.id });
    
    // 4. Verify game state updated
    const updated = await getGame(game.id);
    expect(updated.turnNumber).toBe(1);
  });
});
```

#### Load Testing

```typescript
// Use k6 or similar for load testing
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp up
    { duration: '1m', target: 100 },   // Stay at 100
    { duration: '30s', target: 0 },   // Ramp down
  ],
};

export default function() {
  const res = http.get('https://api.example.com/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
}
```

#### Security Testing

1. **CSRF token validation**: Verify tokens are required and validated
2. **Rate limit enforcement**: Confirm limits are applied correctly
3. **Ownership verification**: Attempt to access other users' games
4. **Input validation**: Send malformed requests, verify rejection
5. **SQL injection**: Test parameterized queries (should be safe)

---

## Visual Aids & Diagrams

### Recommended Diagrams

#### 1. System Architecture Diagram

```
┌─────────────┐
│   Client    │
│  (React)    │
└──────┬──────┘
       │ HTTP/WS
       ▼
┌─────────────────────────────────────┐
│      Gateway & Security Agent       │
│  • Helmet, CSRF, Rate Limiting      │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│     Game Orchestrator Agent          │
│  • Route Registration                │
│  • Request Validation               │
│  • Job Enqueuing                    │
└──────┬──────────────────────────────┘
       │
   ┌───┴───┬──────────┬──────────┐
   ▼       ▼          ▼          ▼
┌─────┐ ┌─────┐  ┌────────┐ ┌──────┐
│Storage│ │Queue│  │AI Service│ │Socket│
│(Postgres)│ │(Jobs)│  │(LLM/Img)│ │(WS) │
└─────┘ └─────┘  └────────┘ └──────┘
```

#### 2. Turn Processing Sequence Diagram

```
Client          API          Precompute      Apply         Database
  │              │              │              │              │
  │──POST action─>│              │              │              │
  │<─{jobId}──────│              │              │              │
  │              │──enqueue────>│              │              │
  │              │              │──process────>│              │
  │              │              │              │──transaction─>│
  │              │              │              │<─updated──────│
  │              │              │              │              │
  │<─turnComplete──────────────────────────────│              │
  │              │              │              │              │
```

#### 3. Reference Data Flow Diagram

```
Admin UI          Database        Filesystem        Game Runtime
   │                 │                 │                 │
   │──POST item──────>│                 │                 │
   │<─{item}─────────│                 │                 │
   │                 │                 │                 │
   │──POST publish───>│                 │                 │
   │                 │──snapshot───────>│                 │
   │                 │                 │                 │
   │──POST activate──>│                 │                 │
   │                 │──symlink───────>│                 │
   │                 │                 │                 │
   │                 │                 │<──GET /reference─│
   │                 │                 │───{items}──────>│
```

#### 4. Authentication Flow Diagram

```
Client          API          JWT Middleware      Database
  │              │                 │               │
  │──PUT /user───>│                 │               │
  │              │──generate token─>│               │
  │              │                 │               │
  │<─{user}+cookie│                │               │
  │              │                 │               │
  │──GET /csrf───>│                 │               │
  │<─{token}──────│                 │               │
  │              │                 │               │
  │──POST /action─>│                 │               │
  │  +CSRF token  │──validate──────>│──verify cookie│
  │              │<─req.user───────│               │
  │              │──process────────>│──────────────>│
  │<─{result}─────│                 │               │
```

### Flow Charts

#### Turn Action Decision Tree

```
Start: POST /api/game/action
  │
  ├─> Auth token valid?
  │   ├─ No → 401 Unauthorized
  │   └─ Yes → Continue
  │
  ├─> Game exists?
  │   ├─ No → 404 Not Found
  │   └─ Yes → Continue
  │
  ├─> Game belongs to user?
  │   ├─ No → 403 Forbidden
  │   └─ Yes → Continue
  │
  ├─> Game complete?
  │   ├─ Yes → 400 Bad Request
  │   └─ No → Continue
  │
  ├─> Create turn job
  ├─> Enqueue to turn-precompute
  └─> Return { turnJobId, status: 'processing' }
```

---

## Cross-References

### Related Documentation

- **[AGENTS.md](../AGENTS.md)** - Detailed agent responsibilities and communication patterns
- **[API_ENDPOINT_ARCHITECTURE.md](../.retired_docs/API_ENDPOINT_ARCHITECTURE.md)** - Reference vs Admin endpoint patterns
- **[API_SECURITY.md](../.retired_docs/API_SECURITY.md)** - Security controls and maintenance
- **[MODULE_ROUTES.md](../.retired_docs/MODULE_ROUTES.md)** - Route registration and middleware

### Key Modules

- **`server/routes.ts`** - Route registration and request handling
- **`server/storage.ts`** - Database operations and transactions
- **`server/orchestrator/`** - Job queue system and workers
- **`server/middleware/`** - Authentication, rate limiting, security
- **`server/reference/`** - Reference release management
- **`server/aiService.ts`** - LLM and image generation
- **`server/gameLogic.ts`** - Turn processing logic

### Client Integration

- **`client/src/lib/queryClient.ts`** - API request wrapper with CSRF handling
- **`client/src/lib/socket.ts`** - WebSocket client setup
- **`client/src/hooks/useGameLogic.ts`** - React hooks for game state management

### Testing

- **`server/__tests__/api/`** - API endpoint tests
- **`scripts/game-simulator.ts`** - Integration test simulator

### Dependencies

- **Express.js** - [Documentation](https://expressjs.com/)
- **Socket.IO** - [Documentation](https://socket.io/docs/v4/)
- **PostgreSQL** - [Documentation](https://www.postgresql.org/docs/)
- **Zod** - [Documentation](https://zod.dev/)

---

## Appendix: Complete Endpoint Reference

### Game Lifecycle Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/game/start` | Session | Start new game |
| GET | `/api/game/:id` | Session | Get game state |
| POST | `/api/game/action` | Session | Submit turn action |
| DELETE | `/api/game/:id` | Session | Delete game |
| GET | `/api/games/user/:username` | Session | List user's games |
| PATCH | `/api/games/:id/equipped-items` | Session | Update equipment |
| PATCH | `/api/games/:id/settings` | Session | Update game settings |
| PATCH | `/api/games/:id/interview-responses` | Session | Update interview responses |

### Reference Data Endpoints (Public, Read-Only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reference/items` | None | Get active items |
| GET | `/api/reference/events` | None | Get active events |
| GET | `/api/reference/npc_templates` | None | Get active NPC templates |
| GET | `/api/reference/prompt_templates` | None | Get active prompt templates |
| GET | `/api/reference/image_prompts` | None | Get active image prompts |
| GET | `/api/reference/image-models` | None | Get active image models |
| GET | `/api/reference/story-themes` | None | Get active story themes |
| GET | `/api/reference/visual-styles` | None | Get active visual styles |
| GET | `/api/reference/settings` | None | Get reference settings |
| GET | `/api/reference/system-defaults` | None | Get system defaults |

### Admin Content Management Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/items` | Admin | List all items |
| POST | `/api/admin/items` | Admin | Create item |
| PUT | `/api/admin/items/:id` | Admin | Update item |
| GET | `/api/admin/events` | Admin | List all events |
| POST | `/api/admin/events` | Admin | Create event |
| PUT | `/api/admin/events/:id` | Admin | Update event |
| GET | `/api/admin/npc_templates` | Admin | List NPC templates |
| POST | `/api/admin/npc_templates` | Admin | Create NPC template |
| PUT | `/api/admin/npc_templates/:id` | Admin | Update NPC template |
| GET | `/api/admin/prompt_templates` | Admin | List prompt templates |
| GET | `/api/admin/prompt_templates/:name` | Admin | Get prompt template |
| PUT | `/api/admin/prompt_templates/:id` | Admin | Update prompt template |
| GET | `/api/admin/image_prompts` | Admin | List image prompts |
| POST | `/api/admin/image_prompts` | Admin | Create image prompt |
| PUT | `/api/admin/image_prompts/:id` | Admin | Update image prompt |
| GET | `/api/admin/image-models` | Admin | List image models |
| POST | `/api/admin/image-models` | Admin | Create/update image model |
| PUT | `/api/admin/image-models/:modelKey` | Admin | Update image model |
| DELETE | `/api/admin/image-models/:modelKey` | Admin | Deactivate image model |
| PUT | `/api/admin/image-models/reorder` | Admin | Reorder image models |
| GET | `/api/admin/mod-story-themes` | Admin | List story themes |
| POST | `/api/admin/mod-story-themes` | Admin | Upsert story theme |
| PUT | `/api/admin/mod-story-themes/:id` | Admin | Update story theme |
| DELETE | `/api/admin/mod-story-themes/:id` | Admin | Deactivate story theme |
| GET | `/api/admin/mod-visual-styles` | Admin | List visual styles |
| POST | `/api/admin/mod-visual-styles` | Admin | Upsert visual style |
| PUT | `/api/admin/mod-visual-styles/:id` | Admin | Update visual style |
| DELETE | `/api/admin/mod-visual-styles/:id` | Admin | Deactivate visual style |

### Reference Release Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/admin/reference/publish/:version` | Admin | Publish reference release |
| POST | `/api/admin/reference/:version/activate` | Admin | Activate reference release |
| GET | `/api/admin/reference/releases` | Admin | List all releases |
| GET | `/api/admin/reference/current` | Admin | Get current release |

### User Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/user/search?pattern=xxx` | None | Search users |
| PUT | `/api/user` | None | Create/ensure user |
| GET | `/api/user/me` | Session | Get current user |
| GET | `/api/user/preferences` | Session | Get user preferences |
| PATCH | `/api/user/preferences` | Session | Update preferences |
| POST | `/api/user/logout` | Session | Logout |

### Image Generation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/generate-image` | Session | Generate/retrieve image |
| POST | `/api/test-generate-image` | Rate Limited | Test image generation |

### Interview System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/interview-questions` | Admin | List all questions |
| GET | `/api/interview-questions/active` | None | Get active questions |
| POST | `/api/interview-questions` | Admin | Create question |
| PUT | `/api/interview-questions/:id` | Admin | Update question |
| POST | `/api/interview/generate-answer` | Session | Generate AI answer |

### System Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | None | Health check |
| GET | `/metrics` | None | Prometheus metrics |
| GET | `/api/csrf-token` | None | Get CSRF token |
| GET | `/api/settings` | Admin | List settings |
| PUT | `/api/settings/:key` | Admin | Update setting |

### Cache Management (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/cache/images` | Admin | List cached images |
| GET | `/api/cache/images/:id` | Admin | Get image metadata |
| GET | `/api/cache/stats` | Admin | Get cache statistics |
| GET | `/api/cache/similar/:id` | Admin | Find similar images |
| DELETE | `/api/cache/images/:id` | Admin | Delete image |
| DELETE | `/api/cache/images` | Admin | Bulk delete images |
| POST | `/api/cache/clear` | Admin | Clear entire cache |
| POST | `/api/admin/cache/cleanup` | Admin | Manual cleanup |

### Queue Management (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/queues/:queue/metrics` | Admin | Get queue metrics |
| GET | `/api/admin/queues/:queue/dead-letter` | Admin | List dead-letter jobs |
| POST | `/api/admin/queues/:queue/dead-letter/:jobId/replay` | Admin | Replay dead-letter job |
| POST | `/api/admin/queues/:queue/command` | Admin | Queue command (wake/drain/pause) |
| POST | `/api/admin/queues/:queue/mark-stuck` | Admin | Mark stuck jobs |

### Telemetry (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/telemetry/metrics` | Admin | Get telemetry metrics |
| GET | `/api/admin/telemetry/game/:gameId` | Admin | Get game telemetry |

---

_End of API Guide_
