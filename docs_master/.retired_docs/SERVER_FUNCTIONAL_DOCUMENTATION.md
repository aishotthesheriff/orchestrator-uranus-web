# Quest to Uranus: Server Module Functional Documentation

## Overview

The server folder contains the backend implementation for the Quest to Uranus text-based adventure game. It's built with Node.js, Express, TypeScript, and uses PostgreSQL with Drizzle ORM for data persistence. The architecture follows a modular design with clear separation of concerns.

### Updated (V2) Highlights
- Async turn and image job processors with Socket.IO events
- Publishable Image Models and Modifiers; runtime resolved from the current reference
- Reference system with publish/activate workflows and public reference APIs
- Settings with feature flags (e.g., `pce_enabled`) exported in reference
- Provider-abstracted image generation (OpenAI/Hugging Face) with cache-first strategy
- Hardened middleware: CSRF, rate limiting, security logging, health/metrics

## Core Architecture

### Main Entry Point
- **`index.ts`** - Express server setup, middleware configuration, session management, and application startup

### Database Layer
- **`db.ts`** - Database connection management using PostgreSQL (`pg` + Drizzle)
- **`storage.ts`** - Database abstraction layer implementing IStorage interface for all data operations

### API Layer
- **`routes.ts`** - RESTful API endpoints for game operations, content management, and admin functions

### Reference System (Publish/Activate)
- Reference snapshots export JSON for: `items`, `events`, `npcs`, `prompts`, `image_prompts`, `settings`, `image_models`, `modifiers`.
- Runtime loads the “current” reference from `/releases/<version>/manifest.json`; data is cached in-memory until explicitly invalidated.
- Image model resolution prefers the reference snapshot; falls back to live DB only when needed.

Operational how‑to:
1. Publish: Use admin API or tooling to generate `/releases/<version>/*` and manifest.
2. Activate: Set a reference version to current; cache is cleared automatically.
3. Verify: Hit `/api/reference/*` endpoints to confirm data matches the release.

## Module Breakdown

### 1. Core Application (`index.ts`)

**Purpose**: Main server entry point and Express application configuration

**Key Functions**:
- Environment validation (DATABASE_URL, SESSION_SECRET)
- Session management with PostgreSQL store
- Request/response logging middleware
- Database initialization
- Vite development server setup
- Static file serving for production
- CSRF protection (configurable via `CSRF_ENABLED`)
- Rate limiting (global and AI endpoints)
- Suspicious request logging and security metrics

**Dependencies**: Express, session management, database initialization, Vite setup

### 2. Database Management (`db.ts`)

**Purpose**: Database connection and ORM configuration

**Key Features**:
- Connection pooling via `pg`
- Configurable through `DATABASE_URL`
- Drizzle ORM integration for type-safe queries

### 3. Data Storage Layer (`storage.ts`)

**Purpose**: Database abstraction layer implementing comprehensive data access patterns

**Interface Methods**:
- **User Management**: CRUD operations for users
- **Game State**: Complete game state persistence and retrieval
- **Content Management**: Prompts, events, items, NPCs, image prompts, interview questions
- **AI Logging**: LLM call tracking and analytics
- **Generated Image Cache**: Storage and retrieval with similarity matching (distinct from reference snapshot cache)

**Key Features**:
- Type-safe database operations
- Comprehensive CRUD interfaces
- Image cache management with access tracking
- LLM log analytics and cleanup

### 4. API Routes (`routes.ts`)

This document is conceptual. For the full, authoritative list of endpoints and payloads, see the API Guide (`docs_master/API_GUIDE.md`).

Key route groups:
- Game management: start, fetch, async action, delete, per-game updates
- Content admin: prompts, events, items, NPC templates, image prompts, interview questions
- Reference: public `/api/reference/*`, admin publish/activate
- Image Models: public `/api/reference/image-models`, admin `/api/admin/image-models`
- Settings & Logs: `/api/settings`, `/api/llm-logs`
- Health & Metrics: `/api/health`, `/metrics`

### 5. AI Service (`aiService.ts`)

**Purpose**: OpenAI integration for text and image generation

**Text Generation Functions**:
- `generateIntroTurnContent()` - Create the Turn 0 narrative payload
- `generateNarrative()` - Generate turn-based story content
- `generateActions()` - Create available action choices
- `mapCustomActionToIntent()` - Classify custom player actions
- `generateInterviewAnswer()` - Generate AI responses

**Image Generation Functions**:
- `generateImage()` - Main image generation with cache-first (exact) and similarity matching
- `testGenerateImage()` - Testing interface (provider abstraction) with debug info
- `computeImageKeys()` - Compute prompt/variable hashes without model calls

**Key Features**:
- Comprehensive LLM call logging
- Variable substitution in prompts
- Interview response integration
- Error handling with fallback content
- Execution time tracking

**Caching Strategy**:
- Exact match caching by prompt + variables hash
- Similar scene detection via scene fingerprint comparison
- Scene fingerprinting includes segment, day, stats, items, NPCs, template metadata

### Prompt Composition Engine (PCE)
- Controlled by the `pce_enabled` setting (exported in reference).
- Leverages Modifiers (Theme, Mood, Style) to steer prompt composition via `label`, `description`, `trigger_words`, and `other_instructions`.
- DevTools → PCE tab provides CRUD for modifiers; publish/activate to include them in the next reference.

### 6. Game Engine (`gameEngine.ts`)

**Purpose**: Core game logic and mechanics

**Key Components**:
- **SeededRandom**: Deterministic random number generation
- **Daily Consumption**: Resource depletion calculations with item efficiency
- **Segment Progression**: Journey phase management (Departure → Belt → Outer Darkness → Approach)
- **DC Scaling**: Difficulty calculation based on turn number and morale
- **State Management**: Stat clamping, fail/win condition checking
- **Event System**: Dynamic event triggering and evaluation

**Game Mechanics**:
- Deterministic dice rolls using seeded RNG
- Daily resource consumption with item efficiency modifiers
- Event triggering based on complex conditions
- Stat delta application and clamping

### 7. Caching System

Note on terminology: Reference data (prompts, events, items, NPCs, image prompts) is delivered via the reference snapshot system with explicit cache invalidation when you publish/activate a release (no TTL). Unless explicitly called out as "reference snapshot cache", the term "cache" in this section refers to the generated image cache.

#### Prompt Cache (`promptCache.ts`)
**Purpose**: AI prompt template management and inheritance

**Features**:
- Database-to-JSON export/import
- Prompt inheritance (global + scenario-specific)
- Memory caching for performance
- Template compilation with variable substitution

#### Event Cache (`eventCache.ts`)
**Purpose**: Dynamic event system with condition evaluation

**Features**:
- Event loading from database
- Trigger condition compilation to executable functions
- Complex condition evaluation (stat checks, day modulo, random, logical operators)
- Active event filtering

#### Item Cache (`itemCache.ts`)
**Purpose**: Equipment and tool management

**Features**:
- Item loading and conversion from database format
- Skill bonus and scene effect application
- Efficiency modifier calculations
- Active item filtering

#### NPC Cache (`npcCache.ts`)
**Purpose**: Crew member template management

**Features**:
- NPC template loading
- Initial NPC state creation for new games
- Template-to-runtime conversion
- Active template filtering

#### Image Prompt Cache (`imagePromptCache.ts`)
**Purpose**: Scene visualization template management

**Features**:
- Image prompt compilation with visual style inheritance
- Template loading and caching
- Scene type and tag filtering
- Visual style integration

#### Reference Snapshot Cache
- In-memory cache of the current reference (no TTL).
- Explicitly cleared on publish or activate operations.
- Snapshot includes: `items`, `events`, `npcs`, `prompts`, `image_prompts`, `settings`, and now `image_models` and `modifiers`.

### 8. Image Management

#### Image Storage (`imageStorage.ts`)
**Purpose**: File system management for generated images

**Features**:
- Base64 to file conversion
- Unique filename generation
- File cleanup and orphan detection
- Storage statistics
- Directory management

#### Cache Utilities (`cacheUtils.ts`)
**Purpose**: Advanced caching algorithms and similarity detection

**Key Functions**:
- **Hashing**: Prompt and variable hash generation
- **Scene Fingerprinting**: Comprehensive scene context capture
- **Similarity Calculation**: Text, object, and scene similarity algorithms
- **Cache Key Generation**: Multi-factor cache key creation

**Similarity Features**:
- Text similarity using word-based Jaccard index
- Object similarity with nested structure support
- Scene similarity with weighted scoring
- Threshold-based filtering

### 9. Image Provider Abstraction

#### Registry (`image/registry.ts`)
Providers and presets for image generation:
- Providers: `openai`, `huggingface`
- Presets: `gpt-image-1-mini`, `sdxl-turbo`, `flux-schnell`, `sd-large-turbo`, `sd-medium-turbo`, `claymation-xl`, `retro-pixel-flux`

### Image Models
- Image Models: Publishable catalog mapping a logical `model_key` to `{ provider, modelName, hfProvider }`. Used by the generator to route to OpenAI or Hugging Face. Included in the reference snapshot and exposed via `/api/reference/image-models`; admin CRUD at `/api/admin/image-models`.
#### Generator Entrypoint (`image/index.ts`)
`generateWithModelKey(modelKey, settings)` dispatches to the appropriate provider using the registry.

### 10. Development Tools

#### Vite Integration (`vite.ts`)
**Purpose**: Development server and build tooling

**Features**:
- Hot module replacement in development
- Static file serving in production
- Template transformation for cache busting
- Error handling and logging

### 11. Database Initialization (Deprecated)

Legacy startup logic formerly lived in `initDatabase.ts`, which also handled schema pushes and seed data. That module has been removed; database migrations and reference data management now occur through external tooling and curated content workflows.

#### Database Seeding (Removed)
The standalone `seedDatabase.ts` script previously supported “smart” and “force” seeding modes that pulled from the various `seed*.ts` helpers. These scripts were removed because the embedded data was out of date—seed operations should now be performed via vetted migrations or manual curation.

### 12. Seed Data Modules (Removed)

All `seed*.ts` helpers (events, items, NPCs, prompts, interview questions, and image prompts) have been deleted along with the inaccurate sample data they provided. Any automated content bootstrapping should now be handled by the reference publishing pipeline or explicit migrations.

## Data Flow Architecture

### Game State Management
1. **Game Creation**: Initialize with Turn 0 narrative and cache-first scene image (exact match → similar → generate)
2. **Action Processing (Async)**: Enqueue job → transactional turn logic → enqueue image job → emit `turnComplete`
3. **Event System**: Check trigger conditions → Apply event effects → Update running gags
4. **Daily Progression**: Advance day (per game rules) → Apply resource consumption → Update segment

### AI Integration Flow
1. **Prompt Selection**: Choose appropriate template based on context
2. **Variable Substitution**: Replace placeholders with game state data
3. **LLM Call**: Execute with logging and error handling
4. **Response Processing**: Parse and validate AI output
5. **Caching**: Store results for future reuse

### Image Generation Pipeline
1. **Template Selection**: Choose image prompt based on scene context
2. **Exact Cache Check**: Prompt/variables hash lookup
3. **Similarity Match**: Scene fingerprint vs template images (threshold)
4. **Generation**: Provider abstraction (based on `imageModelKey`)
5. **Storage**: Persist file + DB record; update access counts

## Performance Optimizations

### Caching Strategy
- **Memory Caches**: All static data loaded at startup
- **Image Caching**: Multi-level caching with similarity detection
- **Prompt Caching**: Compiled templates with inheritance
- **Database Optimization**: Connection pooling and query optimization

### Error Handling
- **Graceful Degradation**: Fallback content for AI failures
- **Retry Logic**: Database connection with exponential backoff
- **Comprehensive Logging**: All operations logged for debugging
- **Validation**: Input validation at API boundaries

## Security Considerations

### Session Management
- PostgreSQL-backed sessions
- Secure cookie configuration
- Session secret validation

### Input Validation
- Schema validation for all API inputs
- SQL injection prevention via ORM
- File system access controls

### Environment Security
- Environment variable validation
- Database connection security
- API key management

## Monitoring and Analytics

### LLM Logging
- Complete call tracking with execution times
- Metadata capture for analysis
- Performance metrics and hit rates

### Cache Analytics
- Image cache hit rates and performance
- Storage utilization tracking
- Similarity matching effectiveness

### Enhanced Monitoring
- **Prometheus Metrics**: `/metrics` endpoint with custom counters and gauges
- **Health Checks**: `/api/health` with database latency, queue depths, and memory usage
- **Cache Performance**: Image cache hit/miss counters tracked in real-time
- **Memory Monitoring**: Node.js memory usage (RSS, heap, external) updated every 15 seconds

### Game Analytics
- Turn progression tracking
- Event trigger frequency
- Player action patterns

## Deployment Considerations

### Environment Support
- **Local Development**: Vite HMR with hot reloading and Docker-provisioned PostgreSQL
- **Production**: Static file serving with optimized builds backed by managed PostgreSQL

### Database Management
- Migrations: Prefer explicit SQL or drizzle-kit in non‑interactive mode (CI/CD). Apply before app start.
- Local dockerized Postgres:
  - SQL: `PGPASSWORD=password psql -v ON_ERROR_STOP=1 -h localhost -p 5432 -U postgres -d uranus_dungeon -f server/migrations/<file>.sql`
  - Drizzle: `DATABASE_URL=... npm run db:push` (ensure no interactive prompts in pipelines)
- No legacy seeders: content is managed via admin CRUD and reference publish/activate.

This modular architecture provides a robust, scalable foundation for the Quest to Uranus game, with clear separation of concerns, comprehensive error handling, and extensive caching for optimal performance.
