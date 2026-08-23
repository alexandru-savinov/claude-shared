---
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git blame:*), Bash(git show:*)
description: Code review uncommitted local changes
---

# Code Review Uncommitted Local Changes

Provide a code review for uncommitted local changes (both staged and unstaged).

## Step 0 — pick the instrument by the shape of the diff

**Wide blast radius** — mass deletions, retirements, renames, moved modules, anything touching several hosts, or any change where the real question is "does something, somewhere, still reference this?" → use `revmux` instead of the pipeline below. Exact invocation:

```
# Rerunnable: never `cd` into the clone, never leave a broken setup usable.
D=/tmp/revmux-src
{ [ -d "$D/.git" ] || git clone https://github.com/umputun/revmux "$D"; } \
  && git -C "$D" fetch --tags -q \
  && git -C "$D" checkout -q v0.2.0 \
  && nix-shell -p go --run "make -C $D build" \
  && test -x "$D/.bin/revmux"          # the guard: never run a stale or absent binary

mkdir -p /tmp/revmux-run && cd /tmp/revmux-run   # cwd decides where .revmux/ lands
"$D/.bin/revmux" --workdir <path-to-worktree> --no-tui --profile focused
```

Two things that block is deliberately shaped around, both found by review rather than by use:

- **The second run is the dangerous one.** Written as `git clone … && cd …` on one line with a
  bare `git checkout v0.2.0` on the next, a pre-existing clone makes the clone fail, the `cd` is
  skipped — and the checkout then runs **in the repository being reviewed**, switching it to a tag
  mid-review. Every git command here therefore takes an explicit `-C "$D"`, and nothing `cd`s into
  the clone at all.
- **A failed setup must not leave a usable binary.** The whole chain is `&&`-linked and ends in
  `test -x`, because the original shape let a failed checkout or build fall through to a line that
  happily ran whatever binary was lying there from last time — the same defect one step later.

`v0.2.0` is pinned on purpose: unpinned, the reviewer changes under us between runs. The cost is
that the pin rots, so bump it deliberately and re-read the changelog when you do.

Non-negotiable rules:

- `.revmux/` NEVER lives in a repo we review — its lenses are prompts an agent executes, so in a repo where a PR can edit them, a PR could modify its own reviewer. Run from a scratch cwd so the config lands outside.
- `focused` is the default (one bugs agent + a codex peer). `comprehensive` cost ~13 minutes and ~9M tokens on a 25-file diff — reserve it for the wide-blast-radius case that earns it.
- Not in CI and not in the nix config: its build currently pulls a Go toolchain at build time (go.mod wants 1.26, nixpkgs has 1.25.7), so it cannot be packaged reproducibly yet. Revisit when Go 1.26 reaches nixpkgs.
- Findings return to the session, never to the artifact — do not let it, or any delegate, post findings onto a public PR.

Evidence: on a retirement diff (nixos-config PR #565, +85/-2605 across 25 files) the existing pipeline plus a careful manual sweep found documentation staleness and one gatus endpoint pair; revmux additionally found live residue on the surviving host (an SSH wrapper and an agenix secret still decrypted on every activation for a host that no longer existed), a dead ~270-line runbook, a wrong grant-count in the retirement doc itself (fact-checked with `nix eval`), and an orphaned CI VM test — and it correctly declined to over-flag an item the PR had deliberately deferred.

**Also point it at plan/design documents, not just diffs — the boundary is falsifiability.** A prior run on claim-free prose (no file paths, no attribute names, no concrete examples) found nothing worth acting on. That verdict flipped on nixos-config PR #562, a 367-line plan document (`docs/plans/2026-08-19-public-config-threat-gates.md`) that made falsifiable technical claims: `--profile focused` returned 15 findings, all against the prose, all verified against real repo state and accepted — wrong Nix attribute paths, a false claim about CI coverage the workflow already provided, a proposed gate rule that would have failed existing correctly-hardened units, the document violating its own "every check states what it cannot see" rule in five places, and an authentication/authority conflation. 10m42s, 2 agents. So: reach for it on a document whenever it makes falsifiable claims — file paths, attribute names, cross-references, concrete examples — code-vs-prose isn't the test.

**Ordinary diff** (a handful of files, normal feature/fix work) → the existing pipeline below. One honest line: reaching for static linters alone is not worth it — a full deterministic sweep (shellcheck, statix, deadnix, semgrep, actionlint) over ~53k lines returned ~250 hits and zero real bugs; every real finding that day came from reading with the known failure-classes in mind.

To do this, follow these steps precisely:

1. Use a Sonnet agent to check the current state of the working directory:
   - Run `git status` to see what files have changes
   - Run `git diff` for unstaged changes and `git diff --staged` for staged changes
   - If there are no changes, do not proceed and inform the user
   - Return a summary of what files changed and the nature of the changes

2. Use another Sonnet agent to find any relevant CLAUDE.md files: the root CLAUDE.md file (if one exists), as well as any CLAUDE.md files in the directories containing modified files

3. Then, launch 4 parallel Opus agents to independently code review the changes. Each agent should read the full file context when needed. The agents should return a list of issues and the reason each issue was flagged:
   a. Agent #1: Audit the changes to make sure they comply with any CLAUDE.md guidelines found. Note that CLAUDE.md is guidance for Claude as it writes code, so not all instructions will be applicable during code review.
   b. Agent #2: Read the file changes, then scan for bugs, logic errors, and edge cases. Focus on significant bugs, avoid nitpicks. Check for: null/undefined issues, off-by-one errors, race conditions, resource leaks, error handling gaps.
   c. Agent #3: Scan for security vulnerabilities (OWASP top 10): injection flaws, XSS, auth bypass, sensitive data exposure, insecure dependencies, etc.
   d. Agent #4: Check for TypeScript type safety issues, performance problems, and code quality concerns that would fail code review.

4. For each issue found in #3, launch a parallel Sonnet agent that takes the issue description and CLAUDE.md files (from step 2), and returns a confidence score from 0-100. The scale is:
   a. 0: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
   b. 25: Somewhat confident. This might be a real issue, but may also be a false positive. If the issue is stylistic, it was not explicitly called out in CLAUDE.md.
   c. 50: Moderately confident. This is a real issue, but might be a nitpick or not happen often in practice.
   d. 75: Highly confident. Verified this is very likely a real issue that will be hit in practice. Very important and will directly impact functionality.
   e. 100: Absolutely certain. Confirmed this is definitely a real issue that will happen frequently.

5. Filter out any issues with a score less than 80. If there are no issues that meet this criteria, report that no significant issues were found.

6. Present the filtered issues to the user, grouped by severity:
   - Critical (score 95-100): Must fix before committing
   - Warning (score 80-94): Should consider fixing

Examples of false positives to filter out in steps 3 and 4:

- Pre-existing issues (not introduced in current changes)
- Pedantic nitpicks that a senior engineer wouldn't call out
- Issues that a linter, typechecker, or compiler would catch
- General code quality issues unless explicitly required in CLAUDE.md
- Issues silenced by lint ignore comments
- Changes in functionality that are likely intentional

Notes:

- Do not attempt to build or typecheck the app
- Make a todo list first
- For each issue, include:
  - File path and line number
  - Brief description of the problem
  - Why it matters
  - Suggested fix (with code snippet if helpful)
- If no issues found, confirm the code looks good for commit

Output format:

---

### Local Code Review

Found N issues in uncommitted changes:

**Critical** (N issues)

1. **file.ts:42** - <brief description>

   <explanation and suggested fix>

**Warning** (N issues)

1. **file.ts:15** - <brief description>

   <explanation and suggested fix>

---

Or, if no issues:

---

### Local Code Review

No significant issues found. Code looks good for commit.

Checked for: bugs, security vulnerabilities, CLAUDE.md compliance, type safety.

---
