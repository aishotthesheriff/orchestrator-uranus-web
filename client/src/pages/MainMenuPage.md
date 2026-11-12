# MainMenuPage Documentation

## Page Overview

**Purpose**: The main menu interface where authenticated users can start new games, resume existing games, manage their voyages, change settings, and access help documentation.

**User Flow**:
1. User arrives from WelcomePage or directly (if username exists in localStorage)
2. Page checks for username and redirects to `/` if missing
3. Displays list of saved games (voyages) for the user
4. User can start a new voyage, resume/view existing games, delete games, or access settings

**Key Features**:
- Game list with resume/view/delete functionality
- Start new voyage button
- User preferences dialog
- "Danger" button with glitch/Snow Crash easter egg visual effects
- Help navigation
- Change captain (logout) functionality

## Architecture Review

### Component Dependencies

- **CRTBackground**: Provides retro CRT visual effects with configurable intensity
- **UserSettingsDialog**: Modal for managing user preferences (themes, styles, image models)
- **wouter**: Routing via `useLocation` and `Link` components
- **@tanstack/react-query**: Server state management
- **lucide-react**: Icon library (Play, Trash2, Loader2, HelpCircle, Settings)

### State Management Patterns

- **Local State**: UI state (username, snow crash effects, glitch intensity, dialogs)
- **Server State**: User games list, themes, styles, system defaults via React Query
- **Derived State**: Creative catalogs constructed from API data
- **localStorage**: Username persistence across sessions

### Data Flow

1. Component mounts → checks localStorage for username
2. If username exists → fetches user games list
3. Fetches reference data (themes, styles, system defaults) for settings dialog
4. User interactions trigger mutations → React Query cache invalidation → UI updates

### Routing Integration

- Entry: `/menu` route (defined in App.tsx)
- Redirects: `/` if no username
- Navigates to: `/game/:gameId` when starting/resuming games
- Navigates to: `/help` via help button

### Hook Usage

**React Hooks**:
- `useState`: Local UI state (8 state variables)
- `useEffect`: Username validation and redirect logic
- `useMemo`: Derived creative catalogs and defaults parsing
- `useRef`: Not used in this component

**Custom Hooks**:
- `useToast`: Toast notification system
- `useLocation`: Routing navigation
- `useQuery`: 4 queries for data fetching
- `useMutation`: 2 mutations for game operations

**WebSocket Connections**: None

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Well-structured component with clear separation of concerns
- Proper TypeScript typing throughout
- Good error handling in mutations
- Accessible button labels and data-testid attributes

**Areas for Improvement**:
- Large component (521 lines) - could extract SnowCrashVisual as separate component
- Debug alert in `handleStartNewVoyage` (line 235) should be removed in production
- Inline styles defined at component level - could move to separate stylesheet
- Multiple setTimeout chains in `handleDangerClick` could use a state machine

### Performance Considerations

- Multiple parallel queries for reference data (themes, styles, defaults) - acceptable
- Creative catalogs memoization prevents unnecessary recalculations
- Image effects (Snow Crash canvas) render continuously - consider pause when not visible
- No lazy loading - all components loaded upfront

### Accessibility Features

- Semantic HTML structure
- Button aria labels via title attributes
- Keyboard navigation supported
- Loading states communicated to users
- Error messages displayed via toast notifications

### Error Handling

- Mutation error handlers present with toast notifications
- Query errors handled by React Query default error boundaries
- Username validation prevents unauthorized access
- No error boundary in component - relies on app-level boundaries

### Loading States

- Query loading handled by React Query suspense (implicit)
- Mutation pending states disable buttons and show loading text
- No skeleton loaders - simple disabled states

### Responsive Design Patterns

- Tailwind responsive classes (`sm:`, `md:`) used throughout
- Text sizing adapts to screen size
- Button sizes responsive
- Layout adapts via container classes

## API Calls

## Security & CSRF

- All mutations (start/delete game) use `apiRequest`, which automatically:
  - Includes `credentials: 'include'` for session-based auth
  - Attaches `X-CSRF-Token` for state-changing requests
  - Clears admin token on 401 and resets CSRF cache on CSRF-related 403
- Queries follow our segmented React Query key convention (see `docs_master/current/QUERY_KEY_GUIDELINES.md`).

### Synchronous API Calls

None. All API interactions are asynchronous via React Query or mutations.

### Asynchronous API Calls

**1. User Games Query**
 - **Hook**: `useQuery<GameState[]>`
 - **Query Key**: `['api', 'games', 'user', username]`
- **Endpoint**: `GET /api/games/user/{username}`
- **Purpose**: Fetch all games (voyages) for the current user
- **Cache**: Managed by React Query, refetched when invalidated
- **Loading State**: Handled by React Query, no explicit loading UI
- **Error Handling**: React Query error boundaries
- **Triggered**: Automatically when username is available
- **Line**: 149-153

**2. Story Themes Query**
 - **Hook**: `useQuery<ModStoryTheme[]>`
 - **Query Key**: `['api', 'reference', 'story-themes']`
- **Endpoint**: `GET /api/reference/story-themes`
- **Purpose**: Fetch available narrative themes for user preferences
- **Cache**: Infinite stale time via `REFERENCE_DATA_QUERY_OPTIONS`
- **Loading State**: React Query default
- **Error Handling**: React Query error boundaries
- **Triggered**: On component mount
- **Line**: 156-159

**3. Visual Styles Query**
 - **Hook**: `useQuery<ModVisualStyle[]>`
 - **Query Key**: `['api', 'reference', 'visual-styles']`
- **Endpoint**: `GET /api/reference/visual-styles`
- **Purpose**: Fetch available visual styles for user preferences
- **Cache**: Infinite stale time via `REFERENCE_DATA_QUERY_OPTIONS`
- **Loading State**: React Query default
- **Error Handling**: React Query error boundaries
- **Triggered**: On component mount
- **Line**: 161-164

**4. System Defaults Query**
 - **Hook**: `useQuery<{ image_model_key?, visual_style_key?, story_theme_key? }>`
 - **Query Key**: `['api', 'reference', 'system-defaults']`
- **Endpoint**: `GET /api/reference/system-defaults`
- **Purpose**: Fetch system-wide default settings for themes, styles, and image models
- **Cache**: Infinite stale time via `REFERENCE_DATA_QUERY_OPTIONS`
- **Loading State**: React Query default
- **Error Handling**: React Query error boundaries
- **Triggered**: On component mount
- **Line**: 167-174

### Mutations, Hooks, and Actions

**1. Start Game Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `POST /api/game/start`
- **Payload**: `{ username: string }`
- **Purpose**: Create a new game instance for the user
- **Success Handler**:
  - Updates React Query cache with new game state
  - Navigates to `/game/${gameId}`
- **Error Handler**: Shows toast notification with error message
- **Triggered By**: `handleStartNewVoyage` → `startGameMutation.mutate()`
- **Pending State**: Button shows "INITIALIZING..." with spinner
- **Line**: 195-213

**2. Delete Game Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `DELETE /api/game/${gameIdToDelete}`
- **Purpose**: Permanently delete a game (voyage)
- **Success Handler**:
  - Invalidates games query to refetch list
  - Shows success toast: "Game Deleted" / "Voyage has been scrubbed"
- **Error Handler**: React Query default error handling
- **Triggered By**: Delete button click → `deleteGameMutation.mutate(game.id)`
- **Pending State**: Delete button disabled during mutation
- **Line**: 215-226

**Action Handlers**:

1. **handleChangeCaptain** (Line 228-231)
   - Clears username from localStorage
   - Navigates to `/` (WelcomePage)
   - Triggered by: "CHANGE CAPTAIN" button

2. **handleStartNewVoyage** (Line 233-238)
   - Contains debug alert (should be removed)
   - Triggers `startGameMutation.mutate()`
   - Triggered by: "START NEW VOYAGE" button

3. **handleResumeGame** (Line 240-242)
   - Navigates to `/game/${gameId}`
   - Triggered by: "RESUME" or "VIEW" button on game cards

4. **handleDangerClick** (Line 244-260)
   - Sequential state updates for glitch effect
   - Sets glitch intensity: 'low' → 'high' → 'extreme'
   - Activates Snow Crash visual after 3 seconds
   - Shows reset button after 5 seconds
   - Triggered by: "⚠ DANGER ⚠" button

5. **handleReset** (Line 262-266)
   - Resets all glitch effects to initial state
   - Triggered by: Reset button in Snow Crash overlay

**Side Effects (useEffect)**:

1. **Username Validation** (Line 140-147)
   - Checks localStorage for username on mount
   - Redirects to `/` if username missing
   - Sets username state if found

## Dependencies

### React Hooks Used

- `useState`: 8 instances
  - `username`: User identity
  - `snowCrashActive`: Easter egg visual state
  - `glitchIntensity`: Visual effect intensity ('low' | 'high' | 'extreme')
  - `showResetButton`: Reset button visibility
  - `showSettingsDialog`: Settings modal visibility

- `useEffect`: 1 instance (username validation)

- `useMemo`: 2 instances
  - `defaults`: Parsed system defaults

### Custom Hooks Dependencies

- `useToast` from `@/hooks/use-toast`: Toast notification system
- `useLocation` from `wouter`: Routing navigation

### API Endpoints Consumed

1. `GET /api/games/user/{username}` - User games list
2. `GET /api/reference/story-themes` - Narrative themes
3. `GET /api/reference/visual-styles` - Visual styles
4. `GET /api/reference/system-defaults` - System defaults
5. `POST /api/game/start` - Create new game
6. `DELETE /api/game/{gameId}` - Delete game

### Component Dependencies

- `CRTBackground`: Visual background effect
- `UserSettingsDialog`: Preferences modal
- `Link` from `wouter`: Navigation links
- Lucide icons: Play, Trash2, Loader2, HelpCircle, Settings

### Third-Party Libraries

- `react`: Core framework
- `wouter`: Lightweight routing
- `@tanstack/react-query`: Server state management
- `lucide-react`: Icon library

## State Management

### Local State (useState)

1. **username**: `string | null`
   - Source: localStorage on mount
   - Used for: API queries, display

2. **snowCrashActive**: `boolean`
   - Initial: `false`
   - Toggled by: `handleDangerClick` sequence
   - Used for: Conditional Snow Crash canvas rendering

3. **glitchIntensity**: `'low' | 'high' | 'extreme'`
   - Initial: `'low'`
   - Changed by: `handleDangerClick` → `handleReset`
   - Used for: CRTBackground intensity, CSS classes

4. **showResetButton**: `boolean`
   - Initial: `false`
   - Set to `true`: After 5 seconds in danger sequence
   - Reset by: `handleReset`

5. **showSettingsDialog**: `boolean`
   - Initial: `false`
   - Toggled by: Settings button click
   - Used for: UserSettingsDialog open prop

### Server State (React Query)

1. **userGames**: `GameState[]`
   - Query key: `['api', 'games', 'user', username]`
   - Used for: Game list display

2. **themesData**: `ModStoryTheme[]`
   - Query key: `['api', 'reference', 'story-themes']`
   - Used for: UserSettingsDialog catalog

## Key Functions & Handlers

### User Interaction Handlers

1. **handleStartNewVoyage**: Starts new game mutation
2. **handleResumeGame**: Navigates to game page
3. **handleChangeCaptain**: Logs out user
4. **handleDangerClick**: Initiates easter egg sequence
5. **handleReset**: Resets easter egg effects

### Navigation Handlers

- `setLocation('/')`: Redirect to welcome page
- `setLocation('/game/${gameId}')`: Navigate to game
- `Link` component: Help page navigation

### Side Effects (useEffect)

**Username Validation Effect** (Line 140-147):
- Runs on mount
- Checks localStorage for username
- Redirects if missing, sets state if found
- Dependency: `setLocation`

## Styling & Theming

### CRT Aesthetic Implementation

- Color scheme: Cyan (`#00ffff`), orange (`#ffaa00`), red (`#ff0000`)
- Border styles: 2px borders with glow effects
- Typography: Monospace font (`font-mono`)
- Shadow effects: `shadow-[0_0_20px_#00ffff]` pattern
- Background: Black with `CRTBackground` overlay

### Tailwind CSS Usage

- Responsive utilities: `sm:`, `md:` prefixes
- Custom colors: `bg-[#001a1a]`, `text-[#00ffff]`
- Animations: Custom keyframes for pulse, flicker, glitch effects
- Layout: Flexbox and grid for responsive layouts

### Responsive Breakpoints

- Mobile: Default styles
- Small: `sm:` (640px+) - Larger padding, text sizes
- Medium: `md:` (768px+) - Enhanced title sizing

### Animation Usage

- **pulseGlow**: Button glow animation (4s infinite)
- **flicker**: Text flicker effect (3s infinite)
- **dissolve**: Glitch foreground fade (3s)
- **glitchRGB**: RGB text separation (0.1s infinite)
- **fadeIn**: Reset button appearance (1s)

## Testing Considerations

### Testable Elements (data-testid)

- `button-help`: Help navigation button
- `button-new-game`: Start new voyage button
- `button-resume-${gameId}`: Resume game buttons
- `button-delete-${gameId}`: Delete game buttons
- `button-change-captain`: Logout button
- `button-preferences`: Settings dialog trigger
- `button-danger`: Easter egg trigger
- `button-reset`: Reset glitch effects

### User Interaction Points

1. Start new voyage button click
2. Resume/view game button clicks
3. Delete game button clicks (with confirmation)
4. Settings button → UserSettingsDialog interactions
5. Help button navigation
6. Change captain (logout) button
7. Danger button easter egg sequence

### Edge Cases to Test

- No username in localStorage → redirect to `/`
- Empty games list → "No saved voyages yet" message
- Completed games → "COMPLETE" or "FAILED" badges
- Network errors during mutations → error toasts
- Loading states during game creation
- Multiple rapid clicks on mutations

## Known Issues & Technical Debt

### Performance Bottlenecks

- **Snow Crash Canvas**: Continuous rendering loop (requestAnimationFrame) even when not visible
  - **Fix**: Pause animation when component not visible or effects disabled

- **Multiple Parallel Queries**: 4 queries fire simultaneously on mount
  - **Status**: Acceptable - data needed immediately
  - **Consideration**: Could combine into single endpoint

### Code Duplication

- **Glitch CSS Classes**: Similar patterns repeated in multiple components
  - **Fix**: Extract to shared CSS module or Tailwind config

### Maintenance Concerns

- **Debug Code**: `window.alert` in `handleStartNewVoyage` (line 235)
  - **Action**: Remove before production

- **Inline Styles**: Large `<style>` block at component bottom (lines 439-517)
  - **Fix**: Move to separate stylesheet or Tailwind config

- **Magic Numbers**: Timeout values in `handleDangerClick` (1500ms, 3000ms, 5000ms)
  - **Fix**: Extract to named constants

### Future Improvements

1. **Component Extraction**:
   - Extract `SnowCrashVisual` to separate component file
   - Extract game card to `GameCard` component

2. **State Management**:
   - Consider using state machine for danger/easter egg sequence
   - Reduce nested state updates

3. **Error Boundaries**:
   - Add error boundary specifically for this page
   - Better error recovery UX

4. **Accessibility**:
   - Add ARIA labels for complex interactions
   - Keyboard shortcuts for common actions

5. **Performance**:
   - Lazy load Snow Crash effect
   - Virtualize game list if it grows large

## Maintenance Guidelines

### When to Modify This Page

- Adding new game metadata to display
- Changing game list sorting/filtering
- Updating user preferences flow
- Modifying navigation structure
- Adding new menu features

### Common Modification Patterns

1. **Adding New Menu Actions**:
   - Create mutation in component
   - Add button with handler
   - Update success/error handling

2. **Changing Game Display**:
   - Modify game card rendering (lines 327-368)
   - Update game state type if needed

3. **Updating Settings Flow**:
  - Review settings dialog behaviour when reference data schema changes
   - Update `UserSettingsDialog` props

### Breaking Change Considerations

- **API Changes**: Update all query keys and mutation endpoints
- **Route Changes**: Update all `setLocation` calls
- **Component Props**: Update `UserSettingsDialog` usage if interface changes
- **State Structure**: Update localStorage key names if changed
