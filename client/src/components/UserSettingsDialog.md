# UserSettingsDialog

Purpose: Modal for viewing and updating user preferences (narrative theme, visual style, image model). Integrates with user settings API and pulls reference catalogs directly.

Props
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `idPrefix?: string` — To namespace input IDs in the dialog.

Behavior
- Fetches current user settings (session-based) and applies defaults from system defaults + catalog lookups when fields are empty.
- Fetches creative catalogs (`story-themes`, `visual-styles`), image models, and system-defaults (for default keys).
- On Save, updates `/api/user/preferences` and navigates to the most recent game if present, otherwise `/menu`.

Data & API
- Queries:
  - `GET /api/user/preferences` (session-based)
  - `GET /api/reference/story-themes`
  - `GET /api/reference/visual-styles`
  - `GET /api/reference/image-models`
  - `GET /api/reference/system-defaults`
  - `GET /api/games/user/:username` (current game for navigation)
- Mutation:
  - `PATCH /api/user/preferences`
- Cache: invalidates `['api','user','preferences']` on success (handled by `useUpdateUserSettings`).

Security
- Uses `apiRequest` which includes CSRF token on mutating calls and session credentials.

Testing Notes
- Root id `settings-dialog`; form elements for theme/style/model; Save disabled until model selected.
