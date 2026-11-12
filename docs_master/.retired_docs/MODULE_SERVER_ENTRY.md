# Module: Server Entry (Express App Initialization)

- File: `server/index.ts`
- Purpose: Initialize the Express application, enforce security (Helmet, CSRF, rate limiting), manage sessions, expose system endpoints (health, metrics, CSRF token), mount feature routes, serve static assets, configure dev/prod serving, and start the HTTP server.

## Overview
- Creates and configures an Express app with robust security defaults, session storage in Postgres, and request size limits.
- Exposes health and metrics endpoints for operations and monitoring.
- Dynamically mounts feature route modules and core API routes, then starts the HTTP server.

## Key Responsibilities
- Express app and security middleware: `server/index.ts:33`, `server/index.ts:38`
- Session via `connect-pg-simple`: `server/index.ts:81-96`
- Request size limits and payload logging: `server/index.ts:98-111`
- Suspicious request detection: `server/index.ts:112-113`
- CSRF protection and token endpoint: `server/index.ts:115-141`
- Global rate limiting toggle: `server/index.ts:143-146`
- Static image serving: `server/index.ts:148-149`
- Health endpoint: `server/index.ts:151-208`
- Prometheus metrics endpoint: `server/index.ts:210-218`
- API request logging: `server/index.ts:220-248`
- Feature route mounting (reference/admin): `server/index.ts:250-314`
- Core routes registration: `server/index.ts:315`
- Error handler: `server/index.ts:317-323`
- Dev Vite vs. static serving: `server/index.ts:325-332`
- Memory metrics loop: `server/index.ts:337-344`
- Server listen: `server/index.ts:346-355`

## Security & Middleware
- Helmet with CSP (dev disables CSP for Vite): `server/index.ts:38-50`
- Cookie parsing required for CSRF: `server/index.ts:52-53`
- CSRF toggle via `CSRF_ENABLED` with cookie-token endpoint: `server/index.ts:115-141`
- Suspicious request detection and security metrics: `server/index.ts:112-113`, `server/index.ts:176-201`
- Global rate limit toggle via `RATE_LIMIT_ENABLED`: `server/index.ts:143-146`

## Sessions
- Postgres-backed session store (`connect-pg-simple`): `server/index.ts:81-96`
- Cookie is `httpOnly`; `secure` in production: `server/index.ts:91-95`

## System Endpoints
- `GET /api/health` — DB latency, queue depths, reference readiness, memory, security metrics: `server/index.ts:151-208`
- `GET /metrics` — Prometheus metrics: `server/index.ts:210-218`
- `GET /api/csrf-token` — Returns CSRF token (or `{ csrfEnabled: false }` when disabled): `server/index.ts:132-140`
- `GET /generated_images/*` — Static file serving: `server/index.ts:148-149`

## Route Mounting
- Feature routes (items, events, NPC templates, prompts, image prompts, PCE catalogs, settings, system defaults) mounted by dynamic import: `server/index.ts:250-314`
- Core API and WebSocket server mounted in `registerRoutes(app)`: `server/index.ts:315`

## Dev/Prod Serving
- Development: Vite middleware configured after API routes to avoid catch-all interference: `server/index.ts:325-332`
- Production: Serves static build via `serveStatic`: `server/index.ts:330-332`

## Logging
- All console output is piped to file via `setupConsoleLogging()`: `server/index.ts:15-16`
- API request log with response snapshot (truncated): `server/index.ts:220-248`

## Metrics
- Prometheus register exposed; periodic memory gauges recorded: `server/index.ts:210-218`, `server/index.ts:337-344`

## Environment Variables
- `DATABASE_URL` — required Postgres connection: `server/index.ts:55-61`
- `SESSION_SECRET` — required session secret: `server/index.ts:59-61`
- `RATE_LIMIT_ENABLED` — global rate-limiter toggle: `server/index.ts:63-66`, `server/index.ts:143-146`
- `CSRF_ENABLED` — CSRF middleware toggle: `server/index.ts:63-66`
- `NODE_ENV` — controls security flags and dev serving: `server/index.ts:38-50`, `server/index.ts:328-332`
- `PORT` — listening port (default 5001): `server/index.ts:346-355`

## Dependencies
- Express, `express-session`, `connect-pg-simple`, `helmet`, `cookie-parser`, `csurf`
- Internal: `./routes`, `./db`, `./metrics`, `./vite`, `./storage`, `./logger`, `./middleware/*`, reference loader

