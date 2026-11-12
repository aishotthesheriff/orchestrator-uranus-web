# ImagePromptsTab Documentation

## Component Overview

**Purpose**: Management interface for image prompt templates used in AI image generation. Provides editing for the shared visual style prompt and full CRUD for individual image prompt templates with testing capability.

**User Flow**:
1. Edit visual style prompt (shared across all image generation)
2. Browse image prompt templates in left panel
3. Select template or create new
4. Configure template (prompt, size, quality, scene types, tags)
5. Test image generation with selected template
6. Save changes

**Key Features**:
- Visual style prompt management (shared)
- Image prompt template CRUD
- Template variable support ({{CURRENT_NARRATIVE}}, etc.)
- Image size and quality configuration
- Inherit visual style toggle
- Test image generation modal
- Scene types and tags

## Architecture Review

### Component Dependencies

- **ImageTestModal**: Testing interface for image generation
- **Card Components**: Multi-card layout
- **Select**: Size and quality dropdowns
- **ScrollArea**: Template list

### State Management Patterns

- **Local State**: Visual style content, selected template, form state, test modal state
- **Server State**: Prompts list, image prompts list via React Query
- **Mutations**: Update visual style prompt, create/update image prompts

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear separation of visual style and templates
- Good form structure
- Testing integration
- Variable documentation

**Areas for Improvement**:
- Large component (481 lines)
- Could extract visual style section
- Template variable validation could be improved

## API Calls

### Asynchronous API Calls

**1. Prompts Query**
- **Hook**: `useQuery<PromptTemplate[]>`
- **Query Key**: `['api', 'admin', 'prompt_templates']`
- **Purpose**: Fetch prompts to find visual_style_prompt
- **Line**: 33-35

**2. Image Prompts Query**
- **Hook**: `useQuery<ImagePrompt[]>`
- **Query Key**: `['api', 'admin', 'image_prompts']`
- **Purpose**: Fetch all image prompt templates
- **Line**: 36-38

### Mutations, Hooks, and Actions

**1. Update Prompt Mutation** (Visual Style)
- **Endpoint**: `PUT /api/admin/prompt_templates/${id}`
- **Purpose**: Update visual_style_prompt
- **Triggered By**: Save Visual Style button
- **Line**: 54-86

**2. Create Image Prompt Mutation**
- **Endpoint**: `POST /api/admin/image_prompts`
- **Purpose**: Create new image prompt template
- **Line**: 88-109

**3. Update Image Prompt Mutation**
- **Endpoint**: `PUT /api/admin/image_prompts/${id}`
- **Purpose**: Update existing template
- **Line**: 111-129

**Action Handlers**:

1. **handleSelectImagePrompt** (Line 131-145): Loads template into form
2. **handleCreateNewImagePrompt** (Line 147-151): Initializes create mode
3. **handleSaveImagePrompt** (Line 153-162): Saves template
4. **handleSaveVisualStyle** (Line 164-181): Saves visual style prompt

**Side Effects (useEffect)**:

1. **Visual Style Content Sync** (Line 47-52): Loads visual style prompt content
   - Finds visual_style_prompt in prompts list
   - Sets visualStyleContent state
   - Dependency: prompts data

## Dependencies

### React Hooks

- `useState`: 5 instances (visual style, selected template, is creating, form, test modal)
- `useEffect`: 1 instance (visual style sync)

### API Endpoints

1. `GET /api/admin/prompt_templates` - Fetch prompts
2. `GET /api/admin/image_prompts` - Fetch image prompts
3. `PUT /api/admin/prompt_templates/${id}` - Update visual style
4. `POST /api/admin/image_prompts` - Create template
5. `PUT /api/admin/image_prompts/${id}` - Update template

### Component Dependencies

- `ImageTestModal`: Image generation testing
- UI components from shadcn/ui

## State Management

### Local State

1. **visualStyleContent**: Shared visual style prompt content
2. **selectedImagePrompt**: Currently selected template
3. **isCreatingImagePrompt**: Create mode flag
4. **imagePromptForm**: Template form state
5. **testImagePrompt**: Template being tested
6. **showTestModal**: Test modal visibility

## Key Functions & Handlers

- **handleSelectImagePrompt**: Loads template data
- **handleCreateNewImagePrompt**: Starts create mode
- **handleSaveImagePrompt**: Persists template
- **handleSaveVisualStyle**: Saves visual style prompt

## Styling & Theming

Multi-section layout with visual style card and two-column template management.

## Testing Considerations

- Visual style editing
- Template CRUD operations
- Test modal functionality
- Template variable handling
- Size/quality selection
- Visual style inheritance toggle

## Known Issues & Technical Debt

- **Large Component**: 481 lines - could be split
- **No Variable Validation**: Template variables not validated before save
- **Visual Style Extraction**: Could extract visual style section to component

## Maintenance Guidelines

- Add variable validation if new variables added
- Update template structure if API changes
- Consider extracting visual style to separate component
- Update test modal if image generation API changes
