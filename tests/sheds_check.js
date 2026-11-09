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
check(sheds.length === 2 && sheds.some(s => s.uso === 'rimessa') && sheds.some(s => s.uso === 'manutenzione'), 'two sheds: rimessa and officina (manutenzione)');
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
console.log(fail ? 'sheds: FAILED' : 'sheds: all ok'); process.exit(fail ? 1 : 0);
