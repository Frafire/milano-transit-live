// Milano Transit Live — live train engine (step 2: physics, following the plan, no signals yet).
//
// The plan (built in Python) says where each train should be and when: "what should happen".
// This engine drives every train with acceleration, braking and speed limits, second by second,
// and writes down where it really is: "what happens". With nothing going wrong the two must match.
//
// Output has the same shape as the plan (segments of [path, status, trip, times[], distances[]]),
// so the map draws live trains with the same code as planned ones.
(function (root) {
  const DT = 0.5;            // simulation step, seconds
  const SAMPLE = 4;          // record a position every 4 steps (2 s) while moving

  // cruise speed so that a leg of length L is covered in T seconds,
  // starting from a stop (ca = 1/(2a)) and/or ending in a stop (cb = 1/(2b))
  function cruiseSpeed(L, T, ca, cb, vmax) {
    if (T <= 0) return vmax;
    const c = ca + cb;
    if (c === 0) return Math.min(vmax, L / T);
    const disc = T * T - 4 * c * L;
    if (disc < 0) return vmax;                       // not reachable in time: as fast as allowed
    return Math.min(vmax, (T - Math.sqrt(disc)) / (2 * c));
  }

  // drive one run: from a stop, through timing points, to the next stop
  // prof: speed limits along this path, [[from d, to d, m/s], ...] sorted by from d. With limits the train runs like
  // the ATO does: as fast as allowed, then waits at the next stop. Without, it keeps to the planned running times.
  // slow: { until, ms } a speed restriction until a time (after a stretch reopens: 20 km/h for 2 minutes)
  // zones: [[from d, to d, m/s]] extra limits on this run (an empty train passing a platform: 40 km/h)
  function driveRun(pid, legs, t0, ops, out, prof, slow, zones) {
    const a = ops.acceleration_ms2, b = ops.braking_ms2, vmax = (prof ? (ops.train_max_kmh || 90) : ops.line_max_kmh) / 3.6;
    const half = ops.train_half || 0;
    const n = legs.length;
    const vt = legs.map((g, k) => prof ? vmax : cruiseSpeed(g.d1 - g.d0, g.t1 - g.t0, k === 0 ? 1 / (2 * a) : 0, k === n - 1 ? 1 / (2 * b) : 0, vmax));
    let p0 = 0;
    const end = legs[n - 1].d1;
    let d = legs[0].d0, v = 0, t = t0, k = 0, step = 0, wasChanging = true;
    const ts = [t], ds = [d];
    while (d < end - 0.01) {
      while (k < n - 1 && d >= legs[k].d1) k++;
      // the fastest we may go here so we can still slow down for every later leg and stop at the end
      let vcap = vt[k];
      for (let j = k + 1; j < n; j++) vcap = Math.min(vcap, Math.sqrt(vt[j] * vt[j] + 2 * b * Math.max(0, legs[j].d0 - d)));
      vcap = Math.min(vcap, Math.sqrt(2 * b * Math.max(0, end - d)));
      if (prof) {                                   // speed limits: under the whole train, and braking for the next ones
        while (p0 < prof.length - 1 && prof[p0][1] < d - half) p0++;
        for (let j = p0; j < prof.length; j++) {
          const sg = prof[j]; if (sg[0] > d + half + 400) break;
          if (sg[1] < d - half) continue;
          if (sg[0] <= d + half) vcap = Math.min(vcap, sg[2]);
          else vcap = Math.min(vcap, Math.sqrt(sg[2] * sg[2] + 2 * b * (sg[0] - d - half)));
        }
      }
      if (slow && t < slow.until) vcap = Math.min(vcap, slow.ms);
      if (zones) for (const z of zones) {
        if (z[1] < d - half || z[0] > d + half + 400) continue;
        if (z[0] <= d + half) vcap = Math.min(vcap, z[2]); else vcap = Math.min(vcap, Math.sqrt(z[2] * z[2] + 2 * b * (z[0] - d - half)));
      }
      const v0 = v;
      if (v < vcap) v = Math.min(vcap, v + a * DT); else v = Math.max(vcap, v - b * DT * 1.5);
      if (v < 0.3) v = 0.3;                          // creep the last centimetres
      d = Math.min(end, d + v * DT); t += DT; step++;
      // smooth playback: a point every step while speeding up or braking, every 4 s at steady speed
      const changing = Math.abs(v - v0) > 1e-6;
      if (changing !== wasChanging || (changing ? true : step % 8 === 0)) { ts.push(t); ds.push(d); }
      wasChanging = changing;
      if (step > 200000) break;                      // safety
    }
    if (ts[ts.length - 1] !== t) { ts.push(t); ds.push(end); }
    out.ts.push(...ts.slice(out.ts.length ? 1 : 0)); out.ds.push(...ds.slice(out.ds.length ? 1 : 0));
    return t;
  }

  // simulate one train for the whole day; returns live segments + a log of arrivals (plan vs actual)
  // env.dwell(pid, d, tArrive, late, key): seconds to stand at this stop, or null to keep to the plan
  // prev/from: keep the result of an earlier run up to segment `from` and drive again only from there
  function runTrain(segs, ops, reverse, holds, profiles, env, prev, from) {
    holds = holds || {};
    let live = [], log = [], t = -Infinity, si0 = 0;
    if (prev && from > 0) {
      live = prev.segs.slice(0, from); log = prev.log.filter(e => e.seg < from); si0 = from;
      const ls = live[from - 1][3]; t = ls[ls.length - 1];
    }
    for (let si = si0; si < segs.length; si++) {
      const s = segs[si], [pid, status, trip, pts, pds] = s;
      // between segments the train reverses or rests: it never starts before the plan,
      // and never takes less than the cab change (or the planned gap, if shorter)
      const gap = si > 0 ? pts[0] - segs[si - 1][3][segs[si - 1][3].length - 1] : 0;
      let start = si === 0 ? pts[0] : Math.max(pts[0], t + Math.min(gap, reverse));
      if (holds[si + ':start']) start = Math.max(start, holds[si + ':start']);
      const out = { ts: [start], ds: [pds[0]] };
      t = start;
      let i = 0;
      while (i < pts.length - 1) {
        if (pds[i + 1] === pds[i]) {                    // standing: station stop, boarding, waiting
          const planned = pts[i + 1] - pts[i], hold = holds[si + ':' + (i + 1)] || 0;
          // intermediate stations in service: the real stop time, then go (no waiting for the timetable)
          const dw = env && env.dwell && status === 'service' && i > 0 ? env.dwell(pid, pds[i], t, t - pts[i], si + ':' + i) : null;
          const extra = env && env.extra ? (env.extra[si + ':' + i] || 0) : 0;      // longer stop ordered by radio
          // never before the timetable, unless the driver is ordered to leave early (env.early)
          if (dw != null) { t = Math.max(t + dw + extra, hold, env.early && env.early(si, i) ? 0 : pts[i + 1]); out.ts.push(t); out.ds.push(pds[i + 1]); i++; continue; }
          const minWait = Math.min(planned, ops.station_stop_s >= 20 ? 20 : planned);
          t = Math.max(pts[i + 1], t + minWait + extra, hold);
          out.ts.push(t); out.ds.push(pds[i + 1]);
          i++;
          continue;
        }
        // moving: gather the timing points up to the next stop
        const legs = [];
        let j = i;
        while (j < pts.length - 1 && pds[j + 1] !== pds[j]) { legs.push({ d0: pds[j], d1: pds[j + 1], t0: pts[j], t1: pts[j + 1] }); j++; }
        const late = t - pts[i];
        const sub = { ts: [], ds: [] };
        // an empty train (not in service) does not stop at stations but passes the platforms at 40 km/h
        const zones = status !== 'service' && env && env.platforms && env.platforms[pid] ? env.platforms[pid] : null;
        t = driveRun(pid, legs, t, ops, sub, profiles ? profiles[pid] : null, env && env.slow, zones);
        out.ts.push(...sub.ts.slice(1)); out.ds.push(...sub.ds.slice(1));
        log.push({ seg: si, status, planned: pts[j], actual: t, lateIn: late });
        i = j;
      }
      const seg = [pid, status, trip, out.ts.map(x => Math.round(x * 10) / 10), out.ds.map(x => Math.round(x * 10) / 10)];
      if (s.length > 5) seg.push(s[5]);
      live.push(seg);
    }
    return { segs: live, log };
  }

  function runFleet(trains, ops, reverse, profiles, envs) {
    return trains.map((segs, k) => runTrain(segs, ops, reverse, null, profiles, envs && envs[k]));
  }

  // ---------------- station stop times ----------------
  // cfg: data/dwell_m3.json. Same train, same stop, same day: always the same "random" number.
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  function stopTime(cfg, station, t, late, seed) {
    const cl = cfg.classes.find(c => c.stations.includes(station)) || cfg.default;
    if (late > (cfg.late_after_s || 30)) return cl.min;
    const h = (t / 3600) % 24, rush = cfg.rush_hours.some(([a, b]) => h >= a && h < b), mid = (cl.min + cl.max) / 2;
    const [lo, hi] = rush ? [mid, cl.max] : [cl.min, mid];
    return Math.round(lo + (hi - lo) * hash(seed));
  }
  // station at a point of a path: stations = [{ n, x, y }] in metres, posOf(pid, d) -> [x, y]
  function makeDwell(cfg, stations, posOf, trainSeed) {
    const cache = {};
    return (pid, d, t, late, key) => {
      const ck = pid + ':' + Math.round(d);
      if (!(ck in cache)) { const [x, y] = posOf(pid, d); let best = null;
        for (const s of stations) { const dd = Math.hypot(s.x - x, s.y - y); if (dd < 200 && (!best || dd < best.dd)) best = { dd, n: s.n }; }
        cache[ck] = best ? best.n : null; }
      const n = cache[ck]; if (!n) return null;
      return stopTime(cfg, n, t, late, trainSeed + ':' + key + ':' + n);
    };
  }

  // ---------------- speed limits ----------------
  // A track piece (junction to junction) can be cut into parts; each part has its own limit.
  // cuts[key] = sorted distances in metres from the piece's first node (a); part i limit = speeds[key + '#' + i],
  // or speeds[key] for the whole piece, or the line default.
  function partBounds(e, cuts) { const c = (cuts && cuts[e.key]) || []; return [0, ...c, e.len]; }
  function partLimit(e, i, speeds, cuts) {
    if (e.fixed) return e.kmh;
    const c = cuts && cuts[e.key] && cuts[e.key].length;
    const k = c ? e.key + '#' + i : e.key;
    if (speeds && speeds[k] != null) return speeds[k];
    if (speeds && speeds[e.key] != null) return speeds[e.key];
    return e.kmh;
  }
  function edgeLimit(e, speeds) { return partLimit(e, 0, speeds, null); }
  // per path: [[from, to, m/s, the limit itself (m/s), 1 if the ATO cruises under it]] from the track pieces (and their
  // parts) + 15 km/h on the diverging side of junctions. The third value already has the usual ATO cruise in it
  // (ops.ato_cruise_pct); the agents' smart ATO uses the limit and its own percentage (web/agents.js)
  function buildProfiles(pathEdges, netEdges, speeds, ops, cuts) {
    const div = (ops.diverging_kmh || 15) / 3.6, w = 25;
    return pathEdges.map(pe => {
      if (!pe || !pe.e.length) return null;
      const out = [], reg = (ops.ato_cruise_pct || 100) / 100;     // the ATO cruises a little under the limit
      pe.e.forEach(([ei, dir, a, b]) => {
        const e = netEdges[ei], bd = partBounds(e, cuts), k = (b - a) / (e.len || 1);
        for (let i = 0; i < bd.length - 1; i++) {
          const raw = partLimit(e, i, speeds, cuts) / 3.6, v = raw * (e.fixed ? 1 : reg);
          const x0 = dir > 0 ? a + bd[i] * k : b - bd[i + 1] * k, x1 = dir > 0 ? a + bd[i + 1] * k : b - bd[i] * k;
          out.push([x0, x1, v, raw, e.fixed ? 0 : 1]);
        }
      });
      // curves: 10 km/h less than the track's limit (ops.curve_minus_kmh), never below the depot speed
      const cm = (ops.curve_minus_kmh || 0) / 3.6;
      if (cm > 0 && pe.curves) {
        const base = out.slice();
        pe.curves.forEach(([c0, c1]) => base.forEach(([a0, a1, v, raw, sc]) => {
          if (a1 <= c0 || a0 >= c1) return;
          out.push([Math.max(a0, c0), Math.min(a1, c1), Math.max(v - cm, 15 / 3.6), Math.max(raw - cm, 15 / 3.6), sc]);
        }));
      }
      // the depot sheds (data/capannoni_m3.json): at most shed_speed_kmh while any part of the train is inside (Giovanni)
      if (pe.sheds && ops.shed_speed_kmh) { const vs = ops.shed_speed_kmh / 3.6; pe.sheds.forEach(([s0, s1]) => out.push([s0, s1, vs, vs, 0])); }
      // the wash (Giovanni 9 Nov): through the wash house at wash_speed_kmh, without stopping
      if (pe.wash && ops.wash_speed_kmh) { const vw = ops.wash_speed_kmh / 3.6; pe.wash.forEach(([s0, s1]) => out.push([s0, s1, vw, vw, 0])); }
      pe.div.forEach(x => { const d = Array.isArray(x) ? x[0] : x, j = Array.isArray(x) && speeds ? speeds['J' + x[1]] : null;
        const vj = j != null ? j / 3.6 : div; out.push([d - w, d + w, vj, vj, 0]); });
      return out.sort((x, y) => x[0] - y[0]);
    });
  }

  // Passenger delay follows service runs only; late empty positioning runs are not passenger lateness.
  function serviceDelay(log, segs, t) {
    let delay = 0;
    for (const e of log || []) {
      if (e.actual > t) break;
      const status = e.status || (segs[e.seg] && segs[e.seg][1]);
      if (status === 'service') delay = e.actual - e.planned;
    }
    return delay;
  }

  // ---------------- one train per section (ZUB, and the reversing stub when the line is closed) ----------------
  // resources: [{ name, ranges: { pid: [a, b] } }]. A train occupies a resource from when its front reaches a
  // until its rear clears b. A train that would enter while another is inside waits at its last stop before.
  function occupancy(segs, res, half) {
    const out = [], pad = res.pad || 0;
    segs.forEach((s, si) => {
      const r = res.ranges[s[0]]; if (!r) return;
      const [a, b] = r, ts = s[3], ds = s[4];
      if (ds[ds.length - 1] < a - half + pad || ds[0] > b + half) return;     // this segment never reaches the section
      let enter = null;
      for (let i = 0; i < ts.length; i++) {
        const inside = ds[i] >= a - half + pad && ds[i] <= b + half;
        if (inside && enter === null) enter = ts[i];
        if (!inside && enter !== null) { out.push({ si, status: s[1], enter, exit: ts[i] }); enter = null; }
      }
      if (enter !== null) out.push({ si, status: s[1], enter, exit: si === segs.length - 1 ? Infinity : ts[ts.length - 1], open: true });
    });
    // a train that stops inside and goes on in its next segment (reversal) keeps the resource
    const merged = [];
    out.forEach(x => {
      const m = merged[merged.length - 1];
      if (m && m.open && x.enter - m.exit < 600) { m.exit = x.exit; m.open = x.open; if (x.status === 'service') m.status = 'service'; } else merged.push({ ...x });
    });
    return merged;
  }

  // ---------------- terminal junction areas ----------------
  // throats: [{ name, edges: [edge index], p1: [edge index] }] from the build; pathEdges: per path [[edge, dir, from, to]]
  function throatResources(throats, pathEdges) {
    const out = [];
    (throats || []).forEach(th => {
      const make = (name, list, pad) => {
        const set = new Set(list), R = { name, ranges: {}, pad };
        pathEdges.forEach((pe, pid) => { if (!pe) return; let a = Infinity, b = -Infinity;
          pe.e.forEach(([ei, , x0, x1]) => { if (set.has(ei)) { a = Math.min(a, x0); b = Math.max(b, x1); } });
          if (a < b) R.ranges[pid] = [a, b]; });
        return R;
      };
      if (th.edges.length) {
        const R = make('incrocio ' + th.name, th.edges, 10); R.noWait = true;     // nobody waits inside a junction
        // tail exit first: x (later) is leaving a tail (starts at the very beginning of its path) and p is going into one
        // Who goes first when one train wants to leave a tail (x) and another to go into one (p)? Normally first come,
        // first served: the tail train waits and two trains end up in the tails. The tail train goes first only if
        // waiting would make it leave late (Giovanni).
        R.prefer = (plans, x, p) => {
          const sx = plans[x.k][x.si], sp = plans[p.k][p.si];
          const exit = sx[1] === 'turnback' && sx[4][0] < 300, entry = sp[1] === 'turnback' && sp[4][0] >= 300;
          if (!exit || !entry) return false;
          const nx = plans[x.k][x.si + 1]; if (!nx || nx[1] !== 'service') return false;
          const atPlatform = sx[3][sx[3].length - 1] + Math.max(0, p.exit + 2 - x.enter), dep = nx[3][1];
          return atPlatform + 30 > dep;
        };
        out.push(R);
      }
      if (th.p1 && th.p1.length) out.push(make('binario 3 ' + th.name, th.p1, 10));
      (th.tails || []).forEach((ei, i) => out.push(make('tronchetto ' + (i + 1) + ' ' + th.name, [ei], 10)));   // one train per tail
    });
    return out;
  }


  // ---------------- closing San Donato - Rogoredo at time tc ----------------
  // S: section data from the build. Trains inside stop where they are; trains on the San Donato side stay there
  // (depot moves are free); every other train coming from Comasina turns back at Rogoredo over the crossover.
  function stateAt(segs, t) {
    for (let si = 0; si < segs.length; si++) {
      const ts = segs[si][3], ds = segs[si][4];
      if (t < ts[0]) return { si, d: ds[0], v: 0, before: true };
      if (t <= ts[ts.length - 1]) {
        let i = 0; while (i < ts.length - 2 && ts[i + 1] <= t) i++;
        const sp = ts[i + 1] - ts[i], f = sp > 0 ? (t - ts[i]) / sp : 0;
        return { si, d: ds[i] + (ds[i + 1] - ds[i]) * f, v: sp > 0 ? (ds[i + 1] - ds[i]) / sp : 0 };
      }
    }
    return { si: segs.length, d: null, v: 0 };
  }


  const stopOf = (G, dir, i) => dir === 'N' ? G.N.stops[i] : G.S.stops[G.names.length - 1 - i];
  // platforms on each path, for an empty train passing them at 40 km/h: { pid: [[from d, to d, m/s]] }
  function platformZones(G) {
    const out = {}; if (!G || !G.platforms) return out;
    for (const [pid, z] of Object.entries(G.platforms)) out[pid] = z.map(([a, b, st]) => [a, b, 40 / 3.6, st]);
    return out;
  }
  const api = { runTrain, runFleet, stateAt, occupancy, cruiseSpeed, buildProfiles, serviceDelay, edgeLimit, partLimit, partBounds, stopTime, makeDwell, throatResources, DT, platformZones, stopOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
