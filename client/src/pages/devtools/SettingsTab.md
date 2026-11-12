# SettingsTab Documentation

## Component Overview

**Purpose**: Management interface for application settings (key-value pairs stored in database). Provides quick access to common settings (image cache) and full CRUD for all settings.

**User Flow**:
1. View all settings in top section
2. Quick edit image cache settings
3. Select setting from left panel or create new
4. Edit setting details in right panel
5. Save changes

**Key Features**:
- Quick access to image cache settings
- Full settings list display
- Create/edit/update settings
- Key-value pair management
- Active/inactive toggle
- Description field support

## Architecture Review

### Component Dependencies

- **ScrollArea**: Scrollable settings list
- **Textarea**: Value editing (supports JSON)
- **Input**: Key and number inputs
- **Card Components**: Multi-card layout

### State Management Patterns

- **Local State**: Selected setting, form state, create mode, quick settings
- **Server State**: Settings list via React Query
- **Mutations**: Upsert setting

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Quick settings for common use cases
- Full CRUD operations
- Supports JSON values
- Good form validation

**Areas for Improvement**:
- Large component (401 lines)
- Quick settings duplication with form
- Could extract quick settings section

## API Calls

### Asynchronous API Calls

**1. Settings Query**
- **Hook**: `useQuery<AppSetting[]>`
- **Query Key**: `['api', 'settings']`
- **Endpoint**: `GET /api/settings`
- **Line**: 20-26

### Mutations, Hooks, and Actions

**1. Upsert Setting Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `PUT /api/settings/${key}` (URL encoded)
- **Payload**: `{ value, description?, active? }`
- **Purpose**: Create or update setting
- **Success**: Refetches settings, shows toast
- **Triggered By**: Save button (quick or form)
- **Line**: 67-97

**Action Handlers**:

1. **handleCreateNewSetting** (Line 108-112): Initializes create form
2. **handleSelectSetting** (Line 114-123): Loads setting into form
3. **handleSaveSetting** (Line 125-155): Validates and saves setting

**Side Effects (useEffect)**:

1. **Quick Settings Sync** (Line 39-49): Syncs quick settings state from API
   - Watches `image_cache_retention_days` and `image_cache_min_access_count`
   - Updates local state when settings load

2. **Form State Sync** (Line 51-65): Syncs form when selected setting changes
   - Watches selectedSettingKey and settings data
   - Loads setting data into form

## Dependencies

### React Hooks

- `useState`: 5 instances (retention days, min access count, selected key, is creating, form state)
- `useEffect`: 2 instances (quick settings sync, form sync)
- `useMemo`: None

### API Endpoints

1. `GET /api/settings` - Fetch all settings
2. `PUT /api/settings/${key}` - Upsert setting

## State Management

### Local State

1. **imageCacheRetentionDays**: Quick setting value
2. **imageCacheMinAccessCount**: Quick setting value
3. **selectedSettingKey**: Currently selected setting key
4. **isCreatingSetting**: Create mode flag
5. **settingForm**: Form state (key, value, description, active)

### Server State

- **settings**: All application settings

## Key Functions & Handlers

- **handleCreateNewSetting**: Starts create mode
- **handleSelectSetting**: Loads setting data
- **handleSaveSetting**: Persists changes with validation

## Styling & Theming

Multi-card layout with quick settings section and full CRUD interface.

## Testing Considerations

- Quick settings updates
- Create new setting
- Edit existing setting
- Key validation (required, immutable when editing)
- JSON value handling
- Active toggle

## Known Issues & Technical Debt

- **Quick Settings Duplication**: Similar logic in quick settings and form
  - **Fix**: Extract to shared handler
  - **Status**: Low priority

- **No Delete**: Settings can only be deactivated, not deleted
  - **Consideration**: May be intentional design

## Maintenance Guidelines

- Update quick settings if new common settings added
- Add delete functionality if needed
- Update form validation if setting structure changes
- Consider JSON schema validation for JSON values
