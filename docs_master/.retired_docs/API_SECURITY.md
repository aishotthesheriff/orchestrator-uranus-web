# API Security and Maintenance Guide

This document explains the defensive controls that protect the API layer and how to keep them healthy over time. It is aimed at maintainers who deploy, operate, or extend the backend in `server/`.

## 1. Runtime Hardening

- **HTTP headers** – `helmet` is applied globally with a production CSP and other defaults (`server/index.ts:37`). Verify new endpoints do not add inline scripts that would violate the CSP. If WebSocket origins change, update both the CSP `connectSrc` list and the Socket.IO CORS list (see Section 6).
- **Trusted proxy** – Express trusts the first proxy (`server/index.ts:35`) so rate limits use the real client IP. Ensure your ingress layer sets `X-Forwarded-For`.
- **Session store** – `express-session` persists to Postgres via `connect-pg-simple` (`server/index.ts:73-87`) with `httpOnly` cookies and `secure` flag in production. Keep `SESSION_SECRET` long and rotate after suspected compromise.
- **Body limits** – JSON and form bodies are capped at 10 MB and large payloads (>5 MB) generate security events (`server/index.ts:89-101` plus `server/middleware/securityLogging.ts:74-88`). When adding upload endpoints, review these limits.
- **Suspicious traffic filter** – Every request flows through `suspiciousRequestDetection` (`server/middleware/securityLogging.ts:124-165`). Alerts emit when user agents, paths, or query strings match bot/scan heuristics. Extend patterns here if new attack signatures are observed.

## 2. Cross-Site Request Forgery (CSRF)

- CSRF protection is enabled by default unless `CSRF_ENABLED=false` (`server/index.ts:63-127`). The middleware issues httpOnly CSRF cookies and blocks unsafe requests without a token.
- `/api/csrf-token` exposes the token for clients (`server/index.ts:123-126`). When adding new public clients, make sure they call this endpoint and echo the token in the `x-csrf-token` header or hidden form field.
- Health (`/api/health`) and metrics endpoints are explicitly exempt. Avoid adding exemptions unless an endpoint is guaranteed to be read-only.
- Recommended maintenance:
  - Set `CSRF_ENABLED=true` in production `.env`.
  - If the deployment sits behind a CDN that modifies cookies, confirm the CSRF cookie still arrives.

## 3. Authentication and Authorization

- **Admin APIs** – Protected with the `requireAdmin` middleware (`server/middleware/adminAuth.ts:33-47`). Tokens are supplied via `Authorization: Bearer <token>` or the `x-admin-token` header. Valid keys come from the comma-separated `ADMIN_API_KEYS` environment variable (or `ADMIN_API_KEY` as a fallback).
  - Maintain a rotation schedule. When rotating, update the env var and redeploy; old tokens become invalid immediately.
  - Unconfigured keys return HTTP 503 to highlight misconfiguration, so surfacing this in deployment smoke tests catches missing secrets.
- **Test harness APIs** – Legacy `/api/test/**` endpoints have been retired. The `TEST_API_KEY` environment variable is no longer actively used by the API. The `/api/test-generate-image` endpoint (for debugging image templates) uses rate limiting instead of API key authentication.
- **Session-backed features** – While the majority of routes use stateless auth, CSRF relies on sessions. Do not disable the session middleware even if endpoints appear stateless.

## 4. Rate Limiting and Abuse Prevention

- Rate limit profiles live in `server/middleware/rateLimiting.ts`. They are constructed with `express-rate-limit` and target IPs or sessions, emitting 429 responses and logging events.
  - `globalRateLimit` (100 requests / 15 minutes) is applied to all routes when `RATE_LIMIT_ENABLED` is not `false` (`server/index.ts:133-136`).
  - Specialized limits wrap high-risk routes: game start (`gameStartRateLimit`), game reads (`gameReadRateLimit`), game actions (`gameActionRateLimit`), and image generation (`imageGenerationRateLimit`) - see `server/routes.ts` for usage.
  - `sessionBasedRateLimit` exists for future per-session throttles (`server/middleware/rateLimiting.ts:148-163`).
- Maintenance checklist:
  - Confirm `RATE_LIMIT_ENABLED=true` outside of controlled testing.
  - If deploying behind a proxy, ensure `trust proxy` stays on so the limiter sees the client IP.
  - Monitor rate-limit metrics via `/api/health` (`server/index.ts:162-188`) and Prometheus if exports are scraped.

## 5. Input Validation and Data Integrity

- Critical mutations are validated with Zod schemas shared between client and server. Examples:
  - `insertGameStateSchema.parse` for game creation (`server/routes.ts:76-108`).
  - `actionInputSchema.parse` for player actions (`server/routes.ts:177-198`).
- Other endpoints perform manual validation (array type checks, per-field assertions) before hitting storage.
- Storage operations go through Drizzle ORM (`server/storage.ts`) which uses parameterized queries, reducing SQL injection risk.
- When adding endpoints:
  - Prefer existing shared schemas or create new Zod schemas in `shared/schema.ts`.
  - Keep validation ahead of DB writes and long-running LLM calls to fail fast.

## 6. WebSocket and CORS Controls

- Socket.IO shares the HTTP server and restricts origins using `ALLOWED_ORIGINS` (`server/routes.ts:1078-1087`). In production this should list the public app domains; in development it falls back to `['*']`.
- The HTTP layer’s CSP also restricts `connectSrc` to the same origin and WebSocket schemes (`server/index.ts:37-45`).
- When onboarding a new frontend host:
  1. Add the domain to `ALLOWED_ORIGINS`.
  2. Adjust the CSP if the host differs from the API domain.
  3. Redeploy and confirm real-time features still connect.

## 7. Observability and Incident Response

- Security events (rate-limit hits, auth failures, CSRF issues, suspicious traffic) are captured in-memory (`server/middleware/securityLogging.ts:17-204`) and rolled into `/api/health` metrics (`server/index.ts:162-188`).
- Console logs are structured with a `[SECURITY]` prefix for ingestion by log pipelines.
- Follow-up actions:
  - Export `getSecurityMetrics()` to external monitoring if persistent history is required.
  - Consider wiring `getRecentSecurityEvents()` into an authenticated dashboard for rapid triage.

## 8. Environment Configuration Matrix

| Variable | Purpose | Recommended production value |
|----------|---------|------------------------------|
| `DATABASE_URL` | Postgres connection for data + sessions | Required, private network reachability |
| `SESSION_SECRET` | Session HMAC/crypto secret | Long random string, rotate on incident |
| `RATE_LIMIT_ENABLED` | Toggle for all rate limiters | `true` |
| `CSRF_ENABLED` | Controls CSRF middleware | `true` |
| `ADMIN_API_KEYS` | Comma-delimited admin tokens (or `ADMIN_API_KEY` as fallback) | Store in secret manager, rotate quarterly |
| `TEST_API_KEY` | Legacy variable (no longer actively used) | Not required; kept for backwards compatibility |
| `ALLOWED_ORIGINS` | Allowed WebSocket origins | Explicit list of trusted hosts |

Keep `.env` files out of source control (`env.example` documents defaults) and prefer environment-specific secret stores.

### Current configuration snapshot (`.env`)

The local `.env` checked into the workspace currently advertises:
- `NODE_ENV=development` – expect relaxed CSP rules and `secure` cookies disabled.
- `RATE_LIMIT_ENABLED=false` – global limiter and per-route caps are not active; switch to `true` before public exposure.
- `CSRF_ENABLED=false` – CSRF middleware is bypassed; re-enable for any non-local deployment.
- `ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com` – adjust to match real hosts; during development the Socket.IO server treats `*` as allowed.
- `ADMIN_API_KEYS` – **not set**, therefore `requireAdmin` will return HTTP 503. Populate with comma-separated secrets prior to using admin endpoints.
- `TEST_API_KEY` – Legacy variable; no longer actively used by the API. Can be omitted or kept for backwards compatibility.
- `SESSION_SECRET` – populated (value redacted); rotate if the file is ever exposed.

Always double-check that secrets in `.env` or your secret manager align with the expectations documented above before deploying.

### NODE_ENV-dependent behavior

Several safeguards vary depending on the process environment:
- **Content Security Policy** – Helmet disables CSP entirely when `NODE_ENV=development` (`server/index.ts:37-47`). In production the CSP restricts script, style, image, and connect sources.
- **Session cookies** – The session store marks cookies `secure` only when `NODE_ENV==='production'` (`server/index.ts:73-87`). Development cookies travel over HTTP for ease of local testing.
- **CSRF cookies** – CSRF tokens inherit the same `secure` flag requirement, so they are HTTPS-only in production (`server/index.ts:106-123`).
- **WebSocket CORS** – Socket.IO allows all origins (`['*']`) by default during development but requires explicit origins otherwise (`server/routes.ts:1078-1087`).
- **Vite tooling** – Development-only helpers are excluded automatically when `NODE_ENV==='production'` (`vite.config.ts:8-18`), keeping production bundles lean without affecting API security directly.

Set `NODE_ENV=production` for any deployment that should enforce HTTPS cookies, the strict CSP, and limited WebSocket origins.

## 9. Maintenance Playbook

1. **Deploy validation**
   - Run `/api/health` and ensure `security.rateLimitEnabled` and `security.csrfEnabled` read `true`.
   - Call `/api/csrf-token` and verify the response includes a token while a `_csrf` cookie is set.
2. **Key rotation**
   - Generate new admin/test keys, update environment vars, redeploy, and confirm old keys fail with HTTP 401.
3. **Rate-limit tuning**
   - Review logs for `[SECURITY] RATE_LIMIT` events. Adjust per-route thresholds in `server/middleware/rateLimiting.ts` if legitimate traffic is throttled.
4. **Dependency updates**
   - When bumping Express, Helmet, or `express-rate-limit`, re-run smoke tests for CSRF, sessions, and rate limiting.
5. **Security event review**
   - Periodically dump `getRecentSecurityEvents()` via a temporary admin endpoint or REPL to spot trends.
6. **Penetration testing support**
   - Temporarily disable `RATE_LIMIT_ENABLED` or `CSRF_ENABLED` only in isolated test environments and restore defaults immediately afterwards.

## 10. Extending the API Safely

- Reuse `requireAdmin` for any route that mutates reference data, seeds, cache, or prompts.
- Use appropriate rate limiters (e.g., `imageGenerationRateLimit`) for test/debug endpoints like `/api/test-generate-image`. The legacy `requireTestApiKey` middleware no longer exists.
- When introducing file uploads or streaming:
  - Revisit body limits and ensure files are scanned/stored outside the web root.
  - Add validation for MIME types and file size before writing to disk.
- Update this document whenever new security layers or maintenance procedures are added.

By following these practices you maintain a layered defense that balances developer velocity with operational safety.
