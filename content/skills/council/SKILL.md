---
name: council
description: >
  Deliberative Council — a three-assessor decision gate for consequential actions.
  Given a proposed action, runs opportunity (advocate), risk (adversarial skeptic),
  and compliance (charter law) assessors INDEPENDENTLY, synthesizes a verdict
  (proceed / escalate-to-human / block), and logs the record. The council proposes
  and gates; it never acts. The human is the apex.
---

# /council — Deliberative Council Skill

## Guardrails (non-negotiable)

1. **The council PROPOSES and GATES. It NEVER takes a consequential action.**
   No deploys, no network changes, no secret access, no irreversible operations.
2. **The human is the apex authority.** Any high-risk, novel, edge-case, or
   human-gate-category proposal ALWAYS escalates. It never auto-proceeds.
3. **The charter is immutable at runtime.** The council cannot rewrite, amend,
   or reinterpret `CHARTER.md` during a session. Only a human may change it.

---

## When to invoke `/council`

Before any consequential action — especially:
- Actions touching money, software deployments, secrets, network exposure
- Irreversible or outward actions
- Novel or unusual proposals outside known patterns
- Anything where you'd otherwise wonder "should I check first?"

For trivial/obviously-safe local reads or reversible operations, `/council` is
optional but always valid to invoke.

---

## Procedure

### Step 1 — Receive the proposal

Accept a clear, specific description of the proposed action. If vague, ask for
clarification before proceeding. The proposal must be specific enough to evaluate.

### Step 2 — Run the three assessors INDEPENDENTLY

Launch three independent sub-agents (or sequential prompts in separate contexts)
using the prompts in `assessors/`. They MUST NOT share context or see each other's
outputs before synthesis.

| Assessor | File | Role |
|---|---|---|
| Opportunity | `assessors/opportunity.md` | Advocate — surface value and rationale |
| Risk | `assessors/risk.md` | Skeptic — try to refute; tier + failure modes |
| Compliance | `assessors/compliance.md` | Law — hard veto on charter violations |

Replace `{{PROPOSAL}}` in each prompt with the verbatim proposed action.

Each assessor must return its JSON section (see `schema.md`).

### Step 3 — Synthesize

Run `scripts/synthesize.mjs` with the three assessor JSON outputs:

```bash
node scripts/synthesize.mjs \
  --opportunity '{"opportunity": {...}}' \
  --risk        '{"risk": {...}}' \
  --compliance  '{"compliance": {...}, "tripwires_fired": [...]}'
```

Or use `--opportunity-file`, `--risk-file`, `--compliance-file` for file inputs.

The script applies the decision rules, writes a log record to
`~/.claude/index/council/<log_id>.json`, and prints the full verdict JSON.

### Step 4 — Surface the verdict

**CRITICAL SAFETY RULE: If `synthesize.mjs` exits non-zero, produces no stdout,
or produces output that cannot be parsed as JSON, treat the result as
`escalate-to-human`. NEVER treat a synthesis error, a missing verdict, or a
parse failure as permission to proceed. An error from the synthesizer is itself
a signal to pause and escalate, not a green light.**

Present the verdict clearly:

- **`proceed`** — state the log_id, summarize the opportunity, and proceed (if
  the human has not said otherwise).
- **`escalate-to-human`** — present the FULL case: opportunity (why it's worth
  it), risk (tier, blast radius, reversibility, top failure modes), compliance
  status, tripwires fired. Ask the human to decide. Do NOT proceed unilaterally.
- **`block`** — state the charter clause violated (veto_reason), decline the
  action, suggest a compliant alternative if one exists.

---

## Worked Example

**Proposal:** "Append the current UTC timestamp to ~/.claude/index/council/heartbeat.log"

**Opportunity assessor output:**
```json
{
  "opportunity": {
    "value": "Creates a minimal, verifiable heartbeat log showing when the council skill was last exercised. Useful for auditing activity without any external dependencies.",
    "rationale": "Appending a timestamp to a local log in the council's own index directory is a zero-risk, zero-cost operation that supports auditability."
  }
}
```

**Risk assessor output:**
```json
{
  "risk": {
    "tier": "low",
    "blast_radius": "One extra line in a local log file. No external systems. No secrets. No network.",
    "reversibility": "Delete or truncate the file. Immediate. Zero cost.",
    "top_failure_modes": [
      "Directory does not exist — write fails, no side effects",
      "Disk full — write fails, no side effects",
      "File permission denied — write fails, no side effects"
    ]
  }
}
```

**Compliance assessor output:**
```json
{
  "compliance": {
    "allowed": true,
    "veto_reason": null
  },
  "tripwires_fired": []
}
```

**Synthesis:**
```json
{
  "proposal": "Append the current UTC timestamp to ~/.claude/index/council/heartbeat.log",
  "opportunity": { "value": "...", "rationale": "..." },
  "risk": { "tier": "low", "blast_radius": "...", "reversibility": "...", "top_failure_modes": ["..."] },
  "compliance": { "allowed": true, "veto_reason": null },
  "decision": "proceed",
  "tripwires_fired": [],
  "log_id": "council-20260620T120000Z-a1b2c3",
  "timestamp": "2026-06-20T12:00:00.000Z"
}
```

**Verdict presented to human:**
> Council verdict: **PROCEED** (log: council-20260620T120000Z-a1b2c3)
> Low-risk local write, no charter concerns, no tripwires. Proceeding.

---

## File layout

```
content/skills/council/
  CHARTER.md            — immutable rules (human-write only)
  schema.md             — verdict JSON schema + example
  SKILL.md              — this file
  README.md             — usage and v1 roadmap
  assessors/
    opportunity.md      — advocate prompt
    risk.md             — skeptic prompt
    compliance.md       — charter-checker prompt
  scripts/
    synthesize.mjs      — pure Node synthesis + logging
  tests/
    fixture-a-low-risk.json
    fixture-b-high-risk.json
    fixture-c-compliance-violation.json
    runner.mjs          — end-to-end test runner (must pass before changes)
```
