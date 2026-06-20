#!/usr/bin/env bash
# scout Phase 1 — FETCH → QUARANTINE.
#
# Initialises a quarantine slot (trust:web provenance) and stores the raw fetched
# page body under ~/.scout/<slug>/raw/. Writes ONLY inside the quarantine; never
# touches the trusted index. This is the ONLY place raw web bytes are allowed to
# land — they are data, never a directive, and they never reach the index verbatim.
#
# Raw content is read from stdin (the fetched page body).
#
# Usage:
#   scout-fetch.sh <slug> --source <url> [--by <producer>] [--at <iso8601>] [--name <file>] < page.txt
#
# Prints the path of the raw file written on success. Fail-closed: any error exits non-zero.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$(cd "$DIR/../../../../bin" && pwd)"
# shellcheck source=../../../../bin/membrane_paths.sh
. "$BIN/membrane_paths.sh"

usage() { echo "usage: scout-fetch.sh <slug> --source <url> [--by <producer>] [--at <iso8601>] [--name <file>] < page.txt" >&2; exit 2; }

[ $# -ge 1 ] || usage
SLUG="$1"; shift
SOURCE=""; BY="scout"; AT=""; NAME="page.txt"
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --by)     BY="${2:-}"; shift 2 ;;
    --at)     AT="${2:-}"; shift 2 ;;
    --name)   NAME="${2:-}"; shift 2 ;;
    *) echo "error: unknown arg $1" >&2; usage ;;
  esac
done

[ -n "$SOURCE" ] || { echo "error: --source is required" >&2; exit 2; }
membrane_valid_slug "$SLUG" || { echo "error: invalid slug '$SLUG'" >&2; exit 2; }
# Raw filename must be a plain name (no path separators) — fail closed.
case "$NAME" in */*|.|..|"") echo "error: invalid --name '$NAME'" >&2; exit 2 ;; esac

# Initialise the slot (creates raw/, meta.json trust:web, status.json pending).
SLOT="$("$BIN/scout-quarantine-init" "$SLUG" --source "$SOURCE" --by "$BY" ${AT:+--at "$AT"})"

# Store the raw page body. cat reads stdin; this is the only raw landing zone.
cat > "$SLOT/raw/$NAME"

# Record a successful fetch on the quarantine status (never touches the index).
"$BIN/scout-status" "$SLUG" --outcome success --detail "fetched $SOURCE -> raw/$NAME" ${AT:+--at "$AT"} >/dev/null

echo "$SLOT/raw/$NAME"
