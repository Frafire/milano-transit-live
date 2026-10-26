// Set one limit on every part between two stations, both tracks: node ../tools/set_stretch_speed.js "MISSORI" "DUOMO M3" 30
// Run from the build folder; rewrites ../data/rules_m3.json (cuts at the two stations if needed).
const fs = require('fs'), L = require('../tests/lib.js');
const { M, D } = L.load();
const [A, B, V] = process.argv.slice(2); const v = +V;
const rulesPath = '../data/rules_m3.json', rules = JSON.parse(fs.readFileSync(rulesPath)), speeds = rules.speeds, cuts = rules.cuts, edges = M.net.edges;
function insertCut(key, c) {
  const cs = (cuts[key] || []).slice(); if (cs.some(x => Math.abs(x - c) < 5)) return;
  const e = edges.find(x => x.key === key); if (c < 5 || c > e.len - 5) return;
  const old = cs.length ? cs.map((_, j) => speeds[key + '#' + j]).concat(speeds[key + '#' + cs.length]) : [speeds[key]];
  const j = cs.filter(x => x < c).length; cs.splice(j, 0, Math.round(c * 10) / 10); old.splice(j, 0, old[j]);
  Object.keys(speeds).filter(k => k === key || k.startsWith(key + '#')).forEach(k => delete speeds[k]);
  old.forEach((x, i) => { if (x != null) speeds[key + '#' + i] = x; }); cuts[key] = cs;
}
const st = L.stretches(M, D);
for (const x of [st.N.find(y => y.from === A && y.to === B), st.S.find(y => y.from === B && y.to === A)]) {
  if (!x) { console.log('stretch not found'); continue; }
  const pe = M.path_edges[x.pid].e;
  const local = (sp, d) => { const [ei, dir, a, b] = sp, k = edges[ei].len / ((b - a) || 1); return dir > 0 ? (d - a) * k : (b - d) * k; };
  for (const sp of pe) { const [ei, , a, b] = sp; if (edges[ei].fixed) continue; for (const d of [x.d0, x.d1]) if (d > a + 1 && d < b - 1) insertCut(edges[ei].key, local(sp, d)); }
  let n = 0;
  for (const sp of pe) { const [ei, dir, a, b] = sp, e = edges[ei]; if (e.fixed || b <= x.d0 || a >= x.d1) continue;
    const bd = [0, ...(cuts[e.key] || []), e.len], k = (b - a) / (e.len || 1);
    for (let j = 0; j < bd.length - 1; j++) { const p0 = dir > 0 ? a + bd[j] * k : b - bd[j + 1] * k, p1 = dir > 0 ? a + bd[j + 1] * k : b - bd[j] * k;
      if (p0 >= x.d0 - 1 && p1 <= x.d1 + 1) { if (cuts[e.key] && cuts[e.key].length) speeds[e.key + '#' + j] = v; else speeds[e.key] = v; n++; } } }
  console.log(`${x.from} → ${x.to}: ${v} km/h on ${n} part(s)`);
}
fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 1));
