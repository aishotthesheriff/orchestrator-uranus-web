# Loading State Architecture Documentation

## Overview

The Quest to Uranus application uses a sophisticated two-tier loading state architecture that separates web app infrastructure loading from gameplay content loading. This design ensures clean separation of concerns, better maintainability, and improved user experience.

## Architecture Principles

### 1. Separation of Concerns
- **App-Level Loading**: Infrastructure concerns (asset preloading, authentication, device detection)
- **Game Content Loading**: Gameplay concerns (action processing, image generation, turn completion)

### 2. Reusable Components
- Standardized loading components for consistent UI
- Type-safe loading state management
- Centralized loading state logic

### 3. Performance Optimization
- Non-blocking loading states
- Contextual loading indicators
- Automatic state cleanup

## Loading State Tiers

### Tier 1: App-Level Loading (Infrastructure)

#### Purpose
Manages loading states for web app infrastructure that occurs before or outside of gameplay.

#### Hook: `useAppLoading`
**File**: `client/src/hooks/useAppLoading.ts`

**State Properties**:
- `isLoadingAssets`: Asset preloading status
- `isDetectingDevice`: Mobile/desktop detection status  
- `isLoadingGameData`: Initial game data fetch status
- `isAppLoading`: Combined loading state

**Usage**:
```typescript
const { isLoadingAssets, isDetectingDevice, isLoadingGameData, setLoading } = useAppLoading();
```

#### Components
- **`AppLoadingSpinner`**: Full-screen loading with progress bar
- **`GameDataLoading`**: Simple spinner for game data loading

#### Triggers
- App startup and asset preloading
- Device detection (mobile vs desktop)
- Initial game data fetching
- Authentication checks

#### Device Detection Implementation
Device detection uses the `useIsMobile()` hook (`client/src/hooks/use-mobile.tsx`) which:
- Returns `undefined` during initial detection (indicating detection is in progress)
- Uses `window.matchMedia` with a 768px breakpoint
- Returns `true` for mobile devices, `false` for desktop
- Page components show `GameDataLoading` while `isMobile === undefined`

**Pattern**:
```typescript
const isMobile = useIsMobile();
const { setLoading } = useAppLoading();

// Device detection loading
if (isMobile === undefined) {
  return <GameDataLoading />;
}
```

### Tier 2: Game Content Loading (Gameplay)

#### Purpose
Manages loading states for gameplay content that occurs during active game sessions.

#### Hook: `useGameContentLoading`
**File**: `client/src/hooks/useGameContentLoading.ts`

**State Properties**:
- `isProcessingAction`: Action processing status
- `isGeneratingImage`: Image generation status
- `currentActionText`: Currently processing action text
- `isContentLoading`: Combined content loading state

**Usage**:
```typescript
const { isProcessingAction, currentActionText, setLoading } = useGameContentLoading();
```

#### Components
- **`GameContentLoading`**: Inline loading indicator for action/image processing

#### Triggers
- Action processing (when player takes an action)
- Image generation (manual or automatic)
- Turn completion and state updates

#### Image Generation Loading State
The `isGeneratingImage` state is used for manual image generation triggered by user clicks:
- Set to `true` when user clicks the "VISUALIZE" or "REGENERATE VISUAL" button
- Cleared automatically when the mutation completes (success or error)
- Not used for automatic image generation (which is handled via WebSocket events)

**State Lifecycle**:
1. User clicks image generation button → `setLoading('isGeneratingImage', true)`
2. Mutation sent to server → `generateImageMutation.mutate()`
3. Mutation completes (success or error) → `isGeneratingImage` cleared via `useEffect`
4. WebSocket `imageReady` or `imageFailed` events may also arrive (for display purposes)

## Loading Flow

### 1. App Initialization
```
LoadingPage → Asset Preloading → Authentication Check → Route to Menu/Game
```

### 2. Game Entry
```
GamePage → Device Detection → Game Data Loading → Render Game Interface
```

### 3. Action Processing
```
Action Click → Content Loading State → API Call → WebSocket Response → Clear Loading
```

### 4. Image Generation (Manual)
```
Image Button Click → Set isGeneratingImage=true → API Call → Mutation Complete → Clear isGeneratingImage
```

**Manual Image Generation Flow**:
1. User clicks "VISUALIZE" button
2. `setLoading('isGeneratingImage', true)` - Loading indicator shown
3. `generateImageMutation.mutate()` - API request sent
4. Mutation completes (success or error)
5. `useEffect` detects completion → `setLoading('isGeneratingImage', false)`
6. Optional: WebSocket `imageReady` event arrives for display update

**Note**: Automatic image generation (triggered after turn completion) uses WebSocket events only and doesn't set `isGeneratingImage`.

## Component Usage Patterns

### App-Level Loading Components

#### LoadingPage
```typescript
const { setLoading } = useAppLoading();

// Asset preloading
Promise.all(videos.map(preloadVideo)).then(() => {
  setLoading('isLoadingAssets', false);
  // Route to next page
});

return <AppLoadingSpinner message="LOADING E.L.O.N..." progress={progress} />;
```

#### GamePage
```typescript
const { setLoading } = useAppLoading();

if (isMobile === undefined) {
  return <GameDataLoading />;
}
```

### Game Content Loading Components

#### DesktopGamePage / MobileGamePage
```typescript
const { isProcessingAction, currentActionText, isGeneratingImage, setLoading } = useGameContentLoading();
const { generateImageMutation } = useGameLogic();

// Clear action loading when turn completes
useEffect(() => {
  if (gameState?.turns.length && !isLoading) {
    setLoading('isProcessingAction', false);
    setLoading('currentActionText', null);
  }
}, [gameState?.turns.length, isLoading, setLoading]);

// Clear image generation loading when mutation completes
useEffect(() => {
  if (!generateImageMutation.isPending && generateImageMutation.isSuccess) {
    setLoading('isGeneratingImage', false);
  }
  if (!generateImageMutation.isPending && generateImageMutation.isError) {
    setLoading('isGeneratingImage', false);
  }
}, [generateImageMutation.isPending, generateImageMutation.isSuccess, generateImageMutation.isError, setLoading]);

// Action processing
const handleActionClick = (action: string) => {
  setLoading('currentActionText', action);
  setLoading('isProcessingAction', true);
  // Scroll to top
  // Call action handler
};

// Image generation
const handleImageGeneration = () => {
  setLoading('isGeneratingImage', true);
  generateImageMutation.mutate({
    templateName: 'general_scene',
    gameId: gameId!,
    turnNumber: currentTurnNumber
  });
};

// Loading indicators
{isProcessingAction && currentActionText && (
  <GameContentLoading actionText={currentActionText} type="action" />
)}
{isGeneratingImage && (
  <GameContentLoading type="image" />
)}
```

## State Management Integration

### useGameLogic Hook
The main game logic hook has been cleaned up to focus purely on business logic:

**Removed**:
- `currentActionText` state management
- Loading state UI concerns
- Scroll-to-top logic (moved to page components)

**Retained**:
- Game state management
- API mutations
- WebSocket handling
- Business logic functions

### Page Components
Each page component now manages its own loading states:

**DesktopGamePage / MobileGamePage**:
- Use `useGameContentLoading` for action and image generation processing
- Handle scroll-to-top behavior (desktop: `scrollRef.current.scrollTop = 0`, mobile: `window.scrollTo()`)
- Manage loading indicators for both actions and images
- Implement cleanup `useEffect` hooks to clear loading states:
  - Action loading: Cleared when `gameState.turns.length` changes (turn completes)
  - Image loading: Cleared when `generateImageMutation` completes (success or error)

**GamePage**:
- Use `useAppLoading` for device detection
- Uses `useIsMobile()` hook which returns `undefined` during detection
- Shows `GameDataLoading` while device is being detected
- Routes to appropriate platform component (`DesktopGamePage` or `MobileGamePage`)

## Benefits

### 1. Clean Architecture
- Clear separation between infrastructure and gameplay loading
- Single responsibility for each hook and component
- Easier to test and maintain

### 2. Better User Experience
- Contextual loading indicators
- Non-blocking loading states
- Consistent loading UI across the app

### 3. Developer Experience
- Type-safe loading state management
- Reusable loading components
- Clear loading state flow

### 4. Performance
- Optimized loading state updates
- Automatic state cleanup
- Reduced unnecessary re-renders

## Migration Notes

### Breaking Changes
- `currentActionText` removed from `useGameLogic`
- Loading state management moved to dedicated hooks
- Scroll-to-top logic moved to page components

### New Dependencies
- `useAppLoading` hook for app-level loading
- `useGameContentLoading` hook for content loading
- Loading components in `src/components/loading/`

### Updated Components
- `LoadingPage`: Now uses `AppLoadingSpinner`
- `GamePage`: Now uses `GameDataLoading`
- `DesktopGamePage` / `MobileGamePage`: Now use content loading hooks

## Loading State Cleanup Patterns

### Action Processing Cleanup
Action loading states are cleared when a new turn is detected:

```typescript
useEffect(() => {
  if (gameState?.turns.length && !isLoading) {
    setLoading('isProcessingAction', false);
    setLoading('currentActionText', null);
  }
}, [gameState?.turns.length, isLoading, setLoading]);
```

**Trigger**: When `gameState.turns.length` changes (new turn added), indicating the action has been processed and narrative is ready.

### Image Generation Cleanup
Image generation loading state is cleared when the mutation completes:

```typescript
useEffect(() => {
  if (!generateImageMutation.isPending && generateImageMutation.isSuccess) {
    setLoading('isGeneratingImage', false);
  }
  if (!generateImageMutation.isPending && generateImageMutation.isError) {
    setLoading('isGeneratingImage', false);
  }
}, [generateImageMutation.isPending, generateImageMutation.isSuccess, generateImageMutation.isError, setLoading]);
```

**Trigger**: When `generateImageMutation` transitions from pending to success or error state.

**Important**: This cleanup handles manual image generation. Automatic image generation (after turn completion) uses WebSocket events for display but doesn't require loading state management.

## Future Enhancements

### Potential Improvements
1. **Loading State Persistence**: Save loading states across page refreshes
2. **Loading State Analytics**: Track loading performance metrics
3. **Progressive Loading**: Show partial content while loading
4. **Loading State Caching**: Cache loading states for better performance

### Extensibility
The architecture is designed to be easily extensible:
- New loading states can be added to existing hooks
- New loading components can be created for specific use cases
- Loading state logic can be shared across components

## Testing

### Unit Tests
- Test individual loading hooks in isolation
- Test loading components with different props
- Test loading state transitions

### Integration Tests
- Test complete loading flows
- Test loading state cleanup
- Test error handling during loading

### E2E Tests
- Test user interactions during loading states
- Test loading state persistence
- Test loading state performance
