// Milano Transit Live — the M3 trains as "almost sentient" agents: the one engine that moves them.
//
// Every train drives itself, half a second at a time, looking only at the track in front of it. It follows its day
// from the timetable as a reference: it never leaves a station early, and when late it drives as fast as allowed to
// catch up. The same rules hold everywhere:
//  - it never passes a signal without the route set for it (web/routes.js, the route interlocking of the whole line;
//    the depot and test-loop signals: web/interlocking.js);
//  - it never runs into another train (it looks at the real track pieces, also when reversing over a crossover).
// Closures (chiusure) are not here any more: they are being rebuilt from Giovanni's rules (Regole_interlocking_M3).
//
// Time line: the state of all trains is saved every 10 minutes and before every event (radio order, depot signal).
// Going back in time restores the last saved state before that moment and drives on from there; the events after it
// are applied again when their time comes (the same input gives the same result). The day driven in advance at build
// time (tools/precompute_live.js, with these same agents) is only used to start quickly at any time when nothing has
// happened yet.
(function (root) {
  const DT = 0.5, HEADWAY = 120, NON_SERVICE_HEADWAY = 90, LOOK = 700, GAP = 15;

  const ILmod = typeof module !== 'undefined' && module.exports ? require('./interlocking.js') : root.MTLInterlocking;
  const RTmod = typeof module !== 'undefined' && module.exports ? require('./routes.js') : root.MTLRoutes;

  function create(o) {
    // o: { G, ops, reverse, half, prof, pathEdges, netEdges, sigall, sigpos, interlocking, planOf(k) | plans0, count,
    //      stopsOf, zones, dwell[k](pid, d, tArrive, late, key), extra(k, key), initAt(t) -> positions, cyclic, holdAt,
    //      record(k, a, t) (optional: called after every step of every train, for the day driven at build time) }
    const { G, ops, reverse, half, prof, pathEdges, netEdges, stopsOf } = o;
    const planOf = k => o.planOf ? o.planOf(k) : o.plans0[k];
    const acc = ops.acceleration_ms2 || 1.1, brk = ops.braking_ms2 || 1.2;
    const S = { agents: [], t: 0, log: [], lastDep: {} };

    // ---------- legs: what an agent still has to drive ----------
    // { pid, status, trip, stops: [{ d, st, dep, arr, j }], end, start, dir, plan, timed, si, t0 }
    function legOfSeg(s, fromD) {
      const sts = stopsOf(s), stops = [];
      sts.forEach(z => { if (fromD == null || z.d >= fromD - 0.5) stops.push({ d: z.d, st: z.st, j: z.j, arr: s[3][z.j], dep: s[4][z.j + 1] === z.d ? s[3][z.j + 1] : s[3][z.j] }); });
      return { pid: s[0], status: s[1], trip: s[2], stops, end: s[4][s[4].length - 1], start: fromD != null ? fromD : s[4][0],
               dir: sts.length > 1 ? (sts[sts.length - 1].st > sts[0].st ? 'N' : 'S') : null };
    }
    function planLeg(k, si, fromD) {
      const s = planOf(k)[si], leg = legOfSeg(s, fromD);
      leg.si = si; leg.plan = true; leg.timed = true; leg.t0 = s[3][0];
      return leg;
    }

    // depot and test-loop signals (web/interlocking.js); the line: route interlocking (web/routes.js)
    const IL = o.interlocking && ILmod ? ILmod.create(Object.assign({}, o.interlocking, { sigpos: o.sigpos, half: o.half })) : null;
    S.il = IL ? IL.fresh(null) : null;
    const RT = RTmod.create({ sigall: o.sigall || {}, pathEdges, netEdges, itineraries: o.itineraries });
    S.rt = RT.fresh();

    // pos[k]: { pid, d, v, seg, before, startAt, leaveAt, status } where each train is at time t
    function start(t, pos) {
      S.il = IL ? IL.fresh(S.il) : null; S.rt = RT.fresh();
      S.t = t; S.log = []; S.lastDep = {};
      S.agents = pos.map((p, k) => {
        const plan = planOf(k), a = { k, pid: p.pid, d: p.d, v: 0, status: 'parked', legs: [], stopAt: null, wait: 0, mode: 'plan', si: p.seg, red: null };
        if (p.seg >= plan.length) { a.mode = 'static'; a.status = 'parked'; return a; }
        if (p.before) {                                 // standing between two moves of its day
          a.legs = [planLeg(k, p.seg)]; a.wait = p.startAt != null ? p.startAt : plan[p.seg][3][0];
          a.status = p.seg === 0 || plan[p.seg - 1][1] === 'to_depot' ? 'parked' : plan[p.seg - 1][1];
          return a;
        }
        const leg = planLeg(k, p.seg, p.d); a.legs = [leg]; a.v = p.v || 0; a.status = leg.status; a.trip = leg.trip;
        const st = leg.stops[0];
        if (st && Math.abs(st.d - p.d) < 1 && (p.v || 0) < 0.05) {   // standing at a station: leaves when the plan does
          a.stopAt = st.st; a.at = st.st; a.arriveT = t; a.dwBase = Math.max(1, (p.leaveAt || t + 1) - t); a.v = 0; a.d = st.d; a.stopKey = p.seg + ':' + st.j;
        }
        return a;
      });
    }
    // the next move of its day (it never starts before the plan, nor before the cab change if it is late)
    function nextPlanLeg(a) {
      const plan = planOf(a.k), prev = plan[a.si];
      a.si++;
      if (a.si >= plan.length) { a.mode = 'static'; a.status = 'parked'; return; }      // its day is over: switched off where it stands
      const s = plan[a.si], gap = prev ? s[3][0] - prev[3][prev[3].length - 1] : 0;
      a.wait = Math.max(s[3][0], S.t + Math.min(Math.max(gap, 0), reverse));
      if (prev && prev[1] === 'to_depot') a.status = 'parked';
      a.legs = [planLeg(a.k, a.si)];
    }
    // stop time at a station of its day: like the timetable (station times, radio extras)
    function planDwell(a, leg, st) {
      const k = a.k, key = leg.si + ':' + st.j;
      a.arriveT = S.t; a.stopKey = key;
      if (st.j === 0) { const planned = Math.max(0, st.dep - st.arr); a.dwBase = Math.min(planned, 20); return; }
      const dw = o.dwell && o.dwell[k] ? o.dwell[k](leg.pid, st.d, S.t, S.t - st.arr, key) : null;
      a.dwBase = dw != null ? dw : 20;
    }

    // ---------- the track in front ----------
    const edgeMap = new Map();
    function footprint(a) {
      const out = [], pe = pathEdges[a.pid]; if (!pe || a.hidden) return out;
      const lo = a.d - half, hi = a.d + half;
      for (const [ei, dir, x0, x1] of pe.e) {
        if (x1 < lo || x0 > hi) continue;
        const k = (netEdges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(lo, x0), q = Math.min(hi, x1);
        out.push([ei, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k]);
      }
      return out;
    }
    function refresh() {
      edgeMap.clear();
      for (const a of S.agents) {
        if (a.hidden) continue;
        for (const f of footprint(a)) { if (!edgeMap.has(f[0])) edgeMap.set(f[0], []); edgeMap.get(f[0]).push([a.k, f[1], f[2]]); }
      }
    }
    // how far the centre of agent a may go on its path, and what stops it
    function authority(a, leg) {
      let lim = Infinity, why = null;
      const nose = a.d + half;
      // other trains on the same track pieces in front (also those coming the other way)
      const pe = pathEdges[a.pid];
      if (pe) for (const [ei, dir, x0, x1] of pe.e) {
        if (x1 < nose - 1) continue;
        if (x0 > nose + LOOK) break;
        const lst = edgeMap.get(ei); if (!lst) continue;
        const k = ((x1 - x0) || 1) / (netEdges[ei].len || 1);
        for (const [bk, l0, l1] of lst) {
          if (bk === a.k) continue;
          const p0 = dir > 0 ? x0 + l0 * k : x1 - l1 * k, p1 = dir > 0 ? x0 + l1 * k : x1 - l0 * k;
          if (p1 < nose - 1) continue;                          // behind the nose: a following train
          const x = Math.max(p0, nose) - GAP - half;
          if (x < lim) { lim = x; why = { train: bk }; }
        }
      }
      const limTrains = lim;      // how far the track is free of other trains (block sections of the depot signals)
      // route interlocking: every signal ahead sets the route in front of it, or the train stops before it
      for (const c of RT.ahead(a.pid, nose, LOOK)) {
        const stop = a.d > c.d - half - 3 ? a.d : c.d - half - 3;
        if (stop >= lim) break;
        const next = leg.stops && leg.stops.length && a.stopAt == null ? leg.stops[0].d : leg.end;
        if (next != null && next < c.d - half) break;           // it stops before the signal first: it asks when it leaves
        // it asks when it is near (it could still stop before the signal): a route set too early only holds up the others
        if (c.d - nose > Math.max(120, a.v * a.v / (2 * brk) + 80)) { lim = Math.min(lim, stop); break; }
        if (RT.request(S.rt, a.k, a.pid, c.d, c.n, ei => edgeMap.get(ei))) continue;
        lim = stop; why = { sig: c.n, route: S.rt.lastNo }; break;
      }
      // a movement that starts with no signal between the train and its first switch (out of a tail position at
      // Comasina): it sets its route from where it stands, up to the next signal, before going over the switch
      const sw = RT.switchesOn(a.pid, nose - 1, nose + LOOK)[0];
      if (sw && sw[0] - half - 3 < lim && !RT.heldNode(S.rt, a.k, sw[1])) {
        const c0 = RT.ahead(a.pid, nose, LOOK)[0];
        if (!c0 || sw[0] < c0.d - 1) {
          const stop = Math.max(a.d, sw[0] - half - 3);
          if (sw[0] - nose > Math.max(120, a.v * a.v / (2 * brk) + 80) || !RT.request(S.rt, a.k, a.pid, nose, null, ei => edgeMap.get(ei))) { if (stop < lim) { lim = stop; why = { route: S.rt.lastNo, start: true }; } }
        }
      }
      // depot and test-loop signals: pass only with via libera for this train
      if (IL) for (const c of IL.ahead(a.pid, nose, LOOK)) {
        const stop = a.d > c.d - half - 3 ? a.d : c.d - half - 3;
        if (stop >= lim) break;
        const next = leg.stops && leg.stops.length && a.stopAt == null ? leg.stops[0].d : leg.end;
        if (next != null && next < c.d - half) break;
        if (IL.request(S.il, a.k, c.si, c.d, nose, lim + half, a.pid, limTrains + half)) continue;
        lim = stop; why = { sig: c.si }; break;
      }
      return { lim, why };
    }
    function speedLimit(a, leg) {
      let v = (ops.train_max_kmh || 90) / 3.6;
      const p = prof[a.pid];
      if (p) for (const sg of p) { if (sg[0] > a.d + half + 400) break; if (sg[1] < a.d - half) continue;
        v = Math.min(v, sg[0] <= a.d + half ? sg[2] : Math.sqrt(sg[2] * sg[2] + 2 * brk * (sg[0] - a.d - half))); }
      // empty (no passengers), shunting: through the platforms at 40 km/h
      const z = o.zones && o.zones[a.pid];
      if (z && leg.status !== 'service') for (const [z0, z1, zv] of z) {
        if (z1 < a.d - half || z0 > a.d + half + 300) continue;
        v = Math.min(v, z0 <= a.d + half ? zv : Math.sqrt(zv * zv + 2 * brk * (z0 - a.d - half))); }
      if (leg.status === 'turnback') v = Math.min(v, 25 / 3.6);
      if (a.vlim) v = Math.min(v, a.vlim);                                   // speed limit ordered by the PC
      return v;
    }

    // the same point of track on another path (null if that path does not go over it)
    function mapTo(pid, d, pid2) {
      const pe = pathEdges[pid], pe2 = pathEdges[pid2]; if (!pe || !pe2) return null;
      const sp = pe.e.find(([, , x0, x1]) => d >= x0 && d <= x1); if (!sp) return null;
      const [ei, dir, x0, x1] = sp, l = (dir > 0 ? d - x0 : x1 - d) * (netEdges[ei].len || 1) / ((x1 - x0) || 1);
      const sp2 = pe2.e.find(x => x[0] === ei); if (!sp2) return null;
      const [, dir2, y0, y1] = sp2, k2 = ((y1 - y0) || 1) / (netEdges[ei].len || 1);
      return dir2 > 0 ? y0 + l * k2 : y1 - l * k2;
    }

    // ---------- one step of one agent ----------
    function stepAgent(a) {
      if (a.mode === 'static' || a.hidden || S.t < a.wait) return;
      // held where it stands before this move of its day (test loop: waiting at #A94 for the loop, or for a depot place)
      if (o.holdAt && o.holdAt(a.k, a.si, a)) { a.v = 0; a.why = 'anello'; return; }
      const leg = a.legs[0];
      if (!leg) { nextPlanLeg(a); return; }
      // a path that goes round (the test loop, twice round): the next hop starts one lap back, at the same place
      const cyc = o.cyclic && o.cyclic[leg.pid];
      if (cyc && leg.pid === a.pid && a.v === 0 && leg.start != null && Math.abs(Math.abs(a.d - leg.start) - cyc) < 8) a.d = leg.start;
      if (leg.pid !== a.pid) { a.pid = leg.pid; a.d = leg.start != null ? leg.start : a.d; a.v = 0; }     // new path from a standing start
      if (leg.stops.length && a.stopAt == null && Math.abs(leg.stops[0].d - a.d) < 1 && a.v === 0) {
        // the move starts at a station (the first stop of a run): board there first
        const st = leg.stops[0]; a.stopAt = st.st; a.at = st.st; planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase;
      }
      a.status = leg.status; a.trip = leg.trip;
      if (a.stopAt != null) {
        // standing at a stop: passengers, then the departure conditions
        const st = leg.stops[0];
        const ex = a.stopKey && o.extra ? (o.extra(a.k, a.stopKey) || 0) : 0;      // longer stop ordered by radio
        a.dwellUntil = (a.arriveT != null ? a.arriveT : S.t) + (a.dwBase || 0) + ex;
        if (S.t < a.dwellUntil) { a.why = ex ? 'sosta' : null; return; }
        if (!st || leg.stops.length === 1 && st.d >= leg.end - 0.5) {      // last stop of the run: it ends here
          leg.stops.shift(); a.stopAt = null; a.legs.shift(); return;
        }
        if (a.pcHold) { a.why = 'pc'; return; }                                                              // held by the PC
        // never early; departure signals: via libera 30 s before leaving
        if (st.dep && S.t < st.dep) { if (S.t >= st.dep - 30) authority(a, leg); a.why = 'orario'; return; }
        // at least two minutes after the train before it left this station the same way (90 s when not in service)
        const key = st.st + ':' + (leg.dir || '');
        if (S.lastDep[key] != null && S.t - S.lastDep[key] < (leg.status === 'service' ? HEADWAY : NON_SERVICE_HEADWAY)) { a.why = 'intervallo'; return; }
        const au = authority(a, leg);
        if (au.lim < a.d + 5) { a.why = 'segnale'; if (!a.red) a.red = { since: S.t, why: au.why }; return; }
        S.lastDep[key] = S.t; a.red = null; a.why = null; a.stopAt = null; leg.stops.shift();
        if (a.vlim && a.vlimTo === st.st) { a.vlim = null; a.vlimTo = null; }    // speed limit "as far as this station": over
        a.late = st.dep ? S.t - st.dep : null; a.depSi = leg.si;
        a.at = st.st;
      }
      const target = leg.stops.length ? leg.stops[0].d : leg.end;
      const au = authority(a, leg), goal = Math.min(target, au.lim);
      const vmax = Math.min(speedLimit(a, leg), Math.sqrt(2 * brk * Math.max(0, goal - a.d)));
      if (a.v < vmax) a.v = Math.min(vmax, a.v + acc * DT); else a.v = Math.max(vmax, a.v - brk * 1.5 * DT);
      if (goal - a.d > 0.4 && a.v < 0.3) a.v = 0.3;
      a.d = Math.min(goal, a.d + a.v * DT);
      if (goal - a.d < 0.4 && a.v <= 0.8) {
        a.v = 0;
        if (target - a.d < 6) {                        // at the stop (a few metres short counts: the platform is long)
          a.d = Math.max(a.d, target - 6);
          if (leg.stops.length) {
            const st = leg.stops[0];
            a.stopAt = st.st; a.at = st.st; a.arrLate = st.arr != null ? S.t - st.arr : null;
            planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase;
          } else a.legs.shift();
          a.red = null;
        } else if (au.why && !a.red) a.red = { since: S.t, why: au.why };
      } else if (a.v > 0.5) { a.red = null; a.why = null; }
    }
    function step(t) {
      let guard = 0;
      while (S.t + DT <= t && guard++ < 40000) {
        // events whose time has come (again, after going back in time)
        for (const e of TL.events) if (!e.done && e.t <= S.t + DT) { e.done = true; apply(e); }
        S.t += DT; refresh();
        for (const a of S.agents) {
          const p0 = a.pid, n0 = a.d + half;
          stepAgent(a);
          if (IL) IL.release(S.il, a.k, a.pid, a.d + half, a.hidden || a.status === 'parked', a.pid === p0 ? n0 : null, a.v);
          if (a.pid === p0 && !a.hidden && a.d + half > n0) {
            // check: a front that went over a signal must have had its route (counted for the tests)
            for (const c of RT.ahead(a.pid, n0 + 12, a.d + half - n0)) if (c.d > n0 && c.d <= a.d + half) {
              S.rt.passed = (S.rt.passed || 0) + 1;
              if (!RT.held(S.rt, a.k, a.pid, c.d)) { S.rt.viol = (S.rt.viol || 0) + 1; (S.rt.violAt = S.rt.violAt || []).length < 5 && S.rt.violAt.push([a.k, a.pid, c.n, Math.round(S.t), a.status]); }
            }
          }
          if (a.pid === p0 && !a.hidden && a.d + half > n0) for (const [, nd] of RT.switchesOn(a.pid, n0, a.d + half)) {
            // check: a front that goes over a switch of the line must have a route over it (counted for the tests)
            S.rt.swPassed = (S.rt.swPassed || 0) + 1;
            if (!RT.heldNode(S.rt, a.k, nd)) { S.rt.swViol = (S.rt.swViol || 0) + 1; S.rt.swAt = S.rt.swAt || {}; const key = nd + '@' + a.pid + ':' + a.status; S.rt.swAt[key] = (S.rt.swAt[key] || 0) + 1; }
          }
          RT.release(S.rt, a.k, a.pid, a.d - half, a.hidden || a.status === 'parked' || a.mode === 'static');
          if (o.record) o.record(a.k, a, S.t);
        }
        if (Math.floor(S.t / SNAP) !== Math.floor((S.t - DT) / SNAP)) snapshot();
      }
      return S.t;
    }

    // ---------- time line: saved states and events ----------
    const SNAP = 600, TL = { snaps: [], events: [] };
    function snapshot() {
      const snap = structuredClone({ t: S.t, il: S.il, rt: S.rt, agents: S.agents, log: S.log, lastDep: S.lastDep });
      TL.snaps = TL.snaps.filter(x => x.t < S.t); TL.snaps.push(snap);
      if (TL.snaps.length > 220) TL.snaps.splice(1, 1);
    }
    function restore(snap) {
      const c = structuredClone(snap);
      Object.assign(S, { t: c.t, il: c.il, rt: c.rt || RT.fresh(), agents: c.agents, log: c.log, lastDep: c.lastDep || {} });
      TL.events.forEach(e => { e.done = e.t <= S.t; });
    }
    let lastResult = null;
    function apply(e) {
      if (e.kind === 'order') lastResult = order(e.k, e.what, e.arg);
      else if (e.kind === 'normal') start(S.t, o.initAt(S.t));
      else if (e.kind === 'il' && IL) { if (e.what === 'clear') lastResult = IL.clear(S.il, e.si); else if (e.what === 'unclear') { S.il.pass[e.si] = 0; lastResult = true; } else if (e.what === 'auto') { S.il.auto = !!e.on; lastResult = true; } }
    }
    // a new event now: what was planned after this moment is dropped (a new branch of the day)
    function event(e) {
      e.t = S.t;
      TL.events = TL.events.filter(x => x.t < e.t || (x.t === e.t && x.done)); TL.snaps = TL.snaps.filter(x => x.t <= S.t);
      snapshot(); TL.events.push(e); e.done = true; lastResult = null; apply(e);
      return lastResult;
    }
    // go to time t: forward by driving; back by restoring the last saved state before t and driving from there.
    // With nothing happened yet (no events), a big jump starts again from the day driven in advance (instant).
    // maxDrive: at most this many seconds of driving now (the rest at the next call: the page stays responsive)
    function seek(t, maxDrive) {
      const evBefore = x => TL.events.some(e => e.t <= x);
      if (t < S.t - 0.01 || (t - S.t > 900 && !TL.events.some(e => e.t > S.t && e.t <= t) && !evBefore(t))) {
        const snap = [...TL.snaps].reverse().find(x => x.t <= t);
        if (snap && (evBefore(t) || t - snap.t < 900)) restore(snap);
        else if (!evBefore(t)) { start(t, o.initAt(t)); TL.snaps = TL.snaps.filter(x => x.t < t); TL.events.forEach(e => { e.done = e.t <= S.t; }); snapshot(); }
        else if (snap) restore(snap);
      }
      return step(Math.min(t, S.t + (maxDrive || Infinity)));
    }

    // ---------- radio orders ----------
    function order(k, kind, arg) {
      const a = S.agents[k]; if (!a) return false;
      // PC speed limit: km/h, until a new order or until the train leaves station `to`
      if (kind === 'speed') { a.vlim = arg && arg.kmh ? arg.kmh / 3.6 : null; a.vlimTo = arg && arg.to != null ? arg.to : null; return true; }
      if (kind === 'speedoff') { a.vlim = null; a.vlimTo = null; return true; }
      // a train standing at a station: the PC holds it there, or lets it go
      if (kind === 'hold') { if (a.stopAt == null) return false; a.pcHold = true; return G.names[a.stopAt] || true; }
      if (kind === 'release') { a.pcHold = false; return true; }
      return false;
    }

    function state(k) {
      const a = S.agents[k]; if (!a) return null;
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null;
      return { pid: a.pid, d: a.d, v: a.v, status: a.status, mode: a.mode, hidden: !!a.hidden, red: a.red, late: a.late, stopAt: a.stopAt, why: a.why, trip: a.trip,
               seg: a.mode === 'plan' ? a.si : -1, waiting: S.t < a.wait, pcHold: !!a.pcHold, vlim: a.vlim ? Math.round(a.vlim * 3.6) : null, vlimTo: a.vlimTo,
               stops: leg && leg.stops ? leg.stops.map(z => z.st) : [], dir: leg ? leg.dir : null, timed: !!(leg && leg.timed), at: a.at };
    }
    // a radio change to a train's day (platform, tail, test loop...): it takes it from where it is
    function replan(k) {
      const a = S.agents[k]; if (!a || a.mode !== 'plan') return;
      const cur = a.legs[0];
      if (cur && cur.si === a.si) {
        // the new plan may run this stretch on another path (San Donato: platform 1 instead of 2): same place on it
        const pid2 = planOf(k)[a.si][0]; let d = a.d;
        if (pid2 !== a.pid) { d = mapTo(a.pid, a.d, pid2); if (d == null) return false; a.pid = pid2; a.d = d; }
        const fresh = planLeg(k, a.si, d); if (S.t < a.wait) fresh.start = cur.start; else fresh.start = d;
        if (a.stopAt != null && fresh.stops.length && Math.abs(fresh.stops[0].d - a.d) > 1) a.stopAt = null; a.legs = [fresh]; a.red = null; }
      return true;
    }
    return { S, TL, IL, RT, il: () => S.il, rt: () => S.rt, start, step, seek, event, order, replan, state, snapshot, mapTo, agents: () => S.agents, occ: ei => edgeMap.get(ei) };
  }

  const api = { create, DT, HEADWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLAgents = api;
})(typeof window !== 'undefined' ? window : globalThis);
