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

Placeholder — see Task 9 in the bootstrap plan. The intended flow is:

1. `git clone` this repo to a scratch directory.
2. Point a throwaway home-manager configuration at it (`contentRepoPath = ...`).
3. `home-manager switch`.
4. Verify `~/.claude/{skills,agents,commands}` symlink into the scratch clone,
   `~/.claude/settings.json` matches the merged config, and hook scripts are
   resolvable.

Per-PR validation runs `nix flake check` (see `checks.${system}` in
`flake.nix`).
