// Shared helpers for the Node checks: load the built M3 data, speed profiles, station stop times.
const E = require('../web/engine.js');
const KX = 111320 * Math.cos(45.46 * Math.PI / 180), KY = 110540;
function load(dir = process.cwd()) {
  const M = require(dir + '/m3.json'), D = require(dir + '/data.json');
  M.ops.train_half = M.half;
  return { M, D };
}
function profiles(M, speeds, cuts) { return E.buildProfiles(M.path_edges, M.net.edges, speeds || M.speeds, M.ops, cuts || M.cuts); }
// path geometry in metres, for "where is the train"
function pathGeo(M) {
  const cache = {};
  return pid => {
    if (cache[pid]) return cache[pid];
    const p = M.paths[pid], xs = [], ys = []; let a = 0, b = 0;
    for (let i = 0; i < p.p.length; i += 2) { a += p.p[i]; b += p.p[i + 1]; xs.push((b / 1e6 - 9.19) * KX); ys.push((a / 1e6 - 45.46) * KY); }
    return (cache[pid] = { xs, ys, d: p.d });
  };
}
function posOf(M) {
  const geo = pathGeo(M);
  return (pid, d) => { const g = geo(pid), n = g.d.length; let i = 0;
    while (i < n - 2 && g.d[i + 1] < d) i++;
    const f = g.d[i + 1] > g.d[i] ? Math.max(0, Math.min(1, (d - g.d[i]) / (g.d[i + 1] - g.d[i]))) : 0;
    return [g.xs[i] + (g.xs[i + 1] - g.xs[i]) * f, g.ys[i] + (g.ys[i + 1] - g.ys[i]) * f]; };
}
function stations(M, D) {
  const ri = D.routes.findIndex(r => r.id === M.line), acc = {};
  D.trips.forEach(t => { if (t[0] !== ri) return; t[5].forEach(s => { if (s < 0) return; const [n, la, lo] = D.stops[s];
    (acc[n] = acc[n] || []).push([la, lo]); }); });
  return Object.entries(acc).map(([n, l]) => { const la = l.reduce((a, x) => a + x[0], 0) / l.length, lo = l.reduce((a, x) => a + x[1], 0) / l.length;
    return { n, x: (lo - 9.19) * KX, y: (la - 45.46) * KY }; });
}
function envs(M, D) {
  if (!M.dwell) return null;
  const st = stations(M, D), pos = posOf(M);
  return M.trains.map((_, k) => ({ dwell: E.makeDwell(M.dwell, st, pos, 'T' + k) }));
}
// stations along the first complete service run in each direction: { N: [{ from, to, d0, d1, plan, pid }], S: [...] }
function stretches(M, D) {
  const out = { N: [], S: [] };
  for (const segs of M.trains) for (const sg of segs) {
    if (sg[1] !== 'service' || sg[2] < 0) continue;
    const names = D.trips[sg[2]][5].filter(x => x >= 0).map(x => D.stops[x][0]);
    const dir = names[0].startsWith('SAN DONATO') ? 'N' : 'S'; if (out[dir].length) continue;
    const ds = sg[4], ts = sg[3], stops = [];
    for (let i = 0; i < ds.length; i++) { if (i === 0 || ds[i] !== ds[i - 1]) stops.push({ d: ds[i], arr: ts[i], dep: ts[i] }); else stops[stops.length - 1].dep = ts[i]; }
    if (stops.length !== names.length) continue;
    for (let j = 0; j < names.length - 1; j++) out[dir].push({ from: names[j], to: names[j + 1], d0: stops[j].d, d1: stops[j + 1].d, plan: stops[j + 1].arr - stops[j].dep, pid: sg[0] });
  }
  return out;
}
// time to run from d0 to d1 on a path, from a stop to a stop, with these limits
function runTime(M, prof, pid, d0, d1) {
  const r = E.runTrain([[pid, 'empty', -1, [0, 1], [d0, d1]]], M.ops, 0, null, prof);
  const ts = r.segs[0][3]; return ts[ts.length - 1];
}
// the whole day as the game runs it: speed limits, stop times, one train at a time in the terminal junctions
function runDay(M, D, extra) {
  const R = E.throatResources(M.throats, M.path_edges).concat(E.blockResources(M.blocks, M.path_edges, M.net.edges), extra || []);
  return E.runBooked(M.trains, M.ops, M.reverse_s, R, M.half, null, profiles(M), envs(M, D));
}
module.exports = { runDay, E, load, profiles, posOf, stations, envs, stretches, runTime, KX, KY };
