# Scout — Design Notes

## Inspiration (from pi-autoresearch — ideas only, not code)

1. **Persistent session state in a local directory.** pi-autoresearch keeps `.auto/log.jsonl`,
   `.auto/prompt.md`, and `.auto/ideas.md` so the loop survives restarts and accumulates
   knowledge. Scout borrows this: `~/.scout/<slug>/` persists across invocations.

2. **Append-only log + living prompt file.** The idea of separating raw findings
   (append-only) from the distilled "what we know" document (living, overwritten)
   is clean. Scout adopts `findings.md` (append-only raw) + `report.md` (synthesized).

3. **Explicit gap/idea backlog.** pi-autoresearch's `.auto/ideas.md` prevents repeated
   dead ends by tracking what's been tried. Scout uses `gaps.md` as a structured gap
   list with status tracking (open / in-progress / closed / fetch-failed).

4. **Backpressure via explicit cap.** pi-autoresearch's `maxIterations` field is the
   primary scaling control. Scout borrows this as `max_cycles` enforced up-front,
   never extended autonomously.

5. **Separation of infrastructure from domain knowledge.** pi-autoresearch separates
   the loop framework from the skill (domain logic). Scout separates the procedure
   (SKILL.md) from the scripts (init-session.sh, close-session.sh) from the
   question-specific knowledge (session.json/gaps.md).

## How Scout differs from /deep-research (built-in)

/deep-research is a **one-shot fan-out**: given a question, it fans out many parallel
searches, fetches sources, verifies claims, and synthesizes a single report. It runs
to completion in one invocation and produces no persistent state.

Scout is **iterative and persistent**:
- It runs in cycles (bounded by budget preset)
- Each cycle discovers new gaps and closes old ones
- State survives between `/loop` ticks — research accumulates over hours/days
- It deposits into the meaning-index substrate (moments + index.jsonl)
- It is gap-driven: the next cycle's searches are determined by what the previous
  cycle DIDN'T resolve, not by a pre-planned fan-out

The analogy: /deep-research is a single deep-sea dive; Scout is a series of dives
where each dive uses what you learned surfacing from the last one.

## Design decisions

### Why ~/.scout/ not ~/.claude/index/scout/?
- `~/.scout/` is a working area: raw, chunky, mutable session state.
- `~/.claude/index/` is the canonical meaning substrate: distilled, curated moments
  and index entries. Scout produces from the former and deposits into the latter.
- This mirrors the pattern: raw data lives separately, synthesized meaning goes
  into the index.

### Why a budget preset (lean/normal/deep) instead of just --cycles N?
- Presets bundle coherent limits (cycles + searches/cycle + fetches/cycle) so the
  caller expresses intent ("lean" = quick orientation), not micromanagement.
- --cycles N is an escape hatch for when the user knows exactly what they want.

### Why a gap list with explicit status tracking?
- Prevents the loop from re-searching already-answered questions.
- Prevents unbounded expansion: new gaps discovered mid-cycle are added but the
  total open cap = max_cycles × searches_per_cycle.
- Makes the research auditable: the gap list shows what was tried and why.

### Why loop-tick mode?
- Allows Scout to run as a `/loop` background tick (e.g., every 15m) that pulls
  one question from the backlog and advances it one increment.
- This fits our substrate: the orchestrator/loop + backlog pattern already exists.
- Budget-aware: one cycle per tick means the weekly Opus budget is not blown by
  an unattended full run.

### Council gate condition
- Scout only gates on CONSEQUENTIAL questions (security, medical, finance, fleet ops).
- Pure knowledge questions (history, technology, science) proceed without council.
- The SKILL.md makes this explicit so the agent doesn't over-gate.

## What we chose NOT to borrow from pi-autoresearch

- **Benchmark + measurement loop**: pi-autoresearch is about code optimization metrics.
  Scout is about knowledge synthesis. The metric is "gaps closed" not "perf improved".
- **Git branch per session**: Scout is read-only and local; no repo needed.
- **Visual dashboard**: Our substrate is a TUI; we use compact Unicode status output.
- **Confidence scoring via MAD**: useful for noisy benchmarks, not web research.
  We use simple low/medium/high subjective confidence per finding.
- **Hooks system (before.sh/after.sh)**: over-engineered for our use case.
  The SKILL.md procedure IS the hook surface.
