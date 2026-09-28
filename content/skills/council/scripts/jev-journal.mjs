#!/usr/bin/env node
// jev-journal.mjs — jurnalul cu trei coloane din clauza 6 a lenses/jev.md:
// ce a zis Jev (probabilitate) · ce s-a întâmplat (outcome) · dacă nota a fost
// adoptată (creep meter). Primele două măsoară CALIBRAREA, a treia măsoară
// influența — fiindcă o prezență fără vot capătă putere prin simpla prezență.
//
// Fără jurnal, locul lui Jev e o părere despre o părere. Cu el, „0.7 chiar a
// însemnat 0.7?" e o întrebare cu răspuns. Ăsta e singurul lucru din tot
// aranjamentul care POATE PICA — și de-aia e singurul care contează.
//
// Depozit: $HOME/.claude/index/council/jev-journal.jsonl, DOAR adăugare.
// Istoria nu se rescrie: `resolve` adaugă un rând corectat, iar cititorul ia
// ULTIMUL rând per log_id. Un jurnal care se poate edita nu e o măsurătoare.
//
// Rând: {ts, log_id, question, decision, probability, confidence, anchor,
//        outcome (true|false|null), adopted (true|false)}
//
// Contract: 0 = bine; 2 = rând refuzat, sau calibrare RUPTĂ la report, sau
// calibrare FĂRĂ VALOARE (Brier skill ≤ 0 față de rata de bază).
//
// CALIBRAREA SINGURĂ NU E UN VERDE (2026-09-26). Un papagal care spune mereu
// rata de bază e perfect calibrat — și nu știe nimic. De-aia verdele cere, pe
// lângă calibrare, un Brier skill score > 0 față de rata de bază a rezultatelor
// REZOLVATE, calculată RETROSPECTIV (cu rezultatele deja știute): referința cea
// mai tare pe care o poate avea un papagal, dinadins. Dacă toate rezultatele
// sunt identice, referința e perfectă, skill-ul e nedefinit — și asta NU e verde.
// Cade ÎNCHIS: date puține NU sunt un verde — sunt tăcere, și se spune pe față.
// Probă: jev-journal.mjs --autoproba
'use strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Pragurile. SCRISE ÎN IEȘIRE, nu ascunse în cod — un prag pe care nu-l vezi
// e un prag pe care nu-l poți contesta.
// ---------------------------------------------------------------------------
export const PRAG_TOTAL   = 20;   // rânduri rezolvate, minim, ca să judec ceva
export const PRAG_GALEATA = 5;    // rânduri într-o găleată, minim, ca s-o judec
export const TOLERANTA    = 0.20; // |medie prezisă − frecvență observată| admis
export const PRAG_BSS     = 0;    // Brier skill vs rata de bază: verdele cere STRICT peste
const EPS_BSS             = 1e-9; // zgomot de virgulă mobilă: un papagal exact nu trece prin rotunjire
const FEREASTRA_CREEP     = 20;   // ultimele N treceri, pentru panta adopției

export const caleJurnal = (home = os.homedir()) =>
  path.join(home, '.claude', 'index', 'council', 'jev-journal.jsonl');

// ---------------------------------------------------------------------------
// Citire / scriere
// ---------------------------------------------------------------------------

function argumente(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

function mori(motiv) { process.stderr.write(`REFUZ — ${motiv}\n`); process.exit(2); }

// Un număr strict în [0,1]. "0.9abc" NU trece: Number() l-ar face NaN, dar
// parseFloat l-ar înghiți. Folosesc Number, dinadins.
function fractie(brut, nume) {
  if (brut === undefined || brut === null || String(brut).trim() === '') mori(`${nume} lipsește; e obligatoriu.`);
  const n = Number(brut);
  if (!Number.isFinite(n)) mori(`${nume} nu e număr: ${JSON.stringify(brut)}`);
  if (n < 0 || n > 1) mori(`${nume} = ${n} e în afara intervalului [0,1]. O probabilitate din afara lui nu e o probabilitate.`);
  return n;
}

// Cuvintele prin care ABSENȚA se preface în valoare. Un `null` dintr-un JSON
// trecut printr-un shell ajunge aici ca ȘIRUL "null" și, fără paza asta, intra
// în jurnal ca ancoră. Găsit pe viu 2026-09-26: `--anchor null` era acceptat.
// Exact calea pe care al doilea scaun (midjourney.md, `ancora` mereu null) ar
// fi intrat în registrul de calibrare. Scaunul ăla NU are ce rezolva; un scor
// de calibrare pentru el ar fi o minciună cu cifre.
const GOLURI = new Set(['null', 'undefined', 'none', 'n/a', 'nan', 'nil']);

function text(brut, nume) {
  if (typeof brut !== 'string' || brut.trim() === '') {
    mori(`${nume} lipsește sau e gol.`);
  }
  if (GOLURI.has(brut.trim().toLowerCase())) {
    mori(`${nume} = "${brut.trim()}" — ăsta e un gol scris în litere, nu o valoare. Clauza 5 din jev.md: un rând fără ancoră falsificabilă e exact ce interzice lentila, iar midjourney.md nu intră deloc în calibrare.`);
  }
  return brut.trim();
}

function boolStrict(brut, nume) {
  if (brut === 'true') return true;
  if (brut === 'false') return false;
  mori(`${nume} trebuie să fie exact "true" sau "false"; am primit ${JSON.stringify(brut)}.`);
}

export function citeste(cale) {
  let brut;
  try { brut = fs.readFileSync(cale, 'utf8'); } catch { return []; }
  const randuri = [];
  const linii = brut.split('\n');
  for (let i = 0; i < linii.length; i++) {
    const l = linii[i].trim();
    if (!l) continue;
    try { randuri.push(JSON.parse(l)); }
    catch { mori(`jurnalul e corupt la linia ${i + 1} din ${cale}. Nu citesc mai departe — cad închis.`); }
  }
  return randuri;
}

// ULTIMUL rând per log_id câștigă. Asta e tot mecanismul „append-only, dar
// corectabil": nu ștergi nimic, doar adaugi adevărul de pe urmă.
export function ultimele(randuri) {
  const m = new Map();
  for (const r of randuri) if (r && r.log_id) m.set(r.log_id, r);
  return [...m.values()];
}

function adauga(cale, rand) {
  fs.mkdirSync(path.dirname(cale), { recursive: true });
  fs.appendFileSync(cale, JSON.stringify(rand) + '\n');
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

function cmdAppend(a, cale) {
  const rand = {
    ts: new Date().toISOString(),
    log_id: text(a['log-id'], '--log-id (fără el rândul nu poate fi rezolvat niciodată)'),
    question: text(a['question'], '--question'),
    decision: text(a['decision'], '--decision'),
    probability: fractie(a['probability'], '--probability'),
    confidence: fractie(a['confidence'], '--confidence'),
    anchor: text(a['anchor'], '--anchor'),
    outcome: a['outcome'] === undefined || a['outcome'] === 'null' ? null : boolStrict(a['outcome'], '--outcome'),
    adopted: boolStrict(a['adopted'], '--adopted (creep meter-ul e obligatoriu, nu opțional)'),
  };
  adauga(cale, rand);
  console.log(`adăugat: ${rand.log_id}  p=${rand.probability}  outcome=${rand.outcome}  adopted=${rand.adopted}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// resolve — adaugă un rând corectat, nu rescrie nimic
// ---------------------------------------------------------------------------

function cmdResolve(a, cale) {
  const logId = text(a['log-id'], '--log-id');
  const outcome = boolStrict(a['outcome'], '--outcome');
  const anterior = ultimele(citeste(cale)).find(r => r.log_id === logId);
  if (!anterior) mori(`nu există niciun rând cu log_id="${logId}". Nu inventez unul.`);
  const rand = { ...anterior, ts: new Date().toISOString(), outcome };
  adauga(cale, rand);
  console.log(`rezolvat: ${logId}  p=${rand.probability}  outcome=${outcome}  (rând nou; istoria rămâne)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// latest — ultimul rând pentru un log_id, ca să se poată verifica din afară
// ---------------------------------------------------------------------------

function cmdLatest(a, cale) {
  const logId = text(a['log-id'], '--log-id');
  const r = ultimele(citeste(cale)).find(x => x.log_id === logId);
  if (!r) mori(`niciun rând cu log_id="${logId}".`);
  console.log(JSON.stringify(r));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// report — calibrarea, creep meter-ul, verdictul
// ---------------------------------------------------------------------------

const galeata = (p) => Math.min(9, Math.floor(p * 10));
const eticheta = (i) => `[${(i / 10).toFixed(1)},${((i + 1) / 10).toFixed(1)}${i === 9 ? ']' : ')'}`;

export function raport(randuri) {
  const toate = ultimele(randuri).sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
  const rezolvate = toate.filter(r => r.outcome === true || r.outcome === false);

  const galeti = [];
  for (let i = 0; i < 10; i++) {
    const g = rezolvate.filter(r => galeata(r.probability) === i);
    if (!g.length) continue;
    const prezis = g.reduce((s, r) => s + r.probability, 0) / g.length;
    const observat = g.filter(r => r.outcome === true).length / g.length;
    galeti.push({ i, n: g.length, prezis, observat, gap: prezis - observat, judecata: g.length >= PRAG_GALEATA });
  }

  const brier = rezolvate.length
    ? rezolvate.reduce((s, r) => s + Math.pow(r.probability - (r.outcome ? 1 : 0), 2), 0) / rezolvate.length
    : null;

  // Referința: un prezicător care ar fi spus mereu rata de bază a rezultatelor
  // rezolvate. Brier-ul lui e ō(1−ō). Skill = 1 − Brier/Brier_ref.
  const rataBaza = rezolvate.length ? rezolvate.filter(r => r.outcome === true).length / rezolvate.length : null;
  const brierRef = rataBaza === null ? null : rataBaza * (1 - rataBaza);
  const bss = (brier === null || !brierRef) ? null : 1 - brier / brierRef;
  const areValoare = bss !== null && bss > PRAG_BSS + EPS_BSS;

  const judecate = galeti.filter(g => g.judecata);
  const rupte = judecate.filter(g => Math.abs(g.gap) > TOLERANTA);
  const destul = rezolvate.length >= PRAG_TOTAL && judecate.length > 0;

  const ultimele20 = toate.slice(-FEREASTRA_CREEP);
  const adoptieTotal = toate.length ? toate.filter(r => r.adopted === true).length / toate.length : null;
  const adoptieRecent = ultimele20.length ? ultimele20.filter(r => r.adopted === true).length / ultimele20.length : null;

  return { toate, rezolvate, galeti, judecate, rupte, brier, rataBaza, brierRef, bss, areValoare, destul, adoptieTotal, adoptieRecent, ultimele20 };
}

function cmdReport(cale) {
  const r = raport(citeste(cale));
  const p3 = (x) => (x === null ? ' n/a ' : x.toFixed(3));

  console.log('');
  console.log('jev-journal — calibrare & creep meter');
  console.log(`jurnal: ${cale}`);
  console.log(`praguri (declarate, nu ascunse): minim ${PRAG_TOTAL} rânduri rezolvate · minim ${PRAG_GALEATA} pe găleată · toleranță |prezis−observat| ≤ ${TOLERANTA.toFixed(2)}`);
  console.log(`treceri: ${r.toate.length} · rezolvate: ${r.rezolvate.length} · în așteptare: ${r.toate.length - r.rezolvate.length}`);
  console.log('');

  console.log('(a) CALIBRARE — pe decile de probabilitate');
  console.log('    găleată      n    prezis  observat      gap  judecată');
  for (const g of r.galeti) {
    const marcaj = !g.judecata ? 'n<prag' : Math.abs(g.gap) > TOLERANTA ? 'RUPTĂ' : 'ok';
    console.log(`    ${eticheta(g.i).padEnd(12)}${String(g.n).padStart(3)}     ${p3(g.prezis)}     ${p3(g.observat)}   ${(g.gap >= 0 ? '+' : '') + g.gap.toFixed(3)}  ${marcaj}`);
  }
  if (!r.galeti.length) console.log('    (nicio găleată — niciun rând rezolvat)');
  console.log(`    Brier: ${p3(r.brier)}  (0 = perfect, 0.25 = monedă, 1 = invers pe toate)`);
  console.log(`    rata de bază (retrospectiv): ${p3(r.rataBaza)} · Brier-ul papagalului care o spune mereu: ${p3(r.brierRef)}`);
  console.log(`    Brier skill vs rata de bază: ${r.bss === null ? ' n/a  (referință perfectă sau fără rânduri — nedefinit, NU verde)' : (r.bss >= 0 ? '+' : '') + r.bss.toFixed(3)}  (prag: strict > ${PRAG_BSS.toFixed(3)})`);
  console.log('');

  console.log('(b) CREEP METER — influența fără vot crește cu prezența');
  console.log(`    adopție, total:        ${p3(r.adoptieTotal)}  (${r.toate.filter(x => x.adopted === true).length}/${r.toate.length})`);
  console.log(`    adopție, ultimele ${String(FEREASTRA_CREEP).padEnd(2)}:  ${p3(r.adoptieRecent)}  (${r.ultimele20.filter(x => x.adopted === true).length}/${r.ultimele20.length})`);
  if (r.adoptieTotal !== null && r.adoptieRecent !== null) {
    const panta = r.adoptieRecent - r.adoptieTotal;
    console.log(`    pantă:                 ${(panta >= 0 ? '+' : '') + panta.toFixed(3)}  ${panta > 0.15 ? '← ÎN CREȘTERE, de citit de om' : ''}`);
  }
  console.log('');

  if (!r.destul) {
    const de_ce = r.rezolvate.length < PRAG_TOTAL
      ? `doar ${r.rezolvate.length} rânduri rezolvate, prag ${PRAG_TOTAL}`
      : `nicio găleată nu atinge ${PRAG_GALEATA} rânduri`;
    console.log('not enough rows to judge calibration');
    console.log(`VERDICT: NEJUDECAT — ${de_ce}. Tăcere, nu verde.`);
    process.exit(0);
  }
  if (r.rupte.length) {
    console.log(`VERDICT: DECALIBRAT — ${r.rupte.length} găleată/găleți peste toleranța ${TOLERANTA.toFixed(2)}: ${r.rupte.map(g => `${eticheta(g.i)} gap ${g.gap.toFixed(3)} (n=${g.n})`).join('; ')}`);
    process.exit(2);
  }
  if (!r.areValoare) {
    console.log(`VERDICT: CALIBRAT-FĂRĂ-VALOARE — calibrat în toleranța ${TOLERANTA.toFixed(2)}, dar Brier skill ${r.bss === null ? 'nedefinit' : r.bss.toFixed(3)} nu e > ${PRAG_BSS.toFixed(3)}: nu bate un papagal care spune mereu rata de bază ${p3(r.rataBaza)}.`);
    process.exit(2);
  }
  console.log(`VERDICT: CALIBRAT — ${r.judecate.length} găleată/găleți judecate, toate în toleranța ${TOLERANTA.toFixed(2)}; Brier ${p3(r.brier)}; skill vs rata de bază +${r.bss.toFixed(3)}.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Autoproba — cu braț negativ REAL: un set decalibrat TREBUIE să facă roșu.
// Dacă nu-l face, verificarea nu verifică nimic și autoproba pică zgomotos.
// ---------------------------------------------------------------------------

function autoproba() {
  const eu = fileURLToPath(import.meta.url);
  let rele = 0;
  let probe = 0;
  const zi = (ok, nume, det) => { probe++; if (!ok) rele++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nume}${det ? ' — ' + det : ''}`); };

  // Amprenta jurnalului REAL, înainte. Niciun braț nu are voie s-o schimbe.
  const caleReala = caleJurnal();
  const amprenta = () => { try { const s = fs.statSync(caleReala); return `${s.size}:${s.mtimeMs}`; } catch { return 'absent'; } };
  const inainte = amprenta();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-journal-'));
  let nr = 0;
  const casaNoua = () => { const h = path.join(tmp, 'h' + (++nr)); fs.mkdirSync(h, { recursive: true }); return h; };
  const viu = (home, ...args) => spawnSync(process.execPath, [eu, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 20000 });

  const pune = (home, id, p, outcome, adopted) => viu(home, 'append',
    '--log-id', id, '--question', 'Va trece proba X?', '--decision', 'proceed',
    '--probability', String(p), '--confidence', '0.8', '--anchor', 'Rularea iese 0, sau nu.',
    '--outcome', String(outcome), '--adopted', String(adopted));

  // Un set cu găleți pline: 10×0.9, 10×0.5, 10×0.1, adevărate în proporția
  // promisă. 30 rezolvate ≥ 20, fiecare găleată 10 ≥ 5.
  // Ca `pune`, dar cu ancora dată dinafară — pentru probele de refuz.
  const pune2 = (home, id, ancora) => viu(home, 'append',
    '--log-id', id, '--question', 'Va trece proba X?', '--decision', 'proceed',
    '--probability', '0.5', '--confidence', '0.5', '--anchor', ancora, '--adopted', 'false');

  const seteaza = (home, adevarateLa09) => {
    for (let i = 0; i < 10; i++) pune(home, `c9-${i}`, 0.9, i < adevarateLa09, i % 3 === 0);
    for (let i = 0; i < 10; i++) pune(home, `c5-${i}`, 0.5, i < 5, i % 4 === 0);
    for (let i = 0; i < 10; i++) pune(home, `c1-${i}`, 0.1, i < 1, false);
  };

  // 1. Set CALIBRAT → verde.
  const hVerde = casaNoua(); seteaza(hVerde, 9);
  const verde = viu(hVerde, 'report');
  zi(verde.status === 0 && /VERDICT: CALIBRAT/.test(verde.stdout), 'set calibrat → VERDE', `status=${verde.status}`);

  // 2. BRAȚ NEGATIV: 0.9 promis, adevărat în 30% din cazuri → ROȘU.
  const hRosu = casaNoua(); seteaza(hRosu, 3);
  const rosu = viu(hRosu, 'report');
  const eRosu = rosu.status !== 0 && /VERDICT: DECALIBRAT/.test(rosu.stdout);
  zi(eRosu, 'BRAȚ NEGATIV: set decalibrat (0.9 promis, 0.3 real) → ROȘU',
    eRosu ? `status=${rosu.status}, ${(/VERDICT: DECALIBRAT.*/.exec(rosu.stdout) || [''])[0].slice(0, 96)}`
          : `status=${rosu.status} — VERIFICAREA NU VERIFICĂ NIMIC, autoproba pică`);

  // 2b. BRAȚ NEGATIV (2026-09-26): papagalul rămâne papagal. Un prezicător care
  //     spune MEREU rata de bază e perfect calibrat — înainte de skill score
  //     ieșea VERDE. Două rate (0.5 și 0.3), ca zgomotul de virgulă mobilă să
  //     nu poată strecura un +1e-16 drept „valoare".
  for (const [p, adevarate] of [[0.5, 15], [0.3, 9]]) {
    const hPapagal = casaNoua();
    for (let i = 0; i < 30; i++) pune(hPapagal, `pp-${i}`, p, i < adevarate, false);
    const papagal = viu(hPapagal, 'report');
    const ePapagal = papagal.status !== 0 && /VERDICT: CALIBRAT-FĂRĂ-VALOARE/.test(papagal.stdout) && !/VERDICT: CALIBRAT —/.test(papagal.stdout);
    zi(ePapagal, `BRAȚ NEGATIV: papagal la rata de bază (${p} mereu, ${adevarate}/30 adevărate) → NU verde, CALIBRAT-FĂRĂ-VALOARE`,
      `status=${papagal.status}, ${(/Brier skill vs rata de bază:.*/.exec(papagal.stdout) || [''])[0].slice(0, 60)}`);
  }
  // 2c. Rezultate toate identice: referința e perfectă, skill-ul nedefinit —
  //     tot NU verde, oricât de bine ar arăta calibrarea.
  const hUniform = casaNoua();
  for (let i = 0; i < 25; i++) pune(hUniform, `u-${i}`, 0.95, true, false);
  const uniform = viu(hUniform, 'report');
  zi(uniform.status !== 0 && /CALIBRAT-FĂRĂ-VALOARE/.test(uniform.stdout),
    'rezultate toate adevărate (skill nedefinit) → NU verde', `status=${uniform.status}`);
  // 2d. Setul verde din proba 1 chiar ARE skill tipărit și pozitiv — verdele nu
  //     e verde din lipsa liniei.
  zi(/Brier skill vs rata de bază: \+0\.\d{3}/.test(verde.stdout) && /skill vs rata de bază \+/.test(verde.stdout),
    'setul calibrat verde își arată skill-ul pozitiv și pragul', `${(/Brier skill vs rata de bază:.*/.exec(verde.stdout) || [''])[0].slice(0, 70)}`);

  // 3-5. Rânduri refuzate: probabilitate în afara intervalului, ancoră lipsă,
  //      întrebare lipsă. Toate trebuie să iasă 2 și să nu scrie nimic.
  const hRef = casaNoua();
  const sus  = pune(hRef, 'x1', 1.5, true, false);
  const jos  = pune(hRef, 'x2', -0.1, true, false);
  const nan  = pune(hRef, 'x3', '0.9abc', true, false);
  zi(sus.status === 2 && jos.status === 2 && nan.status === 2,
    'probabilitate în afara [0,1] sau ne-număr → refuzată', `1.5→${sus.status}, -0.1→${jos.status}, "0.9abc"→${nan.status}`);
  const faraAncora = viu(hRef, 'append', '--log-id', 'x4', '--question', 'q?', '--decision', 'proceed', '--probability', '0.5', '--confidence', '0.5', '--adopted', 'false');
  zi(faraAncora.status === 2 && /REFUZ/.test(faraAncora.stderr), 'ancoră lipsă → refuzată', `status=${faraAncora.status}`);
  const faraIntrebare = viu(hRef, 'append', '--log-id', 'x5', '--decision', 'proceed', '--probability', '0.5', '--confidence', '0.5', '--anchor', 'a', '--adopted', 'false');
  zi(faraIntrebare.status === 2 && /REFUZ/.test(faraIntrebare.stderr), 'întrebare lipsă → refuzată', `status=${faraIntrebare.status}`);
  // Ancoră scrisă "null" / "undefined" — calea prin care nota de formă
  // (midjourney.md: `ancora` mereu null) ar intra în registrul de calibrare.
  const ancoraNull = pune2(hRef, 'x7', 'null');
  const ancoraUndef = pune2(hRef, 'x8', 'undefined');
  const ancoraNULL = pune2(hRef, 'x9', 'NULL');
  zi(ancoraNull.status === 2 && ancoraUndef.status === 2 && ancoraNULL.status === 2,
    'ancoră "null"/"undefined"/"NULL" → refuzată (al doilea scaun nu poate intra în calibrare)',
    `null→${ancoraNull.status}, undefined→${ancoraUndef.status}, NULL→${ancoraNULL.status}`);

  const faraAdoptat = viu(hRef, 'append', '--log-id', 'x6', '--question', 'q?', '--decision', 'proceed', '--probability', '0.5', '--confidence', '0.5', '--anchor', 'a');
  zi(faraAdoptat.status === 2, 'adopted lipsă → refuzată (creep meter-ul nu e opțional)', `status=${faraAdoptat.status}`);
  zi(!fs.existsSync(caleJurnal(hRef)), 'un rând refuzat NU ajunge în jurnal', `jurnal existent: ${fs.existsSync(caleJurnal(hRef))}`);

  // 6. Date puține → tăcere, exit 0, și NU verde.
  const hSubtire = casaNoua();
  for (let i = 0; i < 3; i++) pune(hSubtire, `s-${i}`, 0.9, true, false);
  const subtire = viu(hSubtire, 'report');
  zi(subtire.status === 0 && /not enough rows to judge calibration/.test(subtire.stdout) && !/VERDICT: CALIBRAT/.test(subtire.stdout),
    'date puține → "not enough rows to judge calibration", exit 0, NU verde', `status=${subtire.status}`);

  // 7. Destule rânduri, dar nicio găleată plină → tot tăcere, nu verde.
  //    Fără brațul ăsta, 25 de rânduri subțiri ar putea trece drept verde.
  const hImprastiat = casaNoua();
  for (let i = 0; i < 25; i++) pune(hImprastiat, `i-${i}`, (i % 10) / 10 + 0.05, i % 2 === 0, false);
  const imprastiat = viu(hImprastiat, 'report');
  zi(imprastiat.status === 0 && /not enough rows to judge calibration/.test(imprastiat.stdout) && !/VERDICT: CALIBRAT/.test(imprastiat.stdout),
    '25 rânduri dar găleți subțiri → tot tăcere, nu verde', `status=${imprastiat.status}`);

  // 8. resolve ia ULTIMUL rând per log_id: null → true → false.
  const hRes = casaNoua();
  viu(hRes, 'append', '--log-id', 'r1', '--question', 'q?', '--decision', 'proceed',
    '--probability', '0.7', '--confidence', '0.6', '--anchor', 'a', '--adopted', 'true');
  const r1 = viu(hRes, 'resolve', '--log-id', 'r1', '--outcome', 'true');
  const r2 = viu(hRes, 'resolve', '--log-id', 'r1', '--outcome', 'false');
  const ultim = viu(hRes, 'latest', '--log-id', 'r1');
  let parsat = null; try { parsat = JSON.parse(ultim.stdout); } catch { /* rămâne null */ }
  const linii = fs.readFileSync(caleJurnal(hRes), 'utf8').trim().split('\n').length;
  zi(r1.status === 0 && r2.status === 0 && parsat?.outcome === false && linii === 3,
    'resolve: ultimul rând per log_id câștigă, istoria rămâne', `outcome final=${parsat?.outcome}, linii în fișier=${linii} (3 = append-only)`);
  const inexistent = viu(hRes, 'resolve', '--log-id', 'nu-exista', '--outcome', 'true');
  zi(inexistent.status === 2, 'resolve pe un log_id inexistent → refuz', `status=${inexistent.status}`);

  // 9. Jurnal corupt → cade închis, nu raportează pe jumătate.
  const hCorupt = casaNoua();
  pune(hCorupt, 'ok-1', 0.5, true, false);
  fs.appendFileSync(caleJurnal(hCorupt), '{asta nu e json\n');
  const corupt = viu(hCorupt, 'report');
  zi(corupt.status === 2 && /corupt/.test(corupt.stderr), 'jurnal corupt → cade închis', `status=${corupt.status}`);

  // 10. Jurnalul REAL neatins de toate cele de mai sus.
  const dupa = amprenta();
  zi(dupa === inainte, 'jurnalul real neatins', `${caleReala}: ${inainte} → ${dupa}`);

  fs.rmSync(tmp, { recursive: true, force: true });
  if (rele) { console.log(`autoproba: ${rele} EȘECURI`); process.exit(2); }
  console.log(`autoproba: ${probe} probe, 0 eșecuri`);
  process.exit(0);
}

// ---------------------------------------------------------------------------

function folosire() {
  console.error(`
jev-journal.mjs <subcomandă>

  append  --log-id <id> --question <q> --decision <d> --probability <0..1>
          --confidence <0..1> --anchor <ce l-ar dovedi greșit>
          --adopted true|false [--outcome true|false|null]
  resolve --log-id <id> --outcome true|false
  latest  --log-id <id>
  report
  --autoproba
`);
  process.exit(2);
}

if (process.argv.includes('--autoproba')) autoproba();
else {
  const sub = process.argv[2];
  const a = argumente(process.argv.slice(3));
  const cale = caleJurnal();
  if (sub === 'append') cmdAppend(a, cale);
  else if (sub === 'resolve') cmdResolve(a, cale);
  else if (sub === 'latest') cmdLatest(a, cale);
  else if (sub === 'report') cmdReport(cale);
  else folosire();
}
