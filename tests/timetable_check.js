// Can the timetable be respected? Runs the whole M3 day with the speed limits (data/rules_m3.json),
// the braking/acceleration values (operations_m3.json) and the real station stop times (dwell_m3.json),
// then compares every run with the ATM timetable. Run from the build folder: node ../tests/timetable_check.js
const L = require('./lib.js'), { E } = L;
const { M, D } = L.load();
const prof = L.profiles(M), envs = L.envs(M, D);
const res = E.runFleet(M.trains, M.ops, M.reverse_s, prof, envs);
const fmt = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
const runs = [];
res.forEach((r, k) => r.segs.forEach((s, si) => {
  const p = M.trains[k][si]; if (s[1] !== 'service' || s[2] < 0) return;
  const pT = p[3], pD = p[4], lT = s[3];
  const depPlan = pT[1], arrPlan = pT[pT.length - 1];
  let depLive = null; for (let i = 1; i < s[4].length; i++) if (s[4][i] > s[4][0] + 0.05) { depLive = lT[i - 1]; break; }
  const arrLive = lT[lT.length - 1];
  const names = D.trips[s[2]][5].filter(x => x >= 0).map(x => D.stops[x][0]);
  runs.push({ k, dir: names[0].startsWith('SAN DONATO') ? 'N' : 'S', depPlan, arrPlan, depLive, arrLive, depLate: depLive - depPlan, arrLate: arrLive - arrPlan,
              planDur: arrPlan - depPlan, liveDur: arrLive - depLive });
}));
const late = (x, s) => runs.filter(r => r[x] > s).length, worst = x => runs.reduce((a, r) => r[x] > a[x] ? r : a, runs[0]);
const avg = (a, f) => a.reduce((s, r) => s + f(r), 0) / (a.length || 1);
console.log(`timetable check: ${runs.length} runs (${res.length} trains), stop times from dwell_m3.json, accel ${M.ops.acceleration_ms2} / brake ${M.ops.braking_ms2} m/s²`);
for (const dir of ['N', 'S']) {
  const rr = runs.filter(r => r.dir === dir);
  console.log(`  ${dir === 'N' ? 'San Donato → Comasina' : 'Comasina → San Donato'}: timetable ${(avg(rr, r => r.planDur) / 60).toFixed(1)} min, simulated ${(avg(rr, r => r.liveDur) / 60).toFixed(1)} min on average`);
}
console.log(`  leaving the terminus late (>30 s): ${late('depLate', 30)} | arriving late (>1 min): ${late('arrLate', 60)}, (>3 min): ${late('arrLate', 180)}`);
const w = worst('arrLate');
console.log(`  worst arrival: ${w.arrLate > 0 ? '+' : ''}${Math.round(w.arrLate)} s (train ${w.k + 1}, due ${fmt(w.arrPlan)}) | runs arriving early: ${runs.filter(r => r.arrLate < -30).length}`);
const ok = late('depLate', 30) === 0 && late('arrLate', 180) === 0;
console.log(ok ? '  RESULT: the timetable can be respected.' : '  RESULT: the timetable cannot be fully respected with these values.');
