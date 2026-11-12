# EventsTab Documentation

## Component Overview

**Purpose**: Full CRUD interface for managing procedural events (random encounters/triggers) in the game. Provides create, read, update functionality for events with skill checks, DCs, segments, and trigger conditions.

**User Flow**:
1. Browse events in left panel or create new
2. Select event or click "New Event"
3. Fill form with event details (name, segment, skill, DC, triggers, effects)
4. Save changes

**Key Features**:
- Create new events
- Edit existing events
- Configure trigger conditions (JSON)
- Set pass/fail effects
- Segment and skill selection
- Active/inactive toggle

## Architecture Review

Similar to ItemsTab and NpcsTab with CRUD operations.

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Full CRUD support
- Good form validation
- JSON trigger condition handling
- Clear form structure

**Areas for Improvement**:
- JSON editing without validation
- Large component (331 lines)
- Could extract form to separate component

## API Calls

### Asynchronous API Calls

**1. Events Query**
- **Hook**: `useQuery<Event[]>`
- **Query Key**: `['api', 'admin', 'events']`
- **Endpoint**: `GET /api/admin/events`

### Mutations, Hooks, and Actions

**1. Create Event Mutation**
- **Endpoint**: `POST /api/admin/events`
- **Payload**: Event form data
- **Success**: Invalidates query, resets form

**2. Update Event Mutation**
- **Endpoint**: `PUT /api/admin/events/${id}`
- **Payload**: Updated event data
- **Success**: Invalidates query

**Action Handlers**:
- **handleSelectEvent**: Loads event into form
- **handleCreateNewEvent**: Initializes create form
- **handleSaveEvent**: Saves new or updates existing

## Dependencies

### React Hooks

- `useState`: 3 instances (selected event, is creating, form state)

### API Endpoints

1. `GET /api/admin/events` - List events
2. `POST /api/admin/events` - Create event
3. `PUT /api/admin/events/${id}` - Update event

## State Management

### Local State

1. **selectedEvent**: Currently selected event
2. **isCreatingEvent**: Create mode flag
3. **eventForm**: Form state with all event fields

## Key Functions & Handlers

- **handleSelectEvent**: Loads event data
- **handleCreateNewEvent**: Starts create mode
- **handleSaveEvent**: Persists changes

## Testing Considerations

- Create event flow
- Edit event flow
- Form validation
- JSON trigger condition handling
- Active toggle

## Known Issues & Technical Debt

- JSON trigger condition editing without validation
- Large component size
- Could benefit from form validation library

## Maintenance Guidelines

- Update form fields if event structure changes
- Add delete functionality if needed
- Validate JSON trigger conditions before save
