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
 */
function splitIntoAssessorInputs(fixture) {
  const opportunity = {
    proposal: fixture.proposal,
    opportunity: fixture.opportunity,
  };
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

function runSynthesize(opportunity, risk, compliance) {
  const result = execFileSync(
    process.execPath,
    [
      SYNTH,
      '--opportunity', JSON.stringify(opportunity),
      '--risk',        JSON.stringify(risk),
      '--compliance',  JSON.stringify(compliance),
    ],
    { encoding: 'utf8' }
  );
  return JSON.parse(result);
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

  let verdict;
  let error;

  try {
    if (!existsSync(fixture.file)) {
      throw new Error(`Fixture file not found: ${fixture.file}`);
    }
    const data = loadFixture(fixture.file);
    const { opportunity, risk, compliance } = splitIntoAssessorInputs(data);
    verdict = runSynthesize(opportunity, risk, compliance);
  } catch (e) {
    error = e;
  }

  if (error) {
    console.log(`    result:   ERROR`);
    console.log(`    message:  ${error.message}`);
    if (error.stderr) console.log(`    stderr:   ${error.stderr}`);
    console.log(`    FAIL`);
    failed++;
    results.push({ name: fixture.name, status: 'FAIL', error: error.message });
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
