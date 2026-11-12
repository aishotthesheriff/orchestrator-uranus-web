# DevTools Architecture

This document provides a comprehensive technical overview of the DevTools system architecture, implementation details, and integration patterns for the Quest to Uranus game administration interface.

## Overview

The DevTools system is a React-based Single Page Application (SPA) that provides administrative interfaces for managing all aspects of the Quest to Uranus game. It consists of 13 distinct tabs, each managing a specific domain of game content or system configuration.

### Key Characteristics

- **SPA Architecture**: Single page application using React and Wouter for routing
- **Client-Side Authentication**: Token-based authentication managed entirely in the browser
- **RESTful API Integration**: All operations communicate via REST APIs
- **React Query**: Uses TanStack React Query for data fetching and caching
- **Component-Based**: Modular tab components with consistent patterns
- **Admin-Only Access**: All endpoints require admin authentication

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Client                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            DevToolsPage.tsx (Main Router)             │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │         Authentication Gate                     │ │  │
│  │  │  - Token Management (localStorage)              │ │  │
│  │  │  - Auth State Subscription                        │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │         Tab Navigation System                    │ │  │
│  │  │  - 13 Tab Components                              │ │  │
│  │  │  - Tab Content Routing                            │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         lib/queryClient.ts (API Client)               │  │
│  │  - Admin Token Management                             │  │
│  │  - CSRF Token Handling                                │  │
│  │  - Request/Response Interception                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↕ HTTP/REST
┌─────────────────────────────────────────────────────────────┐
│                      Express Server                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │      middleware/adminAuth.ts (Auth Middleware)        │  │
│  │  - Token Extraction (Bearer / X-Admin-Token)          │  │
│  │  - Token Validation (ADMIN_API_KEYS env)              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Admin API Endpoints                        │  │
│  │  /api/admin/* routes                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Database (PostgreSQL)                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Authentication System

### Client-Side Token Management

The DevTools system uses a client-side token-based authentication mechanism:

**Location**: `client/src/lib/queryClient.ts`

#### Token Storage

- **Storage Mechanism**: `localStorage` with key `uranus-admin-token`
- **Persistence**: Token persists across browser sessions until explicitly cleared
- **Scope**: Browser-wide (shared across tabs via storage events)

#### Token Management Functions

```typescript
// Get token from localStorage
getAdminAuthToken(): string | null

// Set token and broadcast change
setAdminAuthToken(token: string | null): void

// Clear token and broadcast
clearAdminAuthToken(): void

// Subscribe to token changes (cross-tab sync)
subscribeToAdminAuthTokenChanges(callback: () => void): () => void
```

#### Token Synchronization

The system uses a dual-event mechanism for cross-tab synchronization:

1. **Custom Events**: `uranus:admin-token-changed` - Dispatched on token changes
2. **Storage Events**: Browser `storage` event - Fires when localStorage changes in other tabs

This ensures that logging out in one tab immediately logs out all other tabs.

### Server-Side Authentication

**Location**: `server/middleware/adminAuth.ts`

#### Token Extraction

The `requireAdmin` middleware extracts tokens from multiple sources (in order):

1. `Authorization: Bearer <token>` header
2. `Authorization: <token>` header (raw token without Bearer prefix)
3. `X-Admin-Token: <token>` header

#### Token Validation

- **Configuration**: Admin tokens configured via environment variables:
  - `ADMIN_API_KEYS` (comma-separated list, preferred)
  - `ADMIN_API_KEY` (single token, legacy)
- **Validation**: Token must match one of the configured admin keys
- **Response**: Returns 401 if invalid/missing, 503 if not configured

#### Security Features

- **Logging**: All auth failures are logged via `logAuthFailure()` for security monitoring
- **No Session State**: Stateless authentication (no server-side session storage)
- **Per-Request Validation**: Every admin request validates the token

## Component Architecture

### Component Hierarchy

```
DevToolsPage (Main Container)
├── Authentication Gate (Conditional Render)
│   └── Login Form Component
└── Authenticated View
    ├── Header Component
    │   ├── Navigation Controls
    │   └── Status Indicators
    └── Tab System (Radix UI Tabs)
        ├── PromptsTab
        ├── EventsTab
        ├── ItemsTab
        ├── NpcsTab
        ├── ImagePromptsTab
        ├── ImageModelsTab (DevToolsImageModels component)
        ├── PceTab
        ├── PcePromptTesterTab
        ├── InterviewTab
        ├── ReferenceTab
        ├── LogsTab
        ├── CacheTab
        └── SettingsTab
```

### Tab Component Pattern

All tab components follow a consistent pattern:

1. **Data Fetching**: Use React Query `useQuery` for GET operations
2. **Data Mutations**: Use React Query `useMutation` for POST/PUT/DELETE
3. **Two-Column Layout**: List view on left, editor form on right
4. **State Management**: Local component state for form editing
5. **Toast Notifications**: Use `useToast` hook for user feedback

#### Example Tab Structure

```typescript
export function PromptsTab() {
  // Data fetching
  const { data, isLoading } = useQuery({...});
  
  // Local state for editing
  const [selectedItem, setSelectedItem] = useState(null);
  const [editedContent, setEditedContent] = useState("");
  
  // Mutations
  const updateMutation = useMutation({...});
  
  // Handlers
  const handleSelect = (item) => {...};
  const handleSave = () => {...};
  
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card> {/* List View */} </Card>
      <Card> {/* Editor Form */} </Card>
    </div>
  );
}
```

### Shared Components

**Location**: `client/src/components/ui/` (Radix UI + shadcn/ui)

- `Button` - Consistent button styling
- `Card`, `CardHeader`, `CardContent` - Card layouts
- `Input`, `Textarea` - Form inputs
- `Checkbox`, `Label` - Form controls
- `ScrollArea` - Scrollable containers
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` - Tab navigation
- `Toast` - Notification system

## Data Flow

### Request Flow

```
User Action (e.g., Click Save)
    ↓
Component Handler (handleSave)
    ↓
React Query Mutation (useMutation)
    ↓
apiRequest() from queryClient.ts
    ↓
┌─────────────────────────────────────┐
│  Request Preparation                │
│  - Apply Admin Token Header          │
│  - Fetch CSRF Token (if POST/PUT)   │
│  - Add CSRF Header                  │
│  - Serialize Body (JSON)             │
└─────────────────────────────────────┘
    ↓
HTTP Request (fetch API)
    ↓
Server Middleware (adminAuth.ts)
    ↓
API Route Handler
    ↓
Database Operation
    ↓
Response (JSON)
    ↓
Mutation Callback (onSuccess/onError)
    ↓
React Query Cache Invalidation
    ↓
UI Update (Refetch/Re-render)
    ↓
Toast Notification
```

### CSRF Token Flow

For state-changing requests (POST, PUT, DELETE, PATCH):

1. **Check Cache**: Look for cached CSRF token
2. **Fetch if Missing**: GET `/api/csrf-token` if not cached
3. **Promise Deduplication**: Multiple simultaneous requests share same token fetch
4. **Header Injection**: Add `X-CSRF-Token` header to request
5. **Error Handling**: Refresh token on 403 responses
6. **Graceful Degradation**: Continue if CSRF endpoint unavailable (404)

### Admin Token Flow

For all admin requests:

1. **Retrieve Token**: Get from localStorage via `getAdminAuthToken()`
2. **Header Injection**: Add `Authorization: Bearer <token>` header
3. **Server Validation**: Middleware validates token
4. **Auto-Logout**: Clear token on 401 response
5. **Cross-Tab Sync**: Token changes broadcast to all tabs

## API Integration

### API Client Architecture

**Location**: `client/src/lib/queryClient.ts`

#### Core Function: `apiRequest()`

```typescript
apiRequest(method: string, url: string, data?: unknown): Promise<Response>
```

**Features**:
- Automatic admin token injection
- CSRF token handling for state-changing requests
- Comprehensive error handling
- Automatic token clearing on 401
- CSRF token refresh on 403

#### Query Function Factory

```typescript
createQueryFn<T>(behavior: "returnNull" | "throw"): QueryFunction<T>
```

- `returnNull`: Returns `null` on 401 (for public endpoints)
- `throw`: Throws error on 401 (for protected endpoints)

### Admin API Endpoints

All DevTools functionality uses admin endpoints under `/api/admin/*`:

#### Content Management Endpoints

- `/api/admin/prompt_templates` - Prompt template CRUD
- `/api/admin/events` - Event CRUD
- `/api/admin/items` - Item CRUD
- `/api/admin/npc_templates` - NPC template CRUD
- `/api/admin/image_prompts` - Image prompt CRUD
- `/api/admin/image-models` - Image model CRUD
- `/api/admin/mod-story-themes` - Story theme CRUD
- `/api/admin/mod-visual-styles` - Visual style CRUD

#### System Management Endpoints

- `/api/admin/reference/publish/:version` - Publish reference release
- `/api/admin/reference/:version/activate` - Activate reference release
- `/api/admin/reference/releases` - List all releases
- `/api/admin/reference/current` - Get current release
- `/api/settings` - Application settings (admin-only GET)
- `/api/settings/:key` - Update setting (PUT, admin-only)
- `/api/llm-logs` - LLM interaction logs (admin-only)
- `/api/cache/*` - Image cache management (admin-only)

### React Query Configuration

**Default Configuration** (in `queryClient.ts`):

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      retry: false,
    },
  },
});
```

**Characteristics**:
- **No Auto-Refetch**: Manual refresh only
- **Infinite Stale Time**: Data considered fresh indefinitely
- **No Retries**: Fails fast on errors
- **Manual Invalidation**: Use `invalidateQueries()` to refresh

## State Management

### Local Component State

Most tabs use React `useState` for:
- Selected item state
- Form field values
- UI interaction state (modals, dropdowns)

### React Query Cache

React Query manages:
- Fetched data (GET requests)
- Cache invalidation triggers
- Background refetch coordination

### Token State Management

Admin token uses a hybrid approach:

1. **Source of Truth**: `localStorage` (`uranus-admin-token`)
2. **React State**: `useState` in `DevToolsPage` for UI reactivity
3. **Synchronization**: Event subscriptions keep state in sync

## Security Architecture

### Client-Side Security

1. **Token Storage**: localStorage (not sessionStorage) for persistence
2. **No Token Transmission**: Token only sent via secure headers
3. **Auto-Logout**: Token cleared on 401 responses
4. **Password Input**: Token input uses `type="password"` for masking

### Server-Side Security

1. **Token Validation**: Every request validated
2. **Middleware Protection**: `requireAdmin` middleware on all admin routes
3. **Security Logging**: All auth failures logged
4. **CSRF Protection**: State-changing requests require CSRF tokens
5. **No Session Storage**: Stateless authentication reduces attack surface

### Security Considerations

**Potential Vulnerabilities**:
- XSS attacks could read localStorage tokens
- Token in localStorage persists across sessions
- No token expiration mechanism
- CSRF tokens mitigate some XSS risks

**Best Practices**:
- Admin tokens should be rotated regularly
- Use strong, unique tokens
- Restrict admin token access to trusted personnel
- Monitor auth failure logs for suspicious activity

## Component Patterns

### List + Editor Pattern

Most tabs follow this pattern:

```typescript
<div className="grid md:grid-cols-2 gap-6">
  {/* Left Panel: List */}
  <Card>
    <ScrollArea>
      {items?.map(item => (
        <ItemRow 
          key={item.id}
          onClick={() => handleSelect(item)}
        />
      ))}
    </ScrollArea>
  </Card>
  
  {/* Right Panel: Editor */}
  <Card>
    <Form>
      <Input value={editedContent} onChange={...} />
      <Button onClick={handleSave}>Save</Button>
    </Form>
  </Card>
</div>
```

### Mutation Pattern

Standard mutation implementation:

```typescript
const mutation = useMutation({
  mutationFn: async (data) => {
    return await apiRequest("PUT", `/api/admin/resource/${id}`, data);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/resource"] });
    toast({ title: "Success", description: "Saved successfully" });
  },
  onError: () => {
    toast({ 
      title: "Error", 
      description: "Save failed",
      variant: "destructive" 
    });
  },
});
```

### Status Indicators

The DevTools header displays real-time system status:

- **PCE Enabled**: Fetched from `/api/settings?key=pce_enabled`
- **Last LLM Mode**: From `/api/llm-logs?limit=1` metadata
- **Defaults**: From `/api/pce/catalogs` defaults object

**Fetch Strategy**: Fetched on mount when authenticated, non-blocking (errors ignored)

## Integration Points

### External Dependencies

1. **React Query** (`@tanstack/react-query`): Data fetching and caching
2. **Radix UI** (`@radix-ui/*`): Accessible UI primitives
3. **shadcn/ui**: Pre-built component library (built on Radix)
4. **Wouter**: Lightweight routing for navigation
5. **Lucide React**: Icon library

### Internal Dependencies

1. **queryClient.ts**: Centralized API communication
2. **use-toast hook**: Toast notification system
3. **UI Components**: Shared component library in `components/ui/`

### Server Integration

1. **Express Routes**: All admin endpoints in `server/routes.ts` and separate route files
2. **Middleware Chain**: `adminAuth.ts` → Route Handler → Database
3. **Database**: PostgreSQL via Drizzle ORM
4. **Storage Layer**: `server/storage.ts` provides data access abstraction

## Error Handling

### Client-Side Error Handling

1. **API Errors**: Caught in mutation `onError` callbacks
2. **Network Errors**: Fetch API errors surface as exceptions
3. **401 Responses**: Auto-handled (token cleared, user logged out)
4. **403 Responses**: CSRF token refresh attempted
5. **Toast Notifications**: User-friendly error messages displayed

### Server-Side Error Handling

1. **Auth Failures**: 401 with `{ error: "Admin authentication required" }`
2. **Validation Errors**: 400 with descriptive error messages
3. **Server Errors**: 500 with error details
4. **Not Found**: 404 for missing resources

## Performance Considerations

### Optimization Strategies

1. **React Query Caching**: Prevents unnecessary refetches
2. **Infinite Stale Time**: Data cached indefinitely
3. **Manual Invalidation**: Explicit cache refresh only when needed
4. **Lazy Tab Loading**: Tab content only renders when active
5. **ScrollArea Virtualization**: Large lists use scroll virtualization

### Potential Optimizations

1. **Code Splitting**: Tab components could be lazy-loaded
2. **Pagination**: Large lists could implement pagination
3. **Debouncing**: Search/filter inputs could use debouncing
4. **Optimistic Updates**: Mutations could update cache optimistically

## Testing Considerations

### Testability Features

1. **Data Test IDs**: Components include `data-testid` attributes
2. **Component Isolation**: Tabs are independent components
3. **Mock-Friendly**: API client can be mocked easily
4. **Query Invalidation**: Predictable cache invalidation

### Testing Patterns

1. **Unit Tests**: Test individual tab components
2. **Integration Tests**: Test API integration via `apiRequest`
3. **E2E Tests**: Test full workflows (auth → edit → save)
4. **Mock API**: Use MSW (Mock Service Worker) for API mocking

## Future Enhancements

### Potential Improvements

1. **Token Expiration**: Implement token expiration and refresh
2. **Permission System**: Role-based access control (RBAC)
3. **Audit Logging**: Track all admin actions
4. **Bulk Operations**: Batch edit capabilities
5. **Search/Filter**: Global search across all content types
6. **Draft System**: Save drafts before publishing
7. **Version History**: Track changes to content items
8. **Export/Import**: Backup and restore functionality

## Related Documentation

- **DEVTOOLS_USER_GUIDE.md**: User-facing documentation for DevTools
- **API_ENDPOINT_ARCHITECTURE.md**: API endpoint patterns and structure
- **CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md**: General client architecture
- **SERVER_FUNCTIONAL_DOCUMENTATION.md**: Server-side architecture

---

## Changelog

- **2025-01-28**: Initial architecture document created
  - Comprehensive technical overview
  - Authentication system details
  - Component patterns and data flow
  - Security considerations
  - Integration points

