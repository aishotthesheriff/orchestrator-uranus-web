# Action UI Automation Documentation

## Overview
This document maps out every element change and screen automation that occurs when a user clicks an action on the game page. The game supports both desktop and mobile layouts with different UI behaviors.

## Loading State Architecture

The application uses a two-tier loading state system to separate web app infrastructure loading from gameplay content loading:

### App-Level Loading (Infrastructure)
- **`useAppLoading` hook**: Manages web app infrastructure loading states
- **`AppLoadingSpinner` component**: Reusable component for app-level loading
- **`GameDataLoading` component**: Simple spinner for game data loading
- **Triggers**: Asset preloading, authentication, device detection, initial game data fetch

### Game Content Loading (Gameplay)
- **`useGameContentLoading` hook**: Manages gameplay content loading states
- **`GameContentLoading` component**: Reusable component for action/image processing
- **Triggers**: Action processing, image generation, turn completion

This separation ensures clean architecture where UI loading concerns are separated from business logic.

## Action Click Flow

### 1. Action Click Initiation
**Trigger**: User clicks on an `ActionChip` component or submits a custom action

**Immediate UI Changes**:
- ActionChip visual feedback:
  - `isPressed` state set to `true`
  - CSS class changes to `scale-95` (button shrinks)
  - After 200ms, `isPressed` resets to `false` and `scale-100` (button returns to normal)
  - Console log: `Action triggered: ${action}`

**Code Reference**:
```27:35:client/src/components/ActionChip.tsx
<button
  className={`min-w-full sm:min-w-60 sm:max-w-72 p-3 sm:p-4 gap-2 sm:gap-3 flex flex-col items-start border-2 ${riskColors[risk]} ${riskBg[risk]} transition-all duration-200 hover:shadow-[0_0_15px_currentColor] active:shadow-[0_0_20px_currentColor] ${isPressed ? 'scale-95' : 'scale-100'}`}
  onClick={() => {
    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 200);
    onClick?.();
    console.log(`Action triggered: ${action}`);
  }}
```

### 2. Action Processing State
**Trigger**: `handleActionClick` or `handleCustomAction` called

**UI Changes**:
- Content loading state updated via `useGameContentLoading` hook:
  - `currentActionText` set to action text
  - `isProcessingAction` set to `true`
- Automatic scroll to top:
  - **Mobile**: `window.scrollTo({ top: 0, behavior: 'smooth' })`
  - **Desktop**: `scrollRef.current.scrollTop = 0`
- `actionMutation.mutate()` called

**Code Reference**:
```89:108:client/src/pages/DesktopGamePage.tsx
const handleActionClick = (action: string) => {
  // Set content loading state
  setContentLoading('currentActionText', action);
  setContentLoading('isProcessingAction', true);
  
  // Scroll to top immediately
  if (scrollRef.current) {
    scrollRef.current.scrollTop = 0;
  }
  
  // Also scroll to top after a short delay to ensure it sticks
  setTimeout(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, 100);
  
  // Call the original handler
  originalHandleActionClick(action, false);
};
```

### 3. Loading State Display
**Trigger**: `isProcessingAction` and `currentActionText` are both truthy

**UI Changes**:
- `GameContentLoading` component appears in narrative feed:
  - Container: `border-2 border-[#00ffff] bg-[#001a1a] animate-pulse shadow-[0_0_20px_#00ffff]`
  - Spinner: `Loader2` component with `animate-spin`
  - Text: "PROCESSING ACTION..."
  - Current action text displayed: `"${currentActionText}"`
  - Additional text: "Processing action..."

**Code Reference**:
```262:267:client/src/pages/DesktopGamePage.tsx
{isProcessingAction && currentActionText && (
  <GameContentLoading 
    actionText={currentActionText} 
    type="action" 
  />
)}
```

**Component Implementation**:
```1:25:client/src/components/loading/GameContentLoading.tsx
export default function GameContentLoading({ 
  actionText, 
  type = 'action',
  className = ''
}: GameContentLoadingProps) {
  const message = type === 'action' ? 'PROCESSING ACTION...' : 'GENERATING IMAGE...';
  
  return (
    <div className={`mb-6 p-4 border-2 border-[#00ffff] bg-[#001a1a] animate-pulse shadow-[0_0_20px_#00ffff] ${className}`} data-testid="loading-indicator">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-[#00ffff]" />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-[#00ffff] font-bold">{message}</span>
          {actionText && (
            <span className="text-xs text-[#ffaa00] italic" data-testid="current-action-text">
              "{actionText}"
            </span>
          )}
          <span className="text-xs text-[#00aaaa]">
            {type === 'action' ? 'Processing action...' : 'Generating scene...'}
          </span>
        </div>
      </div>
    </div>
  );
}
```

### 4. Previous Turns Auto-Hide
**Trigger**: Action click handler called (immediate, before mutation is sent)

**UI Changes**:
- `setShowPreviousTurns(false)` called immediately in `handleActionClick`/`handleCustomAction`
- Previous turns section collapses
- Toggle button text changes from "HIDE" to "SHOW"

**Code Reference**:
```399:410:client/src/hooks/useGameLogic.ts
const handleActionClick = (action: string, isMobile: boolean) => {
  if (!gameId || actionMutation.isPending) return;
  
  // All immediate UI state changes
  setShowPreviousTurns(false);
  setCustomAction('');
  setShowCustomInput(false);
  setGeneratedImage(null);
  setImagePromptUsed(null);
  
  actionMutation.mutate({ action });
};
```

### 5. Action Input Reset
**Trigger**: Action click handler called (immediate, before mutation is sent)

**UI Changes**:
- `setCustomAction('')` - clears custom action input
- `setShowCustomInput(false)` - switches back to suggestions view
- `setGeneratedImage(null)` - clears any manually generated image
- `setImagePromptUsed(null)` - clears image prompt text

**Note**: These resets happen immediately when the action is clicked, not after mutation success.

**Code Reference**:
```399:410:client/src/hooks/useGameLogic.ts
const handleActionClick = (action: string, isMobile: boolean) => {
  if (!gameId || actionMutation.isPending) return;
  
  // All immediate UI state changes
  setShowPreviousTurns(false);
  setCustomAction('');
  setShowCustomInput(false);
  setGeneratedImage(null);
  setImagePromptUsed(null);
  
  actionMutation.mutate({ action });
};
```

### 6. Turn Completion Updates
**Trigger**: WebSocket `turnComplete` event received

**UI Changes**:
- Game state query invalidated: `queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] })`
- Toast notification displayed:
  - Title: "Next Turn Ready"
  - Description: "Turn ${data.turnNumber} narrative is ready"

**Code Reference**:
```130:136:client/src/hooks/useGameLogic.ts
socket.on('turnComplete', (data: { gameId: string; turnNumber: number }) => {
  queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
  toast({
    title: "Next Turn Ready",
    description: `Turn ${data.turnNumber} narrative is ready`,
  });
});
```

### 7. New Turn Display
**Trigger**: Game state refetch after turn completion

**UI Changes**:
- Content loading states automatically cleared via `useEffect`:
  - `isProcessingAction` set to `false`
  - `currentActionText` set to `null`
- New `TurnCard` component rendered with:
  - Turn number badge: `TURN ${turnNumber}`
  - Mission viewscreen header (desktop only)
  - Narrative text with ReactMarkdown rendering
  - Check displays (if any skill checks occurred)
  - Delta displays (stat changes)
  - Image placeholder or actual image

**Code Reference**:
```70:76:client/src/pages/DesktopGamePage.tsx
// Clear content loading when turn completes
useEffect(() => {
  if (gameState?.turns.length && !isLoading) {
    setContentLoading('isProcessingAction', false);
    setContentLoading('currentActionText', null);
  }
}, [gameState?.turns.length, isLoading, setContentLoading]);
```

**TurnCard Rendering**:
```282:301:client/src/pages/DesktopGamePage.tsx
<TurnCard
  key={gameState.turns[gameState.turns.length - 1].turnNumber}
  {...gameState.turns[gameState.turns.length - 1]}
  imageUrl={generatedImage || gameState.turns[gameState.turns.length - 1].imageUrl}
  imageTemplate={
    generatedImage
      ? `Manual: ${imagePromptUsed || 'Unknown'}`
      : gameState.turns[gameState.turns.length - 1].imageTemplate
  }
  showMissionViewscreen={true}
  onVisualize={() => {
    setContentLoading('isGeneratingImage', true);
    generateImageMutation.mutate({
      templateName: 'general_scene',
      gameId: gameId!,
      turnNumber: gameState.turns[gameState.turns.length - 1]?.turnNumber
    });
  }}
  isGeneratingImage={generateImageMutation.isPending}
/>
```

### 8. Stat Bar Updates
**Trigger**: Game state update with new stat values

**UI Changes**:
- All `StatBar` components re-render with new values:
  - Hull, Oxygen, Fuel, Food, Morale stats
  - Visual bar width changes: `style={{ width: \`${percentage}%\` }}`
  - Color changes based on percentage:
    - Critical (< 15%): `text-red-500`, `bg-red-600`
    - Low (< 30%): `text-yellow-400`, `bg-yellow-500`
    - Normal: `text-[#c6f3ff]`, `bg-blue-600` (or specified color)
  - Value text updates: `{value}/{max}`

**Code Reference**:
```145:149:client/src/pages/DesktopGamePage.tsx
<StatBar label="Hull" value={gameState.stats.hull} max={100} icon="🚀" color="bg-blue-600" />
<StatBar label="Oxygen" value={gameState.stats.oxygen} max={100} icon="💨" color="bg-cyan-600" dailyConsumption={3} />
<StatBar label="Fuel" value={gameState.stats.fuel} max={100} icon="⛽" color="bg-amber-600" dailyConsumption={4} />
<StatBar label="Food" value={gameState.stats.food} max={100} icon="🍔" color="bg-green-600" dailyConsumption={3} />
<StatBar label="Morale" value={gameState.stats.morale} max={100} icon="❤️" color="bg-pink-600" dailyConsumption={2} />
```

### 9. Weirdness Meter Updates
**Trigger**: Game state update with new weirdness value

**UI Changes**:
- Weirdness dots update:
  - Filled dots: `bg-purple-600 animate-pulse` for values > 0
  - Empty dots: `bg-[#072a2a]` for values = 0
  - Value text updates: `{value}/{max}`
- Warning message appears if `value >= max`:
  - Text: "⚠️ Reality Auditors incoming!"
  - Styling: `text-xs font-mono text-purple-400 animate-pulse`

**Code Reference**:
```17:28:client/src/components/WeirdnessMeter.tsx
<div className="flex gap-2">
  {Array.from({ length: max }).map((_, i) => (
    <div
      key={i}
      className={`flex-1 h-3 rounded-full transition-all duration-300 ${
        i < value
          ? 'bg-purple-600 animate-pulse'
          : 'bg-[#072a2a]'
      }`}
      data-testid={`weirdness-dot-${i}`}
    />
  ))}
</div>
```

### 10. NPC Status Updates
**Trigger**: Game state update with new NPC data

**UI Changes**:
- `NPCCard` components re-render with:
  - Updated affinity values and visual bars
  - Status changes (Rivalry/Crush/Indifferent)
  - Last interaction text updates
  - Color changes based on affinity:
    - Positive (≥2): `text-[#00ffaa]`
    - Negative (≤-2): `text-[#ff6666]`
    - Neutral: `text-[#00aaaa]`

**Code Reference**:
```159:169:client/src/pages/DesktopGamePage.tsx
{gameState.npcs.map(npc => (
  <NPCCard
    key={npc.id}
    name={npc.name}
    role={npc.role}
    affinity={npc.affinity}
    status={npc.status}
    lastInteraction={npc.lastInteraction}
  />
))}
```

### 11. Item Equipment Updates
**Trigger**: Item toggle actions or game state changes

**UI Changes**:
- `ItemCard` components update:
  - Equipped state changes: `equipped` prop
  - Visual styling changes:
    - Equipped: `border-[#ffaa00] bg-[#1a1000] shadow-[0_0_10px_#ffaa00]`
    - Unequipped: `border-[#00aaaa] bg-[#0a0a0a] hover:bg-[#001a1a]`
  - "[EQUIPPED]" badge appears/disappears
  - Item count updates: `({gameState.equippedItems.length}/3)`

**Code Reference**:
```178:189:client/src/pages/DesktopGamePage.tsx
{items.map((item: Item) => (
  <ItemCard
    key={item.id}
    name={item.name}
    description={item.description}
    icon={item.icon}
    equipped={gameState.equippedItems.includes(item.id)}
    onToggle={() => toggleItem(item.id)}
  />
))}
```

### 12. Image Generation Updates
**Trigger**: Image generation completion via WebSocket

**UI Changes**:
- `imageReady` event triggers:
  - Game state invalidated to refetch with new image
  - Toast notification: "Scene Visualized" / "Turn ${turnNumber} image is ready"
- `imageFailed` event triggers:
  - Error toast with retry option
- Manual image generation:
  - Button state changes to "GENERATING..." with spinner
  - `generateImageMutation.isPending` controls button state

**Code Reference**:
```354:371:client/src/hooks/useGameLogic.ts
socket.on('imageReady', (data: {
  jobId: string;
  gameId: string;
  turnNumber: number;
  imageUrl: string;
  imageTemplate: string;
  promptSource: 'pce' | 'template';
}) => {
  console.log('Image ready:', data);
  
  // Invalidate game state to refetch with new image
  queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
  
  // Show success toast
  toast({
    title: "Scene Visualized",
    description: `Turn ${data.turnNumber} image is ready`,
  });
});
```

### 13. Game Completion State
**Trigger**: `gameState.isComplete` becomes `true`

**UI Changes**:
- Actions panel disappears
- Game complete panel appears:
  - Title: "[ MISSION COMPLETE! ]" or "[ MISSION FAILED ]"
  - Description: Success message or `gameState.failureReason`
  - "RETURN TO MENU" button
  - Styling: `border-2 border-[#ff66ff] bg-[#1a0a1a] shadow-[0_0_20px_#ff66ff]`

**Code Reference**:
```340:357:client/src/pages/DesktopGamePage.tsx
{gameState.isComplete && (
  <div className="p-6 border-2 border-[#ff66ff] bg-[#1a0a1a] shadow-[0_0_20px_#ff66ff] text-center" data-testid="game-complete">
    <h2 className="text-2xl font-bold text-[#ff66ff] mb-2">
      {gameState.failureReason ? '[ MISSION FAILED ]' : '[ MISSION COMPLETE! ]'}
    </h2>
    <p className="text-[#00aaaa] mb-4">
      {gameState.failureReason || 'You successfully reached Uranus!'}
    </p>
    <Button
      variant="outline"
      onClick={handleBackToMenu}
      className="border-2 border-[#00ffff] text-[#00ffff]"
      data-testid="button-new-voyage"
    >
      RETURN TO MENU
    </Button>
  </div>
)}
```

## Mobile-Specific Changes

### Compact Stats Display
**Mobile Only**: Stats shown in compact grid format instead of full bars
- 5-column grid: Hull, O2, Fuel, Food, Morale
- `CompactStat` components with icons and mini progress bars
- Weirdness meter below stats

**Code Reference**:
```134:144:client/src/pages/MobileGamePage.tsx
<div className="grid grid-cols-5 gap-2 mb-3">
  <CompactStat icon={Rocket} value={gameState.stats.hull} max={100} label="Hull" />
  <CompactStat icon={Wind} value={gameState.stats.oxygen} max={100} label="O2" />
  <CompactStat icon={Fuel} value={gameState.stats.fuel} max={100} label="Fuel" />
  <CompactStat icon={UtensilsCrossed} value={gameState.stats.food} max={100} label="Food" />
  <CompactStat icon={Heart} value={gameState.stats.morale} max={100} label="Morale" />
</div>
```

### Mobile Action Handling
- Actions call `handleActionClick(action, true)` with `isMobile: true`
- Custom actions call `handleCustomAction(true)` with `isMobile: true`
- Scroll behavior uses `window.scrollTo({ top: 0, behavior: 'smooth' })`

## Error Handling

### Action Processing Errors
**Trigger**: `actionMutation.onError`

**UI Changes**:
- Toast notification displayed:
  - Title: "Error"
  - Description: "Failed to process action"
  - Variant: "destructive"

### Image Generation Errors
**Trigger**: `imageFailed` WebSocket event or `generateImageMutation.onError`

**UI Changes**:
- Toast notification displayed:
  - Title: "Image Generation Failed"
  - Description: Error message or "Unable to generate image. Please try again."
  - Variant: "destructive"

## Synchronous vs Asynchronous Operations

### Synchronous Operations (Immediate UI Response)
These operations happen instantly when the user clicks an action and provide immediate visual feedback:

#### 1. Action Click Visual Feedback
- **Timing**: Immediate (0ms)
- **Operations**:
  - ActionChip `isPressed` state set to `true`
  - CSS class changes to `scale-95` (button shrinks)
  - Console log: `Action triggered: ${action}`
  - After 200ms: `isPressed` resets to `false` and `scale-100`

#### 2. Action Processing State Setup
- **Timing**: Immediate (0ms)
- **Operations**:
  - `currentActionText` state updated with action text
  - `setShowPreviousTurns(false)` - Previous transmissions hide
  - Automatic scroll to top (mobile: `window.scrollTo`, desktop: `scrollRef.current.scrollTop = 0`)

#### 3. Loading State Display
- **Timing**: Immediate (0ms)
- **Operations**:
  - `currentActionText` is set (controls loading indicator visibility)
  - Loading indicator appears in narrative feed
  - "PROCESSING ACTION..." text displays
  - Current action text shows: `"${currentActionText}"`

#### 4. Action Input Reset (immediate on action click)
- **Timing**: Immediate (0ms) - happens before mutation is sent
- **Operations**:
  - `setCustomAction('')` - clears custom action input
  - `setShowCustomInput(false)` - switches back to suggestions view
  - `setGeneratedImage(null)` - clears any manually generated image
  - `setImagePromptUsed(null)` - clears image prompt text
  - `setShowPreviousTurns(false)` - hides previous turns
  - **Note**: These happen in `handleActionClick`/`handleCustomAction` before `actionMutation.mutate()` is called
  - **Note**: `currentActionText` is NOT cleared here - it persists until narrative is ready

### Asynchronous Operations (WebSocket/Server-Triggered)
These operations happen after server processing and are triggered by WebSocket events:

#### 1. Narrative Ready (Turn Complete)
- **Trigger**: WebSocket `turnComplete` event
- **Timing**: Variable (depends on AI narrative generation time)
- **Operations**:
  - Game state query invalidated: `queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] })`
  - Toast notification: "Next Turn Ready" / "Turn ${turnNumber} narrative is ready"
  - Game state refetch triggered
  - `useEffect` detects new turn → clears `isProcessingAction` and `currentActionText`
  - **Note**: Previous transmissions remain hidden (user must manually show)

#### 2. New Turn Display
- **Trigger**: Game state refetch after `turnComplete`
- **Timing**: Immediate after query invalidation
- **Operations**:
  - Loading indicator disappears (because `currentActionText` is cleared)
  - New `TurnCard` component rendered with turn data
  - Narrative text with ReactMarkdown rendering
  - Check displays (if any skill checks occurred)
  - Delta displays (stat changes)
  - Image placeholder shows (while image generates separately)

#### 3. Stat Bar Updates
- **Trigger**: Game state update with new stat values
- **Timing**: Immediate after turn display
- **Operations**:
  - All `StatBar` components re-render with new values
  - Visual bar width changes based on new percentages
  - Color changes based on critical/low/normal thresholds
  - Value text updates: `{value}/{max}`

#### 4. Weirdness Meter Updates
- **Trigger**: Game state update with new weirdness value
- **Timing**: Immediate after stat updates
- **Operations**:
  - Weirdness dots update (filled/empty based on value)
  - Warning message appears if `value >= max`
  - Value text updates: `{value}/{max}`

#### 5. NPC Status Updates
- **Trigger**: Game state update with new NPC data
- **Timing**: Immediate after stat updates
- **Operations**:
  - `NPCCard` components re-render with updated affinity values
  - Status changes (Rivalry/Crush/Indifferent)
  - Last interaction text updates
  - Color changes based on affinity levels

#### 6. Item Equipment Updates
- **Trigger**: Game state update with new item data
- **Timing**: Immediate after NPC updates
- **Operations**:
  - `ItemCard` components update equipped state
  - Visual styling changes (equipped/unequipped)
  - "[EQUIPPED]" badge appears/disappears
  - Item count updates: `({gameState.equippedItems.length}/3)`

#### 7. Image Generation (Asynchronous Process)
- **Trigger**: WebSocket `imageReady` or `imageFailed` events
- **Timing**: Variable (image job created after turn completes, processed asynchronously via queue)
- **Note**: Image jobs are created sequentially after turn processing completes (see `server/turnJobProcessor.ts`), then processed asynchronously by the image job processor queue.
- **Operations**:
  - `imageReady` event:
    - Game state invalidated to refetch with new image
    - Toast notification: "Scene Visualized" / "Turn ${turnNumber} image is ready"
    - Image appears in existing TurnCard (replaces placeholder)
  - `imageFailed` event:
    - Error toast with retry option
    - Image placeholder remains visible

#### 8. Image Generation (Manual)
- **Trigger**: User clicks "VISUALIZE" or "REGENERATE VISUAL" button
- **Timing**: Variable (depends on image generation service)
- **Operations**:
  - `setLoading('isGeneratingImage', true)` - Sets loading state
  - Button state changes to "GENERATING..." with spinner
  - `generateImageMutation.isPending` controls button state
  - `generateImageMutation.mutate()` - Sends API request
  - On mutation completion (success or error):
    - `useEffect` automatically clears `isGeneratingImage` loading state
    - Success: Image updates in TurnCard, toast notification
    - Error: Toast notification with retry option

**Code Reference**:
```78:86:client/src/pages/DesktopGamePage.tsx
// Clear image generation loading when mutation completes
useEffect(() => {
  if (!generateImageMutation.isPending && generateImageMutation.isSuccess) {
    setContentLoading('isGeneratingImage', false);
  }
  if (!generateImageMutation.isPending && generateImageMutation.isError) {
    setContentLoading('isGeneratingImage', false);
  }
}, [generateImageMutation.isPending, generateImageMutation.isSuccess, generateImageMutation.isError, setContentLoading]);
```

### Timing Summary

| Operation | Type | Timing | Trigger |
|-----------|------|--------|---------|
| Action click feedback | Sync | 0ms | User click |
| Previous turns hide | Sync | 0ms | Action click handler |
| Loading indicator | Sync | 0ms | Action click handler sets state |
| Input reset | Sync | 0ms | Action click handler |
| Turn completion | Async | Variable | WebSocket `turnComplete` |
| New turn display | Async | Immediate | Query refetch |
| Stat updates | Async | Immediate | Game state update |
| Image job creation | Async | Immediate | After turn completes (turnJobProcessor) |
| Image generation | Async | Variable | WebSocket events (imageJobProcessor queue) |
| Manual image gen | Async | Variable | User button click |

### Error Handling Timing

#### Synchronous Errors
- **Action processing errors**: Immediate toast on `actionMutation.onError`
- **Manual image errors**: Immediate toast on `generateImageMutation.onError`

#### Asynchronous Errors
- **Image generation failures**: WebSocket `imageFailed` event triggers error toast
- **Turn processing failures**: Server error responses trigger error toasts

## State Management Summary

### Key State Variables
- `currentActionText`: Stores the action being processed (from `useGameContentLoading`)
- `isProcessingAction`: Boolean indicating action is being processed (from `useGameContentLoading`)
- `isGeneratingImage`: Boolean indicating image is being generated (from `useGameContentLoading`)
- `showPreviousTurns`: Controls visibility of previous turns section
- `generatedImage`: Stores manually generated image URL
- `imagePromptUsed`: Stores the prompt used for manual image generation
- `actionMutation.isPending`: Controls mutation loading states
- `generateImageMutation.isPending`: Controls image generation button state

### Query Invalidation Points
1. Turn completion WebSocket event (narrative ready)
2. Image ready WebSocket event (image generated)
3. Settings save action
4. Manual image generation success

### WebSocket Events
1. `turnComplete`: Narrative is ready - triggers game state refetch, shows "Next Turn Ready" toast, clears loading indicator
2. `imageReady`: Image is generated - triggers game state refetch with image data, shows "Scene Visualized" toast
   - Payload includes: `jobId`, `gameId`, `turnNumber`, `imageUrl`, `imageTemplate`, `promptSource` ('pce' | 'template')
3. `imageFailed`: Image generation failed - shows error toast with retry option

### Turn Processing Lifecycle

#### Phase 1: Action Submission
- User clicks action button
- Immediate UI feedback (loading indicator, disabled buttons)
- HTTP request sent to server
- Server responds with `{ status: 'processing' }`

#### Phase 2: Narrative Generation (Server-side)
- AI processes the action
- Generates narrative text
- Calculates stat changes, NPC updates, item effects
- Creates turn record with narrative and checks
- **Turn is "complete" - narrative is ready**

#### Phase 3: Narrative Ready (`turnComplete` WebSocket)
- Loading indicator disappears
- TurnCard appears with narrative and checks
- Image placeholder shows (while image generates)
- User can take new actions
- Toast: "Next Turn Ready - Turn X narrative is ready"

#### Phase 4: Image Generation (Asynchronous Process)
- Image job queued separately (after turn completes)
- AI generates scene visualization asynchronously
- Image appears when ready

#### Phase 5: Image Ready (`imageReady` WebSocket)
- Image appears in TurnCard
- Toast: "Scene Visualized - Turn X image is ready"

This documentation covers all the UI changes and automations that occur when a user interacts with actions on the game page, providing a complete reference for understanding the user experience flow.
