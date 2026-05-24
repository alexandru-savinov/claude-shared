---
name: ralphex
description: Use ralphex to orchestrate AI coding agents for multi-step plans. Covers launching, monitoring, plan file format, parallel execution, and troubleshooting. Triggers when user mentions ralphex, wants to run a plan, monitor instances, or manage autonomous coding tasks.
user-invocable: true
argument-hint: "[plan.md] [--tasks-only] [--wait 1h]"
---

# Ralphex Skill — Claude Code

Ralphex orchestrates AI coding agents to execute multi-step plans autonomously. It takes a plan file (markdown with task checkboxes), runs Claude in a loop to complete each task, then runs multi-pass code review.

IMPORTANT: Ralphex is updated frequently. Always run `ralphex --help` before assuming any flags exist. Check version with `ralphex --version`.

## Launching Ralphex

### Prerequisites
- Must run from a git repository root
- Plan file must have `- [ ]` checkboxes inside `### Task N:` sections
- Claude Code must be installed and authenticated

### Basic Launch

```bash
ralphex plan.md                                    # full pipeline
ralphex plan.md --tasks-only                       # tasks only, skip reviews
ralphex plan.md --session-timeout=30m --idle-timeout=5m  # with safeguards
ralphex plan.md --worktree                         # isolated git worktree
```

### Recommended Flags for Unattended Runs

```bash
ralphex plan.md --tasks-only --session-timeout=30m --idle-timeout=5m --wait=1h
```

### Interactive Plan Creation

```bash
ralphex --plan="Add user authentication with JWT tokens"
```

## Plan File Format

```markdown
One-line description of the goal.

## Context
Background information for the agent.

## Tasks

### Task 1: Short title
- [ ] Specific implementation step
- [ ] Write tests for the above

### Task 2: Next piece of work
- [ ] Steps here

## Constraints
- Things the agent must NOT do
```

### Best Practices
- Each Task = ~1 Claude session (10-30 min)
- Include test requirements in each task
- Constraints section is critical
- Reference specific files the agent needs
- First line is the goal — make it descriptive

## Monitoring

```bash
tail -f .ralphex/progress/progress-plan.txt     # real-time progress
git log --oneline -10                            # commits
pgrep -f "ralphex" && echo "Running"             # process check
ralphex --serve --port 8080 -w .                 # web dashboard
```

### Completion Signals
- `ALL_TASKS_DONE` — tasks completed
- `TASK_FAILED` — failure
- `REVIEW_DONE` / `CODEX_REVIEW_DONE` — review phases

## Parallel Execution

```bash
cd ~/project-a && ralphex plan.md --tasks-only &
cd ~/project-b && ralphex plan.md --tasks-only &
```

Use `--wait=1h` so instances auto-retry on rate limits.

## Common Issues

| Issue | Fix |
|-------|-----|
| Stalling/hanging | `--session-timeout=30m --idle-timeout=5m` |
| External review failing | `--max-external-iterations=0` |
| No checkboxes found | Use `- [ ]` inside `### Task N:` sections |
| Nested Claude error | Run from regular terminal, not inside Claude Code |
| Rate limits | `--wait=1h` to auto-retry |
| Resuming after failure | Re-run same command — continues from first unchecked `- [ ]` |

## Execution Phases

| Phase | What | Skip with |
|-------|------|-----------|
| 1. Tasks | Execute checkboxes | — |
| 2. First Review | 5 parallel review agents | `--tasks-only` |
| 3. External Review | Codex/custom tool | `--max-external-iterations=0` |
| 4. Second Review | 2 agents (quality + impl) | `--tasks-only` |
| 5. Finalize | Rebase/squash | `--skip-finalize` |

## Quick Reference

```bash
ralphex --version && ralphex --help      # check before using
ralphex --init                           # initialize config
ralphex --plan="description"             # create plan
ralphex plan.md --tasks-only --wait=1h   # run tasks
ralphex --serve --port 8080 -w .         # dashboard
```
