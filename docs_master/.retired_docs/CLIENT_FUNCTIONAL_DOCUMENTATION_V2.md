# Quest to Uranus: Client Module Functional Documentation V2

## Overview

The client folder contains the frontend React application for the Quest to Uranus text-based adventure game. Built with React 18, TypeScript, Vite, and Tailwind CSS, it provides a retro-futuristic CRT-style interface for players to navigate their cosmic journey to Uranus.

## Core Architecture

### Main Entry Points
- **`index.html`** - HTML template with font preloading and root container
- **`main.tsx`** - React application bootstrap and root rendering
- **`App.tsx`** - Main application component with routing and provider setup

### Application Structure
- **Router System** - Uses Wouter for lightweight client-side routing
- **State Management** - React Query for server state, React hooks for local state
- **Styling System** - Tailwind CSS with custom CRT-themed design tokens
- **UI Components** - Comprehensive shadcn/ui component library

## Module Breakdown

### 1. Application Core (`src/`)

#### **App.tsx** - Main Application Component
**Purpose**: Central application orchestrator with routing and provider setup

**Key Features**:
- React Query client configuration with custom error handling
- Wouter-based routing system with 8 main routes and catch-all NotFound route
- Global providers (QueryClient, TooltipProvider, Toaster)
- Route definitions for all application pages

**Routes**:
- `/` - LoadingPage (initial boot sequence with video preloading)
- `/welcome` - WelcomePage (username entry and preferences)
- `/menu` - MainMenuPage (game selection/creation)
- `/help` - HelpPage (game instructions)
- `/interview/:gameId` - InterviewPage (pre-flight questionnaire)
- `/game/:gameId` - GamePage (main gameplay interface)
- `/dev-tools` - DevToolsPage (developer tools)
- `/dev-tools/cache` - CacheManagementPage (generated image cache management)
- Catch-all route - NotFound component for 404 handling

#### **lib/queryClient.ts** - API Client Configuration
**Purpose**: Centralized API communication and React Query setup

**Key Features**:
- Custom `apiRequest` function with comprehensive error handling
- Query function factory with 401 handling options (`returnNull` or `throw`)
- React Query client with optimized defaults (no refetch, infinite stale time, no retries)
- Credential-based authentication support (cookies)
- **CSRF Token Management**: Automatic CSRF token fetching for state-changing requests (POST, PUT, DELETE, PATCH)
  - Token caching and promise-based deduplication
  - Automatic token refresh on 403 errors
  - Graceful handling when CSRF endpoint unavailable (404)
- **Admin Token Management**: Bearer token authentication system for admin operations
  - `getAdminAuthToken()` - Retrieve admin token from localStorage
  - `setAdminAuthToken(token)` - Set admin token with event broadcasting
  - `clearAdminAuthToken()` - Clear admin token and notify subscribers
  - `subscribeToAdminAuthTokenChanges(callback)` - Subscribe to token changes via events and storage events
  - Automatic token clearing on 401 responses
  - Event-based synchronization across tabs

**Authentication Flow**:
1. Admin token stored in localStorage with key `uranus-admin-token`
2. Token automatically included in `Authorization: Bearer {token}` header
3. Token changes broadcast via custom events and storage events
4. 401 responses automatically clear admin token
5. CSRF tokens fetched from `/api/csrf-token` for state-changing requests
6. CSRF tokens included in `X-CSRF-Token` header for POST/PUT/DELETE/PATCH requests

#### **lib/socket.ts** - WebSocket Connection Management
**Purpose**: Singleton Socket.IO connection management

**Key Features**:
- Singleton socket pattern (single shared socket instance)
- Auto-connect disabled (must call `connectSocket()` explicitly)
- Development/production URL handling
- LLM log event listener for console debugging
- Connection lifecycle management

**Functions**:
- `getSocket()` - Returns singleton socket instance (creates if needed)
- `connectSocket()` - Connects socket if not already connected, returns socket
- `disconnectSocket()` - Disconnects socket if connected

**Socket Events**:
- `llmLog` - Automatic console logging of LLM calls when socket is created
  - Logs function name, prompt, response, metadata, execution time, game/turn context
  - Formatted console group output for debugging

#### **lib/utils.ts** - Utility Functions
**Purpose**: Common utility functions for the application

**Key Features**:
- `cn()` function for conditional CSS class merging using clsx and tailwind-merge

### 2. Page Components (`src/pages/`)

#### **GamePage.tsx** - Game Interface Router
**Purpose**: Screen size detection and component routing for game interface

**Key Features**:
- Uses `useIsMobile()` hook for platform detection
- Conditionally renders mobile or desktop components
- Handles loading state during screen size detection with `GameDataLoading`
- Maintains single entry point for game route

#### **MobileGamePage.tsx** - Mobile Gameplay Interface
**Purpose**: Mobile-optimized game interface with touch-friendly design

**Key Features**:
- Compact stats panel using `CompactStat` components
- Simplified header with icon-only buttons
- Full-width narrative feed without height restrictions
- Mobile-optimized settings dialog
- Touch-friendly action selection
- Window-scroll-based navigation (uses `window.scrollTo` for action scrolling)

#### **DesktopGamePage.tsx** - Desktop Gameplay Interface
**Purpose**: Desktop game interface with full feature set and sidebar

**Key Features**:
- Full sidebar with detailed resource panels
- Complete crew management with NPC affinity tracking
- Item equipment system (3-item limit)
- Turn-based narrative display with image generation
- Dev tools integration
- Desktop-optimized settings dialog
- Help system integration
- Scroll container-based navigation (uses `scrollRef.current.scrollTop`)

#### **useGameLogic.ts** - Shared Business Logic Hook
**Purpose**: Centralized state management and business logic for both platforms

**Key Features**:
- Real-time game state management with React Query
- WebSocket subscription to `gameId` room (Socket.IO singleton pattern)
- Async action flow: enqueue action → wait for `turnComplete` → refetch state
- Action execution system with custom and suggested actions
- Resource management display (Hull, Oxygen, Fuel, Food, Morale)
- Crew management with NPC affinity tracking
- Item equipment system (3-item limit)
- Turn-based narrative display with image generation
- Settings dialog for game parameters
- Help system integration
- Creative catalog management (themes and visual styles from mod tables)

**State Management**:
- Game state fetched from `/api/game/${gameId}`
- Items data from `/api/reference/items` (from published reference snapshot)
- Themes from `/api/reference/story-themes`
- Styles from `/api/reference/visual-styles`
- Catalog defaults from `/api/pce/catalogs`
- Action mutations enqueue processing via `POST /api/game/action` and handle async completion via WebSocket `turnComplete`
- Image generation mutations for scene visualization
- Local state for UI interactions (modals, custom actions, preferences)

**WebSocket Integration** (implemented in `useGameLogic`):
```typescript
// Socket connection uses singleton pattern from lib/socket.ts
const socket = connectSocket();

// Join game room
socket.emit('joinGame', gameId);

// Listen for events
socket.on('turnComplete', (data) => {
  // Refetch game state
  queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
});

socket.on('imageReady', (data) => {
  // Refetch game state to get new image URL
  queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
});

socket.on('imageFailed', (data) => {
  // Show error toast
});

// Cleanup: Leave room and remove listeners
return () => {
  socket.emit('leaveGame', gameId);
  socket.off('turnComplete');
  socket.off('imageReady');
  socket.off('imageFailed');
  // Note: Socket instance itself persists (singleton pattern)
};
```

**Socket Events Handled**:
- `turnComplete` - Narrative ready for next turn
- `imageReady` - Image generation completed successfully
- `imageFailed` - Image generation failed with error

**Note**: Loading state management has been moved to dedicated hooks (`useAppLoading`, `useGameContentLoading`)

**UI Components Used**:
- StatBar, WeirdnessMeter, TurnCard, ActionChip, NPCCard, ItemCard
- CRTBackground for retro aesthetic
- Dialog components for settings and help

#### **MainMenuPage.tsx** - Game Selection Interface
**Purpose**: Central hub for game management and new game creation

**Key Features**:
- Username-based game persistence
- New game creation with absurdity settings
- Saved game management (resume, delete, view)
- Video splash screen integration (`ImageSplashScreen` component - plays video despite name)
- Absurdity dial (currently locked at maximum)
- Game state display (day, segment, completion status)

**State Management**:
- User games fetched from `/api/games/user/${username}`
- Game creation mutations
- Game deletion mutations
- Local storage for username persistence

#### **WelcomePage.tsx** - Initial User Experience
**Purpose**: First-time user onboarding and username collection

**Flow**:
1. Boot sequence simulation (3-second delay)
2. Username input with validation
3. User creation via `/api/user/ensure`
4. Preference setup (theme and visual style selection) - optional with skip
5. Video splash screen (`VideoSplashScreen` component)
6. Navigate to menu

**Key Features**:
- Username input with validation and error handling
- Boot sequence simulation (3-second delay)
- Preference setup for creative catalogs (themes and visual styles)
- Video splash screen integration
- Local storage persistence
- Retro terminal aesthetic

#### **LoadingPage.tsx** - Initial Boot Sequence
**Purpose**: Preloads critical video assets before application start

**Key Features**:
- Preloads two video files:
  - `Uranus-HawkingFinal_1761531071513.mp4`
  - `Uranus-AskNotWhatUranus_1761533619310.mp4`
- Progress tracking per video (percentage completion)
- Uses `AppLoadingSpinner` component for visual feedback
- Automatically routes based on stored username:
  - Has username → `/menu`
  - No username → `/welcome`

**Usage**: Entry point for application, handles initial asset preloading

#### **InterviewPage.tsx** - Pre-Flight Questionnaire
**Purpose**: Collects player preferences to personalize AI-generated content

**Key Features**:
- Dynamic question loading from API
- Multi-step questionnaire with progress indicators
- AI-assisted answer generation
- Response persistence to game state
- Skip functionality for quick start

**State Management**:
- Questions fetched from `/api/interview-questions/active`
- Response mutations to save answers
- AI answer generation mutations

#### **DevToolsPage.tsx** - Developer Interface
**Purpose**: Comprehensive admin interface for content management

**Key Features**:
- **Prompt Management**: Edit AI prompt templates with versioning
- **Event Management**: Create/edit procedural events with triggers
- **Item Management**: Manage game items with skill bonuses and effects
- **NPC Management**: Create/edit crew member templates
- **Image Prompt Management**: Configure AI image generation templates
- **LLM Logs**: View and analyze all AI interactions
- **Cache Management**: Link to generated image cache interface
- **PCE Prompt Tester**: Test prompt templates with variable substitution
- **Reference Publisher**: Manage story themes and visual styles (mod tables)

**State Management**:
- Multiple data sources (prompts, events, items, NPCs, image prompts, logs, themes, styles)
- CRUD operations for all content types
- Real-time data synchronization
- Bulk operations (clear logs; image cache cleanup)

#### **CacheManagementPage.tsx** - Generated Image Cache Interface
**Purpose**: Advanced image cache management and analytics

**Key Features**:
- **Overview Dashboard**: Cache statistics and recent activity
- **Image Management**: Browse, filter, and delete cached images
- **Analytics**: Template usage, access patterns, storage analysis
- **Settings**: Cache configuration and export functionality

**State Management**:
- Cache statistics from `/api/cache/stats`
- Image data from `/api/cache/images`
- Bulk deletion operations
- Search and filtering capabilities

### 3. Game Components (`src/components/`)

#### **TurnCard.tsx** - Narrative Display Component
**Purpose**: Displays individual game turns with narrative, checks, and deltas

**Key Features**:
- Markdown rendering for narrative text (using ReactMarkdown)
- Check results display (skill, DC, roll, success) via `CheckDisplay` component
- Delta changes visualization (stat modifications) via `DeltaDisplay` component
- Image integration for scene visualization with loading states
- Image prompt and style display when available
- Mission viewscreen mode with regenerate image button
- Image generation status indicators (pending, completed, failed)
- Template information display

**Props**:
- `turnNumber`, `narrative`, `checks`, `delta`, `imageUrl`, `imageStatus`, `imageJobId`
- `imagePrompt`, `imageStyle`, `imageTemplate`
- `showMissionViewscreen`, `onVisualize`, `isGeneratingImage`

#### **ActionChip.tsx** - Interactive Action Buttons
**Purpose**: Displays available actions with risk levels and item integration

**Key Features**:
- Risk-based color coding (Safe, Risky, Wild)
- Item icon display for equipment-dependent actions
- Press animation feedback
- Click handling with action execution

#### **StatBar.tsx** - Resource Display Component
**Purpose**: Visual representation of ship resources with consumption rates

**Key Features**:
- Percentage-based progress bars
- Color coding for critical/low levels (critical < 15%, low < 30%)
- Daily consumption rate display (when `dailyConsumption` prop provided)
- Icon and label integration
- Value display with formatted numbers (value/max)

#### **NPCCard.tsx** - Crew Member Display
**Purpose**: Shows crew member status, affinity, and interactions

**Key Features**:
- Affinity visualization with 7-point scale
- Status indicators (Rivalry, Crush, Indifferent)
- Last interaction display
- Color-coded affinity bars

#### **ItemCard.tsx** - Equipment Management
**Purpose**: Displays items with equipment status and interaction

**Key Features**:
- Equipment state visualization
- Click-to-equip functionality
- Icon and description display
- Equipment limit enforcement (3 items max)

#### **CompactStat.tsx** - Mobile Resource Display
**Purpose**: Compact stat display for mobile interface

**Key Features**:
- Icon-based display
- Value/max formatting
- Label display
- Used in `MobileGamePage` for space-efficient stats panel

#### **WeirdnessMeter.tsx** - Cosmic Absurdity Tracker
**Purpose**: Visual indicator of accumulated cosmic weirdness

**Key Features**:
- 5-point scale with animated dots (default max = 5)
- Warning display at maximum level
- Reality Auditor threat indication ("⚠️ Reality Auditors incoming!")

#### **CRTBackground.tsx** - Retro Visual Effect
**Purpose**: Animated CRT monitor effect for retro aesthetic

**Key Features**:
- Canvas-based phosphor simulation
- Configurable intensity levels (low, medium, high)
- Animated glyphs with color cycling
- Flicker effects and phosphor decay
- Responsive sizing

#### **HelpContent.tsx** - Comprehensive Game Guide
**Purpose**: Detailed help system with collapsible sections

**Key Features**:
- Accordion-based navigation
- Resource management explanations
- Action system documentation
- Skill check mechanics
- Equipment and crew guides
- Winning/losing conditions

### 4. UI Component System (`src/components/ui/`)

**Purpose**: Complete shadcn/ui component library for consistent design

**Key Components**:
- **Layout**: Card, Separator, ScrollArea, AspectRatio, Resizable
- **Navigation**: Tabs, Breadcrumb, NavigationMenu, Menubar, Sidebar
- **Forms**: Input, Textarea, Select, Checkbox, RadioGroup, Switch, InputOTP
- **Feedback**: Alert, Toast, Progress, Skeleton
- **Overlays**: Dialog, Sheet, Drawer, Popover, Tooltip, HoverCard, AlertDialog
- **Data Display**: Table, Badge, Avatar, Calendar, Chart
- **Interactive**: Button, Command, ContextMenu, DropdownMenu, Toggle, ToggleGroup
- **Pagination**: Pagination component
- **Carousel**: Carousel component
- **Collapsible**: Collapsible component

**Features**:
- Consistent design tokens
- Accessibility compliance
- Dark mode support
- Responsive design
- TypeScript integration

### 5. Loading Components (`src/components/loading/`)

#### **AppLoadingSpinner.tsx** - App-Level Loading Display
**Purpose**: Reusable component for web app infrastructure loading

**Key Features**:
- Animated dots with staggered delays (3 dots, 200ms delays)
- Progress bar with percentage display (optional)
- Customizable loading message
- Full-screen overlay design
- CRT-themed styling (cyan colors, monospace font)

**Usage**: Used in LoadingPage for video asset preloading

#### **GameContentLoading.tsx** - Game Content Loading Display
**Purpose**: Reusable component for gameplay content loading

**Key Features**:
- Action processing indicator (`type='action'`)
- Image generation indicator (`type='image'`)
- Current action text display (when provided)
- Consistent styling with game theme (cyan borders, glow effects)
- Loading message customization based on type

**Usage**: Used in DesktopGamePage and MobileGamePage for action processing feedback

#### **GameDataLoading.tsx** - Game Data Loading Display
**Purpose**: Simple spinner for game data loading

**Key Features**:
- CRT background integration
- Centered spinner design
- Consistent with game aesthetic

**Usage**: Used in GamePage for device detection and initial game data loading

### 6. Utility Components

#### **ImageSplashScreen.tsx** - Video Introduction
**Purpose**: Plays introductory video (note: component name is misleading - it plays a video, not an image)

**Key Features**:
- Video playback with auto-play
- Skip button appears after 2 seconds
- Fade transitions on completion
- Completion callback handling
- Full-screen overlay design

**Video Used**: `Uranus-AskNotWhatUranus_1761533619310.mp4`

**Usage**: Used in MainMenuPage for introductory video

#### **VideoSplashScreen.tsx** - Welcome Video
**Purpose**: Plays welcome video after username entry and preferences

**Key Features**:
- Video playback with auto-play
- Skip button appears after 2 seconds
- Fade transitions on completion
- Completion callback handling
- Full-screen overlay design

**Video Used**: `Uranus-HawkingFinal_1761531071513.mp4`

**Usage**: Used in WelcomePage after preference setup

#### **ImageTestModal.tsx** - Image Generation Testing
**Purpose**: Allows testing of image prompt templates

**Key Features**:
- Template selection
- Variable substitution
- Image generation testing
- Result display

### 7. Custom Hooks (`src/hooks/`)

#### **use-toast.ts** - Toast Notification System
**Purpose**: Centralized toast notification management

**Key Features**:
- Toast creation and management
- Variant support (default, destructive)
- Auto-dismiss functionality

#### **use-mobile.tsx** - Mobile Detection
**Purpose**: Responsive design helper for mobile detection

**Key Features**:
- Screen size detection
- Responsive UI adjustments
- Mobile-specific optimizations
- Returns `boolean | undefined` during initial detection

#### **useAppLoading.ts** - App-Level Loading State Management
**Purpose**: Manages web app infrastructure loading states

**Key Features**:
- Asset preloading state management
- Device detection loading state
- Game data loading state
- Centralized app loading state tracking
- `setLoading(key, value)` callback for individual state updates

**State Properties**:
- `isLoadingAssets`: Asset preloading status
- `isDetectingDevice`: Mobile/desktop detection status
- `isLoadingGameData`: Initial game data fetch status
- `isAppLoading`: Combined loading state (true if any individual state is true)

#### **useGameContentLoading.ts** - Game Content Loading State Management
**Purpose**: Manages gameplay content loading states

**Key Features**:
- Action processing loading state
- Image generation loading state
- Current action text tracking (can be string or null)
- Content-specific loading indicators
- `setLoading(key, value)` callback (value can be boolean, string, or null)

**State Properties**:
- `isProcessingAction`: Action processing status
- `isGeneratingImage`: Image generation status
- `currentActionText`: Currently processing action text (string | null)
- `isContentLoading`: Combined content loading state (true if processing action or generating image)

#### **usePceCatalogs.ts** - PCE Catalog Management
**Purpose**: Fetches and manages creative catalog data for dev tools

**Key Features**:
- Fetches themes from `/api/admin/mod-story-themes`
- Fetches visual styles from `/api/admin/mod-visual-styles`
- Fetches image models from `/api/admin/image-models`
- Returns combined catalog data with TypeScript types

**Returns**:
- `themes`: Array of `ModStoryTheme` objects
- `styles`: Array of `ModVisualStyle` objects
- `imageModels`: Array of `ImageModelInfo` objects (modelKey, displayName, provider, etc.)

**Usage**: Used in dev tools for managing creative catalogs and image model configuration

### 8. Styling System

#### **index.css** - Global Styles
**Purpose**: Application-wide styling and CSS custom properties

**Key Features**:
- Tailwind CSS base styles
- Custom CSS variables for theming (light and dark mode)
- CRT-specific animations and effects
- Font loading optimization
- Elevation system for hover/active states
- Sidebar theming variables
- Card and border color definitions

#### **Design System**:
- **Color Palette**: Cyan (#00ffff), Orange (#ffaa00), Magenta (#ff66ff)
- **Typography**: Monospace fonts (Fira Code, IBM Plex Mono)
- **Effects**: Glow, flicker, pulse animations
- **Layout**: Responsive grid system with mobile-first approach

## Data Flow Architecture

### 1. State Management Strategy
- **Server State**: React Query for all API data
- **Local State**: React hooks for UI interactions
- **Persistence**: Local storage for user preferences and username
- **Real-time Updates**: WebSocket events trigger query invalidation and refetch

### 2. API Integration Pattern
- **Query Functions**: Centralized in `queryClient.ts` via `getQueryFn` factory
- **Error Handling**: Global error boundaries and toast notifications
- **Authentication**: 
  - Credential-based (cookies) for standard user authentication
  - Bearer token (admin token in localStorage) for admin operations
  - CSRF token protection for state-changing requests
- **Caching**: Infinite stale time with manual invalidation via `queryClient.invalidateQueries()`

### 3. WebSocket Integration Pattern

**Architecture**: Singleton Socket.IO connection pattern

**Connection Lifecycle**:
1. Socket instance created once via `getSocket()` in `lib/socket.ts`
2. Connection established via `connectSocket()` (called from `useGameLogic`)
3. Socket persists for application lifetime (singleton pattern)
4. Game-specific room management via `joinGame`/`leaveGame` events

**Implementation in `useGameLogic`**:
```typescript
useEffect(() => {
  if (!gameId) return;
  
  // Get singleton socket and connect
  const socket = connectSocket();
  
  // Join game-specific room
  socket.emit('joinGame', gameId);
  
  // Set up event listeners
  socket.on('turnComplete', (data) => {
    queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
  });
  
  socket.on('imageReady', (data) => {
    queryClient.invalidateQueries({ queryKey: [`/api/game/${gameId}`] });
  });
  
  socket.on('imageFailed', (data) => {
    toast({ title: "Image Generation Failed", description: data.error, variant: "destructive" });
  });
  
  // Cleanup: Leave room and remove listeners (socket instance persists)
  return () => {
    socket.emit('leaveGame', gameId);
    socket.off('turnComplete');
    socket.off('imageReady');
    socket.off('imageFailed');
  };
}, [gameId, toast]);
```

**Socket Events**:
- **Outgoing**: `joinGame(gameId)`, `leaveGame(gameId)`
- **Incoming**: 
  - `turnComplete` - Narrative ready for next turn
  - `imageReady` - Image generation completed
  - `imageFailed` - Image generation failed
  - `llmLog` - LLM call logging (automatic console output)

**Async Action Flow**:
1. **Enqueue**: `POST /api/game/action` returns `{ turnJobId, status: "processing" }`
2. **Subscribe**: Socket already connected, emit `joinGame` with `gameId`
3. **Listen**: 
   - `turnComplete` → `invalidateQueries(['/api/game/${gameId}'])` → refetch state
   - `imageReady` → `invalidateQueries(['/api/game/${gameId}'])` → refetch state with new image URL
   - `imageFailed` → Show error toast to user
4. **Unsubscribe**: emit `leaveGame(gameId)` and remove event listeners (on unmount or game switch)

### 4. Component Communication
- **Props**: Direct parent-child communication
- **Context**: Global providers for cross-cutting concerns (QueryClient, TooltipProvider, Toaster)
- **Events**: Custom event handlers for user interactions
- **State Lifting**: Shared state management in parent components
- **WebSocket Events**: Real-time updates via Socket.IO singleton

## Performance Optimizations

### 1. Rendering Optimizations
- `useMemo` for expensive calculations (used in `UserSettingsDialog` for image models and catalog defaults)
- `useCallback` for stable function references
- React component composition for code reuse
- Image lazy loading and optimization
- Conditional rendering to reduce DOM size

**Note**: Route-based code splitting with `React.lazy()` is not currently implemented. All components are imported directly. This could be added in the future if bundle size becomes a concern.

### 2. Bundle Optimization
- Tree shaking for unused code elimination (Vite default)
- Asset optimization with Vite
- Font subsetting and preloading
- CSS purging with Tailwind

### 3. State Management Optimizations
- React Query caching with infinite stale time (prevents unnecessary refetches)
- Manual query invalidation for precise cache control
- Singleton socket pattern (single connection shared across components)

## Development Features

### 1. Developer Tools
- Comprehensive dev tools interface (`DevToolsPage`)
- Real-time content management
- LLM interaction logging (automatic console logging via socket `llmLog` event)
- Cache management and analytics
- PCE prompt testing interface
- Reference publisher for themes and styles

### 2. Testing Support
- Data-testid attributes throughout components
- Component isolation for unit testing
- Mock-friendly architecture
- Error boundary testing

### 3. Debugging Features
- React Query DevTools integration (can be added)
- Console logging for actions
- LLM call logging via WebSocket `llmLog` event (formatted console groups)
- Error reporting and tracking
- Socket event monitoring

## Mobile Responsiveness

### 1. Responsive Design
- Mobile-first approach with breakpoint system
- Touch-friendly interface elements
- Optimized layouts for small screens (`MobileGamePage` with compact stats)
- Separate mobile and desktop game interfaces for optimal UX

### 2. Performance on Mobile
- Reduced animation complexity
- Optimized image loading
- Efficient memory usage
- Battery-conscious rendering
- Window-based scrolling for mobile (vs container scrolling on desktop)

## Accessibility Features

### 1. WCAG Compliance
- Keyboard navigation support
- Screen reader compatibility (semantic HTML, ARIA attributes)
- High contrast mode support
- Focus management

### 2. User Experience
- Clear visual hierarchy
- Consistent interaction patterns
- Error state communication (toast notifications)
- Loading state indicators (dedicated loading components)

## Integration Points

### 1. Server Communication
- RESTful API integration via `apiRequest` and `getQueryFn`
- WebSocket support for real-time updates (Socket.IO singleton)
- File upload/download capabilities
- Error handling and retry logic (no automatic retries, manual error handling)

### 2. External Services
- OpenAI integration for AI features (server-side)
- Image generation services (server-side)
- Analytics and monitoring (future)
- Content delivery networks (future)

## Security Considerations

### 1. Client-Side Security
- Input validation and sanitization (Zod schemas on server)
- XSS prevention measures (React automatic escaping)
- CSRF protection (automatic token management in `queryClient.ts`)
- Secure storage practices (localStorage for non-sensitive data, cookies for auth)

### 2. Data Protection
- Sensitive data handling (admin tokens in localStorage, credentials in cookies)
- Privacy compliance
- Secure communication (HTTPS in production)
- Access control (admin token system for privileged operations)

## Future Enhancements

### 1. Planned Features
- Offline mode support
- Progressive Web App capabilities
- Advanced analytics dashboard
- Multi-language support
- Route-based code splitting with `React.lazy()` for performance

### 2. Performance Improvements
- Service worker implementation
- Advanced caching strategies
- Bundle size optimization (lazy loading routes)
- Runtime performance tuning

## Maintenance Guidelines

### 1. Code Organization
- Feature-based folder structure
- Consistent naming conventions
- Component composition patterns
- Documentation standards

### 2. Update Procedures
- Dependency management
- Breaking change handling
- Migration strategies
- Rollback procedures

## Route Summary

All routes defined in `App.tsx`:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | LoadingPage | Initial boot with video preloading |
| `/welcome` | WelcomePage | Username entry and preferences |
| `/menu` | MainMenuPage | Game selection and creation |
| `/help` | HelpPage | Game instructions |
| `/interview/:gameId` | InterviewPage | Pre-flight questionnaire |
| `/game/:gameId` | GamePage | Main gameplay (routes to Mobile/Desktop) |
| `/dev-tools` | DevToolsPage | Developer tools interface |
| `/dev-tools/cache` | CacheManagementPage | Image cache management |
| `*` | NotFound | 404 catch-all route |

## Component Summary

### Game Components
- `TurnCard` - Turn narrative display
- `ActionChip` - Action buttons
- `StatBar` - Resource bars
- `CompactStat` - Mobile stat display
- `NPCCard` - Crew member cards
- `ItemCard` - Equipment cards
- `WeirdnessMeter` - Absurdity tracker
- `CRTBackground` - Retro visual effect
- `HelpContent` - Help system
- `CheckDisplay` - Skill check results
- `DeltaDisplay` - Stat change visualization

### Loading Components
- `AppLoadingSpinner` - App-level loading
- `GameContentLoading` - Game content loading
- `GameDataLoading` - Game data loading

### Utility Components
- `ImageSplashScreen` - Video intro (MainMenu)
- `VideoSplashScreen` - Welcome video (WelcomePage)
- `ImageTestModal` - Image generation testing

This client architecture provides a robust, scalable foundation for the Quest to Uranus game, with comprehensive tooling for both players and developers, while maintaining the retro-futuristic aesthetic that defines the game's unique character.

