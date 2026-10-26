// Fill the speed limits between Porta Romana and Repubblica (tracks on top of each other) from Giovanni's
// measured run times: for each stretch pick the limit (40/50/55/60/70) whose simulated time is closest,
// on both tracks, only where no limit is set yet. Run from the build folder; rewrites ../data/rules_m3.json.
const fs = require('fs'), L = require('../tests/lib.js');
const { M, D } = L.load();
const MEASURED = [['PORTA ROMANA', 'CROCETTA', 65], ['CROCETTA', 'MISSORI', 53], ['MISSORI', 'DUOMO M3', 55],
                  ['DUOMO M3', 'MONTENAPOLEONE', 65], ['MONTENAPOLEONE', 'TURATI', 58], ['TURATI', 'REPUBBLICA', 59]];
const CHOICES = [40, 50, 55, 60, 70];
// Giovanni: between Crocetta and Turati replace his own limits too (all parts, both tracks)
const OVERRIDE = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['CROCETTA', 'MISSORI', 'DUOMO M3', 'MONTENAPOLEONE']);
const rulesPath = '../data/rules_m3.json', rules = JSON.parse(fs.readFileSync(rulesPath));
const speeds = rules.speeds, cuts = rules.cuts;
const edges = M.net.edges;
const isSet = (key, j) => (cuts[key] && cuts[key].length) ? speeds[key + '#' + j] != null : speeds[key] != null;
function insertCut(key, c) {          // split a piece at c metres; both halves keep the old limit
  const cs = (cuts[key] || []).slice(); if (cs.some(x => Math.abs(x - c) < 5)) return;
  const e = edges.find(x => x.key === key); if (c < 5 || c > e.len - 5) return;
  const old = cs.length ? cs.map((_, j) => speeds[key + '#' + j]).concat(speeds[key + '#' + cs.length]) : [speeds[key]];
  const j = cs.filter(x => x < c).length; cs.splice(j, 0, Math.round(c * 10) / 10); old.splice(j, 0, old[j]);
  Object.keys(speeds).filter(k => k === key || k.startsWith(key + '#')).forEach(k => delete speeds[k]);
  old.forEach((v, i) => { if (v != null) speeds[key + '#' + i] = v; }); cuts[key] = cs;
}
// pieces of a path between two distances, as [key, part index] after cutting at both ends
function partsBetween(pid, d0, d1) {
  const pe = M.path_edges[pid].e, out = [];
  const local = (sp, d) => { const [ei, dir, a, b] = sp, e = edges[ei], k = e.len / ((b - a) || 1); return dir > 0 ? (d - a) * k : (b - d) * k; };
  for (const sp of pe) { const [ei, , a, b] = sp; if (edges[ei].fixed) continue;
    for (const d of [d0, d1]) if (d > a + 1 && d < b - 1) insertCut(edges[ei].key, local(sp, d)); }
  for (const sp of pe) { const [ei, , a, b] = sp, e = edges[ei]; if (e.fixed || b <= d0 || a >= d1) continue;
    const bd = [0, ...(cuts[e.key] || []), e.len];
    for (let j = 0; j < bd.length - 1; j++) { const x = (local(sp, a + 0.01) <= local(sp, b - 0.01)) ? [bd[j], bd[j + 1]] : [bd[j], bd[j + 1]];
      // the part's position on the path
      const k = (b - a) / (e.len || 1), p0 = sp[1] > 0 ? a + x[0] * k : b - x[1] * k, p1 = sp[1] > 0 ? a + x[1] * k : b - x[0] * k;
      if (p0 >= d0 - 1 && p1 <= d1 + 1) out.push([e.key, j]); } }
  return out;
}
const st = L.stretches(M, D), report = [];
for (const [A, B, T] of MEASURED) {
  for (const dir of ['N', 'S']) {                       // Giovanni measured towards Comasina; the other track is taken as similar
    const x = dir === 'N' ? st.N.find(y => y.from === A && y.to === B) : st.S.find(y => y.from === B && y.to === A);
    if (!x) { report.push(`${dir} ${A}–${B}: not found`); continue; }
    const free = partsBetween(x.pid, x.d0, x.d1).filter(([k, j]) => OVERRIDE.has(A) || !isSet(k, j));
    const setAll = v => free.forEach(([k, j]) => { if (cuts[k] && cuts[k].length) speeds[k + '#' + j] = v; else speeds[k] = v; });
    let best = null;
    if (free.length) {
      for (const v of CHOICES) { setAll(v); const t = L.runTime(M, L.profiles(M, speeds, cuts), x.pid, x.d0, x.d1);
        if (!best || Math.abs(t - T) < Math.abs(best.t - T) - 0.5) best = { v, t }; }
      setAll(best.v);
    }
    const t = L.runTime(M, L.profiles(M, speeds, cuts), x.pid, x.d0, x.d1);
    report.push(`${dir === 'N' ? '→ Comasina ' : '→ San Donato'} ${x.from} → ${x.to}: measured ${T} s | ` +
      (free.length ? `${best.v} km/h on ${free.length} part(s)${OVERRIDE.has(A) ? ' (replacing yours)' : ''}` : 'all parts already set by you') + ` | simulated ${t.toFixed(0)} s`);
  }
}
fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 1));
console.log(report.join('\n'));
