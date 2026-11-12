# DevToolsPage Documentation

## Page Overview

**Purpose**: Developer/admin tools interface with tabbed content for managing prompts, events, items, NPCs, image prompts, PCE settings, interviews, references, logs, cache, and system settings. Requires admin authentication.

**User Flow**:
1. User navigates to `/dev-tools`
2. If no admin token → Show login form
3. Enter admin token → Unlock tools
4. Access various tabs for content management
5. View system status (PCE enabled, last LLM mode)

**Key Features**:
- Admin authentication
- 13 different content management tabs
- System status display
- Logout functionality
- Comprehensive dev tooling

## Architecture Review

### Component Dependencies

- **Tabs Component**: Tabbed interface (shadcn/ui)
- **13 Tab Components**: Individual tab implementations from `devtools/` directory
- **DevToolsImageModels**: Image models management
- **Card Components**: UI components for auth form

### State Management

- **Local State**: Admin token, token input, auth error, PCE status, last mode
- **Server State**: PCE settings, LLM logs (fetched on auth)
- **localStorage**: Admin token persistence

### Authentication & Security

- Admin token is stored under `localStorage['uranus-admin-token']` and changes are broadcast across tabs via a custom event.
- All API calls use `apiRequest`, which adds `Authorization: Bearer <token>` when an admin token exists and includes session credentials.
- On HTTP 401, the client clears the stored admin token; CSRF protection is handled globally in the fetch helper.

### Routing Integration

- Entry: `/dev-tools` route
- Navigation: Link to home (`/`)

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear authentication flow
- Well-organized tab structure
- Good separation of tab components
- System status indicators

**Areas for Improvement**:
- Large component (246 lines)
- Could extract auth form to component
- Magic strings for tab values

## API Calls

### Synchronous API Calls

None.

### Asynchronous API Calls

**1. PCE Status Fetch** (Line 42-48)
- **Method**: `apiRequest('GET', '/api/settings')`
- **Purpose**: Fetch PCE enabled status
- **Triggered**: When admin token exists
- **Updates**: `pceEnabled` state

**2. Last LLM Mode Fetch** (Line 51-55)
- **Method**: `apiRequest('GET', '/api/llm-logs?limit=1')`
- **Purpose**: Get last LLM mode used
- **Triggered**: When admin token exists
- **Updates**: `lastMode` state

> Note: DevTools prefers direct `apiRequest` calls over React Query for one-off status fetches. If you expand this page, consider adopting React Query with segmented keys per `QUERY_KEY_GUIDELINES`.

### Mutations, Hooks, and Actions

**No Mutations**: Page uses direct API calls for status fetching.

**Action Handlers**:

1. **handleTokenSubmit** (Line 65-77): Validates and stores admin token
2. **handleTokenClear** (Line 79-83): Clears admin token and logs out

**Side Effects (useEffect)**:

1. **Admin Token Subscription** (Line 33-39): Subscribes to token changes
2. **PCE Status Fetch** (Line 41-63): Fetches system status when authenticated

## Dependencies

### React Hooks

- `useState`: 5 instances (token, input, error, PCE status, last mode)
- `useEffect`: 2 instances

### Custom Hooks

- `getAdminAuthToken`, `setAdminAuthToken`: Token management
- `subscribeToAdminAuthTokenChanges`: Token change subscription
- `apiRequest`: API client

### API Endpoints

1. `GET /api/settings` - System settings (PCE status)
2. `GET /api/llm-logs?limit=1` - Last LLM mode

### Component Dependencies

- All tab components from `devtools/` directory
- `DevToolsImageModels` component
- UI components: Card, Button, Input, Label, Tabs

## State Management

### Local State

1. **adminToken**: Admin authentication token
2. **tokenInput**: Token input field value
3. **authError**: Authentication error message
4. **pceEnabled**: PCE system enabled status
5. **lastMode**: Last LLM mode used

## Key Functions & Handlers

See Action Handlers section.

## Styling & Theming

Standard shadcn/ui styling, no CRT aesthetic (dev tools use standard UI).

## Testing Considerations

- Admin authentication flow
- Token validation
- Tab navigation
- System status display
- Logout functionality

## Known Issues & Technical Debt

- Direct API calls instead of React Query
- Could use React Query for system status
- Auth form could be extracted to component

## Maintenance Guidelines

- Add new tabs by adding TabsTrigger and TabsContent
- Update auth flow if token management changes
- Modify system status if endpoints change
