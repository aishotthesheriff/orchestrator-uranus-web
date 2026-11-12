# DesktopGamePage Documentation

## Page Overview

**Purpose**: Desktop-optimized game interface with full sidebar layout featuring detailed stats, crew management, items panel, and expansive narrative feed. Designed for larger screens with mouse/keyboard interaction.

**User Flow**:
1. User navigates to game via GamePage router
2. Device detected as desktop → DesktopGamePage renders
3. Displays three-column layout: sidebar (stats/crew/items) + narrative feed + actions
4. User interacts via mouse clicks on action chips or keyboard navigation
5. Scrolls narrative feed independently

**Key Features**:
- Full sidebar with stats, crew, and items panels
- Expansive narrative feed with scrollable container
- Manual image generation with inline button
- Previous turns section with expand/collapse
- Dev tools link (desktop-only)
- Keyboard-friendly interactions

## Architecture Review

### Component Dependencies

- **useGameLogic**: Shared business logic hook - identical to MobileGamePage
- **useGameContentLoading**: Content loading state management
- **useAppLoading**: App-level loading state
- **CRTBackground**: Visual background effect
- **TurnCard**: Turn narrative display with visualize button
- **StatBar**: Full-size stat bars (vs compact on mobile)
- **NPCCard**: Crew member cards
- **ItemCard**: Equipment cards
- **WeirdnessMeter**: Absurdity tracker
- **GameContentLoading**: Loading indicators
- **UserSettingsDialog**: Settings modal
- **HelpDialog**: Help content modal

### State Management Patterns

- **Shared Logic**: All game logic via `useGameLogic` hook (same as MobileGamePage)
- **Local Enhancements**: Scroll behavior and content loading state
- **Server State**: Managed by useGameLogic (React Query)
- **Content Loading**: Separate state for action/image generation loading

### Data Flow

Identical to MobileGamePage - same hook, different presentation.

### Realtime Events (Socket.IO)

Realtime updates are handled by `useGameLogic` via a Socket.IO connection:
- `turnComplete` → Invalidates `['api','game', gameId]` to refresh turns
- `imageReady` → Invalidates `['api','game', gameId]`, shows success toast
- `imageFailed` → Shows error toast with details
Connection is joined/leaved per `gameId` lifecycle.

### Routing Integration

- Entry: Via GamePage router (`/game/:gameId`)
- Navigation: Back to menu handled by useGameLogic
- Dev Tools: Link to `/dev-tools` route

### Hook Usage

Identical to MobileGamePage - same hooks, same patterns.

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Excellent separation of concerns (business logic in hook)
- Clean component structure (436 lines)
- Proper use of shared components
- Good loading state management
- Accessible with data-testid attributes

**Areas for Improvement**:
- Very similar to MobileGamePage (98% identical logic)
- Scroll handling duplicated
- Loading cleanup effects could be combined

### Performance Considerations

- Efficient - delegates to hook
- Scroll behavior uses ref-based scrolling (better than mobile)
- Grid layout for sidebar optimization
- Previous turns collapsed by default

### Accessibility Features

- Semantic HTML structure
- data-testid attributes
- Keyboard navigation
- Focus management
- Screen reader support

## API Calls

### Synchronous API Calls

None. All API interactions are asynchronous.

### Asynchronous API Calls

All API calls handled by `useGameLogic` hook - identical to MobileGamePage.

## Security & CSRF

All mutations in `useGameLogic` use `apiRequest`, which handles session credentials and CSRF token attachment for state-changing requests. On 401, the admin token is cleared; CSRF cache resets on CSRF-related 403.

### Mutations, Hooks, and Actions

**Mutations from useGameLogic**: Same as MobileGamePage.

**Action Handlers**:

1. **handleActionClick** (Line 89-108)
   - Wraps original handler from useGameLogic
   - Sets content loading state
   - Scrolls to top (desktop: ref.current.scrollTop)
   - Calls original handler with `isMobile = false`

2. **handleCustomAction** (Line 110-129)
   - Wraps original handler from useGameLogic
   - Sets content loading state
   - Scrolls to top (desktop: ref.current.scrollTop)
   - Calls original handler with `isMobile = false`

**Side Effects**: Same as MobileGamePage (2 useEffect hooks for cleanup)

## Dependencies

Identical to MobileGamePage - same hooks, components, and dependencies.

## State Management

Identical to MobileGamePage.

## Key Functions & Handlers

Same handlers as MobileGamePage, with desktop-specific scroll behavior (ref-based vs window.scrollTo).

## Styling & Theming

### Desktop-Specific Layout

- Three-column grid: `lg:grid-cols-[320px_1fr]`
- Sidebar fixed width: 320px
- Narrative feed: Flexible width with min-height
- Larger text sizes for desktop
- More spacing throughout

## Testing Considerations

Similar to MobileGamePage with desktop-specific test cases:
- Grid layout behavior
- Ref-based scrolling
- Sidebar interactions
- Dev tools link

## Known Issues & Technical Debt

### Code Duplication

- **98% Duplicate Logic**: Nearly identical to MobileGamePage
  - **Fix**: Consider shared base component with layout prop
  - **Status**: Architectural decision - may be intentional separation

### Future Improvements

1. **Component Consolidation**: Extract shared layout to base component
2. **Layout Props**: Use single component with layout variants
3. **Shared Scroll Logic**: Extract scroll handlers to shared utility

## Maintenance Guidelines

Same as MobileGamePage - modifications should consider both mobile and desktop versions.
