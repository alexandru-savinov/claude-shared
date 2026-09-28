// Test stub for jev-shadow.test.mjs: a local Jev endpoint (and the OpenRouter
// credit route) in ONE separate process — the test blocks on spawnSync, so an
// in-process server would deadlock.
//   node jev-shadow.stub.mjs <scenario.json> <log.jsonl>
// Prints the port on stdout. Re-reads the scenario on every request, so the
// test can change the world between calls. Appends one JSON line per request.
//
// While the Jev request is in flight the worker is alive: the stub scans every
// /proc/<pid>/cmdline and /proc/<pid>/environ it can read for the key and
// records whether it found it. That is the argv/env leak check, done while the
// leak would exist.
import http from 'node:http';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';

const [scenPath, logPath] = process.argv.slice(2);
let n = 0;
const log = (o) => appendFileSync(logPath, JSON.stringify(o) + '\n');

function procLeak(key) {
  let argv = false, env = false;
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try { if (readFileSync(`/proc/${pid}/cmdline`, 'latin1').includes(key)) argv = true; } catch { /* gone or not ours */ }
    try { if (readFileSync(`/proc/${pid}/environ`, 'latin1').includes(key)) env = true; } catch { /* not readable */ }
  }
  return { argv, env };
}

const server = http.createServer((req, res) => {
  const s = JSON.parse(readFileSync(scenPath, 'utf8'));
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const url = new URL(req.url, 'http://x');
  let chunks = '';
  req.on('data', (c) => { chunks += c; });
  req.on('end', () => {
    const auth_ok = req.headers.authorization === `Bearer ${s.key}`;
    if (url.pathname === '/api/v1/key' && req.method === 'GET') {
      log({ kind: 'credit', auth_ok });
      if (!auth_ok) return send(401, { error: 'bad key' });
      return send(200, { data: { label: 'stub', limit: 1, usage: 0.25, limit_remaining: 0.75 } });
    }
    if (url.pathname === '/api/alpha/decisions' && req.method === 'POST') {
      const leak = procLeak(s.key);
      let body = {};
      try { body = JSON.parse(chunks); } catch { /* recorded as unparsed */ }
      log({ kind: 'jev', auth_ok, model: body.model,
        question_keys: Object.keys(body.questions || {}), state_keys: Object.keys(body.state || {}),
        criteria: Object.keys(((body.questions || {}).council_verdict || {}).criteria || {}),
        body_has_key: chunks.includes(s.key), argv_leak: leak.argv, env_leak: leak.env });
      if (!auth_ok) return send(401, { error: 'bad key' });
      const reply = () => {
        if (s.status) return send(s.status, { error: 'stub status' });
        if (s.malformed) return send(200, '{"answers":{"council_verdict":{"choice":"maybe"}}}');
        n++;
        const p = s.probs || { proceed: 0.1, escalate: 0.8, block: 0.1 };
        const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
        send(200, {
          model: 'typesafe/jev-1.13-20260917',
          answers: { council_verdict: { type: 'choice', choice, probabilities: p, confidence: 0.7 } },
          usage: { input_tokens: 700, output_tokens: 40, cost: 0.00003 },
          id: `gen-dec-stub-${n}`, provider: 'TypeSafe',
        });
      };
      return s.delayMs ? setTimeout(reply, s.delayMs) : reply();
    }
    log({ kind: 'other', path: url.pathname });
    send(404, { message: 'stub: no route ' + url.pathname });
  });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
