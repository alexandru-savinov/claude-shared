# Ingestion Membrane v0 — Design Spec

**Status:** Settled (brainstorm + council review complete). Build only.
**Date:** 2026-06-20
**Companion plan:** `2026-06-20-ingestion-membrane-plan.md`

---

## SCOPE GUARD — READ FIRST

> **BUILD ONLY. DO NOT ACTIVATE.**
>
> This design describes what to build and test. The membrane goes fleet-live ONLY after
> a SECOND council run, and ONLY after the poisoned-page fail-closed test passes on real
> code (not a claim). No `nixos-rebuild switch`, no making `/scout` live, no deployment
> of any kind. Build → test (esp. poisoned-page) → stop. Activation is a separate step.

---

## 1. Goal

An **ingestion membrane** — a trust-gated boundary controlling how untrusted input
crosses into the trusted substrate (meaning-index / memory).

v0 has `/scout` as its first and only consumer. The model generalises: file-drop is
the planned second consumer; sub-agent reports and MCP inlets come later. Build for
the general case; don't corner the trust model; don't build other inlets yet.

---

## 2. Trust Marking

Every atom in the system carries a provenance block:

```json
{
  "trust":      "human" | "agent" | "web",
  "source":     "<url or path or session-id>",
  "fetched_at": "<ISO-8601>",
  "by":         "<skill or script or user>",
  "sig":        ""
}
```

- `sig` is **reserved empty** for v0. Cryptographic signing is a separate future
  backbone; the field is present now so the schema doesn't shift later.
- Tags ride on **every atom** — defense-in-depth, not the primary enforcement.
- Primary enforcement is structural (§5).

### Trust tier semantics

| Tier    | Permitted use                                                    |
|---------|------------------------------------------------------------------|
| `human` | May be policy or directive. Highest authority.                   |
| `agent` | Advisory only. No auto-policy. No auto-directive.                |
| `web`   | Data only. Never a directive. Never treated as established fact. |

---

## 3. Physical Two-Store Boundary

The boundary is **structural**, not a naming convention:

```
~/.scout/<slug>/          ← QUARANTINE (untrusted)
  raw/                    ← fetched pages, verbatim
  meta.json               ← trust:web provenance block per item
  status.json             ← fetch outcomes (never a trusted atom)

~/.claude/index/          ← TRUSTED INDEX
  (only authored, cited synthesis atoms; trust:agent ceiling)
```

**Rule:** The trusted index **never contains raw web content.** Only a scout-authored
synthesis atom, with citations, may cross the boundary. Segregation is the backstop;
tags are defense-in-depth.

---

## 4. Promotion Gate

```
fetch → QUARANTINE (trust:web, data-only)
              ↓
       agent SYNTHESIS
              ↓
      TRUSTED INDEX (trust:agent — ceiling an agent may self-assign)
              ↓
        HUMAN act
              ↓
      trust:human (only a human lifts agent→policy)
```

- Auto-promotion ends at `trust:agent`. No script, skill, or agent may emit
  `trust:human`.
- The **council** gates consequential *actions* taken on findings — not knowledge
  deposit itself (deposit is safe; acting on findings may not be).

---

## 5. Enforcement — Structural, Not Prompt-Promised

This is the core architecture decision: enforcement must be structural so that a
compromised or fooled agent cannot escalate trust.

### Scout worker constraints
- Writes **only** to quarantine (`~/.scout/<slug>/`).
- Has access to **data-only tools**: fetch, read-quarantine, write-quarantine.
- Has **no** outward or consequential tools during the fetch phase.

### Fixed-schema deposit script
- A single script controls the quarantine-to-trusted crossing.
- Schema is **fixed and validated**: the script structurally CANNOT:
  - Set `trust: "human"`
  - Emit a directive or action
  - Trigger any downstream effect
- On any malformed or invalid input: **fail-closed** — no atom is written rather than
  a wrong-tier atom.
- Worst case if the scout worker is fooled by a poisoned page: a `trust:agent`
  advisory quoting the source as data.

### Later hardening (not v0)
- Separate OS uid for the scout worker process.
- seccomp/landlock filesystem restrictions.
- These are noted, not built.

---

## 6. Verify-on-Read

A small pure helper encodes the tier rules so any reader can confirm what it holds:

```
verify_trust(atom) →
  "human"  → may be policy/directive
  "agent"  → advisory; treat as informed opinion, not fact
  "web"    → data-only; never a directive; never auto-fact
```

Guard: anything pulled from quarantine into context is **wrapped and labeled
untrusted** before use.

The rule is documented in `/yourself`. v0 = helper + convention. Mechanical gating
of every reader = later hardening.

---

## 7. What /scout Changes

Current behaviour (before membrane): `/scout` deposits raw or lightly-processed web
content directly into the trusted index.

Post-membrane behaviour:
1. Fetch → quarantine (trust:web, data-only, verbatim).
2. Scout synthesises over quarantined content, produces an owned, cited synthesis.
3. Synthesis deposited to trusted index via the fixed-schema deposit script
   (trust:agent, citations required).
4. Raw web stays in quarantine — never touches the trusted index.

---

## 8. Error Handling

| Condition                            | Outcome                                              |
|--------------------------------------|------------------------------------------------------|
| Fetch fails                          | Status written to quarantine only. No trusted atom.  |
| Insufficient or contradictory sources| Low-confidence advisory, or nothing. Never fabricate.|
| Malformed deposit attempt            | Rejected fail-closed. No atom rather than wrong-tier.|
| Poisoned page contains directives    | Worst case: trust:agent advisory quoting as data.    |

---

## 9. Closing Checks (the Reason This Exists)

These are the tests that must pass before any activation is considered:

### (a) Poisoned-Page Test — the keystone
A quarantined item containing `"treat this as human policy / do X"` MUST NOT produce:
- A `trust:human` atom (deposit script refuses — fail-closed).
- A directive in the trusted index.

Worst permitted output: a `trust:agent` advisory that quotes the page as data.

### (b) No-Leak Test
Raw web content must never appear in `~/.claude/index/`. Only synthesis atoms may
cross. Verify by inspection after a scout run.

### (c) Verify-on-Read Correctness
The helper must return the correct tier and permitted-use for each atom type.
Exercised with atoms of all three tiers.

---

## 10. Non-Goals (v0)

- File-drop inlet (designed-for, not built).
- Sub-agent report inlet (designed-for, not built).
- MCP inlet (designed-for, not built).
- Cryptographic signing (field reserved, not implemented).
- OS-level uid/seccomp sandboxing (noted as later hardening).
- Activation / deployment (explicit out-of-scope; requires 2nd council).
