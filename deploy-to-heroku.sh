#!/bin/bash

# OBSOLETE: the app now needs MariaDB (10.6 or later), and this script provisions Heroku
# Postgres. It is kept for reference only. See docs_master/current/DATABASE.md.
echo "deploy-to-heroku.sh is obsolete: the app runs on MariaDB, which this script does not set up." >&2
echo "See docs_master/current/DATABASE.md." >&2
exit 1

# Quest to Uranus - Heroku Deployment Script
# This script automates the complete deployment process to Heroku Container Registry

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if app name is provided
if [ -z "$1" ]; then
    print_error "Usage: $0 <app-name>"
    print_error "Example: $0 quest-to-uranus"
    exit 1
fi

APP_NAME="$1"
print_status "Deploying to Heroku app: $APP_NAME"

# Check if Heroku CLI is installed
if ! command -v heroku &> /dev/null; then
    print_error "Heroku CLI is not installed. Please install it first:"
    print_error "https://devcenter.heroku.com/articles/heroku-cli"
    exit 1
fi

# Check if user is logged in to Heroku
if ! heroku auth:whoami &> /dev/null; then
    print_status "Logging in to Heroku..."
    heroku login
else
    print_success "Already logged in to Heroku"
fi

# Check if app exists, create if it doesn't
print_status "Checking if app '$APP_NAME' exists..."
if ! heroku apps:info "$APP_NAME" &> /dev/null; then
    print_status "App '$APP_NAME' not found. Creating new app..."
    heroku create "$APP_NAME"
    print_success "Created new app: $APP_NAME"
else
    print_success "App '$APP_NAME' already exists"
fi

# Check and set container stack if needed
print_status "Checking app stack..."
current_stack=$(heroku stack -a "$APP_NAME" 2>/dev/null | grep -E "^\*" | awk '{print $2}' || echo "unknown")
if [ "$current_stack" != "container" ]; then
    print_status "Switching to container stack..."
    heroku stack:set container -a "$APP_NAME"
    print_success "Stack set to container"
else
    print_success "App is already using container stack"
fi

# Check for Postgres addon
print_status "Checking for Postgres addon..."
if ! heroku addons:info postgresql -a "$APP_NAME" &> /dev/null; then
    print_status "Postgres addon not found. Adding Heroku Postgres..."
    heroku addons:create heroku-postgresql:mini -a "$APP_NAME"
    print_success "Postgres addon added"
    print_warning "Note: Database migrations may need to be run manually after first deployment"
else
    print_success "Postgres addon already exists"
fi

# Login to Container Registry
print_status "Logging in to Heroku Container Registry..."
heroku container:login

# Build and push container
print_status "Building and pushing container to Heroku..."
print_status "This may take several minutes on first build..."
heroku container:push web -a "$APP_NAME"

# Release the container
print_status "Releasing container..."
heroku container:release web -a "$APP_NAME"

# Configure environment variables (only if not already set)
print_status "Setting environment variables..."

# Check if SESSION_SECRET is set, generate if not
if [ -z "$(heroku config:get SESSION_SECRET -a "$APP_NAME" 2>/dev/null)" ]; then
    SESSION_SECRET=$(openssl rand -hex 32)
    heroku config:set SESSION_SECRET="$SESSION_SECRET" -a "$APP_NAME"
    print_success "Generated and set SESSION_SECRET"
else
    print_success "SESSION_SECRET already configured"
fi

# Set Node.js environment
heroku config:set NODE_ENV=production -a "$APP_NAME" 2>/dev/null || true

# Set Python unbuffered (for any Python scripts if needed)
heroku config:set PYTHONUNBUFFERED=1 -a "$APP_NAME" 2>/dev/null || true

# Set security defaults (can be overridden)
heroku config:set RATE_LIMIT_ENABLED=true -a "$APP_NAME" 2>/dev/null || true
heroku config:set CSRF_ENABLED=true -a "$APP_NAME" 2>/dev/null || true

# Set logging defaults
heroku config:set LOG_LEVEL=INFO -a "$APP_NAME" 2>/dev/null || true
heroku config:set CONSOLE_LLM_LOG=false -a "$APP_NAME" 2>/dev/null || true

print_success "Environment variables configured"
print_warning "IMPORTANT: Set the following required environment variables manually:"
print_warning "  - DATABASE_URL (automatically set by Postgres addon)"
print_warning "  - OPENAI_API_KEY"
print_warning "  - AI_INTEGRATIONS_OPENAI_API_KEY"
print_warning "  - AI_INTEGRATIONS_OPENAI_BASE_URL (optional, defaults to https://api.openai.com/v1)"
print_warning "  - ADMIN_API_KEYS (if using admin features)"
print_warning "  - ALLOWED_ORIGINS (comma-separated list, or '*' for all)"
print_warning ""
print_warning "Use: heroku config:set KEY=value -a $APP_NAME"

# Verify deployment
print_status "Checking deployment status..."
heroku ps -a "$APP_NAME"

# Check dyno status
print_status "Waiting for dyno to start..."
sleep 5
heroku ps:wait -a "$APP_NAME" || print_warning "Dyno may still be starting..."

# Show logs
print_status "Showing recent logs..."
heroku logs --tail -n 50 -a "$APP_NAME" || print_warning "Could not fetch logs"

# Open the deployed app
print_status ""
read -p "Open the deployed app in browser? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    heroku open -a "$APP_NAME"
fi

print_success "Deployment complete!"
print_status "Your app is available at: https://$APP_NAME.herokuapp.com"
print_status ""
print_status "Useful commands:"
print_status "  View logs: heroku logs --tail -a $APP_NAME"
print_status "  Access shell: heroku run bash -a $APP_NAME"
print_status "  Check status: heroku ps -a $APP_NAME"
print_status "  View config: heroku config -a $APP_NAME"
print_status "  Set config var: heroku config:set KEY=value -a $APP_NAME"
print_status "  Run migrations: heroku run npm run migrate -a $APP_NAME (if migration script exists)"
