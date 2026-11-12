# API Test Guide

This guide provides comprehensive instructions for testing the image generation endpoint in the Uranus Dungeon Guide API.

## Table of Contents

- [Setup](#setup)
- [Authentication](#authentication)
- [Test Endpoint](#test-endpoint)
- [Utility Endpoints](#utility-endpoints)
- [Error Handling](#error-handling)
- [Deprecated Testing Endpoints](#deprecated-testing-endpoints)
- [Troubleshooting](#troubleshooting)

## Setup

### Prerequisites

1. **Environment Variables**: Ensure your `.env` file contains:
   ```bash
   # Required by server
   SESSION_SECRET=your-random-session-secret
   DATABASE_URL=postgres://user:pass@host:port/dbname
   OPENAI_API_KEY=your-openai-api-key-here
   AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
   AI_INTEGRATIONS_OPENAI_API_KEY=your-openai-api-key-here
   # Optional: required only when testing Hugging Face models via the abstraction
   HF_TOKEN=your-huggingface-token
   ```

2. **Server Running**: Start the development server:
   ```bash
   npm run dev
   ```

3. **Reference Data Loaded**: Ensure a current reference release or migration has populated the necessary tables. (Legacy `/api/admin/seed` endpoints have been removed.)

## Authentication

The provider-abstracted image test endpoint (`POST /api/test-generate-image`) does not require authentication headers. However, rate limiting may be applied when `RATE_LIMIT_ENABLED` is not set to `'false'` in the environment.

## Test Endpoint

### Provider-Abstraction Image Test

**Purpose**: Verify the image provider abstraction and model presets without a game state. This endpoint accepts custom variables, supports switching providers via `imageModelKey`, and returns debug info.

**Endpoint**: `POST /api/test-generate-image`

**Request Body**:
```json
{
  "templateName": "general_scene",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
    "imageModelKey": "gpt-image-1-mini"
  }
}
```

**Notes**:
- `templateName` (required): Name of the image prompt template from the reference release
- `variables` (required): Object containing template variables and optional `imageModelKey`
- If `imageModelKey` is not provided, the system will use the default model from the database (model with `isDefault = true`)
- If no default model exists and `imageModelKey` is not provided, the request will fail with error: "No image model key specified and no default model found in database"
- Rate limiting is applied when `RATE_LIMIT_ENABLED !== 'false'` in the environment

**Valid `imageModelKey` Presets**:
- **OpenAI**: `gpt-image-1-mini`
- **Hugging Face** (require `HF_TOKEN` environment variable):
  - `flux-schnell`
  - `sd-large-turbo`
  - `sd-medium-turbo`
  - `claymation-xl`
  - `retro-pixel-flux`
  - `fal-flux-pixel-art`

**Example (OpenAI)**:
```bash
curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "general_scene",
    "variables": {
      "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
      "imageModelKey": "gpt-image-1-mini"
    }
  }'
```

**Example (Hugging Face FLUX)**:
```bash
curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "general_scene",
    "variables": {
      "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
      "imageModelKey": "flux-schnell"
    }
  }'
```

**Expected Response**:
```json
{
  "imageUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "promptUsed": "VISUAL STYLE:\n...\n\nSUBJECT:\nA futuristic spaceship interior...",
  "debugInfo": {
    "model": "gpt-image-1-mini",
    "size": "1024x1024",
    "quality": "auto",
    "background": "auto",
    "moderation": "auto",
    "generationTime": 8450,
    "variables": {
      "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
      "imageModelKey": "gpt-image-1-mini"
    }
  }
}
```

**Validation**:
- ✅ `imageUrl` present; base64 data URL or remote URL
- ✅ `promptUsed` includes compiled template with variables applied
- ✅ `debugInfo.model` matches requested `imageModelKey` preset (or default if not specified)
- ✅ `debugInfo.size/quality/background/moderation` reflect template and settings
- ✅ `generationTime` is reasonable (< 30s typical; Hugging Face models may vary)

## Utility Endpoints

These endpoints are useful for debugging and monitoring but require **admin authentication** (set via `ADMIN_API_KEYS` environment variable). You can use either `Authorization: Bearer <token>` or `x-admin-token: <token>` header format.

### LLM Logs

```bash
# List recent LLM logs (requires admin auth)
curl -s "http://localhost:5001/api/llm-logs?limit=20" \
  -H "x-admin-token: your-admin-api-key" | jq '. | length'

# Clear all LLM logs (requires admin auth)
curl -s -X DELETE "http://localhost:5001/api/llm-logs" \
  -H "x-admin-token: your-admin-api-key" | jq '.success'
```

### Image Cache

```bash
# List cached images (requires admin auth)
curl -s "http://localhost:5001/api/cache/images?limit=10" \
  -H "x-admin-token: your-admin-api-key" | jq '. | length'

# Get cache statistics (requires admin auth)
curl -s "http://localhost:5001/api/cache/stats" \
  -H "x-admin-token: your-admin-api-key" | jq
```

### Health & Metrics

```bash
# Server health check (no auth required)
curl -s "http://localhost:5001/api/health" | jq '.status'

# Prometheus metrics (no auth required)
curl -s "http://localhost:5001/metrics" | head -n 10
```

## Error Handling

### Missing Required Fields

```bash
curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response**:
```json
{
  "error": "templateName is required"
}
```

### Invalid Variables Format

```bash
curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "general_scene",
    "variables": "not-an-object"
  }'
```

**Expected Response**:
```json
{
  "error": "variables must be an object"
}
```

### Invalid Template Name

```bash
curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "nonexistent_template",
    "variables": {}
  }'
```

**Expected Response**:
```json
{
  "error": "Failed to generate image",
  "details": "Image prompt template \"nonexistent_template\" not found"
}
```

### Missing Image Model

If no `imageModelKey` is provided and no default model exists in the database:

**Expected Response**:
```json
{
  "error": "Failed to generate image",
  "details": "No image model key specified and no default model found in database"
}
```

## Deprecated Testing Endpoints

> **⚠️ Deprecated**: The endpoints documented in this section are **no longer available** in the codebase. This information is provided for historical reference only.

The following `/api/test/llm/*` endpoints were previously available for testing LLM integrations but have been retired. They are documented here for reference, but attempts to use them will result in 404 Not Found errors.

### Previously Available Endpoints

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/test/llm/health` | GET | Overall LLM health check | ❌ Retired |
| `/api/test/llm/introduction` | POST | Test intro generation | ❌ Retired |
| `/api/test/llm/narrative` | POST | Test narrative generation | ❌ Retired |
| `/api/test/llm/actions` | POST | Test action generation | ❌ Retired |
| `/api/test/llm/intent` | POST | Test intent mapping | ❌ Retired |
| `/api/test/llm/interview` | POST | Test interview answers | ❌ Retired |
| `/api/test/llm/image` | POST | Test image generation (game-state based) | ❌ Retired |

### What Replaced Them?

**For Image Generation Testing:**
- Use `POST /api/test-generate-image` instead of `/api/test/llm/image`
- This endpoint supports provider abstraction and custom variables without requiring a game state
- See the [Test Endpoint](#test-endpoint) section above for details

**For LLM Functionality Testing:**
- LLM functions are now tested through the primary game routes:
  - Introduction generation: Part of `POST /api/game/start`
  - Narrative generation: Part of `POST /api/game/action` (via turn processing)
  - Action generation: Part of `POST /api/game/action` workflow
  - Intent mapping: Handled internally in the action processing pipeline
  - Interview answers: Use `POST /api/interview/generate-answer`

**For System Health:**
- Use `GET /api/health` instead of `/api/test/llm/health`
- Provides database, queue, and memory health checks
- See [Utility Endpoints](#utility-endpoints) section

### Historical Documentation

If you need to understand what these endpoints previously did, here's what they tested:

#### Health Check (`/api/test/llm/health`)
Previously tested all LLM functions (`generateIntroduction`, `generateActions`, `mapCustomActionToIntent`, `generateInterviewAnswer`) and returned a composite health status with timing information.

#### Introduction Generation (`/api/test/llm/introduction`)
Previously tested the introduction generation with a mock game state. This functionality is now part of the game initialization flow.

#### Narrative Generation (`/api/test/llm/narrative`)
Previously tested narrative generation with custom actions and skill checks. This is now handled through the turn processing system.

#### Actions Generation (`/api/test/llm/actions`)
Previously tested the generation of action options from a game state. This is now integrated into the action processing workflow.

#### Intent Mapping (`/api/test/llm/intent`)
Previously tested mapping custom action text to intent categories (repair, negotiate, cook, explore, improvise, research, command, other). This mapping now happens internally during action processing.

#### Interview Answer (`/api/test/llm/interview`)
Previously tested interview answer generation. This functionality is still available at `POST /api/interview/generate-answer`.

#### Image Generation (`/api/test/llm/image`)
Previously tested image generation with game state context. Replaced by `POST /api/test-generate-image` which supports provider abstraction and doesn't require game state.

### Migration Notes

- **TEST_API_KEY**: The `TEST_API_KEY` environment variable is no longer used by any endpoints
- **Authentication**: Legacy test endpoints used `x-test-api-key` header; current endpoints use rate limiting or admin auth instead
- **Testing Strategy**: The current architecture favors testing through actual game workflows rather than isolated LLM function tests

---

## Troubleshooting

### Common Issues

#### 1. "Image prompt template not found"
- **Cause**: The active reference release does not include the requested prompt template
- **Solution**: Publish a reference release that contains the template and mark it current

#### 2. "No image model key specified and no default model found"
- **Cause**: Neither `imageModelKey` was provided in variables nor is there a default model in the database
- **Solution**: Either provide `imageModelKey` in the request variables, or set a default model in the database (model with `isDefault = true`)

#### 3. "HF_TOKEN not set" (Hugging Face models)
- **Cause**: Attempting to use a Hugging Face model without the required token
- **Solution**: Export `HF_TOKEN` environment variable before calling Hugging Face presets

#### 4. OpenAI API errors
- **Cause**: Invalid or missing OpenAI API key
- **Solution**: Verify `OPENAI_API_KEY` is set and valid

#### 5. Rate limiting errors
- **Cause**: Too many requests in a short time period
- **Solution**: Wait before retrying, or disable rate limiting by setting `RATE_LIMIT_ENABLED=false` in development

#### 6. Slow response times
- **Cause**: API rate limiting or network issues
- **Solution**: Check API provider status and network connectivity. Note that Hugging Face models may take longer than OpenAI models

### Debug Mode

Enable detailed logging by setting:
```bash
export DEBUG=uranus-dungeon-guide:*
```

### Log Analysis

Check server logs for detailed error information:
```bash
# View recent logs
tail -f logs/server.log

# Filter for image generation errors
grep -i "image\|generate\|error" logs/server.log
```

### Performance Monitoring

Monitor API response times:
```bash
# Test with timing
time curl -X POST "http://localhost:5001/api/test-generate-image" \
  -H "Content-Type: application/json" \
  -d '{"templateName": "general_scene", "variables": {}}'
```

## Best Practices

1. **Test with minimal variables first** to verify endpoint connectivity
2. **Specify `imageModelKey` explicitly** to avoid dependency on database defaults
3. **Monitor execution times** - OpenAI models typically take 5-15 seconds, Hugging Face may take longer
4. **Test error conditions** to ensure proper error handling
5. **Use realistic template names** that exist in your reference release
6. **Document any failures** with full error messages and context
7. **Keep test data minimal** to avoid unnecessary API costs

---

For additional support or questions about API testing, refer to the main [API Guide](API_GUIDE.md) or contact the development team.
