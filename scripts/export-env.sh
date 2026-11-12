#!/bin/zsh
# Script to export all variables from .env file to the current shell environment
# Usage: source scripts/export-env.sh
#   or: . scripts/export-env.sh

setopt errexit

# Get the directory where the script is located (zsh-specific)
SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:A:h}"
ENV_FILE="$PROJECT_ROOT/.env"

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env file not found at $ENV_FILE" >&2
    echo "Tip: Copy env.example to .env and fill in your values" >&2
    return 1 2>/dev/null || exit 1
fi

# Read .env file line by line
while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines
    [[ -z "$line" ]] && continue
    
    # Skip comments (lines starting with #)
    [[ "$line" =~ '^[[:space:]]*#' ]] && continue
    
    # Remove any leading/trailing whitespace using zsh parameter expansion
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    
    # Skip empty lines after trimming
    [[ -z "$line" ]] && continue
    
    # Check if line contains an equals sign
    if [[ "$line" =~ '^[[:space:]]*([^=]+)=(.*)$' ]]; then
        key="${match[1]}"
        value="${match[2]}"
        
        # Remove any leading/trailing whitespace from key using zsh parameter expansion
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        
        # Remove leading whitespace from value
        value="${value#"${value%%[![:space:]]*}"}"
        
        # Remove quotes if present (both single and double) using zsh parameter expansion
        if [[ "$value" =~ '^["'\''](.*)["'\'']$' ]]; then
            value="${match[1]}"
        elif [[ "$value" =~ '^"(.*)"$' ]]; then
            value="${match[1]}"
        elif [[ "$value" =~ "^'(.*)'$" ]]; then
            value="${match[1]}"
        fi
        
        # Export the variable
        export "$key=$value"
    fi
done < "$ENV_FILE"

echo "✓ Environment variables exported from .env file"

