#!/usr/bin/env bash
# scout/scripts/close-session.sh
# Reads ~/.scout/<slug>/report.md + session.json and deposits:
#   1. ~/.claude/index/moments/scout-<slug>.md
#   2. One appended line to ~/.claude/index/index.jsonl
#
# Usage: close-session.sh <slug>
# Deps: jq, node (for JSON line), bash
# SAFETY: local-only, additive-only (append to index, write new moment file).

set -euo pipefail

SLUG="${1:?Usage: close-session.sh <slug>}"
SCOUT_DIR="$HOME/.scout/$SLUG"
SESSION_FILE="$SCOUT_DIR/session.json"
REPORT_FILE="$SCOUT_DIR/report.md"

if [[ ! -f "$SESSION_FILE" ]]; then
  echo "ERROR: no session at $SCOUT_DIR" >&2
  exit 1
fi

if [[ ! -f "$REPORT_FILE" ]]; then
  echo "ERROR: no report.md at $SCOUT_DIR — run synthesis first" >&2
  exit 1
fi

# Read session fields
GOAL="$(jq -r '.goal' "$SESSION_FILE")"
CYCLES_DONE="$(jq -r '.cycles_done' "$SESSION_FILE")"
MAX_CYCLES="$(jq -r '.max_cycles' "$SESSION_FILE")"
BUDGET="$(jq -r '.budget' "$SESSION_FILE")"
SOURCE_COUNT="$(jq -r '.sources | length' "$SESSION_FILE")"
DATE="$(date +%Y-%m-%d)"
ISO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

MOMENT_DIR="$HOME/.claude/index/moments"
MOMENT_FILE="$MOMENT_DIR/scout-$SLUG.md"
INDEX_FILE="$HOME/.claude/index/index.jsonl"

# Extract the ## Answer section from report.md
ANSWER_SECTION="$(awk '/^## Answer/{found=1} found{print} /^## /{if(found && !/^## Answer/) exit}' "$REPORT_FILE")"

mkdir -p "$MOMENT_DIR"

# 1. Write moment entry
cat > "$MOMENT_FILE" <<MOMENTEOF
---
title: "Scout: $GOAL"
date: $DATE
type: moment
cycles: $CYCLES_DONE
budget: $BUDGET
sources: $SOURCE_COUNT
---

# $GOAL

*(Scout autonomous research — ${CYCLES_DONE}/${MAX_CYCLES} cycles, $SOURCE_COUNT sources)*

$ANSWER_SECTION

**Full report:** \`$REPORT_FILE\`
MOMENTEOF

echo "Moment written: $MOMENT_FILE"

# 2. Append index.jsonl entry via node (jq can't write jsonl easily)
ONE_LINER="$(awk '/^## Answer/{found=1; next} found && /^[^#]/ && NF{print; exit}' "$REPORT_FILE" | cut -c1-200)"
[[ -z "$ONE_LINER" ]] && ONE_LINER="See full report."
SUMMARY="$(grep -v '^#' "$REPORT_FILE" | grep -v '^$' | head -3 | tr '\n' ' ' | cut -c1-400)"
ENTITIES="$(jq -r '.goal' "$SESSION_FILE" | tr ' ' '\n' | awk 'length>4' | head -8 | jq -R . | jq -s .)"

node - "$SLUG" "$GOAL" "$ISO_NOW" "$SCOUT_DIR/report.md" "$MOMENT_FILE" "$ONE_LINER" "$SUMMARY" "$SOURCE_COUNT" "$INDEX_FILE" "$ENTITIES" <<'JSEOF'
const fs = require('fs');
const [slug, goal, iso_now, report_path, moment_path, one_liner, summary,
       source_count, index_file, entities_json] = process.argv.slice(2);

let entities;
try { entities = JSON.parse(entities_json); } catch { entities = []; }

const record = {
  id: `scout:${slug}`,
  source_type: "scout",
  time: iso_now,
  title: `Scout: ${goal}`,
  one_liner: one_liner || "See full report.",
  summary: summary || "See full report.",
  entities: entities,
  links: [
    { type: "file", ref: report_path },
    { type: "file", ref: moment_path }
  ],
  meaning_atoms: [{
    atom_id: `scout:${slug}:a01`,
    kind: "finding",
    statement: one_liner || "See full report.",
    confidence: 0.7
  }]
};

fs.appendFileSync(index_file, JSON.stringify(record) + '\n');
console.log(`Index entry appended: scout:${slug}`);
JSEOF

# 3. Mark session closed
jq '.status = "closed"' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"
echo "Session marked closed."
