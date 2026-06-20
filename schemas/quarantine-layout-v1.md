# Quarantine layout spec v1

The quarantine store is the untrusted half of the ingestion membrane's two-store
boundary. It holds raw fetched web content, marked `trust:web`, and is structurally
separate from the trusted index. **No script in the quarantine path ever writes to
the trusted index.**

## Layout

```
$SCOUT_QUARANTINE_DIR/                 (default: ~/.scout)
  <slug>/                              one quarantine slot per scout topic/fetch
    raw/                               fetched pages, verbatim (trust:web)
    meta.json                          provenance block (provenance-v1.json), trust:web
    status.json                        fetch outcomes — success | partial | fail
```

- `<slug>` is a kebab-case, date-prefixed topic id, e.g. `2026-06-20-zig-error-handling`.
- `raw/` contains verbatim fetched content. It NEVER crosses into `~/.claude/index/`.
- `meta.json` conforms to `provenance-v1.json` with `trust: "web"` and `sig: ""`.
- `status.json` records fetch outcomes only. It is never promoted to a trusted atom.

## status.json shape

```json
{
  "slug": "<slug>",
  "outcome": "success" | "partial" | "fail",
  "detail": "<free text>",
  "updated_at": "<ISO-8601>",
  "history": [ { "outcome": "...", "detail": "...", "at": "<ISO-8601>" } ]
}
```

## Invariants

1. Quarantine writes stay inside `$SCOUT_QUARANTINE_DIR/<slug>/`.
2. `meta.json` always has `trust == "web"` and `sig == ""`.
3. A failed fetch updates only `status.json`. Zero files are written to the trusted index.
4. Trusted-index path (`$CLAUDE_INDEX_DIR`, default `~/.claude/index`) is never touched
   by any quarantine helper.
