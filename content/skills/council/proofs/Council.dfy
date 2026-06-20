/**
 * Council.dfy — Machine-checked proof of the Council safety invariant.
 *
 * Models the decision logic in synthesize.mjs (Council v0).
 * Verified with Dafny 4.11.0 / Z3.
 *
 * Decision rule (from synthesize.mjs §Decision logic):
 *   1. !allowed            → Block
 *   2. tier >= Medium  OR
 *      tripwiresCount > 0 → Escalate
 *   3. else                → Proceed
 *
 * Hardening modelled:
 *   - `allowed` is a strict bool (non-boolean is a hard error in JS; here it is
 *     the native Dafny bool type — the type system enforces it).
 *   - The humanGate parameter collapses the JS `isHumanGateTriggered` check: in
 *     synthesize.mjs that check is SUBSUMED by tripwiresCount > 0 (see comment
 *     "fully subsumed"). We include it as a separate parameter anyway so the
 *     lemma coverage matches the schema's field constraints verbatim.
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

datatype Decision  = Proceed | Escalate | Block
datatype RiskTier  = Low | Medium | High

// ---------------------------------------------------------------------------
// Decision function — faithful model of synthesize.mjs
// ---------------------------------------------------------------------------

/**
 * Mirrors the three-rule cascade in synthesize():
 *
 *   if (cmp.allowed === false)              → block
 *   else if (tier >= medium || tripwires)   → escalate-to-human
 *   else                                    → proceed
 *
 * Note: synthesize.mjs comment says isHumanGateTriggered is "fully subsumed"
 * by tripwiresCount > 0. We expose humanGate as a separate input so every
 * schema constraint can be stated independently. In this model, humanGate
 * triggers escalation on its own (mirrors schema prose; JS treats it as dead
 * code because any non-empty tripwires list subsumes it).
 */
function decide(allowed: bool, tier: RiskTier, tripwiresCount: nat, humanGate: bool): Decision
{
  if !allowed then
    Block
  else if tier == Medium || tier == High || tripwiresCount > 0 || humanGate then
    Escalate
  else
    Proceed
}

// ---------------------------------------------------------------------------
// Safety lemmas
// ---------------------------------------------------------------------------

/**
 * Lemma 1 — Veto implies Block.
 *
 * !allowed => decide(...) == Block  (never Proceed, never Escalate).
 * A compliance veto produces Block regardless of all other inputs.
 */
lemma VetoImpliesBlock(tier: RiskTier, tripwiresCount: nat, humanGate: bool)
  ensures decide(false, tier, tripwiresCount, humanGate) == Block
{
  // Z3 discharges this directly from the `decide` definition.
}

/**
 * Lemma 2 — High risk tier never yields Proceed.
 */
lemma HighRiskNotProceed(allowed: bool, tripwiresCount: nat, humanGate: bool)
  ensures decide(allowed, High, tripwiresCount, humanGate) != Proceed
{
}

/**
 * Lemma 3 — Medium risk tier never yields Proceed.
 */
lemma MediumRiskNotProceed(allowed: bool, tripwiresCount: nat, humanGate: bool)
  ensures decide(allowed, Medium, tripwiresCount, humanGate) != Proceed
{
}

/**
 * Lemma 4 — Any fired tripwire never yields Proceed.
 */
lemma TripwireNotProceed(allowed: bool, tier: RiskTier, tripwiresCount: nat, humanGate: bool)
  requires tripwiresCount > 0
  ensures decide(allowed, tier, tripwiresCount, humanGate) != Proceed
{
}

/**
 * Lemma 5 — Human gate flag never yields Proceed.
 */
lemma HumanGateNotProceed(allowed: bool, tier: RiskTier, tripwiresCount: nat)
  ensures decide(allowed, tier, tripwiresCount, true) != Proceed
{
}

/**
 * Keystone Lemma — Proceed ONLY in the fully-clean case.
 *
 * decide(...) == Proceed  ⟹
 *   allowed == true  ∧  tier == Low  ∧  tripwiresCount == 0  ∧  !humanGate
 *
 * Machine-checked form of the schema constraint:
 *   "decision MAY be 'proceed' only when: allowed === true AND tier === 'low'
 *    AND tripwires_fired is empty AND no human-gate category applies."
 *
 * Equivalently: every path to Proceed threads through ALL four guards.
 * Z3 proves this by exhaustive case analysis over the finite Decision /
 * RiskTier domains and arithmetic over nat.
 */
lemma ProceedOnlyIfFullyClean(allowed: bool, tier: RiskTier, tripwiresCount: nat, humanGate: bool)
  ensures decide(allowed, tier, tripwiresCount, humanGate) == Proceed
       ==> (allowed && tier == Low && tripwiresCount == 0 && !humanGate)
{
}

/**
 * Converse / tightness lemma — the fully-clean case always yields Proceed.
 *
 * Confirms the invariant is not vacuously strong (i.e., Proceed IS reachable
 * exactly when all four conditions hold).
 */
lemma FullyCleanImpliesProceed()
  ensures decide(true, Low, 0, false) == Proceed
{
}
