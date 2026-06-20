# Council v0 — Deliberative Decision Gate

A three-assessor reasoning and gating layer for consequential actions.
**The council proposes and gates. It never acts. The human is the apex.**

---

## How to invoke `/council`

In any Claude Code session:

```
/council <proposed action>
```

Example:
```
/council Deploy the updated n8n workflow sync service to sancta-choir via nixos-rebuild switch
```

The skill will:
1. Run three independent assessors (opportunity / risk / compliance)
2. Synthesize a verdict via `scripts/synthesize.mjs`
3. Log the record to `~/.claude/index/council/<log_id>.json`
4. Surface the verdict: `proceed` / `escalate-to-human` / `block`

---

## The Charter (summary)

Full text: `CHARTER.md` — **immutable at runtime.**

### Human-gate categories (§2)
Any proposal touching these ALWAYS escalates to a human:
- Money, Software (production deploys), Matter (physical/hardware), Secrets, Network exposure, Irreversible actions, Outward actions (external-facing)

### Risk tiers (§4)
- `low` — reversible within minutes, local blast radius
- `medium` — costly to reverse, moderate blast radius
- `high` — irreversible or very costly, large/unknown blast radius

### Decision rules (§5, precedence)
1. `block` — if compliance issues a HARD VETO
2. `escalate-to-human` — if risk ≥ medium, OR any tripwire fires, OR human-gate category applies
3. `proceed` — only if compliant, low risk, no tripwires, no human-gate category

### Tripwires (§6)
Auto-escalate on: goal-drift, permission-creep, overconfidence, out-of-distribution, self-modification

---

## Verdict schema

See `schema.md` for the full JSON schema and a worked example.

```json
{
  "proposal": "...",
  "opportunity": { "value": "...", "rationale": "..." },
  "risk": { "tier": "low|medium|high", "blast_radius": "...", "reversibility": "...", "top_failure_modes": [] },
  "compliance": { "allowed": true, "veto_reason": null },
  "decision": "proceed|escalate-to-human|block",
  "tripwires_fired": [],
  "log_id": "council-<timestamp>-<random>",
  "timestamp": "ISO8601"
}
```

---

## Running the tests

```bash
node content/skills/council/tests/runner.mjs
```

All three fixtures must pass before any change to this skill is complete:
- Fixture A (low-risk) → `proceed`
- Fixture B (high-risk irreversible) → `escalate-to-human`
- Fixture C (compliance violation) → `block`

---

## Log records

Each council invocation writes a JSON record to:
```
~/.claude/index/council/<log_id>.json
```

Records are additive and never overwritten. The log_id includes a timestamp
and 3 bytes of random hex to prevent collisions.

---

## v1 Roadmap

The following are explicitly OUT OF SCOPE for v0 (CC skill only):

| Feature | Notes |
|---|---|
| **Commons-bus integration** | Broadcast verdicts to the shared-memory commons so fleet agents can observe council decisions |
| **Non-CC agents** | Extend the council to NullClaw, hermes-agent, and other fleet members |
| **Auto-invocation** | Automatically gate consequential fleet actions (nixos-rebuild, agenix, deploy) before execution |
| **Signed verdicts** | Cryptographic signatures on log records to detect tampering |
| **Prompt-injection hardening** | Auth on assessor inputs; distrust web/subagent content reaching the council |
| **Inaction scoring** | Explicitly weigh cost of no-action in the opportunity assessment |
| **Commons audit trail** | Cross-session searchable log of all council decisions |

v1 builds on v0 without breaking the CC skill interface. The charter, schema, and
assessor prompts are designed to be fleet-reusable.

---

## Architecture

```
/council <proposal>
    │
    ├─► assessors/opportunity.md  (advocate — value + rationale)
    ├─► assessors/risk.md         (skeptic  — tier + failure modes)  [independent]
    └─► assessors/compliance.md   (law      — charter check + vetos)
                │
                ▼
        scripts/synthesize.mjs
                │
                ├─► ~/.claude/index/council/<log_id>.json  (additive log)
                └─► verdict JSON → surface to human
```

Assessors are independent: no shared context, no cross-references.
Compliance has a hard veto. Risk sets the tier. Opportunity proposes only.
