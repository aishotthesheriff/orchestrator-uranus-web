# CacheManagementPage Documentation

## Page Overview

**Purpose**: Admin interface for managing generated image cache. Provides overview statistics, image browsing, analytics, and cache management controls. Part of dev tools ecosystem.

**User Flow**:
1. User navigates to `/dev-tools/cache`
2. Views cache statistics (total images, storage, hit rate)
3. Browses cached images with filters
4. Can delete individual or bulk images
5. Exports cache metadata
6. Views analytics

**Key Features**:
- Cache statistics dashboard
- Image browsing with search/filter
- Bulk operations (select all, delete selected)
- Analytics (template usage, access patterns)
- Metadata export
- Image detail modal

## Architecture Review

### Component Dependencies

- **Card Components**: UI cards for statistics and content
- **Tabs**: Tabbed interface
- **AlertDialog**: Confirmation dialogs
- **ScrollArea**: Scrollable content areas
- **Select**: Dropdown filters
- **Checkbox**: Selection controls

### State Management

- **Local State**: Search term, template filter, selected images, modal state
- **Server State**: Cache stats, images list (React Query)
- **Mutations**: Clear cache, delete images

### Authentication & Security

- This page is part of DevTools and requires an admin token in the UI.
- API requests use `apiRequest` which includes credentials and attaches CSRF tokens for mutating calls; admin token is sent as `Authorization: Bearer <token>`.

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Comprehensive cache management
- Good filtering/search functionality
- Bulk operations support
- Analytics views

**Areas for Improvement**:
- Large component (598 lines)
- Could extract sub-components (stat cards, image grid)
- Some magic numbers for formatting

## API Calls

### Synchronous API Calls

None.

### Asynchronous API Calls

**1. Cache Statistics Query**
- **Hook**: `useQuery<CacheStats>`
- **Query Key**: `['api', 'cache', 'stats']`
- **Endpoint**: `GET /api/cache/stats`
- **Purpose**: Fetch cache statistics
- **Line**: 74-76

**2. Cached Images Query**
- **Hook**: `useQuery<GeneratedImage[]>`
- **Query Key**: `['api', 'cache', 'images', { templateName: templateFilter }]`
- **Endpoint**: `GET /api/cache/images?templateName={filter}`
- **Purpose**: Fetch cached images list
- **Line**: 79-81

### Mutations, Hooks, and Actions

**1. Clear Cache Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `POST /api/cache/clear`
- **Purpose**: Delete all cached images
- **Success**: Invalidates queries, shows toast, clears selections
- **Triggered By**: "Clear Cache" button in AlertDialog
- **Line**: 93-104

**2. Delete Selected Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `DELETE /api/cache/images/{id}` (multiple)
- **Purpose**: Delete selected images
- **Success**: Invalidates queries, shows toast, clears selections
- **Triggered By**: "Delete Selected" button
- **Line**: 107-121

**Action Handlers**:

1. **handleSelectImage**: Toggle image selection
2. **handleSelectAll**: Select/deselect all filtered images
3. **formatFileSize**: Format bytes to human-readable
4. **formatDate**: Format dates for display

## Dependencies

### React Hooks

- `useState`: 4 instances (search, filter, selections, modal)
- `useQuery`, `useMutation`: React Query
- `useToast`: Toast notifications

### API Endpoints

1. `GET /api/cache/stats` - Statistics
2. `GET /api/cache/images` - Images list
3. `POST /api/cache/clear` - Clear all
4. `DELETE /api/cache/images/{id}` - Delete image

### Component Dependencies

- UI components from shadcn/ui
- Icons from lucide-react

## State Management

### Local State

1. **searchTerm**: Search input value
2. **templateFilter**: Template filter selection
3. **selectedImages**: Set of selected image IDs
4. **showImageModal**: Currently viewed image

### Server State

- **stats**: Cache statistics
- **images**: Cached images array

## Key Functions & Handlers

See Action Handlers section above.

## Styling & Theming

Standard shadcn/ui styling with card-based layout, responsive grids.

## Testing Considerations

- Statistics calculation
- Search/filter functionality
- Selection logic
- Bulk operations
- Modal interactions
- Error handling

## Known Issues & Technical Debt

- Large component size
- Could extract stat cards component
- Magic numbers in formatting functions

## Maintenance Guidelines

- Add new filter types by extending Select
- Add analytics by adding new queries
- Modify export format if needed
