# Council Safety Proof — Dafny

Machine-checked proof that the Council decision logic can **never** output
`proceed` past a veto, high/medium risk tier, a fired tripwire, or a
human-gate flag.

## What is proven

File: `Council.dfy`. Verified with Dafny 4.11.0 / Z3.

| Lemma | Statement |
|---|---|
| `VetoImpliesBlock` | `!allowed => decide(...) == Block` (strict, not just != Proceed) |
| `HighRiskNotProceed` | `tier == High => decide(...) != Proceed` |
| `MediumRiskNotProceed` | `tier == Medium => decide(...) != Proceed` |
| `TripwireNotProceed` | `tripwiresCount > 0 => decide(...) != Proceed` |
| `HumanGateNotProceed` | `humanGate == true => decide(...) != Proceed` |
| `ProceedOnlyIfFullyClean` | `decide(...) == Proceed => (allowed && tier == Low && tripwiresCount == 0 && !humanGate)` (keystone) |
| `FullyCleanImpliesProceed` | Tightness: `decide(true, Low, 0, false) == Proceed` (Proceed IS reachable) |

The keystone lemma is the converse of all the others: it says Proceed is
impossible unless every safety condition is simultaneously satisfied.

## Honest caveats

1. **Model, not bytes.** The proof covers the modelled `decide` function in
   Dafny, not the JavaScript in `synthesize.mjs`. It assumes the model is a
   faithful abstraction of the JS. The mapping must be manually audited.

2. **Simplifications vs. the JS.**

   - `tripwiresCount: nat` replaces the JS union/dedupe of three `tripwires_fired`
     arrays. The proof covers "non-empty result"; it does not model the dedup logic
     itself.
   - `humanGate: bool` models `isHumanGateTriggered(tripwiresFired)`. In the live JS
     this function is **dead code** (its comment says it is "fully subsumed" by
     `tripwiresFired.length > 0`). The model includes it as a separate input to
     match the schema prose verbatim and because the subsumed path is safe (it
     only adds escalation triggers, never removes them).
   - Non-boolean `allowed` is a hard error in JS (throws before the decision
     switch). Dafny's native `bool` type enforces this at the type level; no
     runtime coercion is possible.
   - Log I/O, timestamp generation, and field validation are not modelled —
     they do not affect the decision output.

3. **Dafny Z3 backend.** Dafny uses Z3 as its SMT solver. The proofs are
   decidable by exhaustive case analysis over the finite `Decision` / `RiskTier`
   datatypes and arithmetic over `nat`.

## Running the proof

```sh
nix run nixpkgs#dafny -- verify Council.dfy
# Expected: Dafny program verifier finished with 8 verified, 0 errors
```
