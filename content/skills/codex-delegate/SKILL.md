---
name: codex-delegate
description: Hand heavy probing, log-reading or multi-host investigation to the Codex CLI (`codex exec`) so the main Claude context stays small. Use when the user says "delegate to codex", "keep main clean", "use codex for the grunt work", or when a task needs many ssh/journal/grep calls whose raw output you do not want in your own context. Not for peer conversation with Codex (that is peer-chat) and not for one-shot code edits you can do yourself.
---

# codex-delegate

Codex runs as a sandboxed worker that executes real commands and writes a compact report to a file. You read only the report.

## The one command

```
codex exec -s workspace-write -c 'sandbox_workspace_write.network_access=true' \
  --skip-git-repo-check -C <workdir> -o <outfile> "<prompt>"
```

- `network_access=true` is required for ssh/curl/gh; without it the macOS seatbelt blocks the network silently.
- `-C <workdir>`: a fresh scratch dir unless Codex must edit a repo (then the worktree).
- `-o <outfile>`: Codex's final message lands here. Read this, nothing else.
- Codex is logged in with the user's ChatGPT account (`codex login status`). It can ssh with BatchMode to the hosts the Mac already has keys for (choir, rpi5).

## Rules that prevent lost work

1. **Foreground only.** Run it with the Bash tool timeout at 600000. Never `run_in_background`, never end your turn while a run is live — a subagent that does so is killed and returns nothing.
2. **At most two runs at a time**, sequential is fine. More than that and the sandbox + ssh multiplexing start timing out.
3. **One batch per run.** Give Codex a numbered list of 3–8 items and the exact report shape you want (per item: status, decisive command + output lines, issue, fix). Don't ask for "everything".
4. **Say READ-ONLY explicitly** when probing: no systemctl start/stop/restart/reset-failed, no writes on remote hosts, no git mutations. Codex obeys this well.
5. **Retry once narrower, then do the minimal command yourself.** Don't loop.
6. `timeout` does not exist on macOS; don't wrap the command in it.

## Prompt skeleton

```
You are a read-only investigator. Hosts: ssh root@<host-a>, ssh nixos@<host-b> (BatchMode).
Items:
1. <component> — check <what>, decide healthy/degraded/broken/unknown
2. ...
Known traps: <host facts that would mislead, e.g. comm names, hanging commands>
Write the report to <outfile> as markdown: one '## item' per item with status, the exact command(s) and the decisive output lines (max 3), issue, fix. No raw logs.
```

## Pattern: audit with adversarial verify

Agent A audits half the components via Codex, agent B the other half, then each side's findings go to a verifier agent that tries to refute them via one more Codex run. Saved as the `sancta-integrity-audit` workflow (`~/.claude/workflows/`) — copy its structure for other systems. Verified value: the verifier reversed 3 of 14 statuses on the first run, including the central root-cause claim.

## Reading results without polluting context

- Parse the workflow journal with python, print `name -> status`, `issue[:600]`, `fix[:350]` — never dump the JSON.
- Track findings in beads (`bd create …`), not in chat.
