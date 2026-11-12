# DevTools Comprehensive Documentation
_Complete technical documentation for Quest to Uranus Developer Tools_

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** 2025-01-08 UTC

---

## Table of Contents

1. [Context & Overview](#context--overview)
2. [Technical Details](#technical-details)
3. [Practical Guidance](#practical-guidance)
4. [Troubleshooting & Support](#troubleshooting--support)
5. [Standards & Processes](#standards--processes)
6. [Visual Aids & Diagrams](#visual-aids--diagrams)
7. [Cross-References](#cross-references)

---

## Context & Overview

### What is DevTools?

DevTools is a comprehensive administrative interface for managing all aspects of the Quest to Uranus game system. It provides a unified, tabbed interface for content management, system configuration, diagnostics, and observability. DevTools serves as the primary operational control center for game architects and content creators.

### Why It Exists

DevTools exists to:

1. **Centralize Content Management** - Provide a single interface for managing prompts, events, items, NPCs, image prompts, and other game content without requiring database access or code deployments
2. **Enable Content Versioning** - Support the reference release system, allowing content teams to publish, test, and activate new content versions independently of code releases
3. **Facilitate Prompt Engineering** - Enable editing of PCE prompts (master, narrative, image, actions) with variable reference support, and manage PCE catalogs (story themes, visual styles)
4. **Provide System Observability** - Surface telemetry, metrics, logs, and cache statistics to help operators understand system health and performance
5. **Support Configuration Management** - Enable runtime configuration changes for image models, system settings, and feature flags without code changes
6. **Enable Diagnostics** - Provide advanced debugging tools for understanding turn processing, image generation, and LLM interactions

### Purpose Within the Larger System

DevTools integrates with multiple agents in the Quest to Uranus architecture (see [`AGENTS.md`](../AGENTS.md)):

- **Game Orchestrator Agent** - DevTools routes content management requests through admin endpoints that bypass the reference release system, allowing direct database manipulation
- **Reference Steward Agent** - DevTools provides the UI for publishing and activating reference releases, enabling content versioning workflows
- **Image Processor Agent** - DevTools exposes cache management, image model configuration, and image prompt templates
- **Turn Processor Agent** - DevTools provides diagnostics for understanding turn processing through telemetry and LLM logs tabs
- **Data Persistence Agent** - All DevTools operations ultimately interact with the storage layer for content CRUD operations

DevTools operates as a **content management layer** that sits above the runtime game system, enabling content creators to iterate on game mechanics without code deployments.

---

## Technical Details

### Components, Structure, and Architecture

#### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DevTools Page                             │
│              (client/src/pages/DevToolsPage.tsx)             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Authentication Layer                                │   │
│  │  • Admin token validation                           │   │
│  │  • localStorage persistence                          │   │
│  │  • Cross-tab synchronization                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tab Navigation (shadcn/ui Tabs)                     │   │
│  │  17 specialized tabs for different domains           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tab Components (client/src/pages/devtools/*.tsx)   │   │
│  │  • Content Management Tabs                           │   │
│  │  • Configuration Tabs                                │   │
│  │  • Diagnostics Tabs                                  │   │
│  │  • Observability Tabs                                │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ HTTP (Authorization: Bearer <token>)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Game Orchestrator Agent                          │
│              (server/routes.ts)                              │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Admin Endpoints (/api/admin/*)                      │   │
│  │  • requireAdmin middleware                           │   │
│  │  • Direct database access                           │   │
│  │  • Bypass reference releases                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  System Endpoints                                    │   │
│  │  • /api/settings                                     │   │
│  │  • /api/llm-logs                                     │   │
│  │  • /api/cache/*                                      │   │
│  │  • /api/admin/telemetry/*                            │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Persistence Agent                          │
│              (server/storage.ts)                             │
│                                                               │
│  • Postgres database operations                             │
│  • Transactional safety                                      │
│  • Type-safe model translation                               │
└─────────────────────────────────────────────────────────────┘
```

#### Component Structure

**Main Entry Point:**
- **File:** `client/src/pages/DevToolsPage.tsx`
- **Responsibility:** Authentication, tab orchestration, system status display
- **Key Features:**
  - Admin token authentication form
  - Tab navigation using shadcn/ui Tabs component
  - System status indicators (last LLM mode, PCE status)
  - Cross-tab token synchronization

**Tab Components Directory:**
- **Location:** `client/src/pages/devtools/`
- **Pattern:** Each tab is a self-contained React component with its own state management
- **Common Dependencies:**
  - React Query for server state management
  - `apiRequest` from `@/lib/queryClient` for authenticated API calls
  - shadcn/ui components for consistent UI
  - Toast notifications for user feedback

#### Technologies, Tools, and Frameworks

**Frontend Stack:**
- **React 18** - Component framework with hooks
- **TypeScript** - Type safety across client and server
- **React Query (TanStack Query)** - Server state management, caching, and synchronization
- **shadcn/ui** - Component library (Tabs, Cards, Buttons, Forms, etc.)
- **Tailwind CSS** - Utility-first styling
- **wouter** - Lightweight routing

**Backend Integration:**
- **Express.js** - HTTP server and routing
- **PostgreSQL** - Persistent storage for all content
- **Zod** - Schema validation for API requests/responses
- **BullMQ** - Job queue system (for async operations)

**Authentication:**
- Admin token stored in `localStorage['uranus-admin-token']`
- Token injected as `Authorization: Bearer <token>` header on all API requests
- Cross-tab synchronization via `CustomEvent` broadcasting
- Automatic token clearing on 401 responses

#### Relationships and Interactions

**Client-Server Communication Pattern:**

1. **Authentication Flow:**
   ```
   User enters token → localStorage.setItem() → 
   CustomEvent broadcast → All tabs update → 
   apiRequest() injects header → Server validates → 
   Access granted/denied
   ```

2. **Content Management Flow:**
   ```
   Tab component → React Query hook → 
   apiRequest() → Admin endpoint → 
   Storage layer → Database → 
   Response → React Query cache → 
   UI update + Toast notification
   ```

3. **Reference Release Flow:**
   ```
   Reference Tab → Publish action → 
   POST /api/admin/reference/publish/:version → 
   Filesystem write (releases/:version/) → 
   Activate action → 
   POST /api/admin/reference/:version/activate → 
   Symlink update (releases/current) → 
   Runtime system uses new release
   ```

**Inter-Tab Relationships:**
- **Prompts Tab ↔ PCE Tab:** PCE prompts (pce_master, pce_narrative, pce_image, pce_actions) are editable in Prompts tab with variable reference support; PCE Tab manages story themes and visual styles catalogs
- **Settings Tab ↔ Cache Tab:** Settings control cache retention policies used by Cache Tab
- **Reference Tab ↔ All Content Tabs:** Publishing a reference release captures current state of all content managed in other tabs

#### Configurations and Parameters

**Admin Token Configuration:**
- **Storage Key:** `uranus-admin-token`
- **Format:** String (no specific format enforced by client)
- **Validation:** Server-side via `requireAdmin` middleware
- **Persistence:** localStorage (survives page refresh)
- **Scope:** Browser-specific (not shared across browsers/devices)

**API Request Configuration:**
- **Base URL:** Relative paths (e.g., `/api/admin/prompt_templates`)
- **CSRF Protection:** Automatic via `apiRequest()` helper
- **Error Handling:** Automatic token clearing on 401, toast notifications on errors
- **Retry Logic:** Handled by React Query (default: 3 retries with exponential backoff)

**React Query Defaults:**
- **Stale Time:** 0 (data considered stale immediately)
- **Cache Time:** 5 minutes
- **Retry:** 3 attempts
- **Retry Delay:** Exponential backoff

---

## Practical Guidance

### Step-by-Step Instructions

#### Accessing DevTools

1. **Navigate to DevTools:**
   - URL: `/dev-tools`
   - Route: Defined in `client/src/App.tsx`
   - Component: `DevToolsPage`

2. **Authenticate:**
   - Enter admin token in the authentication form
   - Click "Unlock Developer Tools"
   - Token is saved to localStorage and synchronized across tabs
   - If token is invalid, you'll see an error message

3. **Navigate Tabs:**
   - Click any tab in the tab list to switch between tools
   - Default tab: "Prompts"
   - Tab state persists during session

#### Content Management Workflow

**Creating New Content (Example: Event):**

1. Navigate to **Events** tab
2. Click **"New Event"** button (top right of list panel)
3. Fill in form fields:
   - **Name:** Unique identifier
   - **Segment:** Game segment (e.g., "Moon Flyby")
   - **Skill:** Skill check type
   - **DC:** Difficulty class (number)
   - **Trigger Condition:** JSON object defining when event fires
   - **Pass/Fail Effects:** Text descriptions
   - **Tags:** Comma-separated tags
   - **Active:** Checkbox to enable/disable
4. Click **"Save"** button
5. Event appears in list and is immediately available (if active)

**Editing Existing Content:**

1. Click item in left panel list
2. Form populates with current values
3. Make changes
4. Click **"Save"** button
5. Changes are immediately persisted to database

**Archiving Content:**

1. Select item from list
2. Uncheck **"Active"** checkbox
3. Click **"Save"**
4. Item remains in database but is excluded from runtime queries

#### Reference Release Workflow

**Publishing a New Release:**

1. Navigate to **Reference** tab
2. Ensure all content changes are saved in their respective tabs
3. Enter version identifier (e.g., "v1.2.3" or "2025-01-27")
4. Click **"Publish Release"** button
5. System:
   - Captures current state of all content from database
   - Writes JSON files to `releases/:version/` directory
   - Creates metadata file with timestamp and version info
6. Release appears in "Available Releases" list

**Activating a Release:**

1. In **Reference** tab, find desired release in list
2. Click **"Activate"** button next to release
3. System:
   - Updates `releases/current` symlink to point to selected version
   - Invalidates runtime caches
   - All new game sessions use new release
4. Active release indicator updates

**Rollback Procedure:**

1. Navigate to **Reference** tab
2. Find previous release in list
3. Click **"Activate"** button
4. System immediately switches to previous version
5. No database changes required (releases are immutable)

#### Prompt Composition Engine (PCE) Management

**Editing PCE Prompts:**

1. Navigate to **Prompts** tab
2. Filter or search for prompts starting with `pce_`:
   - `pce_master` - Master prompt composition
   - `pce_narrative` - Narrative generation
   - `pce_image` - Image prompt generation
   - `pce_actions` - Action suggestion
3. Select prompt from list
4. **Variable Reference Panel** appears (right side) showing available variables for that stage
5. Edit system prompt and/or user prompt
6. Use `{{VARIABLE_NAME}}` syntax for variable substitution
7. Click **"Save Changes"**

**Managing Story Themes:**

1. Navigate to **PCE** tab
2. Ensure **"Story Themes"** sub-tab is selected
3. Click **"New Theme"** or select existing theme
4. Fill in:
   - **Story Theme Key:** Unique identifier (e.g., "cosmic-noir")
   - **Label:** Display name
   - **Narrator Template:** Instructions for narrative style
   - **Tags:** Comma-separated tags for categorization
   - **Active:** Enable/disable
5. Click **"Save"**

**Managing Visual Styles:**

1. Navigate to **PCE** tab
2. Select **"Visual Styles"** sub-tab
3. Click **"New Style"** or select existing style
4. Fill in:
   - **Category:** Style category (e.g., "Illustration")
   - **Visual Style Key:** Unique identifier
   - **Label:** Display name
   - **Exemplified By:** Description of reference style
   - **Diffusion Modifiers:** Comma-separated modifiers for diffusion models
   - **Transformer Modifiers:** Comma-separated modifiers for transformer models
   - **Active:** Enable/disable
5. Click **"Save"**

#### Story (LLM) Model Configuration

The **LLM Models** tab manages the text models that write the story: a Catalog, a Discover browser, a Playground and a Qualify test that runs the real story pipeline. See [`LLM_MODELS.md`](LLM_MODELS.md) for the full workflow.

The **Evals** tab scores the story pipeline on the saved PCE Inspector scenarios. Use it before publishing a prompt change or activating a model:

1. Run an experiment on **Published** prompts. This is the baseline.
2. Edit prompts in the Prompts tab (or pick another story model), then run an experiment on **Draft** prompts.
3. Tick the baseline's checkbox in the Experiments table. Every other row then shows the change in each score.
4. Select a row for per-scenario scores and the judges' reasoning, or open the experiment in LangSmith to compare outputs side by side.

The tab also sets what share of live turns is scored in the background and which model does the judging. Offline experiments need LangSmith configured; live-turn scoring does not. See [`OBSERVABILITY_AND_EVALS.md`](OBSERVABILITY_AND_EVALS.md).

**Open trace** buttons appear in LLM Logs, PCE Inspector runs, Qualify runs and Game Telemetry on records made while LangSmith tracing was on. Each opens that record's trace: the full turn with every prompt, variable set, model call, retry and fallback.

#### Image Model Configuration

**Adding a New Image Model:**

1. Navigate to **Image Models** tab
2. Fill in form at top:
   - **Model Key:**** Unique identifier (e.g., "openai-dall-e-3")
   - **Display Name:** Human-readable name
   - **Provider:** Select "OpenAI" or "Hugging Face"
   - **Model Name:** Provider-specific model identifier
   - **HF Provider:** (Hugging Face only) Provider service name
   - **Class:** Model class (e.g., "diffuser", "transformer")
   - **Trigger Words:** Comma-separated words to trigger this model
   - **Active:** Enable/disable
   - **Set as Default:** Make this the default for new games
3. Click **"Save"**
4. Model appears in table below

**Editing an Image Model:**

1. Click **"Edit"** button next to model in table
2. Form populates with current values
3. Make changes
4. Click **"Save"** to update existing model
5. Or change **Model Key** and click **"Save As"** to create copy

**Setting Default Model:**

1. Edit model you want as default
2. Check **"Set as Default Model"** checkbox
3. Click **"Save"**
4. System automatically unchecks default on all other models
5. New games will use this model by default

#### Cache Management

**Viewing Cache Statistics:**

1. Navigate to **Image Cache** tab
2. Statistics displayed at top:
   - Total images
   - Total size
   - Cache hit rate
   - Oldest/newest images

**Browsing Cached Images:**

1. In **Image Cache** tab, scroll to image list
2. Images displayed with:
   - Thumbnail preview
   - Fingerprint (cache key)
   - Access count
   - Last accessed date
   - File size
3. Click image to view full details

**Clearing Cache:**

1. In **Image Cache** tab, click **"Clear Cache"** button
2. Confirm action in dialog
3. All cached images deleted from filesystem
4. Database records remain (for audit trail)

**Deleting Specific Images:**

1. Find image in list
2. Click **"Delete"** button
3. Image removed from cache and filesystem

#### Telemetry and Observability

**Viewing System Telemetry:**

1. Navigate to **Telemetry** tab
2. Metrics organized by category:
   - **Performance:** Request durations, queue processing times
   - **Throughput:** Requests per second, jobs processed
   - **Errors:** Error rates, failed jobs
   - **Resources:** Memory usage, database connections
   - **Cache:** Hit/miss rates, cache sizes
   - **Image Generation:** Generation times, success rates
3. Each metric card shows:
   - Current value
   - Min/Max/Average
   - Percentiles (p50, p95, p99)
   - Time series data (if available)

**Viewing Game-Specific Telemetry:**

1. Navigate to **Game Telemetry** tab
2. Enter game ID or search for game
3. View metrics specific to that game:
   - Turn processing times
   - Image generation for that game
   - LLM interactions
   - Error occurrences

**Viewing LLM Logs:**

1. Navigate to **LLM Logs** tab
2. Logs displayed in chronological order (newest first)
3. Each log entry shows:
   - Timestamp
   - Mode (PCE vs legacy)
   - Stage (if PCE)
   - Request/response preview
   - Token usage
   - Duration
4. Click entry to view full request/response
5. Use filters to search by mode, stage, or date range

### Code Examples and Usage Patterns

#### Common Tab Component Pattern

Most content management tabs follow this pattern:

```typescript
export function ExampleTab() {
  const { toast } = useToast();
  const { data: items, isLoading } = useQuery<Item[]>({
    queryKey: ["/api/admin/items"],
  });

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(defaultForm);

  const createMutation = useMutation({
    mutationFn: async (payload: FormData) => {
      return await apiRequest("POST", "/api/admin/items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      setIsCreating(false);
      setForm(defaultForm);
      toast({ title: "Item created", description: "Successfully created." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<FormData>) => {
      return await apiRequest("PUT", `/api/admin/items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      toast({ title: "Item updated", description: "Successfully updated." });
    },
  });

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Left: List Panel */}
      <Card>
        <CardHeader>
          <Button onClick={() => setIsCreating(true)}>New Item</Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {items?.map((item) => (
              <Button
                key={item.id}
                variant={selectedItem?.id === item.id ? "secondary" : "ghost"}
                onClick={() => setSelectedItem(item)}
              >
                {item.name}
              </Button>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right: Editor Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Edit Item</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Form fields */}
          <Button onClick={handleSave}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

#### API Request Pattern

All DevTools tabs use the `apiRequest` helper for authenticated requests:

```typescript
import { apiRequest, queryClient } from "@/lib/queryClient";

// GET request
const { data } = useQuery({
  queryKey: ["/api/admin/prompt_templates"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/admin/prompt_templates");
    return await res.json();
  },
});

// POST request (create)
const createMutation = useMutation({
  mutationFn: async (payload: unknown) => {
    const res = await apiRequest("POST", "/api/admin/events", payload);
    return await res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
  },
});

// PUT request (update)
const updateMutation = useMutation({
  mutationFn: async ({ id, ...updates }: { id: string } & Partial<Item>) => {
    const res = await apiRequest("PUT", `/api/admin/events/${id}`, updates);
    return await res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
  },
});

// DELETE request
const deleteMutation = useMutation({
  mutationFn: async (id: string) => {
    await apiRequest("DELETE", `/api/admin/events/${id}`);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
  },
});
```

#### Variable Substitution in Prompts

PCE prompts support variable substitution using double curly braces:

```typescript
// In prompt template
const prompt = `
You are the narrator for a space exploration game.
Current segment: {{SEGMENT}}
Day: {{DAY}}
Hull integrity: {{HULL}}%
Crew skills: {{SKILLS}}
`;

// Variables are resolved at runtime by PCE pipeline
// Available variables depend on stage (see PceVariableReference component)
```

### Best Practices and Guidelines

#### Content Management

1. **Always Use Active/Inactive Toggle:**
   - Don't delete content unless absolutely necessary
   - Use "Active" checkbox to disable content
   - Preserves history and allows rollback

2. **Validate JSON Fields:**
   - Trigger conditions, skill bonuses, scene effects require valid JSON
   - Use JSON.stringify() when editing programmatically
   - Test JSON syntax before saving

3. **Use Descriptive Names:**
   - Content names should be self-documenting
   - Include version or date in name if iterating (e.g., "event_asteroid_v2")
   - Use consistent naming conventions across content types

4. **Leverage Tags:**
   - Use tags for categorization and filtering
   - Common tags: "test", "production", "experimental", segment names
   - Tags enable bulk operations and content discovery

#### Reference Releases

1. **Version Naming:**
   - Use semantic versioning: `v1.2.3`
   - Or date-based: `2025-01-27`
   - Be consistent within your team

2. **Publish Frequently:**
   - Publish releases after significant content changes
   - Don't wait for "perfect" state
   - Enables rollback and A/B testing

3. **Test Before Activating:**
   - Publish release
   - Test in staging environment
   - Activate only after validation

4. **Document Releases:**
   - Use release metadata to document changes
   - Include changelog or notes
   - Helps with debugging and rollback decisions

#### Prompt Engineering

1. **Use Variable Reference:**
   - Always check available variables before writing prompts
   - Use PCE Variable Reference panel in Prompts tab
   - Verify variable names match exactly (case-sensitive)

2. **Inherit Global System Prompt:**
   - Use "Inherit Global System Prompt" checkbox for consistency
   - Only override when scenario-specific instructions needed
   - Reduces duplication and maintenance burden

3. **Test Prompt Changes:**
   - Test prompt changes in actual game sessions before publishing
   - Use LLM Logs tab to review prompt execution
   - Verify variable resolution and output quality

4. **Version Control Prompts:**
   - Document prompt changes in commit messages
   - Consider prompt versioning if making experimental changes
   - Use reference releases to version prompt sets together

#### Image Model Configuration

1. **Set One Default:**
   - Only one model should be marked as default
   - System automatically clears other defaults
   - Default applies to new games only

2. **Use Trigger Words:**
   - Configure trigger words for model selection
   - Enables automatic model selection based on prompt content
   - Monitor image generation logs to verify model selection

3. **Test Model Performance:**
   - Test image generation with different models in actual game sessions
   - Compare output quality and generation time
   - Monitor telemetry for model-specific metrics

#### Diagnostics and Debugging

1. **Start with Telemetry:**
   - Check Telemetry tab for system health
   - Look for error spikes or performance degradation
   - Use Game Telemetry for game-specific issues

2. **Use LLM Logs for Prompt Issues:**
   - Review LLM Logs tab for failed prompt executions
   - Check variable resolution in actual game turns
   - Verify prompt syntax and variable references

3. **Review LLM Logs:**
   - Search logs by mode, stage, or date
   - Compare successful vs failed requests
   - Check token usage and response times

4. **Cache Investigation:**
   - Check cache hit rates in Telemetry
   - Review Image Cache tab for specific images
   - Clear cache if needed (but understand impact)

### Common Patterns and Conventions

#### Two-Column Layout

Most content management tabs use a split-pane layout:
- **Left Panel:** List of items with metadata (name, version, active status)
- **Right Panel:** Editor form for selected item or new item creation
- **Interaction:** Click item in list to load into editor

#### Active/Inactive Pattern

Most content types support activation:
- **Active = 1:** Item is available for use in games
- **Active = 0:** Item is archived but preserved
- **UI:** Checkbox or Switch component
- **Behavior:** Inactive items excluded from runtime queries but remain in database

#### Form Validation Pattern

1. **Client-side validation:**
   - Required fields checked before API call
   - JSON syntax validated for JSON fields
   - Toast notification on validation error

2. **Server-side validation:**
   - Zod schemas validate all inputs
   - Returns 400 with error details on validation failure
   - Client displays server errors in toast

#### React Query Cache Invalidation

Standard pattern after mutations:
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/resource"] });
  toast({ title: "Success", description: "Operation completed." });
}
```

This ensures:
- UI updates immediately
- Other tabs see changes
- Cache stays consistent

---

## Troubleshooting & Support

### Common Issues and Their Solutions

#### Authentication Issues

**Problem: "Token is required" error**
- **Cause:** Token input is empty
- **Solution:** Enter admin token in authentication form

**Problem: 401 Unauthorized errors**
- **Cause:** Invalid or expired admin token
- **Solution:** 
  1. Check token is correct
  2. Verify token hasn't been rotated on server
  3. Clear localStorage and re-enter token
  4. Check server logs for authentication failures

**Problem: Token works in one tab but not another**
- **Cause:** Cross-tab synchronization issue
- **Solution:**
  1. Refresh all DevTools tabs
  2. Re-enter token in one tab
  3. Check browser console for CustomEvent errors
  4. Verify localStorage is accessible (not in private/incognito mode)

#### Content Not Appearing in Games

**Problem: Updated prompts but games use old prompts**
- **Cause:** Games are using reference release, not live database
- **Solution:**
  1. Check which reference release is active (Reference tab)
  2. Publish new reference release with updated content
  3. Activate new release
  4. New games will use new release; existing games may need restart

**Problem: Created new event but it doesn't trigger**
- **Cause:** Event is inactive or trigger condition not met
- **Solution:**
  1. Check "Active" checkbox is enabled
  2. Verify trigger condition JSON is valid
  3. Check trigger condition matches current game state
  4. Review game logs for trigger evaluation

**Problem: Item changes not reflected**
- **Cause:** React Query cache not invalidated
- **Solution:**
  1. Refresh page to clear cache
  2. Check if save operation succeeded (toast notification)
  3. Verify changes in database directly (if possible)
  4. Check browser network tab for API response

#### PCE Prompt Issues

**Problem: Variables not resolving in prompts**
- **Cause:** Variable name typo or unavailable in current stage
- **Solution:**
  1. Check PCE Variable Reference panel (Prompts tab) for available variables
  2. Verify variable name matches exactly (case-sensitive)
  3. Ensure variable is available for current PCE stage (master, narrative, image, actions)
  4. Review LLM Logs tab to see actual variable resolution in production

**Problem: Prompt changes not reflected in games**
- **Cause:** Games using reference release, not live database
- **Solution:**
  1. Check which reference release is active (Reference tab)
  2. Publish new reference release with updated prompts
  3. Activate new release
  4. New games will use new prompts; existing games may need restart

#### Image Generation Issues

**Problem: Images not generating**
- **Cause:** Model configuration error or API failure
- **Solution:**
  1. Check Image Models tab for active models
  2. Verify default model is set
  3. Check model configuration (API keys, provider settings)
  4. Review Image Cache tab for failed generations
  5. Check server logs for image generation errors

**Problem: Wrong image model used**
- **Cause:** Model selection logic or trigger words
- **Solution:**
  1. Check Image Models tab for trigger word configuration
  2. Verify default model is correct
  3. Review image generation logs to see which model was selected
  4. Check user preferences for model overrides

#### Reference Release Issues

**Problem: Can't publish release**
- **Cause:** Version already exists or filesystem error
- **Solution:**
  1. Check if version already exists (use different version)
  2. Verify filesystem permissions on `releases/` directory
  3. Check server logs for filesystem errors
  4. Ensure database is accessible (all content must be readable)

**Problem: Activated release not used by games**
- **Cause:** Cache not invalidated or symlink issue
- **Solution:**
  1. Verify `releases/current` symlink points to correct version
  2. Restart server to clear caches (if possible)
  3. Check Reference Steward Agent logs
  4. Verify games are reading from reference releases (not database)

**Problem: Release missing content**
- **Cause:** Content deleted after publishing or publish failed partially
- **Solution:**
  1. Check release metadata for publish timestamp
  2. Verify content existed at publish time
  3. Re-publish release if needed
  4. Check server logs for publish errors

### Error Messages and Their Meanings

#### Client-Side Errors

**"Token is required"**
- **Meaning:** Admin token input is empty
- **Action:** Enter valid admin token

**"Failed to update the prompt template"**
- **Meaning:** API request failed (network, validation, or server error)
- **Action:** Check browser console and network tab for details

**"Setting key required"**
- **Meaning:** Setting form is missing required key field
- **Action:** Fill in setting key before saving

**"Missing required fields"**
- **Meaning:** Form validation failed (required fields empty)
- **Action:** Fill in all required fields (marked with *)

#### Server-Side Errors (via API)

**401 Unauthorized**
- **Meaning:** Admin token invalid or missing
- **Action:** Re-authenticate with valid token

**400 Bad Request**
- **Meaning:** Request validation failed (invalid JSON, missing fields, etc.)
- **Action:** Check request payload, verify JSON syntax, ensure all required fields present

**404 Not Found**
- **Meaning:** Resource doesn't exist (wrong ID, deleted, etc.)
- **Action:** Verify resource ID, check if resource was deleted

**500 Internal Server Error**
- **Meaning:** Server-side error (database, filesystem, etc.)
- **Action:** Check server logs, verify database connectivity, check filesystem permissions

### Debugging Tips and Strategies

#### Browser DevTools

1. **Network Tab:**
   - Monitor all API requests
   - Check request headers (Authorization token present?)
   - Review response status codes and bodies
   - Verify request payloads

2. **Console Tab:**
   - Check for JavaScript errors
   - Look for React Query errors
   - Verify CustomEvent broadcasts (token sync)

3. **Application Tab:**
   - Check localStorage for admin token
   - Verify token value
   - Clear storage if needed for testing

#### React Query DevTools

Enable React Query DevTools for cache inspection:

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// In App.tsx or main component
<ReactQueryDevtools initialIsOpen={false} />
```

Use to:
- Inspect query cache state
- See active queries and their data
- Manually invalidate queries
- Check query status (loading, error, success)

#### Server Logs

Check server logs for:
- Authentication failures
- Database errors
- Filesystem errors (reference releases)
- LLM API errors
- Image generation failures

**Log Locations:**
- Console output (development)
- `logs/app-*.log` (file-based logging)
- `logs/error-*.log` (error-specific)

#### Systematic Debugging Approach

1. **Reproduce Issue:**
   - Note exact steps to reproduce
   - Check if issue is consistent or intermittent
   - Verify issue occurs in specific context (game, tab, etc.)

2. **Isolate Scope:**
   - Does issue affect one tab or all tabs?
   - Does issue affect one content type or all?
   - Does issue occur for one user or all users?

3. **Check Dependencies:**
   - Verify admin token is valid
   - Check database connectivity
   - Verify filesystem permissions
   - Check external API availability (LLM, image providers)

4. **Review Recent Changes:**
   - Check git history for recent changes
   - Review reference release publish history
   - Check if issue started after specific change

5. **Use Diagnostic Tools:**
   - LLM Logs for prompt/context issues
   - Telemetry for performance issues
   - LLM Logs for AI interaction issues
   - Cache tab for image issues

---

## Standards & Processes

### Quality Requirements and Criteria

#### Content Validation

**Required Fields:**
- All content types have required fields (marked with * in UI)
- Server validates required fields via Zod schemas
- Client shows validation errors before API call

**Data Types:**
- Numbers: Validated as integers or floats
- JSON: Validated as parseable JSON with correct structure
- Strings: Length limits enforced (check individual field docs)
- Enums: Values must match allowed options

**Uniqueness:**
- Content keys/names must be unique within type
- Server returns 409 Conflict if duplicate
- Client should handle conflicts gracefully

#### API Response Standards

**Success Responses:**
- 200 OK: GET requests, successful updates
- 201 Created: Successful resource creation
- 204 No Content: Successful deletion

**Error Responses:**
- 400 Bad Request: Validation error (includes error details)
- 401 Unauthorized: Authentication failure
- 404 Not Found: Resource doesn't exist
- 409 Conflict: Duplicate resource
- 500 Internal Server Error: Server-side error

**Response Format:**
```typescript
// Success
{ id: string, ...resourceData }

// Error
{ error: string, details?: unknown }
```

#### UI/UX Standards

**Loading States:**
- Show loading indicators during API calls
- Disable buttons during mutations
- Display "Saving..." or "Loading..." text

**Error Handling:**
- Show toast notifications for errors
- Include actionable error messages
- Don't leave UI in inconsistent state

**Success Feedback:**
- Toast notifications for successful operations
- Immediate UI updates (via React Query invalidation)
- Clear visual feedback (button states, highlights)

### Security Considerations

#### Authentication

**Admin Token Security:**
- Tokens stored in localStorage (browser-specific)
- Tokens transmitted via `Authorization: Bearer` header
- Tokens validated server-side on every request
- No token expiration (manual rotation required)

**Token Best Practices:**
- Use strong, random tokens
- Rotate tokens periodically
- Don't commit tokens to version control
- Use different tokens for different environments

#### Authorization

**Admin-Only Endpoints:**
- All `/api/admin/*` endpoints require admin token
- `requireAdmin` middleware validates token
- Returns 401 if token missing or invalid

**CSRF Protection:**
- All state-changing requests include CSRF token
- CSRF token obtained via `/api/csrf-token`
- `apiRequest` helper handles CSRF automatically

#### Data Validation

**Input Validation:**
- All inputs validated via Zod schemas
- Type checking on client and server
- Sanitization for XSS prevention (handled by framework)

**Output Sanitization:**
- React automatically escapes content
- No raw HTML rendering (unless explicitly marked safe)
- JSON responses properly serialized

#### Rate Limiting

**Admin Endpoints:**
- Subject to global rate limiting
- Higher limits than public endpoints
- Still protected against abuse

**Best Practices:**
- Batch operations when possible
- Use reference releases for bulk changes
- Avoid rapid-fire API calls in loops

### Performance Implications

#### React Query Caching

**Cache Strategy:**
- Data cached for 5 minutes by default
- Stale data refetched on window focus
- Manual invalidation after mutations

**Optimization Tips:**
- Use `queryKey` consistently for cache hits
- Invalidate only necessary queries (not all)
- Consider `staleTime` for rarely-changing data

#### API Request Optimization

**Batching:**
- Load related data in parallel queries
- Use React Query's `useQueries` for multiple requests
- Avoid sequential API calls when possible

**Pagination:**
- Some endpoints support pagination (check API docs)
- Use pagination for large datasets
- Don't load all data if not needed

#### Reference Release Performance

**Filesystem vs Database:**
- Reference releases use filesystem (faster reads)
- No database queries for reference data
- In-memory caching of reference data

**Cache Invalidation:**
- Reference data cached in memory
- Cache invalidated on release activation
- Consider cache warming for large releases

### Testing and Validation Approaches

#### Manual Testing Checklist

**Content Management:**
- [ ] Create new content item
- [ ] Edit existing content item
- [ ] Archive content item (set inactive)
- [ ] Verify changes persist after refresh
- [ ] Verify changes visible in other tabs

**Reference Releases:**
- [ ] Publish new release
- [ ] Activate release
- [ ] Verify games use new release
- [ ] Rollback to previous release
- [ ] Verify rollback works

**PCE Prompts:**
- [ ] Edit PCE master prompt
- [ ] Edit PCE narrative prompt
- [ ] Edit PCE image prompt
- [ ] Edit PCE actions prompt
- [ ] Verify variable references
- [ ] Test prompts in actual game sessions

**Image Models:**
- [ ] Create new model
- [ ] Edit existing model
- [ ] Set default model
- [ ] Delete model
- [ ] Verify model used in image generation

#### Automated Testing

**Unit Tests:**
- Test individual tab components
- Test form validation logic
- Test API request helpers
- Test React Query hooks

**Integration Tests:**
- Test API endpoints with valid/invalid tokens
- Test reference release publish/activate flow
- Test PCE prompt editing and variable resolution
- Test cache management operations

**E2E Tests:**
- Test full content creation workflow
- Test reference release workflow
- Test authentication flow
- Test cross-tab synchronization

#### Validation Strategies

**Content Validation:**
- Validate JSON syntax before saving
- Check required fields client-side
- Verify server-side validation matches client
- Test edge cases (empty strings, special characters)

**Reference Release Validation:**
- Verify all content included in release
- Check release metadata completeness
- Validate release file structure
- Test release activation with missing files

**PCE Prompt Validation:**
- Verify variable resolution for all PCE stages
- Check prompt syntax and variable references
- Validate LLM response format in production logs
- Test error handling for failed prompt executions

---

## Visual Aids & Diagrams

### DevTools Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client)                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  DevToolsPage.tsx                                    │   │
│  │  • Authentication                                    │   │
│  │  • Tab Navigation                                    │   │
│  │  • System Status                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                        │                                     │
│        ┌───────────────┼───────────────┐                    │
│        ▼               ▼               ▼                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ PromptsTab│  │ EventsTab│  │ ItemsTab │  ... (13 more)   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│        │               │               │                     │
│        └───────────────┼───────────────┘                    │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  apiRequest() Helper                                 │   │
│  │  • Token injection                                    │   │
│  │  • CSRF handling                                      │   │
│  │  • Error handling                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP + Authorization Header
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Server (Express)                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Gateway & Security Agent                            │   │
│  │  • Rate limiting                                     │   │
│  │  • CSRF validation                                   │   │
│  │  • Security logging                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                        │                                     │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Game Orchestrator Agent (routes.ts)                  │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Admin Endpoints (/api/admin/*)               │   │   │
│  │  │  • requireAdmin middleware                    │   │   │
│  │  │  • Direct database access                     │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  System Endpoints                            │   │   │
│  │  │  • /api/settings                             │   │   │
│  │  │  • /api/llm-logs                             │   │   │
│  │  │  • /api/cache/*                              │   │   │
│  │  │  • /api/admin/telemetry/*                    │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                        │                                     │
│        ┌───────────────┼───────────────┐                    │
│        ▼               ▼               ▼                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  Storage │  │Reference │  │   Cache   │                  │
│  │ (Postgres)│ │ Steward  │  │ (Filesys) │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Tab Organization Diagram

```
DevTools Page
│
├── Content Management Tabs
│   ├── Prompts Tab
│   │   ├── Prompt Templates List
│   │   ├── Editor (System + User prompts)
│   │   └── PCE Variable Reference (for PCE prompts)
│   │
│   ├── Events Tab
│   │   ├── Events List
│   │   └── Event Editor (trigger conditions, effects)
│   │
│   ├── Items Tab
│   │   ├── Items List
│   │   └── Item Editor (skills, bonuses, effects)
│   │
│   ├── NPCs Tab
│   │   ├── NPCs List
│   │   └── NPC Editor (dialogue, behavior)
│   │
│   └── Image Prompts Tab
│       ├── Image Prompts List
│       └── Image Prompt Editor
│
├── Configuration Tabs
│   ├── Image Models Tab
│   │   ├── Model Configuration Form
│   │   └── Models Table
│   │
│   ├── PCE Tab
│   │   ├── Story Themes Sub-tab
│   │   └── Visual Styles Sub-tab
│   │
│   └── Settings Tab
│       ├── Image Cache Settings
│       └── All Settings List/Editor
│
├── Diagnostics Tabs
│   └── LLM Logs Tab
│       ├── Logs List (filterable)
│       └── Log Detail Viewer
│
├── Observability Tabs
│   ├── Telemetry Tab
│   │   ├── Performance Metrics
│   │   ├── Throughput Metrics
│   │   ├── Error Metrics
│   │   └── Resource Metrics
│   │
│   ├── Game Telemetry Tab
│   │   ├── Game Selector
│   │   ├── Game-Specific Metrics
│   │   └── Per-Turn Trace Link and Eval Scores
│   │
│   ├── Evals Tab
│   │   ├── Run an Experiment (model, prompts, scenarios, judges)
│   │   ├── Experiments (scores, baseline comparison)
│   │   ├── Dataset (scenario sync)
│   │   └── Live Turns (sample rate, judge model)
│   │
│   └── Image Cache Tab
│       ├── Cache Statistics
│       ├── Image List
│       └── Cache Management Controls
│
└── System Management Tabs
    ├── Reference Tab
    │   ├── Current Release Display
    │   ├── Available Releases List
    │   ├── Publish Release Form
    │   └── Activate Release Controls
    │
    └── Interview Tab
        ├── Interview Questions List
        └── Question Editor
```

### Reference Release Flow Diagram

```
Content Management Tabs
        │
        │ (Content changes saved to database)
        ▼
┌───────────────────────┐
│  Reference Tab         │
│  • Review changes      │
│  • Enter version       │
│  • Click "Publish"      │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────┐
│  POST /api/admin/      │
│  reference/publish/    │
│  :version              │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────┐
│  Reference Steward     │
│  Agent                 │
│  • Read all content    │
│    from database       │
│  • Write JSON files    │
│    to releases/:version│
│  • Create metadata     │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────┐
│  releases/:version/    │
│  ├── prompts.json      │
│  ├── events.json       │
│  ├── items.json        │
│  ├── npcs.json         │
│  ├── image_prompts.json│
│  └── metadata.json     │
└───────────┬────────────┘
            │
            │ (Admin activates release)
            ▼
┌───────────────────────┐
│  POST /api/admin/      │
│  reference/:version/   │
│  activate              │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────┐
│  Update symlink:       │
│  releases/current →    │
│  releases/:version     │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────┐
│  Runtime System        │
│  • New games use       │
│    releases/current     │
│  • Cached data         │
│    invalidated         │
│  • No database queries  │
│    for reference data   │
└───────────────────────┘
```

### PCE Prompt Editing Flow

```
Prompts Tab
        │
        ├── Select PCE Prompt
        │   ├── pce_master
        │   ├── pce_narrative
        │   ├── pce_image
        │   └── pce_actions
        │
        ▼
┌──────────────────────┐
│  Prompt Editor        │
│  • System Prompt      │
│  • User Prompt        │
│  • Variable Reference │
│    Panel (right)      │
└──────────┬───────────┘
           │
           │ Edit with {{VARIABLE}} syntax
           ▼
┌──────────────────────┐
│  Save Changes          │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  PUT /api/admin/      │
│  prompt_templates/:id │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Database Updated     │
│  • Prompt saved        │
│  • Available for       │
│    reference release   │
└──────────────────────┘
```

---

## Cross-References

### Related Documentation

**System Architecture:**
- [`AGENTS.md`](../AGENTS.md) - Agent responsibilities and interactions
- [`docs_master/current/API_GUIDE.md`](API_GUIDE.md) - Complete API documentation
- [`docs_master/current/LLM_MODELS.md`](LLM_MODELS.md) - Story model catalog, selection and qualification
- [`docs_master/current/OBSERVABILITY_AND_EVALS.md`](OBSERVABILITY_AND_EVALS.md) - Pipeline graph, LangSmith tracing, eval experiments and live-turn scoring
- [`docs_master/current/SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) - High-level system architecture

**Content Management:**
- [`docs_master/current/REFERENCE_RELEASE_PUBLISHING.md`](REFERENCE_RELEASE_PUBLISHING.md) - Reference release system details
- [`docs_master/current/PROMPT_COMPOSITION_ENGINE.md`](PROMPT_COMPOSITION_ENGINE.md) - PCE architecture and usage

**Client Architecture:**
- [`docs_master/current/CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`](CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md) - Client-side architecture and patterns


### Key Files and Modules

**Client-Side:**
- `client/src/pages/DevToolsPage.tsx` - Main DevTools page component
- `client/src/pages/devtools/*.tsx` - Individual tab components
- `client/src/components/DevToolsImageModels.tsx` - Image models management
- `client/src/components/DevToolsReferencePublisher.tsx` - Reference release UI
- `client/src/lib/queryClient.ts` - API request helpers and React Query setup

**Server-Side:**
- `server/routes.ts` - Admin endpoint definitions
- `server/storage.ts` - Database operations
- `server/reference/referenceLoader.ts` - Reference release loading
- `server/reference/publishReference.ts` - Reference release publishing

**Shared:**
- `shared/schema.ts` - TypeScript types and Zod schemas

### API Endpoints Reference

**Content Management:**
- `GET /api/admin/prompt_templates` - List all prompts
- `PUT /api/admin/prompt_templates/:id` - Update prompt
- `GET /api/admin/events` - List all events
- `POST /api/admin/events` - Create event
- `PUT /api/admin/events/:id` - Update event
- `GET /api/admin/items` - List all items
- `POST /api/admin/items` - Create item
- `PUT /api/admin/items/:id` - Update item
- `GET /api/admin/npc_templates` - List all NPCs
- `POST /api/admin/npc_templates` - Create NPC
- `PUT /api/admin/npc_templates/:id` - Update NPC
- `GET /api/admin/image_prompts` - List all image prompts
- `POST /api/admin/image_prompts` - Create image prompt
- `PUT /api/admin/image_prompts/:id` - Update image prompt

**Configuration:**
- `GET /api/admin/image-models` - List image models
- `POST /api/admin/image-models` - Create/update image model
- `PUT /api/admin/image-models/:modelKey` - Update image model
- `DELETE /api/admin/image-models/:modelKey` - Delete image model
- `GET /api/admin/mod-story-themes` - List story themes
- `POST /api/admin/mod-story-themes` - Create story theme
- `PUT /api/admin/mod-story-themes/:id` - Update story theme
- `GET /api/admin/mod-visual-styles` - List visual styles
- `POST /api/admin/mod-visual-styles` - Create visual style
- `PUT /api/admin/mod-visual-styles/:id` - Update visual style
- `GET /api/settings` - List all settings
- `PUT /api/settings/:key` - Update setting

**Reference Releases:**
- `POST /api/admin/reference/publish/:version` - Publish release
- `POST /api/admin/reference/:version/activate` - Activate release
- `GET /api/admin/reference/releases` - List all releases
- `GET /api/admin/reference/current` - Get current release

**Diagnostics:**
- `GET /api/llm-logs` - List LLM interaction logs (filterable by mode, stage, date)

**Evals:**
- `GET /api/admin/evals/status` - Tracing state, dataset counts, evaluators, settings
- `POST /api/admin/evals/dataset/sync` - Sync saved scenarios to the LangSmith dataset
- `GET /api/admin/evals/experiments` - List experiments
- `POST /api/admin/evals/experiments` - Start an experiment
- `PUT /api/admin/evals/settings` - Live sample rate and judge model

**Observability:**
- `GET /api/admin/observability/status` - Whether LangSmith tracing is on and reachable
- `GET /api/admin/observability/trace-url` - LangSmith link for a stored trace reference
- `GET /api/admin/telemetry/metrics` - Get system telemetry
- `GET /api/admin/telemetry/game/:gameId` - Get game telemetry (includes each turn's trace reference and eval scores)
- `GET /api/cache/stats` - Get cache statistics
- `GET /api/cache/images` - List cached images
- `DELETE /api/cache/images/:id` - Delete cached image
- `POST /api/cache/clear` - Clear entire cache

### Dependencies

**External Libraries:**
- `@tanstack/react-query` - Server state management
- `shadcn/ui` - UI component library
- `lucide-react` - Icon library
- `wouter` - Routing
- `zod` - Schema validation

**Internal Dependencies:**
- `@/lib/queryClient` - API helpers
- `@/hooks/use-toast` - Toast notifications
- `@/components/ui/*` - shadcn/ui components
- `@/pages/devtools/types` - TypeScript types

---

_End of DevTools Comprehensive Documentation_

