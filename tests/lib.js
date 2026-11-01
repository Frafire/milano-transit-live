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
  const platforms = E.platformZones(M.degraded);
  return M.trains.map((_, k) => ({ dwell: E.makeDwell(M.dwell, st, pos, 'T' + k), platforms }));
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
// the timetable stops of a planned move: [{ st (station index), j (index in the times), d }]
function stopsOfM(M, D) {
  const G = M.degraded, idx = {}; G.names.forEach((n, i) => (idx[n] = i));
  return seg => {
    let st = null;
    if (seg[6] && seg[6].st) st = seg[6].st;
    else if (seg[1] === 'service' && seg[2] >= 0) { st = D.trips[seg[2]][5].filter(x => x >= 0).map(x => idx[D.stops[x][0]]); if (st.some(x => x == null)) return []; }
    else return [];
    const ds = seg[4], pts = [];
    for (let i = 0; i < ds.length; i++) if (i === 0 || ds[i] !== ds[i - 1]) pts.push({ d: ds[i], j: i });
    if (pts.length !== st.length) return [];
    return pts.map((p, k) => ({ st: st[k], j: p.j, d: p.d }));
  };
}
// the agents (web/agents.js) with the built line: the one engine
function agents(M, D, initAt, extraOpts) {
  const A = require('../web/agents.js'), envs_ = envs(M, D);
  return A.create(Object.assign({ G: M.degraded, ops: M.ops, reverse: M.reverse_s, half: M.half, prof: profiles(M), pathEdges: M.path_edges, netEdges: M.net.edges,
    plans0: M.trains, stopsOf: stopsOfM(M, D), sigpos: M.net.sigpos, sigall: M.net.sigall, itineraries: M.net.itineraries, variants: M.net.variants, closureTurns: M.net.closure_turns, closureOneTrack: M.net.closure_one_track, navette: M.net.navette, revPaths: M.net.rev_paths, routeRules: M.net.route_rules, interlocking: M.net.interlocking, zones: E.platformZones(M.degraded),
    dwell: envs_ ? envs_.map(e => e.dwell) : null, extra: () => 0, initAt }, extraOpts || {}));
}
// where every train stands before its day starts (its first move, not yet started)
const dayStart = M => M.trains.map(segs => ({ pid: segs[0][0], d: segs[0][4][0], v: 0, seg: 0, before: true, startAt: segs[0][3][0] }));
// the whole day driven by the agents, from before the first train to the end of the service, recorded as moves
// (the same form as the plan: [pid, status, trip, times, distances, ...]) and departure/arrival logs
function driveDay(M, D) {
  const n = M.trains.length, rec = Array.from({ length: n }, () => ({ segs: [], log: [], cur: null, lastT: -1, lastV: 0, stop: null, held: 0, red: false }));
  const r1 = x => Math.round(x * 10) / 10;
  const record = (k, a, t) => {
    const R = rec[k], plan = M.trains[k];
    if (a.mode !== 'plan' || a.si >= plan.length || t < a.wait) {
      if (R.cur && a.mode === 'static') { R.segs.push(R.cur.seg); R.cur = null; }
      return;
    }
    if (!R.cur || R.cur.si !== a.si) {
      if (R.cur) R.segs.push(R.cur.seg);
      while (R.segs.length < a.si) { const s = plan[R.segs.length]; R.segs.push([s[0], s[1], s[2], [t, t], [s[4][0], s[4][0]], ...s.slice(5)]); }   // (never driven)
      const s = plan[a.si];
      R.cur = { si: a.si, seg: [s[0], s[1], s[2], [r1(t - 0.5)], [r1(a.d)], ...s.slice(5)] }; R.lastT = t; R.lastV = a.v;
    }
    const sg = R.cur.seg, ts = sg[3], ds = sg[4], moving = a.v > 0, wasMoving = R.lastV > 0;
    // the interlocking gave the move on another way (its twin path), before the train moved: the move is on that path
    if (a.pid !== sg[0]) { if (ds.every(x => x === ds[0])) { sg[0] = a.pid; for (let i = 0; i < ds.length; i++) ds[i] = r1(a.d); } else R.pidChanged = (R.pidChanged || 0) + 1; }
    if (moving !== wasMoving || (moving && t - R.lastT >= 4)) {
      if (!moving && wasMoving) { ts.push(r1(t)); ds.push(r1(a.d)); }                      // stops
      else if (moving && !wasMoving) { ts.push(r1(t - 0.5)); ds.push(ds[ds.length - 1]); ts.push(r1(t)); ds.push(r1(a.d)); }   // leaves
      else { ts.push(r1(t)); ds.push(r1(a.d)); }
      R.lastT = t;
    }
    R.lastV = a.v;
    if (a.stopAt != null && R.stop == null && a.arriveT === t) R.log.push({ seg: a.si, status: sg[1], planned: a.arrLate != null ? t - a.arrLate : t, actual: t });
    R.stop = a.stopAt;
    if (a.red && !R.red) R.held++; R.red = !!a.red;
  };
  const ag = agents(M, D, null, { record });
  const T0 = Math.min(...M.trains.map(s => s[0][3][0])) - 60, T1 = Math.max(...M.trains.map(s => s[s.length - 1][3][s[s.length - 1][3].length - 1])) + 1800;
  ag.start(T0, dayStart(M));
  for (let t = T0; t < T1; t += 600) ag.step(Math.min(T1, t + 600));
  rec.forEach((R, k) => { if (R.cur) { const ts = R.cur.seg[3], ds = R.cur.seg[4]; ts.push(r1(T1)); ds.push(ds[ds.length - 1]); R.segs.push(R.cur.seg); R.cur = null; }
    const plan = M.trains[k]; while (R.segs.length < plan.length) { const s = plan[R.segs.length]; R.segs.push([s[0], s[1], s[2], [T1, T1], [s[4][s[4].length - 1], s[4][s[4].length - 1]], ...s.slice(5)]); } });
  return { res: rec.map(R => ({ segs: R.segs, log: R.log })), held: rec.reduce((x, R) => x + R.held, 0), rt: ag.rt(), T0, T1, pidChanged: rec.reduce((x, R) => x + (R.pidChanged || 0), 0) };
}
// the whole day as the game runs it (the one driven at build time, build/m3_live.json, when it is there)
function runDay(M, D) {
  const fs = require('fs'), f = process.cwd() + '/m3_live.json';
  if (fs.existsSync(f) && !process.env.FRESH_DAY) {
    const L = JSON.parse(fs.readFileSync(f, 'utf8')), dec = a => { let p = 0; return a.map(x => (p += x) / 10); };
    if (L.trains.length === M.trains.length) return { res: L.trains.map(x => ({ segs: x.segs.map(g => [g[0], g[1], g[2], dec(g[3]), dec(g[4]), ...g.slice(5)]), log: x.log.map(([seg, planned, actual, st]) => ({ seg, planned, actual, status: st })) })), held: L.held };
  }
  return driveDay(M, D);
}
// where every train is at time t on a driven day (for the agents' start)
function posAt(day, t) {
  return day.res.map(r => {
    const s = E.stateAt(r.segs, t), sg = r.segs[Math.min(s.si, r.segs.length - 1)];
    if (s.si >= r.segs.length) return { pid: sg[0], d: sg[4][sg[4].length - 1], v: 0, seg: s.si, status: 'parked' };
    if (s.before) { const p = s.si > 0 ? r.segs[s.si - 1] : sg; return { pid: s.si > 0 ? p[0] : sg[0], d: s.si > 0 ? p[4][p[4].length - 1] : sg[4][0], v: 0, seg: s.si, before: true, startAt: sg[3][0] }; }
    let leaveAt = null; const ts = sg[3], ds = sg[4];
    for (let i = 0; i < ts.length - 1; i++) if (ts[i] <= t && ts[i + 1] > t && ds[i + 1] === ds[i]) leaveAt = ts[i + 1];
    return { pid: sg[0], d: s.d, v: s.v, seg: s.si, leaveAt, status: sg[1] };
  });
}
// the same point of track on another path (twin paths: the other way of a movement)
function mapTo(M, pid, d, pid2) {
  const pe = M.path_edges[pid], pe2 = M.path_edges[pid2]; if (!pe || !pe2) return null;
  const sp = pe.e.find(([, , x0, x1]) => d >= x0 && d <= x1); if (!sp) return null;
  const [ei, dir, x0, x1] = sp, l = (dir > 0 ? d - x0 : x1 - d) * (M.net.edges[ei].len || 1) / ((x1 - x0) || 1);
  const sp2 = pe2.e.find(x => x[0] === ei); if (!sp2) return null;
  const [, dir2, y0, y1] = sp2, k2 = ((y1 - y0) || 1) / (M.net.edges[ei].len || 1);
  return dir2 > 0 ? y0 + l * k2 : y1 - l * k2;
}
module.exports = { mapTo, runDay, driveDay, agents, dayStart, posAt, stopsOfM, E, load, profiles, posOf, stations, envs, stretches, runTime, KX, KY };
