# AI Service Documentation

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** January 2025  
**Primary Module:** `server/aiService.ts`  
**Related:** For a standalone batch pipeline (no game server/DB) that generates images from a JSON file and may copy reference from `releases/current`, see [`IMAGE_PREGENERATION_PIPELINE.md`](IMAGE_PREGENERATION_PIPELINE.md).

---

## Context & Overview

### What is the AI Service?

The AI Service is the central orchestration layer for all AI-powered content generation in Quest to Uranus. It provides a unified interface for generating narrative text, action choices, and scene imagery using Large Language Models (LLMs) and image generation APIs. The service abstracts away the complexity of prompt composition, caching strategies, and provider-specific implementations while maintaining consistency across the game's content pipeline.

### Why It Exists

The AI Service exists to:

1. **Unify Content Generation**: Provide a single entry point for all AI-driven content, ensuring consistent quality and behavior across narrative, actions, and images.
2. **Enable Prompt Composition Engine (PCE)**: Orchestrate a multi-stage pipeline that generates synchronized narrative and image prompts through a sophisticated meta-prompting system.
3. **Optimize Performance**: Implement intelligent caching strategies (exact match and similarity-based) to reduce API costs and latency.
4. **Abstract Provider Complexity**: Shield downstream code from the details of different AI providers (OpenAI, Hugging Face) and model types (diffusion, transformer, flux).
5. **Ensure Observability**: Log all LLM interactions with comprehensive metadata for debugging, cost analysis, and quality monitoring.

### Purpose Within the System

The AI Service sits at the core of the game's content generation pipeline:

```
Game Orchestrator → AI Service → LLM Providers
                    ↓
              Image Providers
                    ↓
              Storage & Cache
```

It is consumed by:
- **Turn Processor Agent**: Generates turn narratives and action choices during turn execution
- **Image Processor Agent**: Generates scene imagery with cache-first optimization
- **Game Initialization**: Creates intro turn content for new games
- **API Routes**: Provides testing and debugging endpoints for content generation

---

## Technical Details

### Architecture

The AI Service follows a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│              Public API Layer                            │
│  generateTurnContentWithFlag, generateImage, etc.       │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│         Prompt Composition Engine (PCE)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Master  │→ │Narrative │→ │  Image   │→ │ Actions │ │
│  │  Stage   │  │  Stage   │  │  Stage   │  │  Stage  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│         LLM Execution & Caching Layer                    │
│  executeJsonPrompt, logLlmCall, cache management        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│         Provider Abstraction Layer                     │
│  OpenAI client, Image provider registry               │
└─────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. **Prompt Composition Engine (PCE) Pipeline**

The PCE is a four-stage sequential pipeline that generates synchronized content:

**Stage 1: Master Enrichment**
- **Purpose**: Generate contextual enrichment data that informs all subsequent stages
- **Input**: Game state, player action, theme/style selections, equipped items
- **Output**: `MasterEnrichmentData` containing context, variables, and guidance
- **Template**: Loaded from database/reference (`pce_master` prompt name) first, falls back to `server/pce/masterPrompt.txt` file
- **Function**: `runStage("master", context, upstream, options)` in `server/pce/graph/stages.ts`

**Stage 2: Narrative Generation**
- **Purpose**: Generate 6-7 sentence narrative describing the turn's events
- **Input**: Master enrichment + game state
- **Output**: `NarrativePayload` with `narration` string and optional `toneHints`
- **Template**: Loaded from database/reference (`pce_narrative` prompt name) first, falls back to `server/pce/narrativePrompt.txt` file
- **Function**: `runStage("narrative", ...)`, given the master output

**Stage 3: Image Prompt Generation**
- **Purpose**: Generate synchronized image prompt based on narrative
- **Input**: Master enrichment + narrative payload
- **Output**: `ImagePromptPayload` with `imagePrompt` string and optional `modelOverrides`
- **Template**: Loaded from database/reference (`pce_image` prompt name) first, falls back to `server/pce/imagePrompt.txt` file
- **Function**: `runStage("image", ...)`, given the master and narrative outputs

**Stage 4: Actions Generation**
- **Purpose**: Generate next-turn action choices based on narrative context
- **Input**: Master enrichment + narrative payload
- **Output**: `ActionsPayload` with array of `ActionChip` objects
- **Template**: `server/pce/actionsPrompt.txt` (loaded from database/reference first, then files)
- **Function**: `runStage("actions", ...)`, given the master and narrative outputs
- **Special Configuration**: Uses `maxTokens: 800` (higher than other stages to accommodate multiple action choices)

All four stages are one function, `runStage`; what differs per stage (variables, token limit, output check) is the `STAGES` table at the top of `server/pce/graph/stages.ts`.

The pipeline is a LangGraph graph (`server/pce/graph/graph.ts`), entered through `runPceGraph` (`server/pce/graph/index.ts`). The graph handles stage order and stops after a stage that produced nothing; `withRecovery` (`server/pce/graph/recovery.ts`) handles retry and fallback inside each stage. **Note**: The image and actions stages run in parallel (two branches of the graph) since they both depend on master + narrative but not on each other, reducing total pipeline latency. Shared types (`StageResult`, `StageMetadata`, `TurnGenerationContext`) remain in `server/pce/contentRouter.ts`. See [OBSERVABILITY_AND_EVALS.md](OBSERVABILITY_AND_EVALS.md) for the graph's options and how a turn is traced.

#### 2. **Variable Resolution System**

The service builds comprehensive variable sets for each stage:

**Master Variables** (`buildMasterVariables`):
- Game state: `TURN_NUMBER`, `DAY`, `SEGMENT`, `HULL`, `OXYGEN`, `FUEL`, `FOOD`, `MORALE`, `WEIRDNESS`
- Player context: `PLAYER_ACTION`, `CHECKS`, `ACTIVE_EVENT`, `RUNNING_GAGS`
- Equipment: `EQUIPPED_ITEMS`, `NPC_SUMMARY`
- Creative selections: `THEME_OBJECT`, `STYLE_OBJECT`, `IMAGE_MODEL`
- Model instructions: `MODEL_STYLE_INSTRUCTIONS`, `OUTPUT_FORMAT_INSTRUCTIONS`, `STYLE_MODIFIERS`

**Stage-Specific Variables**:
- **Narrative**: Inherits master + `MASTER_CONTEXT`, `MASTER_VARIABLES`, `MASTER_GUIDANCE`
- **Image**: Inherits master + `NARRATION`, `NARRATIVE_SUMMARY`, `NARRATIVE_TONE_HINTS`
- **Actions**: Subset of master + `CURRENT_NARRATIVE` (from narrative stage)

Variables are resolved through:
- `gatherTurnPromptIngredients()`: Collects all game state and preference data
- `resolvePceSelections()`: Resolves theme/style from user preferences or defaults
- `buildModelInstructionSet()`: Generates model-specific prompt instructions

#### 3. **Image Generation & Caching**

The image generation system implements a sophisticated three-tier caching strategy:

**Tier 1: Exact Match Cache**
- **Key**: SHA256 hash of prompt + SHA256 hash of variables
- **Lookup**: `storage.getGeneratedImageByHash(promptHash, variablesHash)`
- **Use Case**: Identical prompts with identical game state
- **Performance**: Sub-millisecond lookup, zero API cost

**Tier 2: Similarity-Based Cache**
- **Key**: Scene fingerprint (narrative context, game state, visual settings)
- **Algorithm**: Multi-dimensional similarity scoring (narrative, context, action, visual)
- **Threshold**: 85% overall similarity (`findSimilarScenes()`)
- **Lookup**: `storage.getGeneratedImagesByTemplate()` + fingerprint comparison
- **Use Case**: Similar scenes with minor variations (e.g., different turn numbers)
- **Performance**: ~10-50ms lookup, zero API cost

**Tier 3: New Generation**
- **Provider**: Abstracted through `server/image/index.ts` registry
- **Models**: Supports OpenAI DALL-E, Hugging Face Flux/Stable Diffusion
- **Storage**: Generated images saved to filesystem, metadata persisted to database
- **Performance**: 2-10 seconds depending on provider/model

**Cache Configuration**:
- Similarity caching can be disabled via `IMAGE_SIMILARITY_CACHE_ENABLED=false`
- Cache keys include: template name, prompt hash, variables hash, scene fingerprint
- Access tracking: `updateImageAccess()` updates last accessed timestamp

#### 4. **LLM Execution & Logging**

All story-stage LLM calls go through `executeJsonPrompt()` (`server/llm/jsonPrompt.ts`, re-exported from `server/aiService.ts`):

**Request Structure**:
```typescript
{
  stage: "master" | "narrative" | "image" | "actions",
  template: string,
  systemPrompt: string,
  userPrompt?: string,
  model?: string,           // Default: "gpt-4o-mini"
  maxTokens?: number,       // Default: 600 (actions stage uses 800)
  temperature?: number,
  topP?: number,
  frequencyPenalty?: number,
  presencePenalty?: number,
  metadata?: Record<string, unknown>,
  gameId?: string,
  turnNumber?: number,
  logName?: string
}
```

**Note**: `executeJsonPrompt()` supports backward compatibility with a legacy string signature:
- **New signature**: `executeJsonPrompt(options: PromptExecutionOptions)`
- **Legacy signature**: `executeJsonPrompt(prompt: string, options?: PromptExecutionOptions)`
- When using the legacy signature, the `prompt` string is used as the system message.

**Response Structure**:
```typescript
{
  rawContent: string,        // JSON string from LLM
  metadata: StageMetadata   // Execution metadata
}
```

**Logging** (`logLlmCall`):
- **Database**: All calls logged to `llm_logs` table with full prompt/response
- **Socket.IO**: Optional real-time streaming to browser console (if `CONSOLE_LLM_LOG=true`)
- **Metadata**: Includes model, stage, execution time, template metrics, cache status, the template's hash and source, and (when tracing is on) a `langsmith` reference to the call's trace
- **Metrics**: Prometheus metrics for duration, cache hits/misses, error rates
- **Tracing**: When LangSmith is configured, each call is also an `llm` run on the turn's trace (the clients are wrapped in `server/llm/clients.ts`). `llm_logs` is unaffected and remains the local record

### Technologies & Frameworks

**Core Dependencies**:
- **OpenAI SDK** (`openai`): Text generation via GPT-4o-mini
- **Hugging Face Inference** (`@huggingface/inference`): Image generation for Flux/Stable Diffusion
- **Node.js Crypto**: SHA256 hashing for cache keys
- **Socket.IO**: Real-time LLM log streaming (optional)

**Internal Modules**:
- `server/pce/`: Prompt Composition Engine templates and builders
- `server/cacheUtils.ts`: Scene fingerprinting and similarity algorithms
- `server/imageStorage.ts`: Filesystem image persistence
- `server/storage.ts`: Database operations for cache and logs
- `server/reference/referenceLoader.ts`: Reference data (prompts, themes, styles)
- `server/metrics.ts`: Prometheus instrumentation
- `server/image/`: Image provider abstraction layer (see "LLM Provider Details & Abstractions" section below)

---

## LLM Provider Details & Abstractions

### Text LLM Calls (OpenAI and Hugging Face)

All text generation goes through an OpenAI-compatible chat completions API. The four story stages run on the turn's **story model**, which may be an OpenAI model or one served by Hugging Face Inference Providers. Which model a turn uses, and how to add models, is documented in [LLM_MODELS.md](LLM_MODELS.md).

#### Text LLM Abstraction: `executeJsonPrompt()`

The primary abstraction for text LLM calls is `executeJsonPrompt()`, which provides:

**Features**:
- **Unified interface**: Single function for all text generation needs
- **JSON response format**: Sends `response_format: { type: "json_object" }` when the story model supports JSON mode; models without it rely on the prompt alone
- **System/User prompt separation**: Supports separate system and user prompts (OpenAI best practice)
- **Automatic logging**: All calls logged to database with full metadata
- **Metrics tracking**: Prometheus metrics for duration, stage, and model
- **Error handling**: Consistent error propagation with timing metrics

**Implementation** (`server/llm/jsonPrompt.ts`):
```typescript
export async function executeJsonPrompt(
  promptOrOptions: string | PromptExecutionOptions,
  options?: PromptExecutionOptions
): Promise<{ rawContent: string; metadata: StageMetadata }>
```

**Request Flow**:
1. Build messages array with system prompt (required) and user prompt (optional)
2. Configure OpenAI request parameters (model, maxTokens, temperature, etc.)
3. Call `getLlmClient(provider).chat.completions.create()` (`server/llm/clients.ts`) for the story model passed as `llm`
4. Extract the response and record its JSON quality, token usage and finish reason
5. Log call to database via `logLlmCall()` (failed calls are logged too, with the error)
6. Record Prometheus metrics (`llmCallDuration`)
7. Return raw content and metadata

**OpenAI Client Configuration**:
- **Text Generation Client**: Uses `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`
- **Lazy Initialization**: Client created on first use to avoid module-load errors in tests
- **Hugging Face Client**: Uses `HF_TOKEN` against `https://router.huggingface.co/v1`
- **Timeout**: `LLM_REQUEST_TIMEOUT_MS` per request (default 90 seconds)
- **Default Model**: the catalog default, falling back to a built-in `gpt-4o-mini`
- **Response Format**: `json_object` when the model supports it

**Direct Text LLM Calls** (bypassing `executeJsonPrompt`):

1. **`mapCustomActionToIntent()`** (`server/aiService.ts:1443-1494`):
   - Maps custom action text to intent categories
   - Uses direct `getOpenAI().chat.completions.create()` call
   - Model: `gpt-4o-mini`
   - Max tokens: 10 (very short response)
   - Returns: Intent string (`"repair"`, `"negotiate"`, `"cook"`, etc.)

2. **`generateInterviewAnswer()`** (`server/aiService.ts:2255-2303`):
   - Generates AI responses to interview questions
   - Uses direct `getOpenAI().chat.completions.create()` call
   - Model: `gpt-4o-mini`
   - Max tokens: 200
   - Returns: Answer string

**Text LLM Usage Patterns**:
- **PCE Pipeline**: All 4 stages (master, narrative, image, actions) use `executeJsonPrompt()`
- **Structured Outputs**: All PCE stages return JSON objects (enforced by `response_format`)
- **Error Handling**: Failed calls throw errors; no automatic retries (handled by calling code)
- **Logging**: All calls logged with stage, template, model, duration, and full prompt/response

### Image LLM Calls (OpenAI DALL-E & Hugging Face)

Image generation uses a **provider abstraction layer** that supports multiple providers and models.

#### Image Provider Abstraction Architecture

The image generation system uses a **Strategy Pattern** with the following components:

**1. ImageGenerator Interface** (`server/image/types.ts`):
```typescript
export interface ImageGenerator {
  generate(req: ImageRequest): Promise<ImageResponse>;
}

export interface ImageRequest {
  prompt: string;
  size: ImageSize;  // "1024x1024" | "1536x1024" | "1024x1536"
  quality: "low" | "medium" | "high" | "auto";
  background: "auto" | "transparent" | "opaque";
  moderation: "auto" | "low";
  inferenceProvider: "openai" | "huggingface";
  modelName: string;
  hfProvider?: InferenceProviderOrPolicy;  // For Hugging Face: "fal-ai", "inference-endpoints", etc.
}

export interface ImageResponse {
  imageUrl?: string;
  imageBase64?: string;
}
```

**2. Provider Registry** (`server/image/registry.ts`):
- **GENERATORS**: Maps provider names to generator instances
  - `"openai"` → `OpenAIImageGenerator`
  - `"huggingface"` → `HuggingFaceImageGenerator`
- There is no hardcoded model list. Models come from the catalog (next step), so adding or removing one needs no code change.

**3. Model Resolution** (`server/image/index.ts:resolveModelPreset()`):
- **Primary**: Lookup in reference data (`releases/current/data/image_models`)
- **Fallback**: Lookup in database (`image_models` table)
- **Returns**: `{ inferenceProvider, modelName, hfProvider }`
- **Throws**: Error if model not found

**4. Unified Entry Point** (`server/image/index.ts:generateWithModelKey()`):
```typescript
export async function generateWithModelKey(
  modelKey: string,  // e.g., "dall-e-3", "flux-schnell"
  req: Omit<ImageRequest, "inferenceProvider" | "modelName" | "hfProvider">,
  options?: { cache?: 'hit' | 'miss' }
): Promise<ImageResponse>
```

**Flow**:
1. Resolve `modelKey` to provider/model configuration
2. Select appropriate generator from `GENERATORS` registry
3. Record Prometheus metrics (`imageModelCallDuration`)
4. Call `generator.generate()` with full request
5. Return standardized `ImageResponse`

#### Provider Implementations

**OpenAI Provider** (`server/image/providers/openai.ts`):

- **Client**: Separate OpenAI client using `OPENAI_API_KEY` (different from text generation)
- **API Call**: `openaiImages.images.generate()`
- **Parameters**:
  - `model`: Model name (e.g., `"dall-e-3"`, `"gpt-image-1-mini"`)
  - `prompt`: Image prompt string
  - `n`: Always `1` (single image)
  - `size`: Image dimensions
  - `quality`: `"low"` | `"medium"` | `"high"` | `"auto"`
  - `background`: `"auto"` | `"transparent"` | `"opaque"`
  - `moderation`: Always `"low"` (hardcoded)
- **Response Handling**:
  - Prefers `b64_json` (base64 encoded image)
  - Falls back to `url` (temporary URL)
  - Returns: `{ imageUrl, imageBase64 }`

**Hugging Face Provider** (`server/image/providers/huggingface.ts`):

- **Client**: `InferenceClient` from `@huggingface/inference`
- **Authentication**: Uses `HF_TOKEN` environment variable
- **API Call**: `hf.textToImage()`
- **Parameters**:
  - `provider`: Hugging Face provider (`"fal-ai"`, `"inference-endpoints"`, `"serverless"`, `"auto"`)
  - `model`: Model identifier (e.g., `"black-forest-labs/FLUX.1-schnell"`)
  - `inputs`: Prompt string
  - `parameters`: `{ width, height, num_inference_steps, guidance_scale? }`. Steps and guidance come from the model's catalog row (`provider_params`, set in Dev Tools > Image Models as "Steps" and "Guidance scale"); without them steps default to 5. Distilled models (FLUX Schnell, the turbo models) need about 4 to 5 steps; SDXL needs about 30 with guidance about 7, and at 5 steps it returns smeared images. Values are validated on save (steps 1 to 100, guidance 0 to 30; see `server/image/generationParams.ts`).
- **Response Handling**:
  - Converts Blob to Buffer, then to base64
  - Returns: `{ imageBase64, imageUrl: "data:image/png;base64,..." }`
- **Error Handling**:
  - Specific error messages for 404, 429, 401, 500
  - Includes model name and provider in error messages

#### Image Model Configuration

Models are configured in the database (`image_models` table) or reference data:

**Database Schema**:
- `model_key`: Unique identifier (e.g., `"dall-e-3"`, `"flux-schnell"`)
- `provider`: `"openai"` | `"huggingface"`
- `model_name`: Provider-specific model identifier
- `class`: `"diffuser"` | `"transformer"` | `"flux"` (affects prompt instructions)
- `display_name`: Human-readable name
- `trigger_words`: Model-specific trigger words for prompt optimization
- `hf_provider`: Hugging Face provider (optional, defaults to `"fal-ai"`)
- `active`: Boolean flag (1 = active, 0 = disabled)

**Model Resolution Priority**:
1. Reference data (`releases/current/data/image_models`)
2. Database (`image_models` table)
3. Error if not found

#### Image Generation Flow

**High-Level Flow** (`server/aiService.ts:generateImage()`):

1. **Cache Check**: Check exact match cache (prompt + variables hash)
2. **Similarity Check**: Check similarity cache (scene fingerprint, 85% threshold)
3. **Model Resolution**: Resolve `modelKey` to provider/model via `generateWithModelKey()`
4. **Provider Call**: Call appropriate provider (OpenAI or Hugging Face)
5. **Storage**: Save generated image to filesystem and cache metadata to database
6. **Logging**: Log call with cache status, model, duration, and metadata

**Abstraction Benefits**:
- **Provider Agnostic**: Calling code doesn't need to know which provider is used
- **Model Flexibility**: Models can be switched via database configuration
- **Unified Interface**: Same API for OpenAI DALL-E and Hugging Face models
- **Metrics**: Consistent Prometheus metrics across all providers
- **Error Handling**: Provider-specific error messages with context

---

### Relationships & Interactions

**Upstream Dependencies**:
- **Game Orchestrator** (`server/routes.ts`): HTTP endpoints that trigger content generation
- **Turn Processor** (`server/orchestrator/workers/turnPrecomputeWorker.ts`): Calls `generateTurnContentWithFlag()` during turn processing
- **Image Processor** (`server/orchestrator/workers/imageWorker.ts`): Calls `generateImage()` or `checkImageCache()` for scene imagery
- **Game Logic** (`server/gameLogic.ts`): Uses AI Service for narrative and action generation

**Downstream Dependencies**:
- **Storage Layer** (`server/storage.ts`): Persists LLM logs, image cache metadata, game state
- **Reference System** (`server/reference/`): Provides prompt templates, theme/style definitions, image model configurations
- **Image Provider Registry** (`server/image/index.ts`): Abstracts provider-specific image generation
- **Metrics System** (`server/metrics.ts`): Records performance and usage metrics

**Data Flow**:
```
Game State + User Preferences
    ↓
gatherTurnPromptIngredients()
    ↓
buildTurnGenerationContext()
    ↓
runPceGraph()   (server/pce/graph)
    ↓
[Master → Narrative → Image ║ Actions]
    ↓
TurnContentResult (narration, imagePrompt, actions)
    ↓
Persisted to game state / image cache
```

### Configurations & Parameters

**Environment Variables**:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Custom OpenAI API endpoint (optional)
- `AI_INTEGRATIONS_OPENAI_API_KEY`: OpenAI API key for text generation
- `OPENAI_API_KEY`: OpenAI API key for image generation (legacy, may be unused)
- `CONSOLE_LLM_LOG`: Enable Socket.IO streaming of LLM logs (`"true"` to enable)
- `IMAGE_SIMILARITY_CACHE_ENABLED`: Enable similarity-based image caching (default: `true`, set to `"false"` to disable)

**Reference Settings** (from `releases/current`):
- `pce_enabled`: Boolean flag controlling PCE vs legacy prompt system
- `image_background_setting`: Image background mode (`"auto"` | `"transparent"` | `"opaque"`)
- `system_defaults.image_model_key`: Default image model for generation

**Note**: Image moderation is always set to `"low"` (hardcoded, not configurable via settings).

**Model Configuration** (from database `image_models` table):
- `model_key`: Unique identifier for the model
- `provider`: `"openai"` | `"huggingface"`
- `model_name`: Provider-specific model identifier
- `class`: `"diffuser"` | `"transformer"` | `"flux"` (affects prompt instructions)
- `display_name`: Human-readable name
- `trigger_words`: Model-specific trigger words for prompt optimization
- `active`: Boolean flag for enabling/disabling models

---

## Practical Guidance

### Step-by-Step: Generating Turn Content

**1. Prepare Input Data**
```typescript
const state: GameState = {
  id: "game-123",
  turnNumber: 5,
  day: 3,
  segment: "belt",
  stats: { hull: 80, oxygen: 90, fuel: 70, food: 60, morale: 75, weirdness: 20 },
  // ... other game state fields
};

const playerAction = "Investigate the strange signal";
const checks = [{ skill: "science", dc: 15, roll: 18, success: true }];
const userPreferences = {
  theme: "cosmic_horror",
  style: "retro_scifi",
  imageModelKey: "dall-e-3"
};
```

**2. Call Generation Function**
```typescript
import { generateTurnContentWithFlag } from './aiService';

const result = await generateTurnContentWithFlag(
  state,
  playerAction,
  checks,
  userPreferences,
  { intro: false },  // options
  null  // triggeredEvent (optional)
);
```

**3. Process Results**
```typescript
// result.narration: "The signal pulses with an otherworldly rhythm..."
// result.imagePrompt: "A mysterious alien signal pulsing in deep space..."
// result.actions: Array of ActionChip objects
// result.promptChain: Array of StageMetadata for debugging
// result.fallbackUsed: Boolean indicating if fallback was used
```

### Step-by-Step: Generating Images

**1. Generate or Retrieve Image Prompt**
```typescript
// Option A: Use prompt from turn generation
const turnResult = await generateTurnContentWithFlag(...);
const imagePrompt = turnResult.imagePrompt;

// Option B: Use cached prompt from previous turn
const lastTurn = state.turns[state.turns.length - 1];
const imagePrompt = lastTurn.imagePrompt;
```

**2. Check Cache First (Recommended)**
```typescript
import { checkImageCache } from './aiService';

// Note: checkImageCache takes templateName (imagePrompt string) as first parameter
const cached = await checkImageCache(
  imagePrompt,  // This is the image prompt string from PCE
  state,
  userPreferences,
  { turnNumber: state.turnNumber }
);

if (cached) {
  // Use cached.imageUrl
  return cached;
}
```

**3. Generate New Image**
```typescript
import { generateImage } from './aiService';

// Note: generateImage takes imagePrompt string as first parameter
const result = await generateImage(
  imagePrompt,  // This is the image prompt string from PCE
  state,
  userPreferences,
  { turnNumber: state.turnNumber }
);

// result.imageUrl: URL to generated or cached image
// result.promptUsed: Final prompt string used
// result.modelKey: Model that generated the image
```

### Code Examples & Usage Patterns

**Pattern 1: Full Turn Generation with Error Handling**
```typescript
try {
  const turnContent = await generateTurnContentWithFlag(
    gameState,
    playerAction,
    skillChecks,
    userPreferences
  );
  
  // Validate critical outputs
  if (!turnContent.narration) {
    throw new Error("PCE failed to generate narration");
  }
  
  if (!turnContent.imagePrompt) {
    throw new Error("PCE failed to generate image prompt");
  }
  
  // Use turnContent.narration, turnContent.imagePrompt, turnContent.actions
} catch (error) {
  console.error("Turn generation failed:", error);
  // Implement fallback strategy
}
```

**Pattern 2: Image Generation with Cache Optimization**
```typescript
// Always check cache first
let imageUrl: string | null = null;

const cached = await checkImageCache(
  imagePrompt,
  gameState,
  userPreferences
);

if (cached) {
  imageUrl = cached.imageUrl;
  console.log("Image cache hit:", cached.modelKey);
} else {
  // Generate new image only if cache miss
  const generated = await generateImage(
    imagePrompt,
    gameState,
    userPreferences
  );
  
  if (generated) {
    imageUrl = generated.imageUrl;
    console.log("Image generated:", generated.modelKey);
  }
}
```

**Pattern 3: Custom Action Intent Mapping**
```typescript
import { mapCustomActionToIntent } from './aiService';

const customText = "Fix the oxygen recycler with duct tape";
const intent = await mapCustomActionToIntent(customText);

// Returns: "repair" | "negotiate" | "cook" | "explore" | 
//          "improvise" | "research" | "command" | "other"
```

**Pattern 4: Interview Answer Generation**
```typescript
import { generateInterviewAnswer } from './aiService';

const question = "Why do you want to go to Uranus?";
const answer = await generateInterviewAnswer(question);

// Returns AI-generated answer based on interview_answer prompt template
```

### Best Practices & Guidelines

**1. Always Validate PCE Outputs**
- Check that `narration` is non-empty before persisting
- Verify `imagePrompt` exists before image generation
- Validate `actions` array is non-empty and contains valid `ActionChip` objects

**2. Use Cache-First Strategy for Images**
- Always call `checkImageCache()` before `generateImage()`
- Respect `userPreferences.skipImageCache` flag when provided
- Log cache hit/miss rates for monitoring

**3. Handle Stage Failures Gracefully**
- PCE stages throw errors on failure (no automatic fallback); check `result.fallbackUsed` flag (currently always `false` as errors are thrown)
- Review `result.promptChain` metadata for debugging failed stages
- The pipeline will throw descriptive errors if any stage fails; implement error handling in calling code

**4. Monitor LLM Logs**
- Query `llm_logs` table for quality analysis
- Track execution times per stage (`durationMs` in metadata)
- Review error rates and fallback usage patterns

**5. Optimize Variable Building**
- Cache `gatherTurnPromptIngredients()` results when possible
- Avoid redundant reference data lookups
- Use `buildTurnGenerationContext()` for reusable context objects

**6. Respect Rate Limits**
- Image generation is expensive; use caching aggressively
- Batch similar image requests when possible
- Monitor provider rate limits and implement backoff strategies

---

## Troubleshooting & Support

### Common Issues & Solutions

**Issue: PCE Returns Empty Narration**
- **Symptoms**: Function throws error with message "PCE turn generation failed: no narration produced"
- **Causes**:
  - JSON parse error in narrative stage
  - LLM returned invalid JSON structure
  - Template validation failed
  - Narrative stage returned empty `narration` field
- **Solutions**:
  1. Check error message for full context (includes gameId, turnNumber, promptChain)
  2. Review `llm_logs` table for the failed call
  3. Verify prompt templates exist in database/reference (check `pce_narrative` prompt)
  4. Check that theme/style selections are valid
  5. Review narrative stage metadata in error context

**Issue: Image Generation Fails with "No image model key"**
- **Symptoms**: Error: `"No image model key specified and no default model found"`
- **Causes**:
  - `userPreferences.imageModelKey` not provided
  - Default model not set in `system_defaults.image_model_key`
  - Model not found in database or reference
- **Solutions**:
  1. Provide `imageModelKey` in `userPreferences`
  2. Set default model in reference `system_defaults`
  3. Verify model exists and is active in `image_models` table

**Issue: Image Cache Not Working**
- **Symptoms**: Images always regenerated, no cache hits
- **Causes**:
  - Cache keys not matching (prompt/variable hash mismatch)
  - File system issues (images deleted but metadata remains)
  - Similarity cache disabled (`IMAGE_SIMILARITY_CACHE_ENABLED=false`)
- **Solutions**:
  1. Check `generated_images` table for existing entries
  2. Verify `filePath` is valid and file exists on filesystem
  3. Review cache key generation in `computeImageKeys()`
  4. Enable similarity cache if disabled

**Issue: LLM Calls Timing Out**
- **Symptoms**: `executeJsonPrompt()` throws timeout errors
- **Causes**:
  - Network issues with OpenAI API
  - Model overloaded or rate limited
  - Prompt too large (exceeding token limits)
- **Solutions**:
  1. Check OpenAI API status
  2. Review prompt sizes in `llm_logs` metadata
  3. Implement retry logic with exponential backoff
  4. Reduce `maxTokens` if responses are too long

**Issue: Theme/Style Not Applied**
- **Symptoms**: Generated content doesn't reflect selected theme/style
- **Causes**:
  - Theme/style not found in database
  - `resolvePceSelections()` returning defaults
  - Template variables not properly substituted
- **Solutions**:
  1. Verify theme/style exists in `story_themes` / `visual_styles` tables
  2. Check `result.theme` and `result.style` in `TurnContentResult`
  3. Review `THEME_OBJECT` and `STYLE_OBJECT` variables in prompt chain

### Error Messages & Meanings

**"Prompt 'X' not found in reference"**
- **Meaning**: Prompt template missing from reference data
- **Action**: Verify prompt exists in `releases/current/data/prompts.json` or database

**"PCE turn generation failed: no narration produced"**
- **Meaning**: Narrative stage returned empty or invalid output
- **Action**: Check narrative stage metadata in `promptChain`, review LLM logs

**"Image model key 'X' not found in reference or database"**
- **Meaning**: Specified image model doesn't exist or is inactive
- **Action**: Verify model exists in `image_models` table with `active=1`

**"JSON parse error: ..."**
- **Meaning**: LLM returned invalid JSON in a PCE stage
- **Action**: Review raw response in `llm_logs`, check prompt template for JSON format instructions

**"File missing for cached image"**
- **Meaning**: Database has cache entry but filesystem file is missing
- **Action**: Regenerate image or clean up orphaned cache entries

### Debugging Tips & Strategies

**1. Enable LLM Log Streaming**
```bash
# Set environment variable
export CONSOLE_LLM_LOG=true

# Restart server
# LLM calls will stream to browser console via Socket.IO
```

**2. Review Prompt Chain Metadata**
```typescript
const result = await generateTurnContentWithFlag(...);

// Inspect each stage's execution
result.promptChain.forEach(stage => {
  console.log(`Stage: ${stage.stage}`);
  console.log(`Duration: ${stage.durationMs}ms`);
  console.log(`Model: ${stage.model}`);
  console.log(`Error: ${stage.error}`);
  console.log(`Fallback: ${stage.fallbackUsed}`);
});
```

**3. Query LLM Logs Database**
```sql
-- Find failed PCE stages
SELECT function_name, metadata->>'stage' as stage, 
       metadata->>'error' as error, execution_time_ms
FROM llm_logs
WHERE metadata->>'fallbackUsed' = 'true'
ORDER BY created_at DESC
LIMIT 20;

-- Analyze cache performance
SELECT 
  metadata->>'cacheHit' as cache_hit,
  COUNT(*) as count,
  AVG(execution_time_ms) as avg_duration
FROM llm_logs
WHERE function_name = 'generateImage'
GROUP BY cache_hit;
```

**4. Test Individual Stages**
```typescript
import { buildTurnGenerationContext } from './aiService';
import { runPceGraph } from './pce/graph';

// Run only the master stage: once, without retry or fallback, without throwing
const { context } = await buildTurnGenerationContext(...);
const result = await runPceGraph(context, { target: "master", recover: false, mode: "lenient" });

if (!result.master.ok) {
  console.error("Master stage failed:", result.master.metadata);
}
```

The PCE Inspector (Dev Tools) does the same from the UI, on the draft prompts, and can feed a stage saved or mock upstream data.

```typescript
// A later stage on supplied upstream data
const actionsOnly = await runPceGraph(context, {
  target: "actions",
  upstream: { master: savedMasterOutput, narrative: { narration: "..." } },
  mode: "lenient"
});
```

**5. Validate Cache Keys**
```typescript
import { computeImageKeys } from './aiService';

// Note: computeImageKeys takes templateName (imagePrompt string) as first parameter
const keys = await computeImageKeys(
  imagePrompt,  // This is the image prompt string from PCE
  gameState,
  userPreferences
);

console.log("Prompt hash:", keys.promptHash);
console.log("Variables hash:", keys.variablesHash);
console.log("Model key:", keys.modelKey);
console.log("Final prompt:", keys.finalPrompt);
```

---

## Standards & Processes

### Quality Requirements & Criteria

**Narrative Quality**:
- Must be 6-7 sentences in length
- Must reflect game state (stats, items, NPCs, events)
- Must incorporate theme/style selections
- Must maintain narrative consistency with previous turns

**Image Prompt Quality**:
- Must be synchronized with narrative content
- Must include model-specific trigger words when applicable
- Must respect visual style modifiers (diffusion vs transformer)
- Must be suitable for the selected image model class

**Action Quality**:
- Must provide 3-5 action choices
- Must include risk assessment (`"Safe"` | `"Risky"` | `"Dangerous"`)
- Must map to valid intents (`repair`, `negotiate`, `cook`, etc.)
- Must be contextually relevant to current narrative

**Performance Criteria**:
- Turn generation: < 5 seconds (PCE pipeline)
- Image cache hit: < 100ms
- Image generation: < 10 seconds (provider-dependent)
- LLM call timeout: 30 seconds

### Security Considerations

**API Key Management**:
- API keys stored in environment variables, never in code
- Separate keys for text generation (`AI_INTEGRATIONS_OPENAI_API_KEY`) and images (`OPENAI_API_KEY`)
- Keys should be rotated periodically

**Input Validation**:
- All user-provided inputs (actions, preferences) validated before use
- Prompt injection prevention: user content sanitized in variable substitution
- Game state validated before passing to LLM (prevents state corruption)

**Rate Limiting**:
- Image generation rate-limited at API route level
- LLM calls should respect provider rate limits
- Cache-first strategy reduces API call volume

**Data Privacy**:
- LLM logs contain game state; ensure GDPR compliance if storing PII
- Image cache metadata includes game state fingerprints; consider data retention policies
- Socket.IO LLM log streaming should be disabled in production (`CONSOLE_LLM_LOG=false`)

### Performance Implications

**Caching Strategy Impact**:
- **Exact match cache**: Reduces API costs by ~80-90% for repeated scenarios
- **Similarity cache**: Additional ~5-10% cost reduction for similar scenes
- **Cache storage**: ~1-5MB per image (filesystem) + metadata (database)

**PCE Pipeline Overhead**:
- **Master stage**: ~1-2 seconds (context enrichment)
- **Narrative stage**: ~1-2 seconds (text generation)
- **Image stage**: ~1-2 seconds (prompt generation) - runs in parallel with actions
- **Actions stage**: ~1-2 seconds (action generation) - runs in parallel with image
- **Total**: ~3-6 seconds per turn (master → narrative → [image + actions in parallel])

**Optimization Opportunities**:
- ✅ **Already implemented**: Image and actions stages run in parallel via `Promise.all()`
- Cache master enrichment for similar game states
- Batch image generation requests when possible

**Database Load**:
- LLM logs: ~1-5KB per call, can grow to GBs over time
- Image cache metadata: ~500 bytes per image
- Consider archiving old LLM logs (> 30 days) to reduce database size

### Testing & Validation Approaches

**Unit Testing**:
- Test the pipeline with a scripted stage runner (`runPceGraph(context, { runStage })`; see `server/pce/graph/graph.test.ts`) and recovery with `server/pce/graph/recovery.test.ts`
- Mock LLM responses to validate JSON parsing and error handling
- Test cache key generation and similarity algorithms

**Integration Testing**:
- Test full PCE pipeline with mock game states
- Validate cache hit/miss behavior with known prompts
- Test fallback behavior when stages fail

**End-to-End Testing**:
- Generate complete turns and validate outputs
- Verify image generation with cache and without
- Test error recovery and fallback strategies

**Performance Testing**:
- Measure PCE pipeline latency under load
- Test cache hit rates with realistic game state variations
- Monitor LLM API rate limit compliance

**Example Test Structure**:
```typescript
describe('AI Service', () => {
  describe('generateTurnContent', () => {
    it('should generate valid narration', async () => {
      const result = await generateTurnContent(...);
      expect(result.narration).toBeTruthy();
      expect(result.narration.length).toBeGreaterThan(100);
    });
    
    it('should generate synchronized image prompt', async () => {
      const result = await generateTurnContent(...);
      expect(result.imagePrompt).toBeTruthy();
      // Image prompt should reference narrative content
      expect(result.imagePrompt.toLowerCase()).toContain(
        result.narration.substring(0, 20).toLowerCase()
      );
    });
  });
  
  describe('Image Cache', () => {
    it('should return cached image on exact match', async () => {
      // Generate image
      await generateImage(prompt1, state1, prefs);
      
      // Check cache
      const cached = await checkImageCache(prompt1, state1, prefs);
      expect(cached).toBeTruthy();
      expect(cached?.cacheHit).toBe(true);
    });
  });
});
```

---

## Visual Aids

### Recommended Diagrams

**1. PCE Pipeline Flow Diagram**
```
[Game State + Preferences]
         ↓
[gatherTurnPromptIngredients]
         ↓
[buildTurnGenerationContext]
         ↓
┌─────────────────────────────────────┐
│   Pipeline graph (runPceGraph)      │
│                                     │
│  Master Stage → Narrative Stage     │
│       ↓              ↓              │
│  [Enrichment]   [Narration]        │
│       ↓              ↓              │
│  Image Stage ║ Actions Stage        │
│  (parallel)  ║  (parallel)          │
│       ↓              ↓              │
│  [ImagePrompt]  [ActionChips]       │
└─────────────────────────────────────┘
         ↓
[TurnContentResult]
```

**2. Image Cache Strategy Diagram**
```
[Image Generation Request]
         ↓
┌────────────────────────┐
│ Exact Match Cache?    │
│ (prompt + vars hash)  │
└──────────┬────────────┘
    Yes ↓    ↓ No
   [Return]  ┌────────────────────────┐
             │ Similarity Cache?      │
             │ (scene fingerprint)    │
             └──────────┬────────────┘
                   Yes ↓    ↓ No
                  [Return]  ┌──────────────┐
                            │ Generate New │
                            │ (Provider)   │
                            └──────┬───────┘
                                   ↓
                            [Save to Cache]
```

**3. Variable Resolution Hierarchy**
```
Master Variables (base layer)
    ├─ Game State (TURN_NUMBER, DAY, SEGMENT, STATS)
    ├─ Player Context (ACTION, CHECKS, EVENT)
    ├─ Equipment (ITEMS, NPCS)
    └─ Creative (THEME, STYLE, MODEL)
         ↓
Narrative Variables (inherits master + MASTER_ENRICHMENT)
         ↓
Image Variables (inherits master + NARRATION)
         ↓
Actions Variables (subset of master + CURRENT_NARRATIVE)
```

**4. System Integration Diagram**
```
┌─────────────┐
│ Game Logic  │
└──────┬──────┘
       │
       ↓
┌─────────────┐      ┌──────────────┐
│ AI Service  │─────▶│ LLM Provider │
└──────┬──────┘      └──────────────┘
       │
       ├─────────────┐
       ↓             ↓
┌─────────────┐  ┌─────────────┐
│ Image Cache │  │ Image Prov. │
└─────────────┘  └─────────────┘
       │
       ↓
┌─────────────┐
│  Storage    │
└─────────────┘
```

---

## Cross-References

### Related Documentation

- **System Overview**: See `docs_master/current/GAME_PAGE_ARCHITECTURE.md` for game flow context
- **Agent Architecture**: See `AGENTS.md` for agent responsibilities and communication patterns
- **PCE Technical Details**: See `docs_master/.retired_docs/PCE_TECHNICAL_AUDIT.md` for PCE implementation details
- **Image Provider System**: See `server/image/index.ts` for provider abstraction layer
- **Cache Utilities**: See `server/cacheUtils.ts` for scene fingerprinting algorithms
- **Reference System**: See `server/reference/referenceLoader.ts` for prompt template loading

### Dependencies

**Required Modules**:
- `server/storage.ts`: Database operations
- `server/reference/referenceLoader.ts`: Reference data access
- `server/pce/promptBuilder.ts`: Prompt template building
- `server/pce/graph/`: PCE pipeline (LangGraph graph, stage runner, retry and fallback)
- `server/pce/contentRouter.ts`: Types shared by the pipeline and its callers
- `server/llm/jsonPrompt.ts`: The model call and LLM logging
- `server/observability/langsmith.ts`: Tracing helpers (pass-through when tracing is off)
- `server/cacheUtils.ts`: Cache key generation
- `server/imageStorage.ts`: Image filesystem operations
- `server/image/index.ts`: Image provider abstraction
- `server/metrics.ts`: Performance instrumentation

**Consumed By**:
- `server/routes.ts`: API endpoints
- `server/orchestrator/workers/turnPrecomputeWorker.ts`: Turn processing
- `server/orchestrator/workers/imageWorker.ts`: Image processing
- `server/gameLogic.ts`: Game mechanics
- `server/gameInitialization.ts`: Game setup

### API Surface

**Public Functions** (exported from `server/aiService.ts`):
- `generateTurnContentWithFlag()`: Main entry point for turn generation
- `generateTurnContent()`: PCE pipeline execution
- `generateNarrative()`: Narrative-only generation
- `generateActions()`: Actions-only generation (requires pre-generated narrative)
- `generateImage(imagePrompt, gameState, userPreferences, options?)`: Image generation with caching (takes imagePrompt string)
- `checkImageCache(templateName, gameState, userPreferences, options?)`: Cache lookup without generation (takes templateName/imagePrompt string)
- `computeImageKeys(templateName, gameState, userPreferences, options?)`: Cache key computation (takes templateName/imagePrompt string)
- `mapCustomActionToIntent()`: Action intent classification
- `generateInterviewAnswer()`: Interview response generation
- `buildTurnGenerationContext()`: Context builder for custom pipelines
- `getDefaultImageModelKey()`: Get default image model from reference
- `buildMasterVariables()`, `buildNarrativeVariables()`, `buildImageVariables()`, `buildActionsVariables()`: Variable builders (exported for testing/debugging)
- `executeJsonPrompt()`, `logLlmCall()`: Re-exported from `server/llm/jsonPrompt.ts`

Individual stages are run through `runPceGraph(context, { target })` in `server/pce/graph`, not through this module.

**Internal Functions** (not exported, but important):
- `gatherTurnPromptIngredients()`: Variable collection
- `buildMasterVariables()`, `buildNarrativeVariables()`, `buildImageVariables()`, `buildActionsVariables()`: Variable builders

---

## Appendix: Key Data Structures

### TurnContentResult
```typescript
interface TurnContentResult {
  narration: string;                    // Generated narrative text
  imagePrompt: string;                   // Generated image prompt
  rawResponse?: string | null;          // Raw LLM response (debugging)
  toneHints?: string[];                  // Narrative tone indicators
  promptChain: StageMetadata[];          // Execution metadata per stage
  masterEnrichment?: Record<string, unknown> | null;  // Master stage output
  imageModelKey: string;                 // Model used for image generation
  fallbackUsed: boolean;                  // Whether fallback was used
  imageMetadata?: ImagePromptPayload["modelOverrides"] | null;  // Model overrides
  imagePromptSource: "pce" | "template"; // Prompt source
  actions?: ActionChip[];                // Generated action choices
  theme: string;                         // Selected theme
  style: string;                         // Selected style
}
```

### StageMetadata
```typescript
interface StageMetadata {
  stage: "master" | "narrative" | "image" | "actions";
  template: string;                      // Template name used
  model?: string;                        // LLM model used
  prompt?: string;                       // Full prompt sent to LLM
  rawResponse?: string | null;           // Raw LLM response
  fallbackUsed?: boolean;               // Whether fallback was used
  error?: string;                       // Error message if failed
  durationMs?: number;                   // Execution time
  timestamp: string;                     // ISO timestamp
  extras?: Record<string, unknown>;      // Additional metadata
}
```

### ImageGenerationResult
```typescript
interface ImageGenerationResult {
  imageUrl: string;                      // URL to generated/cached image
  promptUsed: string;                    // Final prompt string used
  templateName: string;                   // Template name
  promptSource: "pce" | "template";      // Prompt source
  modelKey: string;                      // Model that generated image
}
```

---

**Document Status**: Complete  
**Maintainer**: Engineering Team  
**Review Cycle**: Quarterly or when major changes occur

