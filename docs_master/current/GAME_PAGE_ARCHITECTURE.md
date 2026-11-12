# Game Page Architecture

This document provides a comprehensive overview of the game page system, including routing, component variants, state management, and user flows.

## Overview

The game page system consists of a router component (`GamePage.tsx`) that detects device type and renders one of four layout variants:
- **OptimizedGamePage**: New mobile-optimized layout (default for mobile, with A/B testing)
- **MobileGamePage**: Classic mobile layout (fallback via `?view=classic`)
- **DesktopGamePage**: Full desktop layout (via `?view=full`)
- **CompactDesktopGamePage**: Compact desktop layout (default for desktop)

All variants share the same core game logic via the `useGameLogic` hook, but differ in UI presentation and interaction patterns.

## Routing Architecture

### GamePage.tsx (Router)

**File:** `client/src/pages/GamePage.tsx`

**Purpose**: Device-aware router that selects the appropriate game layout component.

**Routing Logic**:

```typescript
1. Detect device type via useIsMobile()
2. If undefined → Show loading state
3. If mobile:
   - Check ?view=classic → MobileGamePage
   - Otherwise: A/B test (localStorage preference or random)
     - 'optimized' → OptimizedGamePage
     - 'classic' → MobileGamePage
4. If desktop:
   - Check ?view=full → DesktopGamePage
   - Otherwise → CompactDesktopGamePage
```

**Key Features**:
- Device detection with loading state handling
- A/B testing for mobile layouts (50/50 split, persisted in localStorage)
- Query parameter overrides (`?view=classic`, `?view=full`)
- Seamless fallback to loading state during detection

**Local Storage Keys**:
- `game-page-version`: Stores A/B test preference (`'optimized'` or `'classic'`)

## Component Variants

### 1. OptimizedGamePage (New Mobile Layout)

**File:** `client/src/pages/OptimizedGamePage.tsx`

**Purpose**: Modern, mobile-first game interface with drawer-based interactions and optimized performance.

**Key Features**:
- **Specialized Hooks**: Uses `useNarrative`, `useStoryImage`, `useChoices` for parallel data loading
- **Turn History**: `useTurnHistory` hook for back navigation
- **Drawer UI**: Choices presented in bottom drawer (slide-up)
- **Fixed Layout**: Full-screen fixed layout with layered z-index system
- **Typewriter Effect**: Respects `typewriterEnabled` user preference
- **Image Toggle**: Floating button to show/hide background image
- **Game Complete Screen**: Dedicated end-game component

**Component Structure**:
```
OptimizedGamePage
├── BackgroundImage (z-0/z-35 based on visibility)
├── Header (fixed, z-30)
│   ├── Title & Progress
│   └── Action Buttons (Back, Restart, Help, Settings)
├── Content Layer (z-10)
│   └── NarrativeCard (scrollable)
├── ImageToggleButton (floating, z-20)
├── ChoicesToggleButton (floating, z-20)
├── ChoicesDrawer (z-40/z-50, bottom drawer)
├── StatsPanel (floating, z-20)
├── EquipmentPanel (floating, z-20)
├── UserSettingsDialog
└── HelpDialog
```

**State Management**:
- Uses `useGameLogic` for core game state
- Local state: `choicesOpen`, `imageVisible`
- User preferences: `typewriterEnabled` from `useUserSettings`
- Turn history: Managed by `useTurnHistory` hook

**Data Loading**:
- Parallel loading via specialized hooks (shares React Query cache with `useGameLogic`)
- Independent loading states for narrative, image, and choices
- Error handling per data type

**Optimized Components** (from `client/src/components/optimized/*`):
- `BackgroundImage`: Full-screen background image with loading state
- `NarrativeCard`: Glassmorphic card with typewriter text
- `NarrativeText`: Typewriter effect component
- `ChoicesDrawer`: Bottom drawer with choice buttons
- `ChoicesToggleButton`: Floating button to open drawer
- `ImageToggleButton`: Floating button to toggle image
- `StatsPanel`: Floating stats display
- `EquipmentPanel`: Floating equipment management
- `GameCompleteScreen`: End game screen
- `ChoiceButton`: Individual choice button with animations

**User Flow**:
1. Page loads → Shows loading state until intro ready
2. Game state ready → Renders narrative, image, choices in parallel
3. User reads narrative (with optional typewriter effect)
4. User taps choices button → Drawer slides up
5. User selects choice → Action sent, drawer closes
6. Turn completes → Socket event updates state
7. New narrative/image/choices load automatically

**Advantages**:
- Better performance (parallel data loading, shared cache)
- Modern mobile UX (drawer, floating buttons)
- Cleaner code (specialized hooks, focused components)
- Better accessibility (clear z-index layering)
- Turn history support (back navigation)

**Limitations**:
- Back navigation not fully implemented (history tracked but navigation pending)
- Restart button currently just navigates to menu

### 2. MobileGamePage (Classic Mobile Layout)

**File:** `client/src/pages/MobileGamePage.tsx`

**Purpose**: Original mobile layout with vertical scrolling and inline actions.

**Key Features**:
- **Vertical Scrolling**: Traditional scroll-based layout
- **Inline Actions**: Action chips displayed directly in narrative
- **Collapsible History**: Previous turns can be collapsed/expanded
- **Custom Actions**: Text input for custom actions
- **Manual Image Generation**: Button to trigger image generation
- **CRT Background**: Optional retro visual effect

**Component Structure**:
```
MobileGamePage
├── CRTBackground (optional)
├── Header
│   ├── Stats (CompactStat)
│   └── Action Buttons
├── Scrollable Content
│   ├── TurnCard (current turn)
│   ├── Previous Turns (collapsible)
│   ├── Action Chips (inline)
│   ├── Custom Action Input
│   └── Image Generation Button
├── Equipment Section
├── UserSettingsDialog
└── HelpDialog
```

**State Management**:
- Uses `useGameLogic` for core game state
- Uses `useGameContentLoading` for action/image loading states
- Local scroll handling (scrolls to top on action)

**Data Loading**:
- Single query via `useGameLogic` (fetches all game state)
- Content loading states managed separately for UX

**User Flow**:
1. Page loads → Shows loading state
2. Game state ready → Renders all turns in scrollable view
3. User scrolls through narrative
4. User taps action chip → Scrolls to top, shows loading
5. Turn completes → New turn added to scroll
6. User can collapse previous turns
7. User can generate images manually

**Advantages**:
- Familiar scroll-based interface
- See all turns at once
- Manual image generation control
- Custom action input

**Limitations**:
- Less performant (single large query, all turns rendered)
- More complex state management
- Less modern UX patterns

### 3. DesktopGamePage (Full Desktop Layout)

**File:** `client/src/pages/DesktopGamePage.tsx`

**Purpose**: Full desktop layout with sidebar and expanded view.

**Key Features**:
- **Sidebar Layout**: Stats and equipment in sidebar
- **Expanded Narrative**: Larger narrative display area
- **Scrollable Content**: Similar to mobile but with more space
- **All Features**: Includes all mobile features plus sidebar

**Component Structure**:
```
DesktopGamePage
├── Sidebar (left)
│   ├── Stats (StatBar)
│   ├── Equipment
│   └── Settings
└── Main Content (right)
    └── [Same as MobileGamePage]
```

**State Management**: Same as MobileGamePage

**User Flow**: Similar to MobileGamePage but with sidebar navigation

### 4. CompactDesktopGamePage

**File:** `client/src/pages/CompactDesktopGamePage.tsx`

**Purpose**: Wrapper that renders MobileGamePage for desktop.

**Implementation**: Simply returns `<MobileGamePage />`

**Rationale**: Provides mobile-like experience on desktop for users who prefer compact view.

## Shared Core Logic

### useGameLogic Hook

**File:** `client/src/hooks/useGameLogic.ts`

**Purpose**: Centralized game state management and actions.

**Responsibilities**:
- Fetch game state, items, themes, styles, system defaults
- Handle actions (`POST /api/game/action`)
- Generate images (`POST /api/generate-image`)
- Update equipment (`PATCH /api/games/:id/equipped-items`)
- Update game settings (`PATCH /api/games/:id/settings`)
- Update user preferences (`PATCH /api/user/preferences`)
- Wire up Socket.IO events (turnComplete, imageReady, imageFailed)
- Compute `isIntroReady` (checks if intro turn has narrative and actions)

**Returns**:
- Game state: `gameState`, `items`, `isLoading`, `isIntroReady`, `gameId`
- UI state: `showSettings`, `showHelp`, `showPreviousTurns`, etc.
- Preferences: `theme`, `style`, `imageModelKey`
- Mutations: `actionMutation`, `generateImageMutation`, etc.
- Handlers: `handleActionClick`, `handleCustomAction`, `toggleItem`, etc.

**Socket.IO Integration**:
- `joinGame(gameId)`: Joins game room on mount
- `turnComplete`: Invalidates game query, shows toast
- `imageReady`: Refetches game query, shows toast
- `imageFailed`: Shows error toast
- `leaveGame(gameId)`: Cleanup on unmount

### Specialized Hooks (OptimizedGamePage Only)

**File:** `client/src/hooks/useOptimizedGameContent.ts`

**Purpose**: Parallel data loading for optimized game page.

**Hooks**:
- `useNarrative(turnNumber, gameId)`: Loads narrative text
- `useStoryImage(turnNumber, gameId)`: Loads story image
- `useChoices(gameId, isComplete)`: Loads choices/actions

**Key Feature**: All hooks share the same React Query cache as `useGameLogic`, avoiding duplicate fetches.

**File:** `client/src/hooks/useTurnHistory.ts`

**Purpose**: Turn history navigation.

**Returns**:
- `history`: Array of turn numbers
- `currentTurnNumber`: Current turn number
- `goBack()`: Navigate to previous turn (returns turn number)
- `canGoBack`: Boolean indicating if back navigation is possible

## State Management Patterns

### OptimizedGamePage State Flow

```
useGameLogic (shared)
  ├── Game State (React Query)
  ├── Items (React Query)
  ├── Themes/Styles (React Query)
  └── Mutations (React Query)

useOptimizedGameContent (parallel)
  ├── useNarrative (React Query, shared cache)
  ├── useStoryImage (React Query, shared cache)
  └── useChoices (React Query, shared cache)

useTurnHistory (local)
  └── History stack (useState)

Local State
  ├── choicesOpen (useState)
  └── imageVisible (useState)
```

### MobileGamePage State Flow

```
useGameLogic (shared)
  └── [Same as OptimizedGamePage]

useGameContentLoading (local)
  ├── isProcessingAction
  ├── currentActionText
  └── isGeneratingImage

Local Scroll Handling
  └── scrollRef (useRef)
```

## User Flows

### OptimizedGamePage Flow

1. **Initial Load**
   - Show loading state until `isIntroReady`
   - Load narrative, image, choices in parallel
   - Display narrative card with typewriter effect (if enabled)

2. **Reading Narrative**
   - User reads narrative (typewriter or instant)
   - Background image visible (toggleable)
   - Stats and equipment visible in floating panels

3. **Making Choices**
   - User taps choices button → Drawer slides up
   - User selects choice → Action sent, drawer closes
   - Loading state shown (narrative/image/choices refresh)

4. **Turn Completion**
   - Socket event received → State invalidated
   - New narrative/image/choices load automatically
   - Toast notification shown

5. **Navigation**
   - Back button (if available) → Navigate to previous turn
   - Restart button → Navigate to menu (TODO: implement restart)
   - Settings/Help buttons → Open dialogs

### MobileGamePage Flow

1. **Initial Load**
   - Show loading state
   - Load game state (all turns)
   - Render all turns in scrollable view

2. **Reading Narrative**
   - User scrolls through narrative
   - Previous turns can be collapsed
   - Stats visible at top

3. **Making Choices**
   - User taps action chip → Scrolls to top
   - Loading state shown
   - Action sent to server

4. **Turn Completion**
   - Socket event received → State invalidated
   - New turn added to scroll
   - User can scroll to see new turn

5. **Image Generation**
   - User taps "Generate Image" button
   - Image generated and displayed
   - Can be regenerated manually

## Performance Considerations

### OptimizedGamePage

**Advantages**:
- Parallel data loading (narrative, image, choices load independently)
- Shared React Query cache (no duplicate fetches)
- Memoized components (NarrativeCard, ChoicesDrawer)
- Only current turn rendered (not all turns)

**Optimizations**:
- `useMemo` for derived state (currentTurnNumber, typewriterEnabled)
- `useCallback` for event handlers
- React.memo for optimized components

### MobileGamePage

**Considerations**:
- Single large query (all game state at once)
- All turns rendered (can be many DOM nodes)
- Scroll performance (virtualization not implemented)

**Potential Improvements**:
- Virtual scrolling for turn history
- Lazy loading of previous turns
- Pagination of turn history

## Component Architecture

### Optimized Components

Located in `client/src/components/optimized/*`:

- **BackgroundImage**: Full-screen background with loading/error states
- **NarrativeCard**: Glassmorphic card wrapper for narrative
- **NarrativeText**: Typewriter effect implementation
- **ChoicesDrawer**: Bottom drawer with choice buttons
- **ChoicesToggleButton**: Floating button to open drawer
- **ImageToggleButton**: Floating button to toggle image
- **StatsPanel**: Floating stats display
- **EquipmentPanel**: Floating equipment management
- **GameCompleteScreen**: End game screen
- **ChoiceButton**: Individual choice button with animations

### Classic Components

Used by MobileGamePage/DesktopGamePage:

- **TurnCard**: Turn narrative display
- **ActionChip**: Action button component
- **StatBar/CompactStat**: Resource display
- **WeirdnessMeter**: Absurdity tracker
- **ItemCard**: Item display card
- **NPCCard**: NPC display card

## API Integration

### Endpoints Used

All game pages use the same endpoints via `useGameLogic`:

- `GET /api/game/:gameId` - Fetch game state
- `POST /api/game/action` - Submit action
- `POST /api/generate-image` - Generate image
- `PATCH /api/games/:id/equipped-items` - Update equipment
- `PATCH /api/games/:id/settings` - Update game settings
- `PATCH /api/user/preferences` - Update user preferences

### Socket.IO Events

- `joinGame(gameId)` - Join game room
- `turnComplete` - Turn narrative ready
- `imageReady` - Image generation complete
- `imageFailed` - Image generation failed
- `leaveGame(gameId)` - Leave game room

## Known Issues & Technical Debt

### OptimizedGamePage

1. **Back Navigation**: History tracked but navigation not implemented
   - **Status**: TODO
   - **Impact**: Back button doesn't actually navigate to previous turn

2. **Restart Functionality**: Currently just navigates to menu
   - **Status**: TODO
   - **Impact**: Restart button doesn't restart game

### MobileGamePage

1. **Performance**: All turns rendered at once
   - **Status**: Known limitation
   - **Impact**: Can be slow with many turns

2. **Scroll Handling**: Multiple scroll-to-top calls
   - **Status**: Minor optimization opportunity
   - **Impact**: Slight performance overhead

### General

1. **A/B Testing**: Simple localStorage-based implementation
   - **Status**: Functional but basic
   - **Future**: Could use feature flags or analytics service

2. **Device Detection**: Single breakpoint (768px)
   - **Status**: Functional
   - **Future**: Could add tablet-specific layout

## Migration Path

### From MobileGamePage to OptimizedGamePage

The OptimizedGamePage represents a modernization of the mobile experience:

1. **Better Performance**: Parallel loading, shared cache
2. **Modern UX**: Drawer-based interactions, floating buttons
3. **Cleaner Code**: Specialized hooks, focused components
4. **Better Accessibility**: Clear z-index layering, better touch targets

**Migration Strategy**:
- A/B testing allows gradual rollout
- `?view=classic` provides escape hatch
- Both variants maintained during transition

## Testing Considerations

### Test Cases

1. **Device Detection**:
   - Mobile device → OptimizedGamePage (or MobileGamePage with override)
   - Desktop device → DesktopGamePage or CompactDesktopGamePage
   - Undefined state → Loading spinner

2. **A/B Testing**:
   - First visit → Random assignment
   - Subsequent visits → Uses localStorage preference
   - Override via `?view=classic` → Forces MobileGamePage

3. **Query Parameters**:
   - `?view=classic` → MobileGamePage (mobile only)
   - `?view=full` → DesktopGamePage (desktop only)

4. **State Management**:
   - Game state loading → Loading state shown
   - Intro ready → Game renders
   - Turn completion → Socket event updates state
   - Image generation → Socket event updates state

5. **OptimizedGamePage Specific**:
   - Drawer opens/closes correctly
   - Image toggle works
   - Turn history navigation (when implemented)
   - Typewriter effect respects preference

## Future Enhancements

### OptimizedGamePage

1. **Turn Navigation**: Implement full back navigation
2. **Restart Game**: Implement actual game restart
3. **Turn History View**: Show turn history in drawer
4. **Swipe Gestures**: Add swipe for drawer/choices
5. **Haptic Feedback**: Add haptic feedback for actions

### MobileGamePage

1. **Virtual Scrolling**: Implement for turn history
2. **Lazy Loading**: Load previous turns on demand
3. **Pagination**: Paginate turn history
4. **Performance**: Optimize rendering of many turns

### General

1. **Tablet Layout**: Add tablet-specific layout
2. **Feature Flags**: Replace localStorage A/B testing
3. **Analytics**: Track which layout users prefer
4. **Accessibility**: Improve screen reader support
5. **Offline Support**: Cache game state for offline play

---

## Authoritative References

- **Client Functional Documentation**: `docs_master/current/CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`
- **Game Logic Hook**: `client/src/hooks/useGameLogic.ts`
- **Optimized Game Content Hooks**: `client/src/hooks/useOptimizedGameContent.ts`
- **Turn History Hook**: `client/src/hooks/useTurnHistory.ts`

