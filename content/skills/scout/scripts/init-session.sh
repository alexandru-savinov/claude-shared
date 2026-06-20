#!/usr/bin/env bash
# scout/scripts/init-session.sh
# Creates ~/.scout/<slug>/session.json and scaffolds the session directory.
# Usage: init-session.sh "<question>" [lean|normal|deep] [override_cycles]
# Outputs: the slug (so the caller can reference session files).
# Deps: jq (system), bash
# SAFETY: local-only, no network, no system changes.

set -euo pipefail

QUESTION="${1:?Usage: init-session.sh \"<question>\" [lean|normal|deep] [override_cycles]}"
BUDGET="${2:-normal}"
OVERRIDE_CYCLES="${3:-}"

# Budget presets
case "$BUDGET" in
  lean)   MAX_C=2; SEARCHES=2; FETCHES=2 ;;
  normal) MAX_C=4; SEARCHES=3; FETCHES=3 ;;
  deep)   MAX_C=6; SEARCHES=4; FETCHES=4 ;;
  *)
    echo "ERROR: unknown budget preset '$BUDGET'. Use lean, normal, or deep." >&2
    exit 1
    ;;
esac

[[ -n "$OVERRIDE_CYCLES" ]] && MAX_C="$OVERRIDE_CYCLES"

# Compute slug: YYYY-MM-DD-<slug of question>
DATE="$(date +%Y-%m-%d)"
SLUG_WORDS="$(printf '%s' "$QUESTION" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-50 | sed 's/-*$//')"
SLUG="${DATE}-${SLUG_WORDS}"

SCOUT_DIR="$HOME/.scout/$SLUG"
SESSION_FILE="$SCOUT_DIR/session.json"

if [[ -f "$SESSION_FILE" ]]; then
  echo "RESUME: session already exists at $SCOUT_DIR" >&2
  echo "$SLUG"
  exit 0
fi

mkdir -p "$SCOUT_DIR"

ISO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write session.json via jq (handles escaping)
jq -n \
  --arg slug "$SLUG" \
  --arg goal "$QUESTION" \
  --arg budget "$BUDGET" \
  --argjson max_cycles "$MAX_C" \
  --argjson searches_per_cycle "$SEARCHES" \
  --argjson fetches_per_cycle "$FETCHES" \
  --arg created "$ISO_NOW" \
  '{
    slug: $slug,
    goal: $goal,
    budget: $budget,
    max_cycles: $max_cycles,
    searches_per_cycle: $searches_per_cycle,
    fetches_per_cycle: $fetches_per_cycle,
    cycles_done: 0,
    gaps: [],
    sources: [],
    status: "running",
    created: $created
  }' > "$SESSION_FILE"

# Scaffold gaps.md
cat > "$SCOUT_DIR/gaps.md" <<GAPSEOF
# Gaps — $QUESTION
# Status: open | in-progress | closed | fetch-failed
# Updated each cycle.

GAPSEOF

# Scaffold findings.md
cat > "$SCOUT_DIR/findings.md" <<FINDEOF
# Findings — $QUESTION
# Append-only. Each cycle adds a section.

FINDEOF

echo "NEW: $SLUG" >&2
echo "$SLUG"
