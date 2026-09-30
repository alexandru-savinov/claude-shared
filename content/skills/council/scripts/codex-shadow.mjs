#!/usr/bin/env node
// codex-shadow.mjs — Codex as the council's fourth seat: a forecaster (shadow 3),
// non-voting, measurement only. Modelled on jev-shadow.mjs. Approved by
// Alexandru 2026-09-30 16:14: «da, aprobat ca si jev». (The council may not
// approve changes to itself, CHARTER §6.5, so his word is the approval.)
//
// At Step 2b, in the background, beside the assessors, Codex is asked ONE
// question: what will the FULL council decide on this proposal — proceed,
// escalate-to-human or block — with probabilities, as JSON. The answer becomes
// ONE row (kind "council", source "codex") in the Codex journal
// ~/.claude/index/council/codex-journal.jsonl. `jev-journal.mjs resolve-council
// --source codex` later matches it to the council log by sha256(proposal);
// `jev-journal.mjs report --source codex` scores it against the same two parrots.
//
//   node scripts/codex-shadow.mjs --proposal-file F [--smoke]
//
// THE RULES, each enforced here, each with a test arm (tests/codex-shadow.test.mjs):
//   1. CODEX NEVER TOUCHES THE VERDICT. This script writes only its journal. It
//      never reads or writes a council log and synthesize.mjs never reads the
//      journal. Exit status is ALWAYS 0: a Codex failure is not a council failure.
//   2. HARD STOP. No ask from 2026-12-29 00:00 Europe/Chisinau (EET, UTC+2) =
//      2026-12-28T22:00Z. Checked before the proposal is read. No call, no row.
//   3. FROM THE TEXT ONLY. `codex exec -s read-only --skip-git-repo-check
//      --ephemeral --json`, stdin /dev/null, cwd a fresh empty temp dir (removed
//      afterwards), a hard timeout that kills the whole process group. The
//      prompt says: run no commands. The --json event stream is PARSED: any item
//      that is not a message or reasoning (a command, a file change, an MCP or
//      web tool call, anything unknown) makes the row `tool_use:true`, with no
//      probabilities: never scored.
//   4. NEVER THE PINNED MODEL. No `-m`: his config selects the model. `-m` is
//      never passed (gpt-6.1-sol is rejected on his account).
//   5. NOTHING ABOUT SECURITY LEAVES. Jev's filter, imported, not copied: a
//      proposal that touches security or carries a secret-shaped string is NOT
//      sent; one row {skipped:"security"}, no text, no probabilities. Empty or
//      over-24-KiB proposals are not sent either (no row).
//   6. NO LABELS (Alexandru, 2026-09-30 16:17). Nothing sent to Codex names a
//      model or this house: the prompt calls the council "a three-member review
//      panel", and anonymize() replaces model names, Co-Authored-By /
//      Claude-Session lines and "Generated with Claude Code" in the proposal by
//      the token [model]. The row records anonymized:true and the COUNT of
//      replacements, never the removed text. This removes the label bias; it
//      does not remove the style bias (Codex may still prefer familiar text).
//   7. Timeout / codex missing / rate limit / non-zero exit / bad JSON → one
//      `error` row with a FIXED text (never Codex's own stderr), exit 0.
//
// Env: CODEX_SHADOW_JOURNAL chooses the journal file (always allowed; it only
// says where the row goes — used for the smoke run). CODEX_SHADOW_NOW and
// CODEX_SHADOW_TIMEOUT_MS are test-arm overrides and are REFUSED unless the
// `codex` found on PATH lives under the temp dir (the test stub).
'use strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, realpathSync, statSync, accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caleJurnal, adaugaConsiliu } from './jev-journal.mjs';
import {
  COUNCIL, CLASSES, TO_VERDICT, QUESTIONS, MAX_PROPOSAL_BYTES,
  guardQuestions, securitySensitive, keywordClasses, sha256,
} from './jev-shadow.mjs';

export const EXPERIMENT_END = Date.parse('2026-12-28T22:00:00Z'); // 2026-12-29 00:00 Europe/Chisinau
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;

// Rule 6. The labels, in one place. Each pattern's match becomes [model].
// Lines first (a whole trailer line goes), then names.
export const MODEL_TOKEN = '[model]';
const LABELS = [
  /^[ \t]*Co-Authored-By:.*$/gim,
  /^[ \t]*Claude-Session:.*$/gim,
  /(?:\u{1F916}\s*)?Generated with \[?Claude Code\]?(?:\([^)\s]*\))?/giu,
  /\b(?:us\.)?anthropic[./-][A-Za-z0-9.:_-]+/gi,
  /\bclaude-[A-Za-z0-9.:_[\]-]+/gi,
  /\b(?:Claude\s+)?(?:Opus|Sonnet|Haiku|Fable)(?:[\s-]+\d+(?:\.\d+)*)?(?:\s*\(1M context\))?/gi,
  /\b(?:Claude(?:\s+Code)?|Anthropic|Sancta|Jev|OpenAI|Codex|ChatGPT|Gemini|Llama|Mistral)\b/gi,
  /\bgpt-?[0-9][A-Za-z0-9.-]*/gi,
  /\banother model\b/gi,
];
export function anonymize(text) {
  let n = 0;
  let out = String(text);
  for (const re of LABELS) out = out.replace(re, () => { n++; return MODEL_TOKEN; });
  return { text: out, n };
}

// The question, in the same words Jev gets, with the council called "a
// three-member review panel" (his words). Keys proceed/escalate/block, as
// Jev's: the guard refuses person words, and "escalate-to-human" is one.
export const PANEL = 'three-member review panel';
const toPanel = (t) => t.replace(/A deliberative council of three independent assessors/g, `A ${PANEL} of independent assessors`)
  .replace(/Using only the state,/g, "Using only this text,").replace(/\bthe full council\b/g, "the full panel").replace(/\bcouncil\b/g, 'panel');
export const PANEL_TEXT = toPanel(COUNCIL);
const crit = QUESTIONS.council_verdict.criteria;
export const INSTRUCTIONS = toPanel(
  'This is a forecast from text, not a task. Do not run any command, do not open or write any file, ' +
  'do not call any tool, do not search the web. Answer from the text below only. ' +
  'The text holds a description of a council (between <panel> tags) and a proposed action ' +
  '(between <proposal> tags). ' + QUESTIONS.council_verdict.instructions.replace(/^.*?\. /, '') + ' ' +
  `Choices: proceed = ${crit.proceed} escalate = ${crit.escalate} block = ${crit.block} ` +
  'Reply with ONE JSON object and nothing else, of exactly this shape: ' +
  '{"choice":"proceed|escalate|block","probabilities":{"proceed":0.0,"escalate":0.0,"block":0.0},"confidence":0.0} ' +
  'where the three probabilities are numbers in [0,1] that sum to 1, and confidence is a number in [0,1].');

// Jev's person guard on the fixed text. The one phrase he asked for,
// "review panel", is taken out before the guard looks: the guard refuses the
// word "review" (it guards against questions about a code review of his).
export function buildPrompt(anonProposal) {
  const fixed = `${INSTRUCTIONS}\n${PANEL_TEXT}`;
  guardQuestions({ codex: INSTRUCTIONS.split(PANEL).join('panel') }, PANEL_TEXT.split(PANEL).join('panel'));
  if (anonymize(fixed).n) throw new Error('prompt names a model; refused');
  return `${INSTRUCTIONS}\n\n<panel>\n${PANEL_TEXT}\n</panel>\n\n<proposal>\n${anonProposal}\n</proposal>\n`;
}

// Items that are not tool use. Everything else — command_execution,
// file_change, mcp_tool_call, web_search, todo_list, anything new — counts.
const QUIET_ITEMS = new Set(['agent_message', 'reasoning', 'error']);
const KNOWN_EVENTS = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']);
const TOOLISH = /exec|command|tool|patch|search|mcp|file|shell|apply/i;

// Pure: the --json JSONL stream → what happened. Kinds only, never contents.
export function parseStream(stdout) {
  const out = { tools: 0, toolKinds: [], messages: [], errors: [], threadId: null, usage: null, lines: 0, badLines: 0 };
  const seen = new Set();
  const kinds = new Set();
  let idx = 0;
  for (const raw of String(stdout).split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    out.lines++;
    let e;
    try { e = JSON.parse(l); } catch { out.badLines++; continue; }
    if (!e || typeof e !== 'object') { out.badLines++; continue; }
    const t = typeof e.type === 'string' ? e.type : '';
    if (t.startsWith('item.')) {
      const it = e.item && typeof e.item === 'object' ? e.item : {};
      const kind = typeof it.type === 'string' ? it.type : 'unknown';
      if (!QUIET_ITEMS.has(kind)) {
        const key = typeof it.id === 'string' ? it.id : `anon-${idx++}`;
        if (!seen.has(key)) { seen.add(key); out.tools++; }
        kinds.add(kind.slice(0, 40).replace(/[^A-Za-z0-9_.-]/g, '_'));
      } else if (kind === 'agent_message' && t === 'item.completed' && typeof it.text === 'string') {
        out.messages.push(it.text);
      } else if (kind === 'error') {
        out.errors.push(String(it.message || ''));
      }
    } else if (t === 'thread.started') {
      if (typeof e.thread_id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(e.thread_id)) out.threadId = e.thread_id;
    } else if (t === 'turn.completed') {
      const u = e.usage || {};
      const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
      out.usage = { input_tokens: num(u.input_tokens), output_tokens: num(u.output_tokens) };
    } else if (t === 'turn.failed') {
      out.errors.push(String((e.error && e.error.message) || 'turn failed'));
    } else if (t === 'error') {
      out.errors.push(String(e.message || 'error'));
    } else if (!KNOWN_EVENTS.has(t)) {
      // An event this parser does not know. If it smells like a tool (or an
      // older-format msg.type does), it counts: fail toward "not scored".
      const legacy = e.msg && typeof e.msg.type === 'string' ? e.msg.type : '';
      if (TOOLISH.test(t) || TOOLISH.test(legacy)) {
        out.tools++;
        kinds.add((t || legacy).slice(0, 40).replace(/[^A-Za-z0-9_.-]/g, '_'));
      }
    }
  }
  out.toolKinds = [...kinds].sort();
  return out;
}

// Pure: the last agent message → {choice, probabilities, confidence} or {why}.
export function parseAnswer(text) {
  if (typeof text !== 'string' || !text.trim()) return { why: 'codex gave no answer' };
  const s = text.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { why: 'codex answer not JSON' };
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { return { why: 'codex answer not JSON' }; }
  const pr = j && j.probabilities;
  const pick = (k) => (pr && (k === 'escalate' ? (pr.escalate ?? pr['escalate-to-human']) : pr[k]));
  const nums = Object.keys(TO_VERDICT).map(pick);
  const choiceKey = j && (j.choice === 'escalate-to-human' ? 'escalate' : j.choice);
  const ok = j && Object.hasOwn(TO_VERDICT, choiceKey)
    && nums.every((p) => typeof p === 'number' && p >= 0 && p <= 1)
    && Math.abs(nums.reduce((x, p) => x + p, 0) - 1) <= 0.02
    && typeof j.confidence === 'number' && j.confidence >= 0 && j.confidence <= 1;
  if (!ok) return { why: 'codex answer malformed; no forecast' };
  const sum = nums.reduce((x, p) => x + p, 0);
  const probabilities = {};
  Object.entries(TO_VERDICT).forEach(([k, v], i) => { probabilities[v] = nums[i] / sum; });
  return { choice: TO_VERDICT[choiceKey], probabilities, confidence: j.confidence };
}

function which(name) {
  for (const d of String(process.env.PATH || '').split(':').filter(Boolean)) {
    const p = path.join(d, name);
    try { if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return p; } } catch { /* next */ }
  }
  return null;
}

function config() {
  const bin = which('codex');
  let testArm = false;
  if (bin) {
    try { testArm = realpathSync(bin).startsWith(realpathSync(os.tmpdir()) + path.sep); } catch { testArm = false; }
  }
  for (const v of ['CODEX_SHADOW_NOW', 'CODEX_SHADOW_TIMEOUT_MS']) {
    if (process.env[v] && !testArm) throw new Error(`${v} is a test-arm override; refused unless codex on PATH is the temp-dir stub`);
  }
  const now = process.env.CODEX_SHADOW_NOW ? Date.parse(process.env.CODEX_SHADOW_NOW) : Date.now();
  if (!Number.isFinite(now)) throw new Error('CODEX_SHADOW_NOW is not a date');
  const j = process.env.CODEX_SHADOW_JOURNAL;
  if (j && !path.isAbsolute(j)) throw new Error('CODEX_SHADOW_JOURNAL must be an absolute path');
  return {
    bin, now,
    timeoutMs: Number(process.env.CODEX_SHADOW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    journal: j || caleJurnal(process.env.HOME || os.homedir(), 'codex'),
  };
}

// Runs codex once in a fresh empty dir. Never throws.
function runCodex(bin, prompt, timeoutMs) {
  return new Promise((resolve) => {
    let cwd;
    try { cwd = mkdtempSync(path.join(os.tmpdir(), 'codex-shadow-')); } catch { return resolve({ spawnError: true }); }
    const done = (r) => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ } resolve({ ...r, cwd }); };
    let child;
    try {
      child = spawn(bin, ['exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '--json', '-C', cwd, prompt], {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: process.env,
      });
    } catch { return done({ spawnError: true }); }
    let stdout = '', stderr = '', timedOut = false, settled = false;
    child.stdout.on('data', (d) => { if (stdout.length < MAX_STREAM_BYTES) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_STREAM_BYTES) stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    }, timeoutMs);
    child.on('error', () => { if (settled) return; settled = true; clearTimeout(timer); done({ spawnError: true }); });
    child.on('close', (code, signal) => { if (settled) return; settled = true; clearTimeout(timer); done({ code, signal, stdout, stderr, timedOut }); });
  });
}

const RATE = /\b429\b|rate.?limit|usage limit|too many requests|quota/i;
const say = (s) => process.stderr.write(`codex-shadow: ${s}\n`);

async function shadow(argv) {
  const cfg = config();
  const i = argv.indexOf('--proposal-file');
  const file = i >= 0 ? argv[i + 1] : null;
  const smoke = argv.includes('--smoke');
  if (!file) return say('no --proposal-file; nothing asked');

  // Rule 2, first: after the cutoff nothing is read, nothing is run, nothing is written.
  if (cfg.now >= EXPERIMENT_END) return say('experiment ended 2026-12-28 (Europe/Chisinau); nothing asked');

  let proposal;
  try { proposal = readFileSync(file, 'utf8'); } catch { return say('proposal file unreadable; nothing asked'); }
  if (!proposal.trim()) return say('empty proposal; nothing asked');
  if (Buffer.byteLength(proposal) > MAX_PROPOSAL_BYTES) return say(`proposal over ${MAX_PROPOSAL_BYTES} bytes; nothing asked`);
  const hash = sha256(proposal);
  const askedAt = new Date(cfg.now).toISOString();
  const logId = `codex-council/${hash.slice(0, 12)}/${askedAt.replace(/[-:.]/g, '')}`;
  // Rule 6 then rule 5: the filter judges exactly the text that would leave.
  // (On the raw text, a "Co-Authored-By" trailer alone trips Jev's filter on
  // "auth", so no proposal carrying one would ever be asked.) The removed
  // text never leaves either way.
  const anon = anonymize(proposal);
  // Rule 5: Jev's filter, the same function.
  if (securitySensitive(anon.text)) {
    adaugaConsiliu(cfg.journal, { kind: 'council', source: 'codex', log_id: logId, proposal_sha256: hash, asked_at: askedAt, skipped: 'security', outcome: null, ...(smoke ? { smoke: true } : {}) });
    return say('proposal touches security; not sent to Codex (skipped row written)');
  }

  const kw = keywordClasses(proposal);
  const base = {
    kind: 'council', source: 'codex', log_id: logId, proposal_sha256: hash, asked_at: askedAt,
    keyword_hit: kw.length > 0, keyword_classes: kw, ...(smoke ? { smoke: true } : {}),
  };
  const row = (extra, t0) => {
    const latency = Date.now() - t0;
    return { ...base, answered_at: new Date(cfg.now + latency).toISOString(), latency_ms: latency, ...extra, outcome: null };
  };
  const t0 = Date.now();
  if (!cfg.bin) {
    adaugaConsiliu(cfg.journal, row({ error: 'codex not found on PATH' }, t0));
    return say('codex not found on PATH; error row written');
  }
  const prompt = buildPrompt(anon.text);
  const r = await runCodex(cfg.bin, prompt, cfg.timeoutMs);
  const ev = parseStream(r.stdout || '');
  const meta = { anonymized: true, anonymized_replacements: anon.n, tool_events: ev.tools, ...(ev.threadId ? { codex_thread_id: ev.threadId } : {}) };

  // Rule 3: a tool ran → the answer is not from the text. Never scored.
  if (ev.tools > 0) {
    adaugaConsiliu(cfg.journal, row({ ...meta, tool_use: true, tool_kinds: ev.toolKinds }, t0));
    return say(`codex used ${ev.tools} tool(s) (${ev.toolKinds.join(', ')}); tool_use row written, never scored`);
  }
  let why = null;
  if (r.spawnError) why = 'codex could not start';
  else if (r.timedOut) why = `codex timeout after ${cfg.timeoutMs} ms`;
  else if (RATE.test(ev.errors.join('\n')) || RATE.test(r.stderr || '')) why = 'codex rate limited';
  else if (r.code !== 0) why = `codex exited ${r.code === null ? 'by signal ' + r.signal : r.code}`;
  let ans = null;
  if (!why) {
    ans = parseAnswer(ev.messages[ev.messages.length - 1]);
    if (ans.why) why = ans.why;
  }
  if (why) {
    adaugaConsiliu(cfg.journal, row({ ...meta, error: why }, t0));
    return say(`${why}; error row written`);
  }
  const u = ev.usage || {};
  const usage = Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'number'));
  const good = row({ ...meta, choice: ans.choice, probabilities: ans.probabilities, confidence: ans.confidence, ...(Object.keys(usage).length ? { usage } : {}) }, t0);
  adaugaConsiliu(cfg.journal, good);
  say(`row ${logId}${smoke ? ' (smoke)' : ''}: ${ans.choice} ${CLASSES.map((c) => ans.probabilities[c].toFixed(2)).join('/')} in ${good.latency_ms} ms, ${ev.tools} tool events`);
}

// Real paths, as in synthesize.mjs: the skill is reached through symlinks.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  shadow(process.argv.slice(2))
    .catch((e) => say(`${e.name}: ${String(e.message).slice(0, 160)}`))
    .finally(() => process.exit(0));
}
