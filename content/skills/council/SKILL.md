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

**The proposal reaches the synthesizer through a FILE, never through the shell
command.** Proposals contain backticks, `$(...)` and quotes; inlined in a shell
string they get interpreted or break the command. Write the verbatim proposal
text to a file with the Write tool, then pass `--proposal-file <path>`:

```bash
# 1. With the Write tool (not echo/heredoc), write the verbatim proposal to
#    e.g. /tmp/council-proposal.txt
# 2. Then:
node scripts/synthesize.mjs \
  --proposal-file   /tmp/council-proposal.txt \
  --opportunity-file /tmp/council-opportunity.json \
  --risk-file        /tmp/council-risk.json \
  --compliance-file  /tmp/council-compliance.json
```

The assessor JSONs can also be passed inline (`--opportunity '<json>'`, `--risk`,
`--compliance`), but files are safer for the same reason.

Keep stderr separate from stdout (do NOT use `2>&1`): stdout is the verdict JSON,
stderr carries warnings and the `Logged to:` line, and mixing them makes the
verdict unparseable.

The file text is logged verbatim and takes precedence over any `proposal` field
in the assessor JSONs; if one differs, the record carries `proposal_mismatch: true`.
If no proposal is given at all, the verdict is still logged and printed with
`proposal_missing: true` and a stderr warning. `--proposal <string>` still works
for backward compatibility but should not be used for new calls.

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

**Synthesis:** the proposal text above is written verbatim (Write tool) to
`/tmp/council-proposal.txt`, the three outputs to `/tmp/council-{opportunity,risk,compliance}.json`, then:

```bash
node scripts/synthesize.mjs \
  --proposal-file   /tmp/council-proposal.txt \
  --opportunity-file /tmp/council-opportunity.json \
  --risk-file        /tmp/council-risk.json \
  --compliance-file  /tmp/council-compliance.json
```

stdout (stderr kept separate):
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
