#!/usr/bin/env bash
# fetch-cc0-assets.sh — pull a model pack in and see what is actually inside it.
#
#   tools/fetch-cc0-assets.sh                       list good CC0 sources
#   tools/fetch-cc0-assets.sh <url|file> [name]     download/unpack and inspect
#
# Handles both a bare .glb and a .zip of a pack. Everything lands in
# tools/models/<name>/ and every .glb found is reported with
# tools/inspect_glb.py, so you know what you have before writing a bone map.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/models"
PY="$(command -v python3 || true)"

if [ $# -lt 1 ]; then
  cat <<'EOF'
CC0 model sources worth downloading from:

  Quaternius      https://quaternius.com            characters, monsters, animals,
                                                    and the Universal Animation Library
  KayKit          https://kaylousberg.com           character/creature packs, clean rigs
  Kenney          https://kenney.nl                 blocky and low-poly, good prototypes
  Mixamo          https://mixamo.com                a huge free clip library (see their terms)
  Sketchfab       https://sketchfab.com             filter licence to CC0 or CC-BY

Sketchfab is the one most people end up on: open a model, check the licence badge under
the title, download as glTF, then:

  tools/fetch-cc0-assets.sh ~/Downloads/model.glb mymodel
  tools/inspect_glb.py tools/models/mymodel/model.glb --bones --clips
  tools/retarget.py --model tools/models/mymodel/model.glb --map my-bones.json --install

CC-BY means attribution is required: keep the author, the title and the source URL in
your CREDITS, and carry it into the exported .glb so it survives being copied around.
EOF
  exit 0
fi

SRC="$1"
NAME="${2:-$(basename "${SRC%%[?#*}" | sed 's/\.[^.]*$//')}"
mkdir -p "$DEST/$NAME"
OUT="$DEST/$NAME"

echo "== $SRC  ->  $OUT"
if [ -f "$SRC" ]; then
  cp "$SRC" "$OUT/"
else
  case "$SRC" in
    *sketchfab.com*)
      echo "!! Sketchfab model pages are not a direct file URL." >&2
      echo "   Download the model in the browser (glTF), then pass the file path." >&2
      exit 1 ;;
  esac
  echo "   downloading…"
  curl -L --fail --progress-bar -o "$OUT/$(basename "${SRC%%[?#*]}")" "$SRC"
fi

# unpack anything zip-shaped
for f in "$OUT"/*; do
  case "$(file -b --mime-type "$f" 2>/dev/null || echo '')" in
    application/zip)
      echo "   unzipping $(basename "$f")"
      unzip -q -o "$f" -d "$OUT" && rm -f "$f" ;;
  esac
done

echo "== files"
find "$OUT" -type f \( -name '*.glb' -o -name '*.gltf' \) | sed "s|$OUT/|   |"

if [ -z "$PY" ]; then
  echo "!! python3 not found: cannot inspect. Install python3 and numpy."
  exit 0
fi

echo
echo "== what is usable"
found=0
while IFS= read -r glb; do
  found=1
  "$PY" "$HERE/inspect_glb.py" "$glb" || true
  echo
done < <(find "$OUT" -type f -name '*.glb')
[ "$found" = 0 ] && echo "   no .glb in there — a .gltf needs its .bin and textures beside it"

cat <<EOF
Next:
  tools/inspect_glb.py "$OUT/<file>.glb" --bones --clips    find the bone and clip names
  tools/retarget.py --model "$OUT/<file>.glb" --map bones.json --install
EOF
