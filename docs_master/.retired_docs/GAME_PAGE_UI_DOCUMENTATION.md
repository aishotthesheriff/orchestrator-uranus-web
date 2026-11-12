# Game Page UI - Comprehensive Documentation

## Overview

The Game Page (`/game/:gameId`) is the primary gameplay interface for Quest to Uranus. It provides a responsive, real-time interface for players to interact with the game, view narrative content, manage resources, and make decisions.

**Entry Point**: `client/src/pages/GamePage.tsx`  
**Route**: `/game/:gameId` (defined in `client/src/App.tsx`)

## Architecture

### Component Hierarchy

```
GamePage (Router)
├── MobileGamePage (Mobile layout)
├── DesktopGamePage (Full desktop layout)
└── CompactDesktopGamePage (Compact desktop layout, delegates to MobileGamePage)
```

### Device Detection & Routing

The `GamePage` component uses `useIsMobile()` to detect device type and renders the appropriate layout:

- **Mobile**: Renders `MobileGamePage`
- **Desktop (default)**: Renders `CompactDesktopGamePage` (mobile layout on desktop)
- **Desktop (`?view=full`)**: Renders `DesktopGamePage` (full sidebar layout)

**Key Behavior**:
- Shows `GameDataLoading` while device detection is in progress (`isMobile === undefined`)
- Reads `view` query parameter to determine desktop layout variant

---

## Core Hooks & Data Flow

### `useGameLogic()` Hook

**Location**: `client/src/hooks/useGameLogic.ts`

This is the primary hook that manages all game state, mutations, and WebSocket connections.

#### State Management

**Local State**:
- `showSettings` (boolean): Controls UserSettingsDialog visibility
- `showHelp` (boolean): Controls HelpDialog visibility
- `customAction` (string): User-entered custom action text
- `showCustomInput` (boolean): Toggles between suggested actions and custom input
- `generatedImage` (string | null): URL of manually generated image (overrides turn image)
- `imagePromptUsed` (string | null): Prompt used for manual image generation
- `showPreviousTurns` (boolean): Controls visibility of previous turns section
- `scrollRef` (RefObject): Reference to narrative feed scroll container
- `absurdity` (number): Game absurdity level (synced from gameState)

**React Query State**:
- `gameState` (GameState): Complete game state from `/api/game/:gameId`
  - Updated via WebSocket events (`turnComplete`, `imageReady`)
  - Optimistically updated during equipment changes
- `items` (Item[]): Available items from `/api/reference/items`
- `themesData` (ModStoryTheme[]): Story themes from `/api/reference/story-themes`
- `stylesData` (ModVisualStyle[]): Visual styles from `/api/reference/visual-styles`
- `systemDefaultsData`: System defaults from `/api/reference/system-defaults`
- `userPreferences`: User settings from `/api/user/preferences`

**Derived State**:
- `isIntroReady` (boolean): Computed from gameState - checks if intro turn (turnNumber 0) has narrative and actions
- `theme` (string): User preference theme or system default
- `style` (string): User preference style or system default
- `imageModelKey` (string | null): User preference image model or null

#### Mutations

**1. `actionMutation`**
- **Endpoint**: `POST /api/game/action`
- **Purpose**: Submit player action (suggested or custom)
- **Payload**: `{ gameId, action, customText? }`
- **Response**: `{ turnJobId, status: 'processing' }` or full GameState (backward compat)
- **Effects**:
  - Shows toast: "Processing Turn" on success
  - On error: Shows error toast, preserves loading state
  - Does NOT immediately update gameState (waits for WebSocket `turnComplete` event)
- **Triggered by**: `handleActionClick()` or `handleCustomAction()`

**2. `generateImageMutation`**
- **Endpoint**: `POST /api/generate-image`
- **Purpose**: Manually generate image for current turn
- **Payload**: `{ gameId, turnNumber? }`
- **Response**: `{ imageUrl: string, promptUsed: string }`
- **Effects**:
  - Updates `generatedImage` and `imagePromptUsed` local state
  - Shows toast: "Image Generated" on success
  - On error: Shows error toast
- **Triggered by**: "VISUALIZE" button in TurnCard

**3. `updateEquipmentMutation`**
- **Endpoint**: `PATCH /api/games/:gameId/equipped-items`
- **Purpose**: Update equipped items (max 3)
- **Payload**: `{ equippedItems: string[] }`
- **Response**: Updated GameState
- **Effects**:
  - Optimistic update: Immediately updates React Query cache
  - On error: Rolls back to previous state
  - Shows toast on error
  - Invalidates query on settle
- **Triggered by**: `toggleItem()` when clicking ItemCard

**4. `updateGameSettingsMutation`**
- **Endpoint**: `PATCH /api/games/:gameId/settings`
- **Purpose**: Update game-specific settings (absurdity)
- **Payload**: `{ absurdity?: number }`
- **Response**: Updated GameState
- **Effects**:
  - Updates gameState in React Query cache
  - Updates local `absurdity` state
  - Shows toast on success/error
- **Triggered by**: UserSettingsDialog (indirectly)

**5. `updateUserPreferencesMutation`**
- **Endpoint**: `PATCH /api/user/preferences`
- **Purpose**: Update user preferences (theme, style, imageModelKey)
- **Payload**: `{ theme?, style?, imageModelKey? }`
- **Response**: Updated user preferences
- **Effects**:
  - Invalidates user preferences query
  - Handled by `useUpdateUserSettings()` hook
- **Triggered by**: UserSettingsDialog save action

#### WebSocket Events

**Connection**: Established on mount when `gameId` exists, cleaned up on unmount

**Events Listened**:
1. **`turnComplete`**
   - **Payload**: `{ gameId: string, turnNumber: number }`
   - **Effect**: 
     - Invalidates game state query (triggers refetch)
     - Shows toast: "Next Turn Ready"
   - **Triggered by**: Server when turn narrative is ready

2. **`imageReady`**
   - **Payload**: `{ jobId, gameId, turnNumber, imageUrl, imageTemplate }`
   - **Effect**:
     - Verifies `gameId` matches current game
     - Refetches game state query immediately
     - Invalidates query to mark as stale
     - Shows toast: "Scene Visualized"
   - **Triggered by**: Server when image generation completes

3. **`imageFailed`**
   - **Payload**: `{ jobId, gameId, turnNumber, error }`
   - **Effect**:
     - Verifies `gameId` matches current game
     - Shows error toast with error message
   - **Triggered by**: Server when image generation fails

#### Action Handlers

**`handleActionClick(action: string, isMobile: boolean)`**
- Resets UI state: `showPreviousTurns = false`, clears `customAction`, `showCustomInput = false`, clears `generatedImage`
- Calls `actionMutation.mutate({ action })`
- Used by ActionChip onClick

**`handleCustomAction(isMobile: boolean)`**
- Validates `customAction` is not empty
- Resets UI state (same as `handleActionClick`)
- Calls `actionMutation.mutate({ action: customAction, customText: customAction })`
- Used by custom action input submit button

**`handleBackToMenu()`**
- Navigates to `/menu`
- Used by "MENU" button in header

**`toggleItem(itemId: string)`**
- Validates max 3 items equipped
- Computes next equipped items array
- Calls `updateEquipmentMutation.mutateAsync(nextEquipped)`
- Shows toast if max items reached
- Used by ItemCard onClick

**`itemIcon(itemId: string)`**
- Looks up item icon from `items` array
- Returns icon string or empty string
- Used by ActionChip to display item icons

---

### `useGameContentLoading()` Hook

**Location**: `client/src/hooks/useGameContentLoading.ts`

Manages loading states for action processing and image generation.

**State**:
- `isProcessingAction` (boolean): True when action is being processed
- `isGeneratingImage` (boolean): True when image is being generated
- `currentActionText` (string | null): The action text currently being processed

**Methods**:
- `setLoading(key, value)`: Updates loading state for specific key

**Usage**:
- Set when action is clicked: `setLoading('currentActionText', action)`, `setLoading('isProcessingAction', true)`
- Set when image generation starts: `setLoading('isGeneratingImage', true)`
- Cleared via useEffect when mutations complete or turn data arrives

---

### `useAppLoading()` Hook

**Location**: `client/src/hooks/useAppLoading.ts`

Manages app-level loading state (used for full-page loading indicators).

**Usage**: Currently used in GamePage for device detection loading, but not actively used in game page variants.

---

## Page Variants

### MobileGamePage

**Location**: `client/src/pages/MobileGamePage.tsx`

**Layout**: Single column, vertically stacked sections

**Key Features**:
- Compact header with icon buttons
- Narrative feed (scrollable)
- Actions panel (below narrative)
- Compact stats summary (below actions)
- No sidebar panels

**Dynamic Elements**:

1. **Header** (`data-testid="game-title"`, `data-testid="game-meta"`)
   - Title: "QUEST 4 URANUS"
   - Meta: `DAY {gameState.day} • {gameState.segment.toUpperCase()}`
   - Buttons: View toggle (F), Help, Menu, Settings

2. **Narrative Feed** (`data-testid="narrative-feed"`)
   - Scrollable container with `scrollRef`
   - Shows `GameContentLoading` when `isProcessingAction && currentActionText`
   - Shows `GameContentLoading` if last turn has no narrative
   - Current Turn Section:
     - Header: "[ MISSION VIEWSCREEN ]"
     - TurnCard for latest turn
     - Image: `generatedImage || turn.imageUrl`
     - Image template: Shows manual prompt if `generatedImage` exists
     - "VISUALIZE" button: Triggers `generateImageMutation`
   - Previous Turns Section (if `gameState.turns.length > 1`):
     - Toggle button: Shows/hides previous turns
     - Displays turns in reverse order (newest first)
     - Each turn rendered as TurnCard

3. **Actions Panel** (`data-testid="actions-panel"`)
   - Only shown if `!gameState.isComplete`
   - Toggle button: Switches between suggested actions and custom input
   - Custom Input Mode:
     - Input field: `customAction` state, disabled when `actionMutation.isPending`
     - Submit button: Disabled if empty or pending
   - Suggested Actions Mode:
     - ActionChip components for each `gameState.currentActions`
     - Each chip shows: action text, summary, risk level, item icon (if uses item)

4. **Compact Stats Summary** (`data-testid="compact-stats-summary"`)
   - Grid of 5 CompactStat components: Hull, O2, Fuel, Food, Morale
   - WeirdnessMeter below stats

5. **Game Complete Panel** (`data-testid="game-complete"`)
   - Only shown if `gameState.isComplete`
   - Shows failure or success message
   - "RETURN TO MENU" button

**Scroll Behavior**:
- On action click: Scrolls to top using `window.scrollTo({ top: 0, behavior: 'smooth' })`
- Uses `scrollRef` for narrative feed container

---

### DesktopGamePage

**Location**: `client/src/pages/DesktopGamePage.tsx`

**Layout**: Two-column grid with sidebar (320px) and main content area

**Key Features**:
- Full sidebar with stats, crew, and items panels
- Larger narrative feed area
- Same action system as mobile
- "COMPACT" button to switch to compact view

**Dynamic Elements**:

1. **Header** (same structure as mobile, with additional "COMPACT" button)
   - "COMPACT" button: Removes `view` query param to switch to compact view

2. **Sidebar** (left column, `order-2 lg:order-1`):
   - **Stats Panel** (`data-testid="stats-panel"`):
     - StatBar components: Hull, Oxygen, Fuel, Food, Morale
     - WeirdnessMeter
     - All stats from `gameState.stats`
   - **Crew Panel** (`data-testid="crew-panel"`):
     - NPCCard for each `gameState.npcs`
     - Shows: name, role, affinity, status, lastInteraction
   - **Items Panel** (`data-testid="items-panel"`):
     - Header: `[ ITEMS ({gameState.equippedItems.length}/3) ]`
     - ItemCard for each item in `items` array
     - Shows equipped state: `gameState.equippedItems.includes(item.id)`
     - Toggle handler: `toggleItem(item.id)`

3. **Main Content** (right column, `order-1 lg:order-2`):
   - **Narrative Feed** (`data-testid="narrative-feed"`):
     - Same structure as mobile
     - Uses `scrollRef` for scrollable container
     - Scroll behavior: On action click, sets `scrollRef.current.scrollTop = 0`
   - **Actions Panel**: Same as mobile
   - **Game Complete Panel**: Same as mobile

---

### CompactDesktopGamePage

**Location**: `client/src/pages/CompactDesktopGamePage.tsx`

**Implementation**: Simply delegates to `MobileGamePage` component

**Purpose**: Provides mobile layout on desktop for users who prefer compact view

---

## Component Details

### TurnCard

**Location**: `client/src/components/TurnCard.tsx`

**Props**:
- `turnNumber`: Turn number badge
- `narrative`: Markdown narrative text
- `checks`: Array of skill checks
- `delta`: Array of stat changes
- `imageUrl`: Image URL (from turn or `generatedImage`)
- `imageTemplate`: Image template/prompt
- `imageStatus`: 'pending' | 'completed' | 'failed'
- `showMissionViewscreen`: Boolean to show special header
- `onVisualize`: Callback for "VISUALIZE" button
- `isGeneratingImage`: Boolean to show loading state on button

**Dynamic Behavior**:
- Shows skeleton loader when `imageStatus === 'pending' && !imageUrl`
- Shows image when `imageUrl` exists
- Shows image prompt section when `imagePrompt` exists
- "VISUALIZE" button:
  - Disabled when `isGeneratingImage === true`
  - Shows "GENERATING..." with spinner when generating
  - Shows "VISUALIZE" with icon when idle

**Renders**:
- CheckDisplay components for each check
- DeltaDisplay component for stat changes
- ReactMarkdown for narrative (with prose styling)

---

### ActionChip

**Location**: `client/src/components/ActionChip.tsx`

**Props**:
- `action`: Action text
- `summary`: Action description
- `risk`: 'Safe' | 'Risky' | 'Wild'
- `itemIcon`: Optional icon string
- `onClick`: Click handler

**Dynamic Behavior**:
- Color coding based on risk:
  - Safe: Green (`#00ffaa`)
  - Risky: Orange (`#ffaa00`)
  - Wild: Pink (`#ff66ff`)
- Press animation: `isPressed` state with scale transform
- Shows item icon if provided

---

### StatBar

**Location**: `client/src/components/StatBar.tsx`

**Props**:
- `label`: Stat name
- `value`: Current value
- `max`: Maximum value
- `icon`: Emoji icon
- `color`: Tailwind color class (default: `bg-primary`)
- `dailyConsumption`: Optional daily consumption value

**Dynamic Behavior**:
- Calculates percentage: `(value / max) * 100`
- Color coding:
  - Critical (< 15%): Red
  - Low (< 30%): Yellow
  - Normal: Default color
- Shows daily consumption if provided: `-{dailyConsumption}/day`
- Animated progress bar with width transition

---

### ItemCard

**Location**: `client/src/components/ItemCard.tsx`

**Props**:
- `name`: Item name
- `description`: Item description
- `icon`: Emoji icon
- `equipped`: Boolean indicating if item is equipped
- `onToggle`: Click handler

**Dynamic Behavior**:
- Visual state:
  - Equipped: Orange border (`#ffaa00`), shadow, "[EQUIPPED]" badge
  - Unequipped: Cyan border (`#00aaaa`), hover effect
- Click handler: Calls `onToggle()` (typically `toggleItem()`)

---

### NPCCard

**Location**: `client/src/components/NPCCard.tsx`

**Props**:
- `name`: NPC name
- `role`: NPC role
- `affinity`: Number (-3 to +3)
- `status`: NPCStatus enum
- `lastInteraction`: Optional last interaction quote

**Dynamic Behavior**:
- Status color coding:
  - Indifferent: Cyan
  - Warm: Light green
  - Friendly: Bright green
  - Cold: Blue
  - Hostile: Red
  - Rivalry: Red
  - Crush: Pink
- Affinity display:
  - Color: Green if >= 2, Red if <= -2, Cyan otherwise
  - Visual bar: 7 segments, filled based on affinity value
- Shows last interaction quote if provided

---

### WeirdnessMeter

**Location**: `client/src/components/WeirdnessMeter.tsx`

**Props**:
- `value`: Current weirdness (0-5)
- `max`: Maximum weirdness (default: 5)

**Dynamic Behavior**:
- Shows dots for each weirdness level
- Filled dots pulse with animation
- Warning message when `value >= max`: "⚠️ Reality Auditors incoming!"

---

### CompactStat

**Location**: `client/src/components/CompactStat.tsx`

**Props**:
- `icon`: Lucide icon component
- `value`: Current value
- `max`: Maximum value
- `label`: Stat label

**Dynamic Behavior**:
- Compact vertical layout
- Icon color coding (same as StatBar: red/yellow/cyan)
- Small progress bar
- Shows value number

---

### GameContentLoading

**Location**: `client/src/components/loading/GameContentLoading.tsx`

**Props**:
- `actionText`: Optional action text to display
- `type`: 'action' | 'image' (default: 'action')

**Dynamic Behavior**:
- Shows spinner and message
- Displays action text in quotes if provided
- Different messages for action vs image generation

---

## Dialog Components

### UserSettingsDialog

**Location**: `client/src/components/UserSettingsDialog.tsx`

**Props**:
- `open`: Boolean to control visibility
- `onOpenChange`: Callback to update open state
- `idPrefix`: Prefix for form element IDs

**Dynamic Behavior**:
- Fetches user settings via `useUserSettings()`
- Fetches themes, styles, image models from reference API
- Fetches system defaults
- Initializes form with user preferences or system defaults
- Dropdowns:
  - Narrative Theme: Options from `themesData`
  - Visual Style: Options from `stylesData`
  - Image Model: Options from `imageModelsData`
- Save button:
  - Disabled when `updateUserPreferencesMutation.isPending` or catalog not loaded
  - On success: Navigates to current game or menu
- Shows loading states while fetching catalog data

**Effects**:
- Updates user preferences in database
- Invalidates user preferences query
- Affects `theme`, `style`, `imageModelKey` in `useGameLogic()`

---

### HelpDialog

**Location**: `client/src/components/GameDialogs.tsx`

**Props**:
- `open`: Boolean to control visibility
- `onOpenChange`: Callback to update open state

**Dynamic Behavior**:
- Renders `HelpContent` component in scrollable area
- Multiple close buttons (header, footer, icon)
- Styled with game theme (cyan borders, glow effects)

---

## Loading States

### GameDataLoading

**Shown when**:
- Device detection in progress (`isMobile === undefined`)
- `!gameId || isLoading || !gameState || !isIntroReady`

**Purpose**: Full-page loading indicator while game data loads

---

### GameContentLoading

**Shown when**:
- `isProcessingAction && currentActionText` (action being processed)
- Last turn has no narrative (intro not ready)

**Purpose**: Inline loading indicator in narrative feed

---

## State Synchronization Flow

### Action Submission Flow

1. User clicks ActionChip or submits custom action
2. `handleActionClick()` or `handleCustomAction()` called
3. Local state reset: `showPreviousTurns = false`, clear custom inputs, clear generated image
4. `setContentLoading('isProcessingAction', true)` and `setContentLoading('currentActionText', action)`
5. Scroll to top (immediate)
6. `actionMutation.mutate()` called
7. Toast shown: "Processing Turn"
8. Server processes action, enqueues turn job
9. WebSocket `turnComplete` event received
10. `queryClient.invalidateQueries(['api', 'game', gameId])` triggers refetch
11. `gameState` updates with new turn
12. `useEffect` clears loading state when `gameState.turns.length` changes
13. UI updates with new narrative and actions

### Image Generation Flow

1. User clicks "VISUALIZE" button in TurnCard
2. `setContentLoading('isGeneratingImage', true)`
3. `generateImageMutation.mutate({ gameId, turnNumber })` called
4. Button shows loading state (`isGeneratingImage = true`)
5. Server processes image generation
6. On success: `generatedImage` and `imagePromptUsed` state updated, toast shown
7. On WebSocket `imageReady`: Query refetched, `generatedImage` may be overridden by turn image
8. `useEffect` clears loading state when mutation completes
9. TurnCard displays image from `generatedImage || turn.imageUrl`

### Equipment Update Flow

1. User clicks ItemCard
2. `toggleItem(itemId)` called
3. Validates max 3 items
4. Computes next equipped items array
5. Optimistic update: `queryClient.setQueryData()` updates cache immediately
6. `updateEquipmentMutation.mutateAsync()` called
7. On success: Query invalidated, cache updated with server response
8. On error: Cache rolled back to previous state, toast shown
9. UI updates immediately (optimistic) then confirms with server response

---

## Responsive Behavior

### Mobile (< 1024px)
- Single column layout
- Compact header with icon buttons
- Narrative feed, actions, stats stacked vertically
- Window scroll for narrative feed
- Compact stats summary instead of full sidebar

### Desktop (≥ 1024px, default)
- Uses MobileGamePage layout (compact view)
- Can switch to full view with `?view=full`

### Desktop (≥ 1024px, `?view=full`)
- Two-column grid layout
- Full sidebar with stats, crew, items
- Larger narrative feed area
- Container scroll for narrative feed

---

## Data Dependencies

### Required Data
- `gameState`: Game state query must be loaded
- `isIntroReady`: Must be true to render game (intro turn must have narrative and actions)
- `items`: Items array for equipment panel and action icons

### Optional Data
- `userPreferences`: Falls back to system defaults if not loaded
- `themesData`, `stylesData`: Used in settings dialog, not required for gameplay
- `imageModelsData`: Used in settings dialog, not required for gameplay

### Real-time Updates
- Game state: Updated via WebSocket `turnComplete` events
- Images: Updated via WebSocket `imageReady` events
- Equipment: Optimistically updated, confirmed via mutation response

---

## Error Handling

### Action Submission Errors
- Toast shown: "Failed to process action"
- Loading state preserved (user can see what action failed)
- Action can be retried

### Image Generation Errors
- Toast shown: "Image Generation Failed"
- Loading state cleared
- User can retry via "VISUALIZE" button

### Equipment Update Errors
- Toast shown: "Failed to update equipment"
- Optimistic update rolled back
- UI reverts to previous state

### WebSocket Errors
- `imageFailed` event shows error toast
- Connection errors handled by socket library (reconnection logic)

---

## Performance Considerations

### Query Caching
- Game state cached by React Query
- Reference data (items, themes, styles) cached with `REFERENCE_DATA_QUERY_OPTIONS`
- User preferences cached

### Optimistic Updates
- Equipment changes update immediately
- Rollback on error maintains consistency

### WebSocket Efficiency
- Only joins game room when `gameId` exists
- Cleans up listeners on unmount
- Verifies `gameId` match before processing events

### Scroll Management
- Desktop: Uses ref-based scroll (`scrollRef.current.scrollTop`)
- Mobile: Uses `window.scrollTo()` for smooth scrolling
- Scrolls to top on action to show new content

---

## Testing Considerations

### Test IDs
All major UI elements have `data-testid` attributes:
- `game-title`, `game-meta`: Header elements
- `stats-panel`, `crew-panel`, `items-panel`: Sidebar sections
- `narrative-feed`: Main content area
- `actions-panel`: Action selection area
- `turn-{number}`, `turn-badge-{number}`: Turn cards
- `action-{action-name}`: Action chips
- `item-{item-name}`: Item cards
- `npc-{npc-name}`: NPC cards
- `button-*`: Various buttons
- `input-custom-action`: Custom action input

### State Testing
- Test loading states: `isLoading`, `isProcessingAction`, `isGeneratingImage`
- Test mutation states: `actionMutation.isPending`, `generateImageMutation.isPending`
- Test WebSocket event handling: Mock socket events

### Responsive Testing
- Test mobile layout (< 1024px)
- Test desktop compact layout (≥ 1024px, no query param)
- Test desktop full layout (≥ 1024px, `?view=full`)

---

## Future Enhancements

### Potential Improvements
1. Virtual scrolling for long turn histories
2. Image lazy loading for previous turns
3. Action history/undo functionality
4. Real-time multiplayer indicators
5. Accessibility improvements (keyboard navigation, screen reader support)
6. Progressive image loading with blur-up placeholders

---

## Related Documentation

- **System Overview**: `docs_master/current/SYSTEM_OVERVIEW.md`
- **Agents**: `docs_master/current/AGENTS.md`
- **API Guide**: `docs_master/current/API_GUIDE.md`
- **Client Functional Docs**: `docs_master/current/CLIENT_FUNCTIONAL_DOCUMENTATION_V3.md`

