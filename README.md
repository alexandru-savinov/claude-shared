# claude-shared

User-level [Claude Code](https://docs.claude.com/en/docs/claude-code) configuration
distributed as a Nix flake. This repo is the single source of truth for content
(skills, agents, slash commands) and the home-manager module that wires it into
`~/.claude/`.

## What this is

- A flake exposing `homeManagerModules.default` (the `programs.claude-code`
  module) plus content under `content/{skills,agents,commands}`.
- Tier 1 (Nix-managed invariant): `~/.claude/settings.json`, hook scripts, the
  optional `~/.claude/CLAUDE.md`.
- Tier 2 (writable clone via `mkOutOfStoreSymlink`): `~/.claude/skills`,
  `~/.claude/agents`, `~/.claude/commands` point into a checkout of this repo
  so edits round-trip through `git`.
- Tier 3 (local-only state): everything else under `~/.claude/` (projects,
  conversations, todos, etc.) is untouched.

## Consumers

- [`nixos-config`](https://github.com/alexandru-savinov/nixos-config) — Linux
  hosts; home-manager activated per-host.
- [`darwin-config`](https://github.com/alexandru-savinov/darwin-config) —
  macOS workstation via `nix-darwin` + home-manager.

Both add this repo as a flake input and import
`inputs.claude-shared.homeManagerModules.default`.

## What's safe to put here

This repo is **private**, but treat it as if it could leak. Do **not** commit:

- Hostnames or Tailscale node names
- Public or private IPs
- API keys, tokens, OAuth credentials, cookies, session IDs
- Anything from `~/.claude/.credentials.json` or analogous files
- User-private CLAUDE.md fragments that name people, internal projects, or
  infra by identifying detail

Use [agenix](https://github.com/ryantm/agenix) in the **consumer** repo for
anything sensitive — never inline it here. Per-host configuration belongs in
the consumer's `extraSettings` / `userClaudeMd`, not in this repo's content.

When in doubt, use `<host>` / `<user>` / `<placeholder>` in committed prose.

See [SECURITY.md](./SECURITY.md) for the leak-rotation procedure.

## Testing

Two layers: fast synthetic-eval checks via `nix flake check`, and a manual
end-to-end smoke test against a throwaway home-manager profile.

### `nix flake check`

```sh
nix flake check
```

Builds two derivations under `checks.${system}`:

- `module-all-enabled` — evaluates the module against a synthetic
  `homeManagerConfiguration` with every option turned on (`enable`,
  `zellijIntegration`, `userClaudeMd`, `extraEnabledPlugins`,
  `extraKnownMarketplaces`, `extraSettings`); asserts the three
  symlink sources resolve, all three activation hooks
  (`claudeSharedClone`, `claudeSettings`, `claudeInstalledPlugins`)
  are present, the clone script uses the configured HTTPS remote and
  `contentRepoPath`, and the settings + installed-plugins activations
  reference the right target files. `installPackage` is left at
  `false` so the check doesn't depend on the real `claude-code`
  package evaluating on every system.
- `module-disabled` — evaluates with `enable = false` and asserts
  there are no `home.file.".claude/*"` entries and none of our
  activation hooks fire.

### End-to-end smoke test

1. Clone this repo to a scratch directory:
   ```sh
   git clone https://github.com/alexandru-savinov/claude-shared.git /tmp/cs-test
   ```
2. Point a throwaway home-manager configuration at it. Minimal `flake.nix`:
   ```nix
   {
     inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
     inputs.home-manager.url = "github:nix-community/home-manager";
     inputs.home-manager.inputs.nixpkgs.follows = "nixpkgs";
     inputs.claude-shared.url = "path:/tmp/cs-test";

     outputs = { nixpkgs, home-manager, claude-shared, ... }: {
       homeConfigurations.smoke = home-manager.lib.homeManagerConfiguration {
         pkgs = nixpkgs.legacyPackages.aarch64-darwin;
         modules = [
           claude-shared.homeManagerModules.default
           {
             home.username = "you";
             home.homeDirectory = "/Users/you";
             home.stateVersion = "24.05";
             programs.claude-code.enable = true;
             programs.claude-code.contentRepoPath = "/tmp/cs-test";
           }
         ];
       };
     };
   }
   ```
3. `home-manager switch --flake .#smoke` (use a throwaway `$HOME` — see
   `home-manager`'s docs for `--extra-experimental-features` and
   `HOME=...` overrides if you want full isolation).
4. Verify:
   - `readlink ~/.claude/skills` points at `/tmp/cs-test/content/skills`
     (same for `agents`, `commands`).
   - `~/.claude/settings.json` contains the merged config — base options
     plus `statusLine` + `hooks` when zellij integration is on.
   - The hook script paths in `settings.json` (`/nix/store/...-claude-*`)
     exist and reference `jq` / `zellij` from the nix store.
