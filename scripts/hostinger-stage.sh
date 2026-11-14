#!/bin/sh
# Makes a clean copy of the app for a Hostinger deploy: only the files needed to build and
# run it, taken from git (plus new files not yet committed). Nothing ignored by git is
# copied, so .env files, backups, logs and node_modules stay out.
#
# Usage: sh scripts/hostinger-stage.sh <empty-or-new-folder>
# Then deploy that folder. See docs_master/current/HOSTINGER_DEPLOYMENT.md.
set -eu

TARGET="${1:?Give the folder to copy into}"
cd "$(dirname "$0")/.."

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "$TARGET is not empty. Give an empty or new folder." >&2
  exit 1
fi
mkdir -p "$TARGET"

LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
{
  git ls-files -- package.json package-lock.json tsconfig.json vite.config.ts postcss.config.js \
    tailwind.config.ts components.json client server shared attached_assets releases scripts
  git ls-files --others --exclude-standard -- client server shared scripts
} | grep -v -E '(^|/)__tests__/|\.test\.tsx?$|\.backup$' | sort -u > "$LIST"

rsync -a --files-from="$LIST" . "$TARGET/"
echo "Copied $(wc -l < "$LIST" | tr -d ' ') files to $TARGET"
echo "Release in the copy: $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TARGET/releases/current/metadata.json" | head -1)"
