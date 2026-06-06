# Working agreement

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
