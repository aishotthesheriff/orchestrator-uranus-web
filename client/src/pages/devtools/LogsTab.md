# LogsTab Documentation

## Component Overview

**Purpose**: View and manage LLM (Large Language Model) interaction logs. Displays all prompts sent to GPT-4o-mini and their responses with filtering, copy functionality, and log clearing.

**User Flow**:
1. View logs list (filtered or all)
2. Filter by function name, prompt, or response text
3. Copy prompt or response to clipboard
4. Optionally clear all logs

**Key Features**:
- Display all LLM logs
- Real-time filtering
- Copy to clipboard for prompts/responses
- Clear all logs with confirmation
- Execution time display
- Metadata viewing

## Architecture Review

### Component Dependencies

- **ScrollArea**: Scrollable log list
- **Card**: Individual log display
- **Badge**: Function name and metadata badges
- **AlertDialog**: Confirmation for clearing

### State Management Patterns

- **Local State**: Filter text, copied items tracking
- **Server State**: Logs list via React Query
- **Mutations**: Clear logs

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Good filtering with useMemo optimization
- Copy functionality with visual feedback
- Confirmation dialog for destructive actions
- Clear log organization

**Areas for Improvement**:
- Large component (231 lines)
- Could add pagination for many logs
- Filter debouncing could improve performance

## API Calls

### Asynchronous API Calls

**1. Logs Query**
- **Hook**: `useQuery<LlmLog[]>`
- **Query Key**: `['api', 'llm-logs']`
- **Endpoint**: `GET /api/llm-logs`
- **Line**: 28-30

### Mutations, Hooks, and Actions

**1. Clear Logs Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `DELETE /api/llm-logs`
- **Purpose**: Delete all logs
- **Success**: Invalidates query, shows toast
- **Triggered By**: Confirmation dialog
- **Line**: 36-54

**Action Handlers**:

1. **handleCopy** (Line 74-97): Copies text to clipboard with visual feedback
   - Uses navigator.clipboard API
   - Tracks copied state for 2 seconds
   - Shows success/error toast

**Side Effects**: None (useEffect not used)

**Derived State**:

1. **filteredLogs** (Line 56-72): useMemo filtered logs based on search text
   - Filters by functionName, prompt, or response
   - Case-insensitive matching

## Dependencies

### React Hooks

- `useState`: 2 instances (filter, copied items)
- `useMemo`: Filtered logs calculation

### API Endpoints

1. `GET /api/llm-logs` - Fetch logs
2. `DELETE /api/llm-logs` - Clear all logs

### Component Dependencies

- UI components from shadcn/ui
- Icons from lucide-react

## State Management

### Local State

1. **logFilter**: Search/filter text input
2. **copiedItems**: Set of copied item IDs (for visual feedback)

### Server State

- **logs**: All LLM logs from API

### Derived State

- **filteredLogs**: Memoized filtered log list

## Key Functions & Handlers

- **handleCopy**: Clipboard copy with feedback
- **filteredLogs**: Memoized filtering logic

## Styling & Theming

Card-based log display with badges, monospace font for code, scrollable area.

## Testing Considerations

- Filter functionality
- Copy to clipboard
- Clear logs confirmation
- Log display rendering
- Execution time display
- Metadata rendering

## Known Issues & Technical Debt

- **No Filter Debouncing**: Filter fires on every keystroke
  - **Fix**: Add debounce hook (300-500ms)
  - **Impact**: Performance with large log lists

- **No Pagination**: All logs loaded at once
  - **Fix**: Implement virtual scrolling or pagination
  - **Impact**: Performance with many logs

## Maintenance Guidelines

- Add pagination if log volume grows
- Consider log export functionality
- Add advanced filtering options
- Update filter logic if log structure changes
