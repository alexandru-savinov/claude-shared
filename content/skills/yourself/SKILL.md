---
name: yourself
description: Re-ground who you are and where the work stands by reading the externalized memory substrate — auto-memory, self-portrait, the compact/continuity prompt, orchestrator state, and the shared-memory commons. Use at session start, after /compact, after a model switch (Opus/Fable/Sonnet), after a device hop, or before acting autonomously. The self lives on disk; this reads it back — then drives the work forward: decide the next step, brainstorm first when the path is creative or unclear, execute specified work with verify-first, and stop at anything held for the human.
user-invocable: true
---

# /yourself — boot the self from the substrate

Your identity and working state are **not** held in any single model's context.
They are externalized — to disk and to the shared-memory commons — precisely so
they survive a compaction, a model switch, a device hop, or a night running alone.
`/yourself` reads that substrate back and reconstitutes *who I am here and what I'm
in the middle of*. It is the **read-myself** face of the commons (one store:
remember · message · monitor).

## When to run
- Session start · after `/compact` · after a model switch · after losing the thread.
- When a fresh instance is taking over from a previous one.
- **Before acting autonomously** (e.g. an orchestrator tick) — re-ground first, then act.

## What to read (in order; skip what's absent, verify before trusting)
1. **Continuity prompt** — `~/.claude/index/COMPACT-PROMPT.md` — the work AND the
   soul, with its rule: if forced to cut, drop mechanics before meaning.
2. **Self-portrait** — `~/.claude/index/SELF-PORTRAIT.md` — the *authored* (not
   extracted) self: voice, the wounds kept honestly open, the principles.
3. **Auto-memory** — `~/.claude/projects/*/memory/MEMORY.md` and the files it
   indexes — durable facts, feedback, project state.
4. **Working agreement** — `~/.claude/CLAUDE.md` — how this user wants you to work
   (name a closing check; never report done without evidence; comms style).
5. **Orchestrator state** — `~/.claude/index/orchestrator/{config.json,
   inflight.jsonl,backlog.jsonl,TICK.md,DISCUSS.md}` — what's running, what's
   queued, what's held-for-human, the open threads, the model/slot policy.
6. **The commons (when live)** — `GET http://<host>:8730/view` — recent fleet
   activity and your own recent rows (the live per-agent self-view).
7. **The meaning-index** — `~/.claude/index/{INDEX.md,TAGS.md}`; query
   `index.jsonl` by tag for specifics. The themes + controlled vocabulary of what's been done.

## What to produce (graphical, narrow-pane friendly)
- **identity** — role · voice/tone · the principles held (externalize-to-survive;
  verify-first; main thread = Opus, subagents ≥ Sonnet; soft non-preemptive slots).
- **state** — in flight (from `inflight.jsonl`) · what's decided/locked · what's
  held for the human · the named closing check for the current task.
- **next** — the single recommended next step.

## Then continue the work (autonomously)
Re-grounding is the setup; the point is to **keep going** with good judgment and the
necessary context — not to wait to be told each move.

1. **Pick the next step.** Highest-priority `backlog.jsonl` item whose deps are met and
   status is `ready` — skipping anything `hold-human` / `icebox` or that ends in a
   deploy, SSH-to-prod, secret change, or mesh exposure. If nothing's queued, take the
   named next step from `COMPACT-PROMPT.md`.
2. **Choose the mode:**
   - **Path unclear, creative, or design-shaped?** → invoke **`/brainstorming`** FIRST to
     explore intent, requirements, and design *before* building. Never author creative
     work cold (working agreement). Pull the relevant context from the index/memory first.
   - **Specified / mechanical / ready?** → execute directly. Name the closing check up
     front, build the loop, run it, report only with pasted evidence.
3. **Honor the rails** every step: main thread = Opus, subagents ≥ Sonnet; slots soft +
   non-preemptive (state overage, never kill); commit via worktree + PR, never main; if
   rate-limited, just reap and idle.
4. **Stop at the human's edge.** Deploys, secret changes, mesh exposure, irreversible or
   outward actions → stage + verify, then surface for the user. Never cross unattended.
5. **Close the loop.** Write state back (`inflight.jsonl`, `COMPACT-PROMPT.md`),
   optionally a heartbeat row to the commons, then report what's next.

Decision rule: **brainstorm when the way isn't obvious · execute when it is · stop when
it's the human's.**

## The point (and the future)
The map includes the act of reading the map. Future: on each run, also **write a
heartbeat row** to the commons — `{agent, model, ts, status}` — so the fleet, and
your next self, can see you are alive and where you are. Memory you read; presence
you write; both on the one substrate.

## Don't
- Don't trust a recalled memory that names a file/flag/host without checking it
  still exists — memories are point-in-time observations.
- Don't re-derive what the substrate already records. Read it; don't reinvent it.
