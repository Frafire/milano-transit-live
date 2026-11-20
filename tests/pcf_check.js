// A train on the itineraries prepared by the PC off its run (web/agents.js, paths of the game; Giovanni 18-20 Nov 2026):
// the first train at the signal takes the itinerary, the wrong way at 30 km/h at most with a stop at the platforms of the
// open stations, stops at the red at the end, takes the next one, and back on its own track goes on with its timetable.
// Also an itinerary no path of the build goes along (SON-3): formed from its own track pieces.
// Usage (from build/): node ../tests/pcf_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const day = L.runDay(M, D);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const ITS = Object.fromEntries((M.net.itineraries || []).map(x => [x.id, x]));
function chain(ids, T0) {
  const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T0, L.posAt(day, T0));
  let i = 0, k = null, vmaxIll = 0, stops = [], back = null, tDiv = null; const formed = [];
  const tryForm = () => { const it = ITS[ids[i]]; const r = ag.event({ kind: 'pccmd', what: 'form', id: it.id }); if (r == null) { ag.event({ kind: 'pc', key: 'id:' + it.id }); formed.push(it.id); i++; return true; } return false; };
  // (formed when a train is coming to its signal, 250 to 900 m away, as the PC does: formed too early it holds up the others)
  const SA = M.net.sigall, half = M.half, coming = n => ag.agents().some(x => x && !x.hidden && (SA[x.pid] || []).some(y => y[1] === n && y[0] - (x.d + half) > 250 && y[0] - (x.d + half) < 900));
  for (let t = T0 + 2; t < T0 + 5400 && back == null; t += 2) {
    if (i === 0 && coming(ITS[ids[0]].start)) tryForm();
    ag.step(t);
    const A = ag.agents();
    if (k == null) { const a = A.find(x => x && x.pcf); if (a) { k = a.k; tDiv = t; } continue; }
    const a = A[k];
    if (a.pcf && a.legs[0] && a.legs[0].ill) vmaxIll = Math.max(vmaxIll, a.v * 3.6);
    if (a.pcf && a.stopAt != null && !stops.includes(a.stopAt)) stops.push(a.stopAt);
    if (a.pcf && a.legs[0] && a.legs[0].kind === 'pcfwait' && i < ids.length && a.pcf.end === ITS[ids[i]].start) tryForm();
    if (!a.pcf && i >= ids.length) back = { t, pid: a.pid, si: a.si, stops: (a.legs[0] && a.legs[0].stops || []).map(z => z.st), mode: a.mode };
  }
  return { ag, k, vmaxIll, stops, back, tDiv, formed };
}
// (COS-4: into Comasina on binario 1, the departure platform, the wrong way: at the terminus it takes its own next run
// from there, after the change of cab)
const LAST = M.degraded.names.length - 1;
for (const [ids, T0, wantStop] of [[['SON-4', 'ZS-5'], 6 * 3600 + 1200, 14], [['SON-3', 'CEN-7'], 6 * 3600 + 1200, 13], [['COS-4'], 9 * 3600, LAST]]) {
  const r = chain(ids, T0), rt = r.ag.rt(), plan = r.k != null ? M.trains[r.k] : null;
  ok(r.formed.length === ids.length, `${ids.join(' → ')}: formed ${r.formed.join(', ')}`);
  ok(r.k != null, `${ids[0]}: taken by train ${r.k} at ${r.tDiv != null ? Math.round(r.tDiv - T0) + ' s' : '—'}`);
  ok(r.vmaxIll > 5 && r.vmaxIll <= 30.5, `${ids[0]}: the wrong way at ${r.vmaxIll.toFixed(1)} km/h at most (30)`);
  ok(r.stops.includes(wantStop), `${ids.join(' → ')}: served the platform of station ${wantStop} on the itineraries (${r.stops.join(', ')})`);
  ok(r.back && r.back.mode === 'plan' && plan && plan[r.back.si] && plan[r.back.si][0] === r.back.pid, `back on its run: path ${r.back && r.back.pid}, next stops ${r.back && r.back.stops.slice(0, 3).join(', ')}`);
  ok(!rt.viol && !rt.swViol, `no signal or switch passed without a route (${rt.viol || 0}, ${rt.swViol || 0})`);
  // back in time before the train took it and forward again: the same
  const ag = r.ag, t1 = ag.S.t; if (r.back) { ag.seek(r.tDiv - 60); ag.seek(t1); }
  ok(r.back && ag.agents()[r.k].pid === r.back.pid, 'back in time and forward again: the same path');
}
process.exit(fail ? 1 : 0);
