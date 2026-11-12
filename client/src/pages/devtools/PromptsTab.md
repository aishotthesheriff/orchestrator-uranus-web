# PromptsTab Documentation

## Component Overview

**Purpose**: Management interface for editing prompt templates used by the AI system. Provides two-column layout for browsing and editing prompt content, system prompts, and visual style prompts.

**User Flow**:
1. User selects prompt template from left panel
2. Prompt content loads in right panel
3. User edits prompt content (user prompt, system prompt)
4. Optionally toggles "Inherit Global System Prompt"
5. Saves changes

**Key Features**:
- Browse all prompt templates (except visual_style_prompt)
- Edit user prompts and system prompts
- Toggle global system prompt inheritance
- Special handling for visual_style_prompt
- Version and active status display

## Architecture Review

### Component Dependencies

- **ScrollArea**: Scrollable prompt list
- **Textarea**: Multi-line prompt editing
- **Checkbox**: Inheritance toggle
- **Card Components**: Two-column layout
- **Button**: Save actions

### State Management Patterns

- **Local State**: Selected prompt, edited content, inheritance flag
- **Server State**: Prompts list via React Query
- **Mutations**: Update prompt template

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear two-column layout
- Good separation of visual_style_prompt logic
- Proper form state management
- Loading states handled

**Areas for Improvement**:
- Large component (222 lines)
- Visual style prompt special case could be extracted
- No create/delete functionality (only edit)

## API Calls

### Synchronous API Calls

None.

### Asynchronous API Calls

**1. Prompts Query**
- **Hook**: `useQuery<PromptTemplate[]>`
- **Query Key**: `['api', 'admin', 'prompt_templates']`
- **Endpoint**: `GET /api/admin/prompt_templates`
- **Purpose**: Fetch all prompt templates
- **Line**: 17-19

### Mutations, Hooks, and Actions

**1. Update Prompt Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `PUT /api/admin/prompt_templates/${id}`
- **Payload**: `{ content, systemContent, inheritGlobalPrompt }`
- **Purpose**: Update prompt template
- **Success**: Invalidates query, shows toast
- **Error**: Shows error toast
- **Triggered By**: Save button click
- **Line**: 27-59

**Action Handlers**:

1. **handleSelectPrompt** (Line 61-66): Loads prompt into form state
2. **handleSavePrompt** (Line 68-79): Validates and saves prompt changes

**Side Effects**: None (useEffect hooks not used)

## Dependencies

### React Hooks

- `useState`: 4 instances (selected prompt, edited content, system content, inheritance)

### API Endpoints

1. `GET /api/admin/prompt_templates` - Fetch prompts
2. `PUT /api/admin/prompt_templates/${id}` - Update prompt

### Component Dependencies

- UI components from shadcn/ui
- Icons from lucide-react

## State Management

### Local State

1. **selectedPrompt**: Currently selected prompt template
2. **editedContent**: User prompt content being edited
3. **editedSystemContent**: System prompt content being edited
4. **inheritGlobalPrompt**: Boolean flag (1/0) for inheritance

## Key Functions & Handlers

- **handleSelectPrompt**: Loads prompt data into form
- **handleSavePrompt**: Saves prompt changes

## Styling & Theming

Two-column grid layout with scrollable list and fixed-height textareas.

## Testing Considerations

- Prompt selection
- Content editing
- Inheritance toggle
- Save functionality
- Visual style prompt special case

## Known Issues & Technical Debt

- No create/delete operations
- Special case for visual_style_prompt (line 137)
- Large textareas could use better UX

## Maintenance Guidelines

- Update API endpoints if structure changes
- Add create/delete if needed
- Consider extracting visual style prompt to separate component
