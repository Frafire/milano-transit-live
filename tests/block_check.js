// Block sections: never two trains in one section; how many trains stop at a red signal in the tunnel
// (not at a station), and for how long.
const L = require('./lib.js'), E = L.E;
const { M, D } = L.load();
const R = E.throatResources(M.throats, M.path_edges).concat(E.blockResources(M.blocks, M.path_edges, M.net.edges));
const day = L.runDay(M, D), res = day.res;
let bad = 0;
R.forEach(r => {
  const iv = [];
  res.forEach((x, k) => E.occupancy(x.segs, r, M.half).forEach(o => iv.push([o.enter, o.exit, k])));
  iv.sort((a, b) => a[0] - b[0]);
  let prev = null;
  for (const x of iv) { if (prev && x[2] !== prev[2] && x[0] < prev[1] - 1) bad++; if (!prev || x[1] > prev[1]) prev = x; }
});
// stops at a red signal outside a station: a stop (two equal points) that is not a timetable stop
const kinds = {}; M.blocks.forEach(b => (kinds[b.kind] = (kinds[b.kind] || 0) + 1));
const st = L.stations(M, D), pos = L.posOf(M);
const nearStation = (pid, d) => { const [x, y] = pos(pid, d); return st.some(s => Math.hypot(s.x - x, s.y - y) < 120); };
const waits = [];
res.forEach(x => x.segs.forEach(s => {
  if (s[1] !== 'service') return;
  const ts = s[3], ds = s[4];
  for (let i = 1; i < ds.length; i++) if (ds[i] === ds[i - 1] && ts[i] - ts[i - 1] > 2 && !nearStation(s[0], ds[i])) waits.push(ts[i] - ts[i - 1]);
}));
waits.sort((a, b) => a - b);
console.log(`blocks: ${M.blocks.length} sections ${JSON.stringify(kinds)} | two trains in one section: ${bad}`);
console.log(`  stops at a red signal in the tunnel: ${waits.length} | median ${Math.round(waits[waits.length >> 1] || 0)} s | longest ${Math.round(waits[waits.length - 1] || 0)} s | over 30 s: ${waits.filter(w => w > 30).length}`);
if (bad) process.exit(1);
