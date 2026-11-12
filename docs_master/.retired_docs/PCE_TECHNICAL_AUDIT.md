# PCE Folder Technical Audit & Functional Inventory

**Document Version:** 1.0  
**Date:** January 2025  
**Scope:** Technical audit of `server/pce/` module

---

## Executive Summary

The Prompt Composition Engine (PCE) is a unified system that generates synchronized narrative and image prompts for the Uranus Dungeon Guide game. It replaces the legacy template-based approach with a single meta-prompt system that produces JSON output containing both narration and image prompts, ensuring visual-textual consistency.

**Key Capabilities:**
- Unified prompt generation for narrative and image prompts
- Model-specific prompt optimization (Flux, Transformer, Diffuser)
- Theme/Mood/Style configuration management
- Template variable replacement with nested property support
- Comprehensive test coverage

---

## Module Overview

### Architecture Pattern
The PCE follows a **composition pattern** where:
1. **Template Loading** (`masterPrompt.txt`) provides the base structure
2. **Variable Resolution** (`settings.ts`) resolves theme/style selections from database
3. **Model Instructions** (`modelInstructions.ts`) adapts prompts to specific AI models
4. **Prompt Building** (`promptBuilder.ts`) assembles the final meta-prompt via variable substitution

### Integration Points
- **Primary Consumers:**
  - `server/aiService.ts` - Uses PCE for turn content generation
  - `server/routes.ts` - API endpoints for PCE catalogs and testing
  - `server/gameInitialization.ts` - Resolves PCE selections for new games

---

## File-by-File Technical Analysis

### 1. `masterPrompt.txt`
**Type:** Template File  
**Size:** 78 lines, 3.6KB  
**Purpose:** Base template for meta-prompt generation

#### Structure
The template follows a two-protocol design:
1. **First Protocol:** Narrator's Perspective
   - Role definition using `{{THEME_OBJECT.narratorTemplate}}`
   - Game state injection (turn, day, segment, stats)
   - Narrative generation instructions (6-7 sentences)

2. **Second Protocol:** Image Prompt Generator
   - Technical prompt generation instructions
   - Style parameter injection (label, description, exemplars, modifiers)
   - Model-specific instructions via `{{MODEL_STYLE_INSTRUCTIONS}}`

#### Variable Placeholders
**Simple Variables:**
- `{{TURN_NUMBER}}`, `{{DAY}}`, `{{SEGMENT}}`, `{{CHECKS}}`
- `{{ACTIVE_EVENT}}`, `{{PLAYER_ACTION}}`, `{{RUNNING_GAGS}}`
- `{{NPC_SUMMARY}}`, `{{HULL}}`, `{{OXYGEN}}`, `{{FUEL}}`, `{{FOOD}}`, `{{MORALE}}`
- `{{EQUIPPED_ITEMS}}`

**Nested Object Access:**
- `{{THEME_OBJECT.narratorTemplate}}`
- `{{STYLE_OBJECT.label}}`, `{{STYLE_OBJECT.description}}`, `{{STYLE_OBJECT.exemplifiedBy}}`
- `{{IMAGE_MODEL.label}}`, `{{IMAGE_MODEL.class}}`, `{{IMAGE_MODEL.triggerWords}}`

**Instruction Blocks:**
- `{{MODEL_STYLE_INSTRUCTIONS}}` - Model-specific style guidance
- `{{OUTPUT_FORMAT_INSTRUCTIONS}}` - JSON format requirements
- `{{OUTPUT_EXAMPLE}}` - Example output structure
- `{{STYLE_DIFFUSION_MODIFIERS}}` - Diffusion model modifiers
- `{{STYLE_TRANSFORMER_MODIFIERS}}` - Transformer model modifiers

#### Critical Requirements
- **Line 71:** MUST return valid JSON with exactly two fields: `narration` and `image_prompt`
- **Line 74:** No markdown code fences or additional text outside JSON
- **Line 75:** Response must start with `{` and end with `}`

#### Technical Notes
- Uses ASCII box-drawing characters for visual structure
- Template assumes proper variable substitution (validation occurs in `promptBuilder.ts`)
- No conditional logic in template itself (handled by variable injection)

---

### 2. `promptBuilder.ts`
**Type:** TypeScript Module  
**Size:** 96 lines  
**Exports:** `buildMetaPrompt()`, `clearTemplateCache()`  
**Dependencies:** `fs/promises`, `path`, `url`

#### Core Functions

##### `loadTemplate(): Promise<string>`
- **Purpose:** Loads `masterPrompt.txt` with caching
- **Caching Strategy:** Module-level `templateCache` variable
- **Error Handling:** Throws descriptive error on file read failure
- **Performance:** First read is async; subsequent calls return cached value

##### `clearTemplateCache(): void`
- **Purpose:** Clears template cache (primarily for testing)
- **Usage:** Called in test setup to ensure fresh template loads
- **Public API:** Exported for external cache invalidation

##### `getNestedValue(obj: any, path: string): any`
- **Purpose:** Extracts nested property values using dot notation
- **Example:** `"IMAGE_MODEL.modelKey"` → `imageModel.modelKey`
- **Implementation:** Uses `reduce()` to traverse object path
- **Safety:** Returns `undefined` for missing properties

##### `buildMetaPrompt(variables: Record<string, any>): Promise<string>`
- **Purpose:** Main export - builds final meta-prompt by replacing placeholders
- **Algorithm:**
  1. Load template (cached after first call)
  2. Replace nested property access patterns `{{KEY.property}}`
  3. Replace simple variables `{{KEY}}`
  4. Handle null/undefined values (replaced with empty string)
  5. Trim final result

#### Variable Replacement Logic

**Phase 1: Nested Property Replacement**
```typescript
// Handles {{KEY.property}} patterns
// Iterates through object values and replaces nested accesses
// Handles null/undefined by replacing with empty string
```

**Phase 2: Simple Variable Replacement**
- Skips null/undefined (replaced with empty string)
- Skips objects (should use nested syntax)
- Replaces scalars and arrays with `String(value)`

#### Edge Cases Handled
1. **Null/Undefined Values:** Replaced with empty string (avoids `{{KEY}}` in output)
2. **Object Variables:** Simple `{{KEY}}` for objects is removed (must use nested syntax)
3. **Missing Properties:** Nested access returns empty string
4. **Array Values:** Converted to string representation

#### Technical Considerations
- **Regex Safety:** Uses `RegExp` constructor with escaped keys (prevents regex injection)
- **Replacement Order:** Nested first, then simple (prevents partial replacements)
- **Case Sensitivity:** Variable keys are case-sensitive (must match exactly)
- **Template Validation:** Not performed here (done in `aiService.ts`)

---

### 3. `modelInstructions.ts`
**Type:** TypeScript Module  
**Size:** 170 lines  
**Exports:** `buildModelInstructionSet()`, types `ModelInstructionClass`, `ModelInstructionSet`  
**Dependencies:** None (pure functions)

#### Type Definitions

##### `ModelInstructionClass`
```typescript
type ModelInstructionClass = "flux" | "transformer" | "diffuser" | "fallback"
```
- Enum-like union type for model classification
- `fallback` used for unknown/unrecognized models

##### `ModelInstructionSet`
```typescript
type ModelInstructionSet = {
  style: string;      // Formatting instructions for prompt style
  output: string;     // JSON output format requirements
  example: string;    // Example JSON response
  modelClass: ModelInstructionClass;
}
```

#### Model-Specific Instructions

##### Flux Model (`"flux"`)
**Style Characteristics:**
- 2-4 descriptive sentences/fragments with periods
- Natural, flowing language (20-40 words)
- Concrete, grounded descriptions
- Single string prompt (no negative prompt)
- Diffusion/Transformer modifiers included

**Template:**
```
[Subject with pose/action]. [Key details, setting elements]. [Atmosphere, lighting]. [STYLE].
```

**Output Format:**
```json
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": "<formatted image prompt>"
}
```

##### Transformer Model (`"transformer"`)
**Style Characteristics:**
- 2-3 complete, flowing sentences (25-45 words)
- Cohesive narrative description
- Slightly more compositional language allowed
- Single string prompt

**Template:**
```
A realistic scene of [subject doing X with details]. [Setting and environment]. [Lighting/atmosphere]. [STYLE].
```

**Output Format:** Same as Flux (simple JSON with two string fields)

##### Diffuser Model (`"diffuser"`)
**Style Characteristics:**
- Comma-separated tags with weight modifiers
- Positive: 40-80 words | Negative: 10-25 words
- Technical, optimization-focused
- Uses `(style:1.4)` weight notation
- Returns object with `positive` and `negative` prompts

**Quality Tags:**
- `(photorealistic:1.3)`, `(masterpiece:1.2)`, `(ultra detailed)`, `(sharp focus)`
- `RAW style`, `cinematic lighting`

**Output Format:**
```json
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": {
    "positive": "<positive prompt>",
    "negative": "<negative prompt>"
  }
}
```

##### Fallback Model
- Provides all three model formats in instructions
- Defaults to transformer output format
- Used when model class is unrecognized

#### Core Function

##### `buildModelInstructionSet(modelClass: string | null | undefined): ModelInstructionSet`
- **Purpose:** Returns appropriate instruction set based on model class
- **Normalization:** Converts input to lowercase, handles null/undefined
- **Fallback Strategy:** Unknown models default to `fallback` instruction set
- **Return:** Complete instruction set with style, output, example, and modelClass

#### Technical Notes
- **Pure Function:** No side effects, deterministic output
- **Case Insensitive:** Model class matching is case-insensitive
- **Extensibility:** Easy to add new model types by extending switch statement
- **Consistency:** All examples use same narrative text for comparison

---

### 4. `settings.ts`
**Type:** TypeScript Module  
**Size:** 103 lines  
**Exports:** `getPceDefaults()`, `resolvePceSelections()`, type `PceSelection`  
**Dependencies:** `../reference/referenceLoader.js`, `../storage.js`, `@shared/schema`

#### Type Definitions

##### `PceSelection`
```typescript
interface PceSelection {
  theme: string;  // Theme label (human-readable)
  style: string;  // Style label (human-readable)
}
```
- Represents resolved PCE creative selections
- Uses labels (not IDs) for consistency

#### Core Functions

##### `getPceDefaults(): Promise<PceSelection>`
- **Purpose:** Retrieves default theme/style from app_settings
- **Data Source:** `reference.data.settings.pce_defaults` (JSON string)
- **Validation:** Uses `normalizeDefaults()` to ensure valid structure
- **Error Handling:** Throws if setting missing or invalid JSON

##### `resolvePceSelections(overrides, fallback?): Promise<PceSelection>`
- **Purpose:** Resolves final theme/style selections with priority: overrides → fallback → defaults
- **Priority Chain:**
  1. `overrides.theme/style` (highest priority)
  2. `fallback.theme/style`
  3. Defaults from `getPceDefaults()`

- **Resolution Logic:**
  - Fetches active themes/styles from database
  - Matches by ID field (`value` for themes, `name` for styles)
  - Falls back to label matching (case-insensitive)
  - Returns provided value if no match found (with warning)

- **Database Integration:**
  - `storage.listStoryThemes()` - Fetches all story themes
  - `storage.listVisualStyles()` - Fetches all visual styles
  - Filters to only active items (`active === 1`)

#### Helper Functions

##### `parseJsonSetting<T>(value, key): T`
- **Purpose:** Parses and validates JSON from app settings
- **Error Handling:** Throws descriptive error if missing or invalid
- **Type Safety:** Generic type parameter for return type

##### `normalizeDefaults(value): PceSelection`
- **Purpose:** Validates and normalizes default PCE selection structure
- **Validation:** Ensures object with `theme` and `style` string properties
- **Normalization:** Trims whitespace from theme/style values

##### `resolveSelectionValue(value, catalog, idField, fallback, key): string`
- **Purpose:** Resolves a selection value to its label
- **Matching Strategy:**
  1. Match by ID field (`value` for themes, `name` for styles) - case-insensitive
  2. Match by label - case-insensitive
  3. Return provided value if no match (with console warning)

- **Parameters:**
  - `idField`: `'value'` for themes, `'name'` for styles
  - Returns human-readable label, not internal ID

#### Technical Considerations
- **Active Filtering:** Only considers active themes/styles from database
- **Case Insensitivity:** All matching operations are case-insensitive
- **Label Resolution:** Always returns labels (not IDs) for UI consistency
- **Async Dependencies:** All functions are async due to database/storage calls
- **Error Resilience:** Warns on invalid values but continues (doesn't throw)

---

### 5. `promptBuilder.test.ts`
**Type:** Test Suite  
**Size:** 134 lines  
**Test Framework:** Vitest  
**Coverage:** Model-specific instruction injection

#### Test Structure

##### Setup
- `beforeEach()`: Clears template cache to ensure fresh template loads
- `createBaseVariables()`: Helper function to create test variable objects

##### Test Scenarios
Four scenarios tested (via `scenarios.forEach()`):
1. **Flux Model:** Verifies flux-specific instructions injected
2. **Transformer Model:** Verifies transformer-specific instructions
3. **Diffuser Model:** Verifies diffuser format with positive/negative prompts
4. **Unknown Model:** Verifies fallback behavior for unrecognized models

#### Test Assertions
For each scenario, verifies:
- ✅ Model-specific instruction output present
- ✅ Target hint text present (e.g., `"When IMAGE_MODEL.class is \"flux\""`)
- ✅ Diffusion modifiers correctly replaced
- ✅ Transformer modifiers correctly replaced
- ✅ No unreplaced placeholders remain:
  - `{{MODEL_STYLE_INSTRUCTIONS}}`
  - `{{OUTPUT_FORMAT_INSTRUCTIONS}}`
  - `{{STYLE_DIFFUSION_MODIFIERS}}`
  - `{{STYLE_TRANSFORMER_MODIFIERS}}`
  - `{{STYLE_MODIFIERS}}`

#### Test Data
- **Base Variables:** Comprehensive game state mock (turn, stats, NPCs, etc.)
- **Model Configs:** Mock image models with label, class, triggerWords, modelKey
- **Theme/Style:** Mock theme and style objects with all required fields

#### Technical Notes
- **Isolation:** Each test clears cache to prevent cross-test pollution
- **Coverage:** Tests instruction injection, not variable replacement logic
- **Missing Coverage:** No tests for edge cases (null values, missing properties, etc.)

---

## Functional Inventory

### Primary Functions

| Function | File | Purpose | Input | Output |
|----------|------|---------|-------|--------|
| `buildMetaPrompt()` | `promptBuilder.ts` | Assembles final meta-prompt | Variables object | Complete prompt string |
| `buildModelInstructionSet()` | `modelInstructions.ts` | Returns model-specific instructions | Model class string | Instruction set object |
| `getPceDefaults()` | `settings.ts` | Retrieves default theme/style | None | PceSelection object |
| `resolvePceSelections()` | `settings.ts` | Resolves theme/style with priority | Overrides, fallback | PceSelection object |
| `clearTemplateCache()` | `promptBuilder.ts` | Clears template cache | None | void |

### Template Variables

#### Game State Variables
- `TURN_NUMBER` - Current turn number
- `DAY` - Days on voyage
- `SEGMENT` - Location segment
- `CHECKS` - Skill check summaries

#### Narrative Variables
- `ACTIVE_EVENT` - Current event description
- `PLAYER_ACTION` - Player's action description
- `RUNNING_GAGS` - Running joke references

#### Character Variables
- `NPC_SUMMARY` - Summary of crew members

#### Ship State Variables
- `HULL` - Hull strength (0-100)
- `OXYGEN` - Oxygen level (0-100)
- `FUEL` - Fuel level (0-100)
- `FOOD` - Food level (0-100)
- `MORALE` - Morale level (0-100)
- `EQUIPPED_ITEMS` - Currently equipped items

#### Object Variables (Nested Access)
- `THEME_OBJECT.narratorTemplate` - Theme's narrator persona
- `THEME_OBJECT.label` - Theme display name
- `THEME_OBJECT.description` - Theme description
- `THEME_OBJECT.value` - Theme internal ID

- `STYLE_OBJECT.label` - Style display name
- `STYLE_OBJECT.description` - Style description
- `STYLE_OBJECT.exemplifiedBy` - Style exemplars
- `STYLE_OBJECT.modifiersDiffusion` - Diffusion model modifiers
- `STYLE_OBJECT.modifiersTransformer` - Transformer model modifiers

- `IMAGE_MODEL.label` - Model display name
- `IMAGE_MODEL.class` - Model class ("flux"|"transformer"|"diffuser")
- `IMAGE_MODEL.triggerWords` - Model-specific trigger words
- `IMAGE_MODEL.modelKey` - Model internal identifier

#### Instruction Variables
- `MODEL_STYLE_INSTRUCTIONS` - Model-specific style guidance
- `OUTPUT_FORMAT_INSTRUCTIONS` - JSON format requirements
- `OUTPUT_EXAMPLE` - Example JSON output
- `STYLE_DIFFUSION_MODIFIERS` - Diffusion model style modifiers
- `STYLE_TRANSFORMER_MODIFIERS` - Transformer model style modifiers

---

## Dependencies & Integration

### Internal Dependencies

#### `promptBuilder.ts`
- ✅ **File System:** `fs/promises` - Template loading
- ✅ **Path Resolution:** `path`, `url` - File path construction

#### `modelInstructions.ts`
- ✅ **No Dependencies** - Pure TypeScript module

#### `settings.ts`
- ✅ **Storage:** `../storage.js` - Database queries
- ✅ **Reference:** `../reference/referenceLoader.js` - App settings
- ✅ **Schema:** `@shared/schema` - Type definitions

#### `promptBuilder.test.ts`
- ✅ **Vitest:** Test framework
- ✅ **PCE Modules:** Imports `promptBuilder.ts` and `modelInstructions.ts`

### External Dependencies (Consumers)

#### `server/aiService.ts`
- **Usage:** Primary consumer of PCE system
- **Functions Used:**
  - `buildMetaPrompt()` - Line 440, 905
  - `buildModelInstructionSet()` - Line 364, 843
  - `resolvePceSelections()` - Line 296, 758

#### `server/routes.ts`
- **Usage:** API endpoints for PCE functionality
- **Functions Used:**
  - `buildMetaPrompt()` - Line 628
  - `buildModelInstructionSet()` - Line 557
  - `getPceDefaults()` - Line 682
  - `resolvePceSelections()` - Imported but usage not shown in snippet

#### `server/gameInitialization.ts`
- **Usage:** Resolves PCE selections for new games
- **Functions Used:**
  - `resolvePceSelections()` - Line 18

### Database Schema Dependencies

#### Required Tables
- `mod_story_themes` - Story theme catalog
  - Fields: `value`, `label`, `active`
  
- `mod_visual_styles` - Visual style catalog
  - Fields: `name`, `label`, `active`

#### App Settings
- `pce_defaults` - JSON string containing default theme/style
  - Format: `{"theme": "theme_value", "style": "style_name"}`

---

## Technical Considerations

### Performance

#### Caching Strategy
- **Template Caching:** `masterPrompt.txt` cached in module-level variable
- **Cache Lifecycle:** Cleared only via `clearTemplateCache()` (primarily for testing)
- **Benefit:** Avoids file I/O on every prompt generation
- **Risk:** Stale cache if template file updated without restart

#### Async Operations
- **Template Loading:** Async file read (first call only)
- **Database Queries:** `settings.ts` functions are async
- **Recommendation:** Consider connection pooling for database operations

### Error Handling

#### Current Implementation
- **Template Loading:** Throws descriptive error on file read failure
- **Variable Resolution:** Replaces missing values with empty string (no errors)
- **Settings Parsing:** Throws error on invalid JSON
- **Model Instructions:** Returns fallback for unknown models (no error)

#### Edge Cases Handled
- ✅ Null/undefined variables → Empty string
- ✅ Missing nested properties → Empty string
- ✅ Unknown model class → Fallback instructions
- ✅ Invalid theme/style → Warning + uses provided value

#### Potential Issues
- ⚠️ **Stale Cache:** Template cache never auto-clears
- ⚠️ **Missing Validation:** No validation that required variables are present
- ⚠️ **Regex Safety:** Uses `RegExp` constructor (potential regex injection if keys are user-controlled)

### Security Considerations

#### Variable Injection
- **Current:** Variables are server-controlled (game state, settings)
- **Risk:** Low (no user input directly injected)
- **Recommendation:** Add validation if user input ever flows through

#### Template File
- **Location:** `server/pce/masterPrompt.txt` (relative to module)
- **Risk:** Low (file is part of codebase, not user-uploaded)
- **Access:** Read-only (never written by code)

### Extensibility

#### Adding New Model Types
1. Add case to `buildModelInstructionSet()` switch statement
2. Define new instruction constants (style, output, example)
3. Add to `ModelInstructionClass` type
4. Update tests if needed

#### Adding New Variables
1. Update `masterPrompt.txt` with `{{VARIABLE_NAME}}` placeholder
2. Ensure variable passed to `buildMetaPrompt()` in `aiService.ts`
3. Document in this inventory

#### Template Modifications
1. Edit `masterPrompt.txt`
2. Clear cache or restart server
3. Validate no unreplaced placeholders remain

---

## Testing Coverage

### Current Test Coverage

#### `promptBuilder.test.ts`
- ✅ Model-specific instruction injection (4 scenarios)
- ✅ Placeholder replacement validation
- ✅ Template cache clearing

#### Missing Coverage
- ❌ Variable replacement edge cases (null, undefined, nested)
- ❌ Template loading error handling
- ❌ Settings resolution edge cases
- ❌ Integration tests with actual database
- ❌ Performance tests (template caching)

### Recommendations
1. **Add Unit Tests:**
   - Test `getNestedValue()` with various object structures
   - Test `buildMetaPrompt()` with missing/null variables
   - Test `resolvePceSelections()` with various override combinations

2. **Add Integration Tests:**
   - Test full PCE flow from settings → prompt generation
   - Test with real database queries (test database)

3. **Add Validation Tests:**
   - Test unreplaced placeholder detection
   - Test JSON output validation

---

## Recommendations

### Short-Term Improvements

1. **Template Cache Management**
   - Add file watcher to auto-clear cache on template modification
   - Or add timestamp-based cache invalidation

2. **Enhanced Error Messages**
   - Include variable name in replacement errors
   - Provide suggestions for common mistakes (typos, missing variables)

3. **Documentation**
   - Add JSDoc comments to all exported functions
   - Document variable requirements in template file

### Medium-Term Enhancements

1. **Variable Validation**
   - Add optional validation mode that checks for required variables
   - Return warnings for missing recommended variables

2. **Performance Monitoring**
   - Add timing logs for template loading
   - Track cache hit rates

3. **Template Versioning**
   - Add version metadata to template
   - Support multiple template versions for A/B testing

### Long-Term Considerations

1. **Template Language**
   - Consider template engine (Handlebars, Mustache) for more powerful features
   - Support conditionals, loops, partials

2. **Dynamic Instructions**
   - Allow model instructions to be configurable (not hardcoded)
   - Support custom instruction sets per game/mode

3. **Testing Infrastructure**
   - Automated snapshot testing for template outputs
   - Regression tests for variable replacement

---

## Maintenance Guidelines

### When to Modify Files

#### `masterPrompt.txt`
- Narrative tone changes
- New variable requirements
- Output format changes
- **Remember:** Clear cache or restart after changes

#### `promptBuilder.ts`
- Variable replacement logic changes
- Performance optimizations
- New placeholder syntax support

#### `modelInstructions.ts`
- New model type support
- Model-specific prompt format changes
- Example output updates

#### `settings.ts`
- Database schema changes
- Resolution logic changes
- New default source requirements

### Code Review Checklist
- [ ] All placeholders replaced in template?
- [ ] Cache cleared if template modified?
- [ ] Tests updated for new functionality?
- [ ] Error messages descriptive?
- [ ] No hardcoded values that should be configurable?
- [ ] Documentation updated?

---

## Appendix: Variable Reference Quick Guide

### Simple Variables
```typescript
{
  TURN_NUMBER: number,
  DAY: number,
  SEGMENT: string,
  CHECKS: string,
  ACTIVE_EVENT: string,
  PLAYER_ACTION: string,
  RUNNING_GAGS: string,
  NPC_SUMMARY: string,
  HULL: number,
  OXYGEN: number,
  FUEL: number,
  FOOD: number,
  MORALE: number,
  EQUIPPED_ITEMS: string
}
```

### Object Variables (Nested Access)
```typescript
{
  THEME_OBJECT: {
    narratorTemplate: string,
    label: string,
    description: string,
    value: string
  },
  STYLE_OBJECT: {
    label: string,
    description: string,
    exemplifiedBy: string,
    modifiersDiffusion: string,
    modifiersTransformer: string
  },
  IMAGE_MODEL: {
    label: string,
    class: "flux" | "transformer" | "diffuser",
    triggerWords: string,
    modelKey: string
  }
}
```

### Instruction Variables (Injected)
```typescript
{
  MODEL_STYLE_INSTRUCTIONS: string,      // From buildModelInstructionSet()
  OUTPUT_FORMAT_INSTRUCTIONS: string,    // From buildModelInstructionSet()
  OUTPUT_EXAMPLE: string,                // From buildModelInstructionSet()
  STYLE_DIFFUSION_MODIFIERS: string,     // From STYLE_OBJECT.modifiersDiffusion
  STYLE_TRANSFORMER_MODIFIERS: string    // From STYLE_OBJECT.modifiersTransformer
}
```

---

**Document End**

