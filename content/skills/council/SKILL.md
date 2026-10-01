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

Once the proposal is settled, write it verbatim to a file with the Write tool
(e.g. `/tmp/council-proposal.txt`). The SAME file goes to Jev and to Codex at
Step 2b and to `synthesize.mjs` at Step 3; their rows are matched to the verdict by
the sha256 of this text, so do not edit the file between the two.

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

#### Step 2b — the shadow trio (sq093 Step B: measurement only)

In the SAME message that launches the three full assessors, also launch the same
three prompts a second time on the cheap tier: `Agent(model: "sonnet", ...)`, same
verbatim `{{PROPOSAL}}`, each in its own context. Six independent agents, launched
together; no shadow agent sees any other agent's output, and no full assessor sees a
shadow output.

- **Effort:** the Agent tool has a `model` parameter but no per-call effort
  parameter, so the shadow runs at Sonnet's default effort. The design's "effort low"
  is not reachable from this call; this is a known gap, not a silent substitution.
- **Latency (optional):** note the wall time from launching the shadow trio to the
  last shadow result, if you can observe it, and pass it as `--shadow-latency-ms`.
  If you cannot observe it, omit the flag; never estimate it.
- Write each shadow JSON to its own file (Write tool), e.g.
  `/tmp/council-shadow-{opportunity,risk,compliance}.json`.
- **The shadow never decides.** Do not read, show or reason from the shadow outputs
  when surfacing the verdict. The verdict is only the full council's `decision`.
- **A shadow failure is not a council failure.** If a shadow agent fails or returns
  garbage, pass what you have (or nothing): synthesize records `shadow.error` and the
  verdict is unchanged. Never re-run the full council because of the shadow, and
  never delay Step 4 waiting on a stuck shadow agent: drop the shadow flags instead.

**Gate for the shadow run (design §6.3, resolved 2026-09-28 with bobuk's
suggestion):** the shadow is judged when **2 weeks have passed since the first
shadow record AND 30 distinct fast-eligible cases** (shadow `proceed`) are recorded,
**OR on the revisit date 2026-12-28, whichever comes first.** At the revisit,
`scripts/shadow-report.mjs` states n and the decision goes to Alexandru. Until then
the report says `insufficient n`, and nothing is built on the shadow's numbers.

#### Step 2b, second shadow — Jev forecasts the verdict (measurement only)

In the same message, launch Jev in the background (Bash `run_in_background`):

```bash
node scripts/jev-shadow.mjs --proposal-file /tmp/council-proposal.txt
```

It asks Jev (TypeSafe's typed decision model, via OpenRouter) one question: which
verdict will the full council reach, `proceed` / `escalate-to-human` / `block`,
with probabilities. It writes ONE row (kind `council`) to the Jev experiment
journal `~/.claude/index/council/jev-journal.jsonl` and nothing else.
Approved by Alexandru 2026-09-28: «jev design = aprobat. in lucru.»

- **Jev never touches the verdict.** Do not read, show or reason from its answer at
  Step 4, and never pass it to `synthesize.mjs`. Do not wait for it.
- **A Jev failure is not a council failure.** The script always exits 0; a 402
  (the $1 cap), 429, timeout or bad answer becomes an `error` row, or nothing.
- **It stops by itself** after 2026-10-26 (Europe/Chisinau): no call, no row.
- **A proposal that touches security is NOT sent** (secrets, network exposure,
  vulnerabilities, exploits, credentials, or a secret-shaped string): it leaves a
  `{skipped:"security"}` row with no text and no probabilities, never scored.
  Security findings stay in the house. Empty or over-24-KiB proposals are not sent
  either. The key is read from `/run/agenix/jev-openrouter-key` only.

#### Step 2b, third shadow — Codex forecasts the verdict (measurement only)

In the same message, launch Codex in the background too (Bash `run_in_background`):

```bash
node scripts/codex-shadow.mjs --proposal-file /tmp/council-proposal.txt
```

It asks Codex (`codex exec`, read-only sandbox, stdin `/dev/null`, a fresh empty
temp dir, a hard timeout, the model his Codex config selects; never `-m`) the same
one question as Jev: which verdict will the full council reach, `proceed` /
`escalate-to-human` / `block`, with probabilities, as JSON. It writes ONE row
(kind `council`, source `codex`) to its own journal
`~/.claude/index/council/codex-journal.jsonl` and nothing else.
Approved by Alexandru 2026-09-30: «da, aprobat ca si jev».

- **Codex never touches the verdict.** Do not read, show or reason from its answer
  at Step 4, and never pass it to `synthesize.mjs`. Do not wait for it.
- **A Codex failure is not a council failure.** The script always exits 0; a
  timeout, rate limit, missing `codex`, non-zero exit or bad answer becomes an
  `error` row, or nothing.
- **From the text only.** The prompt tells Codex to run no commands, and the
  `--json` event stream is checked: if any command or tool event appears, the row
  is `tool_use:true`, carries no probabilities, and is never scored.
- **No labels.** Nothing sent names a model or this house: the council is "a
  three-member review panel", and model names, `Co-Authored-By` / `Claude-Session`
  lines and "Generated with Claude Code" are replaced by `[model]`. The row keeps
  `anonymized:true` and the count, never the removed text. This removes the label
  bias, not the style bias.
- **It stops by itself** after 2026-12-28 (Europe/Chisinau): no call, no row.
- **A proposal that touches security is NOT sent** — Jev's filter, the same
  function, on the text that would be sent: a `{skipped:"security"}` row with no
  text and no probabilities. Empty or over-24-KiB proposals are not sent either.

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
  --compliance-file  /tmp/council-compliance.json \
  --shadow-opportunity-file /tmp/council-shadow-opportunity.json \
  --shadow-risk-file        /tmp/council-shadow-risk.json \
  --shadow-compliance-file  /tmp/council-shadow-compliance.json
```

The `--shadow-*` flags (and the optional `--shadow-latency-ms <n>`) run the shadow
JSONs through the same decision function and log the result as a `shadow` object
inside this record: `{ decision, tripwires_fired, latency_ms? }`, or `{ error }` if
the shadow input is missing, partial or invalid. The shadow is written to the log
only; stdout and `decision` are exactly what they would be without it. Without any
`--shadow-*` flag the record has no `shadow` key.

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

After the verdict is surfaced, resolve Jev's pending rows against the council
logs (local files only; a failure here changes nothing):

```bash
node scripts/jev-journal.mjs resolve-council
node scripts/jev-journal.mjs resolve-council --source codex
```

A row asked at or after its verdict's timestamp is voided, never scored.
`node scripts/jev-journal.mjs report` scores Jev against two parrots (base rate;
tripwire keywords). Under 20 resolved rows it says `NEJUDECAT: n insuficient`.
`node scripts/jev-journal.mjs report --source codex` scores Codex against the same
two parrots; under 30 resolved rows it says `NEJUDECAT: n insuficient`.

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
    synthesize.mjs      — pure Node synthesis + logging (+ the logged shadow)
    shadow-report.mjs   — read-only: shadow vs full agreement, looser/stricter, gate
    jev-shadow.mjs      — Step 2b: Jev forecasts the verdict, one journal row
    jev-journal.mjs     — the Jev experiment journal: append, resolve, report
                          (--source codex: the same resolve/report on Codex's journal)
    codex-shadow.mjs    — Step 2b: Codex forecasts the verdict, one journal row
  tests/
    fixture-a-low-risk.json
    fixture-b-high-risk.json
    fixture-c-compliance-violation.json
    runner.mjs          — end-to-end test runner (must pass before changes)
    jev-shadow.test.mjs — Jev shadow closing check, with its local stub
    codex-shadow.test.mjs — Codex shadow closing check, with its `codex` stub
```
