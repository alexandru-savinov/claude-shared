#!/usr/bin/env bash
# Task 1 closing check: quarantine slot has correct trust:web schema; a failed
# fetch updates only status.json and leaves the trusted index empty.
#
# Runs against isolated fixtures (never the live ~/.scout or ~/.claude/index).
set -u

BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../bin" && pwd)"
SCHEMA="$(cd "$BIN/../schemas" && pwd)/provenance-v1.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export SCOUT_QUARANTINE_DIR="$TMP/scout"
export CLAUDE_INDEX_DIR="$TMP/index"
mkdir -p "$CLAUDE_INDEX_DIR"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

SLUG="2026-06-20-test-slug"

# --- init a slot ---------------------------------------------------------
SLOT="$("$BIN/scout-quarantine-init" "$SLUG" --source "https://example.com/x" --by scout --at "2026-06-20T00:00:00Z")"
rc=$?
[ $rc -eq 0 ] && ok "init exits 0" || bad "init exits 0 (rc=$rc)"

[ -d "$SLOT/raw" ]        && ok "raw/ dir created"     || bad "raw/ dir created"
[ -f "$SLOT/meta.json" ]  && ok "meta.json created"    || bad "meta.json created"
[ -f "$SLOT/status.json" ] && ok "status.json created" || bad "status.json created"

# --- trust field = web, sig = "" -----------------------------------------
TRUST=$(jq -r '.trust' "$SLOT/meta.json")
[ "$TRUST" = "web" ] && ok "meta trust == web" || bad "meta trust == web (got: $TRUST)"

SIG=$(jq -r '.sig' "$SLOT/meta.json")
[ "$SIG" = "" ] && ok "meta sig == empty string" || bad "meta sig == empty string (got: '$SIG')"

# --- meta validates against provenance-v1.json schema --------------------
jq -e -n --slurpfile schema "$SCHEMA" --slurpfile meta "$SLOT/meta.json" '
  ($schema[0].properties | keys) as $props
  | ($meta[0] | keys) as $mk
  | ($mk == $props)
    and ($schema[0].required - $mk == [])
    and ($schema[0].properties.trust.enum | index($meta[0].trust) != null)
    and ($meta[0].sig == $schema[0].properties.sig.const)
' >/dev/null \
  && ok "meta conforms to provenance-v1 schema" || bad "meta conforms to provenance-v1 schema"

# --- simulate a fetch FAILURE: only status.json changes, index stays empty
"$BIN/scout-status" "$SLUG" --outcome fail --detail "network timeout" --at "2026-06-20T00:01:00Z" >/dev/null
rc=$?
[ $rc -eq 0 ] && ok "status fail exits 0" || bad "status fail exits 0 (rc=$rc)"

OUTCOME=$(jq -r '.outcome' "$SLOT/status.json")
[ "$OUTCOME" = "fail" ] && ok "status outcome == fail" || bad "status outcome == fail (got: $OUTCOME)"

# trusted index must be empty (zero files) after the failed fetch
INDEX_FILES=$(find "$CLAUDE_INDEX_DIR" -type f | wc -l | tr -d ' ')
[ "$INDEX_FILES" = "0" ] && ok "trusted index has zero files after failed fetch" \
  || bad "trusted index has zero files (found $INDEX_FILES)"

# raw/ should still be empty (failed fetch wrote no content)
RAW_FILES=$(find "$SLOT/raw" -type f | wc -l | tr -d ' ')
[ "$RAW_FILES" = "0" ] && ok "raw/ empty after failed fetch" || bad "raw/ empty (found $RAW_FILES)"

echo "----"
echo "test-quarantine: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
