#!/usr/bin/env bash
set -euo pipefail

# Find the app container name dynamically using docker ps
# Try multiple strategies to find the container
CONTAINER_NAME=""

# Strategy 1: Use docker-compose to get container ID, then find its name
if [ -z "$CONTAINER_NAME" ]; then
  CONTAINER_ID=$(docker-compose ps app -q 2>/dev/null)
  if [ -n "$CONTAINER_ID" ]; then
    CONTAINER_NAME=$(docker ps --filter "id=$CONTAINER_ID" --format "{{.Names}}" 2>/dev/null | head -1)
  fi
fi

# Strategy 2: Filter by project label and "app" in name
if [ -z "$CONTAINER_NAME" ]; then
  CONTAINER_NAME=$(docker ps --filter "label=project=uranus-dungeon" --filter "name=app" --format "{{.Names}}" 2>/dev/null | head -1)
fi

# Strategy 3: Any container with "app" in the name (as fallback)
if [ -z "$CONTAINER_NAME" ]; then
  CONTAINER_NAME=$(docker ps --filter "name=app" --format "{{.Names}}" 2>/dev/null | head -1)
fi

if [ -z "$CONTAINER_NAME" ]; then
  echo "❌ Error: Could not find app container. Is it running?"
  echo "   Try running: docker ps"
  exit 1
fi

echo "Found container: $CONTAINER_NAME"
echo "This will reset game data in the container."
read -r -p "Include LLM Logs? [y/N]: " include_logs

case "${include_logs:-}" in
  [yY][eE][sS]|[yY])
    ENV_PREFIX="RESET_LLM_LOGS=true "
    ;;
  *)
    ENV_PREFIX=""
    ;;
esac

docker exec "$CONTAINER_NAME" sh -lc "${ENV_PREFIX}npx tsx scripts/reset-game-data.ts"