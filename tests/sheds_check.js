// The depot sheds of San Donato (Giovanni 9 Nov 2026): the rimessa and the officina (data/capannoni_m3.json, traced on
// his satellite photo); inside them at most shed_speed_kmh (5) until the whole train is out; two trains in the officina
// from the start of the day, one of the 2nd lot of the first series (fleet_m3.OFFICINA), taking no tabella.
// Checks: the outlines and the speed reach the page; the paths through the sheds carry their stretches; the officina trains
// stand inside the officina all day; the agents from 4:30 to 7:30 (the morning pull-outs): never above the shed speed
// while any part of the train is inside, and faster again once the tail is out. Usage (from build/): node ../tests/sheds_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const H = M.half, VS = M.ops.shed_speed_kmh;
let fail = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fail++; };
const inpoly = ([la, lo], P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [a1, o1] = P[i], [a2, o2] = P[j];
  if ((a1 > la) !== (a2 > la) && lo < (o2 - o1) * (la - a1) / (a2 - a1) + o1) c = !c; } return c; };
const sheds = M.sheds || [];
check(sheds.length === 3 && sheds.some(s => s.uso === 'rimessa') && sheds.some(s => s.uso === 'manutenzione'), 'the sheds: rimessa (with the wash) and officina (manutenzione)');
check(VS === 5, 'shed speed 5 km/h (data/operations_m3.json)');
const withSheds = M.path_edges.filter(p => p && p.sheds && p.sheds.length).length;
check(withSheds > 50, `paths through the sheds carry their stretches: ${withSheds}`);
// the officina trains
const off = M.stock.map((x, u) => [x, u]).filter(([x]) => x.officina);
check(off.length === 2 && off.some(([x]) => /2° lotto/.test(x.type)), `two trains in the officina, one of the 2nd lot: ${off.map(([x]) => x.units + ' (' + x.type + ')').join(', ')}`);
const nodeLL = n => M.net.nodes[String(n)];
const offShed = sheds.find(s => s.uso === 'manutenzione');
off.forEach(([x, u]) => {
  const k = M.duties.findIndex(ds => ds.some(d => d[2] === u)), tr = M.trains[k], segs = tr && (tr.segs || tr);
  const still = segs && segs.every(s => s[3][0] >= 29 * 3600), place = segs && segs[0][5], ll = nodeLL(place);
  check(!!(still && ll && inpoly(ll, offShed.pts)), `${x.units}: stands all day at a place inside the officina (node ${place})`);
  check(!M.duties[k].some(d => d[2] !== u), `${x.units}: no other train on its timeline, no tabella`);
});
// the rimessa (Giovanni's outline, 9 Nov): two places on each of its through tracks, half of the track inside each, both
// trains entirely inside; the officina trains: where they stand, how much of them is inside
const KXY = ([la, lo]) => [(lo - 9.19) * L.KX, (la - 45.46) * L.KY], pos = L.posOf(M);
const inXY = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [x1, y1] = P[i], [x2, y2] = P[j];
  if ((y1 > q[1]) !== (y2 > q[1]) && q[0] < (x2 - x1) * (q[1] - y1) / (y2 - y1) + x1) c = !c; } return c; };
const rim = sheds.find(s => s.uso === 'rimessa'), RP = rim.pts.map(KXY), OP = offShed.pts.map(KXY);
const inside = (node, P) => { const r = M.depot_paths[String(node)]; if (!r) return null; const o = Object.values(r.out)[0]; if (!o) return null;
  let n = 0, k = 0; for (let d = o.start - H; d <= o.start + H + 1e-6; d += 1) { k++; if (inXY(pos(o.pid, d), P)) n++; } return n / k; };
const RT = Object.entries((M.rimessa || {}).tracks || {});
const notIn = RT.flatMap(([li, ns]) => ns.slice(0, 2).filter(n => n != null).map(n => [li, n, inside(n, RP)])).filter(x => x[2] == null || x[2] < 0.999);
const PM = RT.map(([, ns]) => ns[2]);
check(RT.length === 12 && RT.every(([, ns]) => ns[0] != null && ns[1] != null) && PM.every(x => x > 2 * H && x < 115), `rimessa: two places on each of its ${RT.length} tracks (A48-A59), places of ${Math.min(...PM).toFixed(1)}-${Math.max(...PM).toFixed(1)} m`);
const lav = sheds.find(s => s.uso === 'lavaggio'); check(!!lav, 'the wash (lavaggio), part of the rimessa');
check(!notIn.length, `every train of the rimessa entirely inside the hall${notIn.length ? ': ' + notIn.map(x => 'track ' + x[0] + ' node ' + x[1] + ' ' + (x[2] == null ? '?' : Math.round(x[2] * 100) + '%')).join(', ') : ''}`);
off.forEach(([x, u]) => { const k = M.duties.findIndex(ds => ds.some(d => d[2] === u)), tr = M.trains[k], f = inside((tr.segs || tr)[0][5], OP);
  console.log(`note ${x.units} in the officina: ${f == null ? '?' : Math.round(f * 100) + '%'} of the train under the roof`); });
// the agents in the morning
const day = L.runDay(M, D), ag = L.agents(M, D, t => L.posAt(day, t)), T0 = 4.5 * 3600, T1 = 7.5 * 3600;
ag.start(T0, L.posAt(day, T0));
const lim = VS / 3.6 + 0.1, inShed = a => { const pe = M.path_edges[a.pid]; return !!(pe && pe.sheds && pe.sheds.some(([s0, s1]) => a.d + H > s0 && a.d - H < s1)); };
let samples = 0, moving = 0, over = 0, worst = 0, overAt = '', outFast = 0; const was = new Map();
for (let t = T0 + 1; t <= T1; t++) {
  ag.step(t);
  for (const a of ag.agents()) {
    if (a.hidden) continue;
    const ins = inShed(a);
    if (ins) { samples++; if (a.v > 0.05) moving++; if (a.v > lim) { over++; if (a.v > worst) { worst = a.v; overAt = `train ${a.k} at ${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`; } } }
    else if (was.get(a.k) && a.v * 3.6 > VS + 1) outFast++;
    if (ins) was.set(a.k, true); else if (a.v * 3.6 > VS + 1) was.delete(a.k);
  }
}
check(moving > 300, `trains moving inside the sheds (seconds): ${moving} of ${samples} inside`);
check(!over, `never above ${VS} km/h while any part of the train is inside${over ? ': ' + over + ' s, worst ' + (worst * 3.6).toFixed(1) + ' km/h, ' + overAt : ''}`);
check(outFast > 0, 'faster again once the whole train is out');
// a train taken out of the service for a fault always goes to the officina (Giovanni 9 Nov): the UdT excluded (it goes
// home by itself) and the rescue (towed): the broken train stands on a free stub track of the officina (#A69-#A75),
// in sight; the one that pushed or pulled it goes into the depot
const names = Object.fromEntries(M.net.depot.map(p => [String(p.node), p.name])), OFFN = ['A69', 'A70', 'A71', 'A72', 'A73', 'A74', 'A75'];
const offTaken = new Set(off.map(([x, u]) => String((M.trains[M.duties.findIndex(ds => ds.some(d => d[2] === u))].segs || M.trains[M.duties.findIndex(ds => ds.some(d => d[2] === u))])[0][5])));
for (const [kind, T1] of [['udt', 10.5 * 3600], ['soccorso', 11 * 3600]]) {
  const used = new Set(offTaken), hook = k => { const q = Object.keys(M.depot_paths).find(q => OFFN.includes(names[q]) && !used.has(q)); if (!q) return null; used.add(q);
    const o = Object.values(M.depot_paths[q].out)[0]; return { q, pid: o.pid, d: o.start }; };
  const ag2 = L.agents(M, D, t => L.posAt(day, t), { depotPark: k => (ag2.S.faults.list.some(f => f.k === k && f.maint) ? hook(k) : null) }), T0f = 8 * 3600;
  ag2.start(T0f - 600, L.posAt(day, T0f - 600)); ag2.step(T0f);
  const a = ag2.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 17);
  const id = ag2.event({ kind: 'fault', what: 'new', fault: kind, k: a.k }); let rk = null;
  for (let t = T0f + 10; t <= T1; t += 10) { ag2.step(t); const f = ag2.S.faults.list.find(x => x.id === id); if (f && f.rk != null) rk = f.rk; }
  const r = rk != null ? ag2.agents()[rk] : null, inOff = a.officina != null && OFFN.includes(names[a.officina]) && !a.hidden && a.status === 'parked';
  const at_ = inOff ? pos(a.pid, a.d) : null, under = at_ && inXY(at_, OP);
  check(inOff && under && (kind !== 'soccorso' || (r && r.hidden)), `${kind}: the broken train ${a.k + 1} in the officina (${a.officina != null ? names[a.officina] : 'no'}${under ? ', under its roof' : ''})${kind === 'soccorso' ? ', the rescue train ' + (r ? (r.hidden ? 'in the depot' : r.status + '/' + r.mode) : 'none') : ''}`);
}
console.log(fail ? 'sheds: FAILED' : 'sheds: all ok'); process.exit(fail ? 1 : 0);
