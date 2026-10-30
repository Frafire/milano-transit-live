// Emergency mode (web/agents.js), one closure: close at 08:00, reopen at 09:00, run to 10:00.
// Checks: no two trains ever on the same piece of track closer than they should be, the shuttles keep moving,
// after reopening trains take timetable runs again. Usage (from build/): node ../tests/agents_check.js [closure index]
const L = require('./lib.js'), E = L.E, A = require('../web/agents.js');
const { M, D } = L.load();
const G = M.degraded, idx = {}; G.names.forEach((n, i) => (idx[n] = i));
function stopsOf(seg) {
  let st = null;
  if (seg[6] && seg[6].st) st = seg[6].st;
  else if (seg[1] === 'service' && seg[2] >= 0) { st = D.trips[seg[2]][5].filter(x => x >= 0).map(x => idx[D.stops[x][0]]); if (st.some(x => x == null)) return []; }
  else return [];
  const ds = seg[4], pts = [];
  for (let i = 0; i < ds.length; i++) if (i === 0 || ds[i] !== ds[i - 1]) pts.push({ d: ds[i], j: i });
  if (pts.length !== st.length) return [];
  return pts.map((p, k) => ({ st: st[k], j: p.j, d: p.d }));
}
const CLOSURES = [['COMASINA', 'MACIACHINI'], ['COMASINA', 'SONDRIO'], ['COMASINA', 'CENTRALE FS'], ['CENTRALE FS', 'MACIACHINI'],
  ['CENTRALE FS', 'PORTA ROMANA'], ['PORTA ROMANA', 'SAN DONATO'], ['PORTA ROMANA', 'ROGOREDO FS'], ['ROGOREDO FS', 'SAN DONATO']];
const which = process.argv[2] != null ? [+process.argv[2]] : [4];
const base = L.runDay(M, D), prof = L.profiles(M);
const R = E.throatResources(M.throats, M.path_edges).concat(E.blockResources(M.blocks, M.path_edges, M.net.edges));
const locks = cl => E.blockResources(E.turnLocks(G, cl), M.path_edges, M.net.edges).map(r => Object.assign(r, { lock: true }));
const TC = 8 * 3600, TR = 9 * 3600, TE = 10 * 3600;
for (const ci of which) {
  const [x, y] = CLOSURES[ci], cl = { a: Math.min(idx[x], idx[y]), b: Math.max(idx[x], idx[y]) };
  const ag = A.create({ G, ops: M.ops, reverse: M.reverse_s, half: M.half, prof, pathEdges: M.path_edges, netEdges: M.net.edges,
    resources: R, locks, plans0: M.trains, stopsOf, sigpos: M.net.sigpos, sigall: M.net.sigall, interlocking: M.net.interlocking, zones: E.platformZones(G) });
  const pos = base.res.map((r, k) => { const s = E.stateAt(r.segs, TC); const sg = r.segs[Math.min(s.si, r.segs.length - 1)];
    return { pid: sg[0], d: s.d != null ? s.d : sg[4][sg[4].length - 1], v: s.v, seg: s.si, status: s.si >= r.segs.length || s.before && (sg[1] === 'from_depot' || s.si === 0) ? 'parked' : sg[1] }; });
  const t0 = Date.now();
  ag.close(TC, cl, pos);
  const modes = {}; ag.agents().forEach(a => (modes[a.mode] = (modes[a.mode] || 0) + 1));
  let close = 0, minGap = Infinity, moved = new Map(), stuck = 0;
  const check = () => {
    // trains on the same track piece: their stretches must not overlap
    const byEdge = new Map();
    ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
      for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - M.half || x0 > a.d + M.half) continue;
        const k = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - M.half, x0), q = Math.min(a.d + M.half, x1);
        const l0 = dir > 0 ? (p - x0) * k : (x1 - q) * k, l1 = dir > 0 ? (q - x0) * k : (x1 - p) * k;
        (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, l0, l1]); } });
    for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [ka, a0, a1] = list[i], [kb, b0, b1] = list[j]; if (ka === kb) continue;
      const g = Math.max(b0 - a1, a0 - b1); minGap = Math.min(minGap, g); if (g < 0) { close++; if (process.env.DBG && close < 4) { const A_ = ag.agents()[ka], B_ = ag.agents()[kb]; console.log('   overlap at', Math.floor(curT / 3600) + ':' + String(Math.floor(curT / 60) % 60).padStart(2, '0'), 'edge', [...byEdge.entries()].find(([e, l]) => l === list)[0], 'trains', ka, A_.mode, A_.status, A_.pid, Math.round(A_.d), (A_.legs[0] || {}).kind || '', '|', kb, B_.mode, B_.status, B_.pid, Math.round(B_.d), (B_.legs[0] || {}).kind || ''); } } }
  };
  const deps = { a: 0, b: 0 }; let curT = 0, stuckClosed = 0;
  for (let t = TC + 30; t <= TE; t += 30) {
    if (t === TR) { ag.agents().forEach(a => { const m = moved.get(a.k); if (a.mode === 'shuttle' && m && TR - m.t > 900) stuckClosed++; }); ag.reopen(TR); }
    if (process.env.AT && t === +process.env.AT) { const R2 = ag.resources(); ag.agents().forEach(a => { if (a.hidden) return; const l = a.legs[0] || {};
      const ins = R2.map((r, ri) => r.ranges[a.pid] && a.d + M.half >= r.ranges[a.pid][0] && a.d - M.half <= r.ranges[a.pid][1] ? r.name : null).filter(Boolean).join(',');
      console.log('  @', a.k, a.mode, a.status, 'pid', a.pid, Math.round(a.d), 'v', a.v.toFixed(1), 'why', a.why, JSON.stringify(a.red && a.red.why), 'leg', l.kind || (l.pid + ' ' + l.status + ' end ' + Math.round(l.end) + ' ' + (l.stops || []).map(z => G.names[z.st].slice(0, 5)).join('>')), 'in:', ins); }); }
    ag.step(t); if (process.env.DBG) curT = t; check();
    ag.agents().forEach(a => { const m = moved.get(a.k) || { d: a.d, t, pid: a.pid };
      if (Math.abs(a.d - m.d) > 1 || a.pid !== m.pid) moved.set(a.k, { d: a.d, t, pid: a.pid });
      else if (!moved.has(a.k)) moved.set(a.k, m); });
  }
  const fmt = t => String(Math.floor(t / 3600)).padStart(2, '0') + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0');
  ag.agents().forEach(a => { const m = moved.get(a.k); if ((a.mode === 'shuttle' || a.mode === 'timetable') && m && TE - m.t > 900) { stuck++;
    if (process.env.DBG) { const l = a.legs[0] || {}; console.log('   stuck', a.k, a.mode, a.status, 'since', fmt(m.t), 'pid', a.pid, Math.round(a.d), 'why', a.why, JSON.stringify(a.red && a.red.why), 'stopAt', a.stopAt, 'leg', l.kind || (l.pid + ' ' + l.status + ' end ' + Math.round(l.end) + ' stops ' + (l.stops || []).map(z => G.names[z.st].slice(0, 5)).join('>')), 'res', a.red && a.red.why && a.red.why.res != null ? ag.resources()[a.red.why.res].name : ''); } } });
  const after = {}; ag.agents().forEach(a => (after[a.mode + '/' + a.status] = (after[a.mode + '/' + a.status] || 0) + 1));
  const late = ag.agents().filter(a => a.late != null).map(a => Math.round(a.late / 60));
  console.log(`${x} – ${y}: at closing ${JSON.stringify(modes)} | overlapping on a track piece: ${close} (closest ${Math.round(minGap)} m) | shuttles standing 15+ min at 09:00: ${stuckClosed}`);
  console.log(`  10:00 ${JSON.stringify(after)} | stuck for 15+ min: ${stuck} | timetable runs taken after reopening: ${ag.S.log.length} | late (min): ${late.sort((p, q) => p - q).join(' ')} | ${Date.now() - t0} ms`);
}
