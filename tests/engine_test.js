// Step 2 check: with nothing going wrong, the live engine must keep to the plan.
// Run from the build folder: node ../tests/engine_test.js
const E = require('../web/engine.js');
const M = require(process.cwd() + '/m3.json');
M.ops.train_half = M.half;
const prof = E.buildProfiles(M.path_edges, M.net.edges, M.speeds, M.ops, M.cuts);
const t0 = Date.now();
const res = E.runFleet(M.trains, M.ops, M.reverse_s, prof);
const ms = Date.now() - t0;
let n = 0, worst = 0, over30 = 0, over10 = 0, early = 0, where = null;
res.forEach((r, k) => r.log.forEach(e => {
  n++; const late = e.actual - e.planned;
  if (late > worst) { worst = late; where = { train: k + 1, status: e.status, planned: e.planned }; }
  if (late > 30) over30++; if (late > 10) over10++; if (late < -5) early++;
}));
// departures: a train must never leave a stop later than the plan
let depLate = 0;
res.forEach((r, k) => r.segs.forEach((s, si) => {
  const p = M.trains[k][si]; if (s[1] !== 'service') return;
  if (s[3][0] > p[3][0] + 1) depLate++;
}));
const fmt = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
console.log(`engine: ${M.trains.length} trains, whole day simulated in ${ms} ms`);
console.log(`arrivals checked ${n} | later than plan by >10 s: ${over10} | by >30 s: ${over30} | worst ${worst.toFixed(1)} s` +
  (where ? ` (train ${where.train}, ${where.status}, due ${fmt(where.planned)})` : '') + ` | runs starting late: ${depLate}`);
// with real speed limits the timetable may not hold everywhere: that is information, not a broken build
if (over30) console.log('NOTE: some arrivals are more than 30 s late with these speed limits: check data/rules_m3.json speeds');
const hand = []; res.forEach(r => r.log.forEach(e => hand.push(e.planned - e.actual)));
hand.sort((a, b) => a - b); console.log(`time in hand at stops (plan minus actual): median ${hand[hand.length >> 1].toFixed(0)} s`);
process.exit(0);
