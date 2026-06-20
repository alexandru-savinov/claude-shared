#!/usr/bin/env bash
# scout Phase 3 — DEPOSIT (gated).
#
# Builds an OWNED synthesis atom and pipes it through bin/deposit-atom, which is
# the ONLY thing that writes the trusted-index synthesis file. This script does
# NOT write to the index itself — it constructs the candidate atom and hands it
# to the fail-closed gate. If the gate rejects (wrong trust tier, directive
# content, missing citations, raw verbatim leakage by schema), nothing is written.
#
# The owned synthesis text is read from stdin. Provenance (source, fetched_at)
# is read from the quarantine slot's meta.json — only the provenance scalars are
# pulled across; raw web body is NEVER read into the atom. trust is forced to
# "agent" and sig to "" by construction; the gate re-checks both.
#
# Usage:
#   scout-deposit.sh <slug> [--by <producer>] [--cite <url> ...] < synthesis.txt
#
# Prints the deposited atom path (from the gate) on success. Fail-closed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$(cd "$DIR/../../../../bin" && pwd)"
# shellcheck source=../../../../bin/membrane_paths.sh
. "$BIN/membrane_paths.sh"

usage() { echo "usage: scout-deposit.sh <slug> [--by <producer>] [--cite <url> ...] < synthesis.txt" >&2; exit 2; }

[ $# -ge 1 ] || usage
SLUG="$1"; shift
BY="scout"
EXTRA_CITES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --by)   BY="${2:-}"; shift 2 ;;
    --cite) EXTRA_CITES+=("${2:-}"); shift 2 ;;
    *) echo "error: unknown arg $1" >&2; usage ;;
  esac
done

membrane_valid_slug "$SLUG" || { echo "error: invalid slug '$SLUG'" >&2; exit 2; }

SLOT="$(membrane_slot_dir "$SLUG")"
META="$SLOT/meta.json"
[ -f "$META" ] || { echo "error: no quarantine meta for '$SLUG' (run Phase 1 first)" >&2; exit 1; }

# Pull ONLY provenance scalars from the quarantine meta (never the raw body).
SOURCE="$(jq -r '.source' "$META")"
FETCHED_AT="$(jq -r '.fetched_at' "$META")"
[ -n "$SOURCE" ] && [ "$SOURCE" != "null" ] || { echo "error: meta.json missing source" >&2; exit 1; }
[ -n "$FETCHED_AT" ] && [ "$FETCHED_AT" != "null" ] || { echo "error: meta.json missing fetched_at" >&2; exit 1; }

# The owned synthesis text comes from stdin (the agent's own voice, with citations).
CONTENT="$(cat)"
[ -n "$CONTENT" ] || { echo "error: empty synthesis on stdin" >&2; exit 2; }

# Citations: the source page, plus any extra --cite urls. Build a JSON array.
CITES_JSON="$(printf '%s\n' "$SOURCE" "${EXTRA_CITES[@]:-}" \
  | grep -v '^$' | jq -R . | jq -s 'unique')"

# Construct the candidate atom. trust forced "agent", sig forced "". The gate
# re-validates everything and is the sole writer to the index.
jq -n \
  --arg source "$SOURCE" \
  --arg fetched_at "$FETCHED_AT" \
  --arg by "$BY" \
  --arg content "$CONTENT" \
  --argjson citations "$CITES_JSON" \
  '{trust:"agent", source:$source, fetched_at:$fetched_at, by:$by, sig:"",
    content:$content, citations:$citations}' \
  | "$BIN/deposit-atom" --slug "$SLUG"
