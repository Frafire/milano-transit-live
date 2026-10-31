// The rules of the route interlocking (web/routes.js) one by one, on the built line:
//  1) a movement that the rules do not give for the normal service is set only with the PC's authorisation;
//  2) a siding with a capacity takes no more trains than that;
//  3) a switch that must change position: the route is ready only after the blade and the signal delay;
//  4) a signal worked by the PC opens only with its authorisation.
// Run from the build folder: node ../tests/routes_rules_check.js
const M = require(process.cwd() + '/m3.json'), R = require('../web/routes.js');
const RT = R.create({ sigall: M.net.sigall, pathEdges: M.path_edges, netEdges: M.net.edges, itineraries: M.net.itineraries, times: M.net.route_rules.times, capacity: M.net.route_rules.capacity, pcSignals: M.net.route_rules.pcSignals });
const IT = {}; M.net.itineraries.forEach(i => { IT[i.id] = i; });
let fail = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fail++; };
// a path that runs a movement of the table (its usual way) and where its start signal is on that path
function onPath(id) {
  const it = IT[id], W = it.ways[0];
  for (let pid = 0; pid < M.path_edges.length; pid++) {
    const e = (M.path_edges[pid] || { e: [] }).e.map(x => x[0]), i = e.indexOf(W[0]);
    if (i < 0 || W.some((x, j) => e[i + j] !== x)) continue;
    const s = (M.net.sigall[pid] || []).find(x => x[1] === it.start); if (s) return { pid, d: s[0] };
  }
  return null;
}
const none = () => [];
// 1) single track / breakdown movements: only with the PC
const odd = M.net.itineraries.find(i => i.start != null && !['servizio normale', 'mattina', 'sera', 'ritardo'].includes(i.when) && onPath(i.id));
{ const st = RT.fresh(), p = onPath(odd.id);
  const a = RT.request(st, 1, p.pid, p.d, odd.start, none);
  ok(!a && st.lastNo && st.lastNo.pc === 'id:' + odd.id, `${odd.id} (${odd.when}) refused without the PC: ${JSON.stringify(st.lastNo)}`);
  RT.authorize(st, 'id:' + odd.id);
  ok(RT.request(st, 1, p.pid, p.d, odd.start, none), `${odd.id} set once the PC authorised it`);
  const p2 = onPath(odd.id); RT.release(st, 1, -1, 0, true);
  ok(!RT.request(st, 2, p2.pid, p2.d, odd.start, none), `${odd.id} refused again for the next train (one authorisation, one train)`); }
// 2) capacity (no path of the day goes into the Brenta tail: the rule tried on Comasina tail 1 as if it took one train)
{ const p = onPath('CON-7'), W = IT['CON-7'].ways[0], tailE = W[W.length - 1];
  const RT2 = R.create({ sigall: M.net.sigall, pathEdges: M.path_edges, netEdges: M.net.edges, itineraries: M.net.itineraries, capacity: { [tailE]: 1 } });
  const sp = RT2.span(p.pid, p.d, RT2.nextSignal(p.pid, p.d)).pieces.find(x => x[0] === tailE), L = M.net.edges[tailE].len;
  // a train in the part of the tail the route does not reach (further in)
  const out = sp[1] > 5 ? [2, sp[1] - 1] : [sp[2] + 1, L - 2];
  const st = RT2.fresh(), occ = ei => +ei === tailE ? [[7, out[0], out[1]]] : [];
  ok(!RT2.request(st, 1, p.pid, p.d, 11, occ) && st.lastNo && st.lastNo.full === tailE, `a tail for one train with a train in it: refused (${JSON.stringify(st.lastNo)})`);
  ok(RT2.request(st, 1, p.pid, p.d, 11, none), 'the same tail empty: set'); }
// 3) blade and signal: SD-1 then SD-2 from the same signal (the switch between the two tails changes)
{ const st = RT.fresh(); st.t = 1000; const a = onPath('SD-1'), b = onPath('SD-2');
  RT.request(st, 1, a.pid, a.d, 40, none); const r1 = st.routes[1][0];
  ok(r1.ready === 1000 + M.net.route_rules.times.signal, `first route: ready after the signal delay (${r1.ready - 1000} s)`);
  RT.release(st, 1, -1, 0, true); st.t = 2000;
  RT.request(st, 2, b.pid, b.d, 40, none); const r2 = st.routes[2][0];
  ok(r2.ready === 2000 + M.net.route_rules.times.blade + M.net.route_rules.times.signal, `the switch changes: ready after blade + signal (${r2.ready - 2000} s)`);
  ok(!RT.ready(st, 2, b.pid, b.d), 'not ready before'); st.t = r2.ready; ok(RT.ready(st, 2, b.pid, b.d), 'ready then'); }
// 4) the PC's signals
{ const n = M.net.route_rules.pcSignals[0]; let p = null;
  for (const [pid, l] of Object.entries(M.net.sigall)) { const s = l.find(x => x[1] === n); if (s) { p = { pid: +pid, d: s[0] }; break; } }
  if (p) { const st = RT.fresh(); ok(!RT.request(st, 1, p.pid, p.d, n, none), `#A${n} (worked by the PC): red without the PC`); RT.authorize(st, 'n:' + n); RT.authorize(st, 'id:' + (M.net.itineraries.find(i => i.start === n) || {}).id);
    ok(RT.request(st, 1, p.pid, p.d, n, none), `#A${n}: set with the PC`); }
  else console.log(`(#A${n} is on no path)`); }
process.exit(fail ? 1 : 0);
