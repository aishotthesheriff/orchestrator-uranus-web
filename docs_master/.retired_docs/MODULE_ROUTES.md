# Module: Routes (HTTP API, WebSocket, Background Jobs)

- File: `server/routes.ts`
- Purpose: Register HTTP API endpoints, bootstrap WebSocket server, start background processors, and return the underlying `http.Server` used by the app.

## Overview
- Exports `registerRoutes(app)` which mounts all server APIs, creates the `http.Server`, and configures Socket.IO.
- Starts image and turn job processors plus a periodic image cache cleanup service.
- Enforces authentication, authorization, and rate limiting per route.

## Security & Controls
- Authentication: `requireAuth` for user-protected endpoints: `server/routes.ts:21`
- Authorization: `requireAdmin` for admin-only endpoints: `server/routes.ts:20`
- Rate Limiting: per-route limits via `gameStartRateLimit`, `gameReadRateLimit`, `gameActionRateLimit`, `imageGenerationRateLimit`: `server/routes.ts:14-19`

## Game Endpoints
- Start new game (auth, uses session username): `POST /api/game/start` — `server/routes.ts:30-46`
- Get game state (auth, ownership enforced): `GET /api/game/:id` — `server/routes.ts:48-71`
- Submit action (enqueue job; auth, ownership): `POST /api/game/action` — `server/routes.ts:73-107`
- Update equipped items (auth, ownership, validates active items): `PATCH /api/games/:id/equipped-items` — `server/routes.ts:109-178`
- Delete game (auth, ownership): `DELETE /api/game/:id` — `server/routes.ts:180-205`
- List games for current user: `GET /api/games/user/:username` — `server/routes.ts:207-226`
- Update game settings (absurdity only; auth, ownership): `PATCH /api/games/:id/settings` — `server/routes.ts:616-652`

## Interview Endpoints
- Admin CRUD: `GET /api/interview-questions` — `server/routes.ts:228-237`, `POST /api/interview-questions` — `server/routes.ts:249-257`, `PUT /api/interview-questions/:id` — `server/routes.ts:259-267`
- Public active list: `GET /api/interview-questions/active` — `server/routes.ts:239-247`
- Update per-game responses (auth, ownership): `PATCH /api/games/:id/interview-responses` — `server/routes.ts:269-296`
- Generate AI answer for a question (auth): `POST /api/interview/generate-answer` — `server/routes.ts:298-313`

## Image Endpoints
- Generate or return cached game image (auth, ownership): `POST /api/generate-image` — `server/routes.ts:315-359`
- Test-generate image with custom variables (rate-limited; for dev tools): `POST /api/test-generate-image` — `server/routes.ts:361-384`

## PCE (Prompt Composition Engine)
- Build and optionally execute a meta-prompt for validation (admin): `POST /api/pce/test` — `server/routes.ts:392-577`
- Defaults (deprecated player-facing; returns defaults): `GET /api/pce/catalogs` — `server/routes.ts:579-588`

## Settings & Preferences
- Admin settings: `GET /api/settings` — `server/routes.ts:590-599`, `PUT /api/settings/:key` — `server/routes.ts:601-614`
- User preferences (auth): `GET /api/user/preferences` — `server/routes.ts:656-665`, `PATCH /api/user/preferences` — `server/routes.ts:780-872`

## User & Auth Session
- Public search (welcome page): `GET /api/user/search` — `server/routes.ts:660-686`
- Create or reuse user + establish session (public): `PUT /api/user` — `server/routes.ts:708-734`
- Current user (auth): `GET /api/user/me` — `server/routes.ts:736-762`
- Logout (auth): `POST /api/user/logout` — `server/routes.ts:764-778`

## Logs & Cache Admin
- LLM logs (admin): `GET /api/llm-logs` — `server/routes.ts:874-886`, `DELETE /api/llm-logs` — `server/routes.ts:888-896`
- Cache stats and management (admin): `GET /api/cache/images` — `server/routes.ts:898-925`, `GET /api/cache/images/:id` — `server/routes.ts:927-937`, `GET /api/cache/stats` — `server/routes.ts:940-947`, `DELETE /api/cache/images/:id` — `server/routes.ts:950-967`
- Manual cache cleanup (admin): `POST /api/admin/cache/cleanup` — `server/routes.ts:1058-1079`

## Reference Publishing (Admin)
- Publish: `POST /api/admin/reference/publish/:version` — `server/routes.ts:1081-1110`
- Activate: `POST /api/admin/reference/:version/activate` — `server/routes.ts:1112-1131`
- List releases: `GET /api/admin/reference/releases` — `server/routes.ts:1133-1147`
- Current release: `GET /api/admin/reference/current` — `server/routes.ts:1149-1163`

## WebSocket Server
- `http.Server` creation: `server/routes.ts:1164`
- Allowed origins via `ALLOWED_ORIGINS` (comma-separated) or dev-wildcard: `server/routes.ts:1166-1176`
- Socket events: `joinGame`, `leaveGame`, `disconnect` — `server/routes.ts:1182-1200`
- Socket instance registered globally for other modules: `server/routes.ts:1178-1180`

## Background Services
- Image job processor: `server/routes.ts:1203-1205`
- Turn job processor: `server/routes.ts:1206-1207`
- Image cache cleanup service: `server/routes.ts:1209-1212`
- Reference pre-warming: `server/routes.ts:1214-1221`

## Validation & Ownership
- Zod schemas enforce request payloads: `insertGameStateSchema`, `actionInputSchema` — `server/routes.ts:7-8`
- Ownership checks compare `req.session.username` to game’s `username` before reads/updates: e.g., `server/routes.ts:61-66`, `server/routes.ts:334-340`

