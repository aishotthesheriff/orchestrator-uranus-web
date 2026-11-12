# WelcomePage Documentation

## Page Overview

**Purpose**: Initial user onboarding page where new users enter their username or existing users search and authenticate. Handles user creation, preference setup, and video splash screen presentation before routing to main menu.

**User Flow**:
1. User arrives from LoadingPage (after asset preloading) or directly
2. Choose between "NEW USER" or "EXISTING USER" mode
3. **New User**: Enter username → Create user → Preferences setup → Video splash → Menu
4. **Existing User**: Search for username → Select user → Authenticate → Preferences → Video splash → Menu
5. Optional preferences can be skipped

**Key Features**:
- Dual-mode user entry (new vs existing)
- Real-time user search (minimum 2 characters)
- User creation/authentication
- Preference setup with theme/style/image model selection
- Video splash screen transition
- Booting animation sequence

## Architecture Review

### Component Dependencies

- **CRTBackground**: Retro CRT visual effects
- **VideoSplashScreen**: Video intro component (conditional render)
- **PreferenceSetup**: Embedded component for user preferences
- **wouter**: Routing via `useLocation`
- **@tanstack/react-query**: Server state management for user search

### State Management Patterns

- **Local State**: UI mode, input values, loading states, errors
- **Server State**: User search results via React Query
- **Conditional Rendering**: Preferences and video splash shown conditionally
- **localStorage**: Username persistence after creation/authentication

### Data Flow

1. Component mounts → Shows booting animation (3 seconds)
2. User selects mode → Updates form UI
3. **New User Flow**: Submit → Create user API → Set localStorage → Show preferences
4. **Existing User Flow**: Search → Display results → Select → Authenticate → Show preferences
5. Preferences complete/skip → Show video splash → Navigate to menu

### Routing Integration

- Entry: `/welcome` route (defined in App.tsx)
- Navigates to: `/menu` after preferences/video splash
- Redirects from: LoadingPage when no username found

### Hook Usage

**React Hooks**:
- `useState`: 9 state variables for UI and flow control
- `useEffect`: Booting animation timer
- `useMemo`: Not used
- `useCallback`: User selection handler optimization

**Custom Hooks**:
- `useLocation`: Routing navigation
- `useQuery`: User search with debouncing (enabled conditionally)
- `useMutation`: None (direct API calls in handlers)

**WebSocket Connections**: None

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear separation between new/existing user flows
- Good error handling with user-friendly messages
- Proper TypeScript typing
- Optimized search with minimum character requirement
- Accessible form inputs with labels
- Loading states for async operations

**Areas for Improvement**:
- Large component (626 lines) - could split into smaller components
- Direct API calls in handlers instead of mutations (inconsistent pattern)
- Search query fires immediately on every keystroke (no debouncing)
- Error states could be more granular (network vs validation errors)

### Performance Considerations

- User search query enabled only when 2+ characters - good optimization
- No debouncing on search input - could cause excessive API calls
- PreferenceSetup component embedded - could be lazy loaded
- Video preloading happens in LoadingPage, not here

### Accessibility Features

- Semantic HTML structure
- Input labels for screen readers
- Keyboard navigation (Enter key submits)
- Auto-focus on inputs
- Error messages displayed to users
- Loading states communicated

### Error Handling

- Try-catch blocks in async handlers
- Error messages displayed in UI
- Network errors handled gracefully
- Validation errors (empty username) prevent submission

### Loading States

- Query loading handled implicitly by React Query
- Manual `submitting` state for form submissions
- Booting animation with 3-second fade
- Loading indicators for search operations

### Responsive Design Patterns

- Tailwind responsive classes throughout
- Mobile-first approach
- Text sizing adapts (`text-5xl md:text-6xl`)
- Container max-width constraints

## API Calls

### Synchronous API Calls

None. All API interactions are asynchronous via React Query or fetch calls.

### Asynchronous API Calls

**1. User Search Query**
- **Hook**: `useQuery<SearchUser[]>`
- **Query Key**: `['api', 'user', 'search', { pattern: searchQuery }]`
- **Endpoint**: `GET /api/user/search?pattern={query}`
- **Purpose**: Search for existing users by username pattern
- **Cache**: React Query default caching
- **Loading State**: Shows "SEARCHING DATABASE..." in results area
- **Error Handling**: React Query error boundaries
- **Triggered**: Automatically when `searchQuery.trim().length >= 2`
- **Enabled Condition**: `mode === 'existing' && searchQuery.trim().length >= 2`
- **Line**: 313-323

### Mutations, Hooks, and Actions

**Direct API Calls (not using useMutation)**:

**1. Create/Authenticate User**
- **Method**: `apiRequest('PUT', '/api/user')`
- **Endpoint**: `PUT /api/user`
- **Payload**: `{ username: string }`
- **Purpose**: Create new user or authenticate existing user
- **Success Handler**:
  - Sets username in localStorage
  - Sets `currentUsername` state
  - Shows preferences dialog (`setShowPreferences(true)`)
- **Error Handler**: Catches errors and sets error state with message
- **Triggered By**: 
  - New user: `handleUsernameSubmit` (mode === 'new')
  - Existing user: `handleUsernameSubmit` (mode === 'existing')
- **Pending State**: `submitting` state disables form

## Security & CSRF

- Requests made via `apiRequest` automatically include `credentials: 'include'` and attach `X-CSRF-Token` on mutating verbs. The client resets CSRF cache on CSRF-related 403 and clears admin token on 401.
- For consistency, prefer `apiRequest` over direct `fetch` calls when adding new requests.

## PreferenceSetup Data Sources

The embedded PreferenceSetup component relies on reference and preference APIs:
- Themes: `GET /api/reference/story-themes` (Query Key: `['api','reference','story-themes']`)
- Styles: `GET /api/reference/visual-styles` (Query Key: `['api','reference','visual-styles']`)
- System defaults: `GET /api/reference/system-defaults` (Query Key: `['api','reference','system-defaults']`)
- Fallback settings: `GET /api/reference/settings` (Query Key: `['api','reference','settings']`)
- Image models: `GET /api/reference/image-models` (Query Key: `['api','reference','image-models']`)
- Existing user preferences (by username): `GET /api/user/preferences?username={username}`
- **Line**: 325-389

**Action Handlers**:

1. **handleUsernameSubmit** (Line 325-390)
   - Handles both new and existing user flows
   - Validates input (new user) or selection (existing user)
   - Calls API to create/authenticate user
   - Shows preferences on success
   - Sets error state on failure
   - Triggered by: Submit button click or Enter key

2. **handleUserSelect** (Line 392-395)
   - Sets selected user from search results
   - Clears search query
   - Triggered by: Clicking a user in search results
   - Uses `useCallback` for optimization

3. **handlePreferencesComplete** (Line 397-400)
   - Hides preferences dialog
   - Shows video splash screen
   - Triggered by: Preferences "Save & Launch" button

4. **handleSkipPreferences** (Line 402-405)
   - Hides preferences dialog
   - Shows video splash screen
   - Triggered by: Preferences "Skip for Now" button

5. **handleVideoSplashComplete** (Line 407-409)
   - Navigates to main menu
   - Triggered by: Video splash screen completion

**Side Effects (useEffect)**:

1. **Booting Animation** (Line 308-310)
   - Sets `booting` to `false` after 3 seconds
   - Creates fade-out effect for booting overlay
   - Dependency: None (runs once on mount)

## Dependencies

### React Hooks Used

- `useState`: 9 instances
  - `mode`: 'new' | 'existing' - Form mode toggle
  - `usernameInput`: New user username input value
  - `searchQuery`: Existing user search input value
  - `showVideoSplash`: Video splash visibility
  - `booting`: Boot animation overlay visibility
  - `showPreferences`: Preferences dialog visibility
  - `currentUsername`: Authenticated username
  - `submitting`: Form submission loading state
  - `error`: Error message string
  - `selectedUser`: Selected user from search results

- `useEffect`: 1 instance (booting animation)

- `useCallback`: 1 instance (handleUserSelect optimization)

- `useMemo`: None

### Custom Hooks Dependencies

- `useLocation` from `wouter`: Routing navigation
- `useQuery` from `@tanstack/react-query`: User search

### API Endpoints Consumed

1. `PUT /api/user` - Create/authenticate user
2. `GET /api/user/search?pattern={query}` - Search users

### Component Dependencies

- `CRTBackground`: Visual background effect
- `VideoSplashScreen`: Video intro component (conditional)
- `PreferenceSetup`: Embedded preferences form component
- `apiRequest` from `@/lib/queryClient`: API client utility

### Third-Party Libraries

- `react`: Core framework
- `wouter`: Lightweight routing
- `@tanstack/react-query`: Server state management

## State Management

### Local State (useState)

1. **mode**: `'new' | 'existing'`
   - Initial: `'new'`
   - Changed by: Mode toggle buttons
   - Used for: Conditional rendering of form inputs

2. **usernameInput**: `string`
   - Initial: `''`
   - Controlled by: New user input field
   - Used for: User creation

3. **searchQuery**: `string`
   - Initial: `''`
   - Controlled by: Existing user search field
   - Triggers: Search query when length >= 2

4. **showVideoSplash**: `boolean`
   - Initial: `false`
   - Set to `true`: After preferences complete/skip
   - Used for: Conditional VideoSplashScreen rendering

5. **booting**: `boolean`
   - Initial: `true`
   - Set to `false`: After 3 seconds (useEffect)
   - Used for: Boot animation overlay

6. **showPreferences**: `boolean`
   - Initial: `false`
   - Set to `true`: After successful user creation/auth
   - Used for: PreferenceSetup component rendering

7. **currentUsername**: `string | null`
   - Initial: `null`
   - Set: After successful API call
   - Used for: PreferenceSetup username prop

8. **submitting**: `boolean`
   - Initial: `false`
   - Set during: API calls
   - Used for: Disabling form inputs

9. **error**: `string | null`
   - Initial: `null`
   - Set: On API errors
   - Used for: Error message display

10. **selectedUser**: `SearchUser | null`
    - Initial: `null`
    - Set: When user clicks search result
    - Used for: Existing user authentication

### Server State (React Query)

1. **searchResults**: `SearchUser[]`
   - Query key: `['api', 'user', 'search', { pattern: searchQuery }]`
   - Enabled: Only when mode === 'existing' && searchQuery.length >= 2
   - Used for: Displaying search results list

### Derived State (useMemo)

None used in this component.

## Key Functions & Handlers

### User Interaction Handlers

1. **handleUsernameSubmit**: Main submission handler for both modes
2. **handleUserSelect**: Selects user from search results
3. **Mode Toggle Handlers**: Switch between new/existing user modes
4. **handlePreferencesComplete**: Completes preferences flow
5. **handleSkipPreferences**: Skips preferences flow
6. **handleVideoSplashComplete**: Completes video splash flow

### Navigation Handlers

- `setLocation('/menu')`: Navigate to main menu (via video splash)
- Mode switch resets form state

### Side Effects (useEffect)

**Booting Animation** (Line 308-310):
- Sets 3-second timer
- Fades out booting overlay
- Runs once on mount

## Styling & Theming

### CRT Aesthetic Implementation

- Color scheme: Cyan (`#00ffff`), orange (`#ffaa00`)
- Border styles: 2px borders with glow effects
- Typography: Monospace font
- Shadow effects: Glow patterns for inputs and buttons
- Background: Black with CRTBackground overlay

### Tailwind CSS Usage

- Responsive utilities: `sm:`, `md:` prefixes
- Custom colors: Inline hex values
- Animations: Custom keyframes (pulseGlow, flicker, scroll)
- Layout: Flexbox for form layouts

### Responsive Breakpoints

- Mobile: Default compact layout
- Small: `sm:` - Flex direction changes (sm:flex-row)
- Medium: `md:` - Larger title text (md:text-6xl)

### Animation Usage

- **pulseGlow**: Button glow (4s infinite)
- **flicker**: Title flicker effect (3s infinite)
- **scroll**: Bottom scrolling text (20s infinite)

## Testing Considerations

### Testable Elements (data-testid)

- `input-username`: New user username input
- `input-search-user`: Existing user search input
- `button-submit-username`: New user submit button
- `button-select-user`: Existing user submit button

### User Interaction Points

1. Mode toggle (new vs existing)
2. Username input (new user)
3. Search input (existing user)
4. Search result selection
5. Form submission
6. Preference setup flow
7. Video splash completion

### Edge Cases to Test

- Empty username submission (validation)
- Network errors during user creation
- Search with < 2 characters (query disabled)
- No search results found
- Rapid mode switching (state reset)
- Multiple form submissions (submitting guard)
- localStorage errors
- Video loading failures

## Known Issues & Technical Debt

### Performance Bottlenecks

- **No Search Debouncing**: Search fires on every keystroke
  - **Fix**: Add debounce hook or setTimeout wrapper
  - **Impact**: Could cause excessive API calls

- **Large Component Size**: 626 lines
  - **Fix**: Extract PreferenceSetup to separate file (already exists but embedded)
  - **Fix**: Extract search results UI to component

### Code Duplication

- **Error Display**: Similar error message rendering in both modes
  - **Fix**: Extract to shared ErrorMessage component

- **Form Submission Logic**: Similar patterns for new/existing flows
  - **Fix**: Extract common submission logic to shared handler

### Maintenance Concerns

- **Inconsistent Mutation Pattern**: Direct API calls instead of useMutation
  - **Action**: Refactor to useMutation for consistency with other pages
  - **Benefit**: Better error handling, optimistic updates

- **Magic Numbers**: 3-second boot timeout, 2-character search minimum
  - **Fix**: Extract to named constants

### Future Improvements

1. **Component Extraction**:
   - Extract search results list to `UserSearchResults` component
   - Extract mode toggle to `UserModeToggle` component

2. **Performance**:
   - Add debouncing to search input (300-500ms)
   - Lazy load PreferenceSetup component
   - Memoize search results rendering

3. **UX Enhancements**:
   - Add loading skeleton for search results
   - Better empty states
   - Keyboard shortcuts (Tab to switch modes)

4. **Error Handling**:
   - More granular error types
   - Retry mechanisms for failed requests
   - Offline state detection

5. **Accessibility**:
   - ARIA live regions for search results
   - Better focus management
   - Screen reader announcements

## Maintenance Guidelines

### When to Modify This Page

- Changing user creation/authentication flow
- Updating search functionality
- Modifying onboarding sequence
- Adding new user fields
- Changing preference setup flow

### Common Modification Patterns

1. **Adding New User Fields**:
   - Add state variable
   - Add input field in appropriate mode
   - Include in API payload
   - Update validation logic

2. **Modifying Search Behavior**:
   - Update query enabled condition
   - Change minimum character requirement
   - Modify search endpoint or parameters

3. **Updating Onboarding Flow**:
   - Add new step between existing steps
   - Modify conditional rendering logic
   - Update state management for new flow

### Breaking Change Considerations

- **API Changes**: Update user creation endpoint and payload structure
- **Route Changes**: Update navigation targets
- **localStorage Keys**: Update key name if username storage changes
- **Component Props**: Update PreferenceSetup if interface changes
