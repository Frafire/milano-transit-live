// San Donato - Rogoredo: closure with short turns at Rogoredo.
// Run from the build folder: node ../tests/section_test.js
const E = require('../web/engine.js');
const M = require(process.cwd() + '/m3.json');
const S = M.section, half = M.half, ops = M.ops, rev = M.reverse_s;
ops.train_half = half;
const prof = E.buildProfiles(M.path_edges, M.net.edges, M.speeds, ops, M.cuts);
const pathLen = pid => { const d = M.paths[pid].d; return d[d.length - 1]; };
const fmt = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
const lateness = res => { let w = 0, n = 0; res.forEach(r => r.log.forEach(e => { const l = e.actual - e.planned; if (l > 60) n++; w = Math.max(w, l); })); return [n, Math.round(w)]; };
let fail = 0;

// closure at 08:00
const tc = +(process.env.TC || 8 * 3600);
const base = E.runFleet(M.trains, ops, rev, prof);
const kinds = {}; let turned = 0;
const plans = M.trains.map((p, k) => { const c = E.closePlan(p, base[k].segs, tc, S, ops, rev, pathLen); kinds[c.kind] = (kinds[c.kind] || 0) + 1; turned += c.turned; return c.segs; });
const stub = { name: 'stub', ranges: {} };
for (const [pid, r] of Object.entries(S.ranges)) if (r.sb) stub.ranges[pid] = [r.sb[0] - 5, r.sb[0] + S.stub];
for (const v of Object.values(S.rev)) stub.ranges[v[0]] = [v[3] - S.stub - 5, v[3]];
t0 = Date.now();
const c = E.runBooked(plans, ops, rev, [stub], half, null, prof);
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
