# Shared path resolution for ingestion-membrane helpers. Source this file.
#
# All paths are overridable by environment variables so tests run against
# isolated fixtures and never touch the live index or live quarantine.
#
#   SCOUT_QUARANTINE_DIR  quarantine root      (default: ~/.scout)
#   CLAUDE_INDEX_DIR      trusted index root   (default: ~/.claude/index)
#
# The trusted-index path is exposed ONLY so helpers can assert they are not
# writing to it. No quarantine helper ever writes under CLAUDE_INDEX_DIR.

membrane_quarantine_root() {
  echo "${SCOUT_QUARANTINE_DIR:-$HOME/.scout}"
}

membrane_index_root() {
  echo "${CLAUDE_INDEX_DIR:-$HOME/.claude/index}"
}

membrane_slot_dir() {
  echo "$(membrane_quarantine_root)/$1"
}

# Fail-closed slug check: no path separators, no dot-dirs.
membrane_valid_slug() {
  case "$1" in
    */*|.|..|"") return 1 ;;
    *) return 0 ;;
  esac
}

membrane_iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}
