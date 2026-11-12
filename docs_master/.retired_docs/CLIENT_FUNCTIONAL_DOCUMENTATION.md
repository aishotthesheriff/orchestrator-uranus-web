# Quest to Uranus: Client Module Functional Documentation

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
- Wouter-based routing system with 8 main routes
- Global providers (QueryClient, TooltipProvider, Toaster)
- Route definitions for all application pages

**Routes**:
- `/` - LoadingPage (initial boot sequence)
- `/welcome` - WelcomePage (username entry)
- `/menu` - MainMenuPage (game selection/creation)
- `/help` - HelpPage (game instructions)
- `/interview/:gameId` - InterviewPage (pre-flight questionnaire)
- `/game/:gameId` - GamePage (main gameplay interface)
- `/dev-tools` - DevToolsPage (developer tools)
- `/dev-tools/cache` - CacheManagementPage (generated image cache management)

#### **lib/queryClient.ts** - API Client Configuration
**Purpose**: Centralized API communication and React Query setup

**Key Features**:
- Custom `apiRequest` function with error handling
- Query function factory with 401 handling options
- React Query client with optimized defaults (no refetch, infinite stale time)
- Credential-based authentication support

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
- Handles loading state during screen size detection
- Maintains single entry point for game route

#### **MobileGamePage.tsx** - Mobile Gameplay Interface
**Purpose**: Mobile-optimized game interface with touch-friendly design

**Key Features**:
- Compact stats panel using `CompactStat` components
- Simplified header with icon-only buttons
- Full-width narrative feed without height restrictions
- Mobile-optimized settings dialog
- Touch-friendly action selection

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

#### **useGameLogic.ts** - Shared Business Logic Hook
**Purpose**: Centralized state management and business logic for both platforms

**Key Features**:
- Real-time game state management with React Query
- WebSocket subscription to `gameId` room (Socket.IO)
- Async action flow: enqueue action → wait for `turnComplete` → refetch state
- Action execution system with custom and suggested actions
- Resource management display (Hull, Oxygen, Fuel, Food, Morale)
- Crew management with NPC affinity tracking
- Item equipment system (3-item limit)
- Turn-based narrative display with image generation
- Settings dialog for game parameters
- Help system integration

**State Management**:
- Game state fetched from `/api/game/${gameId}`
- Items data from `/api/items`
- Action mutations enqueue processing via `POST /api/game/action` and handle async completion via WebSocket `turnComplete`
- Image generation mutations for scene visualization
- Local state for UI interactions (modals, custom actions)
- **Note**: Loading state management has been moved to dedicated hooks (`useAppLoading`, `useGameContentLoading`)

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
- Image splash screen integration
- Absurdity dial (currently locked at maximum)
- Game state display (day, segment, completion status)

**State Management**:
- User games fetched from `/api/games/user/${username}`
- Game creation mutations
- Game deletion mutations
- Local storage for username persistence

#### **WelcomePage.tsx** - Initial User Experience
**Purpose**: First-time user onboarding and username collection

**Key Features**:
- Username input with validation
- Boot sequence simulation (3-second delay)
- Video splash screen integration
- Local storage persistence
- Retro terminal aesthetic

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

**State Management**:
- Multiple data sources (prompts, events, items, NPCs, image prompts, logs)
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
- Markdown rendering for narrative text
- Check results display (skill, DC, roll, success)
- Delta changes visualization (stat modifications)
- Image integration for scene visualization
- Template information display

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
- Color coding for critical/low levels
- Daily consumption rate display
- Icon and label integration

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

#### **WeirdnessMeter.tsx** - Cosmic Absurdity Tracker
**Purpose**: Visual indicator of accumulated cosmic weirdness

**Key Features**:
- 5-point scale with animated dots
- Warning display at maximum level
- Reality Auditor threat indication

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
- **Layout**: Card, Separator, ScrollArea, AspectRatio
- **Navigation**: Tabs, Breadcrumb, NavigationMenu, Menubar
- **Forms**: Input, Textarea, Select, Checkbox, RadioGroup, Switch
- **Feedback**: Alert, Toast, Progress, Skeleton
- **Overlays**: Dialog, Sheet, Popover, Tooltip, HoverCard
- **Data Display**: Table, Badge, Avatar, Calendar, Chart
- **Interactive**: Button, Command, ContextMenu, DropdownMenu

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
- Animated dots with staggered delays
- Progress bar with percentage display
- Customizable loading message
- Full-screen overlay design

**Usage**: Used in LoadingPage for asset preloading and authentication

#### **GameContentLoading.tsx** - Game Content Loading Display
**Purpose**: Reusable component for gameplay content loading

**Key Features**:
- Action processing indicator
- Image generation indicator
- Current action text display
- Consistent styling with game theme

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
**Purpose**: Plays introductory video before game start

**Key Features**:
- Video playback with skip functionality
- Fade transitions
- Completion callback handling

#### **VideoSplashScreen.tsx** - Welcome Video
**Purpose**: Plays welcome video after username entry

**Key Features**:
- Video playback with skip functionality
- Fade transitions
- Completion callback handling

#### **ImageTestModal.tsx** - Image Generation Testing
**Purpose**: Allows testing of image prompt templates

**Key Features**:
- Template selection
- Variable substitution
- Image generation testing
- Result display

### 6. Custom Hooks (`src/hooks/`)

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

#### **useAppLoading.ts** - App-Level Loading State Management
**Purpose**: Manages web app infrastructure loading states

**Key Features**:
- Asset preloading state management
- Device detection loading state
- Game data loading state
- Centralized app loading state tracking

**State Properties**:
- `isLoadingAssets`: Asset preloading status
- `isDetectingDevice`: Mobile/desktop detection status
- `isLoadingGameData`: Initial game data fetch status
- `isAppLoading`: Combined loading state

#### **useGameContentLoading.ts** - Game Content Loading State Management
**Purpose**: Manages gameplay content loading states

**Key Features**:
- Action processing loading state
- Image generation loading state
- Current action text tracking
- Content-specific loading indicators

**State Properties**:
- `isProcessingAction`: Action processing status
- `isGeneratingImage`: Image generation status
- `currentActionText`: Currently processing action text
- `isContentLoading`: Combined content loading state

### 7. Styling System

#### **index.css** - Global Styles
**Purpose**: Application-wide styling and CSS custom properties

**Key Features**:
- Tailwind CSS base styles
- Custom CSS variables for theming
- CRT-specific animations and effects
- Font loading optimization

#### **Design System**:
- **Color Palette**: Cyan (#00ffff), Orange (#ffaa00), Magenta (#ff66ff)
- **Typography**: Monospace fonts (Fira Code, IBM Plex Mono)
- **Effects**: Glow, flicker, pulse animations
- **Layout**: Responsive grid system with mobile-first approach

## Data Flow Architecture

### 1. State Management Strategy
- **Server State**: React Query for all API data
- **Local State**: React hooks for UI interactions
- **Persistence**: Local storage for user preferences
- **Real-time Updates**: Optimistic updates with rollback

### 2. API Integration Pattern
- **Query Functions**: Centralized in `queryClient.ts`
- **Error Handling**: Global error boundaries and toast notifications
- **Authentication**: Credential-based with automatic retry
- **Caching**: Infinite stale time with manual invalidation

### 4. Async Action Flow & WebSockets
- **Enqueue**: `POST /api/game/action` returns `{ turnJobId, status: "processing" }`
- **Subscribe**: Connect Socket.IO and emit `joinGame` with `gameId`
- **Listen**:
  - `turnComplete` → refetch `/api/game/{id}`
  - `imageReady` → update the latest `TurnCard` image URL
  - `imageFailed` → optionally notify user
- **Unsubscribe**: emit `leaveGame` on unmount or game switch

Client example (socket.io-client):
```javascript
import { io } from 'socket.io-client';

export function useGameSocket(gameId, onTurnComplete, onImageReady, onImageFailed) {
  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001', {
      transports: ['websocket']
    });

    socket.on('connect', () => socket.emit('joinGame', gameId));
    socket.on('turnComplete', onTurnComplete);
    socket.on('imageReady', onImageReady);
    socket.on('imageFailed', onImageFailed);

    return () => {
      socket.emit('leaveGame', gameId);
      socket.disconnect();
    };
  }, [gameId]);
}
```

### 3. Component Communication
- **Props**: Direct parent-child communication
- **Context**: Global providers for cross-cutting concerns
- **Events**: Custom event handlers for user interactions
- **State Lifting**: Shared state management in parent components

## Performance Optimizations

### 1. Code Splitting
- Route-based code splitting with lazy loading
- Component-level splitting for heavy components
- Dynamic imports for optional features

### 2. Rendering Optimizations
- React.memo for expensive components
- useMemo and useCallback for expensive calculations
- Virtual scrolling for large lists
- Image lazy loading and optimization

### 3. Bundle Optimization
- Tree shaking for unused code elimination
- Asset optimization with Vite
- Font subsetting and preloading
- CSS purging with Tailwind

## Development Features

### 1. Developer Tools
- Comprehensive dev tools interface
- Real-time content management
- LLM interaction logging
- Cache management and analytics

### 2. Testing Support
- Data-testid attributes throughout
- Component isolation for unit testing
- Mock-friendly architecture
- Error boundary testing

### 3. Debugging Features
- React Query DevTools integration
- Console logging for actions
- Error reporting and tracking
- Performance monitoring

## Mobile Responsiveness

### 1. Responsive Design
- Mobile-first approach with breakpoint system
- Touch-friendly interface elements
- Optimized layouts for small screens
- Gesture support for navigation

### 2. Performance on Mobile
- Reduced animation complexity
- Optimized image loading
- Efficient memory usage
- Battery-conscious rendering

## Accessibility Features

### 1. WCAG Compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode support
- Focus management

### 2. User Experience
- Clear visual hierarchy
- Consistent interaction patterns
- Error state communication
- Loading state indicators

## Integration Points

### 1. Server Communication
- RESTful API integration
- WebSocket support for real-time updates
- File upload/download capabilities
- Error handling and retry logic

### 2. External Services
- OpenAI integration for AI features
- Image generation services
- Analytics and monitoring
- Content delivery networks

## Security Considerations

### 1. Client-Side Security
- Input validation and sanitization
- XSS prevention measures
- CSRF protection
- Secure storage practices

### 2. Data Protection
- Sensitive data handling
- Privacy compliance
- Secure communication
- Access control

## Future Enhancements

### 1. Planned Features
- Offline mode support
- Progressive Web App capabilities
- Advanced analytics dashboard
- Multi-language support

### 2. Performance Improvements
- Service worker implementation
- Advanced caching strategies
- Bundle size optimization
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

This client architecture provides a robust, scalable foundation for the Quest to Uranus game, with comprehensive tooling for both players and developers, while maintaining the retro-futuristic aesthetic that defines the game's unique character.
