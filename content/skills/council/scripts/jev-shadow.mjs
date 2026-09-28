#!/usr/bin/env node
// jev-shadow.mjs — Jev as the council's forecaster (shadow 2). Approved by
// Alexandru 2026-09-28 19:20: «jev design = aprobat. in lucru.»
// Design: index/docs/plans/2026-09-28-jev-council-forecast-design.md
//
// At Step 2b, in the background, beside the Sonnet trio, Jev is asked ONE
// question: what will the FULL council decide on this proposal — proceed,
// escalate-to-human or block — with probabilities. The answer becomes ONE row
// in the Jev journal (kind "council"). `jev-journal.mjs resolve-council` later
// matches it to the council log by sha256(proposal); `report` scores it.
//
//   node scripts/jev-shadow.mjs --proposal-file F [--smoke]
//   node scripts/jev-shadow.mjs --credit      (the key's remaining credit, named fields only)
//
// THE RULES, each enforced here, each with a test arm (tests/jev-shadow.test.mjs):
//   1. JEV NEVER TOUCHES THE VERDICT. This script writes only the journal. It
//      never reads or writes a council log and synthesize.mjs never reads the
//      journal. Exit status is ALWAYS 0: a Jev failure is not a council failure.
//   2. HARD STOP. No ask from 2026-10-27 00:00 Europe/Chisinau (EET, UTC+2 after
//      DST ends on 10-25) = 2026-10-26T22:00Z. Checked before the key is read.
//      No row, no call. Resolution and the report keep working.
//   3. THE KEY. Read from a FILE (default below), sent only in the Authorization
//      header. Never in argv, env, a log line, stdout/stderr or the journal. A
//      missing, empty or group/world-readable key file fails closed: no call.
//   4. NEVER A QUESTION ABOUT ALEXANDRU. The question set and the council
//      description are constants; guardQuestions() refuses person/behaviour
//      words in them. The state is {proposal, council} and nothing else.
//   5. NOTHING SECRET-SHAPED LEAVES. A proposal carrying an API-key/token/
//      private-key pattern, an empty one, or one over 24 KiB is not sent.
//   6. 402 / 429 / timeout / malformed → one `error` row (no probabilities), exit 0.
//
// Env overrides are for the test arm ONLY and are refused unless the endpoint
// is http://127.0.0.1 (the local stub): JEV_SHADOW_ENDPOINT, JEV_SHADOW_CREDIT_URL,
// JEV_SHADOW_NOW, JEV_SHADOW_TIMEOUT_MS. JEV_SHADOW_KEY_FILE is allowed always
// (it only chooses which file to read; the file rules still apply).
'use strict';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { caleJurnal, adaugaConsiliu } from './jev-journal.mjs';

export const MODEL = 'typesafe/jev-1.13';
export const EXPERIMENT_END = Date.parse('2026-10-26T22:00:00Z'); // 2026-10-27 00:00 Europe/Chisinau
const DEFAULT_KEY_FILE = '/run/agenix/jev-openrouter-key';
const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_CREDIT_URL = 'https://openrouter.ai/api/v1/key';
const DEFAULT_TIMEOUT_MS = 45000;
const MAX_PROPOSAL_BYTES = 24 * 1024; // the request cap is 32 KiB; the rest is the question + council text

// Jev's action keys avoid the word the guard refuses; the journal stores the
// council's own verdict names.
export const TO_VERDICT = { proceed: 'proceed', escalate: 'escalate-to-human', block: 'block' };
export const CLASSES = ['proceed', 'escalate-to-human', 'block'];

export const COUNCIL =
  'A deliberative council of three independent assessors judges a proposed action before it is taken. ' +
  'The opportunity assessor argues for its value; the risk assessor assigns a risk tier (low, medium, high) and failure modes; ' +
  'the compliance assessor checks a fixed charter and may veto, and lists any tripwires that fired. ' +
  'The verdict is not voted: a fixed rule computes it. block if compliance vetoes; otherwise escalate if the risk tier is medium or high ' +
  'or any tripwire fired; otherwise proceed. Tripwires: goal-drift, permission-creep, overconfidence, out-of-distribution, self-modification. ' +
  'Gate categories that force escalation: money, software deployment or publishing, physical-world actions, secrets, network exposure, ' +
  'irreversible actions, outward actions visible outside the local system.';

export const QUESTIONS = {
  council_verdict: {
    type: 'choice',
    instructions:
      'The state holds a proposed action (state.proposal) and a description of the council that will judge it (state.council). ' +
      'Using only the state, which verdict will the full council reach on this proposal?',
    criteria: {
      proceed: 'The council lets the action go ahead: compliance allows it, the risk tier is low and no tripwire fires.',
      escalate: 'The council pauses the action and hands the decision upward: risk tier medium or high, or a tripwire or gate category fires, with no veto.',
      block: 'The compliance assessor vetoes the action as a charter violation.',
    },
  },
};

// Rule 4. Words, not intent: a false refusal costs one unasked council.
const FORBIDDEN = /(?<![\p{L}\p{N}])(alexandru|savinov|owner|maintainer|author|wife|soți|sotia|person|human|approv|aprob|review|merg|timing|when will|how long)[\p{L}\p{N}_]*/iu;
export function guardQuestions(questions = QUESTIONS, council = COUNCIL) {
  const texts = [council];
  const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { texts.push(k); walk(x); } };
  walk(questions);
  const bad = texts.find((t) => FORBIDDEN.test(t));
  if (bad) throw new Error(`guard: question text about a person refused: "${bad.slice(0, 60)}"`);
  return true;
}

// Rule 5. Shapes of credentials, not values. A hit means "not sent".
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{16,}/,            // OpenAI/OpenRouter/Anthropic-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,       // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,               // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,     // Slack
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}/,
  /\b[A-Fa-f0-9]{48,}\b/,               // long bare hex
];
export const secretShaped = (text) => SECRET_SHAPES.some((re) => re.test(text));

// The keyword parrot's vocabulary: CHARTER §2 gate categories and §6 tripwires,
// and nothing else. The bucket (hit / no hit) is fixed at ask time, so the
// baseline cannot be tuned after the outcomes are known.
export const KEYWORDS = {
  money: /\b(money|pay|payment|spend|billing|invoice|subscription|credit card|purchase|buy|\$\d)/i,
  software: /\b(deploy|release|publish|merge|push|nixos-rebuild|switch|production|prod)\b/i,
  matter: /\b(hardware|physical|device|reboot|power)\b/i,
  secrets: /\b(secret|credential|password|token|api key|private key|agenix|ssh key)/i,
  network: /\b(port|firewall|dns|expose|public endpoint|tailscale|ingress)\b/i,
  irreversible: /\b(irreversible|delete|remove|drop|wipe|destroy|force-push|rm -rf|overwrite)\b/i,
  outward: /\b(email|send|post|comment|message|tweet|external|outward|upload|api call)\b/i,
  tripwire: /\b(goal-drift|permission|creep|overconfiden|out-of-distribution|novel|unprecedented|self-modif|charter|council rules?)/i,
};
export function keywordClasses(text) {
  return Object.entries(KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
}

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Rule 3. Returns {key} or {why}; `why` never carries file contents.
export function loadKey(path) {
  let st;
  try { st = statSync(path); } catch { return { why: `no key: ${path} does not exist` }; }
  if (!st.isFile()) return { why: `no key: ${path} is not a regular file` };
  if (st.mode & 0o077) return { why: `no key: ${path} is group/world-accessible (mode ${(st.mode & 0o777).toString(8)}); refusing` };
  let k;
  try { k = readFileSync(path, 'utf8').trim(); } catch { return { why: `no key: ${path} unreadable` }; }
  if (!k || /\s/.test(k) || k.length > 512) return { why: `no key: ${path} empty or malformed` };
  return { key: k };
}

function config() {
  const endpoint = process.env.JEV_SHADOW_ENDPOINT || DEFAULT_ENDPOINT;
  const creditUrl = process.env.JEV_SHADOW_CREDIT_URL || DEFAULT_CREDIT_URL;
  const loop = (u) => { const x = new URL(u); return x.protocol === 'http:' && x.hostname === '127.0.0.1'; };
  for (const [name, u] of [['endpoint', endpoint], ['credit url', creditUrl]]) {
    if (new URL(u).protocol !== 'https:' && !loop(u)) throw new Error(`${name} must be https (or http://127.0.0.1 for the test arm)`);
  }
  const testArm = loop(endpoint);
  for (const v of ['JEV_SHADOW_NOW', 'JEV_SHADOW_TIMEOUT_MS']) {
    if (process.env[v] && !testArm) throw new Error(`${v} is a test-arm override; refused without the loopback endpoint`);
  }
  const now = process.env.JEV_SHADOW_NOW ? Date.parse(process.env.JEV_SHADOW_NOW) : Date.now();
  if (!Number.isFinite(now)) throw new Error('JEV_SHADOW_NOW is not a date');
  return {
    endpoint, creditUrl, now,
    timeoutMs: Number(process.env.JEV_SHADOW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    keyFile: process.env.JEV_SHADOW_KEY_FILE || DEFAULT_KEY_FILE,
    journal: caleJurnal(process.env.HOME || os.homedir()),
  };
}

// Returns {id, choice, probabilities, confidence, cost} or {why}.
async function ask(cfg, key, state) {
  guardQuestions();
  const body = JSON.stringify({ model: MODEL, questions: QUESTIONS, state });
  if (Buffer.byteLength(body) > 32768) return { why: 'request over 32 KiB; not sent' };
  let res;
  try {
    res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body, signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) { return { why: e.name === 'TimeoutError' ? `jev timeout after ${cfg.timeoutMs} ms` : `jev unreachable (${e.name})` }; }
  if (res.status === 402) return { why: 'jev 402: provider credit limit reached (the $ cap is doing its job)' };
  if (res.status === 429) return { why: 'jev 429: rate limited' };
  if (!res.ok) return { why: `jev HTTP ${res.status}` };
  let j;
  try { j = await res.json(); } catch { return { why: 'jev response not JSON' }; }
  const a = j && j.answers && j.answers.council_verdict;
  const pr = a && a.probabilities;
  const nums = pr && Object.keys(TO_VERDICT).map((k) => pr[k]);
  const ok = a && Object.hasOwn(TO_VERDICT, a.choice) && nums.every((p) => typeof p === 'number' && p >= 0 && p <= 1)
    && Math.abs(nums.reduce((s, p) => s + p, 0) - 1) <= 0.02
    && typeof a.confidence === 'number' && a.confidence >= 0 && a.confidence <= 1
    && typeof j.id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(j.id);
  if (!ok) return { why: 'jev response malformed; no forecast' };
  const sum = nums.reduce((s, p) => s + p, 0);
  const probabilities = {};
  for (const [k, v] of Object.entries(TO_VERDICT)) probabilities[v] = pr[k] / sum;
  return { id: j.id, choice: TO_VERDICT[a.choice], probabilities, confidence: a.confidence, cost: j.usage && j.usage.cost };
}

const say = (s) => process.stderr.write(`jev-shadow: ${s}\n`);

async function shadow(argv) {
  const cfg = config();
  const i = argv.indexOf('--proposal-file');
  const file = i >= 0 ? argv[i + 1] : null;
  const smoke = argv.includes('--smoke');
  if (!file) return say('no --proposal-file; nothing asked');

  // Rule 2, first: after the cutoff nothing is read, nothing is sent, nothing is written.
  if (cfg.now >= EXPERIMENT_END) return say('experiment ended 2026-10-26 (Europe/Chisinau); nothing asked');

  let proposal;
  try { proposal = readFileSync(file, 'utf8'); } catch { return say('proposal file unreadable; nothing asked'); }
  if (!proposal.trim()) return say('empty proposal; nothing asked');
  if (Buffer.byteLength(proposal) > MAX_PROPOSAL_BYTES) return say(`proposal over ${MAX_PROPOSAL_BYTES} bytes; nothing asked`);
  if (secretShaped(proposal)) return say('proposal carries a secret-shaped string; not sent to Jev');

  const k = loadKey(cfg.keyFile);
  if (!k.key) return say(k.why);

  const hash = sha256(proposal);
  const askedAt = new Date(cfg.now).toISOString();
  const kw = keywordClasses(proposal);
  const base = {
    kind: 'council',
    log_id: `jev-council/${hash.slice(0, 12)}/${askedAt.replace(/[-:.]/g, '')}`,
    proposal_sha256: hash,
    asked_at: askedAt,
    keyword_hit: kw.length > 0,
    keyword_classes: kw,
    ...(smoke ? { smoke: true } : {}),
  };
  const t0 = Date.now();
  const ans = await ask(cfg, k.key, { proposal, council: COUNCIL });
  const latency = Date.now() - t0;
  const answeredAt = new Date(cfg.now + latency).toISOString();
  if (ans.why) {
    adaugaConsiliu(cfg.journal, { ...base, answered_at: answeredAt, latency_ms: latency, error: ans.why, outcome: null });
    return say(`${ans.why}; error row written`);
  }
  adaugaConsiliu(cfg.journal, {
    ...base, answered_at: answeredAt, latency_ms: latency, jev_id: ans.id, choice: ans.choice,
    probabilities: ans.probabilities, confidence: ans.confidence,
    ...(typeof ans.cost === 'number' ? { cost: ans.cost } : {}), outcome: null,
  });
  say(`row ${base.log_id}${smoke ? ' (smoke)' : ''}: ${ans.choice} ${CLASSES.map((c) => ans.probabilities[c].toFixed(2)).join('/')} in ${latency} ms`);
}

// The key's remaining credit, as OpenRouter reports it on GET /api/v1/key.
// Prints only the named numeric fields.
async function credit() {
  const cfg = config();
  const k = loadKey(cfg.keyFile);
  if (!k.key) return say(k.why);
  let res;
  try { res = await fetch(cfg.creditUrl, { headers: { Authorization: `Bearer ${k.key}` }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { return say(`credit check unreachable (${e.name})`); }
  if (!res.ok) return say(`credit check HTTP ${res.status}`);
  let d;
  try { d = (await res.json()).data || {}; } catch { return say('credit check: response not JSON'); }
  const num = (x) => (typeof x === 'number' ? x : null);
  console.log(JSON.stringify({ limit: num(d.limit), usage: num(d.usage), limit_remaining: num(d.limit_remaining) }));
}

// Real paths, as in synthesize.mjs: the skill is reached through symlinks.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  (argv.includes('--credit') ? credit() : shadow(argv))
    .catch((e) => say(`${e.name}: ${String(e.message).slice(0, 160)}`))
    .finally(() => process.exit(0));
}
