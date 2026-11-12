# syntax=docker/dockerfile:1.4
# Multi-stage Dockerfile optimized for Heroku Container Service
# Stage 1: Build dependencies and compile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
# Use BuildKit cache mount for faster subsequent builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# Copy source code and config files needed for build
COPY . .

# Build client assets and server bundle
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for vite in development)
# Use BuildKit cache mount for faster subsequent builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev && \
    npm cache clean --force

# Change ownership of node_modules to nodejs user
RUN chown -R nodejs:nodejs /app/node_modules

# Copy built artifacts from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/releases ./releases

# Copy source TypeScript files needed for dynamic imports at runtime
# tsx will handle TypeScript transpilation on-the-fly
# Note: client/, vite.config.ts, postcss.config.js, and tailwind.config.ts are not needed
# since vite only runs in development mode and static files are served from dist/public/
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs tsconfig.json ./

# Create directories for runtime assets
RUN mkdir -p generated_images attached_assets logs && \
    chown -R nodejs:nodejs generated_images attached_assets logs

# Switch to non-root user
USER nodejs

# Expose port (Heroku will set PORT env var)
EXPOSE ${PORT:-5001}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5001) + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use tsx to run the TypeScript source directly (matches docker:dev pattern)
# This allows dynamic imports like ./vite to resolve correctly relative to server/
CMD ["npx", "tsx", "server/index.ts"]
