// The normal day, driven once at build time by the agents (web/agents.js: route interlocking, speed limits, stop
// times). The page loads this instead of computing it (fast start) and only re-drives after a change.
// Run from the build folder: node ../tools/precompute_live.js  -> m3_live.json
const fs = require('fs'), L = require('../tests/lib.js');
const { M, D } = L.load();
const t0 = Date.now();
const r = L.driveDay(M, D);
const enc = a => { let p = 0; return a.map(x => { const v = Math.round(x * 10); const d = v - p; p = v; return d; }); };
const segs = s => s.map(g => [g[0], g[1], g[2], enc(g[3]), enc(g[4]), ...g.slice(5)]);
const out = { trains: r.res.map(x => ({ segs: segs(x.segs), log: x.log.map(e => [e.seg, Math.round(e.planned), Math.round(e.actual * 10) / 10, e.status]) })), held: r.held };
fs.writeFileSync('m3_live.json', JSON.stringify(out));
console.log(`normal day driven by the agents in ${Date.now() - t0} ms: ${r.held} waits at signals, signals passed ${r.rt.passed || 0}, without the route set ${r.rt.viol || 0}${r.rt.violAt ? ' ' + JSON.stringify(r.rt.violAt) : ''}, ${(fs.statSync('m3_live.json').size / 1e6).toFixed(1)} MB`);
if (r.rt.viol) process.exit(1);
