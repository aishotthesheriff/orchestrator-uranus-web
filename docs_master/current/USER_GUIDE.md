# Quest to Uranus: User Guide

## Context & Overview

### What This Guide Is

This User Guide provides comprehensive instructions for using the Quest to Uranus game system across all user roles and use cases. It covers gameplay mechanics, administrative tools, content management, API usage, and system configuration for architects and game mechanics specialists who need to understand, operate, and customize the system.

### Why It Exists

The Quest to Uranus system serves multiple user types with different needs:

- **Content Creators**: Need to manage prompts, events, items, NPCs, and visual content
- **Game Designers**: Need to configure game mechanics, test scenarios, and iterate on gameplay
- **Developers**: Need to integrate with APIs, understand system architecture, and extend functionality
- **Administrators**: Need to publish releases, manage system settings, and monitor performance
- **Players**: Need to understand gameplay mechanics and system features

This guide consolidates information from multiple sources into a single, comprehensive reference that enables efficient system usage across all these roles.

### Purpose Within the Larger System

The User Guide complements technical documentation by providing:

- **Practical workflows**: Step-by-step instructions for common tasks
- **Role-based guidance**: Tailored instructions for different user types
- **Integration patterns**: How different system components work together
- **Troubleshooting**: Common issues and their solutions
- **Best practices**: Proven approaches for effective system usage

It serves as the primary reference for day-to-day operations, while technical documentation (API Guide, Architecture docs) provides implementation details.

---

## Technical Details

### System Components & Architecture

#### User Interface Layers

**1. Player Interface** (`/`, `/welcome`, `/menu`, `/game/:gameId`)
- React-based single-page application
- Device-responsive layouts (mobile, compact desktop, full desktop)
- Real-time updates via WebSocket (Socket.IO)
- Optimistic UI updates for responsive feel

**2. Administrative Interface** (`/dev-tools`)
- Tabbed interface for content management
- Admin token authentication required
- 13 specialized management tabs
- Real-time system status indicators

**3. API Layer** (`/api/*`)
- RESTful HTTP endpoints
- WebSocket events for real-time updates
- Job queue pattern for async operations
- CSRF protection and session management

#### Core System Agents

The system operates through coordinated agents (see [`AGENTS.md`](../AGENTS.md)):

- **Player Client Agent**: Manages UI state, network calls, socket reactions
- **Gateway & Security Agent**: Enforces security, rate limiting, health checks
- **Game Orchestrator Agent**: Routes requests, validates input, coordinates services
- **Data Persistence Agent**: Manages database transactions
- **Turn Processor Agent**: Executes game logic asynchronously
- **Image Processor Agent**: Generates and caches scene imagery
- **Reference Steward Agent**: Manages versioned content releases
- **Maintenance & Observability Agent**: Provides metrics and cleanup

### Technologies & Frameworks

**Client Stack:**
- React 18 with TypeScript
- Vite for build tooling
- wouter for routing
- TanStack Query for server state
- Socket.IO client for real-time updates
- TailwindCSS + shadcn/ui for styling

**Server Stack:**
- Node.js with Express
- MariaDB for data persistence
- Socket.IO for WebSocket communication
- BullMQ for job queues (via MariaDB)
- OpenAI API for LLM and image generation

**Shared:**
- TypeScript types in `shared/schema.ts`
- Zod schemas for validation

### Relationships & Interactions

#### Request Flow Patterns

**Synchronous Operations** (Immediate Response):
- Game state retrieval
- User preferences
- Reference data queries
- Health checks

**Asynchronous Operations** (Job Queue Pattern):
- Turn actions → Enqueued → Processed → WebSocket notification
- Image generation → Enqueued → Generated → WebSocket notification

#### Data Flow

```
User Action
    ↓
Client (React)
    ↓
API Request (HTTP/WebSocket)
    ↓
Gateway & Security (Validation)
    ↓
Game Orchestrator (Routing)
    ↓
┌─────────────┬─────────────┬─────────────┐
│   Storage   │ Orchestrator│  AI Service │
│  (MariaDB)  │   (Queues)  │   (LLM/Img) │
└─────────────┴─────────────┴─────────────┘
    ↓
WebSocket Event
    ↓
Client Update (React Query Invalidation)
    ↓
UI Refresh
```

### Configurations & Parameters

#### User Preferences

- **Theme**: Story theme selection (from PCE catalog)
- **Visual Style**: Image generation style (from PCE catalog)
- **Image Model**: Image generation model (from image models catalog)
- **Typewriter Effect**: Enable/disable typewriter animation

#### Game Settings

- **Absurdity Level**: Controls narrative tone (0-5 scale)
- **Equipment**: Up to 3 equipped items
- **Game State**: Turn number, segment, resources, etc.

#### System Settings

- **Image Cache Retention**: Days to keep cached images (1-180)
- **Image Cache Minimum Access**: Minimum access count for retention
- **PCE Enabled**: Master toggle for Prompt Composition Engine
- **Custom Settings**: Key-value pairs for feature flags

---

## Practical Guidance

### Step-by-Step Instructions

#### For Players: Starting and Playing a Game

**1. Initial Setup**

```
Navigate to application root (/)
    ↓
LoadingPage (asset prefetch)
    ↓
WelcomePage (/welcome)
    ↓
Choose: NEW USER or EXISTING USER
```

**New User Flow:**
1. Enter username
2. Click "Create User"
3. (Optional) Configure preferences:
   - Select story theme
   - Select visual style
   - Select image model
4. (Optional) Watch video splash screen
5. Redirected to Main Menu

**Existing User Flow:**
1. Search for username (minimum 2 characters)
2. Select user from results
3. Authenticate
4. (Optional) Update preferences
5. Redirected to Main Menu

**2. Starting a New Game**

```
Main Menu (/menu)
    ↓
Click "Start New Voyage"
    ↓
Interview Page (/interview/:gameId)
    ↓
Answer interview questions (optional)
    ↓
Game Page (/game/:gameId)
```

**3. Playing a Turn**

1. Read narrative text from current turn
2. Review available action chips (4 options typically)
3. Select an action:
   - Click action chip for standard actions
   - Use "Custom Action" for free-form input
4. Wait for turn processing (WebSocket notification)
5. View new narrative and updated game state
6. Repeat until game completion

**4. Managing Equipment**

1. Click "Equipment" button (gear icon)
2. View available items from reference catalog
3. Toggle items to equip/unequip (max 3 items)
4. Equipped items provide skill bonuses automatically

**5. Adjusting Settings**

1. Click "Settings" button
2. Adjust absurdity level (0-5)
3. Change user preferences (theme, style, image model)
4. Settings apply immediately

#### For Content Creators: Managing Game Content

**1. Accessing DevTools**

1. Navigate to `/dev-tools`
2. Enter admin token (password field)
3. Click "Unlock Developer Tools"
4. Access granted to all tabs

**2. Managing Prompts**

**Location**: DevTools → Prompts Tab

**Workflow:**
1. Select prompt from left panel
2. Review current content
3. Edit System Prompt (optional, see inheritance)
4. Edit User Prompt (main narrative generation)
5. Toggle "Inherit Global System Prompt" if needed
6. Click "Save Changes"

**System Prompt Inheritance:**
- **Inherit (checked)**: Custom system prompt extends global prompt
- **Inherit (unchecked)**: Custom system prompt replaces global prompt

**Variable Usage:**
```
The crew has traveled {{DAYS}} days from Earth.
Current hull integrity: {{HULL}}%
{{CURRENT_NARRATIVE}}
```

**3. Creating Events**

**Location**: DevTools → Events Tab

**Workflow:**
1. Click "New Event"
2. Enter event name
3. Select segment (e.g., "Earth to Mars")
4. Select skill (e.g., "Engineering")
5. Set Difficulty Class (DC) - typically 10-20
6. Write trigger condition JSON:
   ```json
   {
     "type": "onSegment",
     "value": "Mars"
   }
   ```
7. Write pass effect (success outcome)
8. Write fail effect (failure outcome)
9. Add tags (comma-separated)
10. Set Active checkbox
11. Click "Save Changes"

**4. Managing Items**

**Location**: DevTools → Items Tab

**Workflow:**
1. Click "New Item"
2. Enter item name
3. Write description
4. Set icon (emoji recommended)
5. Define skill bonuses JSON:
   ```json
   {
     "Engineering": 2,
     "Navigation": 1
   }
   ```
6. Define scene effects JSON (optional):
   ```json
   {
     "type": "boost",
     "value": "Provides extra oxygen reserves",
     "resource": "oxygen",
     "modifier": 5
   }
   ```
7. Add tags
8. Set Active checkbox
9. Click "Save Changes"

**5. Creating NPCs**

**Location**: DevTools → NPCs Tab

**Workflow:**
1. Click "New NPC"
2. Enter NPC name
3. Define role (e.g., "Chief Engineer")
4. Write personality description (2-3 sentences)
5. Write quirk description (1-2 sentences)
6. Set icon (emoji works well)
7. Add tags
8. Set Active checkbox
9. Click "Save Changes"

**6. Configuring Image Generation**

**Location**: DevTools → Image Prompts Tab

**Workflow:**
1. (Optional) Edit Visual Style Prompt (global style)
2. Click "Create New Image Prompt"
3. Enter template name
4. Write prompt template with variables:
   ```
   Visualize: {{CURRENT_NARRATIVE}}
   ```
5. Select image size (1024x1024, 1536x1024, 1024x1536)
6. Select quality (auto, low, medium, high)
7. Check "Inherit Visual Style" if using global style
8. Add description and scene types
9. Add tags
10. Set Active checkbox
11. Click "Save Changes"
12. Use "Test Generate" button to preview

#### For Developers: API Integration

**1. Authentication**

```typescript
// Create/authenticate user
const response = await fetch('/api/user', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'captain-elara' }),
  credentials: 'include' // Required for session cookies
});

const user = await response.json();
```

**2. Starting a Game**

```typescript
const response = await fetch('/api/game/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': await getCSRFToken() // Get from cookie
  },
  body: JSON.stringify({
    // Optional preferences
  }),
  credentials: 'include'
});

const gameState = await response.json();
// { id, username, turnNumber, day, segment, ... }
```

**3. Submitting Actions**

```typescript
// Submit action (returns immediately with job ID)
const response = await fetch('/api/game/action', {
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

const { turnJobId, status } = await response.json();
// { turnJobId: 'turnjob_abc123', status: 'processing' }

// Listen for completion via WebSocket
socket.on('turnComplete', ({ gameId, turnNumber }) => {
  // Fetch updated game state
  const updated = await fetch(`/api/game/${gameId}`, {
    credentials: 'include'
  });
});
```

**4. WebSocket Integration**

```typescript
import { io } from 'socket.io-client';

const socket = io('/', {
  transports: ['websocket'],
  withCredentials: true
});

// Join game room
socket.emit('joinGame', gameId);

// Listen for turn completion
socket.on('turnComplete', ({ gameId, turnNumber }) => {
  // Invalidate React Query cache or refetch
  queryClient.invalidateQueries(['game', gameId]);
});

// Listen for image generation
socket.on('imageReady', ({ gameId, turnNumber, imageUrl }) => {
  // Update UI with generated image
});

socket.on('imageFailed', ({ gameId, turnNumber, error }) => {
  // Handle image generation failure
});
```

**5. Equipment Management**

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
```

#### For Administrators: Publishing Releases

**1. Publishing a Reference Release**

**Location**: DevTools → Reference Tab

**Workflow:**
1. Make all desired content changes (prompts, events, items, NPCs, PCE catalogs)
2. Navigate to Reference tab
3. Enter version identifier (e.g., "v10.2.0")
4. Enter author name
5. Write release notes describing changes
6. Click "Publish & Activate"
7. Success notification confirms publication
8. New reference is active for all new games

**2. Activating an Existing Release**

**Workflow:**
1. Navigate to Reference tab
2. Find desired version in "All Reference Releases"
3. Click "Activate" button
4. Confirmation message appears
5. That version becomes current active reference

**3. Managing System Settings**

**Location**: DevTools → Settings Tab

**Workflow:**
1. View current settings in left panel
2. Select setting to edit or click "New Setting"
3. Modify value, description, or active status
4. Click "Save Setting"
5. Changes take effect immediately

**4. Monitoring System Health**

**Location**: DevTools → Telemetry Tab

**Features:**
- System metrics (queue depth, job durations, cache stats)
- Per-game telemetry
- Performance indicators
- Error rates

### Code Examples & Usage Patterns

#### React Query Integration

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

// Fetch game state
const { data: gameState, isLoading } = useQuery({
  queryKey: ['api', 'game', gameId],
  queryFn: async () => {
    const response = await apiRequest('GET', `/api/game/${gameId}`);
    return response.json();
  },
  enabled: !!gameId
});

// Submit action with mutation
const queryClient = useQueryClient();
const actionMutation = useMutation({
  mutationFn: async (action: ActionInput) => {
    const response = await apiRequest('POST', '/api/game/action', action);
    return response.json();
  },
  onSuccess: () => {
    // WebSocket will trigger cache invalidation
    // But we can optimistically update if needed
  }
});
```

#### Optimistic Updates

```typescript
const updateEquipmentMutation = useMutation({
  mutationFn: async (equippedItems: string[]) => {
    return apiRequest('PATCH', `/api/games/${gameId}/equipped-items`, {
      equippedItems
    });
  },
  onMutate: async (newItems) => {
    // Cancel outgoing queries
    await queryClient.cancelQueries({ queryKey: ['api', 'game', gameId] });
    
    // Snapshot previous value
    const previous = queryClient.getQueryData(['api', 'game', gameId]);
    
    // Optimistically update
    queryClient.setQueryData(['api', 'game', gameId], (old: any) => ({
      ...old,
      equippedItems: newItems
    }));
    
    return { previous };
  },
  onError: (err, newItems, context) => {
    // Rollback on error
    queryClient.setQueryData(['api', 'game', gameId], context?.previous);
  }
});
```

#### WebSocket Event Handling

```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { socket } from '@/lib/socket';

function useGameSocket(gameId: string) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    if (!gameId) return;
    
    // Join game room
    socket.emit('joinGame', gameId);
    
    // Handle turn completion
    const handleTurnComplete = ({ gameId: id, turnNumber }: any) => {
      if (id === gameId) {
        queryClient.invalidateQueries(['api', 'game', gameId]);
      }
    };
    
    // Handle image ready
    const handleImageReady = ({ gameId: id, turnNumber, imageUrl }: any) => {
      if (id === gameId) {
        queryClient.invalidateQueries(['api', 'game', gameId]);
        // Show toast notification
      }
    };
    
    socket.on('turnComplete', handleTurnComplete);
    socket.on('imageReady', handleImageReady);
    
    return () => {
      socket.off('turnComplete', handleTurnComplete);
      socket.off('imageReady', handleImageReady);
      socket.emit('leaveGame', gameId);
    };
  }, [gameId, queryClient]);
}
```

### Best Practices & Guidelines

#### Content Management

1. **Version Control**: Always publish reference releases after significant content changes
2. **Testing**: Test content changes in development before publishing
3. **Documentation**: Write clear release notes describing changes
4. **Archiving**: Set items to inactive rather than deleting for history
5. **Validation**: Ensure all JSON fields are valid before saving

#### API Integration

1. **Error Handling**: Always handle network errors and API failures gracefully
2. **CSRF Tokens**: Include CSRF tokens for all mutating requests
3. **Credentials**: Use `credentials: 'include'` for session-based auth
4. **WebSocket Cleanup**: Always clean up socket listeners in useEffect cleanup
5. **Optimistic Updates**: Use optimistic updates for better UX, but handle rollback

#### Performance

1. **Query Keys**: Use consistent, segmented query keys for cache management
2. **Prefetching**: Prefetch reference data at app startup
3. **Invalidation**: Invalidate queries strategically, not excessively
4. **WebSocket**: Use WebSocket for real-time updates instead of polling
5. **Image Caching**: Leverage image cache to reduce generation costs

#### Security

1. **Admin Tokens**: Store admin tokens securely, clear on logout
2. **Input Validation**: Validate all user input on both client and server
3. **CSRF Protection**: Always include CSRF tokens for state-changing operations
4. **Session Management**: Handle session expiration gracefully (redirect to /welcome)
5. **Rate Limiting**: Respect rate limits, handle 429 responses appropriately

---

## Troubleshooting & Support

### Common Issues & Solutions

#### Issue: Prompt Changes Not Taking Effect

**Symptoms**: Updated prompts in DevTools but games still use old prompts

**Causes**:
- Prompt not saved (forgot to click "Save Changes")
- Prompt marked as inactive
- New reference not published after PCE changes
- Editing wrong prompt template

**Solutions**:
1. Verify prompt is saved (check for success notification)
2. Check Active checkbox is enabled
3. For PCE-related changes, publish new reference release
4. Verify you're editing the correct prompt name

#### Issue: Events Not Triggering

**Symptoms**: Created event but it never occurs during gameplay

**Causes**:
- Event marked as inactive
- Invalid trigger condition JSON
- Segment mismatch
- DC too high for available skills

**Solutions**:
1. Check Active checkbox is enabled
2. Validate trigger condition JSON syntax
3. Verify segment matches current game segment
4. Review LLM Logs to see if event was evaluated
5. Test with lower DC to verify trigger logic

#### Issue: Image Generation Failing

**Symptoms**: Images not generating or error messages

**Causes**:
- Image prompt template inactive
- Image model inactive or misconfigured
- Provider credentials invalid
- Network issues with image provider

**Solutions**:
1. Verify image prompt template is Active
2. Check Image Models tab for active, configured models
3. Verify provider credentials in Image Models configuration
4. Check LLM Logs for detailed error messages
5. Test image generation manually in Image Prompts tab

#### Issue: WebSocket Not Connecting

**Symptoms**: Real-time updates not working, turns complete but UI doesn't update

**Causes**:
- Socket.IO connection failed
- Not joined to game room
- CORS or credentials issues
- Network firewall blocking WebSocket

**Solutions**:
1. Check browser console for WebSocket errors
2. Verify `socket.emit('joinGame', gameId)` is called
3. Check credentials and CORS configuration
4. Verify network allows WebSocket connections
5. Check Socket.IO server logs

#### Issue: Reference Publishing Fails

**Symptoms**: Error when publishing new reference release

**Causes**:
- Missing required catalogs (themes, styles)
- Database connection issues
- Invalid version identifier
- File system permissions

**Solutions**:
1. Ensure all required catalogs have entries
2. Verify database connection is healthy
3. Try different version identifier format
4. Check file system write permissions for `releases/` directory
5. Review server logs for detailed error messages

#### Issue: Settings Not Applying

**Symptoms**: Changed setting but behavior unchanged

**Causes**:
- Setting marked as inactive
- Setting key mismatch
- Invalid value format
- Code not reading setting correctly

**Solutions**:
1. Verify Active checkbox is enabled
2. Check setting key matches what code expects
3. Validate value format (JSON if required)
4. Review API response to confirm setting is accessible
5. Check code reads setting from correct endpoint

### Error Messages & Meanings

| Error Message | Meaning | Resolution |
|--------------|---------|------------|
| `Not authenticated` | Session expired or invalid | Re-authenticate via `/welcome` |
| `CSRF token mismatch` | CSRF token invalid or expired | Refresh CSRF token from cookie |
| `Game not found` | Invalid game ID or game deleted | Verify game ID, check user owns game |
| `Game is already complete` | Attempting action on completed game | Start new game |
| `Access denied` | User doesn't own game or admin required | Verify ownership or admin token |
| `Rate limit exceeded` | Too many requests | Wait before retrying |
| `Invalid action input` | Action payload validation failed | Check action format matches schema |
| `Reference release not found` | Version doesn't exist | Check version identifier |
| `No current reference directory` | No reference activated | Activate a reference release |

### Debugging Tips & Strategies

#### Client-Side Debugging

**React Query DevTools:**
```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Add to App.tsx
<ReactQueryDevtools initialIsOpen={false} />
```

**Network Inspection:**
- Use browser DevTools Network tab
- Filter by `/api/` to see all API calls
- Check request/response payloads
- Verify CSRF tokens in headers

**State Inspection:**
- Use React DevTools to inspect component state
- Check React Query cache with DevTools
- Inspect localStorage for admin tokens

#### Server-Side Debugging

**LLM Logs:**
- Navigate to DevTools → LLM Logs
- Filter by function name or content
- Review prompts and responses
- Copy logs for external analysis

**Server Logs:**
- Check console output for `[GAME_FLOW]` prefixed messages
- Review error logs in `logs/error-*.log`
- Check application logs in `logs/app-*.log`

**Database Inspection:**
```sql
-- Check active content counts
SELECT 
  (SELECT COUNT(*) FROM items WHERE active = 1) as items,
  (SELECT COUNT(*) FROM events WHERE active = 1) as events,
  (SELECT COUNT(*) FROM prompts WHERE active = 1) as prompts;

-- Check current reference
SELECT * FROM reference_releases WHERE is_current = 1;

-- Check game state
SELECT id, username, turn_number, segment, is_complete 
FROM games 
WHERE username = 'your-username';
```

**WebSocket Debugging:**
- Check Socket.IO connection in browser console
- Verify `joinGame` event is emitted
- Check server logs for socket events
- Use Socket.IO admin UI if available

---

## Standards & Processes

### Quality Requirements & Criteria

#### Content Quality Standards

**Prompts:**
- Clear, actionable instructions
- Proper variable usage (no hardcoded values)
- Consistent tone and style
- Valid JSON for structured fields

**Events:**
- Balanced difficulty (DC 10-20 typical)
- Engaging pass/fail effects
- Valid trigger conditions
- Appropriate segment assignments

**Items:**
- Balanced skill bonuses (+1 to +3 typical)
- Clear descriptions
- Valid JSON for bonuses/effects
- Consistent icon styles

**NPCs:**
- Distinct personalities
- Clear roles and quirks
- Consistent behavior patterns
- Appropriate tags

#### Release Quality Checklist

Before publishing a reference release:

- [ ] All content changes tested in development
- [ ] Version identifier follows naming convention
- [ ] Author and notes fields populated
- [ ] Database has active records for all tables
- [ ] Default configurations set (image model, visual style, story theme)
- [ ] All JSON fields validated
- [ ] Release tested in staging before production activation
- [ ] Release notes document all significant changes

#### API Integration Standards

**Request Format:**
- Include CSRF tokens for mutating operations
- Use `credentials: 'include'` for session auth
- Proper Content-Type headers
- Valid JSON payloads

**Error Handling:**
- Handle all HTTP error status codes
- Provide user-friendly error messages
- Log errors for debugging
- Implement retry logic where appropriate

**WebSocket Integration:**
- Join game rooms appropriately
- Clean up listeners on unmount
- Handle connection failures gracefully
- Implement reconnection logic

### Security Considerations

#### Authentication & Authorization

**Player Authentication:**
- Session-based via Express sessions
- Username stored in session
- CSRF protection for all mutations
- Automatic redirect to `/welcome` on 401

**Admin Authentication:**
- Admin token stored in localStorage
- Token included in `Authorization: Bearer` header
- All admin endpoints require `requireAdmin` middleware
- Token cleared on logout or 401 response

**Game Ownership:**
- All game operations verify ownership
- Users can only access their own games
- Admin users have elevated access

#### Input Validation

**Client-Side:**
- Zod schemas for type safety
- Form validation before submission
- Sanitize user input

**Server-Side:**
- All inputs validated with Zod
- Database queries use parameterized statements
- Path traversal prevention for file operations
- JSON injection prevention

#### Data Protection

**Sensitive Data:**
- Admin tokens never logged
- Passwords not stored (if implemented)
- API keys stored securely
- Session data encrypted

**CSRF Protection:**
- CSRF tokens required for mutations
- Tokens validated on server
- Automatic token refresh on 403

### Performance Implications

#### Client Performance

**Query Optimization:**
- Use `REFERENCE_DATA_QUERY_OPTIONS` for static data
- Prefetch reference data at startup
- Strategic cache invalidation
- Avoid unnecessary refetches

**WebSocket Efficiency:**
- Join only necessary game rooms
- Clean up listeners promptly
- Batch updates when possible
- Use optimistic updates for responsiveness

**Image Loading:**
- Leverage image cache
- Lazy load images
- Use appropriate image sizes
- Implement loading states

#### Server Performance

**Database Queries:**
- Use indexes appropriately
- Avoid N+1 queries
- Cache reference data in memory
- Use transactions for consistency

**Job Queue:**
- Monitor queue depth
- Scale workers as needed
- Implement job timeouts
- Handle failed jobs gracefully

**Image Generation:**
- Cache images aggressively
- Use appropriate quality settings
- Batch image requests when possible
- Monitor generation costs

### Testing & Validation Approaches

#### Manual Testing Workflows

**Content Testing:**
1. Create test content in DevTools
2. Publish test reference release
3. Start new game with test content
4. Verify content appears correctly
5. Test edge cases and error conditions

**API Testing:**
1. Use browser DevTools Network tab
2. Test with curl or Postman
3. Verify request/response formats
4. Test error conditions
5. Validate WebSocket events

**Integration Testing:**
1. Test full user flows end-to-end
2. Verify WebSocket updates work
3. Test concurrent user scenarios
4. Validate error recovery
5. Check performance under load

#### Automated Testing

**Unit Tests:**
- Test game logic functions
- Test validation schemas
- Test utility functions
- Test React components

**Integration Tests:**
- Test API endpoints
- Test database operations
- Test WebSocket events
- Test job queue processing

**E2E Tests:**
- Test complete user flows
- Test admin workflows
- Test error scenarios
- Test performance

---

## Visual Aids

### Recommended Diagrams

#### 1. User Journey Flow

```
┌─────────────┐
│   Loading   │ (Asset Prefetch)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Welcome   │ (User Creation/Auth)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Main Menu   │ (Game List)
└──────┬──────┘
       │
       ├──► Start New Game
       │         │
       │         ▼
       │    ┌─────────────┐
       │    │ Interview    │ (Optional Q&A)
       │    └──────┬───────┘
       │           │
       │           ▼
       │    ┌─────────────┐
       │    │ Game Page   │ (Gameplay)
       │    └─────────────┘
       │
       └──► Resume Game ──► Game Page
       │
       └──► DevTools ──► Admin Interface
```

#### 2. Turn Processing Flow

```
Player Action
     │
     ▼
POST /api/game/action
     │
     ▼
Enqueue Turn Job
     │
     ▼
Return { turnJobId, status: 'processing' }
     │
     ▼
TurnPrecomputeWorker
     │
     ├─► Load Game State
     ├─► Load Reference Data
     ├─► Generate Turn Content (LLM)
     └─► Enqueue Apply Job
          │
          ▼
TurnApplyWorker
     │
     ├─► Apply Game Logic
     ├─► Update Database
     └─► Emit WebSocket Event
          │
          ▼
Client Receives 'turnComplete'
     │
     ▼
Invalidate React Query Cache
     │
     ▼
UI Refreshes with New State
```

#### 3. DevTools Architecture

```
┌─────────────────────────────────────┐
│         DevTools Page                │
│  (Admin Token Authentication)      │
└──────────────┬──────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│Prompts │ │Events  │ │ Items  │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    └──────────┼──────────┘
               │
               ▼
        ┌─────────────┐
        │   API Layer  │
        │ /api/admin/* │
        └──────┬───────┘
               │
               ▼
        ┌─────────────┐
        │   Storage   │
        │  (MariaDB)  │
        └─────────────┘
```

#### 4. Reference Release Lifecycle

```
Content Changes
     │
     ▼
DevTools Editing
     │
     ▼
Publish Reference
     │
     ├─► Export DB → JSON Files
     ├─► Create Version Directory
     ├─► Write Manifest & Metadata
     └─► Create DB Record
          │
          ▼
Activate Release (if makeCurrent)
     │
     ├─► Copy to releases/current/
     ├─► Update DB (is_current = 1)
     └─► Clear Reference Cache
          │
          ▼
New Games Use Active Reference
```

### File Structure Reference

```
Quest to Uranus/
├── client/                    # React client application
│   ├── src/
│   │   ├── pages/            # Route pages
│   │   │   ├── GamePage.tsx
│   │   │   ├── DevToolsPage.tsx
│   │   │   └── devtools/     # DevTools tabs
│   │   ├── components/       # Reusable components
│   │   ├── hooks/           # React hooks
│   │   └── lib/             # Utilities
│   └── index.html
├── server/                   # Express server
│   ├── routes.ts            # API endpoints
│   ├── storage.ts           # Database layer
│   ├── gameLogic.ts         # Game mechanics
│   ├── reference/            # Reference system
│   └── orchestrator/       # Job workers
├── releases/                # Reference releases
│   ├── current/            # Active release
│   └── v*/                 # Versioned releases
└── shared/                 # Shared TypeScript types
    └── schema.ts
```

---

## Cross-References

### Related Documentation

- **[AGENTS.md](../AGENTS.md)**: System agent architecture and responsibilities
- **[API_GUIDE.md](./API_GUIDE.md)**: Complete API endpoint reference
- **[REFERENCE_RELEASE_PUBLISHING.md](./REFERENCE_RELEASE_PUBLISHING.md)**: Reference system details
- **[PROMPT_COMPOSITION_ENGINE.md](./PROMPT_COMPOSITION_ENGINE.md)**: PCE technical documentation
- **[CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md](./CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md)**: Client architecture
- **[GAME_PAGE_ARCHITECTURE.md](./GAME_PAGE_ARCHITECTURE.md)**: Game page implementation details

### Key Code Locations

| Component | File Path |
|-----------|-----------|
| Client App | `client/src/App.tsx` |
| Game Logic Hook | `client/src/hooks/useGameLogic.ts` |
| API Wrapper | `client/src/lib/queryClient.ts` |
| DevTools Page | `client/src/pages/DevToolsPage.tsx` |
| Server Routes | `server/routes.ts` |
| Game Logic | `server/gameLogic.ts` |
| Storage Layer | `server/storage.ts` |
| Reference Publishing | `server/reference/publishReference.ts` |
| Reference Loading | `server/reference/referenceLoader.ts` |

### API Endpoint Reference

**Game Endpoints:**
- `POST /api/game/start` - Start new game
- `GET /api/game/:id` - Get game state
- `POST /api/game/action` - Submit turn action
- `PATCH /api/games/:id/equipped-items` - Update equipment
- `PATCH /api/games/:id/settings` - Update game settings

**User Endpoints:**
- `PUT /api/user` - Create/authenticate user
- `GET /api/user/preferences` - Get preferences
- `PATCH /api/user/preferences` - Update preferences

**Reference Endpoints:**
- `GET /api/reference/items` - Get items catalog
- `GET /api/reference/story-themes` - Get themes
- `GET /api/reference/visual-styles` - Get styles
- `GET /api/reference/image-models` - Get image models
- `GET /api/reference/system-defaults` - Get defaults

**Admin Endpoints:**
- `POST /api/admin/reference/publish/:version` - Publish release
- `POST /api/admin/reference/:version/activate` - Activate release
- `GET /api/admin/reference/releases` - List releases
- `GET /api/admin/reference/current` - Get current release

See [API_GUIDE.md](./API_GUIDE.md) for complete endpoint documentation.

---

## Summary

This User Guide provides comprehensive instructions for using the Quest to Uranus system across all user roles. Key takeaways:

1. **Multi-Role Support**: The system serves players, content creators, developers, and administrators with specialized interfaces and workflows
2. **Content Independence**: Reference releases enable content updates without code deployments
3. **Real-Time Updates**: WebSocket integration provides instant feedback for turn processing and image generation
4. **Comprehensive Tooling**: DevTools provides 13 specialized tabs for managing all aspects of the game
5. **API-First Design**: RESTful APIs and WebSocket events enable flexible integration patterns

For implementation details, refer to the technical documentation files listed in Cross-References. For specific API details, see [API_GUIDE.md](./API_GUIDE.md).

