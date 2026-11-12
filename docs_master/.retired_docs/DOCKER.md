# Docker Development and Production Setup for Quest to Uranus

This guide explains how to run Quest to Uranus with Docker for development and provides production guidance.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)
- OpenAI API key (and any other required credentials)

## Quick Start (Development)

1. Copy environment template:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` (add your keys/secrets):
   - `OPENAI_API_KEY=...`
   - `SESSION_SECRET=...`
   - Optional:
     - `AI_INTEGRATIONS_OPENAI_BASE_URL=...`
     - `AI_INTEGRATIONS_OPENAI_API_KEY=...`
     - `TEST_API_KEY=...`
     - `HF_TOKEN=...`

3. Start the stack:
   ```bash
   docker-compose up
   ```

4. Access the app:
   - Open http://localhost:5001
   - App starts after PostgreSQL passes its healthcheck

## Services (Development)

- **postgres**
  - Image: `postgres:15`
  - Ports: `5432:5432`
  - Healthcheck: `pg_isready -U postgres`
  - Volume: `postgres_data:/var/lib/postgresql/data`

- **app**
  - Build: `Dockerfile` (Node 20-alpine)
  - Ports: `5001:5001`
  - Env:
    - `DATABASE_URL=postgresql://postgres:password@postgres:5432/uranus_dungeon`
    - `OPENAI_API_KEY`, `SESSION_SECRET`
    - Optional: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `TEST_API_KEY`, `HF_TOKEN`, `ADMIN_API_KEYS`
    - Security: `RATE_LIMIT_ENABLED` (default: `true`), `CSRF_ENABLED` (default: `true`), `ALLOWED_ORIGINS` (default: `*`)
    - Debug: `CONSOLE_LLM_LOG` (default: `false`)
    - `NODE_ENV=development`, `PORT=5001`
  - Depends on: `postgres` (condition: healthy)
  - Volumes:
    - `./generated_images:/app/generated_images`
    - `./attached_assets:/app/attached_assets`
    - `./releases:/app/releases`
    - `.:/app` (project source, live-reload)
    - `/app/node_modules` (anonymous volume to preserve container-installed deps)

## Build & Runtime Environment (Development)

- Base image: `node:20-alpine`
- Workdir: `/app`
- Dependency install inside container (`npm install`)
- Dev command: `npm run dev` (tsx watch mode)
- Exposed container port: `5001`

This is intentionally minimal for development. Source is bind-mounted (`.:/app`) for instant reloads and `/app/node_modules` is masked by an anonymous volume so host files do not override container-installed dependencies.

## Commands

### Start Development Environment
```bash
docker-compose up
```

### Start in Background
```bash
docker-compose up -d
```

### Stop Environment
```bash
docker-compose down
```

### Stop and Remove Volumes (Clean Slate)
```bash
docker-compose down -v
```

### View Logs
```bash
docker-compose logs -f app
```

### Rebuild After Code or Dependency Changes
```bash
docker-compose up --build
```

## Database Access

### Connect to PostgreSQL
```bash
docker-compose exec postgres psql -U postgres -d uranus_dungeon
```

### Reset Database
```bash
docker-compose down -v
docker-compose up
```

## Volumes and Files

- `postgres_data/` — Named volume for database persistence
- `generated_images/` — Bind-mounted AI-generated images
- `attached_assets/` — Bind-mounted game assets
- `releases/` — Bind-mounted release artifacts
- Project source is bind-mounted at `/app` for live reloads

## Environment Variables

These are read from your `.env` via Compose variable substitution. Some are set directly in the compose file.

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@postgres:5432/uranus_dungeon` (set in compose) |
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `SESSION_SECRET` | Secret for session cookies | Required |
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `5001` |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Custom OpenAI-compatible base URL | Optional |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | API key for custom base | Optional |
| `TEST_API_KEY` | Internal test key/flag | Optional |
| `HF_TOKEN` | Hugging Face token | Optional |
| `ADMIN_API_KEYS` | Comma-separated admin API keys | Optional |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `true` |
| `CSRF_ENABLED` | Enable CSRF protection | `true` |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | `*` |
| `CONSOLE_LLM_LOG` | Enable console logging of LLM requests | `false` |

## Troubleshooting

### Database Connection Issues
- Check status: `docker-compose ps`
- View DB logs: `docker-compose logs postgres`
- The app waits for `postgres` healthcheck to pass before starting

### Port Already in Use
- Change `PORT` in `.env` (e.g., `PORT=5002`)
- The compose file automatically uses the `PORT` environment variable for port mapping

### OpenAI/API Errors
- Verify keys are present and valid in `.env`
- Check app logs: `docker-compose logs app`

### Permission Issues (macOS/Linux)
- Ensure Docker has access to the project directory
- If needed:
  ```bash
  sudo chown -R "$USER:$USER" .
  ```

### Clean Restart
```bash
docker-compose down -v
docker system prune -f
docker-compose up --build
```

## Production Guidance

This repository ships a dev-focused configuration. For production, prefer a multi-stage image, disable bind mounts, and set `NODE_ENV=production`.

### Example Multi-stage Dockerfile (Production)

```dockerfile
# Builder stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY drizzle.config.ts ./
RUN npm ci
COPY . .
# Build step (adjust for your build script)
RUN npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Client build outputs to dist/public, server expects static files there
EXPOSE 5001
CMD ["node", "dist/index.js"]
```

### Example Compose Override (Production)

Create `docker-compose.override.yml` for production to disable dev bind mounts and set envs:

```yaml
services:
  app:
    image: yourrepo/uranus-app:latest
    build: # only if building locally
      context: .
      target: runtime
    environment:
      NODE_ENV: production
      PORT: 5001
      DATABASE_URL: ${DATABASE_URL}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
    ports:
      - "5001:5001"
    volumes: []
```

### Build and Push (Production)

```bash
# Build local image
docker build -t yourrepo/uranus-app:latest .

# Optional multi-arch build (requires buildx)
# docker buildx build --platform linux/amd64,linux/arm64 -t yourrepo/uranus-app:latest --push .

# Push (if using a registry)
# docker push yourrepo/uranus-app:latest
```

### Operational Recommendations

- Use a managed PostgreSQL service
- Inject secrets via your orchestrator/secret manager
- Place behind a reverse proxy (nginx/traefik)
- Enable healthchecks, logging, and monitoring
