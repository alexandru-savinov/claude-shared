# Plan: Bootstrap claude-shared

Build this **private** repo as the single source of truth for user-level Claude Code config. Consumed by `nixos-config` and `darwin-config` as a flake input.

## Environment

- This repo: `~/claude-shared` — currently empty (no commits yet), on branch `main`
- Source repos (already cloned):
  - `~/nixos-config`
  - `~/darwin-config`
- Remote: `https://github.com/alexandru-savinov/claude-shared.git` (private)
- Git protocol: **HTTPS** (gh credential helper). SSH not configured on this machine.

## Locked decisions (do not relitigate)

- Repo visibility: private
- Architecture: Tier 1 Nix-managed invariant + Tier 2 mkOutOfStoreSymlinks into writable clone + Tier 3 local-only state (untouched)
- Scope: user-level by default
- Plugins: flatten command-only plugins to loose slash commands; `nixd-lsp` **dropped**
- HM module surface: `enable`, `installPackage`, `contentRepoPath`, `zellijIntegration.enable`, `userClaudeMd`, `extraSettings`, `extraEnabledPlugins`, `extraKnownMarketplaces`
- CC package source: `github:sadjow/claude-code-nix`; consumers toggle `installPackage`
- Cross-platform activation via `home.activation` (replaces darwin's `system.activationScripts` approach)
- All git URLs in code use HTTPS (`https://github.com/...`). If a consumer host has SSH, swapping is one-line.

---

### Task 1: Repo skeleton

- [x] Verify CWD is `~/claude-shared`, is a git repo, on `main` (ralphex working branch `PLAN`; user merges to `main`)
- [x] Create `flake.nix` declaring inputs:
  - `nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable"`
  - `home-manager` (follows nixpkgs)
  - `flake-parts`
  - `claude-code.url = "github:sadjow/claude-code-nix"` (follows nixpkgs)
- [x] `outputs` exposes `homeManagerModules.default = import ./module;` and a `checks.${system}` set (filled in Task 9)
- [x] Create `.gitignore` excluding `secrets/`, `*.env`, `.credentials.json`, `result`, `result-*`, `.direnv/`
- [x] Create `README.md` with sections: "What this is", "Consumers" (nixos-config, darwin-config), "What's safe to put here" (no hostnames, Tailscale node names, IPs, API keys; use agenix in consumer repos), "Testing" (placeholder for Task 9)
- [x] Create `SECURITY.md` with detailed policy + leak rotation steps
- [x] Create empty dirs `content/skills`, `content/agents`, `content/commands`, `module` (use `.gitkeep` files so they're committable); `module/` has a placeholder `default.nix` so `import ./module` resolves before Task 5
- [x] `nix flake check` passes
- [x] First commit: "feat: initial skeleton"
- [x] `git push -u origin main` (deferred — ralphex working branch; user pushes after review/merge)

### Task 2: Skills content

- [x] Copy `~/darwin-config/modules/_skills/ralphex/SKILL.md` → `content/skills/ralphex/SKILL.md` (verbatim)
- [x] Copy `~/nixos-config/modules/claude-skills/verify-first/SKILL.md` → `content/skills/verify-first/SKILL.md`
- [x] Genericize `content/skills/verify-first/SKILL.md`:
  - Replace every `.#rpi5-full` with `.#<host>`
  - In prose, add a one-line note: "substitute `<host>` with your flake host name"
  - Keep the "NixOS-Specific Checklist" section; its example commands must use `<host>` placeholders
- [x] Both files have valid frontmatter (name, description)
- [x] Commit: "feat: skills (ralphex, verify-first generalized)"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 3: Agents content

- [x] Copy `~/nixos-config/modules/claude-agents/nix-security-reviewer.md` → `content/agents/nix-security-reviewer.md` (verbatim)
- [x] Frontmatter is valid (name, description)
- [x] Commit: "feat: agent (nix-security-reviewer)"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 4: Slash commands (flattened plugins)

- [x] Copy `~/nixos-config/.claude/plugins/local-review/commands/local-review.md` → `content/commands/local-review.md`
- [x] Copy `~/nixos-config/.claude/plugins/nix-commit/commands/commit.md` → `content/commands/commit.md`
- [x] Copy `~/nixos-config/.claude/plugins/nix-commit/commands/commit-push-pr.md` → `content/commands/commit-push-pr.md`
- [x] Copy `~/nixos-config/.claude/plugins/screenshot/commands/screenshot.md` → `content/commands/screenshot.md`
- [x] For each: ensure file is valid as a top-level slash command (frontmatter has `description` at minimum); strip any plugin-namespaced metadata
- [x] Commit: "feat: slash commands (local-review, commit, commit-push-pr, screenshot)"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 5: HM module — option surface and settings.json

- [x] Create `module/default.nix` declaring options under `programs.claude-code`:
  - `enable` (bool, default false)
  - `installPackage` (bool, default false)
  - `contentRepoPath` (str, default `"${config.home.homeDirectory}/.claude-shared"`)
  - `zellijIntegration.enable` (bool, default true)
  - `userClaudeMd` (`nullOr path`, default null)
  - `extraSettings` (attrset, default `{}`)
  - `extraEnabledPlugins` (attrset, default `{}`)
  - `extraKnownMarketplaces` (attrset, default `{}`)
- [x] Generate `~/.claude/settings.json` by recursive-merge (`lib.recursiveUpdate`):
  - Base: `{ effortLevel = "high"; voiceEnabled = true; skipDangerousModePermissionPrompt = true; skipAutoPermissionPrompt = true; permissions.defaultMode = "auto"; env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"; }`
  - + zellij block (statusLine + Stop + UserPromptSubmit hooks) when `zellijIntegration.enable`
  - + `enabledPlugins = cfg.extraEnabledPlugins`
  - + `extraKnownMarketplaces = cfg.extraKnownMarketplaces`
  - + `cfg.extraSettings` (last, wins)
- [x] `nix eval .#homeManagerModules.default --apply 'm: m._file or "ok"'` (or equivalent) succeeds
- [x] Commit: "feat(module): option surface and settings.json"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 6: HM module — hooks and statusline scripts

- [x] Extract the script bodies from `~/darwin-config/modules/programs/claude-code.nix` (inlined directly in `module/default.nix` instead of separate `.sh` files; see note below — the plan's final bullet selects the inline approach over `builtins.readFile`):
  - `statusLineScript` → inline in `module/default.nix`
  - `onStopScript` → inline in `module/default.nix`
  - `onUserPromptScript` → inline in `module/default.nix`
- [x] In `module/default.nix`, wire each via `pkgs.writeShellScript "claude-XXX" ''...''`; gating happens at the `zellijBlock` level so `settings.json` only references them when `cfg.zellijIntegration.enable` is true
- [x] The wired scripts MUST have access to `${pkgs.jq}` and `${pkgs.zellij}` — implemented via the inline `''...''` approach so nixpkgs interpolations resolve (verified: built scripts contain `/nix/store/...-jq-.../bin/jq` and `/nix/store/...-zellij-.../bin/zellij`)
- [x] References resolve in the generated settings.json (verified by building under a synthetic HM config with `enable = true; zellijIntegration.enable = true;` — `statusLine.command`, `hooks.Stop[].hooks[].command`, and `hooks.UserPromptSubmit[].hooks[].command` all point at the built script derivations)
- [x] Commit: "feat(module): zellij statusline and hooks"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 7: HM module — symlinks and activation

- [x] In `module/default.nix`, set:
  - `home.file.".claude/skills".source = config.lib.file.mkOutOfStoreSymlink "${cfg.contentRepoPath}/content/skills";`
  - same for `agents`, `commands`
- [x] Add `home.activation.claudeSharedClone` (use `lib.hm.dag.entryBefore [ "writeBoundary" ]`):
  - If `${cfg.contentRepoPath}` missing: `git clone https://github.com/alexandru-savinov/claude-shared.git "${cfg.contentRepoPath}"`
  - Else: `git -C "${cfg.contentRepoPath}" pull --ff-only`
  - Non-fatal: wrap in `|| { echo "WARNING: claude-shared sync failed"; true; }`
  - Reference `${pkgs.git}/bin/git` explicitly (not bare `git`) so activation works without git in PATH
- [x] Add `home.activation.claudeInstalledPlugins` (only when `cfg.extraEnabledPlugins != {}` or `cfg.extraKnownMarketplaces != {}`):
  - Generate `installed_plugins.json` content as a derivation (`pkgs.writeText` is fine)
  - Hash-compare against `$HOME/.claude/plugins/installed_plugins.json` using `${pkgs.coreutils}/bin/sha256sum`
  - `install -m 644 ${generated} "$HOME/.claude/plugins/installed_plugins.json"` if different
  - Reference: `~/darwin-config/modules/programs/claude-code.nix` lines for `installedPluginsFile` and the activation block — same shape, swap `system.activationScripts` for `home.activation`
- [x] `nix eval` the activation block; check syntax (verified under a synthetic HM config: `claudeSharedClone` uses `/nix/store/...-git-.../bin/git`, `claudeInstalledPlugins` is gated on `managePlugins`, and `home.file.".claude/skills"` resolves to a symlink whose target is `${contentRepoPath}/content/skills`)
- [x] Commit: "feat(module): symlinks + activation"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 8: HM module — package install + userClaudeMd

- [x] When `cfg.installPackage = true`: add `inputs.claude-code.packages.${pkgs.system}.default` to `home.packages`
  - Pass `inputs` through via `_module.args.inputs = inputs;` in `flake.nix` outputs (so the module can `{ inputs, ... }:` cleanly). Module also sets `_module.args.inputs = lib.mkDefault null;` so direct imports without the wrapper still evaluate (e.g. test harnesses), and an assertion guards `installPackage = true` against the null case.
- [x] When `cfg.userClaudeMd != null`: `home.file.".claude/CLAUDE.md".source = cfg.userClaudeMd;`
- [x] When null: no `~/.claude/CLAUDE.md` is written (verified via synthetic eval: `cfg.home.file ? ".claude/CLAUDE.md"` is false when `userClaudeMd` is unset)
- [x] Sanity: `nix eval` with `installPackage = true` against a synthetic HM config; package resolves (claude-code appears in `home.packages` and `CLAUDE.md` source resolves to a `/nix/store/...-CLAUDE.md` path)
- [x] Commit: "feat(module): package install + optional user CLAUDE.md"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 9: Test harness

- [x] Add `checks.${system}.module-all-enabled` derivation that evaluates the HM module under a synthetic home-manager configuration with all options enabled and a fake `inputs.claude-code` stub (or use `installPackage = false` to avoid needing the real package eval)
- [x] Add `checks.${system}.module-disabled` — with `enable = false`, asserts no `~/.claude/*` writes
- [x] `nix flake check` passes both
- [x] Fill in the "Testing" section of `README.md`: clone to scratch dir → point throwaway HM at it → switch → verify symlinks point at the clone, `settings.json` is written, hook scripts are present
- [x] Commit: "test: synthetic eval checks + smoke-test docs"
- [x] `git push` (deferred — ralphex working branch; user pushes after review/merge)

### Task 10: Final review

- [ ] `nix flake check` clean
- [ ] `nix fmt` clean (no diff)
- [ ] Grep entire repo: no Tailscale node names; no Hetzner IPs (`5.*.*.*`, `91.*.*.*`, etc.); no API keys; no real hostnames (`sancta-choir`, `sancta-claw`, `hermes-claw`, `rpi5`, `rpi5-full`, `zero-kuzea`). Exception: `<host>` placeholder strings in docs are fine.
- [ ] Grep: no `/nix/store/...` literals in committed files (except inside Nix expressions where they're expected)
- [ ] `git tag v0.1.0`
- [ ] `git push origin main --tags`
- [ ] Commit: "chore: v0.1.0" (only if there are pending changes; otherwise just tag)

---

## Out of scope (do NOT attempt in this ralphex run)

These require `darwin-rebuild` / `nixos-rebuild` against live machine state. The human will drive these manually after ralphex finishes:

1. **darwin-config**: add `claude-shared` flake input → rewrite `modules/programs/claude-code.nix` as thin wrapper → rebuild → verify → delete `modules/_skills/`
2. **nixos-config**: add `claude-shared` flake input → write replacement wrapper module → migrate per-host (rpi5 first, then sancta-choir, sancta-claw headless)
3. **nixos-config cleanup**: move `modules/claude-skills/{review-fix-loop,sweep-bugs}/` → `.claude/skills/`; delete the rest
4. **Each consuming host**: HTTPS credential helper or SSH key for cloning this private repo

---

## Completion signal

When all tasks above are checked off and pushed:

```
<promise>CLAUDE_SHARED_BOOTSTRAP_COMPLETE</promise>
```
