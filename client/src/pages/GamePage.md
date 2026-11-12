# GamePage Documentation

## Page Overview

**Purpose**: Router component that detects screen size and renders either MobileGamePage or DesktopGamePage based on device type. Provides device-agnostic entry point for the game interface.

**User Flow**:
1. User navigates to `/game/:gameId` route
2. Component detects device type (mobile vs desktop)
3. Renders appropriate layout component
4. Shows loading state during device detection

**Key Features**:
- Responsive device detection
- Conditional component rendering
- Loading state during detection
- Seamless transition between mobile/desktop layouts

## Architecture Review

### Component Dependencies

- **useIsMobile**: Custom hook for device detection
- **useAppLoading**: App-level loading state management
- **GameDataLoading**: Loading component
- **MobileGamePage**: Mobile-optimized game interface
- **DesktopGamePage**: Desktop game interface with sidebar

### State Management Patterns

- **Device Detection**: Uses `useIsMobile` hook (may return `undefined` during detection)
- **Loading State**: Manages app-level loading during device detection
- **No Local State**: Pure router component with no internal state

### Data Flow

1. Component mounts → `useIsMobile` hook initializes
2. Device detection completes → Returns `true` (mobile) or `false` (desktop)
3. Appropriate page component renders
4. If detection undefined → Shows loading spinner

### Routing Integration

- Entry: `/game/:gameId` route (defined in App.tsx)
- Route param: `gameId` extracted by child components via `useParams`
- No direct navigation from this component

### Hook Usage

**React Hooks**:
- None directly (relies on custom hooks)

**Custom Hooks**:
- `useIsMobile`: Device detection hook
- `useAppLoading`: Loading state management

**WebSocket Connections**: Handled by child components (MobileGamePage/DesktopGamePage)

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Extremely simple and focused component (18 lines)
- Clear single responsibility (routing based on device)
- Proper TypeScript typing
- Good loading state handling

**Areas for Improvement**:
- None - component is well-designed for its purpose

### Performance Considerations

- Minimal overhead - just conditional rendering
- Device detection happens once per mount
- No unnecessary re-renders

### Accessibility Features

- Loading state communicated via GameDataLoading component
- No accessibility concerns for router component

### Error Handling

- Handles undefined device detection state gracefully
- Errors bubble to child components

### Loading States

- Shows GameDataLoading when device detection is undefined
- Transitions smoothly to appropriate page component

### Responsive Design Patterns

- Uses hook-based detection rather than CSS media queries
- Renders completely different components for different devices

## API Calls

### Synchronous API Calls

None. This is a pure router component.

### Asynchronous API Calls

None. All API calls are handled by child components (MobileGamePage or DesktopGamePage).

### Mutations, Hooks, and Actions

**Hooks Used**:

1. **useIsMobile** (Line 8)
   - Purpose: Detects if current device is mobile
   - Returns: `boolean | undefined`
   - When undefined: During initial detection
   - Used for: Conditional rendering logic

2. **useAppLoading** (Line 9)
   - Purpose: Manages app-level loading state
   - Used for: Setting loading state during device detection
   - Note: Loading state setter accessed but not used in this component

**Action Handlers**: None - pure presentation component

**Side Effects**: None - no useEffect hooks

## Dependencies

### React Hooks Used

None directly.

### Custom Hooks Dependencies

- `useIsMobile` from `@/hooks/use-mobile`: Device detection
- `useAppLoading` from `@/hooks/useAppLoading`: Loading state management

### API Endpoints Consumed

None. All API calls delegated to child components.

### Component Dependencies

- `GameDataLoading`: Loading component
- `MobileGamePage`: Mobile layout component
- `DesktopGamePage`: Desktop layout component

### Third-Party Libraries

- `react`: Core framework

## State Management

### Local State (useState)

None. Pure functional component.

### Server State (React Query)

None. Handled by child components.

### Derived State (useMemo)

None.

## Key Functions & Handlers

### User Interaction Handlers

None. All interactions handled by child components.

### Navigation Handlers

None. Navigation handled by child components.

### Side Effects (useEffect)

None.

## Styling & Theming

### CRT Aesthetic Implementation

None. This component has no styling.

### Tailwind CSS Usage

None.

### Responsive Breakpoints

Uses JavaScript-based device detection rather than CSS breakpoints.

### Animation Usage

None.

## Testing Considerations

### Testable Elements (data-testid)

None in this component. Test child components directly.

### User Interaction Points

None. Test MobileGamePage and DesktopGamePage separately.

### Edge Cases to Test

- Device detection returns undefined → Shows loading state
- Rapid device orientation changes → Re-renders appropriately
- Missing gameId parameter → Handled by child components

## Known Issues & Technical Debt

### Performance Bottlenecks

None.

### Code Duplication

None.

### Maintenance Concerns

- **Unused Loading State**: `setLoading` from `useAppLoading` is accessed but never called
  - **Action**: Either use it or remove the hook call
  - **Status**: Minor - no functional impact

### Future Improvements

1. **Loading State**: Use the `setLoading` hook if app-level loading is needed during device detection
2. **Error Boundary**: Add error boundary if device detection fails
3. **Analytics**: Track which layout is used (mobile vs desktop)

## Maintenance Guidelines

### When to Modify This Page

- Changing device detection logic
- Adding new device types (tablet, etc.)
- Modifying loading behavior
- Adding error boundaries

### Common Modification Patterns

1. **Changing Detection Logic**:
   - Update `useIsMobile` hook implementation
   - Component automatically reflects changes

2. **Adding New Layout**:
   - Add new conditional branch
   - Render new component type

### Breaking Change Considerations

- **Hook Changes**: If `useIsMobile` interface changes, update component
- **Component Props**: If MobileGamePage/DesktopGamePage require props, pass them through
- **Loading Component**: If GameDataLoading interface changes, update usage
