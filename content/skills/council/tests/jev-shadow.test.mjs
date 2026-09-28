#!/usr/bin/env node
// jev-shadow.test.mjs — the closing check for Jev as the council's forecaster.
// No network: Jev is a local stub (jev-shadow.stub.mjs) on 127.0.0.1.
//
//   node tests/jev-shadow.test.mjs        → exit 0 only if every arm passes
//
// Every run uses HOME=<temp dir>; the real ~/.claude/index/council is only
// COUNTED (and the real journal fingerprinted) before and after.
//
// NEGATIVE ARMS: the whole council dir is copied to a temp dir and ONE line is
// mutated — (a) synthesize.mjs lets Jev's answer override the verdict,
// (b) jev-shadow.mjs loses the 10-26 cutoff, (c) jev-journal.mjs loses the
// voiding. The matching arm is run against the copy and MUST FAIL. If a
// mutation does not apply (the line moved), that is a failure too: a negative
// arm that silently tests nothing is the defect this file exists to prevent.
import { spawnSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNCIL = join(HERE, '..');
const STUB_KEY = 'sk-or-v1-STUBKEY-7f3a9c1e5d2b8a4f6e0c9d1b3a5f7e2c';
const END = Date.parse('2026-10-26T22:00:00Z');

// ── the real substrate: counted and fingerprinted, never written ─────────────
const REAL_DIR = join(homedir(), '.claude', 'index', 'council');
const REAL_JOURNAL = join(REAL_DIR, 'jev-journal.jsonl');
const realCount = () => (existsSync(REAL_DIR) ? readdirSync(REAL_DIR).length : 0);
const realPrint = () => { try { const s = statSync(REAL_JOURNAL); return `${s.size}:${s.mtimeMs}`; } catch { return 'absent'; } };
const REAL_BEFORE = { n: realCount(), j: realPrint() };

const TMP = mkdtempSync(join(tmpdir(), 'jev-shadow-test-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
let seq = 0;
const newHome = () => { const h = join(TMP, 'h' + (++seq)); mkdirSync(join(h, '.claude', 'index', 'council'), { recursive: true }); return h; };

// ── the stub ─────────────────────────────────────────────────────────────────
const SCEN = join(TMP, 'scenario.json');
const STUBLOG = join(TMP, 'stub.jsonl');
const KEYFILE = join(TMP, 'key');
writeFileSync(KEYFILE, STUB_KEY + '\n'); chmodSync(KEYFILE, 0o600);
const scenario = (s = {}) => writeFileSync(SCEN, JSON.stringify({ key: STUB_KEY, ...s }));
scenario();
writeFileSync(STUBLOG, '');
const stub = spawn(process.execPath, [join(HERE, 'jev-shadow.stub.mjs'), SCEN, STUBLOG], { stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => stub.kill());
const PORT = await new Promise((ok, ko) => { stub.stdout.once('data', (d) => ok(String(d).trim())); stub.once('exit', () => ko(new Error('stub died'))); });
const ENDPOINT = `http://127.0.0.1:${PORT}/api/alpha/decisions`;
const stubRows = () => readFileSync(STUBLOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const jevCalls = () => stubRows().filter((r) => r.kind === 'jev').length;

// Everything any child printed, for the key grep at the end.
const OUTPUTS = [];
function run(dir, script, args, home, env = {}) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, JEV_SHADOW_ENDPOINT: ENDPOINT, JEV_SHADOW_CREDIT_URL: `http://127.0.0.1:${PORT}/api/v1/key`, JEV_SHADOW_KEY_FILE: KEYFILE, ...env },
  });
  OUTPUTS.push(r.stdout || '', r.stderr || '');
  return r;
}
const shadow = (dir, home, proposalFile, env = {}, extra = []) => run(dir, 'jev-shadow.mjs', ['--proposal-file', proposalFile, ...extra], home, env);
const journalRows = (home) => { const p = join(home, '.claude', 'index', 'council', 'jev-journal.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const latest = (home) => { const m = new Map(); for (const r of journalRows(home)) m.set(r.log_id, r); return [...m.values()].filter((r) => r.kind === 'council'); };
const councilLogs = (home) => readdirSync(join(home, '.claude', 'index', 'council')).filter((f) => /^council-.*\.json$/.test(f));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const iso = (t) => new Date(t).toISOString();

function writeProposal(home, text, name = 'proposal.txt') { const p = join(home, name); writeFileSync(p, text); return p; }
function fixture(name) { return JSON.parse(readFileSync(join(HERE, name), 'utf8')); }
function assessorFiles(home, f) {
  const w = (k, o) => { const p = join(home, `${k}.json`); writeFileSync(p, JSON.stringify(o)); return p; };
  return ['--opportunity-file', w('opp', { opportunity: f.opportunity }), '--risk-file', w('risk', { risk: f.risk }),
    '--compliance-file', w('cmp', { compliance: f.compliance, tripwires_fired: f.tripwires_fired })];
}
function synth(dir, home, f, proposalFile) {
  const r = run(dir, 'synthesize.mjs', ['--proposal-file', proposalFile, ...assessorFiles(home, f)], home);
  let v = null; try { v = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { r, v };
}
// A council log written by hand, for timing that must not depend on today's date.
function handLog(home, proposal, decision, timestamp) {
  const id = `council-${timestamp.replace(/[-:.]/g, '').slice(0, 15)}Z-${sha(proposal + timestamp).slice(0, 6)}`;
  writeFileSync(join(home, '.claude', 'index', 'council', `${id}.json`), JSON.stringify({ proposal, decision, log_id: id, timestamp, tripwires_fired: [] }));
  return id;
}

// ── the arms. Each takes the council dir it runs against, returns [ok, detail].
const ARMS = {};

// A row is written BEFORE the verdict; resolution then takes the verdict.
ARMS.before = (dir) => {
  const now = Date.now();
  if (now >= END - 3600e3) return [true, 'after the cutoff the live flow asks nothing; the deterministic arm "late" covers the timing'];
  const home = newHome();
  const f = fixture('fixture-b-high-risk.json');
  const pf = writeProposal(home, f.proposal);
  scenario({ probs: { proceed: 0.9, escalate: 0.05, block: 0.05 } });
  const s = shadow(dir, home, pf, { JEV_SHADOW_NOW: iso(now - 60e3) });
  const rows = latest(home);
  const beforeSynth = rows.length === 1 && rows[0].proposal_sha256 === sha(f.proposal) && rows[0].outcome === null && councilLogs(home).length === 0;
  const { v } = synth(dir, home, f, pf);
  const resolved = run(dir, 'jev-journal.mjs', ['resolve-council'], home);
  const r = latest(home)[0] || {};
  const ok = s.status === 0 && beforeSynth && v && Date.parse(rows[0].asked_at) < Date.parse(v.timestamp)
    && resolved.status === 0 && !r.voided && r.outcome === v.decision && r.council_log_id === v.log_id;
  return [ok, `row before synth=${beforeSynth}, asked ${rows[0]?.asked_at} < verdict ${v?.timestamp}, resolved outcome=${r.outcome} (${r.council_log_id === v?.log_id ? 'same log' : 'OTHER log'}), voided=${r.voided ?? false}`];
};

// A row asked AT or AFTER the verdict's timestamp is VOIDED; one asked before resolves.
ARMS.late = (dir) => {
  const home = newHome();
  const T = '2026-10-01T12:00:00.000Z';
  const pAt = 'Rename a local scratch file in the council test home (at).';
  const pAfter = 'Rename a local scratch file in the council test home (after).';
  const pBefore = 'Rename a local scratch file in the council test home (before).';
  handLog(home, pAt, 'proceed', T); handLog(home, pAfter, 'proceed', T); handLog(home, pBefore, 'proceed', T);
  scenario();
  shadow(dir, home, writeProposal(home, pAt, 'at.txt'), { JEV_SHADOW_NOW: T });
  shadow(dir, home, writeProposal(home, pAfter, 'after.txt'), { JEV_SHADOW_NOW: '2026-10-01T12:03:00.000Z' });
  shadow(dir, home, writeProposal(home, pBefore, 'before.txt'), { JEV_SHADOW_NOW: '2026-10-01T11:58:00.000Z' });
  run(dir, 'jev-journal.mjs', ['resolve-council'], home);
  const by = Object.fromEntries(latest(home).map((r) => [r.proposal_sha256, r]));
  const at = by[sha(pAt)] || {}, after = by[sha(pAfter)] || {}, before = by[sha(pBefore)] || {};
  const ok = at.voided === 'asked-after-verdict' && at.outcome === null
    && after.voided === 'asked-after-verdict' && after.outcome === null
    && !before.voided && before.outcome === 'proceed';
  return [ok, `asked at verdict → ${at.voided || 'outcome=' + at.outcome}; asked 3 min after → ${after.voided || 'outcome=' + after.outcome}; asked 2 min before → ${before.voided || 'outcome=' + before.outcome}`];
};

// The verdict is identical whatever Jev says — even max-confidence for the opposite verdict.
ARMS.verdict = (dir) => {
  const cases = [['fixture-a-low-risk.json', 'proceed', { proceed: 0.0, escalate: 0.0, block: 1.0 }],
    ['fixture-b-high-risk.json', 'escalate-to-human', { proceed: 1.0, escalate: 0.0, block: 0.0 }],
    ['fixture-c-compliance-violation.json', 'block', { proceed: 1.0, escalate: 0.0, block: 0.0 }]];
  const det = [];
  let ok = true;
  const norm = (v) => { if (!v) return null; const { log_id, timestamp, ...rest } = v; return JSON.stringify(rest); };
  for (const [name, expected, probs] of cases) {
    const f = fixture(name);
    const hA = newHome(); const a = synth(dir, hA, f, writeProposal(hA, f.proposal));
    const hB = newHome(); const pf = writeProposal(hB, f.proposal);
    scenario({ probs });
    const s = shadow(dir, hB, pf, { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z' });
    const jevSaid = (latest(hB)[0] || {}).choice;
    const b = synth(dir, hB, f, pf);
    const same = norm(a.v) !== null && norm(a.v) === norm(b.v) && b.v.decision === expected && s.status === 0 && jevSaid && jevSaid !== expected;
    if (!same) ok = false;
    det.push(`${name.slice(8, 9)}: jev=${jevSaid} verdict=${b.v?.decision} expected=${expected} identical=${norm(a.v) === norm(b.v)}`);
  }
  return [ok, det.join('; ')];
};

// Hard stop: from 2026-10-26T22:00Z (= 10-27 00:00 Europe/Chisinau) nothing is asked or written.
ARMS.cutoff = (dir) => {
  const home = newHome();
  const pf = writeProposal(home, 'Append one line to a local scratch log in the test home.');
  scenario();
  const c0 = jevCalls();
  const after = shadow(dir, home, pf, { JEV_SHADOW_NOW: '2026-10-26T22:00:00.000Z' });
  const late = shadow(dir, home, pf, { JEV_SHADOW_NOW: '2026-11-15T09:00:00.000Z' });
  const callsAfter = jevCalls() - c0;
  const rowsAfter = journalRows(home).length;
  const edge = shadow(dir, home, pf, { JEV_SHADOW_NOW: '2026-10-26T21:59:59.000Z' });
  const ok = after.status === 0 && late.status === 0 && callsAfter === 0 && rowsAfter === 0
    && edge.status === 0 && jevCalls() - c0 === 1 && journalRows(home).length === 1;
  return [ok, `at 22:00Z and on 11-15: exit ${after.status}/${late.status}, ${callsAfter} calls, ${rowsAfter} rows; at 21:59:59Z: ${jevCalls() - c0 - callsAfter} call, ${journalRows(home).length} row`];
};

// 402 / 429 / timeout / malformed → exit 0, one error row, no probabilities.
ARMS.failures = (dir) => {
  const det = [];
  let ok = true;
  for (const [name, scen, env] of [['402', { status: 402 }, {}], ['429', { status: 429 }, {}],
    ['timeout', { delayMs: 3000 }, { JEV_SHADOW_TIMEOUT_MS: '400' }], ['malformed', { malformed: true }, {}]]) {
    const home = newHome();
    scenario(scen);
    const r = shadow(dir, home, writeProposal(home, `Local no-op proposal for the ${name} arm.`), { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z', ...env });
    const rows = latest(home);
    const good = r.status === 0 && rows.length === 1 && typeof rows[0].error === 'string' && !('probabilities' in rows[0]);
    if (!good) ok = false;
    det.push(`${name}: exit ${r.status}, error row "${(rows[0] || {}).error}"`);
  }
  return [ok, det.join('; ')];
};

// What must NOT be sent or asked.
ARMS.guards = (dir) => {
  const det = [];
  const home = newHome();
  scenario();
  const c0 = jevCalls();
  const secret = shadow(dir, home, writeProposal(home, `Rotate the token ${'ghp_' + 'A'.repeat(36)} tonight.`), { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z' });
  det.push(`secret-shaped proposal: exit ${secret.status}, calls ${jevCalls() - c0}`);
  const empty = shadow(dir, home, writeProposal(home, '   \n', 'empty.txt'), { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z' });
  const loose = join(TMP, 'loosekey'); writeFileSync(loose, STUB_KEY); chmodSync(loose, 0o644);
  const lk = shadow(dir, home, writeProposal(home, 'A harmless local proposal.', 'h.txt'), { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z', JEV_SHADOW_KEY_FILE: loose });
  det.push(`group-readable key: ${/group\/world/.test(lk.stderr) ? 'refused' : 'NOT refused'}`);
  // A test-arm override without the loopback endpoint is refused before anything is read.
  const ov = shadow(dir, home, writeProposal(home, 'A harmless local proposal.', 'h2.txt'), { JEV_SHADOW_ENDPOINT: 'https://example.invalid/x', JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z' });
  det.push(`NOW override on a non-loopback endpoint: ${/test-arm override; refused/.test(ov.stderr) ? 'refused' : 'NOT refused'}`);
  const calls = jevCalls() - c0;
  const ok = [secret, empty, lk, ov].every((r) => r.status === 0) && calls === 0 && journalRows(home).length === 0
    && /group\/world/.test(lk.stderr) && /test-arm override; refused/.test(ov.stderr);
  return [ok, det.join('; ') + `; total Jev calls ${calls}, journal rows ${journalRows(home).length}`];
};

// The question is about the council, never a person; the request shape is what the design says.
ARMS.request = async (dir) => {
  const m = await import(pathToFileURL(join(dir, 'scripts', 'jev-shadow.mjs')).href);
  let refused = false;
  try { m.guardQuestions({ q: { instructions: 'Will Alexandru agree?' } }); } catch { refused = true; }
  const req = stubRows().filter((r) => r.kind === 'jev');
  const last = req[req.length - 1] || {};
  const ok = m.guardQuestions() === true && refused
    && JSON.stringify(last.question_keys) === '["council_verdict"]' && JSON.stringify(last.state_keys) === '["proposal","council"]'
    && JSON.stringify(last.criteria) === '["proceed","escalate","block"]' && last.model === 'typesafe/jev-1.13'
    && req.every((r) => r.auth_ok && !r.body_has_key && !r.argv_leak && !r.env_leak);
  return [ok, `constants pass the guard, a person question is refused=${refused}; ${req.length} requests: auth ok, key in body/argv/env: ${req.some((r) => r.body_has_key)}/${req.some((r) => r.argv_leak)}/${req.some((r) => r.env_leak)}; state keys ${JSON.stringify(last.state_keys)}`];
};

// Scoring on synthetic sets.
ARMS.scoring = async (dir) => {
  const { raportConsiliu } = await import(pathToFileURL(join(dir, 'scripts', 'jev-journal.mjs')).href);
  // 25 resolved rows: 18 escalate, 4 block, 3 proceed; keywords hit on 15 of them.
  const outs = [...Array(18).fill('escalate-to-human'), ...Array(4).fill('block'), ...Array(3).fill('proceed')];
  const hit = (i) => i % 5 !== 0;
  const mk = (probs) => outs.map((o, i) => ({ kind: 'council', log_id: `jev-council/${String(i).padStart(12, '0')}/x`, keyword_hit: hit(i), outcome: o, probabilities: probs(o, i) }));
  const oneHot = (o) => Object.fromEntries(['proceed', 'escalate-to-human', 'block'].map((k) => [k, k === o ? 1 : 0]));
  const rates = (rows) => Object.fromEntries(['proceed', 'escalate-to-human', 'block'].map((k) => [k, rows.filter((o) => o === k).length / rows.length]));
  const base = rates(outs);
  const byHit = { true: rates(outs.filter((_, i) => hit(i))), false: rates(outs.filter((_, i) => !hit(i))) };
  const perfect = raportConsiliu(mk((o) => oneHot(o)));
  const parrot = raportConsiliu(mk(() => base));
  const kwOnly = raportConsiliu(mk((o, i) => byHit[hit(i)]));
  const thin = raportConsiliu(mk((o) => oneHot(o)).slice(0, 19));
  const cls = Object.fromEntries(perfect.clase.map((c) => [c.k, c.judecata]));
  const ok = perfect.verde && perfect.bssBaza === 1 && perfect.bssCuv === 1
    && !parrot.verde && Math.abs(parrot.bssBaza) < 1e-9
    && !kwOnly.verde && Math.abs(kwOnly.bssCuv) < 1e-9 && kwOnly.bssBaza > 0
    && !thin.verde && !thin.destul
    && cls['escalate-to-human'] === true && cls.proceed === false && cls.block === false;
  return [ok, `perfect: BSS ${perfect.bssBaza}/${perfect.bssCuv} green=${perfect.verde}; parrot: BSS vs base ${parrot.bssBaza.toExponential(1)} green=${parrot.verde}; keyword-only: BSS vs keyword parrot ${kwOnly.bssCuv.toExponential(1)} (vs base +${kwOnly.bssBaza.toFixed(3)}) green=${kwOnly.verde}; n=19 perfect green=${thin.verde}; judged classes: escalate=${cls['escalate-to-human']} proceed=${cls.proceed} block=${cls.block}`];
};

// The CLI report says NEJUDECAT under the floor, never green, and never scores smoke rows.
ARMS.report = (dir) => {
  const home = newHome();
  scenario({ probs: { proceed: 0.2, escalate: 0.7, block: 0.1 } });
  const p = 'A smoke proposal that is never scored.';
  shadow(dir, home, writeProposal(home, p), { JEV_SHADOW_NOW: '2026-10-01T00:00:00.000Z' }, ['--smoke']);
  const smoke = latest(home)[0] || {};
  handLog(home, p, 'escalate-to-human', '2026-10-01T00:05:00.000Z');
  run(dir, 'jev-journal.mjs', ['resolve-council'], home);
  const r = run(dir, 'jev-journal.mjs', ['report'], home);
  const ok = r.status === 0 && smoke.smoke === true && latest(home)[0].outcome === null
    && /smoke \(niciodată scorate\): 1/.test(r.stdout) && /VERDICT CONSILIU: NEJUDECAT: n insuficient/.test(r.stdout) && !/BATE PAPAGALII/.test(r.stdout);
  return [ok, `smoke row marked=${smoke.smoke === true}, left unresolved=${latest(home)[0]?.outcome === null}; ${(/VERDICT CONSILIU:.*/.exec(r.stdout) || [''])[0]}`];
};

// ── negative arms: mutate a copy, the matching arm must FAIL ─────────────────
const MUTATIONS = {
  a: { arm: 'verdict', file: 'synthesize.mjs', from: '  const logId = generateLogId();',
    to: "  try { const j = readFileSync(join(homedir(), '.claude', 'index', 'council', 'jev-journal.jsonl'), 'utf8').trim().split('\\n').map((l) => JSON.parse(l)).filter((r) => r.choice).pop(); if (j) decision = j.choice; } catch { /* none */ }\n  const logId = generateLogId();" },
  b: { arm: 'cutoff', file: 'jev-shadow.mjs', from: 'if (cfg.now >= EXPERIMENT_END)', to: 'if (false)' },
  c: { arm: 'late', file: 'jev-journal.mjs', from: 'if (asked >= Date.parse(tinta.timestamp))', to: 'if (false)' },
};
function mutant(key) {
  const m = MUTATIONS[key];
  const dir = join(TMP, `mutant-${key}`);
  cpSync(COUNCIL, dir, { recursive: true });
  const p = join(dir, 'scripts', m.file);
  const src = readFileSync(p, 'utf8');
  if (src.split(m.from).length !== 2) return null;
  writeFileSync(p, src.replace(m.from, m.to));
  return dir;
}

// ── run ──────────────────────────────────────────────────────────────────────
let bad = 0, n = 0;
const say = (ok, name, det) => { n++; if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${det ? ' — ' + det : ''}`); };

console.log('jev-shadow — closing check (no network; stub on 127.0.0.1)');
for (const [name, fn] of Object.entries(ARMS)) {
  let r;
  try { r = await fn(COUNCIL); } catch (e) { r = [false, `threw: ${e.message}`]; }
  say(r[0], name, r[1]);
}

console.log('negative arms (a mutated copy; the arm must FAIL):');
for (const [key, m] of Object.entries(MUTATIONS)) {
  const dir = mutant(key);
  if (!dir) { say(false, `(${key}) ${m.file}: mutation did not apply`, 'the line moved; this negative arm would test nothing'); continue; }
  let r;
  try { r = await ARMS[m.arm](dir); } catch (e) { r = [false, `threw: ${e.message}`]; }
  say(r[0] === false, `(${key}) ${m.file} mutated → arm "${m.arm}" FAILS`, r[1]);
}

// The key: absent from every output, journal and council log the tests produced.
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!/^mutant-/.test(e.name)) walk(p); } else if (p !== KEYFILE && !p.endsWith('loosekey') && p !== SCEN) files.push(p); } };
walk(TMP);
const inFiles = files.filter((p) => readFileSync(p, 'latin1').includes(STUB_KEY));
const inOut = OUTPUTS.filter((o) => o.includes(STUB_KEY)).length;
// The scanner can fire: the scenario file legitimately holds the key, and it must be found there.
const canFire = readFileSync(SCEN, 'latin1').includes(STUB_KEY) && [SCEN].filter((q) => readFileSync(q, 'latin1').includes(STUB_KEY)).length === 1;
say(canFire && inFiles.length === 0 && inOut === 0, 'the stub key appears in no output, journal, log or stub record', `${OUTPUTS.length} outputs, ${files.length} files scanned; hits: ${inOut} outputs, ${inFiles.length} files; scanner finds it in the scenario file: ${canFire}`);

const after = { n: realCount(), j: realPrint() };
say(after.n === REAL_BEFORE.n && after.j === REAL_BEFORE.j, 'the real index/council is unchanged', `${REAL_DIR}: ${REAL_BEFORE.n} → ${after.n} entries; journal ${REAL_BEFORE.j} → ${after.j}`);

console.log(bad ? `jev-shadow.test: ${bad} of ${n} FAILED` : `jev-shadow.test: ${n} checks, 0 failed`);
process.exit(bad ? 1 : 0);
