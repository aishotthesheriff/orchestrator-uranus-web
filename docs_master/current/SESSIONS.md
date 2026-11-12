# Authentication & JWT Cookies

> Last updated: 2025-11-08

This document explains how Uranus Dungeon Guide authenticates players after the migration from PostgreSQL-backed `express-session` to stateless JWT cookies. Use it with `SYSTEM_OVERVIEW.md` and `AGENTS.md` to understand how the Gateway, Game Orchestrator, and Player Client agents coordinate authentication.

## Why JWTs replaced server sessions

| Before | After |
| --- | --- |
| `express-session` stored `connect.sid` rows inside Postgres. Every request loaded the session row, added 5–50 ms of latency, and required sticky storage. | Stateless JSON Web Tokens signed with `SESSION_SECRET` (or `JWT_SECRET`). No DB lookup per request, easier horizontal scaling, and fewer moving parts. |
| Middleware decorated `req.session` with `userId`/`username`. | `jwtMiddleware` decodes the `auth_token` cookie and assigns `req.user`. |
| Logout destroyed the session row and relied on store cleanup jobs. | Logout simply clears the cookie; tokens expire automatically after 24 h. |

Client behavior is unchanged: the browser still stores a single HttpOnly cookie and automatically sends it with subsequent requests.

## Key modules

| File | Responsibility |
| --- | --- |
| `server/middleware/jwt.ts` | Generates/validates tokens, attaches `req.user`, and exposes `requireAuth`. |
| `server/index.ts` | Runs `cookieParser` then `jwtMiddleware` on every request before CSRF protection and rate limiting. |
| `server/routes.ts` | Issues tokens in `PUT /api/user`, clears them in `/api/user/logout`, and uses `req.user` everywhere instead of `req.session`. |
| `server/middleware/rateLimiting.ts` | Identifies callers by `req.user?.userId ?? req.ip` when tracking quotas. |
| `server/middleware/securityLogging.ts` | Logs `userId` instead of session IDs for suspicious events. |
| `server/__tests__/api/gameFlow.test.ts` | Generates JWT cookies with `generateToken` to exercise protected endpoints. |

## Token lifecycle

1. **Login** (`PUT /api/user`)
   - Validates username and upserts the player via `storage.ensureUser`.
   - Calls `generateToken(user.id, user.username)` to create a 24 h JWT.
   - Sets the `auth_token` cookie with `HttpOnly`, `SameSite=Lax`, `Secure` (in production), and a matching `maxAge`.
2. **Per-request middleware** (`jwtMiddleware`)
   - Reads `req.cookies.auth_token` and verifies the signature with `SESSION_SECRET` (or `JWT_SECRET`).
   - Attaches `{ userId, username }` to `req.user` when valid. Expired or malformed tokens are ignored so public routes can continue.
3. **Protected endpoints** (`requireAuth`)
   - Ensures `req.user` exists. On failure it responds with `401 { error: "Authentication required" }`.
   - Business logic now references `req.user!.username` (and `req.user!.userId` when needed), eliminating all `req.session` checks.
4. **Logout** (`POST /api/user/logout`)
   - Uses `res.clearCookie('auth_token', { httpOnly: true, secure, sameSite: 'lax' })`.
   - No database cleanup is required.
5. **Expiration**
   - Tokens expire after 24 h via the JWT `exp` claim. Clients automatically hit `/api/user` again to refresh the cookie.

## Middleware order inside `server/index.ts`

```ts
app.use(cookieParser());
app.use(jwtMiddleware); // populate req.user before CSRF/rate limits
if (csrfEnabled) {
  app.use(csrfProtection);
}
```

Always keep `jwtMiddleware` before CSRF so error handlers can include user metadata when available.

## Accessing the authenticated user

- Use `req.user!.username` inside protected route handlers. `requireAuth` guarantees the property exists.
- Prefer `req.user!.userId` for rate limiting, logging, and database lookups when IDs are required.
- Never mutate `req.user` inside handlers; regenerate a cookie via `generateToken` if additional claims are needed.

## Issuing tokens from tests or scripts

```ts
const login = await fetch('http://localhost:5000/api/user', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username }),
});
const setCookie = login.headers.get('set-cookie'); // contains auth_token HttpOnly cookie
```

Supertest example:

```ts
const login = await request(app)
  .put('/api/user')
  .send({ username: 'captain-elara' });
const cookie = login.headers['set-cookie'].find((value: string) =>
  value.startsWith('auth_token='),
);

await request(app)
  .get('/api/game/123')
  .set('Cookie', cookie)
  .expect(200);
```

Vitest integration example (`server/__tests__/api/gameFlow.test.ts`):
- `beforeEach` creates a user and stores `testUserId`.
- `createAuthCookie()` helper should call `PUT /api/user` and capture the `auth_token` cookie from the `Set-Cookie` header.
- `apiRequest` helper attaches the cookie when present.

## Environment variables

- `SESSION_SECRET` **(required)** – signing key reused from the legacy session stack.
- `JWT_SECRET` **(optional)** – overrides `SESSION_SECRET` for token signing, enabling staggered key rotation.

Rotate secrets by deploying new code with `JWT_SECRET`, waiting >24 h for old cookies to expire, then updating `SESSION_SECRET` if desired.

## Cookie settings

| Property | Value | Notes |
| --- | --- | --- |
| `name` | `auth_token` | Replaces `connect.sid`. |
| `httpOnly` | `true` | Prevents client-side JS access. |
| `secure` | `NODE_ENV === 'production'` | Requires HTTPS in prod. |
| `sameSite` | `lax` | Allows top-level POST navigation like `/api/user`. |
| `maxAge` | `24 * 60 * 60 * 1000` | Keep parity with legacy session length. |

## Rate limiting + security logging

- `sessionBasedRateLimit` renamed logically by using `req.user?.userId` for identifiers, falling back to `req.ip` for anonymous requests.
- Security logging payloads now store `{ userId: req.user?.userId ?? null }` instead of session IDs.
- Operators should watch for spikes in `401` responses after deployment. They usually indicate missing cookies or stale tokens.

## Manual testing checklist

1. `PUT /api/user { "username": "test" }` → `Set-Cookie: auth_token=...; HttpOnly; SameSite=Lax`.
2. `GET /api/user/me` with the cookie returns the user profile.
3. `POST /api/user/logout` clears the cookie.
4. Any protected route without the cookie returns 401.
5. Changing `SESSION_SECRET` locally invalidates existing cookies, proving statelessness.

## Cleanup tasks

Once production traffic has been running on JWTs for at least 24 hours:

1. **Drop the legacy session table**
   ```sql
   DROP TABLE IF EXISTS session CASCADE;
   DROP INDEX IF EXISTS idx_session_expire;
   ```
2. **Remove lingering code references** (already handled in this branch, but double-check `rg 'express-session' server/`).
3. **Uninstall packages** (done in `package.json`):
   - `express-session`
   - `connect-pg-simple`
   - `@types/express-session`
   - `@types/connect-pg-simple`

## Rollback plan

1. Revert to the last commit that still used `express-session` and redeploy.
2. If you need dual support temporarily, reintroduce the session middleware after `jwtMiddleware` and extend `jwtMiddleware` to fall back to `req.session` (see implementation doc in `/docs_master` for the snippet).
3. Re-run smoke tests: `/api/user`, `/api/user/me`, `/api/game/start`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Error: SESSION_SECRET or JWT_SECRET must be set` | Missing env var in dev/CI. | Export `SESSION_SECRET` or define `JWT_SECRET`. |
| `401 Authentication required` in logs | Cookie missing/expired, or client not including credentials. | Re-hit `/api/user`, ensure `fetch` uses `credentials: 'include'`, verify domains match. |
| Users get logged out after deploy | Expected when the signing key changes or when switching from `connect.sid`. | Communicate to players; new login persists for 24 h. |
| Tests fail with `req.user is undefined` | Middleware order incorrect or token not attached. | Mount `jwtMiddleware` after `cookieParser`, and set `Cookie: auth_token=...` in the test. |

## File reference recap

- `server/middleware/jwt.ts`
- `server/index.ts`
- `server/routes.ts`
- `server/middleware/rateLimiting.ts`
- `server/middleware/securityLogging.ts`
- `server/__tests__/api/gameFlow.test.ts`
- `env.example`

Keep this document up to date when adding new protected routes or altering cookie lifetimes.
