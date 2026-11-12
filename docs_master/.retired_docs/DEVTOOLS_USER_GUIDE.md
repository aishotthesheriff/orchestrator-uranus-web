# Quest to Uranus: DevTools User Guide

## Overview

The Developer Tools interface provides comprehensive administrative capabilities for managing all aspects of the Quest to Uranus game system. This centralized interface allows developers, content creators, and administrators to manage prompts, events, items, NPCs, image generation, system configuration, and analyze AI interactions.

### Target Audience

- **Content Creators**: Manage prompts, events, items, NPCs, and image generation templates
- **Developers**: Configure system settings, manage image models, and analyze LLM logs
- **Administrators**: Publish reference releases, manage application settings, and monitor system performance

### Access Requirements

The DevTools interface requires administrative authentication via an admin access token. This token must be configured separately and provides access to all administrative functions.

## Authentication

### Accessing DevTools

1. Navigate to `/dev-tools` in the application
2. If not authenticated, you'll see the **Admin Access Required** screen
3. Enter your administrator access token in the password field
4. Click **Unlock Developer Tools** to authenticate

### Admin Token Management

- **Entering Token**: Type your admin token in the password-protected input field and submit
- **Clearing Token**: Use the **Clear** button on the auth screen or **Log out** button when authenticated
- **Security**: The token is stored locally and persists across sessions until explicitly cleared
- **Token Validation**: Invalid tokens will display an error message

### Status Indicators

When authenticated, the DevTools header displays:

- **PCE Enabled**: Shows whether the Prompt Composition Engine is currently enabled (Yes/No)
- **Last LLM mode**: Displays the most recent LLM execution mode from the logs
- **Defaults**: Shows the current default theme and visual style from the PCE catalog

These indicators provide quick insight into the current system configuration without navigating to specific tabs.

## Navigation

The DevTools interface uses a tabbed navigation system with 13 main sections:

1. **Prompts** - Manage AI prompt templates
2. **Events** - Create and configure procedural events
3. **Items** - Manage crew equipment and bonuses
4. **NPCs** - Create and edit NPC templates
5. **Image Prompts** - Configure image generation templates
6. **Image Models** - Manage image generation model configurations
7. **PCE** - Configure Prompt Composition Engine catalogs
8. **PCE Tester** - Test prompt composition with live context
9. **Interview** - Interview question information
10. **Reference** - Publish and manage reference releases
11. **LLM Logs** - View all AI interaction logs
12. **Image Cache** - Access cache management interface
13. **Settings** - Configure application-wide settings

## Common Patterns

Before diving into individual tabs, understanding these common patterns will help you use DevTools effectively:

### Two-Column Layout
Most tabs use a split-pane interface:
- **Left Panel**: List of existing items with metadata
- **Right Panel**: Editor form for creating or editing selected items
- Click any item in the list to load it into the editor

### Active/Inactive Toggle
Many content types have an **Active** checkbox:
- **Active**: The item is available for use in games
- **Inactive**: The item is archived but preserved for reference
- Use this to disable content without deleting it

### JSON Field Formatting
Several fields require valid JSON format:
- Trigger conditions (Events)
- Skill bonuses (Items)
- Scene effects (Items)
- The editor validates JSON structure on save
- Use proper formatting with quotes, brackets, and commas

### Variable Substitution
Prompts support template variables using `{{VARIABLE_NAME}}` syntax:
- Variables are replaced at runtime with actual game state values
- Use double curly braces: `{{SEGMENT}}`, `{{DAY}}`, `{{HULL}}`
- See the Reference section for available variables

### Save/Cancel Workflows
- **Save Changes**: Commits edits to the database immediately
- Changes are visible across all active game sessions
- No automatic draft saving - ensure you save before navigating away
- Some tabs support "Save As" functionality for creating copies

---

## Tab Documentation

### 1. Prompts Tab

The Prompts tab manages AI prompt templates that control narrative generation, character interactions, and scene descriptions.

#### Purpose
- Edit existing prompt templates used by the AI during gameplay
- Configure system prompts that define AI behavior and tone
- Manage user prompts that guide narrative progression
- Control prompt versioning and inheritance

#### Key Features

**Prompt List**:
- Displays all available prompt templates (excludes `visual_style_prompt` which is managed in Image Prompts)
- Shows version number, active status, and description
- Click any prompt to load it for editing

**Editing Interface**:
- **System Prompt**: Custom instructions for the AI (optional, see inheritance below)
- **User Prompt**: Main narrative generation prompt with variable support
- **Inherit Global System Prompt**: Toggle to extend or override global prompts

#### System Prompt Inheritance

When editing prompts (except `global_system_prompt`), you can control system prompt inheritance:

- **Inherit Global** (checked): Your custom system prompt **extends** the global system prompt
  - Use this to add scenario-specific instructions
  - The AI receives both global + custom instructions
  - Example: Global sets tone, custom adds segment-specific rules

- **Inherit Global** (unchecked): Your custom system prompt **completely replaces** the global
  - Use this for prompts that need entirely different behavior
  - The AI only receives your custom system prompt
  - Example: Special event prompts with unique narration styles

#### Variable Syntax

Prompts support dynamic variable substitution:

```
The crew has traveled {{DAYS}} days from Earth.
Current hull integrity: {{HULL}}%
{{CURRENT_NARRATIVE}}
```

Common variables include:
- `{{CURRENT_NARRATIVE}}` - Current story state
- `{{SEGMENT}}` - Journey segment name
- `{{DAY}}` - Days elapsed
- `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}` - Resource levels
- `{{PLAYER_ACTION}}` - Last player action
- See Reference section for complete variable list

#### Workflow: Editing a Prompt

1. Select a prompt from the left list
2. Review current content in the editor
3. Modify System Prompt (if applicable) and/or User Prompt
4. Adjust inheritance setting if needed
5. Click **Save Changes**
6. Success notification confirms the update

#### Best Practices

- Test prompt changes in a development environment first
- Use variable substitution to keep prompts dynamic
- Document custom prompts with clear descriptions
- Avoid hardcoding values that should be variables
- Keep system prompts concise and focused

---

### 2. Events Tab

The Events tab manages procedural events that occur during gameplay, triggered by conditions such as journey segments, player actions, or resource levels.

#### Purpose
- Create dynamic events that enhance gameplay variety
- Configure trigger conditions that determine when events occur
- Define pass/fail outcomes based on skill checks
- Tag events for organization and filtering

#### Key Features

**Event Creation**:
- Click **New Event** to create a new procedural event
- Left panel lists all existing events with metadata
- Events show segment, skill, difficulty class, and active status

**Event Configuration**:
- **Name**: Descriptive event identifier
- **Segment**: Journey phase when event can occur
- **Skill**: Required skill for the check (e.g., Engineering, Science)
- **Difficulty Class (DC)**: Challenge rating (1-30)
- **Trigger Condition**: JSON object defining when event fires
- **Pass Effect**: Outcome when crew succeeds the check
- **Fail Effect**: Outcome when crew fails the check
- **Tags**: Comma-separated labels for organization

#### Available Segments

- `DepartureEarth` - Launch from Earth
- `Moon` - Moon Flyby
- `Mars` - Earth to Mars
- `Belt` - Asteroid Belt
- `JupiterSaturn` - Jupiter to Saturn
- `OuterDarkness` - Outer Darkness
- `NearUranus` - Approaching Uranus
- `ArrivalUranus` - Arrival on Uranus
- `Lost` - Lost in space
- `Any` - Can occur in any segment

#### Available Skills

- Leadership
- Science
- Engineering
- Navigation
- Diplomacy
- Morale
- Combat

#### Trigger Condition Format

Trigger conditions use JSON to define when events activate:

```json
{
  "type": "onSegment",
  "value": "Moon Flyby"
}
```

```json
{
  "type": "onResourceLow",
  "resource": "hull",
  "threshold": 25
}
```

The trigger system evaluates these conditions during gameplay to determine event eligibility.

#### Pass/Fail Effects

- **Pass Effect**: Narrative description shown when crew succeeds
- **Fail Effect**: Narrative description shown when crew fails
- These can reference resources, modify game state, or trigger other events
- Use descriptive text that enhances the narrative

#### Workflow: Creating an Event

1. Click **New Event** button
2. Enter event name (e.g., "Asteroid Collision")
3. Select segment and skill from dropdowns
4. Set difficulty class (typically 10-20 for balanced gameplay)
5. Write JSON trigger condition
6. Write pass and fail effect descriptions
7. Add tags for organization (optional)
8. Set Active checkbox
9. Click **Save Changes**

#### Best Practices

- Use meaningful event names that clearly describe what happens
- Balance DC values: too high frustrates players, too low is trivial
- Write engaging pass/fail effects that enhance immersion
- Test trigger conditions with various game states
- Use tags consistently (e.g., "critical", "exploration", "combat")
- Archive unused events rather than deleting (set Active to false)

---

### 3. Items Tab

The Items tab manages crew equipment and items that provide skill bonuses and scene effects during gameplay.

#### Purpose
- Create items that enhance crew capabilities
- Define skill bonuses provided by equipment
- Configure scene effects that modify narrative or gameplay
- Manage item metadata (icons, descriptions, tags)

#### Key Features

**Item Management**:
- **Name**: Item identifier
- **Description**: Flavor text explaining the item
- **Icon**: Emoji or icon identifier for display
- **Skill Bonus**: JSON object mapping skills to bonus values
- **Scene Effect**: JSON object defining narrative/gameplay modifications
- **Tags**: Comma-separated organizational labels
- **Active**: Enable/disable item availability

#### Skill Bonus Format

Skill bonuses use JSON to map skill names to numeric bonuses:

```json
{
  "Engineering": 2,
  "Navigation": 1
}
```

This example gives +2 to Engineering checks and +1 to Navigation checks when the item is equipped.

**Available Skills**: Leadership, Science, Engineering, Navigation, Diplomacy, Morale, Combat

#### Scene Effect Format

Scene effects use JSON to modify narrative or gameplay:

```json
{
  "type": "boost",
  "value": "Provides extra oxygen reserves",
  "resource": "oxygen",
  "modifier": 5
}
```

Common effect types:
- `boost` - Positive narrative/gameplay modification
- `penalty` - Negative modification (rare for items)
- `narrative` - Custom narrative text injection

#### Workflow: Creating an Item

1. Click **New Item** button
2. Enter item name (e.g., "Quantum Toolkit")
3. Write description explaining item purpose
4. Set icon (emoji or icon path)
5. Define skill bonuses in JSON format
6. Define scene effects in JSON format (optional)
7. Add tags for organization
8. Set Active checkbox
9. Click **Save Changes**

#### Best Practices

- Balance skill bonuses: +1 to +3 is typical, +5 or more is very powerful
- Write engaging descriptions that fit the game's tone
- Use consistent icon styles (prefer emoji for simplicity)
- Test items in gameplay to ensure balance
- Archive unused items rather than deleting
- Document complex scene effects clearly

---

### 4. NPCs Tab

The NPCs tab manages Non-Player Character templates used to create recurring characters, crew members, and story personalities.

#### Purpose
- Define NPC personalities and traits
- Create templates for recurring characters
- Configure role and contribution to the crew
- Manage character metadata (icons, tags)

#### Key Features

**NPC Template Fields**:
- **Name**: Character name
- **Role**: Position or contribution (e.g., "Chief Engineer", "Science Officer")
- **Personality**: Detailed personality traits and behavior patterns
- **Quirk**: Unique behaviors or eccentricities
- **Icon**: Emoji or icon identifier for display
- **Tags**: Comma-separated labels (e.g., "mentor", "scientist", "comic-relief")
- **Active**: Enable/disable NPC template availability

#### Personality vs Quirk

- **Personality**: Core traits that define the character (serious, optimistic, analytical)
- **Quirk**: Memorable behaviors that make them distinctive (talks to plants, counts everything, always has a coffee)

Both fields are combined when the AI generates NPC interactions and dialogue.

#### Workflow: Creating an NPC

1. Click **New NPC** button
2. Enter NPC name (e.g., "Captain Mira")
3. Define role in the crew
4. Write personality description (2-3 sentences)
5. Write quirk description (1-2 sentences)
6. Set icon (emoji works well for characters)
7. Add tags for categorization
8. Set Active checkbox
9. Click **Save Changes**

#### Best Practices

- Create distinct personalities to avoid character overlap
- Balance serious and quirky traits for variety
- Use roles that complement gameplay (each skill should have representation)
- Write personality that guides AI-generated dialogue consistently
- Test NPCs in various scenarios to ensure personality consistency
- Archive unused templates rather than deleting

---

### 5. Image Prompts Tab

The Image Prompts tab manages templates for AI-generated scene images, including visual style configuration and prompt variable substitution.

#### Purpose
- Configure image generation prompt templates
- Manage shared visual style prompt
- Define when and how images are generated
- Test image generation with sample prompts

#### Key Features

**Visual Style Prompt**:
- Global visual style applied to all image prompts that inherit it
- Defines art direction, tone, and aesthetic for generated images
- Managed at the top of the tab (separate from individual image prompt templates)
- Edit and save independently from other prompts

**Image Prompt Templates**:
- **Name**: Template identifier
- **Prompt Template**: Text prompt with variable substitution support
- **Inherit Visual Style**: Whether to prepend the global visual style
- **Size**: Image dimensions (1024x1024, 1536x1024, 1024x1536)
- **Quality**: Image quality setting (auto, low, medium, high)
- **Description**: When to use this template
- **Scene Types**: Comma-separated scene categories
- **Tags**: Organizational labels
- **Active**: Enable/disable template

#### Template Variables

Image prompts support the same variables as narrative prompts:

- `{{CURRENT_NARRATIVE}}` - Current story context
- `{{SEGMENT}}` - Journey segment
- `{{DAY}}` - Days elapsed
- `{{HULL}}`, `{{OXYGEN}}`, etc. - Resource levels
- `{{PLAYER_ACTION}}` - Last action taken

#### Image Sizes

- **1024x1024**: Square format (default)
- **1536x1024**: Landscape format
- **1024x1536**: Portrait format

#### Quality Settings

- **Auto**: System determines optimal quality
- **Low**: Faster generation, lower detail
- **Medium**: Balanced quality and speed
- **High**: Maximum quality, slower generation

#### Test Functionality

Each image prompt template has a **Test Generate** button (sparkles icon):
- Opens a test modal where you can preview the generated prompt
- Shows the final prompt with all variables substituted
- Allows manual image generation for testing
- Useful for validating prompt effectiveness before deploying

#### Workflow: Creating an Image Prompt

1. Optionally edit the Visual Style Prompt first (if this template will inherit it)
2. Click **Create New Image Prompt** button
3. Enter template name (e.g., "Current Scene Visualization")
4. Write prompt template with variables: `Visualize: {{CURRENT_NARRATIVE}}`
5. Set image size and quality
6. Check "Inherit Visual Style" if using global style
7. Add description and scene types
8. Add tags for organization
9. Set Active checkbox
10. Click **Save Changes**
11. Use **Test Generate** button to preview and validate

#### Best Practices

- Keep visual style prompt concise but descriptive
- Use variables liberally to keep prompts dynamic
- Test prompts before marking as active
- Document scene types clearly for proper template selection
- Balance image quality with generation speed needs
- Archive unused templates rather than deleting

---

### 6. Image Models Tab

The Image Models tab manages the configuration of AI image generation models, including provider settings, model classes, and default model selection.

#### Purpose
- Configure available image generation models
- Set provider credentials and endpoints
- Define model classes (diffuser, transformer, flux)
- Designate default model for new games

#### Key Features

**Model Configuration**:
- **Model Key**: Unique identifier (immutable after creation)
- **Display Name**: User-friendly name shown in UI
- **Provider**: Service provider (OpenAI, Hugging Face)
- **Model Name**: Actual model identifier for the provider
- **HF Provider**: Optional Hugging Face provider (e.g., "fal-ai")
- **Class**: Model type (diffuser, transformer, flux)
- **Trigger Words**: Comma-separated words that enhance generation
- **Active**: Enable/disable model availability
- **Is Default**: Set as default model for new games

#### Provider Types

- **OpenAI**: Direct OpenAI API integration
- **Hugging Face**: Hugging Face API or inference endpoints

#### Model Classes

- **diffuser**: Diffusion-based models (Stable Diffusion family)
- **transformer**: Transformer-based models (DALL-E, etc.)
- **flux**: Flux model architecture
- **auto**: Determined from model configuration

Model class affects which modifiers are injected during prompt composition (see PCE Tester).

#### Default Model

Only one model can be set as default at a time:
- Default model is used for new game sessions
- Setting a new default automatically clears the previous default
- Existing games continue using their selected model

#### Edit Workflow

- **Edit**: Click **Edit** button to modify existing model (model key cannot change)
- **Save**: Updates the existing model with new values
- **Save As**: If you change the model key while editing, use "Save As" to create a copy
- **Delete**: Remove model from system (confirmation required)
- **Cancel**: Discard changes and exit edit mode

#### Workflow: Creating an Image Model

1. Fill in the form at the top of the tab
2. Enter unique **Model Key** (e.g., "dall-e-3")
3. Enter **Display Name** (e.g., "DALL-E 3")
4. Select **Provider** (OpenAI or Hugging Face)
5. Enter **Model Name** as required by provider
6. Enter **HF Provider** if using Hugging Face (optional)
7. Enter **Class** or leave blank for auto-detection
8. Add **Trigger Words** if applicable (comma-separated)
9. Check **Active** to enable
10. Check **Is Default** to make it the default model
11. Click **Save** to create

#### Best Practices

- Use descriptive model keys that won't conflict
- Test models thoroughly before setting as default
- Document trigger words that work well with each model
- Keep at least one backup model active
- Archive unused models rather than deleting (set Active to false)
- Verify provider credentials before marking as active

---

### 7. PCE Tab

The PCE (Prompt Composition Engine) tab manages the unified prompt generation system, including feature toggling and catalog management for story themes and visual styles.

#### Purpose
- Enable/disable the Prompt Composition Engine feature
- Manage story theme catalog entries
- Manage visual style catalog entries
- Configure default theme and style for new games

#### Key Features

**PCE Enable Toggle**:
- Master switch for Prompt Composition Engine
- When enabled, games use unified JSON turn-generation flow
- Changes require publishing a new reference to take effect
- Displays current state in header

**Story Themes Catalog**:
- Curated narrative templates that define storytelling tone and style
- Used by PCE to compose prompts with consistent themes
- Each theme includes:
  - **Value**: Unique identifier (e.g., "cosmic-noir")
  - **Label**: Display name (e.g., "Cosmic Noir")
  - **Narrator Template**: Instructions for AI narrator behavior
  - **Tags**: Organizational labels
  - **Active**: Enable/disable availability

**Visual Styles Catalog**:
- Art direction presets for generated images
- Used by PCE to inject visual modifiers based on model class
- Each style includes:
  - **Category**: Style category (e.g., "Illustration")
  - **Name**: Unique identifier (e.g., "sci-fi-retro")
  - **Label**: Display name (e.g., "Sci-Fi Retro")
  - **Exemplified By**: Reference description of the style
  - **Diffusion Modifiers**: Modifiers for diffusion-based models
  - **Transformer Modifiers**: Modifiers for transformer-based models
  - **Active**: Enable/disable availability

#### Story Theme Management

**Workflow: Creating a Story Theme**

1. Click **New Theme** button
2. Enter **Value** (unique identifier, lowercase with hyphens)
3. Enter **Label** (display name)
4. Write **Narrator Template** (detailed instructions for AI)
5. Add **Tags** (optional, comma-separated)
6. Set **Active** toggle
7. Click **Save**

The narrator template should define tone, perspective, and narrative style that the AI will follow when using this theme.

#### Visual Style Management

**Workflow: Creating a Visual Style**

1. Click **New Style** button
2. Enter **Category** (e.g., "Illustration", "Photography")
3. Enter **Name** (unique identifier)
4. Enter **Label** (display name)
5. Write **Exemplified By** (detailed style description)
6. Enter **Diffusion Modifiers** (comma-separated for diffusion models)
7. Enter **Transformer Modifiers** (comma-separated for transformer models)
8. Set **Active** toggle
9. Click **Save**

#### Catalog Integration

- Story themes and visual styles from these catalogs appear in:
  - **PCE Tester** tab for testing
  - Game initialization for player selection
  - Runtime prompt composition

#### Best Practices

- Test themes and styles in PCE Tester before activating
- Write clear narrator templates that guide AI behavior
- Provide specific exemplars for visual styles
- Use consistent naming conventions for identifiers
- Archive unused entries rather than deleting
- Document style differences in descriptions

---

### 8. PCE Tester Tab

The PCE Tester tab provides an interactive interface for testing Prompt Composition Engine prompt generation with customizable context and live LLM integration.

#### Purpose
- Preview meta prompts before deployment
- Test prompt composition with various themes and styles
- Simulate game context to validate prompt behavior
- Send test prompts to LLM and inspect responses

#### Key Features

**Selection Panel** (Left Side):
- **Theme**: Select story theme from catalog
- **Visual Style**: Select visual style from catalog
- **Image Model**: Select image generation model
- **Model Class Override**: Force specific model class behavior

**Context Panel** (Left Side):
- **Turn Number**: Current game turn
- **Day**: Days elapsed in journey
- **Segment**: Current journey segment
- **Running Gags**: Ongoing narrative threads
- **Checks**: Skill checks for this turn
- **Active Event**: Current procedural event
- **Player Action**: Last action taken
- **NPC Summary**: Crew member summaries
- **Resources**: Hull, Oxygen, Fuel, Food, Morale (numeric values)
- **Equipped Items**: Currently equipped equipment

**Preview Panel** (Right Side):
- **Meta Prompt**: Complete composed prompt ready for LLM
- **Example Output**: Sample JSON response structure
- **Instructions**: Modifier injection details based on model class
- **LLM Response**: Actual LLM response when testing (optional)

#### Testing Workflow

**1. Build Prompt Only** (Preview without LLM call):
1. Select theme, style, and image model
2. Fill in context fields with test values
3. Click **Build Prompt**
4. Review Meta Prompt tab
5. Check Example Output tab for expected structure
6. Review Instructions tab for modifier details

**2. Build & Send to LLM** (Full test with AI):
1. Configure selections and context as above
2. Click **Build & Send to LLM**
3. Wait for LLM response
4. Review all tabs including LLM Response
5. Inspect parsed JSON structure
6. Validate response matches expectations

#### Preview Tabs

**Meta Prompt Tab**:
- Shows complete prompt with all sections composed
- Includes theme narrator template
- Includes visual style modifiers (based on model class)
- Includes context variables
- Use **Copy** button to copy for external use

**Example Output Tab**:
- Shows expected JSON response structure
- Demonstrates format for validation
- Useful for understanding expected LLM output

**Instructions Tab**:
- Shows which modifiers are injected based on model class
- Displays diffusion modifiers (if model class is diffuser)
- Displays transformer modifiers (if model class is transformer/flux)
- Helps understand how visual styles are applied

**LLM Response Tab** (when testing):
- **Raw JSON**: Complete LLM response as received
- **Parsed**: Formatted JSON structure for inspection
- Validates prompt effectiveness and response quality

#### Model Class Resolution

Model class determines modifier injection:
- **Auto**: Uses class from selected image model
- **Flux**: Injects transformer modifiers
- **Transformer**: Injects transformer modifiers
- **Diffuser**: Injects diffusion modifiers

Resolved class is displayed below the override selector.

#### Best Practices

- Test with realistic context values that match actual gameplay
- Validate meta prompt clarity before deployment
- Check modifier injection for visual styles
- Test multiple theme/style combinations
- Verify LLM response structure matches expectations
- Copy successful prompts for documentation
- Test edge cases (low resources, specific events)

---

### 9. Interview Tab

The Interview tab provides informational content about the interview question system used during game initialization.

#### Purpose
- Explain interview question functionality
- Document how interview responses are used in prompts
- Provide variable naming guidance

#### Key Information

**Interview System**:
- Players answer interview questions when starting a new game
- Responses are stored with the game state
- Responses can be referenced in prompts using variables

**Variable Usage**:
- Interview responses are accessed via `{{INTERVIEW_variableName}}` syntax
- Example: If a question has `variableName` of `captainMotivation`, use `{{INTERVIEW_captainMotivation}}` in prompts
- Variables are case-sensitive

**Current Status**:
- The Interview tab currently shows informational content only
- Full interview question management UI is planned for future release
- Interview questions are managed via API endpoints in the meantime

#### Best Practices

- Document variable names when creating interview questions
- Use consistent naming conventions for variables
- Reference interview responses in prompts to personalize gameplay
- Test interview variable substitution in prompt testing

---

### 10. Reference Tab

The Reference tab manages reference releases, which are snapshots of the current database state (prompts, events, items, NPCs, themes, styles) that can be published and activated as versioned releases.

#### Purpose
- Create versioned snapshots of system configuration
- Publish reference releases from current database state
- Activate specific reference versions for gameplay
- Track release history and metadata

#### Key Features

**Current Active Reference**:
- Displays the reference version currently in use
- Shows version, publisher, publication date, and notes
- Green checkmark indicates active status
- All active games use this reference version

**Publish New Reference**:
- Creates a snapshot of current database state
- Requires version identifier (e.g., "v1.2.0")
- Includes author attribution and release notes
- Optionally activates as current reference immediately
- Includes all prompts, events, items, NPCs, themes, and styles

**All Reference Releases**:
- List of all published reference versions
- Shows version, publisher, date, notes, and current status
- **Activate** button to switch to a different version
- Current version is highlighted with green badge

#### Publishing Workflow

1. Make desired changes to prompts, events, items, NPCs, PCE catalogs
2. Navigate to Reference tab
3. Enter new version identifier (follow semantic versioning if possible)
4. Enter author name (defaults to "dev")
5. Write release notes describing changes
6. Click **Publish & Activate**
7. New reference is created and immediately activated
8. All new games will use this reference version

#### Activation Workflow

1. Navigate to Reference tab
2. Find desired reference version in "All Reference Releases"
3. Click **Activate** button on that version
4. Confirmation message appears
5. That version becomes the current active reference
6. All new games will use the activated version

#### Version Management

- **Version Identifiers**: Use semantic versioning (v1.0.0, v1.1.0, v2.0.0) or descriptive names
- **Release Notes**: Document major changes, additions, or fixes
- **Author Attribution**: Track who published each release
- **Rollback Capability**: Activate previous versions if needed

#### Best Practices

- Publish references after significant content updates
- Use clear version identifiers following a consistent scheme
- Write detailed release notes for future reference
- Test references in development before publishing
- Keep references for rollback purposes
- Document breaking changes in release notes

---

### 11. LLM Logs Tab

The LLM Logs tab provides comprehensive logging and analysis of all AI interactions, including prompts sent to the LLM and responses received.

#### Purpose
- Monitor all AI interactions in real-time
- Debug prompt issues by reviewing actual inputs/outputs
- Analyze LLM performance and response quality
- Copy prompts and responses for external analysis

#### Key Features

**Log Display**:
- Chronological list of all LLM interactions
- Each log entry shows:
  - **Function Name**: Which system function called the LLM
  - **Execution Time**: How long the LLM call took (milliseconds)
  - **Turn Number**: Game turn when this interaction occurred (if applicable)
  - **Timestamp**: When the interaction occurred
  - **Prompt**: Complete prompt sent to LLM
  - **Response**: Complete response received from LLM
  - **Metadata**: Additional context (JSON format)

**Filtering**:
- Search bar filters logs by function name, prompt content, or response content
- Real-time filtering as you type
- Case-insensitive search
- Helps find specific interactions quickly

**Copy Functionality**:
- **Copy** buttons next to prompt and response sections
- Copies full text to clipboard
- Useful for sharing logs or analyzing externally
- Checkmark icon confirms successful copy

**Log Management**:
- **Refresh** button to reload logs (useful for real-time monitoring)
- **Clear All Logs** button with confirmation dialog
- Clears all logs permanently (irreversible)

#### Log Entry Details

Each log entry card displays:
- **Header**: Function name badge, execution time, turn number (if applicable), timestamp
- **Prompt Section**: Full prompt text with copy button
- **Response Section**: Full response text with copy button
- **Metadata Section**: Additional context if present (JSON formatted)

#### Workflow: Analyzing Logs

1. Navigate to LLM Logs tab
2. Use filter to find specific interactions (function name, prompt keywords)
3. Review prompt to see what was sent to AI
4. Review response to see what AI returned
5. Check metadata for additional context
6. Copy relevant logs for documentation or bug reports
7. Use refresh to see latest interactions

#### Best Practices

- Regularly review logs to catch prompt issues early
- Use filtering to find patterns in errors or unexpected responses
- Copy problematic logs for bug reports or prompt refinement
- Clear logs periodically to maintain performance
- Monitor execution times for performance issues
- Review metadata for debugging context

---

### 12. Image Cache Tab

The Image Cache tab provides a link to the dedicated image cache management interface.

#### Purpose
- Quick access to image cache management
- Navigate to full cache interface for advanced operations

#### Features

- **Link to Cache Manager**: Button opens the full cache management page
- The dedicated cache interface (`/dev-tools/cache`) provides:
  - View all cached images
  - Delete individual or bulk images
  - Cache analytics and statistics
  - Cache cleanup based on retention policies

See the Image Cache Management documentation for details on cache operations.

---

### 13. Settings Tab

The Settings tab manages application-wide configuration settings that control system behavior, image caching policies, and custom feature flags.

#### Purpose
- Configure global application settings
- Manage image cache retention policies
- Create and manage custom settings
- View all current settings values

#### Key Features

**Image Cache Configuration**:
- **Image Cache Retention (days)**: How long images are kept (1-180 days)
  - Images older than this are eligible for cleanup
  - Based on usage statistics
  - Default: 30 days

- **Image Cache Minimum Access Count**: Minimum access count for retention
  - Images must be accessed at least this many times to be retained
  - Prevents retention of rarely-used images
  - Default: 5 accesses

**All Settings View**:
- Live read-only view of all settings from `/api/settings`
- Displays key, value, and description for each setting
- Useful for quick reference without editing

**Setting Management**:
- **Create New Setting**: Add custom key/value pairs
- **Edit Existing**: Modify value, description, or active status
- Settings are accessible via API and can be referenced in code

#### Setting Fields

- **Key**: Unique identifier (immutable after creation, use lowercase with underscores)
- **Value**: Setting value (can be string, number, or JSON)
- **Description**: Explanation of setting purpose and usage
- **Active**: Enable/disable setting

#### Workflow: Creating a Setting

1. Click **New Setting** button
2. Enter unique **Key** (e.g., `feature_new_combat_system`)
3. Enter **Value** (e.g., `true` or JSON: `{"enabled": true, "mode": "advanced"}`)
4. Write **Description** explaining the setting
5. Set **Active** checkbox
6. Click **Save Setting**
7. Setting is immediately available via API

#### Workflow: Editing a Setting

1. Select setting from left panel
2. Modify **Value** (key cannot be changed)
3. Update **Description** if needed
4. Toggle **Active** status
5. Click **Save Setting**
6. Changes take effect immediately

#### Best Practices

- Use descriptive, consistent naming for keys
- Document settings clearly in descriptions
- Use JSON for complex structured values
- Test setting changes in development first
- Archive unused settings rather than deleting (set Active to false)
- Document setting dependencies in descriptions

---

## Workflow Examples

### Creating and Editing a Prompt

**Scenario**: Update the narrative generation prompt to include more environmental details.

1. Navigate to **Prompts** tab
2. Select `narrative_generation` prompt from list
3. Review current User Prompt content
4. Add environmental detail instructions:
   ```
   Include vivid descriptions of the cosmic environment, including:
   - Stellar phenomena visible outside
   - Ship interior ambiance
   - Sound and atmosphere details
   ```
5. Click **Save Changes**
6. Success notification confirms update
7. New games will use updated prompt

### Setting Up a New Event

**Scenario**: Create an event for encountering a space station during the Mars segment.

1. Navigate to **Events** tab
2. Click **New Event** button
3. Enter name: "Abandoned Space Station"
4. Select segment: "Earth to Mars"
5. Select skill: "Engineering"
6. Set DC: 15
7. Enter trigger condition JSON:
   ```json
   {
     "type": "onSegment",
     "value": "Mars"
   }
   ```
8. Write pass effect: "You successfully dock with the station and find valuable supplies."
9. Write fail effect: "The station's automated defenses prevent docking. You must continue past."
10. Add tags: "exploration, resources"
11. Set Active checkbox
12. Click **Save Changes**
13. Event will trigger during Mars segment for eligible games

### Configuring Image Generation

**Scenario**: Create a new image prompt template for NPC interactions.

1. Navigate to **Image Prompts** tab
2. Review/update Visual Style Prompt if needed
3. Click **Create New Image Prompt**
4. Enter name: "NPC Interaction Scene"
5. Enter prompt template: `A dramatic scene showing {{NPC_NAME}} during {{CURRENT_NARRATIVE}}`
6. Select size: 1024x1536 (portrait)
7. Select quality: High
8. Check "Inherit Visual Style"
9. Set scene types: "npc, interaction"
10. Add tags: "character, dialogue"
11. Set Active checkbox
12. Click **Save Changes**
13. Click **Test Generate** to validate
14. Template will be used for NPC interaction scenes

### Publishing a Reference Release

**Scenario**: Publish a new reference version after major content updates.

1. Complete all content updates (prompts, events, items, NPCs)
2. Navigate to **Reference** tab
3. Review current active reference
4. Enter new version: "v2.1.0"
5. Enter author: "Your Name"
6. Write release notes:
   ```
   Major content update:
   - Added 5 new events
   - Updated narrative prompts with environmental details
   - Added 3 new items
   - Enhanced PCE story themes
   ```
7. Click **Publish & Activate**
8. Success notification confirms publication
9. New reference is active and will be used for all new games
10. Previous versions remain available for rollback

### Testing PCE Prompts

**Scenario**: Test a new story theme with various visual styles.

1. Navigate to **PCE Tester** tab
2. Select your new theme from Theme dropdown
3. Select first visual style to test
4. Fill in context fields with realistic values:
   - Turn: 10
   - Day: 5
   - Segment: Belt
   - Resources: Various values
5. Click **Build Prompt** to preview
6. Review Meta Prompt tab
7. Review Instructions tab to see modifier injection
8. Click **Build & Send to LLM** to test with AI
9. Review LLM Response tab for quality
10. Repeat with different visual styles
11. Copy successful prompts for documentation
12. If satisfied, activate theme in PCE tab

---

## Quick Reference

### Available Segments (Events)

- `DepartureEarth` - Launch from Earth
- `Moon` - Moon Flyby
- `Mars` - Earth to Mars
- `Belt` - Asteroid Belt
- `JupiterSaturn` - Jupiter to Saturn
- `OuterDarkness` - Outer Darkness
- `NearUranus` - Approaching Uranus
- `ArrivalUranus` - Arrival on Uranus
- `Lost` - Lost in space
- `Any` - Can occur in any segment

### Available Skills (Events, Items)

- Leadership
- Science
- Engineering
- Navigation
- Diplomacy
- Morale
- Combat

### Image Size Options

- `1024x1024` - Square format (default)
- `1536x1024` - Landscape format
- `1024x1536` - Portrait format

### Image Quality Options

- `auto` - System determines optimal quality
- `low` - Faster generation, lower detail
- `medium` - Balanced quality and speed
- `high` - Maximum quality, slower generation

### Model Class Types (Image Models)

- `diffuser` - Diffusion-based models
- `transformer` - Transformer-based models
- `flux` - Flux model architecture
- `auto` - Determined from model configuration

### Common Prompt Variables

- `{{CURRENT_NARRATIVE}}` - Current story state
- `{{SEGMENT}}` - Journey segment name
- `{{DAY}}` - Days elapsed
- `{{DAYS}}` - Days elapsed (alternative)
- `{{TURN}}` - Current turn number
- `{{HULL}}` - Hull integrity percentage
- `{{OXYGEN}}` - Oxygen level percentage
- `{{FUEL}}` - Fuel level percentage
- `{{FOOD}}` - Food supply percentage
- `{{MORALE}}` - Crew morale percentage
- `{{PLAYER_ACTION}}` - Last player action
- `{{ACTIVE_EVENT}}` - Current procedural event
- `{{NPC_NAME}}` - NPC name (context-dependent)
- `{{INTERVIEW_variableName}}` - Interview response (see Interview tab)

### JSON Field Format Examples

**Trigger Condition (Events)**:
```json
{
  "type": "onSegment",
  "value": "Moon Flyby"
}
```

**Skill Bonus (Items)**:
```json
{
  "Engineering": 2,
  "Navigation": 1
}
```

**Scene Effect (Items)**:
```json
{
  "type": "boost",
  "value": "Provides extra oxygen reserves",
  "resource": "oxygen",
  "modifier": 5
}
```

---

## Cross-References

- **[API_GUIDE.md](./API_GUIDE.md)** - Complete API reference for DevTools endpoints
- **[PCE_TECHNICAL_AUDIT.md](./PCE_TECHNICAL_AUDIT.md)** - Technical details on Prompt Composition Engine
- **[SETTINGS_SYSTEM.md](../SETTINGS_SYSTEM.md)** - Settings system architecture
- **[IMAGE_SYSTEM_ARCHITECTURE.md](./IMAGE_SYSTEM_ARCHITECTURE.md)** - Image generation system details
- **[CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md](./CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md)** - Client-side architecture

---

## Troubleshooting

### Common Issues

**Prompt changes not taking effect:**
- Ensure you clicked "Save Changes" button
- Check that the prompt is marked as Active
- Verify you're editing the correct prompt template
- For PCE-related changes, ensure a new reference is published

**Events not triggering:**
- Verify event is Active
- Check trigger condition JSON syntax is valid
- Ensure segment matches current game segment
- Review LLM Logs to see if event was evaluated

**Image generation failing:**
- Verify image prompt template is Active
- Check image model is Active and configured correctly
- Review Image Models tab for provider credentials
- Check LLM Logs for error messages

**Settings not applying:**
- Ensure setting is marked as Active
- Verify setting key matches what code expects
- Check setting value format (JSON if required)
- Review API response to confirm setting is accessible

**Reference publishing fails:**
- Ensure all required catalogs have entries (themes, styles)
- Verify database connection
- Check release notes aren't too long
- Try a different version identifier

---

## Additional Resources

For technical implementation details, see:
- Server-side route handlers: `server/routes.ts`
- Client-side components: `client/src/pages/devtools/`
- Database schema: See `DATABASE_ARCHITECTURE_V2.md`
- API documentation: See `API_GUIDE.md`

For content creation best practices, see:
- Prompt writing guidelines in system prompts
- Event design patterns in existing events
- Image prompt examples in active templates

