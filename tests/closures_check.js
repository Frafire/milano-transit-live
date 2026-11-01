// Closures (foglio Chiusure, web/agents.js): for each closure that really happens, close it at 08:00, reopen at 09:00,
// run to 10:00. Checks: never two trains on one track piece, no signal or switch of the line passed without its route,
// no route over the closed stretch while it is closed, the trains on the open sides keep moving (servizio limitato),
// after reopening the trains take timetable runs again. Usage (from build/): node ../tests/closures_check.js [index]
const L = require('./lib.js');
const { M, D } = L.load();
const day = L.runDay(M, D), CL = M.net.closures;
const which = process.argv[2] != null ? [+process.argv[2]] : CL.map((c, i) => i);          // all of them (also those that never happened: they are made of the same ends)
// and with one track only at an end (rules closure_one_track: another turn, or a navetta), for those that happen
const OT = M.net.closure_one_track || {}, last = M.degraded.names.length - 1, runs = [];
for (const ci of which) {
  runs.push([ci, {}]);
  if (process.argv[2] == null && !(CL[ci].often === 'sì' || CL[ci].often === 'raramente')) continue;
  for (const [X, dir] of [[CL[ci].a, 'N'], [CL[ci].b, 'S']]) for (const t of Object.keys(OT[X + ':' + dir] || {})) if (X > 0 && X < last && !OT[X + ':' + dir][t].same) runs.push([ci, { [X]: t }]);
}
const TC = 8 * 3600, TR = 9 * 3600, TE = 10 * 3600, H = M.half;
let fail = 0;
for (const [ci, ends] of runs) {
  const c = CL[ci], ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(TC - 600, L.posAt(day, TC - 600)); ag.step(TC);
  ag.event({ kind: 'close', cl: { a: c.a, b: c.b, ends }, label: c.label });
  const endTxt = Object.entries(ends).map(([x, t]) => ` [${M.degraded.names[x]}: solo binario ${t === '1' ? 2 : 1}]`).join('');
  let navMoved = 0, navT = null;
  const closed = ag.closed(), closed0 = ag.closed0() || closed, before = new Set(Object.values(ag.rt().routes).flat());
  let overlap = 0, minGap = Infinity, intoClosed = 0, moved = new Map(), stuckOpen = 0;
  const modes = {}; ag.agents().forEach(a => { modes[a.mode] = (modes[a.mode] || 0) + 1; });
  for (let t = TC + 30; t <= TE; t += 30) {
    ag.step(t);
    if (t === TR) {
      ag.agents().forEach(a => { const m = moved.get(a.k); if (a.mode === 'shuttle' && !a.hidden && !(ag.S.t < a.wait) && m && TR - m.t > 1200) stuckOpen++; });
      ag.event({ kind: 'reopen' });
    }
    const byEdge = new Map();
    ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
      for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue;
        const k = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
        (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k]); } });
    for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i][0] === list[j][0]) continue; const g = Math.max(list[j][1] - list[i][2], list[i][1] - list[j][2]); minGap = Math.min(minGap, g); if (g < 0) overlap++; }
    if (t < TR) for (const [k, rs] of Object.entries(ag.rt().routes)) { const a = ag.agents()[+k]; if (a && a.mode !== 'inside' && a.mode !== 'held' && !a.exitClosed) { const C = a.mode === 'navetta' || a.navOut ? closed0 : closed; for (const r of rs) if (!before.has(r) && r.pieces.some(x => C.has(x[0]) && x[2] - x[1] > 8)) intoClosed++; } }
    ag.agents().forEach(a => { const m = moved.get(a.k); if (!m || Math.abs(m.d - a.d) > 1 || m.pid !== a.pid) moved.set(a.k, { d: a.d, pid: a.pid, t });
      if (a.mode === 'navetta' && t < TR) { if (navT !== a.at && a.stopAt != null) { navMoved++; navT = a.at; } } });
  }
  const rt = ag.rt(), after = {}; ag.agents().forEach(a => { after[a.mode] = (after[a.mode] || 0) + 1; });
  const stuck = ag.agents().filter(a => { const m = moved.get(a.k); return !a.hidden && a.status !== 'parked' && a.mode !== 'static' && a.status !== 'stopped' && m && TE - m.t > 1500 && !(ag.S.t < a.wait); }).length;
  const navNeeded = ag.S.log.some(x => x.nav && !x.none) || ag.S.log.some(x => x.nav && x.none);
  const navBad = Object.keys(ends).length && ag.S.log.some(x => x.nav) && navMoved < 3;
  const bad = overlap || rt.viol || rt.swViol || intoClosed || stuck || stuckOpen || navBad;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${c.label}${endTxt}: ${navNeeded ? `navetta: ${ag.S.log.filter(x => x.nav).map(x => x.none ? 'nessun treno' : 'treno ' + (x.k + 1)).join(', ')}, stazioni servite ${navMoved} | ` : ''}at closing ${JSON.stringify(modes)} | overlaps ${overlap} (closest ${Math.round(minGap)} m) | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | routes into the closed stretch ${intoClosed} | open side standing 20+ min at 09:00: ${stuckOpen}`);
  console.log(`     10:00 ${JSON.stringify(after)} | stuck 25+ min: ${stuck} | timetable runs taken after reopening: ${ag.S.log.filter(x => x.ref != null || x.at).length} | ${Date.now() - t0} ms`);
  if (bad) fail++;
}
process.exit(fail ? 1 : 0);
