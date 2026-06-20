#!/usr/bin/env node
/**
 * synthesize.mjs — Council v0 synthesis script
 *
 * Pure Node, no npm dependencies.
 *
 * Input: three assessor JSON outputs on stdin OR as CLI args
 *   --opportunity <json-string>  OR  --opportunity-file <path>
 *   --risk        <json-string>  OR  --risk-file        <path>
 *   --compliance  <json-string>  OR  --compliance-file  <path>
 *
 * Decision rules (precedence):
 *   1. compliance.allowed === false  →  block
 *   2. risk.tier >= medium OR any §2 human-gate category in tripwires_fired
 *      OR tripwires_fired non-empty                    →  escalate-to-human
 *   3. else                                            →  proceed
 *
 * Writes additive log record to ~/.claude/index/council/<log_id>.json
 * Prints the final verdict JSON to stdout.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage() {
  console.error(`
Usage:
  synthesize.mjs --opportunity <json> --risk <json> --compliance <json>
  synthesize.mjs --opportunity-file <path> --risk-file <path> --compliance-file <path>

  JSON inputs can be mixed (some inline, some file).
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      args[key.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function loadJson(rawArg, fileArg, args, label) {
  const raw = args[rawArg];
  const file = args[fileArg];
  if (raw) {
    try { return JSON.parse(raw); }
    catch (e) { throw new Error(`${label}: invalid JSON in --${rawArg}: ${e.message}`); }
  }
  if (file) {
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`${label}: cannot read/parse --${fileArg} (${file}): ${e.message}`); }
  }
  throw new Error(`${label}: provide --${rawArg} or --${fileArg}`);
}

function generateLogId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = randomBytes(3).toString('hex');
  return `council-${ts}-${rand}`;
}

// Human-gate category keywords (§2 of charter).
// NOTE: isHumanGateTriggered is kept for potential future callers but is currently
// dead in the main decision path — tripwiresFired.length > 0 fully subsumes it.
// Prefer the length check; this function is retained only for documentation clarity.
const HUMAN_GATE_KEYWORDS = [
  'money', 'software', 'matter', 'secrets', 'network-exposure', 'irreversible', 'outward',
  // Also catch variant names that compliance might emit
  'network_exposure', 'network exposure',
];

function isHumanGateTriggered(tripwires) {
  if (!Array.isArray(tripwires)) return false;
  return tripwires.some(tw => {
    const lower = tw.toLowerCase();
    return HUMAN_GATE_KEYWORDS.some(kw => lower.includes(kw));
  });
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

/**
 * @param {object} opportunity  - { opportunity: { value, rationale } }
 * @param {object} risk         - { risk: { tier, blast_radius, reversibility, top_failure_modes } }
 * @param {object} compliance   - { compliance: { allowed, veto_reason }, tripwires_fired }
 * @returns {object} verdict
 */
function synthesize(opportunity, risk, compliance) {
  // Validate required fields
  if (!opportunity?.opportunity) throw new Error('opportunity input missing .opportunity field');
  if (!risk?.risk) throw new Error('risk input missing .risk field');

  // C-1: cmp must be a real plain object — not null, not array, not primitive.
  const cmp = compliance?.compliance;
  if (typeof cmp !== 'object' || cmp === null || Array.isArray(cmp)) {
    throw new Error(
      `compliance.compliance must be a plain object; got: ${JSON.stringify(cmp)} ` +
      `(type: ${Array.isArray(cmp) ? 'array' : typeof cmp}). ` +
      'Treating as HARD ERROR — cannot proceed.'
    );
  }

  // C-2: cmp.allowed must be a strict boolean. Any other type is a HARD ERROR.
  if (typeof cmp.allowed !== 'boolean') {
    throw new Error(
      `compliance.compliance.allowed must be a boolean (true/false); ` +
      `got: ${JSON.stringify(cmp.allowed)} (type: ${typeof cmp.allowed}). ` +
      'A non-boolean allowed field is a HARD ERROR — cannot proceed.'
    );
  }

  const opp = opportunity.opportunity;
  const rsk = risk.risk;

  // Collect tripwires from ALL three assessor inputs, union/dedupe (fix #2).
  // The canonical source is compliance, but a tripwire in risk or opportunity
  // must not be silently dropped.
  // Check both top-level (risk.tripwires_fired) and nested (risk.risk.tripwires_fired)
  // to handle assessors that embed tripwires inside their own section.
  const complianceTripwires = Array.isArray(compliance.tripwires_fired) ? compliance.tripwires_fired : [];
  const riskTripwires       = Array.isArray(risk.tripwires_fired)       ? risk.tripwires_fired
                            : Array.isArray(risk.risk?.tripwires_fired) ? risk.risk.tripwires_fired
                            : [];
  const oppTripwires        = Array.isArray(opportunity.tripwires_fired)           ? opportunity.tripwires_fired
                            : Array.isArray(opportunity.opportunity?.tripwires_fired) ? opportunity.opportunity.tripwires_fired
                            : [];

  if (riskTripwires.length > 0) {
    console.warn(
      `WARNING: risk assessor carried tripwires_fired (${JSON.stringify(riskTripwires)}). ` +
      'Tripwires should originate from the compliance assessor. Including them anyway.'
    );
  }
  if (oppTripwires.length > 0) {
    console.warn(
      `WARNING: opportunity assessor carried tripwires_fired (${JSON.stringify(oppTripwires)}). ` +
      'Tripwires should originate from the compliance assessor. Including them anyway.'
    );
  }

  // Union/dedupe across all three sources.
  const tripwiresFired = [...new Set([...complianceTripwires, ...riskTripwires, ...oppTripwires])];

  // Validate tier
  const validTiers = ['low', 'medium', 'high'];
  if (!validTiers.includes(rsk.tier)) {
    throw new Error(`risk.tier must be one of ${validTiers.join('/')}; got: ${rsk.tier}`);
  }

  // Decision rule §5
  let decision;

  if (cmp.allowed === false) {
    // Rule 1: Hard veto (strict boolean false — enforced above)
    decision = 'block';
  } else if (
    rsk.tier === 'medium' ||
    rsk.tier === 'high' ||
    tripwiresFired.length > 0
    // NOTE: isHumanGateTriggered(tripwiresFired) is fully subsumed by the
    // tripwiresFired.length > 0 check — any non-empty tripwires list escalates.
  ) {
    // Rule 2: Escalate
    decision = 'escalate-to-human';
  } else {
    // Rule 3: Proceed
    decision = 'proceed';
  }

  const logId = generateLogId();
  const timestamp = new Date().toISOString();

  const verdict = {
    opportunity: opp,
    risk: rsk,
    compliance: cmp,
    decision,
    tripwires_fired: tripwiresFired,
    log_id: logId,
    timestamp,
  };

  return verdict;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function writeLog(verdict, proposal) {
  const logDir = join(homedir(), '.claude', 'index', 'council');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logPath = join(logDir, `${verdict.log_id}.json`);

  // Never overwrite — the log_id includes random bytes so collision is astronomically unlikely,
  // but guard anyway.
  if (existsSync(logPath)) {
    throw new Error(`Log collision: ${logPath} already exists. This should not happen.`);
  }

  const record = {
    proposal,
    ...verdict,
  };

  writeFileSync(logPath, JSON.stringify(record, null, 2), { flag: 'wx' }); // wx = fail if exists
  return logPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Load the three assessor outputs
  let opportunity, risk, compliance;
  try {
    opportunity = loadJson('opportunity', 'opportunity-file', args, 'opportunity');
    risk        = loadJson('risk',        'risk-file',        args, 'risk');
    compliance  = loadJson('compliance',  'compliance-file',  args, 'compliance');
  } catch (e) {
    console.error(`Input error: ${e.message}`);
    usage();
  }

  // Extract the original proposal from whichever input carries it (optional)
  const proposal =
    opportunity?.proposal ||
    risk?.proposal ||
    compliance?.proposal ||
    args['proposal'] ||
    '(proposal not provided in assessor inputs)';

  let verdict;
  try {
    verdict = synthesize(opportunity, risk, compliance);
  } catch (e) {
    console.error(`Synthesis error: ${e.message}`);
    process.exit(2);
  }

  let logPath;
  try {
    logPath = writeLog(verdict, proposal);
  } catch (e) {
    console.error(`Logging error: ${e.message}`);
    // Don't block the verdict output for a log failure — print the verdict then exit non-zero
    const output = { proposal, ...verdict };
    console.log(JSON.stringify(output, null, 2));
    process.exit(3);
  }

  const output = { proposal, ...verdict };
  console.log(JSON.stringify(output, null, 2));
  process.stderr.write(`Logged to: ${logPath}\n`);
}

main();
