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
# Nothing of the choir library may reach the public build: no library file (any extension; the same
# name or the same content), no former repertoire list or programme seed, no pieces/pd/, no .mxl.
check_public() {
  local dir="$1" bad="" f name
  local lib_names lib_stems lib_sums
  lib_names="$(find library -type f ! -name README.md -printf '%f\n' | sort -u)"
  lib_stems="$(find library/scores -type f -printf '%f\n' | sed 's/\..*//' | sort -u)"  # a score under another extension
  lib_sums="$(find library -type f -exec sha256sum {} + | cut -d' ' -f1 | sort -u)"
  while IFS= read -r -d '' f; do
    name="$(basename "$f")"
    case "$f" in */pieces/pd/*|*/pieces/pd) bad+="$f (pieces/pd)"$'\n'; continue ;; esac
    case "$name" in repertoire.json|cycle.json|*.mxl|*.MXL) bad+="$f"$'\n'; continue ;; esac
    if grep -qxF -- "$name" <<<"$lib_names" || grep -qxF -- "${name%%.*}" <<<"$lib_stems"; then bad+="$f (a library file's name)"$'\n'; continue; fi
    if grep -qxF -- "$(sha256sum "$f" | cut -d' ' -f1)" <<<"$lib_sums"; then bad+="$f (a library file's content)"$'\n'; fi
  done < <(find "$dir" -mindepth 1 \( -type f -o -type l \) -print0)
  if [ -n "$bad" ]; then
    printf 'error: choir library files would end up in the public build (%s):\n%s' "$dir" "$bad" >&2
    exit 1
  fi
}
VITE_LEADERBOARD_URL=/schonberg/api VITE_CHOIR_URL=/schonberg/api npm run build
check_public dist  # before anything is written to the target
rm -rf "$target/schonberg_dist"
mkdir -p "$target/schonberg_dist"
cp -a dist/. "$target/schonberg_dist/"
git -C "$here" rev-parse --short HEAD > "$target/schonberg_dist/VERSION"
# The choir library: never inside schonberg_dist/ (that folder is public).
rm -rf "$target/schonberg_library"
mkdir -p "$target/schonberg_library"
cp -a library/. "$target/schonberg_library/"
check_public "$target/schonberg_dist"  # and what was copied
echo "Exported $(cat "$target/schonberg_dist/VERSION") to $target/schonberg_dist and the choir library to $target/schonberg_library"
