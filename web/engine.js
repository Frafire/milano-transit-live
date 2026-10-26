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
  function driveRun(pid, legs, t0, ops, out, prof) {
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
  function runTrain(segs, ops, reverse, holds, profiles, env) {
    holds = holds || {};
    const live = [], log = [];
    let t = -Infinity;
    for (let si = 0; si < segs.length; si++) {
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
          if (dw != null) { t = Math.max(t + dw, hold); out.ts.push(t); out.ds.push(pds[i + 1]); i++; continue; }
          const minWait = Math.min(planned, ops.station_stop_s >= 20 ? 20 : planned);
          t = Math.max(pts[i + 1], t + minWait, hold);
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
        t = driveRun(pid, legs, t, ops, sub, profiles ? profiles[pid] : null);
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
      const out = [];
      pe.e.forEach(([ei, dir, a, b]) => {
        const e = netEdges[ei], bd = partBounds(e, cuts), k = (b - a) / (e.len || 1);
        for (let i = 0; i < bd.length - 1; i++) {
          const v = partLimit(e, i, speeds, cuts) / 3.6;
          const x0 = dir > 0 ? a + bd[i] * k : b - bd[i + 1] * k, x1 = dir > 0 ? a + bd[i + 1] * k : b - bd[i] * k;
          out.push([x0, x1, v]);
        }
      });
      pe.div.forEach(x => { const d = Array.isArray(x) ? x[0] : x, j = Array.isArray(x) && speeds ? speeds['J' + x[1]] : null;
        out.push([d - w, d + w, j != null ? j / 3.6 : div]); });
      return out.sort((x, y) => x[0] - y[0]);
    });
  }

  // ---------------- one train per section (ZUB, and the reversing stub when the line is closed) ----------------
  // resources: [{ name, ranges: { pid: [a, b] } }]. A train occupies a resource from when its front reaches a
  // until its rear clears b. A train that would enter while another is inside waits at its last stop before.
  function occupancy(segs, res, half) {
    const out = [];
    segs.forEach((s, si) => {
      const r = res.ranges[s[0]]; if (!r) return;
      const [a, b] = r, ts = s[3], ds = s[4];
      let enter = null;
      for (let i = 0; i < ts.length; i++) {
        const inside = ds[i] >= a - half && ds[i] <= b + half;
        if (inside && enter === null) enter = ts[i];
        if (!inside && enter !== null) { out.push({ si, enter, exit: ts[i] }); enter = null; }
      }
      if (enter !== null) out.push({ si, enter, exit: si === segs.length - 1 ? Infinity : ts[ts.length - 1], open: true });
    });
    // a train that stops inside and goes on in its next segment (reversal) keeps the resource
    const merged = [];
    out.forEach(x => {
      const m = merged[merged.length - 1];
      if (m && m.open && x.enter - m.exit < 600) { m.exit = x.exit; m.open = x.open; } else merged.push({ ...x });
    });
    return merged;
  }
  function holdKey(plan, si, a, half) {
    const pts = plan[si][3], pds = plan[si][4];
    let m = -1;
    for (let i = 1; i < pds.length; i++) { if (pds[i] >= a - half) break; if (pds[i] === pds[i - 1]) m = i; }
    return m >= 0 ? si + ':' + m : si + ':start';
  }
  function runBooked(plans, ops, reverse, resources, half, base, profiles, envs) {
    plans = plans.slice();
    const holds = plans.map(() => ({}));
    const res = base ? base.slice() : plans.map((p, k) => runTrain(p, ops, reverse, null, profiles, envs && envs[k]));
    let guard = 0, held = 0;
    for (const R of resources) {
      for (;;) {
        if (++guard > 3000) break;
        const iv = [];
        res.forEach((r, k) => occupancy(r.segs, R, half).forEach(x => iv.push({ ...x, k })));
        iv.sort((x, y) => x.enter - y.enter);
        let prev = null, fix = null;
        for (const x of iv) {
          if (prev && x.k !== prev.k && x.enter < prev.exit - 0.5) { fix = [x, prev]; break; }
          if (!prev || x.exit > prev.exit) prev = x;
        }
        if (!fix) break;
        const [x, p] = fix, a = R.ranges[plans[x.k][x.si][0]][0];
        let key = holdKey(plans[x.k], x.si, a, half);
        const sg = plans[x.k][x.si], stopD = a - half - 10;
        const lastStop = key.endsWith(':start') ? null : sg[4][+key.split(':')[1]];
        if ((lastStop === null || stopD - lastStop > 400) && stopD > sg[4][0] + 1) {
          // no station just before the section: stop at its entrance (signal) and wait there
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
        const until = Math.min(p.exit + 2, 30 * 3600);
        if ((holds[x.k][key] || 0) >= until) break;           // cannot do better: give up rather than loop
        holds[x.k][key] = until; held++;
        res[x.k] = runTrain(plans[x.k], ops, reverse, holds[x.k], profiles, envs && envs[x.k]);
      }
    }
    return { res, holds, held, plans };
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

  const api = { runTrain, runFleet, runBooked, closePlan, stateAt, occupancy, cruiseSpeed, buildProfiles, edgeLimit, partLimit, partBounds, stopTime, makeDwell, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
