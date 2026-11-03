// Marcia illegale at San Donato (Giovanni 3 Nov 2026): in an interruption from San Donato, the DCT sends the trains
// standing there (at a platform or in a tail) into a tail or into the depot, on its radio order, after a change of cab
// when the train faces the other way, at 30 km/h. Close San Donato – Rogoredo FS at a few times; every 30 s one order
// to a train with a way free now (a goal not reached yet first); one hour; then reopen and 20 minutes more.
// Checks: every goal (each tail, the depot) reached somewhere; each train sent gets there (static in its tail, or in the
// depot); a change of cab when it was facing the other way; never above 30 km/h in marcia illegale; never two trains on
// one track piece; no signal or switch of the line passed without its route. Usage (from build/): node ../tests/illegal_sd_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const day = L.runDay(M, D), H = M.half, KMH = (M.ops && M.ops.illegal_kmh) || 30;
const c = M.net.closures.find(x => x.a === 0);
if (!c) { console.log('no closure from San Donato'); process.exit(1); }
const SDT = new Set(M.net.sd_tail_edges || []), reached = {}; let fail = 0, sent = 0;
const overlaps = ag => { let n = 0; const by = new Map();
  ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
    for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue; const kk = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
      (by.get(ei) || by.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * kk : (x1 - q) * kk, dir > 0 ? (q - x0) * kk : (x1 - p) * kk]); } });
  for (const l of by.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (Math.max(l[j][1] - l[i][2], l[i][1] - l[j][2]) < 0) n++;
  return n; };
for (const h of [6.5, 8, 10]) {
  const TC = h * 3600, ag = L.agents(M, D, t => L.posAt(day, t));
  ag.start(TC - 600, L.posAt(day, TC - 600)); ag.step(TC);
  ag.event({ kind: 'close', cl: { a: c.a, b: c.b }, label: c.label }); ag.step(TC + 360);
  const orders = new Map(); let overlap = 0, vmax = 0, offered = 0;
  for (let t = TC + 390; t <= TC + 360 + 3600; t += 30) {
    for (const a of ag.agents()) {
      if (orders.has(a.k)) continue;
      const ops = ag.instrOptions(a.k).filter(o => o.ill); offered += ops.length;
      const free = ops.filter(o => !o.blocked.length).sort((x, y) => (reached[x.key] || 0) - (reached[y.key] || 0)); if (!free.length) continue;
      const o = free[0], r = ag.event({ kind: 'order', k: a.k, what: 'instr', arg: { key: o.key } });
      orders.set(a.k, { o, r, turned: false, at: Math.round(ag.S.t) }); sent++; break;
    }
    for (let u = t - 29; u <= t; u++) { ag.step(u); for (const a of ag.agents()) if (a.illMove) { vmax = Math.max(vmax, a.v * 3.6); const x = orders.get(a.k); if (x && a.status === 'turnback') x.turned = true; } }
    overlap += overlaps(ag);
  }
  const rt = ag.rt();
  for (const [k, x] of orders) {
    const a = ag.agents()[k];
    const pe = M.path_edges[a.pid], under = pe ? pe.e.filter(([, , x0, x1]) => x1 > a.d - H && x0 < a.d + H).map(z => z[0]) : [];
    const goal = x.o.key.slice(4), there = goal === 'dep' ? a.hidden && a.status === 'depot' : a.mode === 'static' && a.sdTailHeld && under.includes(+goal);
    const bad = !x.r || !there || (x.o.cab && !x.turned);
    if (there) reached[x.o.key] = (reached[x.o.key] || 0) + 1;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${String(h).replace('.5', ':30').padStart(5)} · treno ${k + 1}: ${x.o.label} | order ${x.r ? 'given' : 'refused'} at ${Math.floor(x.at / 3600)}:${String(Math.floor(x.at % 3600 / 60)).padStart(2, '0')} | after: ${a.mode}/${a.status}${a.hidden ? ' (deposito)' : ' on ' + under.join(',')}${x.o.cab ? ' | cambio banco ' + (x.turned ? 'sì' : 'NO') : ''}`);
    if (bad) fail++;
  }
  // reopening: the trains in the tails go back to the service, the depot ones stay there; still nobody on another
  ag.event({ kind: 'reopen' }); let overAfter = 0; for (let t = ag.S.t + 30; t <= TC + 360 + 3600 + 1200; t += 30) { ag.step(t); overAfter += overlaps(ag); }
  const bad = overlap || overAfter || rt.viol || rt.swViol || vmax > KMH + 0.5 || !offered;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${String(h).replace('.5', ':30').padStart(5)} · ${c.label}: ways offered ${offered}, trains sent ${orders.size} | overlaps ${overlap} (after reopening ${overAfter}) | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | highest speed in marcia illegale ${vmax.toFixed(1)} km/h (max ${KMH})`);
  if (bad) fail++;
}
const goals = [...SDT].map(e => 'ill:' + e).concat(['ill:dep']), miss = goals.filter(g => !reached[g]);
console.log(`goals reached: ${goals.map(g => g.slice(4) + ' ' + (reached[g] || 0)).join(', ')}${miss.length ? ' | MISSING ' + miss.join(', ') : ''}`);
process.exit(fail || miss.length || !sent ? 1 : 0);
