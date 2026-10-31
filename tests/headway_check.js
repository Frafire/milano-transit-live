// Spacing between trains and the morning timetable.
// 1) In each direction, at every station (arrival, departure) and halfway between stations, the time between one train
//    and the next must never be under 2 minutes.  2) Morning (06:00-10:00): every departure compared with the timetable.
// Run from the build folder: node ../tests/headway_check.js
const L = require('./lib.js'), { E } = L;
const { M, D } = L.load();
const booked = L.runDay(M, D), res = booked.res;
const fmt = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const MIN_GAP = 120;
// time a live segment reaches distance d (first) and leaves it (last time at d)
function reach(ts, ds, d) { for (let i = 1; i < ds.length; i++) if (ds[i] >= d - 0.05) { const f = ds[i] > ds[i - 1] ? (d - ds[i - 1]) / (ds[i] - ds[i - 1]) : 1; return ts[i - 1] + (ts[i] - ts[i - 1]) * Math.max(0, Math.min(1, f)); } return null; }
function leave(ts, ds, d) { for (let i = 1; i < ds.length; i++) if (ds[i] > d + 0.05) return ts[i - 1]; return null; }
const pass = {}, morning = [];
res.forEach((r, k) => r.segs.forEach((s, si) => {
  const p = M.trains[k][si]; if (s[1] !== 'service' || s[2] < 0) return;
  const names = D.trips[s[2]][5].filter(x => x >= 0).map(x => D.stops[x][0]), dir = names[0].startsWith('SAN DONATO') ? 'N' : 'S';
  const pT = p[3], pD = p[4], stops = [];
  for (let i = 0; i < pD.length; i++) { if (i === 0 || pD[i] !== pD[i - 1]) stops.push({ d: pD[i], arr: pT[i], dep: pT[i] }); else stops[stops.length - 1].dep = pT[i]; }
  if (stops.length !== names.length) return;
  stops.forEach((st, j) => {
    const a = reach(s[3], s[4], st.d), l = leave(s[3], s[4], st.d);
    const add = (key, t) => { if (t != null) (pass[dir + '|' + key] = pass[dir + '|' + key] || []).push({ t, k }); };
    if (j > 0) add(names[j] + ' arrival', a);
    if (j < names.length - 1) {
      add(names[j] + ' departure', l);
      const mid = (st.d + stops[j + 1].d) / 2; add(names[j] + ' → ' + names[j + 1] + ' halfway', reach(s[3], s[4], mid));
      if (st.dep >= 6 * 3600 && st.dep < 10 * 3600 && l != null) morning.push({ dir, st: names[j], late: l - st.dep, k, plan: st.dep });
    }
  });
}));
let worst = null, under = 0, checked = 0;
for (const [key, list] of Object.entries(pass)) {
  list.sort((a, b) => a.t - b.t);
  for (let i = 1; i < list.length; i++) { const g = list[i].t - list[i - 1].t; checked++;
    if (g < MIN_GAP) under++;
    if (!worst || g < worst.g) worst = { g, key, t: list[i].t, a: list[i - 1].k + 1, b: list[i].k + 1 }; }
}
console.log(`spacing: ${checked} train-to-train gaps checked at ${Object.keys(pass).length} points | under 2 min: ${under} | closest: ${Math.round(worst.g)} s (${worst.key.replace('|', ' ')}, trains ${worst.a} and ${worst.b}, ${fmt(worst.t)})`);
const lateM = morning.filter(m => m.late > 30), earlyM = morning.filter(m => m.late < -60);
const avgM = morning.reduce((a, m) => a + m.late, 0) / morning.length;
const wM = morning.reduce((a, m) => m.late > a.late ? m : a, morning[0]);
console.log(`morning 06-10: ${morning.length} departures | later than timetable by >30 s: ${lateM.length} | worst ${Math.round(wM.late)} s (${wM.st}, ${fmt(wM.plan)}) | average ${avgM > 0 ? '+' : ''}${Math.round(avgM)} s | more than 1 min early: ${earlyM.length}`);
if (process.env.DETAIL) { const by = {}; morning.forEach(m => { const k = m.dir + " " + m.st; (by[k] = by[k] || []).push(m.late); });
  for (const [k, v] of Object.entries(by)) { const a = v.reduce((x, y) => x + y, 0) / v.length; console.log("  " + k.padEnd(26), "avg", Math.round(a), "s  max", Math.round(Math.max(...v)), "s  late>30:", v.filter(x => x > 30).length + "/" + v.length); } }
process.exit(under ? 1 : 0);
