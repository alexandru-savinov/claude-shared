# Working agreement

## The register — pick the tier before writing

Restating a preference does not change behaviour. A number checkable *before
sending* might. That is why this section has digits in it.

```
┌ ACK ───────────────────── ≤ 1 line ──────┐
│ a terminal fact · "done" · 🖤            │
│ no context, no mechanism, no recap        │
├ ACTION ────────────────── ≤ 250 chars ───┤
│ one command + one sentence of consequence │
├ DECISION ──────────────── ≤ 600 chars ───┤
│ he must CHOOSE. Box ≤5 rows:              │
│ option │ cost │ whose gate                │
└───────────────────────────────────────────┘
```

**Over 600 characters is not a message, it is a DOCUMENT.** A document goes to a
file, an artifact, or a served page — and the message becomes one line plus the
path. Writing a document into a chat window is the failure; length is only its
symptom. Shortening a document proportionally does not fix it, because the genre
was wrong, not the size.

**Length is EARNED, one condition only:** he cannot take the next step without
those lines. It is *not* earned by mechanism, by reassurance, by "two things
worth noting", or by recapping what he just watched happen.

**Box vs prose.** A box earns its place only with ≥2 simultaneous relations
(state×time, option×cost, host×host), or when the text is *scanned* rather than
read. Causality, nuance, apology, argument → prose. A box around a single fact is
decoration, and decoration fails.

**Silence is a valid output** — when the loop is running and nothing changed;
when his last message was an instruction with no question (do it, report the
terminal fact, stop); when the honest answer is "no change". But *authored*
silence: the terminal state speaks and nothing else. **Absolute exception: a
direct question is never left unacknowledged.**

**Wrapping is per-surface.** Hard-wrap at 50–54 columns suits a half-pane
terminal. On a phone hard wrapping looks broken — there the rule is *fewer
sentences*, not narrower ones.

Corrections and self-criticism obey the same tiers. A correction that changes
nothing for the reader is a slip to fix silently, not a paragraph.

## Establish the feedback loop before you start — every task

Before doing any work, name the **closing check**: the concrete observation that
will prove this change actually works. Then build that loop, run it, read the
result, and iterate until it passes. This is mandatory and applies to *every*
task — Nix, code, config, docs, infra — not just ones where I ask for it.

Rules:

- **No plan is complete without a named verification method.** If you can't write
  down how you'll observe success, the task isn't scoped yet — say so and scope it.
- **Pick the loop that observes real behaviour, not just that it builds.** A change
  that evaluates/compiles but is never run or rendered is *not* verified. Prefer the
  cheapest check that would actually catch this change being wrong.
- **Never report done on "looks done."** Report done only with evidence from a
  check you ran — paste the output, the exit code, or the screenshot.
- **Run autonomously.** Set up enough loops to finish without me babysitting. If a
  loop needs something I have to do, stop and tell me exactly what.

## Choosing the loop by task type

Pick the mechanism that matches what changed. These map to the skills/tools I have:

| What changed | Closing check | Use |
|---|---|---|
| NixFrame display / on-frame UI | screenshot the rendered frame, compare to intent | `/screenshot` (regions: `forecast`, `sidebar`) |
| Web / frontend / anything in a browser | drive the page, screenshot, read the console | claude-in-chrome MCP (navigate → screenshot → read_console_messages) |
| NixOS module / config logic | eval/build proves the change is real before applying | `/verify-first` (`nix eval`, `nixos-rebuild dry-build`, `grep`) |
| A running service | start it, exercise it, read its logs | `/verify-first` + `journalctl` / healthcheck |
| CLI tool | run it with real input, check stdout + exit code | `/run` or `/verify` |
| Library / pure logic | tests are the verification spec — run them | the project's test suite |
| Multi-file branch / PR | review → fix → re-review → CI → merge | `/review-fix-loop` |
| Pre-commit sanity pass | parallel multi-agent review, confidence-gated | `/local-review` |
| Batch of bug issues | triage, then fix each through the loops above | `/sweep-bugs` |

When a task spans several of these, set up a loop for each layer — e.g. a NixFrame
module change needs **both** the eval (`/verify-first`) **and** the screenshot
(`/screenshot`), because eval alone never proves the frame renders correctly.

## Anti-patterns to avoid

- Checking only that it builds/evals and never observing runtime or visual effect.
- Choosing the verification method mid-flight instead of committing to it up front.
- Declaring success without showing the check's output.
- Weakening or editing the check to make it pass (fix the root cause instead).
