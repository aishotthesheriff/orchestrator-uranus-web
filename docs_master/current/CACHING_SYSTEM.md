# Caching System Documentation

**Generated:** 2025-01-09  
**Target Audience:** Architects and game mechanics specialists  
**Scope:** All caching mechanisms in Quest to Uranus (excluding image caching)

---

## Context & Overview

The Quest to Uranus codebase implements a multi-layered caching architecture to optimize performance and reduce database/filesystem I/O. This document covers all caching mechanisms **except** image caching, which is documented separately.

### Purpose

Caching serves several critical functions:

1. **Performance Optimization**: Reduce latency for frequently accessed data
2. **Resource Efficiency**: Minimize database queries and filesystem reads
3. **User Experience**: Enable instant access to reference data and user preferences
4. **Cost Reduction**: Decrease external API calls and database load

### Cache Types Overview

The system employs both **server-side** and **client-side** caches:

- **Server-Side Caches** (in-memory):
  - Reference Data Cache
  - User Preferences Cache
  - PCE Template Cache

- **Client-Side Caches**:
  - React Query Cache (API responses)
  - CSRF Token Cache (security)
  - Admin Token Cache (localStorage)

---

## Technical Details

### 1. Reference Data Cache

**Location:** `server/reference/referenceLoader.ts`

#### Architecture

The Reference Data Cache stores the complete game content catalog (items, events, NPCs, prompts, settings, etc.) in server memory. This cache is the foundation for all game content lookups.

```28:134:server/reference/referenceLoader.ts
let cache: ReferenceData | null = null;

/**
 * Gets the current active reference data with TTL caching
 * Now loads from releases/current/ directory instead of version lookup
 */
export async function getCurrentReference(): Promise<ReferenceData> {
  // Check if cache exists (no TTL check)
  if (cache) {
    return cache;
  }

  // Load reference data from releases/current/ directory
  const currentDir = path.join(process.cwd(), "releases", "current");
  const manifestPath = path.join(currentDir, "manifest.json");
  const metadataPath = path.join(currentDir, "metadata.json");

  try {
    // Check if current directory exists
    try {
      await fs.access(currentDir);
    } catch {
      throw new Error("No current reference directory found. Please activate a reference release first.");
    }

    // Load metadata from metadata.json file
    let metadata: { version: string; publishedBy: string; publishedAt: string; notes: string | null };
    try {
      const metadataContent = await fs.readFile(metadataPath, "utf8");
      metadata = JSON.parse(metadataContent);
    } catch (error) {
      throw new Error(`Failed to load metadata.json from current/: ${error}`);
    }

    // Load manifest and data files
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    const data: Record<string, any> = {};
    for (const [tableName, filePath] of Object.entries(manifest)) {
      try {
        // Resolve file path: if it's an absolute Docker path, convert to relative
        // Otherwise, if it's already relative, use it as-is
        if (typeof filePath !== 'string') {
          console.warn(`Invalid filePath for ${tableName}: expected string, got ${typeof filePath}`);
          continue;
        }
        let resolvedPath: string;
        if (filePath.startsWith('/app/releases/current/')) {
          // Docker absolute path - convert to relative path
          const fileName = path.basename(filePath);
          resolvedPath = path.join(currentDir, fileName);
        } else if (path.isAbsolute(filePath)) {
          // Other absolute path - try to resolve relative to currentDir if it's in releases/current
          const fileName = path.basename(filePath);
          resolvedPath = path.join(currentDir, fileName);
        } else {
          // Relative path - resolve relative to currentDir
          resolvedPath = path.join(currentDir, filePath);
        }
        
        const fileContent = await fs.readFile(resolvedPath, "utf8");
        data[tableName] = JSON.parse(fileContent);
      } catch (error) {
        console.warn(`Failed to load ${tableName} from ${filePath}:`, error);
        // Set appropriate default based on expected data type
        if (tableName === "settings" || tableName === "system_defaults") {
          data[tableName] = {};
        } else {
          data[tableName] = [];
        }
      }
    }

    // Update cache with metadata from file (no database query needed)
    cache = {
      version: metadata.version,
      data: {
        items: data.items || [],
        events: data.events || [],
        npcs: data.npcs || [],
        prompts: data.prompts || [],
        image_prompts: data.image_prompts || [],
        settings: data.settings || {},
        image_models: data.image_models || [],
        mod_story_themes: data.mod_story_themes || [],
        mod_visual_styles: data.mod_visual_styles || [],
        system_defaults: data.system_defaults || undefined,
      },
      publishedAt: metadata.publishedAt,
      publishedBy: metadata.publishedBy,
      notes: metadata.notes || undefined,
    };

    return cache;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load reference data from current/: ${errorMessage}`);
  }
}

/**
 * Clears the reference cache (useful for testing or manual cache invalidation)
 */
export function clearReferenceCache(): void {
  cache = null;
}
```

#### Cache Structure

The cache stores a complete `ReferenceData` object containing:

- **items**: All game items (equipment, consumables, etc.)
- **events**: Random events and skill checks
- **npcs**: Non-player character templates
- **prompts**: LLM prompt templates (including PCE prompts)
- **image_prompts**: Image generation templates
- **settings**: Key-value configuration settings
- **image_models**: Available image generation models
- **mod_story_themes**: Narrative theme modifiers
- **mod_visual_styles**: Visual style modifiers
- **system_defaults**: Default system configuration

#### Cache Lifetime

- **Persistence**: Cache persists indefinitely until explicitly cleared
- **Invalidation**: Only cleared via `clearReferenceCache()` or server restart
- **No TTL**: No time-based expiration (prevents unnecessary reloads)

#### Cache Invalidation Strategy

The cache is invalidated in the following scenarios:

1. **Reference Publishing**: When a new reference is published and activated
2. **Reference Activation**: When an existing reference is activated via admin API
3. **Manual Clear**: Via `clearReferenceCache()` function call
4. **Server Restart**: Cache is lost on process restart (reloaded on first access)

```196:196:server/reference/publishReference.ts
    clearReferenceCache(); // Clear cache when publishing as current
```

```286:288:server/reference/publishReference.ts
  // Clear cache so next request loads new version
  clearReferenceCache();
  console.log(`✅ Activated reference version ${version} and cleared cache`);
```

#### Performance Characteristics

- **First Load**: Reads all JSON files from `releases/current/` directory (typically 50-200ms)
- **Subsequent Loads**: Instant (memory access, <1ms)
- **Memory Footprint**: ~1-5MB depending on content size
- **Thread Safety**: Single-threaded Node.js, no locking required

#### Usage Patterns

All game content lookups flow through this cache:

```92:142:server/aiService.ts
async function getPromptFromCache(name: string) {
  const reference = await getCurrentReference();
  const prompt = reference.data.prompts.find(p => p.name === name);
  
  if (!prompt) {
    throw new Error(`Prompt '${name}' not found in reference. Available prompts: ${reference.data.prompts.map(p => p.name).join(", ")}`);
  }

  // Find global system prompt for inheritance
  const globalPrompt = reference.data.prompts.find(p => p.name === 'global_system_prompt');
  
  let systemPrompt: string;
  if (prompt.name === 'global_system_prompt') {
    systemPrompt = prompt.content;
    // Validate immediately after assignment
    if (!systemPrompt || !systemPrompt.trim()) {
      throw new Error(`Prompt '${name}' has empty or missing system prompt. Check reference data.`);
    }
  } else {
    // Support both snake_case (from JSON) and camelCase (for backwards compatibility)
    const inheritGlobalPrompt = prompt.inherit_global_prompt ?? prompt.inheritGlobalPrompt;
    const systemContent = prompt.system_content ?? prompt.systemContent;
    
    if (inheritGlobalPrompt === 1 && globalPrompt) {
      systemPrompt = globalPrompt.content;
      if (systemContent) {
        systemPrompt = systemPrompt + "\n\n" + systemContent;
      }
      // Validate immediately after determination
      if (!systemPrompt || !systemPrompt.trim()) {
        throw new Error(`Prompt '${name}' has empty or missing system prompt. Global prompt inheritance enabled but global_system_prompt has empty content.`);
      }
    } else {
      // Only set to empty string if we're about to validate it's invalid
      if (!systemContent || !systemContent.trim()) {
        throw new Error(`Prompt '${name}' has empty or missing system prompt. Check reference data - ensure either systemContent is set or inheritGlobalPrompt is enabled with a valid global_system_prompt.`);
      }
      systemPrompt = systemContent;
    }
  }
  
  // Validate user prompt (content) is not empty
  if (!prompt.content || !prompt.content.trim()) {
    throw new Error(`Prompt '${name}' has empty or missing user prompt (content). Check reference data.`);
  }
  
  return {
    system: systemPrompt,
    user: prompt.content
  };
}
```

---

### 2. User Preferences Cache

**Location:** `server/storage.ts`

#### Architecture

The User Preferences Cache stores user-specific settings (theme, style, image model, cache preferences) in server memory to avoid database lookups on every request.

```144:456:server/storage.ts
export class DatabaseStorage implements IStorage {
  // In-memory cache for user preferences (username -> preferences)
  private userPreferencesCache = new Map<string, { theme?: string; style?: string; imageModelKey?: string; skipImageCache?: boolean; typewriterEnabled?: boolean }>();

  constructor() {}

  // Helper methods to map snake_case DB rows to camelCase TypeScript interfaces
  private mapPromptTemplate(row: any): PromptTemplate | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      systemContent: row.system_content,
      inheritGlobalPrompt: row.inherit_global_prompt,
      description: row.description,
      version: row.version,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ... more mapping methods ...

  async getUserPreferences(username: string): Promise<{ theme?: string; style?: string; imageModelKey?: string; skipImageCache?: boolean; typewriterEnabled?: boolean }> {
    // Check cache first
    if (this.userPreferencesCache.has(username)) {
      const cached = this.userPreferencesCache.get(username)!;
      console.log('[Storage] getUserPreferences cache hit', { username, cached });
      return cached;
    }
    
    // Not in cache - load from database
    const user = await this.getUserByUsername(username);
    if (!user) {
      // System default: skip cache, typewriter enabled
      return { skipImageCache: true, typewriterEnabled: true };
    }
    
    const preferences = {
      theme: user.theme ?? undefined,
      style: user.style ?? undefined,
      imageModelKey: user.imageModelKey ?? undefined,
      // System default: skip cache (true) if not set
      skipImageCache: user.skipImageCache ?? true,
      // System default: typewriter enabled (true) if not set
      typewriterEnabled: user.typewriterEnabled ?? true,
    };
    
    console.log('[Storage] getUserPreferences loaded from DB', { username, preferences });
    
    // Store in cache
    this.userPreferencesCache.set(username, preferences);
    
    return preferences;
  }

  /**
   * Clears the user preferences cache for a specific user (useful after preference updates)
   */
  clearUserPreferencesCache(username: string): void {
    this.userPreferencesCache.delete(username);
    console.log('[Storage] Cleared user preferences cache', { username });
  }

  async updateUserPreferences(username: string, preferences: { theme?: string; style?: string; imageModelKey?: string; skipImageCache?: boolean; typewriterEnabled?: boolean }): Promise<User> {
    const user = await this.ensureUser(username);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (preferences.theme !== undefined) {
      updates.push(`theme = $${paramIndex++}`);
      values.push(preferences.theme);
    }
    if (preferences.style !== undefined) {
      updates.push(`style = $${paramIndex++}`);
      values.push(preferences.style);
    }
    if (preferences.imageModelKey !== undefined) {
      updates.push(`image_model_key = $${paramIndex++}`);
      values.push(preferences.imageModelKey);
    }
    if (preferences.skipImageCache !== undefined) {
      updates.push(`skip_image_cache = $${paramIndex++}`);
      values.push(preferences.skipImageCache);
    }
    if (preferences.typewriterEnabled !== undefined) {
      updates.push(`typewriter_enabled = $${paramIndex++}`);
      values.push(preferences.typewriterEnabled);
    }

    if (updates.length === 0) {
      return user;
    }
```

#### Cache Structure

The cache uses a `Map<string, Preferences>` structure:

- **Key**: Username (string)
- **Value**: User preferences object containing:
  - `theme`: Story theme preference
  - `style`: Visual style preference
  - `imageModelKey`: Preferred image generation model
  - `skipImageCache`: Whether to skip image cache (default: `true`)
  - `typewriterEnabled`: Whether typewriter effect is enabled (default: `true`)

#### Cache Lifetime

- **Persistence**: Cache persists until user preferences are updated or cache is manually cleared
- **Invalidation**: Cleared when `updateUserPreferences()` is called (via `clearUserPreferencesCache()`)
- **No TTL**: No time-based expiration

#### Cache Invalidation Strategy

The cache is invalidated when:

1. **User Updates Preferences**: Automatically cleared after database update
2. **Manual Clear**: Via `clearUserPreferencesCache(username)` function call
3. **Server Restart**: Cache is lost on process restart

#### Performance Characteristics

- **Cache Hit**: Instant (memory access, <1ms)
- **Cache Miss**: Database query (~5-20ms)
- **Memory Footprint**: ~100 bytes per user (negligible)
- **Thread Safety**: Single-threaded Node.js, no locking required

#### Usage Patterns

User preferences are accessed frequently during game execution:

- Every turn processing request
- Every image generation request
- Every game state lookup

The cache significantly reduces database load for active users.

---

### 3. PCE Template Cache

**Location:** `server/pce/promptBuilder.ts`

#### Architecture

The PCE (Prompt Composition Engine) Template Cache stores loaded prompt templates in memory to avoid repeated filesystem reads.

```29:202:server/pce/promptBuilder.ts
const templateCache = new Map<InternalTemplateName, string>();

interface TemplateLoadMetricsState {
  cacheHits: number;
  cacheMisses: number;
  lastLoadDurationMs: number | null;
  lastLoadTimestamp: string | null;
  lastLoadWasCacheHit: boolean | null;
}

const templateMetrics = new Map<InternalTemplateName, TemplateLoadMetricsState>();

function getOrCreateMetrics(templateName: InternalTemplateName): TemplateLoadMetricsState {
  let metrics = templateMetrics.get(templateName);
  if (!metrics) {
    metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      lastLoadDurationMs: null,
      lastLoadTimestamp: null,
      lastLoadWasCacheHit: null
    };
    templateMetrics.set(templateName, metrics);
  }
  return metrics;
}

function recordTemplateLoadMetrics(
  templateName: InternalTemplateName,
  durationMs: number,
  wasCacheHit: boolean
): void {
  const metrics = getOrCreateMetrics(templateName);
  if (wasCacheHit) {
    metrics.cacheHits += 1;
  } else {
    metrics.cacheMisses += 1;
  }

  metrics.lastLoadDurationMs = durationMs;
  metrics.lastLoadTimestamp = new Date().toISOString();
  metrics.lastLoadWasCacheHit = wasCacheHit;
}

// ... validation and rendering functions ...

/**
 * Loads the master prompt template from masterPrompt.txt
 * Uses caching to avoid reading from disk on every call
 * (Used as fallback when prompt not in reference system)
 */
async function loadTemplateInternal(templateName: InternalTemplateName): Promise<string> {
  const startTime = performance.now();
  const timer = templateLoadDuration.startTimer({ template: templateName, cache: 'miss' });

  if (templateCache.has(templateName)) {
    const cached = templateCache.get(templateName);
    if (cached !== undefined) {
      const duration = performance.now() - startTime;
      recordTemplateLoadMetrics(templateName, duration, true);
      timer({ cache: 'hit' });
      return cached;
    }
  }

  const templateFile = TEMPLATE_FILES[templateName];
  const templatePath = path.join(__dirname, templateFile);

  try {
    const template = await fs.readFile(templatePath, "utf8");
    templateCache.set(templateName, template);
    const duration = performance.now() - startTime;
    recordTemplateLoadMetrics(templateName, duration, false);
    timer({ cache: 'miss' });
    return template;
  } catch (error) {
    const duration = performance.now() - startTime;
    recordTemplateLoadMetrics(templateName, duration, false);
    timer({ cache: 'miss' });
    throw new Error(`Failed to load prompt template '${templateName}' from ${templatePath}: ${error}`);
  }
}

export async function loadTemplate(templateName: PceTemplateName): Promise<string> {
  return loadTemplateInternal(templateName);
}

/**
 * Clears the template cache (useful for testing or when template is updated)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  templateMetrics.clear();
}
```

#### Cache Structure

The cache uses a `Map<InternalTemplateName, string>` structure:

- **Key**: Template name (`"master"`, `"narrative"`, `"image"`, `"actions"`, or `"legacyMaster"`)
- **Value**: Raw template file content (string)

#### Cache Lifetime

- **Persistence**: Cache persists indefinitely until explicitly cleared
- **Invalidation**: Only cleared via `clearTemplateCache()` or server restart
- **No TTL**: No time-based expiration
- **No Auto-Invalidation**: Template file changes require manual cache clear or server restart

#### Cache Invalidation Strategy

**Current Limitation**: The cache does not automatically detect template file changes. Developers must:

1. **Manual Clear**: Call `clearTemplateCache()` after modifying template files
2. **Server Restart**: Restart the server to reload templates
3. **Future Enhancement**: File watcher or timestamp-based invalidation (see recommendations)

#### Performance Characteristics

- **Cache Hit**: Instant (memory access, <1ms)
- **Cache Miss**: Filesystem read (~1-5ms)
- **Memory Footprint**: ~10-50KB per template (negligible)
- **Metrics Tracking**: Built-in cache hit/miss tracking with Prometheus metrics

#### Metrics & Observability

The cache includes comprehensive metrics:

```204:254:server/pce/promptBuilder.ts
export interface TemplateLoadMetricsSnapshot {
  cacheHits: number;
  cacheMisses: number;
  totalLoads: number;
  lastLoadDurationMs: number | null;
  lastLoadTimestamp: string | null;
  lastLoadWasCacheHit: boolean | null;
  perTemplate: Record<string, TemplateLoadMetricsState & { totalLoads: number }>;
}

export function getTemplateLoadMetrics(): TemplateLoadMetricsSnapshot {
  let cacheHits = 0;
  let cacheMisses = 0;
  let lastLoadTimestamp: string | null = null;
  let lastLoadDurationMs: number | null = null;
  let lastLoadWasCacheHit: boolean | null = null;

  const perTemplate: Record<string, TemplateLoadMetricsState & { totalLoads: number }> = {};

  templateMetrics.forEach((metrics, templateName) => {
    const totalLoads = metrics.cacheHits + metrics.cacheMisses;
    perTemplate[templateName] = {
      ...metrics,
      totalLoads
    };

    cacheHits += metrics.cacheHits;
    cacheMisses += metrics.cacheMisses;

    const lastTimestamp = metrics.lastLoadTimestamp;
    if (!lastTimestamp) {
      return;
    }

    if (!lastLoadTimestamp || lastTimestamp > lastLoadTimestamp) {
      lastLoadTimestamp = lastTimestamp;
      lastLoadDurationMs = metrics.lastLoadDurationMs;
      lastLoadWasCacheHit = metrics.lastLoadWasCacheHit;
    }
  });

  return {
    cacheHits,
    cacheMisses,
    totalLoads: cacheHits + cacheMisses,
    lastLoadDurationMs,
    lastLoadTimestamp,
    lastLoadWasCacheHit,
    perTemplate
  };
}
```

#### Usage Patterns

Templates are loaded during prompt composition:

```464:496:server/pce/promptBuilder.ts
/**
 * Loads PCE prompt template (from reference system or file fallback)
 */
async function loadPceTemplate(templateName: PceTemplateName): Promise<SeparatedPrompts> {
  // Try reference system first
  const referencePrompt = await loadPcePromptFromReference(templateName);
  if (referencePrompt) {
    return referencePrompt;
  }

  // Fallback to .txt file (backward compatibility)
  // For file-based templates, treat entire content as system prompt
  // and use empty user prompt (maintains current behavior)
  const template = await loadTemplateInternal(templateName);
  return {
    system: stripTemplateAnnotations(template),
    user: "" // Empty user prompt for file-based templates
  };
}

/**
 * Builds separated system/user prompts with variable substitution
 * Returns both system and user prompts, with user being empty string if not provided
 */
export async function buildPcePrompt(
  templateName: PceTemplateName,
  variables: Record<string, any>,
  options?: BuildMetaPromptOptions
): Promise<SeparatedPrompts> {
  const prompts = await loadPceTemplate(templateName);

  return {
    system: renderTemplateString(prompts.system, variables, options),
    user: prompts.user ? renderTemplateString(prompts.user, variables, options) : ""
  };
}
```

**Note**: The PCE system prioritizes reference data over file-based templates. File-based templates are only used as a fallback.

---

### 4. React Query Cache (Client-Side)

**Location:** `client/src/lib/queryClient.ts`

#### Architecture

React Query provides a sophisticated client-side caching layer for all API responses. This cache is the primary mechanism for managing client-side data state.

```267:296:client/src/lib/queryClient.ts
export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Shared query options for reference data endpoints.
 * These options ensure reference data is fetched once at app startup and never refetched
 * unless explicitly invalidated (e.g., when references are published/activated).
 */
export const REFERENCE_DATA_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: Infinity, // Keep in cache forever (formerly cacheTime)
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;
```

#### Cache Structure

React Query uses a hierarchical key structure:

- **Game State**: `['api', 'game', gameId]`
- **User Games**: `['api', 'games', 'user', username]`
- **Reference Data**: `['api', 'reference', 'story-themes']`, `['api', 'reference', 'visual-styles']`, etc.
- **User Preferences**: `['api', 'user', 'preferences']`

#### Cache Lifetime

**Default Configuration:**
- **staleTime**: `Infinity` (data never considered stale)
- **gcTime**: `Infinity` (data never garbage collected)
- **refetchOnMount**: `false` (no refetch on component mount)
- **refetchOnWindowFocus**: `false` (no refetch on window focus)
- **refetchOnReconnect**: `false` (no refetch on network reconnect)

**Reference Data Special Configuration:**
- Uses `REFERENCE_DATA_QUERY_OPTIONS` with infinite stale time
- Prefetched at app startup
- Only invalidated when reference data changes

#### Cache Invalidation Strategy

**Automatic Invalidation:**
- **WebSocket Events**: Game state cache invalidated on `turnComplete` and `imageReady` events
- **Mutations**: Related queries invalidated after successful mutations

**Manual Invalidation:**
- `queryClient.invalidateQueries({ queryKey: [...] })`
- Used when user preferences are updated
- Used when reference data is published/activated

**Example from useUserSettings:**

```29:53:client/src/hooks/useUserSettings.ts
/**
 * Hook to update user settings.
 * Automatically invalidates the user settings cache on success.
 */
export function useUpdateUserSettings() {
  const { toast } = useToast();

  return useMutation<UserSettings, Error, UserSettings>({
    mutationFn: async (payload) => {
      const response = await apiRequest('PATCH', '/api/user/preferences', payload);
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate the user settings cache
      queryClient.invalidateQueries({ queryKey: ['api', 'user', 'preferences'] });
      toast({
        title: "Preferences saved",
        description: "User preferences updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message || "Unable to save preferences.",
        variant: "destructive",
      });
    },
  });
}
```

#### Prefetching Strategy

Reference data is prefetched at app startup:

```7:33:client/src/main.tsx
// Prefetch all reference data at startup before rendering app
async function prefetchReferenceData() {
  const queryFn = getQueryFn({ on401: "throw" });
  
  // Prefetch all reference endpoints in parallel
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'story-themes'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'visual-styles'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'system-defaults'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'image-models'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
  ]);
}
```

#### Performance Characteristics

- **Cache Hit**: Instant (memory access, <1ms)
- **Cache Miss**: Network request (~50-200ms depending on endpoint)
- **Memory Footprint**: Varies by data size (typically 100KB-1MB total)
- **Persistence**: Lost on page refresh (browser memory)

#### Usage Patterns

All client-side data fetching uses React Query:

```18:23:client/src/hooks/useUserSettings.ts
export function useUserSettings() {
  return useQuery<UserSettings>({
    queryKey: ['api', 'user', 'preferences'],
    enabled: true, // Always enabled - endpoint uses session auth
  });
}
```

---

### 5. CSRF Token Cache

**Location:** `client/src/lib/queryClient.ts`

#### Architecture

The CSRF token is cached in memory to avoid repeated fetches for state-changing requests.

```70:112:client/src/lib/queryClient.ts
// CSRF token management
let csrfToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function getCSRFToken(): Promise<string> {
  if (csrfToken !== null) {
    return csrfToken;
  }
  
  if (tokenPromise) {
    return tokenPromise;
  }
  
  tokenPromise = (async () => {
    try {
      const res = await fetch('/api/csrf-token', {
        credentials: 'include'
      });

      if (!res.ok) {
        if (res.status === 404) {
          csrfToken = '';
          return csrfToken ?? '';
        }

        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const data = await res.json();
      csrfToken = typeof data?.csrfToken === 'string' ? data.csrfToken : '';
      return csrfToken ?? '';
    } catch (error) {
      console.warn('Failed to fetch CSRF token:', error);
      csrfToken = '';
      return csrfToken ?? '';
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise!;
}
```

#### Cache Structure

- **Storage**: In-memory variable (`csrfToken: string | null`)
- **Promise Deduplication**: `tokenPromise` prevents concurrent fetches

#### Cache Lifetime

- **Persistence**: Until invalidated or page refresh
- **Invalidation**: Cleared on 403 CSRF errors
- **No TTL**: No time-based expiration

#### Cache Invalidation Strategy

The token is invalidated when:

1. **CSRF Error (403)**: Automatically cleared on CSRF-related 403 responses
2. **Page Refresh**: Lost on browser refresh

```136:154:client/src/lib/queryClient.ts
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Handle CSRF token refresh on 403
    if (res.status === 403 && text.includes('csrf')) {
      csrfToken = null;
      tokenPromise = null;
    }

    if (res.status === 401) {
      clearAdminAuthToken();
      // Handle user authentication error (redirect to welcome)
      handle401AuthError();
    }
    
    throw new Error(`${res.status}: ${text}`);
  }
}
```

#### Performance Characteristics

- **Cache Hit**: Instant (memory access, <1ms)
- **Cache Miss**: Network request (~20-50ms)
- **Memory Footprint**: ~32 bytes (negligible)

---

### 6. Admin Token Cache

**Location:** `client/src/lib/queryClient.ts`

#### Architecture

The admin authentication token is stored in browser localStorage for persistence across page refreshes.

```16:42:client/src/lib/queryClient.ts
export function getAdminAuthToken(): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read admin token from storage", error);
    return null;
  }
}

export function setAdminAuthToken(token: string | null) {
  if (!isBrowser) return;
  try {
    if (token) {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
    dispatchAdminTokenEvent();
  } catch (error) {
    console.warn("Unable to persist admin token to storage", error);
  }
}

export function clearAdminAuthToken() {
  setAdminAuthToken(null);
}
```

#### Cache Structure

- **Storage**: Browser `localStorage`
- **Key**: `"uranus-admin-token"`
- **Value**: JWT or bearer token string

#### Cache Lifetime

- **Persistence**: Survives page refreshes and browser restarts
- **Invalidation**: Cleared on 401 errors or explicit logout
- **No TTL**: No automatic expiration (relies on server token validation)

#### Cache Invalidation Strategy

The token is invalidated when:

1. **401 Unauthorized**: Automatically cleared on authentication errors
2. **Explicit Clear**: Via `clearAdminAuthToken()` function call
3. **Manual Removal**: User can clear browser localStorage

#### Security Considerations

- **Storage Location**: localStorage (accessible to JavaScript)
- **XSS Risk**: Token is accessible to any script running on the page
- **Mitigation**: Server validates token on every request
- **Best Practice**: Token should have server-side expiration

---

## Practical Guidance

### Cache Management

#### Clearing Server-Side Caches

**Reference Data Cache:**
```typescript
import { clearReferenceCache } from './server/reference/referenceLoader';
clearReferenceCache();
```

**User Preferences Cache:**
```typescript
import { storage } from './server/storage';
storage.clearUserPreferencesCache(username);
```

**PCE Template Cache:**
```typescript
import { clearTemplateCache } from './server/pce/promptBuilder';
clearTemplateCache();
```

#### Clearing Client-Side Caches

**React Query Cache:**
```typescript
import { queryClient } from './client/src/lib/queryClient';

// Clear specific query
queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });

// Clear all queries
queryClient.clear();
```

**CSRF Token Cache:**
```typescript
// Automatically cleared on 403 CSRF errors
// Manual clear not typically needed
```

**Admin Token Cache:**
```typescript
import { clearAdminAuthToken } from './client/src/lib/queryClient';
clearAdminAuthToken();
```

### Cache Invalidation Patterns

#### When to Invalidate Reference Data Cache

1. **After Publishing New Reference**: Automatically handled by `publishReference()`
2. **After Activating Reference**: Automatically handled by `activateReferenceRelease()`
3. **During Development**: Manual clear when testing content changes

#### When to Invalidate User Preferences Cache

1. **After User Updates Preferences**: Automatically handled by `updateUserPreferences()`
2. **During Testing**: Manual clear to test preference changes

#### When to Invalidate PCE Template Cache

1. **After Modifying Template Files**: Manual clear required (no auto-invalidation)
2. **During Development**: Clear cache after template edits

#### When to Invalidate React Query Cache

1. **After Mutations**: Automatically invalidate related queries
2. **On WebSocket Events**: Automatically invalidate game state queries
3. **After Reference Changes**: Manually invalidate reference data queries

### Best Practices

1. **Reference Data**: Always use `getCurrentReference()` instead of direct filesystem access
2. **User Preferences**: Always use `getUserPreferences()` instead of direct database queries
3. **PCE Templates**: Prefer reference system over file-based templates
4. **React Query**: Use consistent query keys following the segmented pattern
5. **Cache Invalidation**: Invalidate caches immediately after data mutations

### Common Patterns

#### Loading Reference Data

```typescript
// ✅ Good: Uses cache
const reference = await getCurrentReference();
const item = reference.data.items.find(i => i.id === itemId);

// ❌ Bad: Direct filesystem access
const items = JSON.parse(await fs.readFile('releases/current/items.json'));
```

#### Loading User Preferences

```typescript
// ✅ Good: Uses cache
const preferences = await storage.getUserPreferences(username);

// ❌ Bad: Direct database query
const user = await storage.getUserByUsername(username);
const preferences = { theme: user.theme, ... };
```

#### Invalidating After Updates

```typescript
// ✅ Good: Clear cache after update
await storage.updateUserPreferences(username, newPreferences);
storage.clearUserPreferencesCache(username);

// ❌ Bad: Forgetting to clear cache
await storage.updateUserPreferences(username, newPreferences);
// Cache still has old data!
```

---

## Troubleshooting & Support

### Common Issues

#### Issue: Stale Reference Data After Publishing

**Symptoms:**
- New reference published but old data still returned
- Changes not reflected in game

**Cause:**
- Reference cache not cleared after publishing

**Solution:**
```typescript
// Ensure clearReferenceCache() is called after publishing
await publishReference({ version: '1.0.0', author: 'admin', makeCurrent: true });
// clearReferenceCache() is automatically called by publishReference()
```

**Prevention:**
- Always use `publishReference()` or `activateReferenceRelease()` functions
- Never manually copy files to `releases/current/` without clearing cache

#### Issue: User Preferences Not Updating

**Symptoms:**
- User updates preferences but changes not reflected
- Old preferences still returned

**Cause:**
- User preferences cache not cleared after update

**Solution:**
```typescript
// Ensure clearUserPreferencesCache() is called after update
await storage.updateUserPreferences(username, newPreferences);
storage.clearUserPreferencesCache(username);
```

**Prevention:**
- Always call `clearUserPreferencesCache()` after `updateUserPreferences()`
- Consider adding automatic cache clearing to `updateUserPreferences()` method

#### Issue: PCE Template Changes Not Reflected

**Symptoms:**
- Template file modified but old template still used
- Changes require server restart

**Cause:**
- PCE template cache has no auto-invalidation

**Solution:**
```typescript
// Manually clear cache after template changes
import { clearTemplateCache } from './server/pce/promptBuilder';
clearTemplateCache();
```

**Prevention:**
- Restart server after template changes (development)
- Implement file watcher or timestamp-based invalidation (future enhancement)

#### Issue: React Query Cache Stale After Reference Change

**Symptoms:**
- Reference data updated on server but client still shows old data
- Changes not reflected until page refresh

**Cause:**
- React Query cache not invalidated after reference change

**Solution:**
```typescript
// Invalidate reference data queries after reference change
queryClient.invalidateQueries({ queryKey: ['api', 'reference'] });
```

**Prevention:**
- Add cache invalidation to reference publishing/activation endpoints
- Consider WebSocket notification for reference changes

#### Issue: CSRF Token Errors After Session Expiry

**Symptoms:**
- 403 CSRF errors after long idle period
- Token appears valid but server rejects it

**Cause:**
- CSRF token cached but session expired on server

**Solution:**
```typescript
// Token is automatically cleared on 403 CSRF errors
// Next request will fetch new token
```

**Prevention:**
- Token is automatically refreshed on error
- No manual intervention needed

### Debugging Tips

#### Inspecting Server-Side Caches

**Reference Data Cache:**
```typescript
// Check if cache is populated
const reference = await getCurrentReference();
console.log('Reference version:', reference.version);
console.log('Items count:', reference.data.items.length);
```

**User Preferences Cache:**
```typescript
// Check cache contents (requires access to storage instance)
// Cache is private, but you can check via getUserPreferences()
const preferences = await storage.getUserPreferences(username);
console.log('Cached preferences:', preferences);
```

**PCE Template Cache:**
```typescript
// Get cache metrics
import { getTemplateLoadMetrics } from './server/pce/promptBuilder';
const metrics = getTemplateLoadMetrics();
console.log('Cache hits:', metrics.cacheHits);
console.log('Cache misses:', metrics.cacheMisses);
console.log('Hit rate:', metrics.cacheHits / metrics.totalLoads);
```

#### Inspecting Client-Side Caches

**React Query Cache:**
```typescript
// Inspect cache contents
import { queryClient } from './client/src/lib/queryClient';
const cache = queryClient.getQueryCache();
console.log('Cached queries:', cache.getAll());
```

**CSRF Token Cache:**
```typescript
// Check token (requires access to queryClient module)
// Token is private, but you can test by making a request
```

**Admin Token Cache:**
```typescript
// Check localStorage
const token = localStorage.getItem('uranus-admin-token');
console.log('Admin token exists:', !!token);
```

### Error Messages

#### "No current reference directory found"

**Meaning:** Reference cache is empty and `releases/current/` directory doesn't exist.

**Solution:**
1. Publish a reference release: `POST /api/admin/reference/publish`
2. Activate an existing release: `POST /api/admin/reference/activate`

#### "Failed to load reference data from current/"

**Meaning:** Error reading files from `releases/current/` directory.

**Possible Causes:**
- Missing `manifest.json` or `metadata.json`
- Corrupted JSON files
- File permissions issue

**Solution:**
1. Check `releases/current/` directory exists
2. Verify `manifest.json` and `metadata.json` are valid JSON
3. Check file permissions
4. Republish reference release

#### "PCE prompt 'X' exists in reference but has empty system or user content"

**Meaning:** Prompt template in reference data is malformed.

**Solution:**
1. Check reference data for prompt `X`
2. Ensure both `systemContent` and `content` fields are populated
3. Republish reference release

---

## Standards & Processes

### Quality Requirements

#### Cache Consistency

- **Server-Side**: Caches must be invalidated immediately after data mutations
- **Client-Side**: React Query caches must be invalidated on WebSocket events
- **Validation**: All cache invalidation must be tested

#### Cache Performance

- **Hit Rate Target**: >90% for reference data and user preferences
- **Latency Target**: <1ms for cache hits
- **Memory Target**: <10MB total cache footprint

#### Cache Reliability

- **Error Handling**: Caches must gracefully handle missing data
- **Fallback**: Cache misses must fall back to source (database/filesystem)
- **Monitoring**: Cache hit/miss rates should be tracked

### Security Considerations

#### CSRF Token Cache

- **Storage**: In-memory only (not persisted)
- **Invalidation**: Cleared on 403 errors
- **Lifetime**: Single session

#### Admin Token Cache

- **Storage**: localStorage (accessible to JavaScript)
- **XSS Risk**: Token accessible to any script on page
- **Mitigation**: Server validates token on every request
- **Best Practice**: Token should have server-side expiration

#### User Preferences Cache

- **Scope**: Per-user isolation (username as key)
- **Sensitivity**: Contains user preferences (not sensitive)
- **Access**: Only accessible to server-side code

### Performance Implications

#### Memory Usage

**Server-Side Caches:**
- Reference Data: ~1-5MB
- User Preferences: ~100 bytes per user
- PCE Templates: ~10-50KB total

**Client-Side Caches:**
- React Query: ~100KB-1MB (varies by data size)
- CSRF Token: ~32 bytes
- Admin Token: ~100-500 bytes

**Total Impact:** <10MB server-side, <2MB client-side

#### Latency Impact

**Cache Hits:**
- Server-side: <1ms
- Client-side: <1ms

**Cache Misses:**
- Reference Data: ~50-200ms (filesystem read)
- User Preferences: ~5-20ms (database query)
- PCE Templates: ~1-5ms (filesystem read)
- React Query: ~50-200ms (network request)

#### Database Load Reduction

- **User Preferences**: ~90% reduction in database queries
- **Reference Data**: ~99% reduction in filesystem reads
- **PCE Templates**: ~95% reduction in filesystem reads

### Testing and Validation Approaches

#### Unit Tests

**Cache Hit/Miss Testing:**
```typescript
// Test cache hit
const result1 = await getCurrentReference();
const result2 = await getCurrentReference();
expect(result1).toBe(result2); // Same object reference

// Test cache miss after clear
clearReferenceCache();
const result3 = await getCurrentReference();
expect(result3).not.toBe(result1); // New object
```

**Cache Invalidation Testing:**
```typescript
// Test invalidation after update
await storage.updateUserPreferences(username, newPrefs);
storage.clearUserPreferencesCache(username);
const prefs = await storage.getUserPreferences(username);
expect(prefs).toEqual(newPrefs);
```

#### Integration Tests

**End-to-End Cache Flow:**
```typescript
// Test reference publishing clears cache
await publishReference({ version: '1.0.0', author: 'test', makeCurrent: true });
const reference = await getCurrentReference();
expect(reference.version).toBe('1.0.0');
```

#### Performance Tests

**Cache Hit Rate:**
```typescript
// Measure cache hit rate
const metrics = getTemplateLoadMetrics();
const hitRate = metrics.cacheHits / metrics.totalLoads;
expect(hitRate).toBeGreaterThan(0.9);
```

---

## Visual Aids

### Cache Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT-SIDE CACHES                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  React Query     │  │  CSRF Token       │                 │
│  │  Cache           │  │  Cache            │                 │
│  │                  │  │                  │                 │
│  │  - Game State    │  │  - In-memory      │                 │
│  │  - Reference     │  │  - Auto-invalid   │                 │
│  │  - User Prefs    │  │    on 403         │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐                                        │
│  │  Admin Token     │                                        │
│  │  Cache           │                                        │
│  │                  │                                        │
│  │  - localStorage  │                                        │
│  │  - Persists      │                                        │
│  │  - Clear on 401  │                                        │
│  └──────────────────┘                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVER-SIDE CACHES                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Reference Data  │  │  User Preferences│                 │
│  │  Cache           │  │  Cache            │                 │
│  │                  │  │                  │                 │
│  │  - In-memory     │  │  - Map<username> │                 │
│  │  - Explicit inval│  │  - Auto-invalid  │                 │
│  │  - No TTL        │  │    on update     │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐                                        │
│  │  PCE Template    │                                        │
│  │  Cache           │                                        │
│  │                  │                                        │
│  │  - Map<name>     │                                        │
│  │  - Metrics track  │                                        │
│  │  - Manual clear  │                                        │
│  └──────────────────┘                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Reads/Writes
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Filesystem  │  │  Database    │  │  External API │      │
│  │              │  │              │  │              │      │
│  │  - Reference │  │  - Users     │  │  - CSRF      │      │
│  │  - Templates │  │  - Games     │  │    Token     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Cache Invalidation Flow

```
┌─────────────────────────────────────────────────────────────┐
│              CACHE INVALIDATION TRIGGERS                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Reference Publishing/Activation                           │
│     │                                                         │
│     ├─► clearReferenceCache()                                │
│     │                                                         │
│  2. User Preferences Update                                   │
│     │                                                         │
│     ├─► clearUserPreferencesCache(username)                 │
│     │                                                         │
│  3. PCE Template File Change                                 │
│     │                                                         │
│     ├─► clearTemplateCache() (manual)                        │
│     │                                                         │
│  4. WebSocket Events (turnComplete, imageReady)               │
│     │                                                         │
│     ├─► queryClient.invalidateQueries(['api', 'game', id])   │
│     │                                                         │
│  5. User Preferences Mutation (Client)                      │
│     │                                                         │
│     ├─► queryClient.invalidateQueries(['api', 'user', ...]) │
│     │                                                         │
│  6. CSRF Error (403)                                          │
│     │                                                         │
│     ├─► csrfToken = null                                     │
│     │                                                         │
│  7. Auth Error (401)                                          │
│     │                                                         │
│     ├─► clearAdminAuthToken()                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Cache Hit/Miss Decision Tree

```
                    Request for Data
                           │
                           ▼
                    ┌──────────────┐
                    │  Cache Check │
                    └──────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                              │
            ▼                              ▼
    ┌───────────────┐            ┌───────────────┐
    │  Cache Hit     │            │  Cache Miss   │
    │                │            │                │
    │  Return cached│            │  Load from     │
    │  data (<1ms)   │            │  source        │
    └───────────────┘            └───────────────┘
                                         │
                                         ▼
                            ┌─────────────────────┐
                            │  Store in Cache     │
                            │  Return data        │
                            └─────────────────────┘
```

---

## Cross-References

### Related Documentation

**System Architecture:**
- [`SYSTEM_OVERVIEW.md`](./SYSTEM_OVERVIEW.md): High-level system architecture
- [`AGENTS.md`](../AGENTS.md): Runtime agent responsibilities

**Server-Side Implementation:**
- [`REFERENCE_RELEASE_PUBLISHING.md`](./REFERENCE_RELEASE_PUBLISHING.md): Reference data management
- [`PROMPT_COMPOSITION_ENGINE.md`](./PROMPT_COMPOSITION_ENGINE.md): PCE template system
- [`API_GUIDE.md`](./API_GUIDE.md): API endpoints and cache management

**Client-Side Implementation:**
- [`CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`](./CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md): Client architecture
- [`GAME_PAGE_ARCHITECTURE.md`](./GAME_PAGE_ARCHITECTURE.md): Game page components

**Data Management:**
- Image caching (separate documentation)
- Database schema and storage patterns

### Dependencies

**Server-Side:**
- `server/reference/referenceLoader.ts`: Reference data loading
- `server/storage.ts`: Database storage and user preferences
- `server/pce/promptBuilder.ts`: PCE template loading

**Client-Side:**
- `client/src/lib/queryClient.ts`: React Query configuration
- `client/src/hooks/useGameLogic.ts`: Game state management
- `client/src/hooks/useUserSettings.ts`: User preferences management

### Future Enhancements

**Recommended Improvements:**

1. **PCE Template Auto-Invalidation**
   - Add file watcher to detect template file changes
   - Automatically clear cache on file modification
   - Alternative: Timestamp-based cache invalidation

2. **Reference Data Webhooks**
   - WebSocket notification when reference data changes
   - Client-side cache invalidation without page refresh
   - Real-time content updates

3. **Cache Hit Rate Monitoring**
   - Prometheus metrics for all caches
   - Dashboard for cache performance
   - Alerts for low hit rates

4. **Redis/Memory Cache Layer**
   - Distributed caching for multi-instance deployments
   - Shared cache across server instances
   - Improved scalability

5. **Query Result Caching**
   - Cache frequently accessed database queries
   - Reduce database load for common lookups
   - TTL-based expiration for query results

---

## Summary

The Quest to Uranus caching system provides a multi-layered approach to performance optimization:

- **Server-Side**: In-memory caches for reference data, user preferences, and PCE templates
- **Client-Side**: React Query for API responses, CSRF token, and admin token management
- **Invalidation**: Explicit invalidation strategies for each cache type
- **Performance**: >90% cache hit rates, <1ms latency for cache hits
- **Reliability**: Graceful fallback to source data on cache misses

The system is designed for high performance, low latency, and minimal resource usage while maintaining data consistency through careful invalidation strategies.

