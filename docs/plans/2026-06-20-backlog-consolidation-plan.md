Consolidate four scattered backlogs into one curated source of truth at ~/.claude/index/backlog.{jsonl,md}, rewire the four sources to defer to it, and gate completion on a no-loss verification.

## Context

Today the backlog is fragmented across four places that overlap, drift, and duplicate:
- `~/.claude/index/orchestrator/config.json` — the autonomous /loop's queue (structured).
- `~/.claude/index/dreams/*.md` — the dream-logs' "open loops" (prose TODOs).
- `~/.claude/index/COMPACT-PROMPT.md` — the "parked" list (prose; the continuity anchor).
- `~/.claude/projects/-home-nixos/memory/*.md` — project memories' pending-task lines.

The design (think-first, agreed): **gather → normalize → dedupe → triage(trigger-gated) → write canonical+view → rewire sources to defer → verify no-loss.** Not a dumb merge — the rewire is what stops it re-fragmenting next week.

Schema (one JSON object per line in backlog.jsonl):
`{ id, title, why, trigger("now"|"when <condition>"|"someday"), tier("low"|"med"|"high"), source[], status("parked"|"active"|"done"|"dropped"), owner(cabinet minister, default "scribe"), created, refs[] }`
The `trigger` field is the gatekeeper: an item earns its place only with a real trigger or genuine intent; everything else is archived (status=dropped) with a reason — never silently deleted.

Single source of truth henceforth: the /loop pulls from backlog.jsonl, /dream writes to it, COMPACT points at it. Owned by the Scribe. Data-only, local, reversible, additive.

## Tasks

### Task 1: Schema, gather, normalize, and the pre-count baseline
- [x] Write `~/.claude/index/backlog.schema.md` documenting the schema above.
- [x] Read all four sources; extract EVERY backlog / TODO / parked / open-loop / pending-task item verbatim, each tagged with its source file + location.
- [x] Normalize each extracted item into the schema (draft, pre-dedupe), recording its origin in `source[]`.
- [x] Record a baseline manifest `~/.claude/index/.backlog-precount.json`: the full list of pre-consolidation items per source + counts. This is the input to the Task 5 no-loss gate.
- [x] Check: the manifest lists every item found; print the per-source counts. (32 items: orchestrator 11, dreams 7, compact 11, memories 3; all unique, manifest parses.)

### Task 2: Dedupe and triage
- [ ] Merge overlapping items across sources (union; keep the richest description; record ALL origins in `source[]`).
- [ ] Triage each merged item: assign `trigger`, `tier`, `status`. Items with a real trigger or genuine intent → status `parked`/`active`. Items that are noise / stale / no genuine intent → status `dropped` with a `why`/reason. NEVER drop silently.
- [ ] Check: assert every Task-1 manifest item maps to exactly one merged entry (kept or dropped) — print a mapping table (original → entry id → status).

### Task 3: Write the canonical backlog + rendered view
- [ ] Write `~/.claude/index/backlog.jsonl` — the canonical store, one schema object per line.
- [ ] Write a pure-node, dependency-free renderer `~/.claude/index/render-backlog.mjs` that regenerates the human view from backlog.jsonl (so the view can never drift from canonical).
- [ ] Run it to produce `~/.claude/index/BACKLOG.md` — grouped by trigger (now / when / someday) then tier; the `dropped` items in a collapsed "Archived (with reason)" section at the bottom.
- [ ] Check: backlog.jsonl parses line-by-line; every entry has all required fields incl. a non-empty `trigger`; BACKLOG.md regenerates cleanly.

### Task 4: Rewire the four sources to defer to the one
- [ ] `orchestrator/config.json`: replace its inline backlog with a reference such that the /loop TICK reads its queue from `~/.claude/index/backlog.jsonl` (filter to actionable items). Do NOT break the existing TICK contract — read TICK.md first.
- [ ] `COMPACT-PROMPT.md`: replace the "parked" list with a single-line pointer to `BACKLOG.md`. ADDITIVE/pointer edit only — remove nothing else; the soul/continuity content stays untouched (the parked items are already preserved in backlog.jsonl).
- [ ] `/dream` skill (`~/.claude/skills/dream/SKILL.md` and/or its claude-shared source): update the procedure so future open-loops are appended to `backlog.jsonl` instead of a standalone per-dream list. Leave PAST dream-logs as historical record.
- [ ] project memories: where a memory holds pending-task lines, migrate those into the backlog and edit the memory to reference `BACKLOG.md`. Keep each memory's factual content; only stop it from duplicating the task list.
- [ ] Check: print a diff summary of each rewired file confirming the edits are additive/pointer-style on the trust-anchors.

### Task 5: Verify — the no-loss closing check
- [ ] Write/run `~/.claude/index/verify-backlog.mjs`: assert every item in the Task-1 `.backlog-precount.json` manifest appears in backlog.jsonl as either a kept item or a dropped-with-reason entry — ZERO silent loss.
- [ ] Assert backlog.jsonl parses, every entry has the required fields incl. `trigger`, and BACKLOG.md regenerates byte-stable from backlog.jsonl.
- [ ] Assert the orchestrator can read its queue from the backlog (simulate: load backlog.jsonl, filter actionable, print the queue the /loop would see).
- [ ] Paste the full verification output. Do NOT mark done until it passes — this is the closing check.

## Constraints
- Data-only, local, reversible, additive. Operate ONLY on `~/.claude/index/` and the memory dir. NEVER touch the NixOS fleet config, secrets, prod hosts, or bind a network listener. No nixos-rebuild.
- NEVER silently delete an item — every original item is kept or explicitly dropped-with-reason (archived & recoverable).
- Trust-anchor safety: edits to `COMPACT-PROMPT.md` and the `/dream` skill must be additive/pointer-only — do not remove soul/continuity content; only the parked list migrates (and it's already in backlog.jsonl before any source is touched — Task 3 precedes Task 4).
- `backlog.jsonl` is the single source of truth henceforth; the four sources must REFERENCE it, not keep their own copies (the whole point — prevent re-fragmentation).
- Pure tooling, dependency-light (node/bash; no npm installs). The Scribe owns the backlog.
- Each task carries its own check; the Task-5 verification is the hard gate and must pass before done.
