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
 * Proposal (the text the council judged; logged verbatim):
 *   --proposal-file <path>   PREFERRED. The file contents are logged byte-for-byte
 *                            and take PRECEDENCE over any `proposal` field inside
 *                            the assessor JSONs. Write the file with an editor or
 *                            the Write tool; never inline proposal text in a shell
 *                            command.
 *   --proposal <string>      Kept for backward compatibility only.
 *   If an assessor `proposal` field differs from the file, the file text is logged
 *   and the record carries `proposal_mismatch: true`.
 *   If no proposal is given at all, the verdict is still logged and printed with
 *   `proposal_missing: true` and one stderr warning (exit status unaffected).
 *
 * Decision rules (precedence):
 *   1. compliance.allowed === false  →  block
 *   2. risk.tier >= medium OR any §2 human-gate category in tripwires_fired
 *      OR tripwires_fired non-empty                    →  escalate-to-human
 *   3. else                                            →  proceed
 *
 * Shadow (sq093 Step B, measurement only; it NEVER changes `decision`):
 *   --shadow-opportunity-file <path>  --shadow-risk-file <path>
 *   --shadow-compliance-file  <path>  [--shadow-latency-ms <n>]
 *   The same three assessor prompts, run on the cheap tier. Their JSONs go through
 *   the SAME synthesize() and the result is logged as `shadow` inside this record
 *   (log file only; stdout is unchanged). Missing, partial or invalid shadow input
 *   records `shadow: { error }` and changes nothing else. With no shadow flag at
 *   all, the record carries no `shadow` key (today's behaviour).
 *
 * Writes additive log record to ~/.claude/index/council/<log_id>.json
 * Prints the final verdict JSON to stdout.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage() {
  console.error(`
Usage:
  synthesize.mjs --opportunity <json> --risk <json> --compliance <json>
  synthesize.mjs --opportunity-file <path> --risk-file <path> --compliance-file <path> \\
                 --proposal-file <path>

  JSON inputs can be mixed (some inline, some file).
  Pass the proposal as --proposal-file; never inline it in the shell command.
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
export function synthesize(opportunity, risk, compliance) {
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

function writeLog(verdict, proposalMeta, shadow) {
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
    ...proposalMeta,
    ...verdict,
  };
  // The shadow is appended AFTER the verdict fields, so it can never overwrite them.
  if (shadow !== undefined) record.shadow = shadow;

  writeFileSync(logPath, JSON.stringify(record, null, 2), { flag: 'wx' }); // wx = fail if exists
  return logPath;
}

// ---------------------------------------------------------------------------
// Shadow (sq093 Step B) — measurement only
// ---------------------------------------------------------------------------

const SHADOW_FILE_FLAGS = ['shadow-opportunity-file', 'shadow-risk-file', 'shadow-compliance-file'];

/**
 * Compute the shadow record from the cheap-tier assessor files, using the SAME
 * synthesize() as the full council. Never throws. The return value is only ever
 * written as `record.shadow`; it has no path back to the full `decision`.
 *
 * @returns {undefined | {decision, tripwires_fired, latency_ms?} | {error}}
 *          undefined when no shadow flag was given at all.
 */
export function computeShadow(args) {
  const anyGiven = [...SHADOW_FILE_FLAGS, 'shadow-latency-ms'].some(f => f in args);
  if (!anyGiven) return undefined;

  try {
    const missing = SHADOW_FILE_FLAGS.filter(f => typeof args[f] !== 'string' || args[f].length === 0);
    if (missing.length > 0) {
      throw new Error(`incomplete shadow input: missing ${missing.map(f => `--${f}`).join(', ')}`);
    }
    const sOpp  = loadJson('shadow-opportunity', 'shadow-opportunity-file', args, 'shadow opportunity');
    const sRisk = loadJson('shadow-risk',        'shadow-risk-file',        args, 'shadow risk');
    const sCmp  = loadJson('shadow-compliance',  'shadow-compliance-file',  args, 'shadow compliance');

    // synthesize() may warn about tripwires on stderr; label those as shadow.
    const origWarn = console.warn;
    console.warn = (...a) => origWarn('[shadow]', ...a);
    let v;
    try { v = synthesize(sOpp, sRisk, sCmp); } finally { console.warn = origWarn; }

    // Only the decision-relevant fields; the shadow's own log_id/timestamp are discarded.
    const shadow = { decision: v.decision, tripwires_fired: v.tripwires_fired };
    if ('shadow-latency-ms' in args) {
      const n = Number(args['shadow-latency-ms']);
      if (Number.isFinite(n) && n >= 0) shadow.latency_ms = Math.round(n);
      else shadow.latency_error = `invalid --shadow-latency-ms: ${JSON.stringify(args['shadow-latency-ms'])}`;
    }
    return shadow;
  } catch (e) {
    console.warn(`WARNING: shadow not computed (${e.message}); logged as shadow.error. The verdict is unaffected.`);
    return { error: String(e.message) };
  }
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

  // Resolve the proposal text that gets logged.
  //   1. --proposal-file (verbatim bytes) wins over everything.
  //   2. else an assessor `proposal` field, else --proposal (legacy order).
  //   3. else proposal_missing: still log and print the verdict.
  const assessorProposals = [opportunity?.proposal, risk?.proposal, compliance?.proposal]
    .filter(p => typeof p === 'string' && p.length > 0);

  let proposalText = null;
  if (args['proposal-file']) {
    try {
      proposalText = readFileSync(args['proposal-file'], 'utf8');
    } catch (e) {
      console.error(`Input error: cannot read --proposal-file (${args['proposal-file']}): ${e.message}`);
      usage();
    }
  }

  const proposalMeta = {};
  if (proposalText !== null && proposalText.trim().length > 0) {
    proposalMeta.proposal = proposalText;
    // Compare ignoring only leading/trailing whitespace (a file usually ends in a newline).
    if (assessorProposals.some(p => p.trim() !== proposalText.trim())) {
      proposalMeta.proposal_mismatch = true;
      console.warn('WARNING: an assessor `proposal` field differs from --proposal-file; logging the file text.');
    }
  } else if (assessorProposals.length > 0) {
    proposalMeta.proposal = assessorProposals[0];
  } else if (typeof args['proposal'] === 'string' && args['proposal'].length > 0) {
    proposalMeta.proposal = args['proposal'];
  } else {
    proposalMeta.proposal = '(proposal not provided)';
    proposalMeta.proposal_missing = true;
    console.warn('WARNING: no proposal provided (use --proposal-file); verdict logged with proposal_missing: true.');
  }

  let verdict;
  try {
    verdict = synthesize(opportunity, risk, compliance);
  } catch (e) {
    console.error(`Synthesis error: ${e.message}`);
    process.exit(2);
  }

  let logPath;
  try {
    logPath = writeLog(verdict, proposalMeta, computeShadow(args));
  } catch (e) {
    console.error(`Logging error: ${e.message}`);
    // Don't block the verdict output for a log failure — print the verdict then exit non-zero
    const output = { ...proposalMeta, ...verdict };
    console.log(JSON.stringify(output, null, 2));
    process.exit(3);
  }

  const output = { ...proposalMeta, ...verdict };
  console.log(JSON.stringify(output, null, 2));
  process.stderr.write(`Logged to: ${logPath}\n`);
}

// Run the CLI only when executed directly, so tests and readers can import
// synthesize(). Compare REAL paths: the skill is reached through symlinks
// (~/.claude/skills/council -> /nix/store/...), and Node resolves the main
// module's symlinks for import.meta.url but not for process.argv[1]. A plain
// string compare would silently skip main() and print nothing.
function isMain() {
  try {
    return Boolean(process.argv[1]) &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
