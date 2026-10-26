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
  function driveRun(pid, legs, t0, ops, out) {
    const a = ops.acceleration_ms2, b = ops.braking_ms2, vmax = ops.line_max_kmh / 3.6;
    const n = legs.length;
    const vt = legs.map((g, k) => cruiseSpeed(g.d1 - g.d0, g.t1 - g.t0, k === 0 ? 1 / (2 * a) : 0, k === n - 1 ? 1 / (2 * b) : 0, vmax));
    const end = legs[n - 1].d1;
    let d = legs[0].d0, v = 0, t = t0, k = 0, step = 0;
    const ts = [t], ds = [d];
    while (d < end - 0.01) {
      while (k < n - 1 && d >= legs[k].d1) k++;
      // the fastest we may go here so we can still slow down for every later leg and stop at the end
      let vcap = vt[k];
      for (let j = k + 1; j < n; j++) vcap = Math.min(vcap, Math.sqrt(vt[j] * vt[j] + 2 * b * Math.max(0, legs[j].d0 - d)));
      vcap = Math.min(vcap, Math.sqrt(2 * b * Math.max(0, end - d)));
      if (v < vcap) v = Math.min(vcap, v + a * DT); else v = Math.max(vcap, v - b * DT * 1.5);
      if (v < 0.3) v = 0.3;                          // creep the last centimetres
      d = Math.min(end, d + v * DT); t += DT;
      if (++step % SAMPLE === 0) { ts.push(t); ds.push(d); }
      if (step > 200000) break;                      // safety
    }
    if (ts[ts.length - 1] !== t) { ts.push(t); ds.push(end); }
    out.ts.push(...ts.slice(out.ts.length ? 1 : 0)); out.ds.push(...ds.slice(out.ds.length ? 1 : 0));
    return t;
  }

  // simulate one train for the whole day; returns live segments + a log of arrivals (plan vs actual)
  function runTrain(segs, ops, reverse) {
    const live = [], log = [];
    let t = -Infinity;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si], [pid, status, trip, pts, pds] = s;
      // between segments the train reverses or rests: it never starts before the plan,
      // and never takes less than the cab change (or the planned gap, if shorter)
      const gap = si > 0 ? pts[0] - segs[si - 1][3][segs[si - 1][3].length - 1] : 0;
      let start = si === 0 ? pts[0] : Math.max(pts[0], t + Math.min(gap, reverse));
      const out = { ts: [start], ds: [pds[0]] };
      t = start;
      let i = 0;
      while (i < pts.length - 1) {
        if (pds[i + 1] === pds[i]) {                    // standing: station stop, boarding, waiting
          const planned = pts[i + 1] - pts[i];
          const minWait = Math.min(planned, ops.station_stop_s >= 20 ? 20 : planned);
          t = Math.max(pts[i + 1], t + minWait);
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
        t = driveRun(pid, legs, t, ops, sub);
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

  function runFleet(trains, ops, reverse) {
    return trains.map(segs => runTrain(segs, ops, reverse));
  }

  const api = { runTrain, runFleet, cruiseSpeed, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
