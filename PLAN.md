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

- [ ] Create `module/default.nix` declaring options under `programs.claude-code`:
  - `enable` (bool, default false)
  - `installPackage` (bool, default false)
  - `contentRepoPath` (str, default `"${config.home.homeDirectory}/.claude-shared"`)
  - `zellijIntegration.enable` (bool, default true)
  - `userClaudeMd` (`nullOr path`, default null)
  - `extraSettings` (attrset, default `{}`)
  - `extraEnabledPlugins` (attrset, default `{}`)
  - `extraKnownMarketplaces` (attrset, default `{}`)
- [ ] Generate `~/.claude/settings.json` by recursive-merge (`lib.recursiveUpdate`):
  - Base: `{ effortLevel = "high"; voiceEnabled = true; skipDangerousModePermissionPrompt = true; skipAutoPermissionPrompt = true; permissions.defaultMode = "auto"; env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"; }`
  - + zellij block (statusLine + Stop + UserPromptSubmit hooks) when `zellijIntegration.enable`
  - + `enabledPlugins = cfg.extraEnabledPlugins`
  - + `extraKnownMarketplaces = cfg.extraKnownMarketplaces`
  - + `cfg.extraSettings` (last, wins)
- [ ] `nix eval .#homeManagerModules.default --apply 'm: m._file or "ok"'` (or equivalent) succeeds
- [ ] Commit: "feat(module): option surface and settings.json"
- [ ] `git push`

### Task 6: HM module — hooks and statusline scripts

- [ ] Extract the script bodies from `~/darwin-config/modules/programs/claude-code.nix`:
  - `statusLineScript` → `module/statusline.sh`
  - `onStopScript` → `module/on-stop.sh`
  - `onUserPromptScript` → `module/on-user-prompt.sh`
- [ ] In `module/default.nix`, wire each via `pkgs.writeShellScript "claude-XXX" (builtins.readFile ./XXX.sh)`, gated by `zellijIntegration.enable`
- [ ] The wired scripts MUST have access to `${pkgs.jq}` and `${pkgs.zellij}` (use string interpolation in the .sh files? Better: keep `${pkgs.jq}` references in the .sh files and use `pkgs.substituteAll` OR inline the scripts as `let ... in pkgs.writeShellScript "..." ''...''`). Use the inline approach to keep nixpkgs interpolations.
- [ ] References resolve in the generated settings.json (statusLine.command, hooks.Stop, hooks.UserPromptSubmit)
- [ ] Commit: "feat(module): zellij statusline and hooks"
- [ ] `git push`

### Task 7: HM module — symlinks and activation

- [ ] In `module/default.nix`, set:
  - `home.file.".claude/skills".source = config.lib.file.mkOutOfStoreSymlink "${cfg.contentRepoPath}/content/skills";`
  - same for `agents`, `commands`
- [ ] Add `home.activation.claudeSharedClone` (use `lib.hm.dag.entryBefore [ "writeBoundary" ]`):
  - If `${cfg.contentRepoPath}` missing: `git clone https://github.com/alexandru-savinov/claude-shared.git "${cfg.contentRepoPath}"`
  - Else: `git -C "${cfg.contentRepoPath}" pull --ff-only`
  - Non-fatal: wrap in `|| { echo "WARNING: claude-shared sync failed"; true; }`
  - Reference `${pkgs.git}/bin/git` explicitly (not bare `git`) so activation works without git in PATH
- [ ] Add `home.activation.claudeInstalledPlugins` (only when `cfg.extraEnabledPlugins != {}` or `cfg.extraKnownMarketplaces != {}`):
  - Generate `installed_plugins.json` content as a derivation (`pkgs.writeText` is fine)
  - Hash-compare against `$HOME/.claude/plugins/installed_plugins.json` using `${pkgs.coreutils}/bin/sha256sum`
  - `install -m 644 ${generated} "$HOME/.claude/plugins/installed_plugins.json"` if different
  - Reference: `~/darwin-config/modules/programs/claude-code.nix` lines for `installedPluginsFile` and the activation block — same shape, swap `system.activationScripts` for `home.activation`
- [ ] `nix eval` the activation block; check syntax
- [ ] Commit: "feat(module): symlinks + activation"
- [ ] `git push`

### Task 8: HM module — package install + userClaudeMd

- [ ] When `cfg.installPackage = true`: add `inputs.claude-code.packages.${pkgs.system}.default` to `home.packages`
  - Pass `inputs` through via `_module.args.inputs = inputs;` in `flake.nix` outputs (so the module can `{ inputs, ... }:` cleanly)
- [ ] When `cfg.userClaudeMd != null`: `home.file.".claude/CLAUDE.md".source = cfg.userClaudeMd;`
- [ ] When null: no `~/.claude/CLAUDE.md` is written
- [ ] Sanity: `nix eval` with `installPackage = true` against a synthetic HM config; package resolves
- [ ] Commit: "feat(module): package install + optional user CLAUDE.md"
- [ ] `git push`

### Task 9: Test harness

- [ ] Add `checks.${system}.module-all-enabled` derivation that evaluates the HM module under a synthetic home-manager configuration with all options enabled and a fake `inputs.claude-code` stub (or use `installPackage = false` to avoid needing the real package eval)
- [ ] Add `checks.${system}.module-disabled` — with `enable = false`, asserts no `~/.claude/*` writes
- [ ] `nix flake check` passes both
- [ ] Fill in the "Testing" section of `README.md`: clone to scratch dir → point throwaway HM at it → switch → verify symlinks point at the clone, `settings.json` is written, hook scripts are present
- [ ] Commit: "test: synthetic eval checks + smoke-test docs"
- [ ] `git push`

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
