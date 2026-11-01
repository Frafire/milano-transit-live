// Failures (web/faults.js, foglio Guasti, fase D1). For each kind of failure of a train: give it at 08:00 to a train
// in service, nobody answers (the PC answers by itself after 3 minutes), run to 10:00. Checks: the train does what the
// failure says (stands for the re-arming, longer at the station...), the failure ends (not the ATO one: manual all day),
// no signal or switch passed without its route, no two trains on one track piece. Then the random failures from 06:00 to
// 13:00: some happen, all end, the same again gives the same day, also after going back in time.
// Usage (from build/): node ../tests/faults_check.js [kind]
const L = require('./lib.js');
const { M, D } = L.load();
const day = L.runDay(M, D), H = M.half;
const KINDS = Object.keys(require('../web/faults.js').KINDS).filter(k => !process.argv[2] || k === process.argv[2]);
let fail = 0;
function overlaps(ag) {
  const byEdge = new Map(); let n = 0;
  ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
    for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue;
      const k = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
      (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k]); } });
  for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i][0] !== list[j][0] && Math.max(list[j][1] - list[i][2], list[i][1] - list[j][2]) < 0) n++;
  return n;
}
const T0 = 8 * 3600, T1 = 10 * 3600;
for (const kind of KINDS) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  // a train in service, running, in the middle of the line
  const a = ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 17);
  const id = ag.event({ kind: 'fault', what: 'new', fault: kind, k: a.k });
  let ov = 0, stood = 0, longDwell = 0, endT = null, phases = new Set(), lastD = a.d;
  for (let t = T0 + 10; t <= T1; t += 10) {
    ag.step(t);
    const f = ag.S.faults.list.find(x => x.id === id);
    phases.add(f.ph + (f.tech ? '/' + f.tech : ''));
    if (f.done && endT == null) endT = f.done;
    if (!f.done) { if (a.v === 0 && a.stopAt == null) stood += 10; if (a.stopAt != null && a.v === 0) longDwell += 10; }
    if (t % 60 === 0) ov += overlaps(ag);
  }
  const rt = ag.rt(), f = ag.S.faults.list.find(x => x.id === id), say = ag.S.faults.feed.filter(x => x.id === id || x.k === a.k);
  // what must happen: the train stands (re-arming), longer at a station, manual driving, the failure is over
  const want = { trazione: stood + longDwell >= 240, freno: stood >= 200, riarmo: stood >= 100, porta: longDwell >= 60, porte_persone: longDwell >= 30,
                 allarme: longDwell >= 60, malore_treno: longDwell >= 1200, ato: true }[kind];
  const ended = kind === 'ato' ? !f.done || a.hidden || a.status === 'parked' : f.done != null;
  const techOk = kind !== 'riarmo' || [...phases].some(x => x.endsWith('/board'));
  const bad = !id || ov || rt.viol || rt.swViol || !want || !ended || !techOk;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${kind} on train ${a.k + 1}: phases ${[...phases].join(' > ')} | standing in the line ${Math.round(stood / 60)} min, at stations ${Math.round(longDwell / 60)} min | ${kind === 'ato' ? (f.done ? 'manual until it left the service' : 'still manual at 10:00') : 'over at ' + (endT ? new Date(endT * 1000).toISOString().slice(11, 16) : 'never')} | radio ${say.length} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  for (const m of say.slice(0, 4)) console.log('       ' + new Date(m.t * 1000).toISOString().slice(11, 19) + ' ' + m.who + ': ' + m.text.replace('{T}', a.k + 1));
  if (bad) fail++;
}
// random failures: 06:00 to 13:00, twice the same; then back to 09:00 and on again to 13:00
if (!process.argv[2]) {
  const R0 = 6 * 3600, R1 = 13 * 3600;
  const runR = () => { const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(R0 - 600, L.posAt(day, R0 - 600)); ag.step(R0); ag.event({ kind: 'fault', what: 'random', on: true });
    let ov = 0; for (let t = R0 + 60; t <= R1; t += 60) { ag.step(t); ov += overlaps(ag); } return { ag, ov }; };
  const t0 = Date.now(), A = runR(), B = runR(), key = ag => ag.S.faults.list.map(f => `${f.t0}:${f.kind}:${f.k}:${f.done}`).join(',');
  const byKind = {}; A.ag.S.faults.list.forEach(f => { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
  const open = A.ag.S.faults.list.filter(f => !f.done && f.kind !== 'ato' && f.t0 < R1 - 2 * 3600).length;
  const same = key(A.ag) === key(B.ag);
  A.ag.seek(9 * 3600); A.ag.seek(R1); const again = key(A.ag) === key(B.ag);
  const rt = A.ag.rt(), n = A.ag.S.faults.list.length;
  const bad = !n || A.ov || rt.viol || rt.swViol || open || !same || !again;
  console.log(`${bad ? 'FAIL' : 'ok  '} random 06:00-13:00: ${n} failures ${JSON.stringify(byKind)} | not over 2 h later: ${open} | the same twice: ${same}, after going back to 09:00: ${again} | overlaps ${A.ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  if (bad) fail++;
}
process.exit(fail ? 1 : 0);
