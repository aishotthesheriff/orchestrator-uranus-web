# Database Technical Architecture Document

## Executive Summary

The Quest to Uranus game uses a PostgreSQL-based database architecture with Drizzle ORM, designed for high-performance text-based adventure gaming. The system features multi-layer caching, async job processing, versioned content management, and comprehensive transaction safety.

**Technology Stack:**
- **Database**: PostgreSQL 15
- **ORM**: Drizzle ORM 0.39.1 with Drizzle Kit 0.31.4
- **Connection**: `pg` 8.11.3 (node-postgres)
- **Session Store**: `connect-pg-simple` 10.0.0
- **Caching**: Multi-layer (Reference, Image, Session)
- **Job Processing**: Async with Socket.IO real-time updates

## Core Architecture & Connectivity

### Connection Management

The backend connects to PostgreSQL using the standard `pg` client with Drizzle ORM:

```typescript
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

const db = drizzlePg(pgPool, { schema });
```

### Environment Configuration

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Express session encryption key
- `NODE_ENV` - Environment mode (development/production)

**Local Development:**
```yaml
# docker-compose.yml
postgres:
  image: postgres:15
  environment:
    POSTGRES_DB: uranus_dungeon
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: password
  ports:
    - "5432:5432"
```

**Connection String Format:**
```
postgresql://username:password@host:port/database_name
```

### Session Management

PostgreSQL-backed sessions using `connect-pg-simple`:

```typescript
app.use(session({
  store: new PgSessionStore({
    conString: process.env.DATABASE_URL,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));
```

## Complete Schema Documentation

### Table Overview

The database contains 18 core tables organized into functional groups:

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `users` | Authentication | Username/password auth |
| `games` | Game State | Complete game session data |
| `prompt_templates` | AI Prompts | Versioned, editable AI prompts |
| `llm_logs` | AI Logging | All LLM interactions |
| `events` | Game Events | Random events with triggers |
| `items` | Game Items | Equipment and consumables |
| `npc_templates` | NPCs | Crew member templates |
| `image_prompts` | Image Generation | AI image prompt templates |
| `image_models` | Image Model Catalog | Publishable model routing presets |
| `generated_images` | Image Cache | Cached generated images |
| `interview_questions` | Game Setup | Character creation questions |
| `reference_releases` | Content Versioning | Published content versions |
| `app_settings` | Configuration | Application settings |
| `image_jobs` | Async Processing | Background image generation |
| `turn_jobs` | Async Processing | Background turn processing |
| `modifiers` | Image Modifiers | Reusable image generation modifiers |
| `mod_story_themes` | Story Themes | Narrator template themes |
| `mod_visual_styles` | Visual Styles | Art style presets |

### Detailed Table Definitions

#### Core Game Tables

**`games` - Game State Storage**
```sql
CREATE TABLE games (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  seed TEXT NOT NULL,
  day INTEGER DEFAULT 1,
  turn_number INTEGER DEFAULT 0,
  segment TEXT DEFAULT 'Launch from Earth',
  absurdity INTEGER DEFAULT 2,
  stats JSONB NOT NULL,                    -- GameStats interface
  npcs JSONB NOT NULL,                     -- NPC[] interface
  equipped_items JSONB NOT NULL,           -- string[] array
  turns JSONB NOT NULL,                    -- Turn[] interface
  current_actions JSONB NOT NULL,          -- ActionChip[] interface
  running_gags JSONB NOT NULL,             -- string[] array
  event_history JSONB NOT NULL,            -- string[] array
  interview_responses JSONB DEFAULT '{}',  -- Record<string, string>
  is_complete INTEGER DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Note:** User preferences (`theme`, `mood`, `style`, `image_model_key`) were moved from the `games` table to the `users` table as part of the PCE migration (see migration `20251107_remove_preferences_from_games.sql`). Games now inherit preferences from the user's profile.

**`users` - Authentication**
```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);
```

#### Content Management Tables

**`prompt_templates` - AI Prompt Management**
```sql
CREATE TABLE prompt_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  system_content TEXT,
  inherit_global_prompt INTEGER DEFAULT 1,
  description TEXT,
  version INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`llm_logs` - AI Interaction Logging**
```sql
CREATE TABLE llm_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_template_id VARCHAR,
  game_id VARCHAR,
  turn_number INTEGER,
  function_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  metadata JSONB,
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for debugging and analytics
CREATE INDEX idx_llm_logs_game_id ON llm_logs(game_id);
CREATE INDEX idx_llm_logs_function_name ON llm_logs(function_name);
CREATE INDEX idx_llm_logs_created_at ON llm_logs(created_at);
```

**`events` - Game Events**
```sql
CREATE TABLE events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  skill TEXT NOT NULL,
  dc INTEGER NOT NULL,
  trigger_condition JSONB NOT NULL,        -- TriggerCondition interface
  pass_effect TEXT NOT NULL,
  fail_effect TEXT NOT NULL,
  tags JSONB NOT NULL,                     -- string[] array
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`items` - Game Items**
```sql
CREATE TABLE items (
  id VARCHAR PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  skill_bonus_skill TEXT,
  skill_bonus_value INTEGER,
  scene_effect_tags JSONB,                 -- string[] array
  scene_effect_effect TEXT,
  efficiency JSONB,                        -- Efficiency interface
  tags JSONB NOT NULL,                     -- string[] array
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Image Management Tables

**`image_prompts` - Image Generation Templates**
```sql
CREATE TABLE image_prompts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  inherit_visual_style INTEGER DEFAULT 1,
  size TEXT DEFAULT '1024x1024',
  quality TEXT DEFAULT 'auto',
  description TEXT,
  scene_types JSONB NOT NULL,              -- string[] array
  tags JSONB NOT NULL,                     -- string[] array
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`image_models` - Image Model Catalog**
```sql
CREATE TABLE image_models (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  hf_provider TEXT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_size TEXT NULL,
  default_quality TEXT NULL,
  default_background TEXT NULL,
  default_moderation TEXT NULL,
  allowed_sizes JSONB NULL,
  capabilities JSONB NULL,
  provider_params JSONB NULL,
  trigger_words VARCHAR(500) NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`generated_images` - Image Cache**
```sql
CREATE TABLE generated_images (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL,
  prompt_hash VARCHAR NOT NULL,
  variables_hash VARCHAR NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT DEFAULT 'image/png',
  scene_fingerprint JSONB NOT NULL,        -- Scene fingerprint data
  metadata JSONB NOT NULL,                 -- Generation metadata
  prompt_source TEXT DEFAULT 'template',
  prompt_text TEXT,
  game_id VARCHAR,
  turn_number INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  accessed_at TIMESTAMP DEFAULT NOW(),
  access_count INTEGER DEFAULT 1
);
```

#### Job Processing Tables

**`image_jobs` - Async Image Generation**
```sql
CREATE TABLE image_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id VARCHAR NOT NULL,
  turn_number INTEGER NOT NULL,
  template_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',           -- pending, processing, completed, failed
  image_url TEXT,
  image_template TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Index for job processing
CREATE INDEX idx_image_jobs_status ON image_jobs(status, created_at);
```

**`turn_jobs` - Async Turn Processing**
```sql
CREATE TABLE turn_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id VARCHAR NOT NULL,
  action_payload JSONB NOT NULL,           -- ActionInput interface
  status TEXT DEFAULT 'pending',           -- pending, processing, completed, failed
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Index for job processing
CREATE INDEX idx_turn_jobs_status ON turn_jobs(status, created_at);
```

#### Versioning & Configuration Tables

**`reference_releases` - Content Versioning**
```sql
CREATE TABLE reference_releases (
  version TEXT PRIMARY KEY,
  published_by TEXT NOT NULL,
  notes TEXT,
  published_at TIMESTAMP DEFAULT NOW(),
  is_current INTEGER DEFAULT 0
);
```

**`app_settings` - Application Configuration**
```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                     -- JSON stringified
  description TEXT,
  active INTEGER DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`modifiers` - Image Generation Modifiers**
```sql
CREATE TABLE modifiers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  trigger_words VARCHAR(500),
  other_instructions TEXT,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`mod_story_themes` - Story Theme Templates**
```sql
CREATE TABLE mod_story_themes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  value TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  narrator_template TEXT NOT NULL,
  tags TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`mod_visual_styles` - Visual Style Presets**
```sql
CREATE TABLE mod_visual_styles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  exemplified_by TEXT NOT NULL,
  modifiers_diffusion TEXT,
  modifiers_transformer TEXT,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### JSONB Schema Structures

**GameStats Interface:**
```typescript
interface GameStats {
  hull: number;
  oxygen: number;
  fuel: number;
  food: number;
  morale: number;
  weirdness: number;
}
```

**NPC Interface:**
```typescript
interface NPC {
  id: string;
  name: string;
  role: string;
  affinity: number;
  status: 'Rivalry' | 'Crush' | 'Indifferent';
  lastInteraction?: string;
}
```

**Turn Interface:**
```typescript
interface Turn {
  turnNumber: number;
  narrative: string;
  checks: Check[];
  delta: DeltaChange[];
  timestamp: number;
  imageUrl?: string;
  imageTemplate?: string;
  imageStatus?: 'pending' | 'completed' | 'failed';
  imageJobId?: string;
}
```

**TriggerCondition Interface:**
```typescript
type TriggerCondition = 
  | { type: 'stat'; stat: keyof GameStats; operator: '>=' | '<=' | '>' | '<' | '=='; value: number }
  | { type: 'day_modulo'; divisor: number; remainder: number }
  | { type: 'random'; chance: number }
  | { type: 'or'; conditions: TriggerCondition[] }
  | { type: 'and'; conditions: TriggerCondition[] };
```

## Data Access Layer

### IStorage Interface

The `IStorage` interface provides a clean abstraction over all database operations:

```typescript
export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Game state management
  getGameState(id: string): Promise<GameState | undefined>;
  getGamesByUsername(username: string): Promise<GameState[]>;
  createGameState(state: GameState): Promise<GameState>;
  updateGameState(id: string, state: GameState): Promise<GameState>;
  deleteGameState(id: string): Promise<void>;

  // Content management
  getPromptTemplate(name: string): Promise<PromptTemplate | undefined>;
  getAllEvents(): Promise<Event[]>;
  getActiveItems(): Promise<ItemRow[]>;
  // ... additional methods for all entities

  // Transaction management
  processTurnWithTransaction(
    gameId: string,
    processor: (state: GameState) => Promise<GameState>
  ): Promise<GameState>;

  // Job processing
  createImageJob(job: InsertImageJob): Promise<ImageJob>;
  getPendingImageJobs(limit?: number): Promise<ImageJob[]>;
  // ... additional job methods
}
```

### DatabaseStorage Implementation

The `DatabaseStorage` class implements all database operations using Drizzle ORM:

```typescript
export class DatabaseStorage implements IStorage {
  async getGameState(id: string): Promise<GameState | undefined> {
    const [game] = await db.select().from(games).where(eq(games.id, id));
    if (!game) return undefined;

    return {
      id: game.id,
      username: game.username,
      seed: game.seed,
      // ... convert database row to GameState interface
    };
  }

  async updateGameState(id: string, state: GameState): Promise<GameState> {
    await db
      .update(games)
      .set({
        username: state.username,
        // ... update all fields
        updatedAt: new Date(),
      })
      .where(eq(games.id, id));
    return state;
  }
}
```

## Transaction Management & Concurrency

### Row-Level Locking

Critical game state updates use row-level locking to prevent race conditions:

```typescript
async processTurnWithTransaction(
  gameId: string,
  processor: (state: GameState) => Promise<GameState>
): Promise<GameState> {
  return await db.transaction(async (tx) => {
    // Lock the game state row for update
    const [state] = await tx
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .for('update'); // Row-level lock
    
    if (!state) {
      throw new Error('Game not found');
    }

    // Convert to GameState and process
    const gameState = convertToGameState(state);
    const updatedState = await processor(gameState);

    // Update within transaction
    await tx.update(games).set(/* ... */).where(eq(games.id, gameId));
    return updatedState;
  });
}
```

### Job Queue Patterns

**Turn Job Processing:**
```typescript
export class TurnJobProcessor {
  private async processJob(job: TurnJob) {
    try {
      await storage.updateTurnJob(job.id, { status: 'processing' });

      // Execute turn inside transaction
      const updatedState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
        const action = job.actionPayload as ActionInput;
        return await processTurnLogic(state, action);
      });

      // Enqueue image job
      const imgJob = await storage.createImageJob({
        gameId: updatedState.id,
        turnNumber: updatedState.turnNumber,
        templateName,
        status: 'pending'
      });

      await storage.updateTurnJob(job.id, { status: 'completed' });
    } catch (error) {
      await storage.updateTurnJob(job.id, { status: 'failed', error: error.message });
    }
  }
}
```

**Image Job Processing:**
```typescript
export class ImageJobProcessor {
  private async processJob(job: ImageJob) {
    try {
      await storage.updateImageJob(job.id, { status: 'processing' });
      
      // Cache-first lookup
      const { promptHash, variablesHash } = await computeImageKeys(job.templateName, gameState);
      const cached = await storage.getGeneratedImageByHash(promptHash, variablesHash);
      
      let result;
      if (cached) {
        result = { imageUrl: `/generated_images/${path.basename(cached.filePath)}` };
      } else {
        result = await generateImage(job.templateName, gameState);
      }
      
      await storage.updateImageJob(job.id, { status: 'completed', imageUrl: result.imageUrl });
    } catch (error) {
      await storage.updateImageJob(job.id, { status: 'failed', error: error.message });
    }
  }
}
```

## Multi-Layer Caching Architecture

### Reference Cache (Explicit Invalidation)

Game content is cached in memory indefinitely with explicit invalidation on content updates:

```typescript
let cache: ReferenceData | null = null;

export async function getCurrentReference(): Promise<ReferenceData> {
  if (cache) {
    return cache; // Return cached data if available
  }

  // Load from filesystem and cache indefinitely
  const currentRelease = await storage.getCurrentReferenceRelease();
  const folder = path.join(process.cwd(), "releases", currentRelease.version);
  // ... load and cache data
}

// Cache is cleared explicitly when content is published/activated
export function clearReferenceCache(): void {
  cache = null;
}
```

**Cache Invalidation Strategy:**
- Cache persists indefinitely until explicitly cleared
- Cleared automatically when publishing new reference releases
- Cleared when activating different reference versions
- No TTL-based expiration to prevent unnecessary reloads

### Image Cache (DB + Filesystem Hybrid)

Images are cached with exact and similar matching:

```typescript
// Exact match lookup
const cached = await storage.getGeneratedImageByHash(promptHash, variablesHash);
if (cached) {
  const fileName = path.basename(cached.filePath);
  return { imageUrl: `/generated_images/${fileName}` };
}

// Similar match fallback
const templateImages = await storage.getGeneratedImagesByTemplate(templateName);
const similarityScore = calculateSimilarity(sceneFingerprint, templateImages);
if (similarityScore > 0.8) {
  return { imageUrl: `/generated_images/${similarImage.fileName}` };
}
```

### Session Cache (PostgreSQL)

Sessions are stored in PostgreSQL with automatic cleanup:

```typescript
// Session configuration
app.use(session({
  store: new PgSessionStore({
    conString: process.env.DATABASE_URL,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));
```

### Cache Performance Targets

- **Reference Cache Hit Rate**: >95% (in-memory; explicit invalidation, no TTL)
- **Image Cache Hit Rate**: >70% (exact + similar matching)
- **Session Cache**: 100% (PostgreSQL-backed)

## Versioned Content System

### Reference Release System

Content is versioned and published through a release system:

```typescript
// Database schema
CREATE TABLE reference_releases (
  version TEXT PRIMARY KEY,
  published_by TEXT NOT NULL,
  notes TEXT,
  published_at TIMESTAMP DEFAULT NOW(),
  is_current INTEGER DEFAULT 0
);

// Filesystem structure
/releases/
  /v1.0.0-initial/
    - items.json
    - events.json
    - npcs.json
    - prompts.json
    - image_prompts.json
    - manifest.json
```

### Publication Workflow

1. **Content Creation**: Edit content via DevTools UI
2. **Version Creation**: Create new version with notes
3. **Publication**: Export to filesystem in `/releases/{version}/`
4. **Activation**: Set as current version in database
5. **Cache Invalidation**: Cache is explicitly cleared on publish/activate (no TTL)

### Cache Invalidation Mechanism

```typescript
// Cache invalidation
export function clearReferenceCache(): void {
  cache = null;
}

// Version switching
async setCurrentReferenceRelease(version: string): Promise<void> {
  await db.update(reference_releases).set({ is_current: 0 });
  await db.update(reference_releases).set({ is_current: 1 })
    .where(eq(reference_releases.version, version));
}
```

## Async Job Processing

### Job Lifecycle

**Status Transitions:**
- `pending` → `processing` → `completed` / `failed`

**Turn Jobs:**
```typescript
// Job creation
const turnJob = await storage.createTurnJob({
  gameId: state.id,
  actionPayload: action,
  status: 'pending'
});

// Processing
await storage.updateTurnJob(job.id, { status: 'processing' });
const result = await processTurnLogic(state, action);
await storage.updateTurnJob(job.id, { status: 'completed' });
```

**Image Jobs:**
```typescript
// Job creation
const imageJob = await storage.createImageJob({
  gameId: state.id,
  turnNumber: state.turnNumber,
  templateName,
  status: 'pending'
});

// Processing with cache lookup
const cached = await storage.getGeneratedImageByHash(promptHash, variablesHash);
if (cached) {
  // Serve cached image
} else {
  // Generate new image
}
```

### Socket.IO Integration

Real-time updates via WebSocket:

```typescript
// Turn completion
this.io.to(job.gameId).emit('turnComplete', { 
  gameId: job.gameId, 
  turnNumber: updatedState.turnNumber 
});

// Image ready
this.io.to(job.gameId).emit('imageReady', {
  jobId: job.id,
  gameId: job.gameId,
  turnNumber: job.turnNumber,
  imageUrl: result.imageUrl
});
```

## Schema Management & Migrations

### Schema-First Approach

All schema changes are made in `shared/schema.ts`:

```typescript
// Schema definition
export const games = pgTable("games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(),
  // ... other columns
});

// Drizzle configuration
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

### Migration Workflow

**Standard Workflow (Schema-First):**
1. **Modify Schema**: Edit `shared/schema.ts`
2. **Generate Migration**: `npm run db:push`
3. **Apply Migration**: Automatic on server startup
4. **Verify**: Check database structure

**Introspection Workflow (Database-First):**

When schema changes are made directly in the database, you can introspect and update the local schema:

```bash
# Run the introspection script
npx tsx scripts/introspect-schema.ts
```

This script:
- Queries the database `information_schema` to discover all tables and columns
- Generates Drizzle table definitions with correct types and constraints
- Preserves existing TypeScript types and interfaces
- Updates `shared/schema.ts` with the current database structure

**Important Notes:**
- Always review generated schema changes before committing
- The introspection script preserves game-specific types (GameState, Skill, EventTag, etc.)
- Type aliases are automatically generated for singular forms expected by the codebase
- After introspection, verify with `npx tsc --noEmit` to catch any type mismatches

### Startup Initialization

Legacy startup code (`initDatabase.ts`) previously handled schema pushes, seed data, and index verification. That module has been removed; deployments should now rely on explicit migrations and reference publishing workflows instead of implicit runtime seeding.

### Schema Introspection Tool

The project includes a custom introspection script (`scripts/introspect-schema.ts`) that synchronizes the Drizzle schema with the actual database structure. This is useful when:

- Schema changes are made directly in the database
- You need to verify schema definitions match the database
- Migrating from another ORM or raw SQL

**Usage:**
```bash
# Ensure DATABASE_URL is set in .env or environment
npx tsx scripts/introspect-schema.ts
```

**What it does:**
1. Connects to the database using `DATABASE_URL`
2. Queries `information_schema` for all tables, columns, constraints, and defaults
3. Maps PostgreSQL types to Drizzle ORM types
4. Generates table definitions with correct column types, nullability, and defaults
5. Creates insert schemas using `drizzle-zod` with appropriate `.omit()` or `.pick()` patterns
6. Preserves existing TypeScript type definitions and game-specific interfaces
7. Adds type aliases for singular forms (e.g., `User`, `InsertUser`) expected by the codebase

**Limitations:**
- Does not preserve custom insert schema patterns (always uses `.omit()` for standard fields)
- May need manual adjustment for special cases (e.g., `users` table uses `.pick()` instead of `.omit()`)
- Complex default expressions may need manual review

## Indexing Strategy

### Existing Indexes

**Performance-Critical Indexes:**
```sql
-- Exact image cache lookups
CREATE INDEX idx_generated_images_prompt_vars
ON generated_images(prompt_hash, variables_hash);

-- Reference release current version
CREATE UNIQUE INDEX idx_reference_releases_current 
ON reference_releases(is_current) WHERE is_current = TRUE;
```

### Recommended Indexes

**JSONB Indexes for Game State:**
```sql
-- Game state queries
CREATE INDEX idx_games_username ON games(username);
CREATE INDEX idx_games_updated_at ON games(updated_at);
CREATE INDEX idx_games_segment ON games(segment);

-- LLM logs for debugging
CREATE INDEX idx_llm_logs_game_id ON llm_logs(game_id);
CREATE INDEX idx_llm_logs_function_name ON llm_logs(function_name);
CREATE INDEX idx_llm_logs_created_at ON llm_logs(created_at);

-- Job processing
CREATE INDEX idx_image_jobs_status ON image_jobs(status);
CREATE INDEX idx_turn_jobs_status ON turn_jobs(status);
CREATE INDEX idx_image_jobs_created_at ON image_jobs(created_at);
CREATE INDEX idx_turn_jobs_created_at ON turn_jobs(created_at);
```

**JSONB GIN Indexes:**
```sql
-- For JSONB filtering
CREATE INDEX idx_games_stats_gin ON games USING GIN(stats);
CREATE INDEX idx_events_trigger_condition_gin ON events USING GIN(trigger_condition);
CREATE INDEX idx_items_tags_gin ON items USING GIN(tags);
```

## Performance & Scalability

### Connection Pooling

**Default Pool Settings:**
- **Local/Docker**: Standard `pg` pool (default settings)
- **Neon**: Serverless connection pooling

**Recommended Production Settings:**
```typescript
const pool = new PgPool({
  connectionString: process.env.DATABASE_URL,
  max: 20,        // Maximum connections
  min: 5,         // Minimum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Query Performance Targets

- **Game State Queries**: <50ms
- **Image Cache Lookups**: <10ms
- **Reference Data Loading**: <100ms (cached)
- **Job Processing**: <5s per job
- **LLM Log Queries**: <200ms

### Read vs Write Patterns

**Read-Heavy Workloads:**
- Game state retrieval (frequent)
- Image cache lookups (very frequent)
- Reference data access (cached)

**Write-Heavy Workloads:**
- Turn processing (moderate)
- Image generation (moderate)
- LLM logging (high volume)

### Growth Projections

**Storage Estimates:**
- **Game State**: ~5KB per game
- **Generated Images**: ~200KB-2MB per image
- **LLM Logs**: ~1KB per log entry
- **Total Growth**: ~1GB for 1000 games + 5000 images

## Data Lifecycle & Retention

### Image Cache Cleanup

**Automated Cleanup Service:**
The system includes a configurable cleanup service that runs daily at 2 AM:

```typescript
// ImageCacheCleanup service
export class ImageCacheCleanup {
  async getRetentionPolicy(): Promise<{ retentionDays: number; minAccessCount: number }> {
    const retentionDaysSetting = await storage.getSetting('image_cache_retention_days');
    const minAccessCountSetting = await storage.getSetting('image_cache_min_access_count');
    
    return {
      retentionDays: retentionDaysSetting ? parseInt(retentionDaysSetting.value) : 30,
      minAccessCount: minAccessCountSetting ? parseInt(minAccessCountSetting.value) : 5
    };
  }
  
  async cleanupOldImages(): Promise<number> {
    const policy = await this.getRetentionPolicy();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
    
    return await storage.deleteGeneratedImages({
      before: cutoffDate,
      maxAccessCount: policy.minAccessCount
    });
  }
}
```

**Configuration Settings:**
- `image_cache_retention_days`: Number of days to keep images (default: 30)
- `image_cache_min_access_count`: Minimum access count to keep images (default: 5)

**Manual Cleanup:**
```bash
# API endpoint for manual cleanup
curl -X POST http://localhost:5001/api/admin/cache/cleanup

# Remove orphaned files
find generated_images/ -name "*.png" -mtime +30 -delete
```

### LLM Log Retention

**Retention Policy:**
- **Development**: Keep all logs
- **Production**: Rotate after 30 days
- **Debugging**: Keep recent logs (7 days)

**Cleanup Query:**
```sql
DELETE FROM llm_logs 
WHERE created_at < NOW() - INTERVAL '30 days';
```

### Storage Monitoring

**Key Metrics:**
- Total storage usage
- Image cache hit rate
- Average generation time
- Database size growth

**Monitoring Queries:**
```sql
-- Cache performance
SELECT template_name, 
       COUNT(*) as total_images,
       AVG(access_count) as avg_access,
       SUM(file_size) as total_size
FROM generated_images 
GROUP BY template_name;

-- Storage usage
SELECT 
  pg_size_pretty(pg_database_size(current_database())) as db_size,
  COUNT(*) as total_games,
  (SELECT COUNT(*) FROM generated_images) as total_images;
```

## Security

### Credentials Management

**Environment Variables:**
- `DATABASE_URL`: Connection string with credentials
- `SESSION_SECRET`: Session encryption key
- Never commit secrets to version control

**Production Recommendations:**
- Use app-specific database user
- Rotate credentials regularly
- Use connection string with SSL

### Session Security

**Cookie Configuration:**
```typescript
cookie: {
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  httpOnly: true,               // Prevent XSS
  secure: process.env.NODE_ENV === 'production', // HTTPS only
  sameSite: 'strict'            // CSRF protection
}
```

### Access Control

**Database Access:**
- Application user with limited privileges
- No direct database access for users
- Read-only access for monitoring

**Network Isolation:**
- Database not exposed to public internet
- VPC/private network for production
- Firewall rules for application access only

## Monitoring & Observability

### Prometheus Metrics

**Custom Metrics:**
```typescript
// Image generation metrics
const imageJobDuration = new Histogram({
  name: 'image_job_duration_seconds',
  help: 'Duration of image generation jobs',
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const imageJobsCompleted = new Counter({
  name: 'image_jobs_completed_total',
  help: 'Total completed image jobs'
});

const imageJobsFailed = new Counter({
  name: 'image_jobs_failed_total',
  help: 'Total failed image jobs'
});

// NEW: Cache performance metrics
const imageCacheHits = new Counter({
  name: 'image_cache_hits_total',
  help: 'Number of image cache hits'
});

const imageCacheMisses = new Counter({
  name: 'image_cache_misses_total',
  help: 'Number of image cache misses'
});

// NEW: Memory usage monitoring
const memoryUsage = new Gauge({
  name: 'nodejs_memory_usage_bytes',
  help: 'Node.js memory usage in bytes',
  labelNames: ['type'] // 'rss', 'heapTotal', 'heapUsed', 'external'
});
```

### Health Checks

**Database Health:**
```typescript
app.get('/api/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
  }
});
```

### LLM Logging

**Comprehensive Logging:**
```typescript
await logLlmCall(
  'generateImage',
  finalPrompt,
  imageUrl.substring(0, 100) + '... [cached]',
  { 
    model: 'gpt-image-1-mini',
    templateName,
    variables,
    cacheHit: true,
    cacheStrategy: 'exact',
    similarityScore: 1.0
  },
  executionTime,
  gameState.id,
  gameState.turnNumber
);
```

### Performance Metrics

**Key Performance Indicators:**
- Database connection pool utilization
- Query execution times
- Cache hit rates
- Job processing throughput
- Error rates

## Backup & Disaster Recovery

### Backup Strategies

**Local/Docker Environment:**
```bash
# Full database backup
pg_dump -h localhost -U postgres -d uranus_dungeon > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
psql -h localhost -U postgres -d uranus_dungeon < backup_20240101_120000.sql
```

**Neon Environment:**
- Use Neon's automated backups
- Point-in-time recovery available
- Branching for testing

### Recovery Procedures

**Full System Recovery:**
1. Restore database from backup
2. Restore filesystem (`generated_images/`, `releases/`)
3. Verify application startup
4. Test critical functionality

**Partial Recovery:**
1. Restore specific tables
2. Rebuild indexes
3. Verify data integrity

### Testing Protocols

**Backup Testing:**
- Monthly restore tests
- Verify data integrity
- Test application functionality
- Document recovery time

**Disaster Recovery Testing:**
- Simulate database failure
- Test backup restoration
- Verify application recovery
- Update procedures as needed

## Operational Procedures

### Local Development Setup

**Quick Start:**
```bash
# Start database
docker compose up -d postgres

# Initialize schema and seed data
npm run db:push

# Start application
npm run dev
```

**Database Access:**
```bash
# Connect to database
psql postgresql://postgres:password@localhost:5432/uranus_dungeon

# View tables
\dt

# Check indexes
\di
```

### Common Maintenance Queries

**Database Health:**
```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size(current_database()));

-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check active connections
SELECT count(*) FROM pg_stat_activity;
```

**Cache Management:**
```sql
-- Image cache statistics
SELECT 
  template_name,
  COUNT(*) as total_images,
  AVG(access_count) as avg_access,
  SUM(file_size) as total_size_bytes
FROM generated_images 
GROUP BY template_name
ORDER BY total_size_bytes DESC;

-- Cleanup old images
DELETE FROM generated_images 
WHERE accessed_at < NOW() - INTERVAL '30 days' 
AND access_count < 5;
```

**Job Processing:**
```sql
-- Check job status
SELECT status, COUNT(*) 
FROM image_jobs 
GROUP BY status;

-- Check failed jobs
SELECT * FROM image_jobs 
WHERE status = 'failed' 
ORDER BY created_at DESC 
LIMIT 10;

-- Cleanup old completed jobs
DELETE FROM image_jobs 
WHERE status = 'completed' 
AND completed_at < NOW() - INTERVAL '7 days';
```

### Troubleshooting Guide

**Common Issues:**

1. **Database Connection Failed**
   - Check `DATABASE_URL` environment variable
   - Verify database is running
   - Check network connectivity

2. **Schema Migration Failed**
   - Check `drizzle.config.ts` configuration
   - Verify database permissions
   - Check for conflicting schema changes

3. **Image Generation Stuck**
   - Check `image_jobs` table for failed jobs
   - Verify OpenAI API key
   - Check filesystem permissions

4. **Cache Performance Issues**
   - Check cache hit rates
   - Verify cache invalidation hooks (publish/activate)
   - Check for memory leaks

**Debug Commands:**
```bash
# Check database logs
docker logs postgres

# Check application logs
npm run dev 2>&1 | tee app.log

# Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# Check disk space
df -h
du -sh generated_images/
```

### Emergency Procedures

**Database Down:**
1. Check database service status
2. Restart database service
3. Verify data integrity
4. Restart application

**Data Corruption:**
1. Stop application
2. Restore from latest backup
3. Verify data integrity
4. Restart application

**Storage Full:**
1. Clean up old images
2. Clean up old logs
3. Check for large files
4. Expand storage if needed

## Quick Reference

### Common SQL Queries

**Game Management:**
```sql
-- List all games for a user
SELECT id, username, turn_number, segment, created_at 
FROM games 
WHERE username = 'player1' 
ORDER BY updated_at DESC;

-- Find games by segment
SELECT id, username, turn_number 
FROM games 
WHERE segment = 'Belt' 
AND is_complete = 0;

-- Get game statistics
SELECT 
  COUNT(*) as total_games,
  COUNT(CASE WHEN is_complete = 1 THEN 1 END) as completed_games,
  AVG(turn_number) as avg_turns
FROM games;
```

**Cache Management:**
```sql
-- Image cache statistics
SELECT 
  template_name,
  COUNT(*) as images,
  SUM(file_size) as total_size,
  AVG(access_count) as avg_access
FROM generated_images 
GROUP BY template_name;

-- Find unused images
SELECT id, template_name, created_at, access_count 
FROM generated_images 
WHERE access_count = 1 
AND created_at < NOW() - INTERVAL '7 days';

-- Cleanup old images
DELETE FROM generated_images 
WHERE accessed_at < NOW() - INTERVAL '30 days' 
AND access_count < 5;
```

**Job Processing:**
```sql
-- Check job queues
SELECT 'image_jobs' as queue, status, COUNT(*) 
FROM image_jobs 
GROUP BY status
UNION ALL
SELECT 'turn_jobs' as queue, status, COUNT(*) 
FROM turn_jobs 
GROUP BY status;

-- Find stuck jobs
SELECT id, game_id, created_at, status 
FROM image_jobs 
WHERE status = 'processing' 
AND created_at < NOW() - INTERVAL '5 minutes';

-- Reset stuck jobs
UPDATE image_jobs 
SET status = 'pending' 
WHERE status = 'processing' 
AND created_at < NOW() - INTERVAL '5 minutes';
```

### Maintenance Commands

**Database Maintenance:**
```bash
# Backup database
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore database
psql $DATABASE_URL < backup_20240101.sql

# Vacuum database
psql $DATABASE_URL -c "VACUUM ANALYZE;"

# Check database size
psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
```

**Application Maintenance:**
```bash
# Restart application
docker compose restart app

# View logs
docker compose logs -f app

# Check disk usage
du -sh generated_images/
du -sh releases/

# Clean up old files
find generated_images/ -name "*.png" -mtime +30 -delete
```

### Monitoring Queries

**Performance Monitoring:**
```sql
-- Database performance
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

-- Table access patterns
SELECT 
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch
FROM pg_stat_user_tables 
ORDER BY seq_scan DESC;
```

**Cache Performance:**
```sql
-- Cache hit rate calculation
SELECT 
  COUNT(CASE WHEN metadata->>'cacheHit' = 'true' THEN 1 END) as cache_hits,
  COUNT(*) as total_requests,
  ROUND(
    COUNT(CASE WHEN metadata->>'cacheHit' = 'true' THEN 1 END) * 100.0 / COUNT(*), 
    2
  ) as hit_rate_percent
FROM llm_logs 
WHERE function_name = 'generateImage' 
AND created_at > NOW() - INTERVAL '24 hours';
```

### Useful Metrics

**Key Performance Indicators:**
- Database connection pool utilization: <80%
- Average query time: <100ms
- Image cache hit rate: >70%
- Job processing throughput: >10 jobs/minute
- Error rate: <1%

**Alert Thresholds:**
- Database size > 10GB
- Cache hit rate < 50%
- Job queue depth > 100
- Average response time > 1s
- Error rate > 5%

---

This comprehensive database architecture document provides complete coverage of the Quest to Uranus database system, from high-level architecture to operational procedures. It serves as both a technical reference for developers and an operational guide for system administrators.
