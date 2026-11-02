// Comasina, platform 1 (Giovanni, 2 Nov 2026): a train coming from San Donato is ordered (radio) to cross over before the
// station into platform 1, the departure one, and the driver changes cab there (no tail). Checks: it goes into platform 1
// over COS-4, stands, leaves for San Donato over COS-1 not late by more than 2 minutes; no two trains on one piece; no
// route missing. And the exit zone of Comasina binario 2: an arrival there is never set while a train is on the
// crossover of the tails, nor a move over the crossover while an arrival there is set and not yet in.
// Usage (from build/): node ../tests/c1_check.js
const L = require('./lib.js');
const { M, D } = L.load();
const day = L.runDay(M, D), H = M.half;
let fail = 0;
const T0 = 9 * 3600;
const plans = M.trains.map(s => JSON.parse(JSON.stringify(s)));
const C1 = M.carr1 || [];
const k = C1.findIndex(l => l.some(c => c.open <= T0 && T0 < c.close - 300));
if (k < 0) { console.log('FAIL no train can be sent into Comasina platform 1 at 09:00'); process.exit(1); }
const c = C1[k].find(x => x.open <= T0 && T0 < x.close - 300);
const ag = L.agents(M, D, t => L.posAt(day, t), { plans0: plans });
ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
plans[k].splice(c.i, c.n, ...JSON.parse(JSON.stringify(c.segs))); ag.replan(k);
const ids = new Set(); let stood = false, left = null, ov = 0;
const sA = c.segs[1], sB = c.segs[3], endA = sA[4][sA[4].length - 1];      // the run in, the run back out (platform 1)
function overlaps() {
  const byEdge = new Map(); let n = 0;
  ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
    for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue;
      const kk = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
      (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * kk : (x1 - q) * kk, dir > 0 ? (q - x0) * kk : (x1 - p) * kk]); } });
  for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i][0] !== list[j][0] && Math.max(list[j][1] - list[i][2], list[i][1] - list[j][2]) < 0) n++;
  return n;
}
// the exit zone: routes ending at #A11 (COS-2 and the like) and routes over the crossover of the tails at once
const EZ = new Set(((M.net.route_rules || {}).exitZones || {})['11'] || []);
let ezClash = 0;
for (let t = T0 + 5; t <= c.dep + 900; t += 5) {
  ag.step(t);
  const a = ag.agents()[k];
  (ag.rt().routes[k] || []).forEach(r => r.id && ids.add(r.id));
  if (a.v === 0 && (a.pid === sA[0] && Math.abs(a.d - endA) < 5 || a.pid === sB[0] && Math.abs(a.d - sB[4][0]) < 5)) stood = true;
  if (stood && left == null && a.si >= c.i + 4 && a.v > 1) left = t;
  if (t % 60 === 0) ov += overlaps();
  const R = ag.rt().routes; let arr = [], over = [];
  for (const [k2, rs] of Object.entries(R)) for (const r of rs) { if (r.nodes.some(x => x[2])) arr.push(+k2); else if (r.nodes.some(x => EZ.has(x[0]))) over.push(+k2); }
  if (arr.some(x => over.some(y => y !== x))) ezClash++;
}
const rt = ag.rt(), late = left != null ? left - c.dep : null;
const ok = ids.has('COS-4') && stood && left != null && late < 120 && !ov && !rt.viol && !rt.swViol && !ezClash;
console.log(`${ok ? 'ok  ' : 'FAIL'} train ${k + 1} into Comasina platform 1: itineraries ${[...ids].join(', ')} | stood there ${stood} | left ${left != null ? Math.round(late) + ' s after its time' : 'never'} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | exit zone clashes ${ezClash}`);
if (!ok) fail++;
process.exit(fail ? 1 : 0);
