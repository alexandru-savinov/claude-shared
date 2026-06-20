# Council Verdict JSON Schema

## Schema Definition

```json
{
  "proposal": "string — the proposed action, verbatim as submitted",

  "opportunity": {
    "value": "string — concrete benefit if the action succeeds",
    "rationale": "string — why this is worth doing at all"
  },

  "risk": {
    "tier": "\"low\" | \"medium\" | \"high\"",
    "blast_radius": "string — scope of impact if this goes wrong",
    "reversibility": "string — how and how quickly the action can be undone",
    "top_failure_modes": ["string", "string", "string"]
  },

  "compliance": {
    "allowed": "boolean",
    "veto_reason": "string | null — non-null only when allowed is false; cites the specific charter clause violated"
  },

  "decision": "\"proceed\" | \"escalate-to-human\" | \"block\"",

  "tripwires_fired": ["string"],

  "log_id": "string — unique identifier for this verdict, format: council-<ISO8601-compact>-<random6hex>",

  "timestamp": "string — ISO 8601 UTC"
}
```

### Field constraints

- `decision` MUST be `"block"` when `compliance.allowed === false`.
- `decision` MUST be `"escalate-to-human"` when `risk.tier` is `"medium"` or `"high"`, OR when any human-gate category applies, OR when any tripwire fires — unless `decision` is already `"block"`.
- `decision` MAY be `"proceed"` only when: `compliance.allowed === true` AND `risk.tier === "low"` AND `tripwires_fired` is empty AND no human-gate category applies.
- `compliance.veto_reason` MUST be non-null when `compliance.allowed === false`.
- `log_id` MUST be unique; never reuse.

---

## Example Verdict

**Proposal:** "Read the current CPU temperature from /sys/class/thermal/thermal_zone0/temp and log it to ~/.claude/index/council/syscheck.txt"

```json
{
  "proposal": "Read the current CPU temperature from /sys/class/thermal/thermal_zone0/temp and log it to ~/.claude/index/council/syscheck.txt",

  "opportunity": {
    "value": "Provides a baseline CPU temperature reading useful for diagnosing thermal throttling without invoking any external service or modifying system state.",
    "rationale": "Reading a sysfs file is a zero-side-effect local operation. The log target is inside the council's own log directory. The information is non-sensitive."
  },

  "risk": {
    "tier": "low",
    "blast_radius": "Local only. Worst case: the file already exists and is appended to. No external systems involved.",
    "reversibility": "Immediately reversible — delete the log file. No system state is changed.",
    "top_failure_modes": [
      "sysfs file absent on this platform → read error, no side effects",
      "log directory does not exist → write fails, no side effects",
      "disk full → write fails, existing data unaffected"
    ]
  },

  "compliance": {
    "allowed": true,
    "veto_reason": null
  },

  "decision": "proceed",

  "tripwires_fired": [],

  "log_id": "council-20260620T142300Z-a3f7c1",

  "timestamp": "2026-06-20T14:23:00Z"
}
```

This verdict conforms to the schema: `allowed=true`, `tier=low`, no tripwires, no human-gate category → `decision=proceed`.
