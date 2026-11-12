# ItemsTab Documentation

## Component Overview

**Purpose**: Full CRUD interface for managing game items (equipment, tools, bonuses). Provides create, read, update functionality for items with skill bonuses, scene effects, icons, and tags.

**User Flow**:
1. Browse items in left panel or create new
2. Select item or click "New Item"
3. Fill form with item details
4. Save changes

**Key Features**:
- Create/edit items
- Skill bonus configuration (JSON)
- Scene effect configuration (JSON)
- Icon and tags
- Active/inactive toggle

## Architecture Review

Similar pattern to EventsTab and NpcsTab.

## Engineering Review

**Strengths**:
- Full CRUD operations
- JSON field handling
- Clear form structure

**Areas for Improvement**:
- JSON parsing without error handling (line 106-107)
- Large component (282 lines)

## API Calls

### Asynchronous API Calls

**1. Items Query**
- **Hook**: `useQuery<Item[]>`
- **Query Key**: `['api', 'admin', 'items']`
- **Endpoint**: `GET /api/admin/items`

### Mutations, Hooks, and Actions

**1. Create Item Mutation**
- **Endpoint**: `POST /api/admin/items`
- **Payload**: Item data with parsed JSON

**2. Update Item Mutation**
- **Endpoint**: `PUT /api/admin/items/${id}`
- **Payload**: Updated item data

**Action Handlers**:
- **handleSelectItem**: Loads item, stringifies JSON fields
- **handleCreateNewItem**: Initializes form
- **handleSaveItem**: Parses JSON before saving

## Dependencies

Same pattern as EventsTab.

## State Management

1. **selectedItem**: Current item
2. **isCreatingItem**: Create mode
3. **itemForm**: Form state

## Key Functions & Handlers

- **handleSelectItem**: Converts JSON to strings for editing
- **handleSaveItem**: Parses JSON strings before saving

## Testing Considerations

- JSON field parsing/stringification
- Create/edit flows
- Form validation

## Known Issues & Technical Debt

- **JSON Parsing Error Risk** (Line 106-107): No try-catch around JSON.parse
  - **Fix**: Add error handling for invalid JSON
  - **Impact**: Could crash on invalid JSON input

## Maintenance Guidelines

- Add JSON validation before parsing
- Update form if item structure changes
- Add delete functionality if needed
