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
const uses = r.rt.uses || {}, ids = Object.keys(uses);
console.log(`itineraries of the table set during the day: ${ids.length} different, ${Object.values(uses).reduce((a, b) => a + b, 0)} times | routes over a switch that are not in the table: ${r.rt.noId || 0}${r.rt.noIdAt ? ' ' + JSON.stringify(r.rt.noIdAt) : ''}`);
console.log(`movements given on another way (the usual one taken): ${r.rt.other || 0}${r.rt.otherAt ? ' ' + JSON.stringify(r.rt.otherAt) : ''}`);
console.log(`switches of the line passed: ${r.rt.swPassed || 0} | without a route over the switch: ${r.rt.swViol || 0}${r.rt.swAt ? ' ' + JSON.stringify(r.rt.swAt) : ''}`);
fs.writeFileSync('itineraries_used.json', JSON.stringify(uses, null, 1));
// the normal day must use only movements that Giovanni's rules give for the normal service
const T = {}; (M.net.itineraries || []).forEach(i => { T[i.id] = i; });
const NORMAL = new Set(['servizio normale', 'sempre', 'mattina', 'sera', 'ritardo', 'manovra deposito']);
const odd = ids.filter(id => T[id] && !NORMAL.has(T[id].when)).map(id => `${id} (${T[id].when}, ${uses[id]} volte)`);
console.log(`movements used in the normal day that the rules give for other situations: ${odd.length ? odd.join(', ') : 'none'}`);
if (r.pidChanged) console.log(`WARNING: ${r.pidChanged} moves changed path after starting (not recorded right)`);
if (r.rt.viol || r.rt.swViol || r.rt.noId || r.pidChanged) process.exit(1);
