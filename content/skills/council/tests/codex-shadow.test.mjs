#!/usr/bin/env node
// codex-shadow.test.mjs — the closing check for Codex as the council's fourth
// seat (a forecaster: non-voting, measurement only). No network, no model:
// `codex` is a local stub (codex-shadow.stub.mjs) first on PATH.
//
//   node tests/codex-shadow.test.mjs        → exit 0 only if every arm passes
//
// Every run uses HOME=<temp dir>; the real ~/.claude/index/council is only
// COUNTED (and the real journals fingerprinted) before and after.
//
// NEGATIVE ARMS: the whole council dir is copied to a temp dir and ONE line is
// mutated; the matching arm is run against the copy and MUST FAIL. A mutation
// that does not apply (the line moved) is a failure too: a negative arm that
// silently tests nothing is the defect this file exists to prevent.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNCIL = join(HERE, '..');

// ── the real substrate: counted and fingerprinted, never written ─────────────
const REAL_DIR = join(homedir(), '.claude', 'index', 'council');
const print = (p) => { try { const s = statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return 'absent'; } };
const realState = () => ({ n: existsSync(REAL_DIR) ? readdirSync(REAL_DIR).length : 0, jev: print(join(REAL_DIR, 'jev-journal.jsonl')), codex: print(join(REAL_DIR, 'codex-journal.jsonl')) });
const REAL_BEFORE = realState();

const TMP = mkdtempSync(join(tmpdir(), 'codex-shadow-test-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
let seq = 0;
const newHome = () => { const h = join(TMP, 'h' + (++seq)); mkdirSync(join(h, '.claude', 'index', 'council'), { recursive: true }); return h; };

// ── the stub: a `codex` on PATH ──────────────────────────────────────────────
const BIN = join(TMP, 'bin');
mkdirSync(BIN);
writeFileSync(join(BIN, 'codex'), `#!${process.execPath}\n` + readFileSync(join(HERE, 'codex-shadow.stub.mjs'), 'utf8'));
chmodSync(join(BIN, 'codex'), 0o755);
const NOBIN = join(TMP, 'nobin'); mkdirSync(NOBIN); // a PATH with no codex at all
const SCEN = join(TMP, 'scenario.json');
const STUBLOG = join(TMP, 'stub.jsonl');
writeFileSync(STUBLOG, '');
const scenario = (s = {}) => writeFileSync(SCEN, JSON.stringify(s));
scenario();
const stubRows = () => readFileSync(STUBLOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const calls = () => stubRows().length;
const lastCall = () => stubRows().pop() || {};

const EXITS = [];
function run(dir, script, args, home, env = {}) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: `${BIN}:${dirname(process.execPath)}`, HOME: home, TMPDIR: tmpdir(), CODEX_STUB_SCEN: SCEN, CODEX_STUB_LOG: STUBLOG, ...env },
  });
  if (script === 'codex-shadow.mjs') EXITS.push(r.status);
  return r;
}
const NOW = { CODEX_SHADOW_NOW: '2026-10-01T00:00:00.000Z' };
const shadow = (dir, home, pf, env = NOW, extra = []) => run(dir, 'codex-shadow.mjs', ['--proposal-file', pf, ...extra], home, env);
const JOURNAL = (home) => join(home, '.claude', 'index', 'council', 'codex-journal.jsonl');
const journalRows = (home) => (existsSync(JOURNAL(home)) ? readFileSync(JOURNAL(home), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const latest = (home) => { const m = new Map(); for (const r of journalRows(home)) m.set(r.log_id, r); return [...m.values()].filter((r) => r.kind === 'council'); };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
function writeProposal(home, text, name = 'proposal.txt') { const p = join(home, name); writeFileSync(p, text); return p; }
function fixture(name) { return JSON.parse(readFileSync(join(HERE, name), 'utf8')); }
function synth(dir, home, f, pf) {
  const w = (k, o) => { const p = join(home, `${k}.json`); writeFileSync(p, JSON.stringify(o)); return p; };
  const r = run(dir, 'synthesize.mjs', ['--proposal-file', pf, '--opportunity-file', w('opp', { opportunity: f.opportunity }),
    '--risk-file', w('risk', { risk: f.risk }), '--compliance-file', w('cmp', { compliance: f.compliance, tripwires_fired: f.tripwires_fired })], home);
  let v = null; try { v = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { r, v };
}
function handLog(home, proposal, decision, timestamp) {
  const id = `council-${timestamp.replace(/[-:.]/g, '').slice(0, 15)}Z-${sha(proposal + timestamp).slice(0, 6)}`;
  writeFileSync(join(home, '.claude', 'index', 'council', `${id}.json`), JSON.stringify({ proposal, decision, log_id: id, timestamp, tripwires_fired: [] }));
  return id;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const ARMS = {};

// A good answer → one scorable row; the call is the one the brief names.
ARMS.good = (dir) => {
  const home = newHome();
  scenario({ probs: { proceed: 0.2, escalate: 0.7, block: 0.1 } });
  const p = 'Append the current UTC timestamp to a local heartbeat log.';
  const c0 = calls();
  const r = shadow(dir, home, writeProposal(home, p));
  const rows = latest(home);
  const row = rows[0] || {};
  const c = lastCall();
  const a = c.argv || [];
  const argvOk = a[0] === 'exec' && a.join(' ').includes('-s read-only') && a.includes('--skip-git-repo-check') && a.includes('--json')
    && !a.includes('-m') && !a.includes('--model') && !a.some((x) => /gpt-6\.1-sol/.test(x));
  const ioOk = c.stdin_link === '/dev/null' && c.stdin === '' && c.cwd_entries === 0 && c.cwd && c.cwd.startsWith(tmpdir()) && !existsSync(c.cwd);
  const ok = r.status === 0 && calls() - c0 === 1 && rows.length === 1 && row.source === 'codex' && /^codex-council\//.test(row.log_id)
    && row.proposal_sha256 === sha(p) && row.choice === 'escalate-to-human' && Math.abs(row.probabilities['escalate-to-human'] - 0.7) < 1e-9
    && row.tool_events === 0 && !row.tool_use && row.outcome === null && argvOk && ioOk;
  return [ok, `exit ${r.status}, row ${row.choice} ${JSON.stringify(row.probabilities)}, tool_events ${row.tool_events}; argv ok=${argvOk} (no -m); stdin=${c.stdin_link}, cwd empty=${c.cwd_entries === 0}, cwd removed=${c.cwd && !existsSync(c.cwd)}`];
};

// Alexandru 16:17: no model names, no trailers, reach Codex. Count recorded, text never.
ARMS.anon = (dir) => {
  const home = newHome();
  scenario();
  const p = 'Rename the local scratch file drafted by Claude Opus 5.5 in the test home.\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@example.invalid>\n';
  shadow(dir, home, writeProposal(home, p));
  const c = lastCall();
  const sent = (c.argv || []).join('\n') + '\n' + (c.stdin || '');
  const banned = ['Claude Opus 5.5', 'Co-Authored-By', 'Claude', 'Opus', 'Anthropic', 'Sancta', 'Sonnet', 'another model'];
  const found = banned.filter((b) => sent.toLowerCase().includes(b.toLowerCase()));
  const row = latest(home)[0] || {};
  const raw = readFileSync(JOURNAL(home), 'utf8');
  const ok = found.length === 0 && sent.includes('[model]') && sent.includes('three-member review panel')
    && row.anonymized === true && row.anonymized_replacements >= 2 && !/Opus|Co-Authored/i.test(raw) && row.proposal_sha256 === sha(p);
  return [ok, `banned words in what the stub received: ${found.length ? found.join(', ') : 'none'}; [model] present=${sent.includes('[model]')}; row anonymized=${row.anonymized}, replacements=${row.anonymized_replacements}; journal holds removed text=${/Opus|Co-Authored/i.test(raw)}`];
};

// A security-shaped proposal is NOT sent; the row carries no text, no probabilities.
ARMS.security = (dir) => {
  const det = [];
  let ok = true;
  const sec = ['Open port 8443 on the firewall so the dashboard is reachable from the internet.',
    'Patch the injection vulnerability (CVE-2026-1234) in the webhook parser before the exploit spreads.',
    'Rotate the OpenRouter API key and update the agenix secret.',
    `Store ${'ghp_' + 'A'.repeat(36)} in the notes file.`];
  for (const t of sec) {
    const home = newHome();
    scenario();
    const c0 = calls();
    const r = shadow(dir, home, writeProposal(home, t));
    const rows = latest(home);
    const raw = journalRows(home).map((x) => JSON.stringify(x)).join('\n');
    const good = r.status === 0 && calls() - c0 === 0 && rows.length === 1 && rows[0].skipped === 'security'
      && !('probabilities' in rows[0]) && !('choice' in rows[0]) && !('keyword_classes' in rows[0]) && !raw.includes(t.slice(0, 20));
    if (!good) ok = false;
    det.push(`"${t.slice(0, 24)}…": ${calls() - c0} calls, row ${rows[0] ? 'skipped:' + rows[0].skipped : 'none'}`);
  }
  return [ok, det.join('; ')];
};

// A tool event in the stream → tool_use:true, no probabilities, never resolved or scored.
ARMS.tool = (dir) => {
  const home = newHome();
  scenario({ mode: 'tool' });
  const p = 'Rename a local scratch file in the council test home (tool arm).';
  const r = shadow(dir, home, writeProposal(home, p), { CODEX_SHADOW_NOW: '2026-10-01T11:58:00.000Z' });
  const row = latest(home)[0] || {};
  handLog(home, p, 'proceed', '2026-10-01T12:00:00.000Z');
  const res = run(dir, 'jev-journal.mjs', ['resolve-council', '--source', 'codex'], home);
  const after = latest(home)[0] || {};
  const rep = run(dir, 'jev-journal.mjs', ['report', '--source', 'codex'], home);
  const ok = r.status === 0 && row.tool_use === true && row.tool_events === 1 && JSON.stringify(row.tool_kinds) === '["command_execution"]'
    && !('probabilities' in row) && !('choice' in row) && res.status === 0 && after.outcome === null
    && /tool_use \(niciodată scorate\): 1/.test(rep.stdout) && /rezolvate: 0 · în așteptare: 0/.test(rep.stdout);
  return [ok, `row tool_use=${row.tool_use}, tool_events=${row.tool_events}, kinds=${JSON.stringify(row.tool_kinds)}, probabilities=${'probabilities' in row}; after resolve outcome=${after.outcome}; report: ${(/rezolvate: .*/.exec(rep.stdout) || [''])[0]}`];
};

// A hang → the process group is killed, one error row, exit 0.
ARMS.timeout = (dir) => {
  const home = newHome();
  scenario({ mode: 'sleep', sleepMs: 8000 });
  const t0 = Date.now();
  const r = shadow(dir, home, writeProposal(home, 'A harmless local proposal for the timeout arm.'), { ...NOW, CODEX_SHADOW_TIMEOUT_MS: '600' });
  const ms = Date.now() - t0;
  const row = latest(home)[0] || {};
  const pid = lastCall().pid;
  const ok = r.status === 0 && /timeout/.test(row.error || '') && !('probabilities' in row) && ms < 6000 && !alive(pid);
  return [ok, `exit ${r.status} in ${ms} ms, error "${row.error}", stub pid alive after=${alive(pid)}`];
};

// Garbage / prose / wrong shape / rate limit / exit 1 / codex missing → error rows, exit 0.
ARMS.garbage = (dir) => {
  const det = [];
  let ok = true;
  for (const [mode, want, env] of [['garbage', /no answer/, {}], ['prose', /not JSON/, {}], ['shape', /malformed/, {}],
    ['ratelimit', /rate limited/, {}], ['exit1', /exited 1/, {}], ['missing', /not found on PATH/, { PATH: `${NOBIN}:${dirname(process.execPath)}` }]]) {
    const home = newHome();
    scenario({ mode });
    const r = shadow(dir, home, writeProposal(home, `Local no-op proposal for the ${mode} arm.`), mode === 'missing' ? env : { ...NOW, ...env });
    const rows = latest(home);
    // 'missing' runs on the real clock (no override without the stub): after the stop it must leave nothing.
    const good = (mode === 'missing' && Date.now() >= Date.parse('2026-12-28T22:00:00Z')) ? r.status === 0 && rows.length === 0
      : r.status === 0 && rows.length === 1 && want.test(rows[0].error || '') && !('probabilities' in rows[0]);
    if (!good) ok = false;
    det.push(`${mode}: exit ${r.status}, "${(rows[0] || {}).error}"`);
  }
  return [ok, det.join('; ')];
};

// Hard stop: from 2026-12-28T22:00Z (= 12-29 00:00 Europe/Chisinau) no call, no row.
ARMS.cutoff = (dir) => {
  const home = newHome();
  const pf = writeProposal(home, 'Append one line to a local scratch log in the test home.');
  scenario();
  const c0 = calls();
  const at = shadow(dir, home, pf, { CODEX_SHADOW_NOW: '2026-12-28T22:00:00.000Z' });
  const late = shadow(dir, home, pf, { CODEX_SHADOW_NOW: '2027-01-15T09:00:00.000Z' });
  const callsAfter = calls() - c0, rowsAfter = journalRows(home).length;
  const edge = shadow(dir, home, pf, { CODEX_SHADOW_NOW: '2026-12-28T21:59:59.000Z' });
  const ok = at.status === 0 && late.status === 0 && callsAfter === 0 && rowsAfter === 0 && edge.status === 0 && calls() - c0 === 1 && journalRows(home).length === 1;
  return [ok, `at 22:00Z and on 01-15: exit ${at.status}/${late.status}, ${callsAfter} calls, ${rowsAfter} rows; at 21:59:59Z: ${calls() - c0 - callsAfter} call, ${journalRows(home).length} row`];
};

// Test-arm overrides are refused when codex on PATH is not the temp-dir stub.
ARMS.overrides = (dir) => {
  const home = newHome();
  scenario();
  const other = join(TMP, 'other-tmp'); mkdirSync(other, { recursive: true });
  const c0 = calls();
  const r = shadow(dir, home, writeProposal(home, 'A harmless local proposal.'), { ...NOW, TMPDIR: other });
  const ok = r.status === 0 && /test-arm override; refused/.test(r.stderr) && calls() - c0 === 0 && journalRows(home).length === 0;
  return [ok, `NOW override with a codex outside the temp dir: exit ${r.status}, ${/refused/.test(r.stderr) ? 'refused' : 'NOT refused'}, calls ${calls() - c0}`];
};

// Exit is 0 on every path this file drove (and on an unreadable / missing proposal file).
ARMS.exit0 = (dir) => {
  const home = newHome();
  const a = shadow(dir, home, join(home, 'does-not-exist.txt'));
  const b = run(dir, 'codex-shadow.mjs', [], home, NOW);
  scenario({ mode: 'exit1' });
  const c = shadow(dir, home, writeProposal(home, 'Local no-op proposal for the exit arm.'));
  const bad = EXITS.filter((s) => s !== 0).length;
  const ok = a.status === 0 && b.status === 0 && c.status === 0 && bad === 0;
  return [ok, `missing file ${a.status}, no args ${b.status}, codex exit 1 → ${c.status}; ${EXITS.length} runs so far, non-zero: ${bad}`];
};

// Resolution and report run on Codex's own journal; Jev's journal is not touched,
// and a Jev row for the SAME proposal resolves to the same council log (no stealing).
ARMS.resolve = (dir) => {
  const home = newHome();
  const p = 'Rename a local scratch file in the council test home (resolve arm).';
  scenario({ probs: { proceed: 0.8, escalate: 0.1, block: 0.1 } });
  shadow(dir, home, writeProposal(home, p), { CODEX_SHADOW_NOW: '2026-10-01T11:58:00.000Z' });
  const jevRow = { ts: '2026-10-01T11:58:00.000Z', kind: 'council', log_id: `jev-council/${sha(p).slice(0, 12)}/20261001T115800000Z`, proposal_sha256: sha(p), asked_at: '2026-10-01T11:58:00.000Z', keyword_hit: false, keyword_classes: [], choice: 'proceed', probabilities: { proceed: 0.8, 'escalate-to-human': 0.1, block: 0.1 }, confidence: 0.7, outcome: null };
  writeFileSync(join(home, '.claude', 'index', 'council', 'jev-journal.jsonl'), JSON.stringify(jevRow) + '\n');
  const id = handLog(home, p, 'proceed', '2026-10-01T12:00:00.000Z');
  const rc = run(dir, 'jev-journal.mjs', ['resolve-council', '--source', 'codex'], home);
  const rj = run(dir, 'jev-journal.mjs', ['resolve-council'], home);
  const c = latest(home)[0] || {};
  const jl = readFileSync(join(home, '.claude', 'index', 'council', 'jev-journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  const rep = run(dir, 'jev-journal.mjs', ['report', '--source', 'codex'], home);
  const badSrc = run(dir, 'jev-journal.mjs', ['report', '--source', 'gpt'], home);
  const ok = rc.status === 0 && rj.status === 0 && c.outcome === 'proceed' && c.council_log_id === id && jl.outcome === 'proceed' && jl.council_log_id === id
    && rep.status === 0 && /Codex ghicește/.test(rep.stdout) && /NEJUDECAT: n insuficient \(1 < 30/.test(rep.stdout) && !/calibrare & creep/.test(rep.stdout)
    && badSrc.status === 2;
  return [ok, `codex row → ${c.outcome} (${c.council_log_id === id ? 'the log' : 'OTHER'}), jev row → ${jl.outcome} (${jl.council_log_id === id ? 'same log' : 'OTHER'}); ${(/VERDICT CONSILIU:.*/.exec(rep.stdout) || [''])[0]}; --source gpt → exit ${badSrc.status}`];
};

// Scoring: the same two parrots; NEJUDECAT until 30 resolved rows.
ARMS.scoring = async (dir) => {
  const { raportConsiliu, PROFIL } = await import(pathToFileURL(join(dir, 'scripts', 'jev-journal.mjs')).href);
  const outs = [...Array(22).fill('escalate-to-human'), ...Array(5).fill('block'), ...Array(3).fill('proceed')];
  const hit = (i) => i % 5 !== 0;
  const K = ['proceed', 'escalate-to-human', 'block'];
  const mk = (probs) => outs.map((o, i) => ({ kind: 'council', source: 'codex', log_id: `codex-council/${String(i).padStart(12, '0')}/x`, keyword_hit: hit(i), outcome: o, probabilities: probs(o, i) }));
  const oneHot = (o) => Object.fromEntries(K.map((k) => [k, k === o ? 1 : 0]));
  const rates = (rows) => Object.fromEntries(K.map((k) => [k, rows.filter((o) => o === k).length / rows.length]));
  const base = rates(outs);
  const prag = PROFIL.codex.prag;
  const perfect = raportConsiliu(mk(oneHot), prag);
  const parrot = raportConsiliu(mk(() => base), prag);
  const thin = raportConsiliu(mk(oneHot).slice(0, 29), prag);
  const tooled = raportConsiliu(mk(oneHot).map((r, i) => (i === 0 ? { ...r, tool_use: true } : r)), prag);
  const ok = prag === 30 && perfect.verde && !parrot.verde && Math.abs(parrot.bssBaza) < 1e-9 && !thin.destul && !thin.verde && tooled.n === 29 && !tooled.verde;
  return [ok, `gate ${prag}; 30 perfect green=${perfect.verde}; base-rate parrot BSS ${parrot.bssBaza.toExponential(1)} green=${parrot.verde}; 29 perfect green=${thin.verde}; one tool_use row among 30 → n=${tooled.n}, green=${tooled.verde}`];
};

// The verdict is identical whatever Codex says.
ARMS.verdict = (dir) => {
  const det = [];
  let ok = true;
  const norm = (v) => { if (!v) return null; const { log_id, timestamp, ...rest } = v; return JSON.stringify(rest); };
  for (const [name, expected, probs] of [['fixture-a-low-risk.json', 'proceed', { proceed: 0, escalate: 0, block: 1 }],
    ['fixture-b-high-risk.json', 'escalate-to-human', { proceed: 1, escalate: 0, block: 0 }]]) {
    const f = fixture(name);
    const hA = newHome(); const a = synth(dir, hA, f, writeProposal(hA, f.proposal));
    const hB = newHome(); const pf = writeProposal(hB, f.proposal);
    scenario({ probs });
    shadow(dir, hB, pf);
    const row = latest(hB)[0] || {};
    const b = synth(dir, hB, f, pf);
    const same = norm(a.v) !== null && norm(a.v) === norm(b.v) && b.v.decision === expected && row.choice && row.choice !== expected;
    if (!same) ok = false;
    det.push(`${name.slice(8, 9)}: codex=${row.choice || row.error || row.skipped} verdict=${b.v?.decision} expected=${expected} identical=${norm(a.v) === norm(b.v)}`);
  }
  return [ok, det.join('; ')];
};

// ── negative arms ────────────────────────────────────────────────────────────
const MUTATIONS = {
  a: { arm: 'verdict', file: 'synthesize.mjs', from: '  const logId = generateLogId();',
    to: "  try { const j = readFileSync(join(homedir(), '.claude', 'index', 'council', 'codex-journal.jsonl'), 'utf8').trim().split('\\n').map((l) => JSON.parse(l)).filter((r) => r.choice).pop(); if (j) decision = j.choice; } catch { /* none */ }\n  const logId = generateLogId();" },
  b: { arm: 'cutoff', file: 'codex-shadow.mjs', from: 'if (cfg.now >= EXPERIMENT_END)', to: 'if (false)' },
  c: { arm: 'tool', file: 'codex-shadow.mjs', from: 'if (ev.tools > 0) {', to: 'if (false) {' },
  d: { arm: 'security', file: 'codex-shadow.mjs', from: 'if (securitySensitive(anon.text)) {', to: 'if (false) {' },
  e: { arm: 'anon', file: 'codex-shadow.mjs', from: 'const anon = anonymize(proposal);', to: 'const anon = { text: proposal, n: 0 };' },
  f: { arm: 'timeout', file: 'codex-shadow.mjs', from: "      timedOut = true;\n      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }", to: '      timedOut = false;' },
  g: { arm: 'garbage', file: 'codex-shadow.mjs', from: "if (!ok) return { why: 'codex answer malformed; no forecast' };", to: '' },
  h: { arm: 'exit0', file: 'codex-shadow.mjs', from: '.finally(() => process.exit(0));', to: '.finally(() => process.exit(1));' },
  i: { arm: 'tool', file: 'jev-journal.mjs', from: '!r.skipped && !r.tool_use && !r.voided && r.outcome == null', to: '!r.skipped && !r.voided && r.outcome == null' },
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

let bad = 0, n = 0;
const say = (ok, name, det) => { n++; if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${det ? ' — ' + det : ''}`); };
const only = process.env.CODEX_TEST_ONLY; // e.g. "tool" to run one arm (for showing a failure by hand)

console.log('codex-shadow — closing check (no network; `codex` is a local stub on PATH)');
for (const [name, fn] of Object.entries(ARMS)) {
  if (only && only !== name) continue;
  let r;
  try { r = await fn(COUNCIL); } catch (e) { r = [false, `threw: ${e.message}`]; }
  say(r[0], name, r[1]);
}
if (!only) {
  console.log('negative arms (a mutated copy; the arm must FAIL):');
  for (const [key, m] of Object.entries(MUTATIONS)) {
    const dir = mutant(key);
    if (!dir) { say(false, `(${key}) ${m.file}: mutation did not apply`, 'the line moved; this negative arm would test nothing'); continue; }
    if (m.arm === 'exit0') EXITS.length = 0;
    let r;
    try { r = await ARMS[m.arm](dir); } catch (e) { r = [false, `threw: ${e.message}`]; }
    say(r[0] === false, `(${key}) ${m.file} mutated → arm "${m.arm}" FAILS`, r[1]);
  }
}
const after = realState();
say(JSON.stringify(after) === JSON.stringify(REAL_BEFORE), 'the real index/council is unchanged', `${REAL_DIR}: ${REAL_BEFORE.n} → ${after.n} entries; jev ${REAL_BEFORE.jev} → ${after.jev}; codex ${REAL_BEFORE.codex} → ${after.codex}`);
console.log(bad ? `codex-shadow.test: ${bad} of ${n} FAILED` : `codex-shadow.test: ${n} checks, 0 failed`);
process.exit(bad ? 1 : 0);
