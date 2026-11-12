# Settings System Documentation

## Overview

The Settings System manages global application configuration that gets exported with reference releases. Settings are stored in the `app_settings` database table and exported to JSON files during the publish process.

In addition to key/value settings, the system now includes a catalog of structured "modifiers" (Theme, Mood, Style) that are exported with reference releases and consumed by the Prompt Composition Engine (PCE).

## Architecture

### Database Schema

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                     -- JSON stringified
  description TEXT,
  active INTEGER DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Reference System Integration

Settings are automatically exported to `releases/{version}/settings.json` during the publish process:

```json
{
  "image_model_key_default": "sd-large-turbo",
  "image_cache_retention_days": "30",
  "image_cache_min_access_count": "5",
  "image_moderation_setting": "low",
  "image_background_setting": "opaque"
}
```

## Current Settings

### Image Generation Settings

| Setting Key | Description | Valid Values | Default |
|-------------|-------------|--------------|---------|
| `image_model_key_default` | Global default image model | `gpt-image-1-mini`, `sdxl-turbo`, `flux-schnell`, `sd-large-turbo`, `sd-medium-turbo`, `claymation-xl`, `retro-pixel-flux`, `fal-flux-pixel-art` | `sd-large-turbo` |
| `image_background_setting` | Global background setting for image generation | `auto`, `transparent`, `opaque` | `opaque` |
| `image_moderation_setting` | Global moderation level for image generation | `auto`, `low` | `low` |

### Cache Management Settings

| Setting Key | Description | Valid Values | Default |
|-------------|-------------|--------------|---------|
| `image_cache_retention_days` | Number of days to keep images in cache | 1-365 | `30` |
| `image_cache_min_access_count` | Minimum access count to keep images | 1-100 | `5` |

### Feature Flags

| Setting Key | Description | Valid Values | Default |
|-------------|-------------|--------------|---------|
| `pce_enabled` | Enables Prompt Composition Engine (JSON turn pipeline) | `true`, `false`, `1`, `0`, `yes`, `no` | `false` |

## API Endpoints

### Get All Settings
```http
GET /api/settings
```

**Response:**
```json
[
  {
    "key": "image_model_key_default",
    "value": "sd-large-turbo",
    "description": "Global default image model",
    "active": 1,
    "updatedAt": "2025-10-29T01:31:53.098Z"
  }
]
```

### Get Active Settings
```http
GET /api/settings/active
```

### Update/Create Setting
```http
PUT /api/settings/{key}
Content-Type: application/json

{
  "value": "new-value",
  "description": "Setting description",
  "active": 1
}
```

## Settings Tab in DevTools

The Settings tab provides a user-friendly interface for managing all application settings:

### Features

1. **Individual Setting Controls**
   - Default Image Model: Dropdown with all available models
   - Cache Retention: Number input (1-365 days)
   - Min Access Count: Number input (1-100)
   - Background Setting: Dropdown (auto/transparent/opaque)
   - Moderation Setting: Dropdown (auto/low)

2. **Real-time Updates**
   - Settings are loaded from `/api/settings` on page load
   - Each setting has its own save button
   - Changes are immediately reflected in the UI

3. **Live Settings View**
   - Displays all current settings in a table format
   - Shows key, value, and description for each setting
   - Updates automatically when settings change

### Usage

1. Navigate to DevTools → Settings tab
2. Modify any setting using the provided controls
3. Click "Save" for the specific setting
4. Settings are immediately updated in the database
5. Changes will be included in the next reference release

## Code Integration

### Server-Side (aiService.ts)

Settings are loaded from the reference system using `getSettingFromReference()`:

```typescript
// Load settings from reference JSON files
const backgroundValue = await getSettingFromReference('image_background_setting') || 'auto';
const moderationValue = await getSettingFromReference('image_moderation_setting') || 'auto';
```

### Client-Side (DevToolsPage.tsx)

Settings are loaded from the API and managed with React state:

```typescript
// Load settings from API
const { data: settings = [], refetch: refetchSettings } = useQuery<any[]>({
  queryKey: ["/api/settings"],
});

// Initialize state from settings
useEffect(() => {
  if (settings) {
    const backgroundSetting = settings.find(s => s.key === 'image_background_setting');
    if (backgroundSetting) {
      setImageBackgroundSetting(backgroundSetting.value);
    }
    // ... other settings
  }
}, [settings]);
```

## Migration History

### v1.2.3 - Settings Migration

**Problem:** Settings were incorrectly stored in the `prompt_templates` table instead of the `app_settings` table.

**Settings Migrated:**
- `image_background_setting`: "opaque"
- `image_moderation_setting`: "low"

**Changes Made:**
1. **Database Migration**: Moved settings from `prompt_templates` to `app_settings`
2. **Code Updates**: Updated `aiService.ts` to use `getSettingFromReference()`
3. **UI Updates**: Updated DevTools to load settings from settings API
4. **Documentation**: Updated all documentation to reflect changes

**Backward Compatibility:**
- Old prompt entries were deactivated (set to `active: 0`)
- Reference system continues to work with JSON files
- No breaking changes to existing functionality

## Best Practices

### Adding New Settings

1. **Database**: Add new setting to `app_settings` table
2. **API**: Setting will automatically be available via `/api/settings`
3. **UI**: Add controls to Settings tab in DevTools
4. **Code**: Use `getSettingFromReference()` to load in server code
5. **Documentation**: Update this file with new setting details

### Setting Naming Convention

- Use snake_case for setting keys
- Include descriptive prefixes (e.g., `image_`, `cache_`)
- Be specific about the setting's purpose

### Value Validation

- Always provide fallback values in code
- Use appropriate input types in UI (number, select, text)
- Validate ranges and allowed values

## Troubleshooting

### Settings Not Loading

1. Check if setting exists in `app_settings` table
2. Verify setting is active (`active = 1`)
3. Check reference release includes the setting
4. Verify API endpoint is working

### Settings Not Saving

1. Check API endpoint response for errors
2. Verify setting key is valid
3. Check database connection
4. Verify user has appropriate permissions

### Reference Export Issues

1. Ensure all settings are active
2. Check publish process logs
3. Verify `settings.json` file is created
4. Check manifest includes settings file

## Related Documentation

- [API Guide](./API_GUIDE.md) - Complete API documentation
- [Maintainer Guide](./MAINTAINER_GUIDE.md) - System maintenance procedures
- [Database Architecture](./DATABASE_ARCHITECTURE.md) - Database schema details
- [Prompt Variables](./PROMPT_VARIABLES.md) - Variable usage in prompts
