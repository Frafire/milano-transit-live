// One engine: a normal day driven by the agents (web/agents.js) following the timetable, started from the day driven
// at build time (tools/precompute_live.js) and compared with it. Checks: never two trains on the same track piece, nobody stuck, punctuality
// close to the computed day, and going back in time gives the same result (saved states).
// Usage (from build/): node ../tests/day_agents_check.js [from hour] [to hour]
const L = require('./lib.js'), E = L.E, A = require('../web/agents.js');
const { M, D } = L.load();
const G = M.degraded;
const H0 = +(process.argv[2] || 5), H1 = +(process.argv[3] || 12);
const base = L.runDay(M, D);
const posAt = t => L.posAt(base, t);
const mk = () => L.agents(M, D, posAt);
const ag = mk(), T0 = H0 * 3600, T1 = H1 * 3600, t0 = Date.now();
ag.start(T0, posAt(T0)); ag.snapshot();
let overlap = 0, minGap = Infinity, late = [], stuck = 0, worstDeparture = null;
const moved = new Map();
for (let t = T0 + 30; t <= T1; t += 30) {
  ag.step(t);
  const byEdge = new Map();
  ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
    for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - M.half || x0 > a.d + M.half) continue;
      const k = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - M.half, x0), q = Math.min(a.d + M.half, x1);
      (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k]); } });
  for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i][0] === list[j][0]) continue; const g = Math.max(list[j][1] - list[i][2], list[i][1] - list[j][2]); minGap = Math.min(minGap, g); if (g < 0) overlap++; }
  ag.agents().forEach(a => { if (a.late != null && a.status === 'service' && a.lateSeen !== a.late) {
    a.lateSeen = a.late; late.push(a.late);
    if (!worstDeparture || a.late > worstDeparture.delay) worstDeparture = { delay: a.late, train: a.k + 1, station: G.names[a.at] || '', time: t };
  }
    const m = moved.get(a.k); if (!m || Math.abs(m.d - a.d) > 1 || m.pid !== a.pid) moved.set(a.k, { d: a.d, pid: a.pid, t }); });
}
ag.agents().forEach(a => { const m = moved.get(a.k); if (a.mode === 'plan' && a.status !== 'parked' && S_waiting(a) === false && m && T1 - m.t > 1200) { stuck++;
  if (process.env.DBG) { const l = a.legs[0] || {}; console.log('  stuck', a.k, a.status, 'since', Math.floor(m.t / 3600) + ':' + String(Math.floor(m.t / 60) % 60).padStart(2, '0'), 'pid', a.pid, Math.round(a.d), 'si', a.si, 'why', a.why, JSON.stringify(a.red && a.red.why), 'leg', l.pid, l.status, Math.round(l.end)); } } });
function S_waiting(a) { return ag.S.t < a.wait; }
late.sort((p, q) => p - q);
const q = f => Math.round(late[Math.floor((late.length - 1) * f)] || 0);
const ms = Date.now() - t0;
// the computed day: departures late against the plan in the same hours
const bl = []; base.res.forEach(r => r.log.forEach(e => { if (e.status === 'service' && e.planned > T0 && e.planned < T1) bl.push(e.actual - e.planned); })); bl.sort((p, q2) => p - q2);
console.log(`agents ${H0}:00-${H1}:00: ${ms} ms | two trains on one track piece: ${overlap} (closest ${Math.round(minGap)} m) | stuck 20+ min: ${stuck}`);
console.log(`  service departures late vs timetable (s): median ${q(0.5)}, 90% ${q(0.9)}, worst ${q(1)}${worstDeparture ? ` (train ${worstDeparture.train}, ${worstDeparture.station}, ${Math.floor(worstDeparture.time / 3600)}:${String(Math.floor(worstDeparture.time / 60) % 60).padStart(2, '0')})` : ''} | max allowed 120 s`);
console.log(`  the computed day, arrivals: median ${Math.round(bl[bl.length >> 1] || 0)}, 90% ${Math.round(bl[Math.floor(bl.length * 0.9)] || 0)}`);
// back in time: from a saved state, the same positions again
const tA = T0 + 3600 + 300, before = (ag.seek(tA), ag.agents().map(a => [a.pid, Math.round(a.d)]).join(';'));
ag.seek(T1); ag.seek(tA);
const after = ag.agents().map(a => [a.pid, Math.round(a.d)]).join(';');
console.log(`  going back in time to ${Math.floor(tA / 3600)}:${String(Math.floor(tA / 60) % 60).padStart(2, '0')}: same positions again: ${before === after}`);
if (overlap || stuck || q(1) > 120 || before !== after) process.exit(1);
