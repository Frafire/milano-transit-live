// The ricoveri during a closure (the Excel's sheet Ricoveri; web/agents.js): a train inside the closed stretch is ordered to
// let everybody off at a station and go into a tail or a rimessa track, where it stands switched off; the regolatore calls
// it back when its way out is open again, and it goes back into service.
// - BRE, the tail of Brenta (Giovanni 20 Nov 2026): San Donato – Centrale closed, a train going towards San Donato north of
//   Lodi T.I.B.B.: off at Lodi, in by BRE-2; not out while the stretch is closed; out by BRE-1 and in service again
// - CEN2, Bin rimessa Centrale 2 (Giovanni 21 Nov 2026): Porta Romana – Centrale closed, a train going towards Comasina with
//   Repubblica ahead: off at Repubblica, in by REP-3 with the whole train beyond #A138; not out while Repubblica is closed;
//   out by REP-10 to Repubblica, change of cab, in service towards Comasina
// Run from build/:  node ../tests/ricoveri_check.js
const L = require('./lib.js');
const { M, D } = L.load(), day = L.runDay(M, D), CL = M.net.closures;
let fail = 0;
const hm = t => Math.floor(t / 3600) + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0');

function play(key, closure, tailName, itIn, itOut, dirBack) {
  const c = CL.find(c => c.label.startsWith(closure)); if (!c) return { ok: false, why: 'no closure ' + closure };
  const T = 9 * 3600, ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T - 600, L.posAt(day, T - 600)); ag.step(T);
  ag.event({ kind: 'close', cl: { a: c.a, b: c.b, ends: {} }, label: c.label });
  // the first train inside that is offered the ricovero with nobody on its way there (the radio says who is, and that it
  // will wait: a train behind another one standing in the closed stretch never gets there), within 10 minutes
  let k = -1, t = T, behind = 0;
  for (; t <= T + 600 && k < 0; t += 30) { ag.step(t); behind = 0;
    k = ag.agents().findIndex(a => { const x = a && a.mode === 'inside' && ag.instrOptions(a.k).find(x => x.key === key); if (x && x.blocked.length) behind++; return x && !x.blocked.length; }); }
  if (k < 0) return { ok: false, why: 'the order ' + key + ' offered to no train with its way free', behind };
  const label = ag.instrOptions(k).find(x => x.key === key).label;
  ag.event({ kind: 'order', k, what: 'instr', arg: { key } });
  const A = () => ag.agents()[k];
  for (; t <= T + 3600 && A().mode !== 'static'; t += 10) ag.step(t);
  const parkedAt = t, a = A(), tail = a.inTail;
  if (a.mode !== 'static' || tail == null) return { ok: false, why: 'never parked', mode: a.mode, status: a.status, legs: a.legs.map(l => l.kind || l.pid) };
  // the train stands on the last piece of the way in
  const lastEdge = M.net.itineraries.find(i => i.id === itIn).ways[0].slice(-1)[0], onEnd = (ag.occ(lastEdge) || []).some(z => z[0] === k);
  // called back while its way out is closed: refused
  const refused = ag.event({ kind: 'regola', what: 'recall', k }) === false;
  ag.event({ kind: 'reopen' });
  const recalled = ag.event({ kind: 'regola', what: 'recall', k }) !== false;
  const outLegs = A().legs.map(l => l.kind || (l.pcf && l.pcf.id) || l.pid);
  let service = null; const t1 = ag.S.t;
  for (let t2 = t1 + 20; t2 <= t1 + 5400 && service == null; t2 += 20) { ag.step(t2); const b = A(); if (b.status === 'service' && b.v > 1) service = { t: t2, dir: b.legs[0] && b.legs[0].dir }; }
  const rt = ag.rt(), revs = (ag.S.revs || []).filter(r => r.k === k).length;
  const ok = onEnd && refused && recalled && outLegs.includes(itOut) && !!service && (!dirBack || service.dir === dirBack) && !(rt.viol || 0) && !(rt.swViol || 0);
  return { ok, train: k, label, parked: hm(parkedAt), tail, onEnd, refusedWhileClosed: refused, recalled, out: outLegs.join(','), service: service && hm(service.t) + ' ' + service.dir, cabChanges: revs, viol: (rt.viol || 0) + (rt.swViol || 0), behindOthers: behind };
}

for (const [key, closure, name, itIn, itOut, dirBack] of [
  ['BRE', 'San Donato – Centrale', 'tronchetto di Brenta', 'BRE-2', 'BRE-1', 'S'],
  ['CEN2', 'Porta Romana – Centrale', 'Bin rimessa Centrale 2', 'REP-3', 'REP-10', 'N'],
]) {
  const r = play(key, closure, name, itIn, itOut, dirBack);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ricovero ${key} (${name}): ${JSON.stringify(r)}`); if (!r.ok) fail++;
}
process.exit(fail ? 1 : 0);
