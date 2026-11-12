# NpcsTab Documentation

## Component Overview

**Purpose**: Full CRUD interface for managing NPC (Non-Player Character) templates. Provides create, read, update functionality for recurring characters with personality, quirks, roles, and icons.

**User Flow**:
1. Browse NPCs in left panel or create new
2. Select NPC or click "New NPC"
3. Fill form with NPC details
4. Save changes

**Key Features**:
- Create/edit NPC templates
- Personality and quirk descriptions
- Role assignment
- Icon and tags
- Active/inactive toggle

## Architecture Review

Similar pattern to EventsTab and ItemsTab with simpler data structure (no JSON fields).

## Engineering Review

**Strengths**:
- Full CRUD operations
- Simple, clean form
- Good validation

**Areas for Improvement**:
- Large component (273 lines)
- Could extract form component

## API Calls

### Asynchronous API Calls

**1. NPCs Query**
- **Hook**: `useQuery<NpcTemplate[]>`
- **Query Key**: `['api', 'admin', 'npc_templates']`
- **Endpoint**: `GET /api/admin/npc_templates`

### Mutations, Hooks, and Actions

**1. Create NPC Mutation**
- **Endpoint**: `POST /api/admin/npc_templates`

**2. Update NPC Mutation**
- **Endpoint**: `PUT /api/admin/npc_templates/${id}`

**Action Handlers**:
- **handleSelectNpc**: Loads NPC data
- **handleCreateNewNpc**: Starts create mode
- **handleSaveNpc**: Persists changes

## Dependencies

Same pattern as other CRUD tabs.

## State Management

1. **selectedNpc**: Current NPC
2. **isCreatingNpc**: Create mode
3. **npcForm**: Form state

## Key Functions & Handlers

Standard CRUD handlers.

## Testing Considerations

- Create/edit flows
- Form field validation
- Active toggle

## Known Issues & Technical Debt

None significant - well-structured component.

## Maintenance Guidelines

- Update form if NPC structure changes
- Add delete functionality if needed
- Consider form component extraction
