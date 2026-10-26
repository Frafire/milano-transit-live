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
  // per path: [[from, to, m/s]] from the track pieces (and their parts) + 15 km/h on the diverging side of junctions
  function buildProfiles(pathEdges, netEdges, speeds, ops, cuts) {
    const div = (ops.diverging_kmh || 15) / 3.6, w = 25;
    return pathEdges.map(pe => {
      if (!pe || !pe.e.length) return null;
      const out = [], reg = (ops.ato_cruise_pct || 100) / 100;     // the ATO cruises a little under the limit
      pe.e.forEach(([ei, dir, a, b]) => {
        const e = netEdges[ei], bd = partBounds(e, cuts), k = (b - a) / (e.len || 1);
        for (let i = 0; i < bd.length - 1; i++) {
          const v = partLimit(e, i, speeds, cuts) / 3.6 * (e.fixed ? 1 : reg);
          const x0 = dir > 0 ? a + bd[i] * k : b - bd[i + 1] * k, x1 = dir > 0 ? a + bd[i + 1] * k : b - bd[i] * k;
          out.push([x0, x1, v]);
        }
      });
      // curves: 10 km/h less than the track's limit (ops.curve_minus_kmh), never below the depot speed
      const cm = (ops.curve_minus_kmh || 0) / 3.6;
      if (cm > 0 && pe.curves) {
        const base = out.slice();
        pe.curves.forEach(([c0, c1]) => base.forEach(([a0, a1, v]) => {
          if (a1 <= c0 || a0 >= c1) return;
          out.push([Math.max(a0, c0), Math.min(a1, c1), Math.max(v - cm, 15 / 3.6)]);
        }));
      }
      pe.div.forEach(x => { const d = Array.isArray(x) ? x[0] : x, j = Array.isArray(x) && speeds ? speeds['J' + x[1]] : null;
        out.push([d - w, d + w, j != null ? j / 3.6 : div]); });
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
  function holdKey(plan, si, a, half) {
    const pts = plan[si][3], pds = plan[si][4];
    let m = -1;
    for (let i = 1; i < pds.length; i++) { if (pds[i] >= a - half) break; if (pds[i] === pds[i - 1]) m = i; }
    return m >= 0 ? si + ':' + m : si + ':start';
  }
  // keep: { holds, plans } of an earlier booked run, to continue from it after a small change (only new conflicts)
  function runBooked(plans, ops, reverse, resources, half, base, profiles, envs, keep, log) {
    plans = keep ? keep.plans.slice() : plans.slice();
    const holds = keep ? keep.holds.map(h => ({ ...h })) : plans.map(() => ({}));
    const res = base ? base.slice() : plans.map((p, k) => runTrain(p, ops, reverse, null, profiles, envs && envs[k]));
    // occupancy of every resource by every train, refreshed only for the train that was just driven again
    const occ = resources.map(R => res.map(r => occupancy(r.segs, R, half)));
    const skip = new Set();
    let guard = 0, held = 0;
    // earliest conflict in one resource (cached; recomputed only when a train using it was driven again)
    const conflictOf = ri => {
      const iv = [];
      occ[ri].forEach((list, k) => { for (const x of list) iv.push({ enter: x.enter, exit: x.exit, si: x.si, status: x.status, open: x.open, k }); });
      iv.sort((x, y) => x.enter - y.enter);
      for (let i = 0; i < iv.length; i++) {
        const x = iv[i]; let conflict = null, latestAllowed = -Infinity;
        for (let j = 0; j < i; j++) {
          const p = iv[j]; if (p.k === x.k) continue;
          const clearance = resources[ri].block ? (p.status === 'service' || x.status === 'service' ? 120 : 90) : 2;
          const allowed = Math.max(p.exit, p.enter + clearance);
          if (x.enter < allowed - 0.5 && allowed > latestAllowed && !skip.has(ri + ':' + x.k + ':' + x.si + ':' + Math.round(x.enter))) {
            conflict = { x, p, clearance }; latestAllowed = allowed;
          }
        }
        if (conflict) return conflict;
      }
      return null;
    };
    const cache = resources.map((_, ri) => conflictOf(ri));
    for (;;) {
      if (++guard > 6000) break;
      let best = null;
      cache.forEach((c, ri) => { if (c && (!best || c.x.enter < best.x.enter)) best = { R: resources[ri], ri, x: c.x, p: c.p, clearance: c.clearance }; });
      if (!best) break;
      let { R, ri, x, p } = best;
      // the junction tends to empty the tail first: a train leaving the tail goes before one about to enter it
      if (R.prefer && R.prefer(plans, x, p)) [x, p] = [p, x];

      const a = R.ranges[plans[x.k][x.si][0]][0] + (R.pad || 0);
      let key = holdKey(plans[x.k], x.si, a, half);
      const sg = plans[x.k][x.si];
      let stopD = (R.stopAt && R.stopAt[sg[0]] != null) ? R.stopAt[sg[0]] : a - half - 10;
      // never wait inside another section (e.g. in the junction waiting for platform 1): wait before it instead
      for (let n = 0; n < 4; n++) {
        const inside = resources.find(Q => Q !== R && Q.noWait && Q.ranges[sg[0]] && stopD >= Q.ranges[sg[0]][0] - half && stopD <= Q.ranges[sg[0]][1] + half && Q.ranges[sg[0]][0] < a);
        if (!inside) break;
        stopD = (inside.stopAt && inside.stopAt[sg[0]] != null) ? inside.stopAt[sg[0]] : inside.ranges[sg[0]][0] - half - 10;
      }
      if (stopD <= sg[4][0] + 1) key = x.si + ':start';       // the wait happens before this movement even starts
      const lastStop = key.endsWith(':start') ? null : sg[4][+key.split(':')[1]];
      if ((lastStop === null || stopD - lastStop > 400 || lastStop > stopD) && stopD > sg[4][0] + 1) {
        // no station just before: stop at the entrance (signal) and wait there
        const ts = sg[3], ds = sg[4]; let i = 0; while (i < ds.length - 1 && ds[i + 1] <= stopD) i++;
        if (i < ds.length - 1 && ds[i + 1] > ds[i]) {
          const tt = ts[i] + (ts[i + 1] - ts[i]) * (stopD - ds[i]) / (ds[i + 1] - ds[i]);
          const ns = [sg[0], sg[1], sg[2], [...ts.slice(0, i + 1), tt, tt, ...ts.slice(i + 1)], [...ds.slice(0, i + 1), stopD, stopD, ...ds.slice(i + 1)], ...sg.slice(5)];
          plans[x.k] = plans[x.k].slice(); plans[x.k][x.si] = ns;
          const old = holds[x.k]; holds[x.k] = {};
          for (const [kk, vv] of Object.entries(old)) { const [a1, b1] = kk.split(':'); holds[x.k][(+a1 === x.si && b1 !== 'start' && +b1 > i) ? a1 + ':' + (+b1 + 2) : kk] = vv; }
          key = x.si + ':' + (i + 2);
        }
      }
      const until = Math.min(Math.max(p.exit, p.enter + (best.clearance || 90)) + 2, 30 * 3600);
      if ((holds[x.k][key] || 0) >= until || until <= x.enter + 1) { skip.add(ri + ':' + x.k + ':' + x.si + ':' + Math.round(x.enter)); cache[ri] = conflictOf(ri); continue; }   // cannot do better here
      holds[x.k][key] = until; held++;
      if (log) log.push({ train: x.k, seg: x.si, status: plans[x.k][x.si][1], res: R.name, from: x.enter, until, by: p.k, byStatus: plans[p.k][p.si][1] });
      res[x.k] = runTrain(plans[x.k], ops, reverse, holds[x.k], profiles, envs && envs[x.k], res[x.k], x.si);
      resources.forEach((R2, r2) => {
        const before = occ[r2][x.k], after = occupancy(res[x.k].segs, R2, half);
        occ[r2][x.k] = after;
        if (before.length || after.length) cache[r2] = conflictOf(r2);
      });
    }
    return { res, holds, held, plans };
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
      if (th.p1 && th.p1.length) out.push(make('binario 1 ' + th.name, th.p1, 10));
      (th.tails || []).forEach((ei, i) => out.push(make('tronchetto ' + (i + 1) + ' ' + th.name, [ei], 10)));   // one train per tail
    });
    return out;
  }

  // ---------------- block sections along the line ----------------
  // blocks: [{ name, parts: [[edge, from m, to m], ...] }] in metres along each track piece (from its node a)
  function blockResources(blocks, pathEdges, netEdges) {
    return (blocks || []).map(bl => {
      const R = { name: 'blocco ' + bl.name, ranges: {}, pad: 3, block: true };
      const byEdge = {}; bl.parts.forEach(([ei, l0, l1]) => (byEdge[ei] = byEdge[ei] || []).push([l0, l1]));
      pathEdges.forEach((pe, pid) => {
        if (!pe) return; let a = Infinity, b = -Infinity;
        pe.e.forEach(([ei, dir, x0, x1]) => {
          const ps = byEdge[ei]; if (!ps) return; const k = (x1 - x0) / (netEdges[ei].len || 1);
          ps.forEach(([l0, l1]) => { const p0 = dir > 0 ? x0 + l0 * k : x1 - l1 * k, p1 = dir > 0 ? x0 + l1 * k : x1 - l0 * k; a = Math.min(a, p0); b = Math.max(b, p1); });
        });
        if (b - a > 20) R.ranges[pid] = [a, b];
      });
      return R;
    });
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
  const timeAtD = (s, d) => { const ts = s[3], ds = s[4];
    for (let i = 0; i < ds.length - 1; i++) if (ds[i + 1] >= d && ds[i + 1] > ds[i]) return ts[i] + (ts[i + 1] - ts[i]) * (d - ds[i]) / (ds[i + 1] - ds[i]);
    return ts[ts.length - 1]; };
  function closePlan(plan, live, tc, S, ops, reverse, pathLen) {
    const R = S.ranges, out = [], b = ops.braking_ms2;
    const now = stateAt(live, tc);
    let kind = 'north', k = now.si, turned = 0;
    const cut = (s, t, d, v, label) => {        // stop as soon as possible and stay
      const ts = [], ds = [];
      for (let i = 0; i < s[3].length && s[3][i] < t; i++) { ts.push(s[3][i]); ds.push(s[4][i]); }
      const stopD = Math.min(d + v * v / (2 * b), s[4][s[4].length - 1]);
      if (!ts.length) { ts.push(t); ds.push(d); }
      ts.push(Math.max(t, ts[ts.length - 1]) + Math.max(4, v / b * 1.6)); ds.push(Math.max(stopD, ds[ds.length - 1]));
      out.push([s[0], s[1], s[2], ts, ds]);
      const te = ts[ts.length - 1], de = ds[ds.length - 1];
      out.push([s[0], label, -1, [te, te + 40 * 3600], [de, de]]);
    };
    for (let i = 0; i < k; i++) out.push(plan[i]);
    while (k < plan.length) {
      const s = plan[k], r = R[s[0]] || {}, cur = k === now.si && !now.before;
      const dNow = cur ? now.d : -Infinity;
      // just past the Rogoredo crossover: stop and reverse there like the others
      const nearStub = cur && r.sb && s[1] === 'service' && dNow >= r.sb[0] && dNow + now.v * now.v / (2 * b) <= r.sb[0] + S.stub + 40;
      // inside the closed section right now: stop on the line
      if (!nearStub && cur && ((r.sb && dNow >= r.sb[0] && dNow <= r.sb[1]) || (r.nb && dNow >= r.nb[0] && dNow <= r.nb[1]))) {
        cut(s, tc, dNow, now.v, 'stopped'); kind = 'inside'; return { segs: out, kind, turned };
      }
      // coming from Comasina towards San Donato: passengers off at Rogoredo, reverse beyond the crossover
      if (nearStub || (r.sb && s[1] === 'service' && dNow < r.sb[0] && s[4][s[4].length - 1] > r.sb[0])) {
        const sb0 = r.sb[0];
        let dStub = sb0 + S.stub, tStub;
        if (nearStub) {                                // already over the crossover: brake, then reverse from where it stops
          const ts = [], ds = [];
          for (let i = 0; i < s[3].length && s[3][i] < tc; i++) { ts.push(s[3][i]); ds.push(s[4][i]); }
          const stopD = Math.max(dNow + now.v * now.v / (2 * b), ds[ds.length - 1]);
          ts.push(tc + Math.max(4, now.v / b * 1.6)); ds.push(stopD);
          out.push([s[0], s[1], s[2], ts, ds]);
          tStub = ts[ts.length - 1];
          if (stopD < dStub) { out.push([s[0], 'turnback', -1, [tStub + 10, tStub + 10 + (dStub - stopD) / (10 / 3.6)], [stopD, dStub]]); tStub += 10 + (dStub - stopD) / (10 / 3.6); }
          else dStub = stopD;
        } else {
          let m = 0; while (m + 1 < s[4].length && s[4][m + 1] < sb0 - 0.5) m++;
          out.push([s[0], s[1], s[2], s[3].slice(0, m + 1), s[4].slice(0, m + 1)]);
          const t1 = s[3][m], d1 = s[4][m];
          tStub = t1 + 20 + (dStub - d1) / (20 / 3.6);
          out.push([s[0], 'turnback', -1, [t1 + 20, tStub], [d1, dStub]]);
        }
        const backBy = dStub - (sb0 + S.stub);      // stopped further than usual: start the reversal from there
        turned++;
        // its next run towards Comasina, started from Rogoredo instead of San Donato
        let j = k + 1; while (j < plan.length && plan[j][1] === 'turnback') j++;
        const o = plan[j], ro = o && R[o[0]], rv = o && S.rev[o[0]];
        const tRev = tStub + reverse;
        if (o && o[1] === 'service' && ro && ro.nb && rv) {
          const [rp, off, d0r] = rv, d0 = d0r - backBy;
          let q = 0; while (q < o[4].length && o[4][q] < ro.nb[1]) q++;
          const tArr = o[3][q], dR = Math.round((o[4][q] + off) * 10) / 10;
          const tAt = Math.min(tArr, tRev + 30 + (dR - d0) / (25 / 3.6));     // drive over normally, then wait on the platform
          out.push([rp, 'turnback', -1, [tRev, Math.max(tAt, tRev + 30)], [d0, dR]]);
          const svT = o[3].slice(q), svD = o[4].slice(q).map(x => Math.round((x + off) * 10) / 10);
          if (tAt < svT[0] - 1) { svT.unshift(Math.max(tAt, tRev + 30)); svD.unshift(dR); }
          out.push([rp, 'service', o[2], svT, svD]);
          k = j + 1;
          while (k < plan.length && plan[k][0] === o[0]) { const z = plan[k]; out.push([rp, z[1], z[2], z[3], z[4].map(x => Math.round((x + off) * 10) / 10), ...z.slice(5)]); k++; }
          continue;
        }
        // nothing to run from here: go back empty to Comasina and stay there
        const anyRev = Object.values(S.rev)[0];
        if (anyRev) { const [rp, , d0r] = anyRev, d0 = d0r - backBy, L = pathLen(rp) - 60; out.push([rp, 'empty', -1, [tRev, tRev + (L - d0) / 12], [d0, L]]); }
        return { segs: out, kind, turned };
      }
      // San Donato side: a run that would go through the section does not leave
      const crosses = (r.nb && dNow < r.nb[1] && s[4][s[4].length - 1] > r.nb[0]) || (r.sb && dNow < r.sb[1] && s[4][s[4].length - 1] > r.sb[0]);
      if (crosses) {
        kind = 'sd';
        if (cur && s[3][0] < tc) { cut(s, tc, Math.min(dNow, (r.nb || r.sb)[0] - 1), Math.min(now.v, 3), 'held'); return { segs: out, kind, turned }; }
        while (out.length > now.si && out[out.length - 1][1] === 'from_depot') out.pop();   // stays in the depot
        if (!out.length) { const f = plan[0]; out.push([f[0], 'to_depot', -1, [1e7, 1e7 + 1], [f[4][0], f[4][0]], ...f.slice(5)]); return { segs: out, kind, turned }; }
        const last = out[out.length - 1];
        if (last && last[1] !== 'to_depot' && last[1] !== 'from_depot') { const te = last[3][last[3].length - 1], de = last[4][last[4].length - 1]; out.push([last[0], 'held', -1, [Math.max(te, tc), Math.max(te, tc) + 40 * 3600], [de, de]]); }
        return { segs: out, kind, turned };
      }
      out.push(s); k++;
    }
    return { segs: out, kind, turned };
  }


  // ---------------- a stretch of the line closed (the trains then drive themselves: web/agents.js) ----------------
  // G: the build's "degraded" data (stations in order San Donato -> Comasina, main paths, how a train turns back at
  // each station, the crossover areas to protect). cl: { a, b } station indices, a < b: the line is closed between.
  function partsOf(G, cl) {
    const last = G.names.length - 1, parts = [];
    if (cl.a > 0) parts.push([0, cl.a]);
    if (cl.b < last) parts.push([cl.b, last]);
    return parts;
  }
  const stopOf = (G, dir, i) => dir === 'N' ? G.N.stops[i] : G.S.stops[G.names.length - 1 - i];
  // while a train turns back at the station next to the closure it needs the crossover and the track in front of
  // the station: one train at a time there (a "lock", in the same form as the block sections)
  function turnLocks(G, cl) {
    const out = [];
    partsOf(G, cl).forEach(P => [[P[0], 'S'], [P[1], 'N']].forEach(([X, dir]) => {
      const lk = G.locks && G.locks[X + ':' + dir]; if (lk) out.push({ name: 'inversione ' + G.names[X] + ' ' + dir, parts: lk });
    }));
    return out;
  }
  // platforms on each path, for an empty train passing them at 40 km/h: { pid: [[from d, to d, m/s]] }
  function platformZones(G) {
    const out = {}; if (!G || !G.platforms) return out;
    for (const [pid, z] of Object.entries(G.platforms)) out[pid] = z.map(([a, b, st]) => [a, b, 40 / 3.6, st]);
    return out;
  }
  const api = { runTrain, runFleet, runBooked, closePlan, stateAt, occupancy, cruiseSpeed, buildProfiles, serviceDelay, edgeLimit, partLimit, partBounds, stopTime, makeDwell, throatResources, blockResources, DT, platformZones, turnLocks, partsOf, stopOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
