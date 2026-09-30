// Test stub for codex-shadow.test.mjs: a fake `codex` binary. The test copies
// it into a temp dir as `codex` (with a shebang to this node) and puts that dir
// first on PATH. No network, no model, no real Codex.
//
// Reads its scenario from $CODEX_STUB_SCEN on every call; appends ONE JSON line
// per call to $CODEX_STUB_LOG with what it received: the full argv, the cwd and
// how many entries it held, where stdin points and what it carried, its pid.
// Scenario modes: good (default) · tool · sleep · garbage · prose · shape ·
// ratelimit · exit1.
import { appendFileSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';

const s = JSON.parse(readFileSync(process.env.CODEX_STUB_SCEN, 'utf8'));
let stdinLink = null, stdin = null;
try { stdinLink = readlinkSync('/proc/self/fd/0'); } catch { /* none */ }
try { stdin = readFileSync(0, 'utf8'); } catch { stdin = null; }
let cwdEntries = null;
try { cwdEntries = readdirSync(process.cwd()).length; } catch { /* gone */ }
appendFileSync(process.env.CODEX_STUB_LOG, JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), cwd_entries: cwdEntries, stdin_link: stdinLink, stdin, pid: process.pid,
}) + '\n');

const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n');
const probs = s.probs || { proceed: 0.1, escalate: 0.8, block: 0.1 };
const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
const answer = (text) => {
  out({ type: 'thread.started', thread_id: 'stub-thread-1' });
  out({ type: 'turn.started' });
  out({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking' } });
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });
  out({ type: 'turn.completed', usage: { input_tokens: 900, cached_input_tokens: 0, output_tokens: 40 } });
};
const good = () => answer('```json\n' + JSON.stringify({ choice, probabilities: probs, confidence: 0.7 }) + '\n```');

const mode = s.mode || 'good';
if (mode === 'good') good();
else if (mode === 'tool') {
  out({ type: 'thread.started', thread_id: 'stub-thread-2' });
  out({ type: 'turn.started' });
  out({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'ls', status: 'in_progress' } });
  out({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' } });
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify({ choice, probabilities: probs, confidence: 0.9 }) } });
  out({ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 40 } });
} else if (mode === 'sleep') {
  setTimeout(good, s.sleepMs || 8000);
} else if (mode === 'garbage') {
  out('this is not json');
  out('{"half":');
} else if (mode === 'prose') {
  answer('I think the council would probably escalate this one.');
} else if (mode === 'shape') {
  answer(JSON.stringify({ choice: 'maybe', probabilities: { proceed: 0.5 }, confidence: 2 }));
} else if (mode === 'ratelimit') {
  out({ type: 'thread.started', thread_id: 'stub-thread-3' });
  out({ type: 'turn.failed', error: { message: 'stream error: 429 Too Many Requests' } });
  process.exitCode = 1;
} else if (mode === 'exit1') {
  process.exitCode = 1;
}
