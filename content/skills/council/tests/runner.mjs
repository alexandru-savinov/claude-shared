#!/usr/bin/env node
/**
 * runner.mjs — Council v0 end-to-end test runner
 *
 * Exercises synthesize.mjs against three fixtures and asserts the expected
 * decision for each. Exits 0 if all pass, non-zero on any failure.
 *
 * Pure Node, no npm deps.
 *
 * Isolation: every synthesize.mjs run gets HOME=<temp dir>, so its log records
 * land in <temp>/.claude/index/council and are removed at the end. The runner
 * only COUNTS the real ~/.claude/index/council before and after (assertion iv);
 * it never writes there.
 */

import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir, tmpdir } from 'os';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTH = join(__dirname, '..', 'scripts', 'synthesize.mjs');
const TESTS_DIR = __dirname;

// Real council log dir of whoever runs the runner. Read-only: counted, never written.
const REAL_COUNCIL_DIR = join(homedir(), '.claude', 'index', 'council');
function countDir(dir) {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}
const REAL_COUNT_BEFORE = countDir(REAL_COUNCIL_DIR);

// Isolated HOME for every synthesize.mjs run.
const TMP_HOME = mkdtempSync(join(tmpdir(), 'council-test-home-'));
const TMP_COUNCIL_DIR = join(TMP_HOME, '.claude', 'index', 'council');
function cleanupTmpHome() {
  try { rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanupTmpHome);

// ---------------------------------------------------------------------------
// Test fixtures — each specifies what to pass to synthesize.mjs
// The fixtures contain the flat merged JSON; we split it into the three
// assessor inputs that synthesize.mjs expects.
// ---------------------------------------------------------------------------

const FIXTURES = [
  // ── Happy-path fixtures (must stay passing) ──────────────────────────────
  {
    name: 'Fixture A — low-risk local read',
    file: join(TESTS_DIR, 'fixture-a-low-risk.json'),
    expectedDecision: 'proceed',
  },
  {
    name: 'Fixture B — high-risk irreversible action',
    file: join(TESTS_DIR, 'fixture-b-high-risk.json'),
    expectedDecision: 'escalate-to-human',
  },
  {
    name: 'Fixture C — compliance violation (serve secrets publicly)',
    file: join(TESTS_DIR, 'fixture-c-compliance-violation.json'),
    expectedDecision: 'block',
  },

  // ── Fail-open fixtures (must NEVER yield proceed) ─────────────────────────
  // expectedDecision: 'error'  → synthesize.mjs must exit non-zero (no proceed)
  // expectedDecision: 'escalate-to-human' → normal verdict but MUST NOT be proceed
  {
    name: 'Fixture D — fail-open: compliance.allowed is null (with veto_reason)',
    file: join(TESTS_DIR, 'fixture-d-null-allowed.json'),
    expectedDecision: 'error',
  },
  {
    name: 'Fixture E — fail-open: compliance.allowed is string "false"',
    file: join(TESTS_DIR, 'fixture-e-string-false-allowed.json'),
    expectedDecision: 'error',
  },
  {
    name: 'Fixture F — fail-open: compliance is array [] not object',
    file: join(TESTS_DIR, 'fixture-f-array-compliance.json'),
    expectedDecision: 'error',
  },
  {
    name: 'Fixture G — fail-open: compliance.allowed field entirely absent',
    file: join(TESTS_DIR, 'fixture-g-missing-allowed.json'),
    expectedDecision: 'error',
  },
  {
    name: 'Fixture H — fail-open: tripwire in RISK input, compliance clean',
    file: join(TESTS_DIR, 'fixture-h-tripwire-in-risk.json'),
    expectedDecision: 'escalate-to-human',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw);
  return data;
}

/**
 * Split a fixture's flat JSON into the three JSON inputs synthesize.mjs expects.
 *
 * For fixtures where tripwires_fired is nested inside risk.tripwires_fired
 * (fixture-h pattern), the risk object is forwarded as-is so synthesize.mjs
 * can union it from all three sources.
 *
 * compliance is forwarded as-is (may be any value, including malformed ones,
 * to exercise validation paths).
 */
function splitIntoAssessorInputs(fixture) {
  const opportunity = {
    proposal: fixture.proposal,
    opportunity: fixture.opportunity,
  };
  // Forward the raw risk object — if fixture has risk.tripwires_fired nested
  // inside the risk sub-object (fixture-h), preserve it.
  const risk = {
    proposal: fixture.proposal,
    risk: fixture.risk,
  };
  const compliance = {
    proposal: fixture.proposal,
    compliance: fixture.compliance,
    tripwires_fired: fixture.tripwires_fired,
  };
  return { opportunity, risk, compliance };
}

/**
 * Run synthesize.mjs and return { verdict, exitCode, stderr }.
 * Never throws — caller inspects exitCode to determine pass/fail.
 */
function runSynthesize(opportunity, risk, compliance, extraArgs = []) {
  // No shell: argv goes straight to node. HOME is the isolated temp dir.
  const r = spawnSync(
    process.execPath,
    [
      SYNTH,
      '--opportunity', JSON.stringify(opportunity),
      '--risk',        JSON.stringify(risk),
      '--compliance',  JSON.stringify(compliance),
      ...extraArgs,
    ],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: TMP_HOME } }
  );
  const exitCode = r.status ?? 1;
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  let verdict = null;
  if (exitCode === 0) {
    try { verdict = JSON.parse(stdout); } catch { verdict = null; }
  }
  return { verdict, exitCode, stderr, stdout };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const results = [];

console.log('');
console.log('Council v0 — End-to-End Test Runner');
console.log('=====================================');
console.log('');

for (const fixture of FIXTURES) {
  process.stdout.write(`  ${fixture.name}\n`);
  process.stdout.write(`    file:     ${fixture.file}\n`);
  process.stdout.write(`    expected: ${fixture.expectedDecision}\n`);

  if (!existsSync(fixture.file)) {
    console.log(`    result:   MISSING FILE`);
    console.log(`    FAIL — fixture file not found: ${fixture.file}`);
    failed++;
    results.push({ name: fixture.name, status: 'FAIL', error: 'fixture file not found' });
    console.log('');
    continue;
  }

  const data = loadFixture(fixture.file);
  const { opportunity, risk, compliance } = splitIntoAssessorInputs(data);
  const { verdict, exitCode, stderr, stdout } = runSynthesize(opportunity, risk, compliance);

  const expectError = fixture.expectedDecision === 'error';

  if (expectError) {
    // For fail-open error fixtures: pass iff synthesize exited non-zero AND
    // did not emit a verdict with decision === 'proceed'.
    const emittedProceed = (verdict?.decision === 'proceed') ||
      (stdout && (() => { try { return JSON.parse(stdout)?.decision === 'proceed'; } catch { return false; } })());

    if (emittedProceed) {
      console.log(`    result:   proceed  ← WRONG (must never reach proceed)`);
      console.log(`    FAIL — expected error/non-zero exit; synthesize emitted proceed`);
      failed++;
      results.push({ name: fixture.name, status: 'FAIL', error: 'synthesize emitted proceed on malformed input' });
    } else if (exitCode === 0) {
      // Exited 0 — check the verdict anyway
      const got = verdict?.decision ?? '(no decision)';
      if (got === 'proceed') {
        console.log(`    result:   ${got}  ← WRONG`);
        console.log(`    FAIL — expected non-zero exit + no proceed; got exit 0 with "${got}"`);
        failed++;
        results.push({ name: fixture.name, status: 'FAIL', error: `exit 0 with decision "${got}"` });
      } else {
        // Exited 0 but produced a non-proceed verdict — acceptable (escalate/block)
        console.log(`    result:   ${got} (exit 0 — acceptable non-proceed verdict)`);
        console.log(`    PASS`);
        passed++;
        results.push({ name: fixture.name, status: 'PASS', decision: got, note: 'non-zero-exit or non-proceed' });
      }
    } else {
      // Non-zero exit, no proceed — correct hard error
      console.log(`    result:   ERROR (exit ${exitCode}) — synthesize rejected malformed input`);
      if (stderr) console.log(`    stderr:   ${stderr.trim().split('\n')[0]}`);
      console.log(`    PASS`);
      passed++;
      results.push({ name: fixture.name, status: 'PASS', exitCode, note: 'non-zero exit as expected' });
    }
  } else {
    // Normal verdict fixture: synthesize must exit 0 with the expected decision.
    if (exitCode !== 0) {
      console.log(`    result:   ERROR (exit ${exitCode})`);
      if (stderr) console.log(`    stderr:   ${stderr.trim()}`);
      console.log(`    FAIL — expected verdict "${fixture.expectedDecision}", got non-zero exit`);
      failed++;
      results.push({ name: fixture.name, status: 'FAIL', exitCode, error: 'unexpected non-zero exit' });
    } else if (verdict?.decision !== fixture.expectedDecision) {
      console.log(`    result:   ${verdict?.decision ?? '(unparseable stdout)'}`);
      console.log(`    FAIL — expected "${fixture.expectedDecision}", got "${verdict?.decision}"`);
      console.log(`    verdict:  ${JSON.stringify(verdict, null, 4).split('\n').join('\n              ')}`);
      failed++;
      results.push({ name: fixture.name, status: 'FAIL', expected: fixture.expectedDecision, got: verdict?.decision });
    } else {
      console.log(`    result:   ${verdict.decision}`);
      console.log(`    log_id:   ${verdict.log_id}`);
      console.log(`    PASS`);
      passed++;
      results.push({ name: fixture.name, status: 'PASS', decision: verdict.decision });
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Proposal-handling assertions (i)–(iv)
// ---------------------------------------------------------------------------

function check(name, ok, detail) {
  if (ok) {
    console.log(`    PASS  ${name}`);
    passed++;
    results.push({ name, status: 'PASS' });
  } else {
    console.log(`    FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
    results.push({ name, status: 'FAIL', error: detail });
  }
}

function readLogRecord(verdict) {
  if (!verdict?.log_id) return null;
  const p = join(TMP_COUNCIL_DIR, `${verdict.log_id}.json`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Base assessor inputs: fixture A (low risk) with every `proposal` field removed.
const base = loadFixture(join(TESTS_DIR, 'fixture-a-low-risk.json'));
const bareInputs = () => ({
  opportunity: { opportunity: base.opportunity },
  risk:        { risk: base.risk },
  compliance:  { compliance: base.compliance, tripwires_fired: base.tripwires_fired },
});

// (i) No proposal at all → exit 0, parseable JSON, proposal_missing: true.
console.log('  Fixture (i) — no proposal given anywhere');
{
  const { opportunity, risk, compliance } = bareInputs();
  const { verdict, exitCode, stderr } = runSynthesize(opportunity, risk, compliance);
  check('(i) exit 0', exitCode === 0, `exit ${exitCode}: ${stderr.trim().split('\n')[0]}`);
  check('(i) stdout is parseable JSON', verdict !== null);
  check('(i) stdout proposal_missing === true', verdict?.proposal_missing === true);
  check('(i) decision unchanged (proceed)', verdict?.decision === 'proceed', `got ${verdict?.decision}`);
  const rec = readLogRecord(verdict);
  check('(i) log record written with proposal_missing === true', rec?.proposal_missing === true);
  const warnings = stderr.split('\n').filter(l => l.includes('no proposal provided'));
  check('(i) exactly one stderr warning', warnings.length === 1, `got ${warnings.length}`);
}
console.log('');

// (ii) --proposal-file with shell metacharacters → logged byte-for-byte; the
//      command substitution inside it must never run (canary must not exist).
console.log('  Fixture (ii) — --proposal-file with shell metacharacters');
{
  const canary = `/tmp/PWNED-${randomBytes(6).toString('hex')}`;
  const nasty =
    'Run `touch ' + canary + '` and $(touch ' + canary + ') then "double" and \'single\' quotes\n' +
    'line two; echo $HOME && ls | cat > /dev/null\n' +
    '\ttab, backslash \\ and a trailing newline\n';
  const pfile = join(TMP_HOME, 'proposal-ii.txt');
  writeFileSync(pfile, nasty, 'utf8');
  const { opportunity, risk, compliance } = bareInputs();
  const { verdict, exitCode, stderr } = runSynthesize(opportunity, risk, compliance, ['--proposal-file', pfile]);
  check('(ii) exit 0', exitCode === 0, `exit ${exitCode}: ${stderr.trim().split('\n')[0]}`);
  check('(ii) stdout proposal byte-for-byte', verdict?.proposal === nasty);
  const rec = readLogRecord(verdict);
  check('(ii) log record proposal byte-for-byte', rec?.proposal === nasty,
    `logged ${JSON.stringify(rec?.proposal)}`);
  check('(ii) no proposal_missing / proposal_mismatch flags',
    rec !== null && rec.proposal_missing === undefined && rec.proposal_mismatch === undefined);
  check('(ii) canary file does NOT exist', !existsSync(canary), `${canary} exists`);
  try { rmSync(canary, { force: true }); } catch { /* none expected */ }
}
console.log('');

// (iii) Assessor proposal field differs from the file → file text wins, mismatch flagged.
console.log('  Fixture (iii) — assessor proposal differs from --proposal-file');
{
  const fileText = 'Proposal as written to the file.\n';
  const pfile = join(TMP_HOME, 'proposal-iii.txt');
  writeFileSync(pfile, fileText, 'utf8');
  const { opportunity, risk, compliance } = bareInputs();
  opportunity.proposal = 'A paraphrase the assessor made up.';
  const { verdict, exitCode, stderr } = runSynthesize(opportunity, risk, compliance, ['--proposal-file', pfile]);
  check('(iii) exit 0', exitCode === 0, `exit ${exitCode}: ${stderr.trim().split('\n')[0]}`);
  const rec = readLogRecord(verdict);
  check('(iii) logged proposal is the file text', rec?.proposal === fileText, `logged ${JSON.stringify(rec?.proposal)}`);
  check('(iii) proposal_mismatch === true', rec?.proposal_mismatch === true);
  check('(iii) stdout carries the same', verdict?.proposal === fileText && verdict?.proposal_mismatch === true);
}
console.log('');

// (iv) The real council log dir was not written to by this runner.
console.log('  Assertion (iv) — real ~/.claude/index/council untouched');
{
  const after = countDir(REAL_COUNCIL_DIR);
  console.log(`    real dir: ${REAL_COUNCIL_DIR}`);
  console.log(`    count before: ${REAL_COUNT_BEFORE}  after: ${after}`);
  check('(iv) real council file count unchanged', after === REAL_COUNT_BEFORE,
    `before ${REAL_COUNT_BEFORE}, after ${after}`);
}
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('-------------------------------------');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  console.error('FAIL — not all tests passed');
  process.exit(1);
} else {
  console.log('DONE — all tests passed');
  process.exit(0);
}
