# Build Environment Documentation

## Context & Overview

The Quest to Uranus build environment is designed to support both local development and production deployment through Docker containerization. The system uses a multi-stage Docker build process that optimizes for build speed, image size, and runtime security while maintaining consistency across development and production environments.

**Purpose**: The build environment provides:
- **Isolated Development**: Consistent Node.js and PostgreSQL environment across all developers
- **Production Optimization**: Multi-stage builds that separate build-time dependencies from runtime requirements
- **Heroku Compatibility**: Optimized for Heroku Container Registry deployments
- **Security**: Non-root user execution, minimal attack surface with Alpine Linux base images
- **Flexibility**: Supports both TypeScript source execution (via `tsx`) and compiled JavaScript bundles

**Why It Exists**: 
- Ensures all developers work with identical runtime environments (Node 20, PostgreSQL 15)
- Enables reproducible builds across different host operating systems
- Simplifies deployment to containerized platforms (Heroku, AWS ECS, etc.)
- Provides clear separation between development (bind-mounted volumes) and production (baked-in artifacts)

---

## Technical Details

### Build Architecture

The build system uses a **two-stage Docker build** pattern:

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Builder (node:20-alpine)                          │
│ ─────────────────────────────────────────────────────────── │
│ • Install all dependencies (including devDependencies)     │
│ • Copy source code and configuration files                  │
│ • Execute: npm run build                                    │
│   ├─ vite build (client assets → dist/public)              │
│   └─ esbuild (server bundle → dist/index.js)               │
│ • Output: dist/, releases/                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Production (node:20-alpine)                       │
│ ─────────────────────────────────────────────────────────── │
│ • Create non-root user (nodejs:1001)                        │
│ • Install runtime dependencies                              │
│ • Copy built artifacts from builder stage                   │
│ • Copy TypeScript source (for tsx runtime execution)        │
│ • Set up runtime directories (generated_images, logs, etc.) │
│ • Execute: npx tsx server/index.ts                         │
└─────────────────────────────────────────────────────────────┘
```

### Dockerfile Breakdown

#### Stage 1: Builder

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Layer caching optimization: copy dependency files first
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (devDependencies needed for build tools)
RUN npm ci --include=dev

# Copy all source code
COPY . .

# Build step: compiles client and server
RUN npm run build
```

**Key Points**:
- Uses `npm ci` for deterministic, reproducible installs
- Includes devDependencies because Vite, esbuild, and TypeScript are needed for compilation
- Build output includes:
  - `dist/public/`: Client assets (HTML, JS, CSS bundles)
  - `dist/index.js`: Server bundle (optional, not used in current setup)

#### Stage 2: Production

```dockerfile
FROM node:20-alpine AS production
WORKDIR /app

# Security: create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install dependencies (including devDependencies for tsx)
COPY package*.json ./
RUN npm ci --include=dev && \
    npm cache clean --force

# Copy built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases

# Copy TypeScript source (for tsx runtime execution)
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs client ./client
COPY --chown=nodejs:nodejs vite.config.ts ./
COPY --chown=nodejs:nodejs postcss.config.js ./
COPY --chown=nodejs:nodejs tailwind.config.ts ./
COPY --chown=nodejs:nodejs tsconfig.json ./

# Create runtime directories
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

USER nodejs
EXPOSE ${PORT:-5001}

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5001) + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Runtime: use tsx to execute TypeScript directly
CMD ["npx", "tsx", "server/index.ts"]
```

**Key Design Decisions**:
1. **TypeScript Source in Production**: The production image includes TypeScript source files and uses `tsx` for on-the-fly transpilation. This allows:
   - Dynamic imports to resolve correctly (e.g., `./vite` relative to `server/`)
   - No need to pre-compile all possible dynamic import paths
   - Easier debugging with source maps
   - Matches development environment behavior

2. **devDependencies in Production**: Required because `tsx` is a devDependency. This is intentional to maintain consistency with development.

3. **Non-Root User**: Runs as `nodejs:1001` for security best practices.

4. **Health Check**: Built-in HTTP health check that queries `/api/health` endpoint.

### Docker Compose Configuration

The `docker-compose.yml` file orchestrates two services:

#### PostgreSQL Service

```yaml
postgres:
  image: postgres:15
  environment:
    POSTGRES_DB: uranus_dungeon
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: password
  volumes:
    - postgres_data:/var/lib/postgresql/data
  ports:
    - "5432:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**Features**:
- Named volume (`postgres_data`) for data persistence
- Health check ensures database is ready before app starts
- Port 5432 exposed for direct database access

#### Application Service

```yaml
app:
  build: .
  image: uranus-dungeon:${IMAGE_TAG:-latest}
  environment:
    DATABASE_URL: postgresql://postgres:password@postgres:5432/uranus_dungeon
    NODE_ENV: ${NODE_ENV:-development}
    PORT: ${PORT:-5001}
    # ... additional env vars from .env
  depends_on:
    postgres:
      condition: service_healthy
  ports:
    - "${PORT:-5001}:${PORT:-5001}"
  volumes:
    - ./generated_images:/app/generated_images
    - ./attached_assets:/app/attached_assets
    - ./releases:/app/releases
    - ./logs:/app/logs
    - .:/app                    # Full source bind mount (dev mode)
    - /app/node_modules         # Anonymous volume (prevents host override)
```

**Volume Strategy**:
- **Bind Mounts**: Source code (`.:/app`) enables live reloading in development
- **Anonymous Volume**: `/app/node_modules` prevents host `node_modules` from overriding container-installed dependencies
- **Data Volumes**: `generated_images`, `attached_assets`, `releases`, `logs` persist between container restarts

**Service Dependencies**: App waits for PostgreSQL health check to pass before starting.

### Build Scripts

#### package.json Scripts

```json
{
  "scripts": {
    "dev": "NODE_ENV=development tsx server/index.ts",
    "docker:dev": "NODE_ENV=development tsx server/index.ts",
    "build": "vite build && esbuild server/index.ts --platform=node --packages=external --external:vite --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js"
  }
}
```

**Build Process** (`npm run build`):
1. **Vite Build**: 
   - Compiles React client application
   - Outputs to `dist/public/`
   - Creates optimized bundles with code splitting
   - Processes Tailwind CSS and PostCSS

2. **esbuild Bundle**:
   - Bundles server TypeScript entry point
   - Externalizes Node.js packages and vite
   - Outputs ESM format to `dist/index.js`
   - Note: Currently not used in production (tsx executes source directly)

#### Vite Configuration

```typescript
export default defineConfig({
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Code splitting strategy:
          // - vendor-react: React core
          // - vendor-react-query: TanStack Query
          // - vendor-motion: Framer Motion
          // - vendor: Other dependencies
        }
      }
    },
    chunkSizeWarningLimit: 1500,
  }
});
```

**Build Output Structure**:
```
dist/
├── public/
│   ├── index.html
│   ├── assets/
│   │   ├── vendor-react-[hash].js
│   │   ├── vendor-react-query-[hash].js
│   │   ├── vendor-motion-[hash].js
│   │   ├── vendor-[hash].js
│   │   └── index-[hash].js
│   └── ...
└── index.js (server bundle, optional)
```

### Technologies & Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20 (Alpine) | Runtime environment |
| **Docker** | Latest | Containerization |
| **Docker Compose** | Latest | Multi-service orchestration |
| **Vite** | 5.4.20 | Client build tool |
| **esbuild** | 0.25.0 | Server bundler |
| **TypeScript** | 5.6.3 | Type checking and compilation |
| **tsx** | 4.20.5 | TypeScript execution runtime |
| **PostgreSQL** | 15 | Database |
| **Alpine Linux** | Latest | Minimal base image |

### Build Stages Summary

| Stage | Purpose | Dependencies | Output |
|-------|---------|--------------|--------|
| **Builder** | Compile client and server | All npm packages (dev + prod) | `dist/`, `releases/` |
| **Production** | Runtime container | Runtime npm packages | Executable container image |

---

## Practical Guidance

### Development Workflow

#### Initial Setup

1. **Prerequisites**:
   ```bash
   # Verify Docker is running
   docker --version
   docker-compose --version
   ```

2. **Environment Configuration**:
   ```bash
   # Copy environment template
   cp env.example .env
   
   # Edit .env with your API keys and secrets
   # Required:
   # - OPENAI_API_KEY
   # - SESSION_SECRET (generate with: openssl rand -hex 32)
   # - DATABASE_URL (auto-configured for Docker Compose)
   ```

3. **Start Development Environment**:
   ```bash
   # Build and start all services
   docker-compose up
   
   # Or run in background
   docker-compose up -d
   ```

4. **Verify Services**:
   ```bash
   # Check service status
   docker-compose ps
   
   # View application logs
   docker-compose logs -f app
   
   # Access application
   open http://localhost:5001
   ```

#### Common Development Commands

```bash
# Rebuild after dependency changes
docker-compose up --build

# Rebuild specific service
docker-compose build app

# View logs (all services)
docker-compose logs -f

# View logs (specific service)
docker-compose logs -f app
docker-compose logs -f postgres

# Execute command in running container
docker-compose exec app npm run check
docker-compose exec app sh

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v

# Restart specific service
docker-compose restart app
```

#### Database Operations

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U postgres -d uranus_dungeon

# Run SQL commands
docker-compose exec postgres psql -U postgres -d uranus_dungeon -c "SELECT COUNT(*) FROM games;"

# Backup database
docker-compose exec postgres pg_dump -U postgres uranus_dungeon > backup.sql

# Restore database
docker-compose exec -T postgres psql -U postgres uranus_dungeon < backup.sql

# Reset database (destructive)
docker-compose down -v
docker-compose up
```

### Production Build Process

#### Local Production Build

```bash
# Build production image
docker build -t uranus-dungeon:latest .

# Run production container
docker run -p 5001:5001 \
  -e DATABASE_URL="postgresql://..." \
  -e OPENAI_API_KEY="..." \
  -e SESSION_SECRET="..." \
  uranus-dungeon:latest

# Or use docker-compose with production overrides
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

#### Heroku Deployment

The project includes a deployment script (`deploy-to-heroku.sh`) that automates Heroku Container Registry deployment:

```bash
# Deploy to Heroku
./deploy-to-heroku.sh your-app-name

# Manual Heroku deployment steps:
heroku container:login
heroku container:push web -a your-app-name
heroku container:release web -a your-app-name
```

**Heroku Configuration** (`heroku.yml`):
```yaml
build:
  docker:
    web: Dockerfile

run:
  web: npm start
```

**Note**: The `npm start` command in `heroku.yml` is currently not used because the Dockerfile CMD overrides it. The Dockerfile uses `tsx` directly.

### Build Optimization Strategies

#### Layer Caching

The Dockerfile is optimized for layer caching:

1. **Dependency Installation First**: `package*.json` and `tsconfig.json` are copied before source code
2. **Separate Build Stage**: Build dependencies are isolated from runtime
3. **Minimal Production Image**: Only necessary files are copied to final stage

**Cache Invalidation Triggers**:
- Changes to `package.json` or `package-lock.json`
- Changes to `tsconfig.json`
- Changes to source code (after dependency layer)

#### Build Performance

**Development**:
- Bind-mounted volumes enable instant file changes
- No rebuild required for code changes (tsx watches files)
- Only rebuild when dependencies change

**Production**:
- Multi-stage build reduces final image size
- Alpine Linux base image (~5MB) vs full Node image (~300MB)
- Build stage can be cached in CI/CD pipelines

### Environment Variables

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@postgres:5432/uranus_dungeon` |
| `OPENAI_API_KEY` | OpenAI API key for LLM calls | `sk-...` |
| `SESSION_SECRET` | Secret for session cookies | Random hex string (32+ chars) |

#### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode (`development` \| `production`) |
| `PORT` | `5001` | Server port |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Custom OpenAI-compatible endpoint |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | - | API key for custom endpoint |
| `RATE_LIMIT_ENABLED` | `true` | Enable rate limiting |
| `CSRF_ENABLED` | `true` | Enable CSRF protection |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `ADMIN_API_KEYS` | - | Comma-separated admin API keys |
| `HF_TOKEN` | - | Hugging Face token for image models |
| `CONSOLE_LLM_LOG` | `false` | Enable console logging of LLM requests |
| `IMAGE_SIMILARITY_CACHE_ENABLED` | `true` | Enable similarity-based image caching |

#### Environment-Specific Configuration

**Development** (`.env`):
```bash
NODE_ENV=development
PORT=5001
RATE_LIMIT_ENABLED=false
CSRF_ENABLED=false
CONSOLE_LLM_LOG=true
```

**Production** (Heroku/Container):
```bash
NODE_ENV=production
PORT=${PORT}  # Set by platform
RATE_LIMIT_ENABLED=true
CSRF_ENABLED=true
CONSOLE_LLM_LOG=false
```

---

## Troubleshooting & Support

### Common Issues

#### Database Connection Failures

**Symptoms**: App fails to start, logs show "ECONNREFUSED" or "database does not exist"

**Solutions**:
```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify health check
docker-compose exec postgres pg_isready -U postgres

# Restart PostgreSQL
docker-compose restart postgres

# Reset database (if corrupted)
docker-compose down -v
docker-compose up
```

**Root Causes**:
- PostgreSQL container not started
- Health check failing (database not ready)
- Incorrect `DATABASE_URL` in environment

#### Port Already in Use

**Symptoms**: `Error: listen EADDRINUSE: address already in use :::5001`

**Solutions**:
```bash
# Option 1: Change port in .env
echo "PORT=5002" >> .env
docker-compose up

# Option 2: Find and kill process using port
lsof -ti:5001 | xargs kill -9

# Option 3: Use different port mapping in docker-compose.yml
ports:
  - "5002:5001"  # Host:Container
```

#### Build Failures

**Symptoms**: `npm run build` fails in Docker build

**Solutions**:
```bash
# Check build logs
docker-compose build --no-cache app

# Verify Node version compatibility
docker-compose exec app node --version  # Should be 20.x

# Check disk space
df -h

# Clear Docker build cache
docker builder prune

# Rebuild from scratch
docker-compose build --no-cache --pull app
```

**Common Build Errors**:
- **Out of memory**: Increase Docker memory limit (Docker Desktop → Settings → Resources)
- **Network timeout**: Check npm registry connectivity, use `.npmrc` for proxy
- **TypeScript errors**: Run `npm run check` locally first

#### Permission Issues

**Symptoms**: "EACCES: permission denied" when writing files

**Solutions**:
```bash
# Fix ownership (macOS/Linux)
sudo chown -R "$USER:$USER" .

# Fix Docker volume permissions
docker-compose down
docker volume prune
docker-compose up

# Check container user
docker-compose exec app whoami  # Should be 'nodejs'
```

#### Image Generation Failures

**Symptoms**: Images not generating, API errors

**Solutions**:
```bash
# Verify API keys
docker-compose exec app env | grep OPENAI

# Check image storage directory permissions
docker-compose exec app ls -la /app/generated_images

# View AI service logs
docker-compose logs app | grep -i "ai\|image\|openai"

# Test API key directly
docker-compose exec app node -e "console.log(process.env.OPENAI_API_KEY?.substring(0, 10))"
```

### Debugging Strategies

#### Container Inspection

```bash
# Enter running container
docker-compose exec app sh

# Check environment variables
docker-compose exec app env

# Check file system
docker-compose exec app ls -la /app

# Check process list
docker-compose exec app ps aux

# Check network connectivity
docker-compose exec app ping postgres
docker-compose exec app nc -zv postgres 5432
```

#### Log Analysis

```bash
# Follow all logs
docker-compose logs -f

# Filter logs by service
docker-compose logs -f app | grep ERROR

# Export logs to file
docker-compose logs app > app.log

# Check specific time range (requires log driver configuration)
docker-compose logs --since 1h app
```

#### Performance Debugging

```bash
# Check container resource usage
docker stats

# Check image size
docker images uranus-dungeon

# Analyze image layers
docker history uranus-dungeon:latest

# Check build time breakdown
docker build --progress=plain -t uranus-dungeon:latest .
```

### Error Messages Reference

| Error | Meaning | Solution |
|-------|---------|----------|
| `Cannot find module` | Missing dependency or incorrect path | Run `npm ci` in container |
| `EADDRINUSE` | Port already in use | Change `PORT` or kill existing process |
| `ECONNREFUSED` | Database not reachable | Check PostgreSQL health, verify `DATABASE_URL` |
| `ENOENT` | File or directory not found | Check volume mounts, verify paths |
| `EACCES` | Permission denied | Fix file ownership, check user permissions |
| `Health check failed` | Container not responding | Check application logs, verify `/api/health` endpoint |
| `Build context excluded` | File not copied to Docker | Check `.dockerignore`, verify `COPY` commands |

---

## Standards & Processes

### Quality Requirements

#### Image Size Optimization

**Target**: Production image < 500MB

**Current Strategy**:
- Alpine Linux base (~5MB vs ~300MB for full Node)
- Multi-stage build removes build dependencies
- `npm cache clean` after install
- Only necessary files copied to final stage

**Monitoring**:
```bash
docker images uranus-dungeon:latest
```

#### Build Time Targets

**Development**: < 30 seconds (with cache)
**Production**: < 5 minutes (first build), < 2 minutes (cached)

**Optimization Techniques**:
- Layer caching (dependencies before source)
- Parallel stage builds (if using buildx)
- BuildKit cache mounts (for npm cache)

#### Security Standards

1. **Non-Root Execution**: Container runs as `nodejs:1001`
2. **Minimal Base Image**: Alpine Linux reduces attack surface
3. **No Secrets in Image**: All secrets via environment variables
4. **Health Checks**: Built-in container health monitoring
5. **Dependency Scanning**: Regular `npm audit` checks

**Security Checklist**:
- [ ] No hardcoded secrets in Dockerfile
- [ ] Non-root user configured
- [ ] Minimal base image used
- [ ] Health check configured
- [ ] Dependencies up to date
- [ ] `.dockerignore` excludes sensitive files

### Performance Implications

#### Development Performance

**Bind Mounts**: 
- **Pros**: Instant file changes, no rebuild needed
- **Cons**: Slight I/O overhead on macOS/Windows (Docker Desktop)

**Anonymous Volume for node_modules**:
- **Pros**: Prevents host/container conflicts
- **Cons**: Requires rebuild if dependencies change

#### Production Performance

**Multi-Stage Build**:
- **Pros**: Smaller final image, faster deployments
- **Cons**: Longer initial build time

**TypeScript Source in Production**:
- **Pros**: Dynamic imports work correctly, easier debugging
- **Cons**: Slightly slower startup (tsx transpilation), larger image size

**Recommendation**: For production at scale, consider pre-compiling TypeScript and using the `dist/index.js` bundle with `npm start`.

### Testing & Validation

#### Build Validation

```bash
# Type check
docker-compose exec app npm run check

# Build test
docker-compose exec app npm run build

# Test suite
docker-compose exec app npm test
```

#### Container Validation

```bash
# Health check
curl http://localhost:5001/api/health

# Container health (Docker)
docker inspect --format='{{.State.Health.Status}}' $(docker-compose ps -q app)

# Resource limits
docker stats $(docker-compose ps -q app)
```

#### Integration Testing

```bash
# Start test environment
docker-compose up -d

# Run integration tests
docker-compose exec app npm run test:integration

# Cleanup
docker-compose down
```

### Build Process Checklist

**Before Committing**:
- [ ] `npm run check` passes (TypeScript)
- [ ] `npm run build` succeeds locally
- [ ] Docker build completes: `docker build -t test .`
- [ ] `docker-compose up` starts all services
- [ ] Health check passes: `curl http://localhost:5001/api/health`

**Before Deploying**:
- [ ] Production Docker build tested
- [ ] Environment variables documented
- [ ] Database migrations tested (if applicable)
- [ ] Image size within targets
- [ ] Security scan completed (`npm audit`)
- [ ] Health check endpoint verified

---

## Potential Optimizations

This section outlines potential improvements to the build environment that could enhance performance, reduce costs, improve security, or simplify operations. These are recommendations for future consideration, not immediate requirements.

### Critical Performance Issues (Immediate Fixes)

#### 0. Remove Redundant Final chown Operation

**Current Problem**: The final `RUN chown -R nodejs:nodejs /app` step takes **15+ seconds** on every build and is completely redundant.

**Root Cause**: Every `COPY` command already uses `--chown=nodejs:nodejs`, so all files are already owned correctly. The final recursive chown is:
- Scanning and changing ownership of thousands of files unnecessarily
- Including `node_modules` (already owned from line 37)
- Including all copied files (already owned from COPY commands)
- Creating a large, slow layer

**Current Dockerfile (lines 39-60)**:
```dockerfile
# Change ownership of node_modules to nodejs user
RUN chown -R nodejs:nodejs /app/node_modules

# Copy built artifacts (already owned correctly)
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases

# Copy source files (already owned correctly)
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs shared ./shared
# ... more COPY commands with --chown ...

# Create directories and chown them
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

# REDUNDANT: This chowns everything again, including files already owned correctly
RUN chown -R nodejs:nodejs /app  # ⚠️ Takes 15+ seconds, completely unnecessary
```

**Optimized Solution**:
```dockerfile
# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files and install (as root, before switching user)
COPY package*.json ./
RUN npm ci --include=dev && \
    npm cache clean --force

# Change ownership of node_modules BEFORE copying other files
RUN chown -R nodejs:nodejs /app/node_modules

# Copy all files with correct ownership from the start
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs vite.config.ts ./
COPY --chown=nodejs:nodejs postcss.config.js ./
COPY --chown=nodejs:nodejs tailwind.config.ts ./
COPY --chown=nodejs:nodejs tsconfig.json ./
COPY --chown=nodejs:nodejs client ./client

# Create runtime directories with correct ownership
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

# REMOVE THIS LINE - it's redundant!
# RUN chown -R nodejs:nodejs /app  ❌ DELETE THIS

# Switch to non-root user
USER nodejs
```

**Benefits**:
- **15+ seconds faster builds** (eliminates slowest step)
- Smaller image layers
- Clearer intent (ownership set once per file)
- No functional change (same end result)

**Implementation Effort**: **Trivial** (delete one line)

**Priority**: **CRITICAL** - This should be fixed immediately as it provides significant build time improvement with zero risk.

#### 0.1. Question the Production Stage Architecture

**Current State**: The production stage:
1. Installs ALL dependencies (including devDependencies) - needed for `tsx`
2. Copies ALL TypeScript source files (`server/`, `shared/`, `client/`)
3. Copies ALL config files
4. Uses `tsx` to execute TypeScript at runtime

**Analysis Results** (based on codebase inspection):

✅ **Confirmed**: Vite is **NOT used in production**
- `server/index.ts:343` shows: `if (app.get("env") === "development")` - vite only runs in dev
- Production uses `serveStatic(app)` which only needs `dist/public/`
- `server/vite.ts` is dynamically imported, but the import is guarded by the development check

✅ **Confirmed**: Client source is **NOT needed in production**
- `serveStatic()` only serves `dist/public/` (built client assets)
- `client/` directory is only accessed by vite dev server
- No runtime code references `client/` when `NODE_ENV=production`

✅ **Confirmed**: Build configs are **NOT needed in production**
- `vite.config.ts` - only used by vite (dev mode only)
- `postcss.config.js` - only used during build
- `tailwind.config.ts` - only used during build

❓ **Uncertain**: Full `server/` directory needed?
- Dynamic imports in `server/index.ts` (lines 268-327) import route modules
- These are imported at startup, not truly "dynamic" at runtime
- Could potentially be pre-compiled, but requires testing

✅ **Confirmed**: Most devDependencies **NOT needed**
- Only `tsx` is needed at runtime (to execute TypeScript)
- `vite`, `esbuild`, `typescript`, etc. are only for build

**Key Findings**:
1. **Vite is development-only**: Code explicitly checks `app.get("env") === "development"` before importing vite
2. **Client source unnecessary**: Production serves pre-built assets from `dist/public/`
3. **Build configs unnecessary**: All build-time configs can be removed
4. **Dependencies bloated**: Installing all devDependencies when only `tsx` is needed

**Optimized Production Stage** (Option 1: Keep tsx, remove unnecessary files):
```dockerfile
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install production dependencies + tsx (tsx is devDependency but needed at runtime)
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm install tsx --save-prod && \
    npm cache clean --force

# Change ownership of node_modules
RUN chown -R nodejs:nodejs /app/node_modules

# Copy only built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases

# Copy only server and shared source (needed for tsx execution)
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs tsconfig.json ./

# REMOVED: client/ (not needed - production uses dist/public/)
# REMOVED: vite.config.ts (not needed - vite only runs in dev)
# REMOVED: postcss.config.js (not needed - only used during build)
# REMOVED: tailwind.config.ts (not needed - only used during build)

# Create runtime directories
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

USER nodejs
CMD ["npx", "tsx", "server/index.ts"]
```

**Expected Savings**:
- **Image Size**: ~30-40% reduction (removes ~50-100MB of unnecessary files)
- **Build Time**: ~5-10 seconds faster (fewer COPY operations)
- **Dependencies**: ~200MB smaller node_modules (no vite, esbuild, typescript, etc.)

**Optimized Production Stage** (Option 2: Pre-compile TypeScript, no tsx needed):
```dockerfile
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install ONLY production dependencies (no tsx needed!)
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Change ownership of node_modules
RUN chown -R nodejs:nodejs /app/node_modules

# Copy built artifacts (including pre-compiled server)
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases

# REMOVED: All TypeScript source files (using pre-compiled JS)
# REMOVED: client/, vite.config.ts, postcss.config.js, tailwind.config.ts, tsconfig.json

# Create runtime directories
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

USER nodejs
CMD ["node", "dist/server/index.js"]
```

**Option 2 Requirements**:
- Update build script to compile all server TypeScript to `dist/server/`
- Ensure dynamic imports resolve correctly at build time
- More complex but maximum optimization

**Benefits**:
- **30-50% smaller image** (no client source, fewer dependencies)
- **Faster builds** (fewer COPY operations)
- **Faster startup** (if using pre-compiled JS)
- **Better security** (fewer files, fewer dependencies)

**Implementation Effort**: Medium (requires testing and potentially build script changes)

**Priority**: High (significant image size and build time improvements)

### Build Performance Optimizations

#### 1. BuildKit Cache Mounts

**Current State**: npm cache is cleared after installation, requiring full dependency reinstall on cache miss.

**Optimization**: Use BuildKit cache mounts to persist npm cache between builds:

```dockerfile
# Syntax: dockerfile:1.4
#syntax=docker/dockerfile:1.4

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

# Cache npm cache directory
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

COPY . .
RUN npm run build
```

**Benefits**:
- 50-80% faster dependency installation on subsequent builds
- Reduced network bandwidth usage
- Works across CI/CD pipeline runs

**Implementation Effort**: Low (requires BuildKit, Docker 20.10+)

#### 2. Parallel Build Stages

**Current State**: Build stages run sequentially.

**Optimization**: Use Docker Buildx to build multiple stages in parallel:

```dockerfile
# Build client and server in parallel
FROM node:20-alpine AS client-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY client ./client
COPY vite.config.ts ./
RUN npm run build:client

FROM node:20-alpine AS server-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY server ./server
COPY shared ./shared
RUN npm run build:server

FROM node:20-alpine AS production
# Combine outputs from both builders
COPY --from=client-builder /app/dist/public ./dist/public
COPY --from=server-builder /app/dist/server ./dist/server
```

**Benefits**:
- 30-40% faster builds on multi-core systems
- Better resource utilization

**Implementation Effort**: Medium (requires restructuring build scripts)

#### 3. Dependency Layer Optimization

**Current State**: All dependencies (including devDependencies) installed in production stage.

**Optimization**: Separate production dependencies:

```dockerfile
FROM node:20-alpine AS production
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy only tsx from devDependencies (if needed)
# Or use a separate minimal runtime like node:20-alpine-slim
```

**Benefits**:
- 20-30% smaller production image
- Faster container startup
- Reduced attack surface

**Trade-offs**: Requires ensuring `tsx` is available or switching to pre-compiled JavaScript

**Implementation Effort**: Medium (requires runtime execution strategy change)

### Image Size Optimizations

#### 4. Distroless or Scratch Base Image

**Current State**: Uses `node:20-alpine` (~50MB base).

**Optimization**: Use Google's distroless Node.js image:

```dockerfile
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS production
WORKDIR /app

# Copy pre-built artifacts only
COPY --from=builder --chown=nonroot:nonroot /app/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/releases ./releases

# No shell, no package manager, minimal attack surface
CMD ["dist/index.js"]
```

**Benefits**:
- 30-40% smaller final image size
- Enhanced security (no shell, minimal packages)
- Reduced CVE exposure

**Trade-offs**: 
- Requires pre-compiled JavaScript (no tsx)
- More difficult debugging (no shell access)
- Must ensure all dependencies are statically linked

**Implementation Effort**: High (requires full TypeScript compilation pipeline)

#### 5. Multi-Stage Dependency Pruning

**Current State**: Production stage includes all source files for tsx execution.

**Optimization**: Copy only necessary files:

```dockerfile
FROM node:20-alpine AS production
WORKDIR /app

# Copy only runtime-required files
COPY --from=builder --chown=nodejs:nodejs \
  /app/dist ./dist \
  /app/releases ./releases

# Copy only server entry points and shared code
COPY --chown=nodejs:nodejs \
  server/index.ts \
  server/vite.ts \
  shared/ \
  tsconfig.json \
  vite.config.ts \
  ./

# Exclude client source, tests, docs
```

**Benefits**:
- 10-15% smaller image
- Faster COPY operations
- Clearer runtime dependencies

**Implementation Effort**: Low (requires careful file selection)

### Runtime Performance Optimizations

#### 6. Pre-compiled TypeScript

**Current State**: TypeScript source executed via `tsx` at runtime.

**Optimization**: Pre-compile TypeScript to JavaScript:

```dockerfile
# In builder stage
RUN npm run build:server  # Compile all TypeScript

# In production stage
COPY --from=builder /app/dist/server ./dist/server
CMD ["node", "dist/server/index.js"]
```

**Benefits**:
- 20-30% faster application startup
- Lower memory usage (no tsx overhead)
- Smaller image (no TypeScript source files)

**Trade-offs**:
- Must handle all dynamic imports at build time
- More complex build configuration
- Less flexible for debugging

**Implementation Effort**: Medium (requires build script updates and dynamic import resolution)

#### 7. Node.js Production Flags

**Current State**: No Node.js optimization flags.

**Optimization**: Enable production optimizations:

```dockerfile
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512 --enable-source-maps"
CMD ["node", "--optimize-for-size", "dist/index.js"]
```

**Benefits**:
- Better memory management
- Smaller memory footprint
- Source map support for debugging

**Implementation Effort**: Low (environment variable change)

### Development Experience Optimizations

#### 8. Docker Compose Override Files

**Current State**: Single `docker-compose.yml` for all environments.

**Optimization**: Use override files for environment-specific configurations:

```bash
# docker-compose.dev.yml (development)
services:
  app:
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      NODE_ENV: development
      CONSOLE_LLM_LOG: true

# docker-compose.test.yml (testing)
services:
  app:
    environment:
      NODE_ENV: test
      DATABASE_URL: postgresql://postgres:password@postgres:5432/uranus_dungeon_test
```

**Usage**:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
docker-compose -f docker-compose.yml -f docker-compose.test.yml up
```

**Benefits**:
- Cleaner configuration management
- Easier environment switching
- Reduced configuration errors

**Implementation Effort**: Low

#### 9. Hot Module Replacement (HMR) in Docker

**Current State**: Full container restart on code changes.

**Optimization**: Configure Vite HMR for Docker:

```yaml
# docker-compose.yml
services:
  app:
    environment:
      VITE_HMR_PORT: 5173
      VITE_HMR_HOST: localhost
    ports:
      - "5001:5001"
      - "5173:5173"  # HMR WebSocket
```

**Benefits**:
- Instant code updates without container restart
- Better development experience
- Faster iteration cycles

**Implementation Effort**: Medium (requires Vite configuration updates)

### Security Optimizations

#### 10. Dependency Vulnerability Scanning

**Current State**: Manual `npm audit` checks.

**Optimization**: Automated scanning in CI/CD:

```yaml
# .github/workflows/security.yml
- name: Run npm audit
  run: npm audit --audit-level=moderate

- name: Scan Docker image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: uranus-dungeon:latest
```

**Benefits**:
- Early detection of vulnerabilities
- Automated security updates
- Compliance with security policies

**Implementation Effort**: Low (CI/CD integration)

#### 11. Read-Only Root Filesystem

**Current State**: Writable filesystem in container.

**Optimization**: Mount writable directories as volumes:

```dockerfile
# Create writable directories as volumes
VOLUME ["/app/generated_images", "/app/logs"]

# Run with read-only root
docker run --read-only \
  --tmpfs /tmp \
  --tmpfs /app/generated_images \
  --tmpfs /app/logs \
  uranus-dungeon:latest
```

**Benefits**:
- Enhanced security (prevents file system tampering)
- Immutable container runtime
- Compliance with security best practices

**Trade-offs**: Requires careful volume management

**Implementation Effort**: Medium (requires volume strategy review)

### CI/CD Optimizations

#### 12. Build Cache in CI/CD

**Current State**: Full rebuild on each CI run.

**Optimization**: Use Docker layer caching in CI:

```yaml
# GitHub Actions example
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v2

- name: Build with cache
  uses: docker/build-push-action@v4
  with:
    cache-from: type=registry,ref=ghcr.io/${{ github.repository }}/buildcache
    cache-to: type=registry,ref=ghcr.io/${{ github.repository }}/buildcache,mode=max
```

**Benefits**:
- 60-80% faster CI builds
- Reduced CI/CD costs
- Faster feedback loops

**Implementation Effort**: Low (CI/CD configuration)

#### 13. Multi-Architecture Builds

**Current State**: Single architecture builds (typically amd64).

**Optimization**: Build for multiple architectures:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --cache-from type=registry,ref=uranus-dungeon:buildcache \
  --cache-to type=registry,ref=uranus-dungeon:buildcache,mode=max \
  -t uranus-dungeon:latest \
  --push .
```

**Benefits**:
- Support for ARM-based servers (AWS Graviton, Apple Silicon)
- Cost savings on ARM instances
- Future-proof architecture support

**Implementation Effort**: Low (requires buildx setup)

### Monitoring & Observability Optimizations

#### 14. Build Metrics Collection

**Current State**: No build performance tracking.

**Optimization**: Collect build metrics:

```dockerfile
# Add build metadata
LABEL build.time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LABEL build.size="$(du -sh /app | cut -f1)"
LABEL build.dependencies="$(npm list --depth=0 | wc -l)"
```

**Benefits**:
- Track build performance over time
- Identify optimization opportunities
- Monitor image size trends

**Implementation Effort**: Low

#### 15. Health Check Improvements

**Current State**: Basic HTTP health check.

**Optimization**: Enhanced health checks with dependencies:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "Promise.all([ \
    fetch('http://localhost:' + (process.env.PORT || 5001) + '/api/health'), \
    require('pg').connect(process.env.DATABASE_URL).then(c => c.end()) \
  ]).then(() => process.exit(0)).catch(() => process.exit(1))"
```

**Benefits**:
- More accurate health status
- Database connectivity verification
- Better failure detection

**Implementation Effort**: Medium (requires health check endpoint updates)

### Cost Optimizations

#### 16. Dependency Optimization

**Current State**: All dependencies installed.

**Optimization**: Audit and remove unused dependencies:

```bash
# Use depcheck to find unused dependencies
npx depcheck

# Use bundle analyzer for client dependencies
npm run build -- --analyze
```

**Benefits**:
- Smaller node_modules
- Faster installs
- Reduced security surface

**Implementation Effort**: Low (requires dependency audit)

#### 17. Image Layer Deduplication

**Current State**: Each build creates new layers.

**Optimization**: Use shared base images:

```dockerfile
# Create shared base image
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
USER nodejs

# Use in application Dockerfile
FROM base AS production
COPY --chown=nodejs:nodejs . .
```

**Benefits**:
- Shared layers across multiple services
- Reduced registry storage costs
- Faster pulls (layer reuse)

**Implementation Effort**: Medium (requires base image management)

### Implementation Priority Matrix

| Optimization | Impact | Effort | Priority | Recommended For |
|--------------|--------|--------|----------|-----------------|
| **Remove Redundant chown** | **Very High** | **Trivial** | **CRITICAL** | **All builds (immediate fix)** |
| **Production Stage Architecture Review** | **High** | Medium | **High** | Production deployments |
| BuildKit Cache Mounts | High | Low | **High** | All environments |
| Dependency Optimization | Medium | Low | **High** | All environments |
| CI/CD Build Cache | High | Low | **High** | CI/CD pipelines |
| Multi-Architecture Builds | Medium | Low | Medium | Production deployments |
| Docker Compose Overrides | Low | Low | Medium | Development teams |
| Pre-compiled TypeScript | High | Medium | Medium | Production at scale |
| Distroless Base Image | Medium | High | Low | High-security requirements |
| Read-Only Filesystem | Medium | Medium | Low | Security-critical deployments |
| HMR in Docker | Low | Medium | Low | Development experience |
| Build Metrics | Low | Low | Low | Long-term optimization |

### Optimization Workflow

1. **Measure Baseline**: Establish current metrics (build time, image size, startup time)
2. **Identify Bottlenecks**: Use profiling tools to find slow areas
3. **Prioritize**: Use priority matrix above
4. **Implement Incrementally**: One optimization at a time
5. **Measure Impact**: Compare before/after metrics
6. **Document**: Update this section with implemented optimizations

### Notes

- **Not All Optimizations Are Equal**: Some may conflict with each other (e.g., distroless vs. tsx)
- **Measure Before Optimizing**: Use profiling to identify actual bottlenecks
- **Consider Trade-offs**: Every optimization has costs (complexity, maintainability, flexibility)
- **Test Thoroughly**: Optimizations can introduce subtle bugs
- **Document Changes**: Keep this section updated as optimizations are implemented

---

## Visual Aids

### Build Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Development Workflow                      │
└─────────────────────────────────────────────────────────────┘

Developer Machine
    │
    ├─ Edit Code (client/, server/, shared/)
    │
    ├─ docker-compose up
    │   │
    │   ├─ Build Stage (if Dockerfile changed)
    │   │   ├─ Install dependencies
    │   │   └─ Build assets (vite + esbuild)
    │   │
    │   └─ Runtime Stage
    │       ├─ Start PostgreSQL
    │       ├─ Wait for DB health check
    │       └─ Start App (tsx server/index.ts)
    │
    └─ Live Reload (bind-mounted volumes)
        └─ Code changes → Container restart → App updates
```

```
┌─────────────────────────────────────────────────────────────┐
│                  Production Build Flow                      │
└─────────────────────────────────────────────────────────────┘

Source Code
    │
    ├─ Docker Build (CI/CD or Local)
    │   │
    │   ├─ Stage 1: Builder
    │   │   ├─ FROM node:20-alpine AS builder
    │   │   ├─ COPY package*.json
    │   │   ├─ RUN npm ci --include=dev
    │   │   ├─ COPY . .
    │   │   └─ RUN npm run build
    │   │       ├─ vite build → dist/public/
    │   │       └─ esbuild → dist/index.js
    │   │
    │   └─ Stage 2: Production
    │       ├─ FROM node:20-alpine AS production
    │       ├─ Create nodejs user
    │       ├─ Install runtime deps
    │       ├─ COPY --from=builder dist/
    │       ├─ COPY TypeScript source
    │       └─ CMD ["npx", "tsx", "server/index.ts"]
    │
    └─ Container Image
        └─ Deploy to Heroku/ECS/etc.
```

### Docker Compose Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                      │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│   PostgreSQL     │         │   Application    │
│   Service        │         │   Service        │
├──────────────────┤         ├──────────────────┤
│ Image:           │         │ Image:           │
│ postgres:15      │         │ uranus-dungeon   │
│                  │         │                  │
│ Port: 5432       │◄────────┤ Port: 5001       │
│                  │         │                  │
│ Volume:          │         │ Volumes:         │
│ postgres_data    │         │ - ./generated_   │
│                  │         │   images         │
│ Health Check:    │         │ - ./releases     │
│ pg_isready       │         │ - ./logs         │
│                  │         │ - .:/app (dev)   │
└──────────────────┘         └──────────────────┘
         │                            │
         └────────────────────────────┘
              Docker Network
         (uranus-dungeon_default)
```

### Layer Caching Strategy

```
Dockerfile Layer Cache Hierarchy:

Layer 1: FROM node:20-alpine AS builder
  └─ Cache: Base image (rarely changes)

Layer 2: COPY package*.json
  └─ Cache: Invalidated when package.json changes

Layer 3: RUN npm ci --include=dev
  └─ Cache: Invalidated when package*.json or package-lock.json changes

Layer 4: COPY . .
  └─ Cache: Invalidated on any source file change

Layer 5: RUN npm run build
  └─ Cache: Invalidated when Layer 4 changes

─────────────────────────────────────────

Production Stage:

Layer 6: FROM node:20-alpine AS production
  └─ Cache: Base image (rarely changes)

Layer 7: COPY package*.json + RUN npm ci
  └─ Cache: Invalidated when package.json changes

Layer 8: COPY --from=builder ...
  └─ Cache: Invalidated when builder stage changes

Layer 9: COPY source files
  └─ Cache: Invalidated on source changes
```

---

## Cross-References

### Related Documentation

- **[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)**: Overall system architecture
- **[AGENTS.md](../AGENTS.md)**: Runtime agent responsibilities
- **[API_GUIDE.md](./API_GUIDE.md)**: API endpoints and usage
- **[AI_SERVICE.md](./AI_SERVICE.md)**: AI service configuration

### Dependencies

**Build Dependencies**:
- Node.js 20+ (specified in `package.json` engines)
- Docker & Docker Compose
- npm 9+ (comes with Node 20)

**Runtime Dependencies**:
- PostgreSQL 15
- Node.js 20 (Alpine)
- All npm packages (see `package.json`)

### Integration Points

**With CI/CD**:
- Heroku Container Registry (via `deploy-to-heroku.sh`)
- GitHub Actions (can use Docker build steps)
- Any container registry (Docker Hub, ECR, GCR)

**With Development Tools**:
- VS Code Dev Containers (can use `docker-compose.yml`)
- Local development (can run without Docker using `npm run dev`)

**With Monitoring**:
- Health check endpoint: `/api/health`
- Prometheus metrics: `/metrics`
- Container health checks (Docker native)

---

## Appendix

### .dockerignore

Recommended `.dockerignore` to exclude unnecessary files from build context:

```
node_modules
npm-debug.log
.git
.gitignore
.env
.env.local
*.md
.vscode
.idea
dist
build
coverage
*.log
.DS_Store
```

### Production Override Example

Create `docker-compose.prod.yml` for production-specific overrides:

```yaml
services:
  app:
    build:
      target: production
    environment:
      NODE_ENV: production
    volumes:
      # Remove bind mounts in production
      - generated_images:/app/generated_images
      - logs:/app/logs
    # Use external database
    # depends_on: []  # Remove if using external DB

volumes:
  generated_images:
  logs:
```

### Multi-Architecture Builds

For ARM64/AMD64 compatibility (e.g., Apple Silicon + Linux servers):

```bash
# Enable buildx
docker buildx create --use

# Build for multiple platforms
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t uranus-dungeon:latest \
  --push .
```

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-08  
**Maintainer**: Engineering Team

