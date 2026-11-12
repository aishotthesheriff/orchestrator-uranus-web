# useGameContentLoading

Purpose: Local UI loading state for content operations during gameplay (action processing, image generation, and current action text).

State
- `isProcessingAction: boolean`
- `isGeneratingImage: boolean`
- `currentActionText: string | null`

API
- `setLoading(key, value)` — update one key at a time (boolean or string/null for `currentActionText`).
- `isContentLoading` — derived (either action or image in progress).

Usage
- Mobile/Desktop game pages set/clear these flags before/after invoking logic handlers and when mutations complete.
