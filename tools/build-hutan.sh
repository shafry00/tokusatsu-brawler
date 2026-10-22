#!/usr/bin/env bash
# Packages just the forest game for Cloudflare (see wrangler.hutan.toml).
# Output: dist-hutan/ — a mirror of the repo paths the game actually touches.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dist-hutan"
rm -rf "$OUT"
mkdir -p "$OUT/hutan" "$OUT/js/lib" "$OUT/assets/models"

# the game itself: html, styles, artwork, its own scripts
cp hutan/index.html "$OUT/hutan/"
cp -R hutan/css hutan/img hutan/js "$OUT/hutan/"

# the shared engine the game borrows via ../js/
for f in three.min.js audio.js fx.js models.js; do
  cp "js/$f" "$OUT/js/"
done
cp js/lib/GLTFLoader.js js/lib/SkeletonUtils.js "$OUT/js/lib/"

# the CC0 model pack the loader streams (Models.load walks the whole set)
cp assets/models/*.glb assets/models/LICENSE-CC0.txt "$OUT/assets/models/"

find "$OUT" -name '.DS_Store' -delete
echo "dist-hutan: $(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files"
