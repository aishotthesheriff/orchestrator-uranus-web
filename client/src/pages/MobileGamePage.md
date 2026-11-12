# MobileGamePage Documentation

## Page Overview

**Purpose**: Mobile-optimized game interface providing a streamlined, touch-friendly experience for gameplay. Features compact stat displays, collapsible narrative sections, and vertical scrolling layout optimized for smaller screens.

**User Flow**:
1. User navigates to game via GamePage router
2. Device detected as mobile → MobileGamePage renders
3. Displays compact ship status, narrative feed, and actions
4. User interacts via touch-friendly action chips
5. Scrolls vertically through narrative history

**Key Features**:
- Compact stat bar with 5 core resources + weirdness meter
- Collapsible previous turns section
- Touch-optimized action chips
- Custom action input with toggle
- Manual image generation
- Responsive header with help/settings/back buttons

## Architecture Review

### Component Dependencies

- **useGameLogic**: Shared business logic hook (479 lines) - central state management
- **useGameContentLoading**: Content loading state management
- **useAppLoading**: App-level loading state
- **CRTBackground**: Visual background effect
- **TurnCard**: Turn narrative display component
- **ActionChip**: Action button component
- **StatBar/CompactStat**: Resource display components
- **WeirdnessMeter**: Absurdity tracker
- **GameContentLoading**: Loading indicators
- **UserSettingsDialog**: Settings modal
- **HelpDialog**: Help content modal

### State Management Patterns

- **Shared Logic**: All game logic via `useGameLogic` hook
- **Local Enhancements**: Scroll behavior and content loading state
- **Server State**: Managed by useGameLogic (React Query)
- **Content Loading**: Separate state for action/image generation loading

### Data Flow

1. Component receives gameId from route params (via useGameLogic)
2. useGameLogic fetches game state, items, themes, styles
3. User interactions trigger handlers → mutations → WebSocket updates
4. Content loading state managed separately for UX

### Realtime Events (Socket.IO)

Realtime updates are handled by `useGameLogic` via a Socket.IO connection:
- `turnComplete` → Invalidates `['api','game', gameId]` to refresh turns
- `imageReady` → Invalidates `['api','game', gameId]`, shows success toast
- `imageFailed` → Shows error toast with details
Connection is joined/leaved per `gameId` lifecycle.

### Routing Integration

- Entry: Via GamePage router (`/game/:gameId`)
- Navigation: Back to menu handled by useGameLogic
- No direct route changes from this component

### Hook Usage

**React Hooks**:
- `useState`: None (all state from useGameLogic)
- `useEffect`: 2 instances (loading state cleanup)
- `useRef`: Not used directly (scrollRef from useGameLogic)

**Custom Hooks**:
- `useGameLogic`: Central game logic (18 return values)
- `useGameContentLoading`: Content loading state
- `useAppLoading`: App-level loading (setter accessed but unused)

**WebSocket Connections**: Managed by useGameLogic hook

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Excellent separation of concerns (business logic in hook)
- Clean, focused component (403 lines)
- Good use of shared components
- Proper loading state management
- Accessible with data-testid attributes
- Responsive design throughout

**Areas for Improvement**:
- Scroll handling duplicated in handlers (could extract)
- Loading state cleanup effects could be combined
- Some unused hook returns (setAppLoading)

### Performance Considerations

- Efficient component - delegates heavy logic to hook
- Scroll behavior uses window.scrollTo (smooth scrolling)
- Image generation loading managed separately
- Previous turns collapsed by default (performance optimization)

### Accessibility Features

- Semantic HTML structure
- data-testid attributes for testing
- Keyboard navigation support
- Loading states communicated
- Focus management on scroll

### Error Handling

- Errors handled by useGameLogic mutations
- Toast notifications for errors
- Loading states clear on error

### Loading States

- Game data loading: GameDataLoading component
- Content loading: GameContentLoading for actions/images
- Mutation pending states disable buttons
- Clear loading state cleanup

### Responsive Design Patterns

- Mobile-first design
- Touch-friendly button sizes
- Compact stat layout (5 stats in grid)
- Vertical scrolling layout
- Responsive padding and spacing

## API Calls

### Synchronous API Calls

None. All API interactions are asynchronous.

### Asynchronous API Calls

All API calls are handled by the `useGameLogic` hook. This component does not make direct API calls.

**Queries Managed by useGameLogic**:
- Game state: `GET /api/game/${gameId}`
- Items: `GET /api/reference/items`
- Themes: `GET /api/reference/story-themes`
- Styles: `GET /api/reference/visual-styles`
- System defaults: `GET /api/reference/system-defaults`

### Mutations, Hooks, and Actions

**Mutations from useGameLogic**:

1. **actionMutation**
   - **Endpoint**: `POST /api/game/action`
   - **Payload**: `{ gameId, action, customText? }`
   - **Purpose**: Submit player action to process turn
   - **Success**: Triggers WebSocket update, shows toast
   - **Error**: Shows error toast
   - **Triggered By**: `handleActionClick` or `handleCustomAction`
   - **Line in useGameLogic**: 159-190

2. **generateImageMutation**
   - **Endpoint**: `POST /api/generate-image`
   - **Payload**: `{ templateName, gameId, turnNumber? }`
   - **Purpose**: Manually generate scene image
   - **Success**: Updates generatedImage state, shows toast
   - **Error**: Shows error toast
   - **Triggered By**: "VISUALIZE" button click
   - **Line in useGameLogic**: 192-216

3. **updateGameSettingsMutation**
   - **Endpoint**: `PATCH /api/games/${gameId}/settings`
   - **Purpose**: Update game settings (absurdity, etc.)
   - **Managed by**: useGameLogic, used in UserSettingsDialog

**Action Handlers**:

1. **handleActionClick** (Line 90-105)
   - Wraps original handler from useGameLogic
   - Sets content loading state
   - Scrolls to top (mobile: window.scrollTo)
   - Calls original handler with `isMobile = true`
   - Triggered by: Action chip clicks

2. **handleCustomAction** (Line 107-122)
   - Wraps original handler from useGameLogic
   - Sets content loading state
   - Scrolls to top (mobile: window.scrollTo)
   - Calls original handler with `isMobile = true`
   - Triggered by: Custom action submit button

**Side Effects (useEffect)**:

1. **Content Loading Cleanup** (Line 71-76)
   - Clears content loading when turn completes
   - Dependency: `gameState?.turns.length`, `isLoading`
   - Purpose: Reset loading state after turn processing

2. **Image Generation Loading Cleanup** (Line 79-86)
   - Clears image generation loading when mutation completes
   - Dependency: `generateImageMutation.isPending`, `isSuccess`, `isError`
  - Purpose: Reset loading state after image generation

## Security & CSRF

All mutations in `useGameLogic` use `apiRequest`, which handles session credentials and CSRF token attachment for state-changing requests. On 401, the admin token is cleared; CSRF cache resets on CSRF-related 403.

## Dependencies

### React Hooks Used

- `useEffect`: 2 instances (loading state cleanup)
- `useState`: None (all from useGameLogic)
- `useRef`: Accessed via useGameLogic return (scrollRef)

### Custom Hooks Dependencies

- `useGameLogic`: Central game logic (all game state and handlers)
- `useGameContentLoading`: Content loading state management
- `useAppLoading`: App-level loading (setter accessed but not used)

### API Endpoints Consumed

All endpoints accessed via useGameLogic:
- `GET /api/game/${gameId}` - Game state
- `GET /api/reference/items` - Items catalog
- `GET /api/reference/story-themes` - Themes
- `GET /api/reference/visual-styles` - Styles
- `GET /api/reference/system-defaults` - System defaults
- `POST /api/game/action` - Submit action
- `POST /api/generate-image` - Generate image

### Component Dependencies

- `CRTBackground`: Visual background
- `StatBar`, `CompactStat`: Resource displays
- `WeirdnessMeter`: Absurdity tracker
- `TurnCard`: Turn narrative display
- `ActionChip`: Action buttons
- `GameContentLoading`: Loading indicators
- `UserSettingsDialog`: Settings modal
- `HelpDialog`: Help modal
- `Button`, `Input`: UI components

### Third-Party Libraries

- `react`: Core framework
- `wouter`: Routing (Link component)
- `lucide-react`: Icons
- `@tanstack/react-query`: Server state (via useGameLogic)

## State Management

### Local State (useState)

None. All state managed by hooks:
- Game state: `useGameLogic`
- Content loading: `useGameContentLoading`
- App loading: `useAppLoading` (accessed but not modified)

### Server State (React Query)

All managed by `useGameLogic` hook:
- `gameState`: Current game state
- `items`: Items catalog
- `themesData`: Story themes
- `stylesData`: Visual styles
- `systemDefaultsData`: System defaults

### Derived State (useMemo)

All in `useGameLogic` hook.

## Key Functions & Handlers

### User Interaction Handlers

1. **handleActionClick**: Wraps useGameLogic handler with mobile scroll behavior
2. **handleCustomAction**: Wraps useGameLogic handler with mobile scroll behavior
3. **Toggle previous turns**: Via `setShowPreviousTurns` from useGameLogic
4. **Generate image**: Via `generateImageMutation` from useGameLogic
5. **Settings/Help dialogs**: Via state setters from useGameLogic

### Navigation Handlers

- `handleBackToMenu`: From useGameLogic, navigates to `/menu`

### Side Effects (useEffect)

1. **Content Loading Cleanup**: Resets loading state when turn completes
2. **Image Loading Cleanup**: Resets loading state when image generation completes

## Styling & Theming

### CRT Aesthetic Implementation

- Color scheme: Cyan, orange, pink for different sections
- Border styles: 2px borders with glow effects
- Typography: Monospace font
- Shadow effects: Glow patterns
- Background: Black with CRTBackground and space background image

### Tailwind CSS Usage

- Mobile-first responsive design
- Compact spacing for mobile
- Grid layouts for stats
- Touch-friendly button sizes
- Responsive text sizing

### Responsive Breakpoints

- Mobile: Default styles (optimized for small screens)
- Small: `sm:` - Slightly larger padding/text
- No desktop-specific breakpoints (this is mobile-only component)

### Animation Usage

- Smooth scroll behavior
- Loading spinner animations
- Transition effects on buttons

## Testing Considerations

### Testable Elements (data-testid)

- `game-title`: Game title in header
- `game-meta`: Day and segment display
- `button-help`: Help button
- `button-back-to-menu`: Back to menu button
- `button-settings`: Settings button
- `compact-stats-summary`: Stats panel
- `narrative-feed`: Narrative content area
- `button-generate-image`: Image generation button
- `button-toggle-previous-turns`: Previous turns toggle
- `previous-turns-section`: Previous turns container
- `actions-panel`: Actions section
- `button-custom-action`: Custom action toggle
- `input-custom-action`: Custom action input
- `button-submit-custom`: Custom action submit
- `action-chips`: Action buttons container

### User Interaction Points

1. Action chip clicks
2. Custom action input and submit
3. Previous turns expand/collapse
4. Image generation button
5. Settings dialog open/close
6. Help dialog open/close
7. Back to menu button

### Edge Cases to Test

- Empty game state (loading)
- No narrative content (shows loading)
- All actions disabled (game complete)
- Image generation failure
- Network errors during actions
- Rapid action clicking (should be disabled)
- Custom action with empty input

## Known Issues & Technical Debt

### Performance Bottlenecks

- **Window Scroll**: Uses `window.scrollTo` which may cause layout thrashing
  - **Fix**: Use IntersectionObserver or ref-based scrolling
  - **Impact**: Minor - smooth scroll may lag on slow devices

### Code Duplication

- **Scroll Logic**: Similar scroll logic in both handlers
  - **Fix**: Extract to shared function
  - **Status**: Low priority

- **Loading Cleanup**: Two similar useEffect hooks
  - **Fix**: Combine into single effect with multiple dependencies
  - **Status**: Low priority

### Maintenance Concerns

- **Unused Hook**: `setAppLoading` from `useAppLoading` accessed but never called
  - **Action**: Remove if not needed, or use for app-level loading
  - **Status**: Minor - no functional impact

### Future Improvements

1. **Scroll Optimization**:
   - Use ref-based scrolling instead of window.scrollTo
   - Add scroll position restoration
   - Smooth scroll polyfill for older browsers

2. **Performance**:
   - Virtualize previous turns list if it grows large
   - Lazy load images in TurnCard components
   - Memoize action chips rendering

3. **UX Enhancements**:
   - Add pull-to-refresh for game state
   - Haptic feedback on action clicks
   - Better loading skeletons

4. **Accessibility**:
   - ARIA live regions for turn updates
   - Better focus management on scroll
   - Screen reader announcements for actions

## Maintenance Guidelines

### When to Modify This Page

- Changing mobile layout structure
- Modifying scroll behavior
- Adding new mobile-specific features
- Updating action UI
- Changing loading state management

### Common Modification Patterns

1. **Adding New Action Types**:
   - Actions come from `gameState.currentActions` (server-driven)
   - No component changes needed if server provides actions

2. **Modifying Layout**:
   - Update JSX structure
   - Maintain mobile-first approach
   - Update responsive classes

3. **Changing Loading Behavior**:
   - Modify useEffect cleanup hooks
   - Update loading state management
   - Add new loading indicators if needed

### Breaking Change Considerations

- **Hook Changes**: If `useGameLogic` interface changes, update all destructured values
- **Component Props**: If child components require new props, pass them through
- **API Changes**: Handled by useGameLogic, but verify endpoint changes
- **Route Changes**: If game route structure changes, verify gameId extraction
