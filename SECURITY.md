# Security policy

This repo is **private** but distributed across multiple machines via Nix
flakes and cloned into writable working trees on each host. Treat it as if any
commit could leak to a public mirror tomorrow.

## What must never land here

The following are **always** out of scope for this repo, regardless of
visibility:

- Real hostnames or Tailscale node names (use `<host>` placeholders)
- IPv4/IPv6 addresses for any host you operate
- API keys, OAuth tokens, refresh tokens, session cookies, bearer tokens
- Contents of `~/.claude/.credentials.json` or analogous credential files
- Private keys (`*.pem`, `*.key`, SSH private keys, age identities)
- `.env` files or any KEY=VALUE secrets dump
- User-private CLAUDE.md fragments that name people, internal projects, or
  infra by identifying detail
- `secrets/` directories from consumer repos

Anything host-specific or secret belongs in the **consumer repo** via
[`agenix`](https://github.com/ryantm/agenix), passed through
`extraSettings` or `userClaudeMd`.

## Pre-commit guardrails

`.gitignore` excludes `secrets/`, `*.env`, `.credentials.json`, `result*`,
and `.direnv/`. Verify before each commit:

```sh
git diff --cached | grep -iE 'api[-_]?key|secret|token|password|bearer|BEGIN [A-Z ]*PRIVATE KEY'
```

If anything matches, **abort the commit** and reset.

## If you suspect a leak

Assume the value is compromised the moment it reaches `git add`. Do not rely
on "I'll just `git commit --amend`" — by that point the file has already been
written to `.git/objects/`.

### Rotation steps (in order)

1. **Stop the bleeding.** Do not push. If already pushed, do not delete the
   remote branch yet — you need it for the audit trail until rotation is
   complete.

2. **Rotate the credential at the source.**
   - API keys: revoke in the issuing provider's dashboard, mint a new one.
   - OAuth tokens: revoke the grant, re-authorize.
   - SSH/age keys: generate a new keypair, remove the old public key from
     every `authorized_keys` / recipient list.
   - Passwords: change them everywhere the old value was reused.

3. **Update consumers.** Re-encrypt agenix secrets in `nixos-config` /
   `darwin-config` with the new value; rebuild each affected host.

4. **Purge from git history.** Only after rotation is complete and verified:

   ```sh
   # install once: nix run nixpkgs#git-filter-repo -- --help
   git filter-repo --invert-paths --path <leaked/file/path>
   # or, for a specific string in many files:
   git filter-repo --replace-text <(echo '<leaked-value>==>REDACTED')
   ```

   Then force-push and notify every consumer to re-clone:

   ```sh
   git push --force-with-lease origin main
   ```

5. **Audit the blast radius.** Check logs on every system where the
   credential could have been used. If a private key leaked, audit
   authentication logs on every host that trusted it.

6. **Post-mortem.** Document what leaked, when, where, and how the guardrail
   failed. Update `.gitignore` / pre-commit checks so the same class of leak
   cannot recur.

## Reporting

This is a personal infrastructure repo. If you are not the owner and you
believe you have found a leaked credential, contact the repo owner directly
via GitHub.
