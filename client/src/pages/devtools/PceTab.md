# PceTab Documentation

## Component Overview

**Purpose**: Management interface for the Prompt Composition Engine (PCE). Provides feature flag toggle and catalog management for story themes and visual styles used by the PCE system.

**User Flow**:
1. Toggle PCE enabled/disabled
2. Switch between Story Themes and Visual Styles tabs
3. Browse catalog entries
4. Create/edit catalog entries
5. Archive (deactivate) entries

**Key Features**:
- PCE feature flag toggle
- Story themes catalog management (CRUD)
- Visual styles catalog management (CRUD)
- Archive functionality
- Tabbed interface for catalog types

## Architecture Review

### Component Dependencies

- **Tabs**: Tabbed interface for story themes vs visual styles
- **StoryThemesSection**: Sub-component for story themes CRUD
- **VisualStylesSection**: Sub-component for visual styles CRUD
- **Switch**: PCE toggle component

### State Management Patterns

- **Local State**: PCE enabled status, selected entries, form state
- **Server State**: Settings (PCE flag), story themes, visual styles via React Query
- **Mutations**: Update PCE flag, CRUD for catalogs

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear separation of concerns (sub-components)
- Good form validation
- Archive functionality (soft delete)
- Clean tabbed interface

**Areas for Improvement**:
- Large component (638 lines)
- Two very similar sub-components (could extract shared logic)
- PCE flag logic duplicated in DevToolsPage

## API Calls

### Asynchronous API Calls

**1. Settings Query**
- **Hook**: `useQuery<AppSetting[]>`
- **Query Key**: `['api', 'settings']`
- **Purpose**: Fetch PCE enabled setting
- **Line**: 57-59

**2. Story Themes Query** (StoryThemesSection)
- **Hook**: `useQuery<ModStoryTheme[]>`
- **Query Key**: `['api', 'admin', 'mod-story-themes']`
- **Line**: 145-147

**3. Visual Styles Query** (VisualStylesSection)
- **Hook**: `useQuery<ModVisualStyle[]>`
- **Query Key**: `['api', 'admin', 'mod-visual-styles']`
- **Line**: 381-383

### Mutations, Hooks, and Actions

**1. Update PCE Flag Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `PUT /api/settings/pce_enabled`
- **Payload**: `{ value: "true" | "false" }`
- **Purpose**: Toggle PCE feature flag
- **Success**: Invalidates settings query
- **Triggered By**: Switch toggle
- **Line**: 67-90

**2. Story Themes Mutations** (StoryThemesSection):
- **Create Theme**: `POST /api/admin/mod-story-themes`
- **Update Theme**: `PUT /api/admin/mod-story-themes/${id}`
- **Delete Theme**: `DELETE /api/admin/mod-story-themes/${id}` (archive)

**3. Visual Styles Mutations** (VisualStylesSection):
- **Create Style**: `POST /api/admin/mod-visual-styles`
- **Update Style**: `PUT /api/admin/mod-visual-styles/${id}`
- **Delete Style**: `DELETE /api/admin/mod-visual-styles/${id}` (archive)

**Action Handlers**:

**Main Component**:
- PCE toggle: Updates setting via mutation

**StoryThemesSection**:
- **handleSelectTheme**: Loads theme into form
- **handleCreateNewTheme**: Initializes create mode
- **handleSaveTheme**: Validates and saves (creates or updates)
- **Archive**: Calls delete mutation

**VisualStylesSection**:
- Similar handlers for visual styles

## Dependencies

### React Hooks

- `useState`: Multiple instances in sub-components
- `useQueryClient`: For cache invalidation

### API Endpoints

1. `GET /api/settings` - PCE flag
2. `PUT /api/settings/pce_enabled` - Toggle PCE
3. `GET /api/admin/mod-story-themes` - Story themes
4. `POST /api/admin/mod-story-themes` - Create theme
5. `PUT /api/admin/mod-story-themes/${id}` - Update theme
6. `DELETE /api/admin/mod-story-themes/${id}` - Archive theme
7. `GET /api/admin/mod-visual-styles` - Visual styles
8. `POST /api/admin/mod-visual-styles` - Create style
9. `PUT /api/admin/mod-visual-styles/${id}` - Update style
10. `DELETE /api/admin/mod-visual-styles/${id}` - Archive style

## State Management

### Local State (Main Component)

1. **pceEnabled**: Derived from settings query (computed boolean)

### Local State (StoryThemesSection)

1. **selectedTheme**: Current theme
2. **isCreating**: Create mode
3. **form**: Theme form state

### Local State (VisualStylesSection)

1. **selectedStyle**: Current style
2. **isCreating**: Create mode
3. **form**: Style form state

## Key Functions & Handlers

**Main Component**:
- PCE toggle handler (updates flag)

**Sub-Components**:
- Standard CRUD handlers (select, create, save, archive)

## Styling & Theming

Tabbed interface with two-column layout for catalog management.

## Testing Considerations

- PCE toggle functionality
- Story themes CRUD
- Visual styles CRUD
- Archive operations
- Form validation
- Required field handling

## Known Issues & Technical Debt

- **Large Component**: 638 lines - could extract sub-components to separate files
- **Code Duplication**: StoryThemesSection and VisualStylesSection very similar
  - **Fix**: Extract shared CRUD logic to hook or shared component
  - **Status**: Medium priority

- **PCE Flag Logic Duplication**: Similar logic in DevToolsPage
  - **Fix**: Extract to shared hook
  - **Status**: Low priority

## Maintenance Guidelines

- Update form validation if catalog structure changes
- Add new catalog types by adding new tab and section
- Update API endpoints if structure changes
- Consider extracting shared CRUD logic if more catalog types added
