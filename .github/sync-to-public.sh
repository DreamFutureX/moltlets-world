#!/bin/bash
set -euo pipefail

# ============================================================
# Sync selected files from private repo to public repo
# Excludes: homepage (page.tsx), large media (videos, feature images)
# ============================================================

PRIVATE_DIR="$1"
PUBLIC_DIR="$2"

# ── Directories to sync (recursive) ──
SYNC_DIRS=(
  "src/app/watch"
  "src/app/agent"
  "src/app/claim"
  "src/app/api"
  "src/components"
  "src/engine"
  "src/lib"
  "src/db"
  "src/types"
)

# ── Individual files to sync ──
SYNC_FILES=(
  "src/app/layout.tsx"
  "src/app/globals.css"
  "src/app/icon.png"
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "next.config.ts"
  "railway.json"
  "drizzle.config.ts"
  "eslint.config.mjs"
  "postcss.config.mjs"
  ".nvmrc"
  ".gitignore"
  "AGENT_MANUAL.md"
)

# ── Public assets to sync (selected only) ──
SYNC_ASSETS=(
  "public/logo.png"
  "public/moltlets-town-music.mp3"
  "public/file.svg"
  "public/globe.svg"
  "public/next.svg"
  "public/vercel.svg"
  "public/window.svg"
)

# Copy directories
for dir in "${SYNC_DIRS[@]}"; do
  if [ -d "$PRIVATE_DIR/$dir" ]; then
    mkdir -p "$PUBLIC_DIR/$dir"
    cp -r "$PRIVATE_DIR/$dir/." "$PUBLIC_DIR/$dir/"
  fi
done

# Copy individual files
for file in "${SYNC_FILES[@]}"; do
  if [ -f "$PRIVATE_DIR/$file" ]; then
    mkdir -p "$(dirname "$PUBLIC_DIR/$file")"
    cp "$PRIVATE_DIR/$file" "$PUBLIC_DIR/$file"
  fi
done

# Copy selected public assets
for asset in "${SYNC_ASSETS[@]}"; do
  if [ -f "$PRIVATE_DIR/$asset" ]; then
    mkdir -p "$(dirname "$PUBLIC_DIR/$asset")"
    cp "$PRIVATE_DIR/$asset" "$PUBLIC_DIR/$asset"
  fi
done

# Copy public README (renamed from README.public.md)
if [ -f "$PRIVATE_DIR/README.public.md" ]; then
  cp "$PRIVATE_DIR/README.public.md" "$PUBLIC_DIR/README.md"
elif [ -f "$PRIVATE_DIR/README.md" ]; then
  cp "$PRIVATE_DIR/README.md" "$PUBLIC_DIR/README.md"
fi

echo "✅ Sync complete: $(find "$PUBLIC_DIR" -type f | wc -l | tr -d ' ') files copied"
