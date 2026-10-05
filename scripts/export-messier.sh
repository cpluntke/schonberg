#!/usr/bin/env bash
# Build Schönberg Hero for hosting inside the messiermarathon Flask app (served at /schonberg/,
# leaderboard at /schonberg/api) and copy the build into that repo's schonberg_dist/. The choir
# library (library/: scores only choir admins can add to their choir) goes to schonberg_library/,
# which Flask does not serve as static files (only utils/schonberg_library.py reads it).
#   usage: scripts/export-messier.sh [path-to-messiermarathon]   (default: ../messiermarathon)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-$here/../messiermarathon}"
[ -f "$target/app.py" ] || { echo "messiermarathon checkout not found at $target" >&2; exit 1; }
cd "$here"
VITE_LEADERBOARD_URL=/schonberg/api VITE_CHOIR_URL=/schonberg/api npm run build
rm -rf "$target/schonberg_dist"
mkdir -p "$target/schonberg_dist"
cp -a dist/. "$target/schonberg_dist/"
git -C "$here" rev-parse --short HEAD > "$target/schonberg_dist/VERSION"
# The choir library: never inside schonberg_dist/ (that folder is public).
rm -rf "$target/schonberg_library"
mkdir -p "$target/schonberg_library"
cp -a library/. "$target/schonberg_library/"
if find "$target/schonberg_dist" -name '*.mxl' | grep -q .; then
  echo "error: a .mxl score ended up in the public build (schonberg_dist/)" >&2
  exit 1
fi
echo "Exported $(cat "$target/schonberg_dist/VERSION") to $target/schonberg_dist and the choir library to $target/schonberg_library"
