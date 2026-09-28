#!/usr/bin/env node
/**
 * shadow-report.mjs — sq093 Step B: how does the cheap-tier shadow compare to the
 * full council? READ-ONLY: it opens council log files for reading and writes nothing.
 *
 * Usage:
 *   shadow-report.mjs [--dir <council log dir>] [--today YYYY-MM-DD] [--json]
 *   default dir: ~/.claude/index/council
 *
 * Counted records: text-bearing (a real proposal, not proposal_missing), not a test
 * fixture (proposal equal to a tests/fixture-*.json proposal), path full (a record
 * with no `path` field is a full-council record; any other `path` is excluded), and
 * carrying a `shadow` object. A `shadow.error` record is counted separately and is
 * NOT part of n.
 *
 * Reported:
 *   n          valid shadow records (distinct by proposal text: the latest wins)
 *   agreement  shadow.decision === decision
 *   looser     shadow proceeds where the full council did NOT proceed  (must stay 0)
 *   stricter   shadow did not proceed where the full council proceeded
 *   fast-eligible  distinct cases where the shadow proceeded (the fast path's only
 *              own output, design §3)
 *
 * Gate (design §6.3, as resolved 2026-09-28 with bobuk's suggestion): the shadow run
 * is judged when 2 weeks have passed since the first shadow record AND 30 distinct
 * fast-eligible cases exist, OR on the revisit date 2026-12-28, whichever comes
 * first. At the revisit the report states n and the decision goes to Alexandru.
 * Below 30 it says "insufficient n", whatever the agreement looks like.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const GATE_MIN_FAST_ELIGIBLE = 30;
const GATE_MIN_DAYS = 14;
const REVISIT_DATE = '2026-12-28';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, '..', 'tests');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[k.slice(2)] = true; }
    else { args[k.slice(2)] = next; i++; }
  }
  return args;
}

function fixtureProposals() {
  const set = new Set();
  if (!existsSync(TESTS_DIR)) return set;
  for (const f of readdirSync(TESTS_DIR)) {
    if (!/^fixture-.*\.json$/.test(f)) continue;
    try {
      const p = JSON.parse(readFileSync(join(TESTS_DIR, f), 'utf8'))?.proposal;
      if (typeof p === 'string') set.add(p.trim());
    } catch { /* an unreadable fixture just is not filtered */ }
  }
  return set;
}

const RANK = { 'proceed': 0, 'escalate-to-human': 1, 'block': 2 };

function report(dir, today) {
  const fixtures = fixtureProposals();
  const out = {
    dir, files: 0, unreadable: 0, with_shadow: 0,
    excluded: { text_less: 0, fixture: 0, not_full_path: 0 },
    shadow_errors: 0, invalid_decision: 0,
    n: 0, agree: 0, looser: 0, stricter: 0, other_disagree: 0,
    fast_eligible: 0, latency_ms: [], first_shadow: null,
  };
  if (!existsSync(dir)) { out.missing_dir = true; return finish(out, today); }

  const byProposal = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    out.files++;
    let rec;
    try { rec = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
    catch { out.unreadable++; continue; }
    if (rec === null || typeof rec !== 'object' || !('shadow' in rec)) continue;
    out.with_shadow++;

    const prop = typeof rec.proposal === 'string' ? rec.proposal.trim() : '';
    if (rec.proposal_missing === true || prop === '' || prop === '(proposal not provided)') { out.excluded.text_less++; continue; }
    if (fixtures.has(prop)) { out.excluded.fixture++; continue; }
    if (rec.path !== undefined && rec.path !== 'full') { out.excluded.not_full_path++; continue; }

    const s = rec.shadow;
    if (!s || typeof s !== 'object' || 'error' in s) { out.shadow_errors++; continue; }
    if (!(s.decision in RANK) || !(rec.decision in RANK)) { out.invalid_decision++; continue; }

    const prev = byProposal.get(prop);
    if (!prev || String(rec.timestamp) > String(prev.timestamp)) byProposal.set(prop, rec);
  }

  for (const rec of byProposal.values()) {
    const full = rec.decision, sh = rec.shadow.decision;
    out.n++;
    if (!out.first_shadow || String(rec.timestamp) < out.first_shadow) out.first_shadow = String(rec.timestamp);
    if (sh === 'proceed') out.fast_eligible++;
    if (sh === full) out.agree++;
    else if (sh === 'proceed') out.looser++;          // full !== proceed here
    else if (full === 'proceed') out.stricter++;
    else out.other_disagree++;                         // escalate vs block, either way
    if (Number.isFinite(rec.shadow.latency_ms)) out.latency_ms.push(rec.shadow.latency_ms);
  }
  return finish(out, today);
}

function p90(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

function finish(out, today) {
  out.latency_p90_ms = p90(out.latency_ms);
  out.latency_samples = out.latency_ms.length;
  delete out.latency_ms;
  const days = out.first_shadow
    ? (Date.parse(today) - Date.parse(out.first_shadow.slice(0, 10))) / 86400000
    : 0;
  out.days_since_first_shadow = Math.max(0, Math.floor(days));
  const enoughN = out.fast_eligible >= GATE_MIN_FAST_ELIGIBLE;
  const enoughTime = out.days_since_first_shadow >= GATE_MIN_DAYS;
  if (enoughN && enoughTime) {
    out.gate = 'gate met (2 weeks AND 30 fast-eligible): judge the shadow run';
  } else if (today >= REVISIT_DATE) {
    out.gate = `revisit date ${REVISIT_DATE} reached with ${out.fast_eligible} fast-eligible cases` +
      `${enoughN ? '' : ' — insufficient n'}; the decision goes to Alexandru`;
  } else {
    const state = `(${out.fast_eligible}/${GATE_MIN_FAST_ELIGIBLE} fast-eligible,` +
      ` ${out.days_since_first_shadow}/${GATE_MIN_DAYS} days); revisit by ${REVISIT_DATE}`;
    out.gate = `${enoughN ? 'insufficient time' : 'insufficient n'} ${state}`;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = typeof args.dir === 'string' ? args.dir : join(homedir(), '.claude', 'index', 'council');
  const today = typeof args.today === 'string' ? args.today : new Date().toISOString().slice(0, 10);
  const r = report(dir, today);
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return; }
  const pct = r.n ? ` (${Math.round(100 * r.agree / r.n)}%)` : '';
  console.log(`council shadow report — ${today}`);
  console.log(`  dir: ${r.dir}${r.missing_dir ? '  (does not exist)' : ''}`);
  console.log(`  files ${r.files}, with shadow ${r.with_shadow}, unreadable ${r.unreadable}`);
  console.log(`  excluded: text-less ${r.excluded.text_less}, fixture ${r.excluded.fixture}, not path full ${r.excluded.not_full_path}`);
  console.log(`  shadow errors ${r.shadow_errors}, invalid decisions ${r.invalid_decision}`);
  console.log(`  n ${r.n} (distinct proposals)`);
  console.log(`  agreement ${r.agree}/${r.n}${pct}`);
  console.log(`  looser   ${r.looser}   (shadow proceed, full did not — must be 0)`);
  console.log(`  stricter ${r.stricter}   (shadow did not proceed, full did)`);
  console.log(`  other disagreements ${r.other_disagree}   (escalate vs block)`);
  console.log(`  fast-eligible ${r.fast_eligible}   (shadow proceed)`);
  console.log(`  latency p90 ${r.latency_p90_ms === null ? 'n/a' : r.latency_p90_ms + ' ms'} over ${r.latency_samples} samples`);
  console.log(`  gate: ${r.gate}`);
}

main();
