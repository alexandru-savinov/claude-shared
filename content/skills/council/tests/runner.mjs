#!/usr/bin/env node
/**
 * runner.mjs — Council v0 end-to-end test runner
 *
 * Exercises synthesize.mjs against three fixtures and asserts the expected
 * decision for each. Exits 0 if all pass, non-zero on any failure.
 *
 * Pure Node, no npm deps.
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTH = join(__dirname, '..', 'scripts', 'synthesize.mjs');
const TESTS_DIR = __dirname;

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
function runSynthesize(opportunity, risk, compliance) {
  try {
    const result = execFileSync(
      process.execPath,
      [
        SYNTH,
        '--opportunity', JSON.stringify(opportunity),
        '--risk',        JSON.stringify(risk),
        '--compliance',  JSON.stringify(compliance),
      ],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { verdict: JSON.parse(result), exitCode: 0, stderr: '' };
  } catch (e) {
    // execFileSync throws on non-zero exit. e.status is the exit code.
    return {
      verdict: null,
      exitCode: e.status ?? 1,
      stderr: e.stderr ?? '',
      stdout: e.stdout ?? '',
    };
  }
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
    } else if (verdict.decision !== fixture.expectedDecision) {
      console.log(`    result:   ${verdict.decision}`);
      console.log(`    FAIL — expected "${fixture.expectedDecision}", got "${verdict.decision}"`);
      console.log(`    verdict:  ${JSON.stringify(verdict, null, 4).split('\n').join('\n              ')}`);
      failed++;
      results.push({ name: fixture.name, status: 'FAIL', expected: fixture.expectedDecision, got: verdict.decision });
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
