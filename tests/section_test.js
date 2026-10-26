// San Donato - Rogoredo: ZUB (one train per track between the two stations) and closure with short turns at Rogoredo.
// Run from the build folder: node ../tests/section_test.js
const E = require('../web/engine.js');
const M = require(process.cwd() + '/m3.json');
const S = M.section, half = M.half, ops = M.ops, rev = M.reverse_s;
const pathLen = pid => { const d = M.paths[pid].d; return d[d.length - 1]; };
const fmt = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
const lateness = res => { let w = 0, n = 0; res.forEach(r => r.log.forEach(e => { const l = e.actual - e.planned; if (l > 60) n++; w = Math.max(w, l); })); return [n, Math.round(w)]; };
let fail = 0;

// 1) ZUB all day
const sb = { name: 'sb', ranges: {} }, nb = { name: 'nb', ranges: {} };
for (const [pid, r] of Object.entries(S.ranges)) { if (r.sb) sb.ranges[pid] = r.sb; if (r.nb) nb.ranges[pid] = r.nb; }
let t0 = Date.now();
const z = E.runBooked(M.trains, ops, rev, [sb, nb], half);
const [n1, w1] = lateness(z.res);
console.log(`ZUB all day: ${z.held} holds, ${Date.now() - t0} ms | arrivals >1 min late: ${n1}, worst ${w1} s`);
for (const R of [sb, nb]) {
  const iv = []; z.res.forEach((r, k) => E.occupancy(r.segs, R, half).forEach(x => iv.push({ ...x, k })));
  iv.sort((a, b) => a.enter - b.enter);
  let bad = 0; for (let i = 1; i < iv.length; i++) if (iv[i].enter < iv[i - 1].exit - 1 && iv[i].k !== iv[i - 1].k) bad++;
  console.log(`  ${R.name}: ${iv.length} passages, overlapping: ${bad}`); if (bad) fail = 1;
}

// 2) closure at 08:00
const tc = +(process.env.TC || 8 * 3600);
const base = E.runFleet(M.trains, ops, rev);
const kinds = {}; let turned = 0;
const plans = M.trains.map((p, k) => { const c = E.closePlan(p, base[k].segs, tc, S, ops, rev, pathLen); kinds[c.kind] = (kinds[c.kind] || 0) + 1; turned += c.turned; return c.segs; });
const stub = { name: 'stub', ranges: {} };
for (const [pid, r] of Object.entries(S.ranges)) if (r.sb) stub.ranges[pid] = [r.sb[0] - 5, r.sb[0] + S.stub];
for (const v of Object.values(S.rev)) stub.ranges[v[0]] = [v[3] - S.stub - 5, v[3]];
t0 = Date.now();
const c = E.runBooked(plans, ops, rev, [stub], half);
const iv = []; c.res.forEach((r, k) => E.occupancy(r.segs, stub, half).forEach(x => iv.push({ ...x, k })));
iv.sort((a, b) => a.enter - b.enter);
let bad = 0; for (let i = 1; i < iv.length; i++) if (iv[i].enter < iv[i - 1].exit - 1 && iv[i].k !== iv[i - 1].k) bad++;
console.log(`closed at ${fmt(tc)}: trains ${JSON.stringify(kinds)}, short turns at Rogoredo ${turned}, stub holds ${c.held}, ${Date.now() - t0} ms`);
console.log(`  reversing stub used ${iv.length} times, two trains at once: ${bad}`); if (bad) fail = 1;
// nobody may run through the closed section after tc
let through = 0;
c.res.forEach(r => r.segs.forEach(s => { const rr = S.ranges[s[0]]; if (!rr) return;
  s[3].forEach((t, i) => { if (t <= tc + 60) return; const d = s[4][i];
    if ((rr.sb && d > rr.sb[0] + S.stub + 1 && d < rr.sb[1]) || (rr.nb && d > rr.nb[0] && d < rr.nb[1])) { if (s[1] !== 'stopped' && i > 0 && s[4][i - 1] !== d) through++; } }); }));
console.log(`  moves inside the closed section after closing: ${through}`); if (through) fail = 1;
process.exit(fail);
