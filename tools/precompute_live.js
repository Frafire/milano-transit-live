// The normal day, driven once at build time: every M3 train with speed limits, stop times, block sections and
// terminal junctions. The page loads this instead of computing it (fast start) and only re-drives after a change.
// Run from the build folder: node ../tools/precompute_live.js  -> m3_live.json
const fs = require('fs'), L = require('../tests/lib.js');
const { M, D } = L.load();
const t0 = Date.now();
const r = L.runDay(M, D);
const enc = a => { let p = 0; return a.map(x => { const v = Math.round(x * 10); const d = v - p; p = v; return d; }); };
const segs = s => s.map(g => [g[0], g[1], g[2], enc(g[3]), enc(g[4]), ...g.slice(5)]);
const out = { trains: r.res.map(x => ({ segs: segs(x.segs), log: x.log.map(e => [e.seg, Math.round(e.planned), Math.round(e.actual * 10) / 10]) })),
              holds: r.holds, plans: r.plans.map(segs), held: r.held };
fs.writeFileSync('m3_live.json', JSON.stringify(out));
console.log(`normal day precomputed in ${Date.now() - t0} ms: ${r.held} waits at signals, ${(fs.statSync('m3_live.json').size / 1e6).toFixed(1)} MB`);
