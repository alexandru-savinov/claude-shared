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

import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, symlinkSync } from 'fs';
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

// ---------------------------------------------------------------------------
// Shadow assertions (sq093 Step B): the shadow is recorded, it never decides.
// ---------------------------------------------------------------------------

function splitFixtureFile(name) {
  const f = loadFixture(join(TESTS_DIR, name));
  return {
    opportunity: { opportunity: f.opportunity },
    risk:        { risk: f.risk },
    compliance:  { compliance: f.compliance, tripwires_fired: f.tripwires_fired },
  };
}

function writeShadowFiles(tag, inputs, overrides = {}) {
  const paths = {};
  for (const k of ['opportunity', 'risk', 'compliance']) {
    const p = join(TMP_HOME, `shadow-${tag}-${k}.json`);
    writeFileSync(p, overrides[k] ?? JSON.stringify(inputs[k]), 'utf8');
    paths[k] = p;
  }
  return paths;
}

function shadowArgs(paths) {
  return [
    '--shadow-opportunity-file', paths.opportunity,
    '--shadow-risk-file',        paths.risk,
    '--shadow-compliance-file',  paths.compliance,
  ];
}

// (v) The shadow DISAGREES, in the dangerous direction: the full council blocks
//     (fixture C), the cheap-tier shadow would proceed (fixture A inputs).
//     The decision must stay the full council's; the shadow is only recorded.
console.log('  Fixture (v) — shadow disagrees with the full council (full block, shadow proceed)');
{
  const full = splitFixtureFile('fixture-c-compliance-violation.json');
  const sp = writeShadowFiles('v', splitFixtureFile('fixture-a-low-risk.json'));
  const { verdict, exitCode, stderr } = runSynthesize(full.opportunity, full.risk, full.compliance,
    [...shadowArgs(sp), '--shadow-latency-ms', '41234']);
  check('(v) exit 0', exitCode === 0, `exit ${exitCode}: ${stderr.trim().split('\n')[0]}`);
  check('(v) stdout decision is the full council\'s (block)', verdict?.decision === 'block', `got ${verdict?.decision}`);
  check('(v) stdout carries no shadow (log only)', verdict !== null && !('shadow' in verdict));
  const rec = readLogRecord(verdict);
  check('(v) logged decision is the full council\'s (block)', rec?.decision === 'block', `got ${rec?.decision}`);
  check('(v) shadow.decision recorded as proceed', rec?.shadow?.decision === 'proceed',
    `got ${JSON.stringify(rec?.shadow)}`);
  check('(v) shadow.tripwires_fired recorded', Array.isArray(rec?.shadow?.tripwires_fired));
  check('(v) shadow.latency_ms recorded', rec?.shadow?.latency_ms === 41234);
  check('(v) full tripwires unchanged', JSON.stringify(rec?.tripwires_fired) ===
    JSON.stringify(['secrets', 'network-exposure', 'outward', 'irreversible']));
}
console.log('');

// (vi) Invalid shadow input: the decision is unchanged, shadow.error is set, exit 0.
console.log('  Fixture (vi) — invalid shadow input');
{
  const full = splitFixtureFile('fixture-a-low-risk.json');
  // (vi-a) unparseable JSON in one shadow file
  const spBad = writeShadowFiles('vi', full, { risk: '{ not json' });
  let r = runSynthesize(full.opportunity, full.risk, full.compliance, shadowArgs(spBad));
  check('(vi-a) exit 0', r.exitCode === 0, `exit ${r.exitCode}`);
  check('(vi-a) decision unchanged (proceed)', r.verdict?.decision === 'proceed', `got ${r.verdict?.decision}`);
  let rec = readLogRecord(r.verdict);
  check('(vi-a) shadow.error set', typeof rec?.shadow?.error === 'string' && rec.shadow.error.length > 0,
    `got ${JSON.stringify(rec?.shadow)}`);
  check('(vi-a) no shadow.decision', rec !== null && rec.shadow?.decision === undefined);
  // (vi-b) a shadow whose compliance.allowed is malformed (the full council would exit 2 on it)
  const spMal = writeShadowFiles('vib', full, { compliance: JSON.stringify({ compliance: { allowed: 'true' } }) });
  r = runSynthesize(full.opportunity, full.risk, full.compliance, shadowArgs(spMal));
  rec = readLogRecord(r.verdict);
  check('(vi-b) malformed shadow: exit 0, decision proceed, shadow.error',
    r.exitCode === 0 && r.verdict?.decision === 'proceed' && typeof rec?.shadow?.error === 'string',
    `exit ${r.exitCode}, ${r.verdict?.decision}, ${JSON.stringify(rec?.shadow)}`);
  // (vi-c) only one of the three shadow flags given
  r = runSynthesize(full.opportunity, full.risk, full.compliance,
    ['--shadow-opportunity-file', spBad.opportunity]);
  rec = readLogRecord(r.verdict);
  check('(vi-c) partial shadow flags: exit 0, decision proceed, shadow.error names the missing flags',
    r.exitCode === 0 && r.verdict?.decision === 'proceed' && /shadow-risk-file/.test(rec?.shadow?.error ?? ''),
    `exit ${r.exitCode}, ${JSON.stringify(rec?.shadow)}`);
  // (vi-d) a nonexistent shadow file
  r = runSynthesize(full.opportunity, full.risk, full.compliance,
    shadowArgs({ ...spBad, risk: spMal.risk, compliance: join(TMP_HOME, 'does-not-exist.json') }));
  rec = readLogRecord(r.verdict);
  check('(vi-d) missing shadow file: exit 0, decision proceed, shadow.error',
    r.exitCode === 0 && r.verdict?.decision === 'proceed' && typeof rec?.shadow?.error === 'string',
    `exit ${r.exitCode}, ${JSON.stringify(rec?.shadow)}`);
}
console.log('');

// (vii) No shadow flags: the record is exactly today's record (= stdout), no shadow key.
console.log('  Fixture (vii) — no shadow flags: today\'s behaviour');
{
  const full = splitFixtureFile('fixture-b-high-risk.json');
  const pfile = join(TMP_HOME, 'proposal-vii.txt');
  writeFileSync(pfile, 'Proposal for fixture (vii).\n', 'utf8');
  const { verdict, exitCode, stdout } = runSynthesize(full.opportunity, full.risk, full.compliance, ['--proposal-file', pfile]);
  check('(vii) exit 0, decision escalate-to-human', exitCode === 0 && verdict?.decision === 'escalate-to-human');
  const rec = readLogRecord(verdict);
  check('(vii) log record has no shadow key', rec !== null && !('shadow' in rec));
  check('(vii) log record equals the stdout verdict (as before Step B)',
    rec !== null && JSON.stringify(rec) === JSON.stringify(JSON.parse(stdout)));
  check('(vii) record keys are exactly today\'s', rec !== null && JSON.stringify(Object.keys(rec)) ===
    JSON.stringify(['proposal', 'opportunity', 'risk', 'compliance', 'decision', 'tripwires_fired', 'log_id', 'timestamp']),
    `keys ${JSON.stringify(rec && Object.keys(rec))}`);
}
console.log('');

// (viii) The CLI still runs when reached through a symlink (the live skill path is
//        ~/.claude/skills/council -> /nix/store/...). A naive import.meta main check
//        would print nothing here.
console.log('  Fixture (viii) — synthesize.mjs invoked through a symlink');
{
  const linkDir = join(TMP_HOME, 'linked-skill');
  symlinkSync(join(__dirname, '..'), linkDir);
  const full = splitFixtureFile('fixture-a-low-risk.json');
  const r = spawnSync(process.execPath, [join(linkDir, 'scripts', 'synthesize.mjs'),
    '--opportunity', JSON.stringify(full.opportunity), '--risk', JSON.stringify(full.risk),
    '--compliance', JSON.stringify(full.compliance)],
    { encoding: 'utf8', env: { ...process.env, HOME: TMP_HOME } });
  let v = null; try { v = JSON.parse(r.stdout); } catch { /* checked below */ }
  check('(viii) via symlink: exit 0 and a proceed verdict on stdout', r.status === 0 && v?.decision === 'proceed',
    `exit ${r.status}, stdout ${JSON.stringify((r.stdout ?? '').slice(0, 80))}`);
}
console.log('');

// (ix) shadow-report.mjs on a synthetic log dir (never the real one).
console.log('  Fixture (ix) — shadow-report.mjs counts and gate');
{
  const REPORT = join(__dirname, '..', 'scripts', 'shadow-report.mjs');
  const dir = join(TMP_HOME, 'report-dir');
  mkdirSync(dir, { recursive: true });
  const fixA = loadFixture(join(TESTS_DIR, 'fixture-a-low-risk.json'));
  let k = 0;
  const put = (rec) => writeFileSync(join(dir, `council-test-${String(k++).padStart(3, '0')}.json`), JSON.stringify(rec));
  const ts = (d) => `2026-10-${String(d).padStart(2, '0')}T12:00:00.000Z`;
  put({ proposal: 'p-agree', decision: 'escalate-to-human', timestamp: ts(1), shadow: { decision: 'escalate-to-human', tripwires_fired: [], latency_ms: 30000 } });
  put({ proposal: 'p-looser', decision: 'escalate-to-human', timestamp: ts(1), shadow: { decision: 'proceed', tripwires_fired: [], latency_ms: 50000 } });
  put({ proposal: 'p-stricter', decision: 'proceed', timestamp: ts(2), shadow: { decision: 'escalate-to-human', tripwires_fired: ['x'] } });
  put({ proposal: 'p-both-proceed', decision: 'proceed', timestamp: ts(2), shadow: { decision: 'proceed', tripwires_fired: [] } });
  put({ proposal: 'p-both-proceed', decision: 'proceed', timestamp: ts(3), shadow: { decision: 'proceed', tripwires_fired: [] } }); // duplicate
  put({ proposal: 'p-err', decision: 'proceed', timestamp: ts(3), shadow: { error: 'bad' } });
  put({ proposal: '(proposal not provided)', proposal_missing: true, decision: 'proceed', timestamp: ts(3), shadow: { decision: 'proceed' } });
  put({ proposal: fixA.proposal, decision: 'proceed', timestamp: ts(3), shadow: { decision: 'proceed' } });
  put({ proposal: 'p-fast', path: 'fast', decision: 'proceed', timestamp: ts(3), shadow: { decision: 'proceed' } });
  put({ proposal: 'p-noshadow', decision: 'proceed', timestamp: ts(3) });
  const runReport = (d, today) => {
    const r = spawnSync(process.execPath, [REPORT, '--dir', d, '--today', today, '--json'], { encoding: 'utf8' });
    try { return { status: r.status, j: JSON.parse(r.stdout) }; } catch { return { status: r.status, j: null }; }
  };
  const { status, j } = runReport(dir, '2026-10-05');
  check('(ix) report exit 0', status === 0);
  check('(ix) n = 4 distinct text-bearing, non-fixture, path full', j?.n === 4, `n ${j?.n}`);
  check('(ix) agreement 2, looser 1, stricter 1',
    j?.agree === 2 && j?.looser === 1 && j?.stricter === 1, JSON.stringify(j && { a: j.agree, l: j.looser, s: j.stricter }));
  check('(ix) excluded text-less 1, fixture 1, not-full 1; shadow errors 1',
    j?.excluded?.text_less === 1 && j?.excluded?.fixture === 1 && j?.excluded?.not_full_path === 1 && j?.shadow_errors === 1,
    JSON.stringify(j && { ...j.excluded, e: j.shadow_errors }));
  check('(ix) latency p90 over 2 samples = 50000', j?.latency_p90_ms === 50000 && j?.latency_samples === 2);
  check('(ix) gate says insufficient n', /^insufficient n/.test(j?.gate ?? ''), j?.gate);
  const late = runReport(dir, '2026-12-28').j;
  check('(ix) at the revisit date the decision goes to him',
    /revisit date 2026-12-28 reached .*insufficient n.*Alexandru/.test(late?.gate ?? ''), late?.gate);
  // Positive arm: 30 distinct fast-eligible cases over >= 14 days → gate met.
  const dir2 = join(TMP_HOME, 'report-dir-2');
  mkdirSync(dir2, { recursive: true });
  for (let i = 0; i < 30; i++) {
    writeFileSync(join(dir2, `c-${i}.json`), JSON.stringify({ proposal: `q-${i}`, decision: 'proceed',
      timestamp: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00.000Z`, shadow: { decision: 'proceed' } }));
  }
  const met = runReport(dir2, '2026-10-20').j;
  check('(ix) 30 fast-eligible over >= 14 days: gate met', /^gate met/.test(met?.gate ?? ''), met?.gate);
  const early = runReport(dir2, '2026-10-10').j;
  check('(ix) 30 fast-eligible but < 14 days: insufficient time', /^insufficient time/.test(early?.gate ?? ''), early?.gate);
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
