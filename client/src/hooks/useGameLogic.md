# useGameLogic

Purpose: Centralized game state and actions hook. Fetches and caches game data, handles user actions and image generation, manages equipment and settings, and wires realtime updates via Socket.IO.

Responsibilities
- Read game data: `GET /api/game/:gameId` (enabled when `gameId` exists).
- Read reference catalogs: items, themes, styles, system defaults (reference endpoints).
- Read user preferences (via `useUserSettings`).
- Mutations:
  - Action: `POST /api/game/action` (may return job; UI updates on socket events).
  - Generate Image: `POST /api/generate-image`.
  - Update Equipment: `PATCH /api/games/:id/equipped-items` with optimistic update.
  - Update Game Settings: `PATCH /api/games/:id/settings` (e.g., absurdity).
  - Update User Preferences: delegated to `useUpdateUserSettings`.
- Realtime: connect socket, join game room, respond to `turnComplete`, `imageReady`, `imageFailed` by invalidating `['api','game', gameId]` and showing toasts.

Returns (selected)
- `gameState`, `items`, `isLoading`, `gameId`
- Preferences: `imageModelKey`, `theme`, `style`
- UI flags: `showSettings`, `showHelp`, `showPreviousTurns`, etc.
- Mutations: `actionMutation`, `generateImageMutation`, `updateGameSettingsMutation`, `updateUserPreferencesMutation`
- Handlers: `handleActionClick`, `handleCustomAction`, `handleBackToMenu`, `toggleItem`, `itemIcon`

Security & CSRF
- All API calls use `apiRequest` which adds `credentials: 'include'` and attaches CSRF tokens for mutating verbs.
- On 401 or CSRF 403 conditions, helper resets tokens accordingly.

Query Keys
- Follows segmented keys, e.g., `['api','game', gameId]`, `['api','reference','items']`, etc.
