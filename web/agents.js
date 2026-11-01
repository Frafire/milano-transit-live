// Milano Transit Live — the M3 trains as "almost sentient" agents: the one engine that moves them.
//
// Every train drives itself, half a second at a time, looking only at the track in front of it. It follows its day
// from the timetable as a reference: it never leaves a station early, and when late it drives as fast as allowed to
// catch up. The same rules hold everywhere:
//  - it never passes a signal without the route set for it (web/routes.js, the route interlocking of the whole line;
//    the depot and test-loop signals: web/interlocking.js);
//  - it never runs into another train (it looks at the real track pieces, also when reversing over a crossover).
// Closures (chiusure, foglio Chiusure of Giovanni's rules): the PC closes a stretch between two stations where trains can
// turn. The interlocking keeps every signal into it red (the routes over its track are refused); the trains on the open
// sides run their timetable as far as the closure, turn there the way Giovanni wrote (closure_turns: over the crossover
// behind the station, before it, or beyond it) and come back; the trains caught inside go on to the next station and
// wait for the PC (radio). When the stretch reopens every train takes a timetable run again from the next station.
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
    const S = { agents: [], t: 0, log: [], lastDep: {}, cl: null, parts: [], reopened: null };
    const last = G ? G.names.length - 1 : 0;
    const stopOf = (dir, i) => dir === 'N' ? G.N.stops[i] : G.S.stops[last - i];
    const opp = d => d === 'N' ? 'S' : 'N';
    const runDir = sts => sts[sts.length - 1].st > sts[0].st ? 'N' : 'S';
    const partOf = i => S.parts.find(p => i >= p[0] && i <= p[1]) || null;
    const nTrains = () => o.planOf ? o.count : o.plans0.length;
    // how a train turns at the end of a closed stretch (Giovanni's order of preference), among the turns the track has
    const TP = o.closureTurns || {};
    const turnAt = (X, dir) => { const tr = G.turns[X + ':' + dir]; if (!tr) return null; const k = (TP[X + ':' + dir] || ['A', 'C', 'B']).find(x => tr[x]); return k ? { kind: k, t: tr[k] } : null; };

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
    const RR = o.routeRules || {};
    const RT = RTmod.create({ sigall: o.sigall || {}, pathEdges, netEdges, itineraries: o.itineraries, times: RR.times, capacity: RR.capacity, pcSignals: RR.pcSignals, tailSlots: RR.tailSlots, half });
    S.rt = RT.fresh();
    // the other ways of a movement (San Donato): VAR[pid] = [[itinerary id, way, twin pid]]; START[id]: its first signal
    const VAR = o.variants || {}, START = {}; for (const it of o.itineraries || []) START[it.id] = it.start;
    // the usual way of a movement is taken: another way, if one is free (the train is standing at the start of its move)
    function otherWay(a, leg, c, occ) {
      const vs = (VAR[a.pid] || []).filter(v => START[v[0]] === c.n); if (!vs.length) return false;
      if (a.v > 0 || !(a.stopAt != null || leg.start == null || Math.abs(a.d - leg.start) < 2)) return false;
      for (const [, , pid2] of vs) {
        const m = x => x == null ? x : mapTo(a.pid, x, pid2);
        const d2 = m(a.d), end2 = m(leg.end), stops2 = leg.stops.map(z => m(z.d));
        if (d2 == null || end2 == null || stops2.some(x => x == null)) continue;
        const c2 = RT.ahead(pid2, d2 + half, LOOK).find(x => x.n === c.n); if (!c2) continue;
        if (!RT.request(S.rt, a.k, pid2, c2.d, c.n, occ, closedBlock(a), end2 + half + 3)) continue;
        // on the twin path from here on: same place, same stops
        leg.stops.forEach((z, i) => { z.d = stops2[i]; });
        leg.start = leg.start != null ? m(leg.start) : leg.start; leg.end = end2; leg.pid = pid2;
        a.pid = pid2; a.d = d2; S.rt.other = (S.rt.other || 0) + 1; const r_ = (S.rt.routes[a.k] || []).slice(-1)[0]; if (r_ && r_.id) { S.rt.otherAt = S.rt.otherAt || {}; S.rt.otherAt[r_.id] = (S.rt.otherAt[r_.id] || 0) + 1; }
        return true;
      }
      return false;
    }

    // pos[k]: { pid, d, v, seg, before, startAt, leaveAt, status } where each train is at time t
    function start(t, pos) {
      S.il = IL ? IL.fresh(S.il) : null; S.rt = RT.fresh();
      S.t = t; S.log = []; S.lastDep = {}; S.cl = null; S.parts = []; S.reopened = null; CLOSED = null; usedRuns.clear();
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
          // (shunting up to a standing train, as in the tail positions at Comasina 110 m apart: up to 3 m from it)
          const gap = leg.status !== 'service' && S.agents[bk] && S.agents[bk].v < 0.05 ? 3 : GAP;
          const x = Math.max(p0, nose) - gap - half;
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
        const occ = ei => edgeMap.get(ei), upTo = leg.end != null ? leg.end + half + 3 : null;
        // a signal close behind this one, before the train's stop, during a closure (a crossover onto a track used both
        // ways, as in its turns): this route only if the next one can be set too (the train must not stop half way,
        // facing another train)
        const had = RT.held(S.rt, a.k, a.pid, c.d);
        const c2 = !had && (S.cl || S.reopened != null) ? RT.ahead(a.pid, c.d + 1, 700).find(x => x.d > c.d + 5) : null;
        if (c2 && next != null && c2.d < next + half && !RT.held(S.rt, a.k, a.pid, c2.d) && !RT.request(S.rt, a.k, a.pid, c2.d, c2.n, occ, closedBlock(a), upTo, true)) {
          lim = stop; why = { sig: c2.n, route: { train: null, next: true } }; break;
        }
        if (RT.request(S.rt, a.k, a.pid, c.d, c.n, occ, closedBlock(a), upTo)) {
          if (RT.ready(S.rt, a.k, a.pid, c.d)) continue;
          lim = stop; why = { sig: c.n, route: { wait: 'scambio' } }; break;          // switches moving, signal opening
        }
        const no = S.rt.lastNo;
        if (otherWay(a, leg, c, occ)) return { lim: a.d, why: { sig: c.n, other: true } };    // the twin path: from the next step
        lim = stop; why = { sig: c.n, route: no }; break;
      }
      // a movement that starts with no signal between the train and its first switch (out of a tail position at
      // Comasina): it sets its route from where it stands, up to the next signal, before going over the switch
      const sw = RT.switchesOn(a.pid, nose - 1, nose + LOOK)[0];
      if (sw && sw[0] - half - 3 < lim && !RT.heldNode(S.rt, a.k, sw[1])) {
        const c0 = RT.ahead(a.pid, nose, LOOK)[0];
        if (!c0 || sw[0] < c0.d - 1) {
          const stop = Math.max(a.d, sw[0] - half - 3);
          if ((a.v > 0 && sw[0] - nose > Math.max(120, a.v * a.v / (2 * brk) + 80)) || !RT.request(S.rt, a.k, a.pid, nose, null, ei => edgeMap.get(ei), closedBlock(a), leg.end != null ? leg.end + half + 3 : null)) { if (stop < lim) { lim = stop; why = { route: S.rt.lastNo, start: true }; } }
        }
      } else if (sw && sw[0] - half - 3 < lim && !RT.readyNode(S.rt, a.k, sw[1])) {
        const stop = Math.max(a.d, sw[0] - half - 3);
        if (stop < lim) { lim = stop; why = { route: { wait: 'scambio' }, start: true }; }
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
      if (z && (leg.status !== 'service' || leg.skip)) for (const [z0, z1, zv] of z) {
        if (z1 < a.d - half || z0 > a.d + half + 300) continue;
        v = Math.min(v, z0 <= a.d + half ? zv : Math.sqrt(zv * zv + 2 * brk * (z0 - a.d - half))); }
      if (leg.status === 'turnback') v = Math.min(v, 25 / 3.6);
      if (a.slowUntil && S.t < a.slowUntil) v = Math.min(v, 20 / 3.6);      // after reopening: 20 km/h for 2 minutes
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

    // ---------- closures ----------
    // the track pieces of the closed stretch: the main tracks between the two stations, less what the turns at its ends
    // use (the crossovers, the stub beyond an A turn)
    let CLOSED = null;
    function closedPieces(cl) {
      const out = new Set(), keep = new Set();
      for (const [X, dir] of [[cl.a, 'N'], [cl.b, 'S']]) {
        // every way of turning there (the preferred one, and the others for a train that cannot take it)
        for (const [kind, t] of Object.entries(G.turns[X + ':' + dir] || {})) {
          if (pathEdges[t.pid]) for (const [ei] of pathEdges[t.pid].e) keep.add(ei);
          // an A turn: on beyond the station to the stub (on the main track of that way)
          if (kind === 'A') { const mp = dir === 'N' ? G.N : G.S, lo = stopOf(dir, X) - 5, hi = t.stub_d + half + 20;
            for (const [ei, , x0, x1] of (pathEdges[mp.pid] || { e: [] }).e) if (x1 > lo && x0 < hi) keep.add(ei); }
        }
      }
      const span = (pid, lo, hi) => { for (const [ei, , x0, x1] of (pathEdges[pid] || { e: [] }).e) if (x0 >= lo && x1 <= hi && !keep.has(ei)) out.add(ei); };
      if (cl.a < cl.b) {
        span(G.N.pid, stopOf('N', cl.a) + half + 5, cl.b === last ? Infinity : stopOf('N', cl.b) - half - 5);
        span(G.S.pid, cl.b === last ? -Infinity : stopOf('S', cl.b) + half + 5, cl.a === 0 ? Infinity : stopOf('S', cl.a) - half - 5);
        if (cl.b === last) for (const P of G.pairs || []) { span(P.N.pid, stopOf('N', cl.a) + half + 5, Infinity); span(P.S.pid, -Infinity, stopOf('S', cl.a) - half - 5); }
        if (cl.a === 0) for (const P of G.pairs || []) { span(P.S.pid, stopOf('S', cl.b) + half + 5, Infinity); span(P.N.pid, -Infinity, stopOf('N', cl.b) - half - 5); }
      }
      return out;
    }
    // for the route interlocking: a route over the closed stretch is refused (a train inside it, ordered by the PC, may)
    const closedBlock = a => S.cl && CLOSED && a.mode !== 'inside' && a.mode !== 'held' && !a.exitClosed ? pieces => { for (const [ei, l0, l1] of pieces) if (CLOSED.has(ei) && l1 - l0 > 8) return { closed: ei }; return null; } : null;

    // the day of train m from run j: legs until a run leaves part P (cut at the station where it must turn)
    function legsFromPlan(m, j, P, fromD) {
      const plan = planOf(m), legs = [];
      for (; j < plan.length; j++) {
        const s = plan[j], sts = stopsOf(s), leg = legOfSeg(s, fromD); fromD = null;
        leg.plan = true; leg.timed = true; leg.si = j;              // its own timetable run, as far as the closure
        if (!sts.length) { legs.push(leg); if (s[1] === 'to_depot') { legs.push({ kind: 'park' }); return legs; } continue; }
        if (!P) { legs.push(leg); continue; }
        const k = leg.stops.findIndex(z => z.st < P[0] || z.st > P[1]);
        if (k < 0) { leg.arrive = { at: leg.stops.length ? leg.stops[leg.stops.length - 1].st : null, dir: leg.dir }; legs.push(leg); continue; }
        if (k === 0) { legs.push({ kind: 'held' }); return legs; }
        const X = leg.stops[k - 1].st, tn = turnAt(X, leg.dir);
        if (tn && tn.kind === 'B' && k >= 2 && stopOf(leg.dir, leg.stops[k - 2].st) < tn.t.du - 60) {
          // B: from the station before, over the crossover before X onto the other track and into its platform
          const prev = leg.stops[k - 2];
          leg.stops = leg.stops.slice(0, k - 1); leg.end = prev.d; leg.arrive = null; legs.push(leg);
          const dPrev = stopOf(leg.dir, prev.st);
          legs.push({ pid: tn.t.pid, status: 'service', trip: leg.trip, stops: [{ st: prev.st, d: dPrev }, { st: X, d: tn.t.d_arr }], end: tn.t.d_arr, start: dPrev,
            dir: leg.dir, shuttle: true, viaB: true, arrive: { at: X, dir: leg.dir } });
          legs.push({ kind: 'boundary' });
          return legs;
        }
        leg.stops = leg.stops.slice(0, k); leg.end = leg.stops[k - 1].d; leg.arrive = { at: X, dir: leg.dir };
        legs.push(leg); legs.push({ kind: 'boundary' });
        return legs;
      }
      return legs;
    }
    const DEPOT_END = G ? Math.max(0, G.names.findIndex(n => /SAN DONATO/i.test(n))) : 0;
    let lastDep_ = null;
    function lastDeparture() {
      if (lastDep_ == null) { lastDep_ = 0; for (let m = 0; m < nTrains(); m++) for (const z of planOf(m)) if (z[1] === 'service') lastDep_ = Math.max(lastDep_, z[3][0]); }
      return lastDep_;
    }
    // a run from station X the way o2 to the end T of the part; towards a B turn at T: over its crossover at the end
    function runTo(X, o2, T, pid, off, firstD) {
      const tn = !(T === 0 || T === last) && turnAt(T, o2), stops = [];
      for (let i = X; o2 === 'N' ? i <= T : i >= T; i += o2 === 'N' ? 1 : -1) stops.push({ d: i === X ? firstD : stopOf(o2, i) + off, st: i });
      const r = { pid, status: 'service', trip: -1, stops, end: stops[stops.length - 1].d, start: firstD, dir: o2, shuttle: true, arrive: { at: T, dir: o2 } };
      if (tn && tn.kind === 'B' && pid === (o2 === 'N' ? G.N.pid : G.S.pid) && stops.length >= 2) {
        // into T over the crossover before it, onto the other track (Sondrio, Maciachini, Porta Romana, Centrale)
        const prev = stops[stops.length - 2];
        if (prev.d < tn.t.du - 60) { r.stops = stops.slice(0, -1); r.end = prev.d; r.arrive = null; r.then = { pid: tn.t.pid, status: 'service', trip: -1, stops: [{ st: prev.st, d: stopOf(o2, prev.st) }, { st: T, d: tn.t.d_arr }], end: tn.t.d_arr, start: stopOf(o2, prev.st), dir: o2, shuttle: true, viaB: true, arrive: { at: T, dir: o2 } }; }
      }
      return r;
    }
    const pushRun = (out, r) => { const t = r.then; delete r.then; out.push(r); if (t) out.push(t); return out; };
    // after arriving at the end of the part: a.at (station), a.arr (direction it came)
    function nextShuttleLegs(a) {
      const P = a.part, X = a.at, dir = a.arr, o2 = opp(dir), T = o2 === 'N' ? P[1] : P[0], out = [];
      if (X === 0 || X === last) {
        // terminus: into a free tail, change cab, out on the main path of the same tail the other way
        const cands = (G.pairs && G.pairs.length ? G.pairs : [{ N: G.N, S: G.S }]).filter(p => mapTo(a.pid, a.d, p[dir].pid) != null);
        if (!cands.length) { goInside(a); return a.legs.splice(0); }
        const Pp = cands.find(p => tailFree(a, p[dir])) || (S.t - (a.tailWait || (a.tailWait = S.t)) > 600 ? cands[0] : null);
        if (!Pp) return [{ kind: 'retry' }];
        a.tailWait = null;
        const inP = Pp[dir], outP = Pp[o2], stopP = (pp, dd, i) => dd === 'N' ? pp.stops[i] : pp.stops[last - i];
        out.push({ pid: inP.pid, status: 'turnback', stops: [], end: inP.tail[1], start: mapTo(a.pid, a.d, inP.pid), tailOf: inP.pid });
        out.push({ pid: outP.pid, status: 'turnback', stops: [], end: stopP(outP, o2, X), start: outP.tail[0], rev: true });
        const r = runTo(X, o2, T, outP.pid, 0, stopP(outP, o2, X));
        if (outP.pid !== (o2 === 'N' ? G.N.pid : G.S.pid)) { r.stops.forEach(z => { z.d = stopP(outP, o2, z.st); }); r.end = r.stops[r.stops.length - 1].d; }
        if (S.reopened) withTimetable(r, X, o2);
        // after reopening, once the timetable has no more runs for it (end of the service): empty to San Donato and
        // into the depot, where it is switched off
        if (S.reopened && !r.timed && S.t > lastDeparture() - 600) {
          if (X === DEPOT_END) { out.length = 0; out.push({ kind: 'depot' }); return out; }
          r.status = 'empty'; r.stops = [r.stops[0], r.stops[r.stops.length - 1]];
        } else if (!S.reopened) withTimetable(r, X, o2, true);
        return pushRun(out, r);
      }
      const tn = turnAt(X, dir), main = o2 === 'N' ? G.N : G.S;
      if (a.viaB) { const r = runTo(X, o2, T, main.pid, 0, stopOf(o2, X)); r.rev = true; withTimetable(r, X, o2, true); return pushRun(out, r); }
      let tk = tn;
      if (tk && tk.kind === 'B') {
        // it came on its own track (it was past the crossover when the stretch closed): another way to turn, if any
        const tr0 = G.turns[X + ':' + dir], k2 = ['C', 'A'].find(x => tr0[x]); tk = k2 ? { kind: k2, t: tr0[k2] } : null;
      }
      if (!tk) { goInside(a); return a.legs.splice(0); }
      const tn_ = tk;
      if (tn_.kind === 'A') {   // on beyond the crossover, change cab, over it into the other platform
        const tr = tn_.t, stub = a.d + (tr.stub_d - stopOf(dir, X)), dP = stopOf(o2, X) + tr.off;
        out.push({ pid: a.pid, status: 'turnback', stops: [], end: stub, start: a.d });
        out.push({ pid: tr.pid, status: 'turnback', stops: [], end: dP, start: tr.d0, rev: true });
        const r = runTo(X, o2, T, tr.pid, tr.off, dP); withTimetable(r, X, o2, true);
        return pushRun(out, r);
      }
      { const tr = tn_.t, off = tr.d_dep - stopOf(o2, X), r = runTo(X, o2, T, tr.pid, off, tr.d_dep);
        r.rev = true; r.cTurn = true; withTimetable(r, X, o2, true); return pushRun(out, r); }
      if (tn.kind === 'A') {   // on beyond the crossover, change cab, over it into the other platform
        const tr = tn.t, stub = a.d + (tr.stub_d - stopOf(dir, X)), dP = stopOf(o2, X) + tr.off;
        out.push({ pid: a.pid, status: 'turnback', stops: [], end: stub, start: a.d });
        out.push({ pid: tr.pid, status: 'turnback', stops: [], end: dP, start: tr.d0, rev: true });
        const r = runTo(X, o2, T, tr.pid, tr.off, dP); withTimetable(r, X, o2, true);
        return pushRun(out, r);
      }
      // C: passengers board here; change cab and leave backwards over the crossover behind the station
      const tr = tn.t, off = tr.d_dep - stopOf(o2, X), r = runTo(X, o2, T, tr.pid, off, tr.d_dep);
      r.rev = true; r.cTurn = true; withTimetable(r, X, o2, true); return pushRun(out, r);
    }
    // a tail is free when nobody stands in its last 200 m and nobody else is on the way in
    function tailFree(a, mp) {
      const pe = pathEdges[mp.pid]; if (!pe) return true;
      for (const b of S.agents) if (b !== a && !b.hidden && b.legs[0] && b.legs[0].tailOf === mp.pid) return false;
      for (const [ei, , x0, x1] of pe.e) { if (x1 < mp.tail[1] - 200) continue; const l = edgeMap.get(ei); if (l && l.some(z => z[0] !== a.k)) return false; }
      return true;
    }
    // the run takes the times of a timetable run from that station, that way (it never leaves more than a minute
    // early; late, it catches up as it can). soft: during the closure (the times are a guide: it leaves at most a
    // minute later than its time if the timetable run is too far)
    const usedRuns = new Set();
    function withTimetable(r, X, dir, soft) {
      let best = null;
      Array.from({ length: nTrains() }, (_, m) => planOf(m)).forEach((p, m) => p.forEach((z, j) => {
        if (usedRuns.has(m + ':' + j)) return;
        const zs = stopsOf(z); if (zs.length < 2 || runDir(zs) !== dir) return;
        const x = zs.findIndex(y => y.st === X); if (x < 0 || x === zs.length - 1) return;
        const tx = z[4][zs[x].j + 1] === zs[x].d ? z[3][zs[x].j + 1] : z[3][zs[x].j];
        if (tx < S.t - (soft ? 120 : 3600) || tx > S.t + (soft ? 900 : 1800)) return;
        const score = tx > S.t + 120 ? 2 * (tx - S.t) : S.t - tx;
        if (!best || score < best.score) best = { m, j, zs, z, score };
      }));
      if (!best) return;
      usedRuns.add(best.m + ':' + best.j);
      const dep = {}; best.zs.forEach(y => { dep[y.st] = best.z[4][y.j + 1] === y.d ? best.z[3][y.j + 1] : best.z[3][y.j]; });
      r.stops.forEach(z => { if (dep[z.st] != null) z.dep = dep[z.st]; });
      r.timed = true; r.ref = best.z[2];
    }
    // the turn back is not possible now: on along its track into the closed stretch, to the next station, and wait
    function goInside(a) {
      const X = a.at, dir = a.arr, off = a.d - stopOf(dir, X), stops = [];
      for (let i = X; dir === 'N' ? i <= last : i >= 0; i += dir === 'N' ? 1 : -1) stops.push({ st: i, d: stopOf(dir, i) + off });
      if (stops.length < 2) { a.mode = 'static'; a.status = 'held'; return; }
      a.inside = { dir, pid: a.pid, stops, q: 1, end: null };
      a.legs = [{ pid: a.pid, status: 'empty', stops: [], end: stops[1].d, start: a.d }, { kind: 'stopped' }];
      a.mode = 'inside'; a.status = 'empty';
      S.log.push({ t: S.t, k: a.k, inside: G.names[stops[1].st] });
    }
    // closing: every M3 train becomes an agent of the closure. pos: positions now (posNow)
    function close(cl) {
      S.cl = cl; S.reopened = null; S.lastDep = {}; usedRuns.clear(); CLOSED = closedPieces(cl);
      // the closure's own movements (and the moves against the usual direction its turns make, as at Maciachini)
      S.rt.allow = ['chiusura servizio limitato', 'chiusura tratta', 'chiusura con navetta', 'binario unico'];
      // the signals into the closed stretch go back to red: a route over it that no train has entered yet is cancelled
      for (const [k, rs] of Object.entries(S.rt.routes)) {
        const a = S.agents[+k], nose = a ? a.d + half : -Infinity;
        S.rt.routes[k] = rs.filter(r => !(r.pieces.some(x => CLOSED.has(x[0])) && (!a || a.pid !== r.pid || nose < r.d0 + 1)));
        if (!S.rt.routes[k].length) delete S.rt.routes[k];
      }
      S.parts = []; if (cl.a > 0) S.parts.push([0, cl.a]); if (cl.b < last) S.parts.push([cl.b, last]);
      for (const a of S.agents) {
        if (a.hidden || a.mode === 'static') { a.seg0 = a.si; if (a.mode !== 'static') a.mode = 'static'; continue; }
        const plan = planOf(a.k), p_si = a.si, s = plan[p_si]; a.seg0 = p_si;
        if (!s) { a.mode = 'static'; continue; }
        const sts = stopsOf(s), waiting = S.t < a.wait;
        if (sts.length) {
          const q0 = sts.findIndex(z => z.d >= a.d - 0.5), q = q0 < 0 ? sts.length - 1 : q0, P = waiting ? partOf(sts[0].st) : partOf(sts[q].st);
          // between a station of the closed stretch and the first open one: it goes on to that station (the signals
          // let it out of the closed stretch), then on with the others
          const prevSt = !waiting && q > 0 && Math.abs(sts[q].d - a.d) > 1 ? sts[q - 1].st : null;
          a.exitClosed = P && prevSt != null && prevSt > cl.a && prevSt < cl.b;
          if (P) { a.mode = 'shuttle'; a.part = P; const fromD = waiting ? null : a.d; a.legs = legsFromPlan(a.k, p_si, P, fromD); if (a.stopAt != null && !(a.legs[0] && a.legs[0].stops && a.legs[0].stops.length && Math.abs(a.legs[0].stops[0].d - a.d) < 1)) a.stopAt = null; continue; }
          // between two closed stations: on to the next station, then wait for the PC
          const leg = legOfSeg(s, a.d); leg.stops = leg.stops.slice(0, 1); leg.end = leg.stops.length ? leg.stops[0].d : a.d;
          a.mode = 'inside'; a.inside = { m: a.k, j: p_si, q, dir: runDir(sts), pid: s[0], stops: sts.map(z => ({ st: z.st, d: z.d })), end: s[4][s[4].length - 1] };
          a.legs = [leg, { kind: 'stopped' }]; a.stopAt = null; a.wait = 0;
          continue;
        }
        // a move with no stops (to or from the depot or a tail, empty): it finishes, then its day goes on in its part
        let j = p_si; while (j < plan.length && !stopsOf(plan[j]).length) j++;
        if (j >= plan.length) continue;                          // the end of its day: it goes on as planned
        const P = partOf(stopsOf(plan[j])[0].st);
        if (P) { a.mode = 'shuttle'; a.part = P; a.legs = legsFromPlan(a.k, p_si, P, waiting ? null : a.d); continue; }
        // its next run starts on the closed side: what is moving finishes, then it waits there
        a.legs = [legOfSeg(s, waiting ? null : a.d), { kind: s[1] === 'to_depot' || s[1] === 'from_depot' ? 'park' : 'held' }]; a.mode = 'held';
      }
    }
    // ---------- one step of one agent: markers of the closure ----------
    function marker(a, m) {
      if (m.kind === 'boundary') { a.legs.unshift(...nextShuttleLegs(a)); return true; }
      if (m.kind === 'held') { a.mode = 'static'; a.status = 'held'; return false; }
      if (m.kind === 'park') { a.mode = 'static'; a.status = 'parked'; a.v = 0; return false; }
      // stopped at a station of the closed stretch, waiting for the PC: the routes it held ahead go back (its own track
      // stays protected by the train itself standing there)
      if (m.kind === 'stopped') { a.status = 'stopped'; a.stoppedSince = S.t; delete S.rt.routes[a.k]; return false; }
      if (m.kind === 'depot') { a.hidden = true; a.mode = 'static'; a.status = 'depot'; return false; }
      if (m.kind === 'assign') { assign(a); return a.legs.length > 0; }
      if (m.kind === 'retry') { a.legs.unshift(...nextShuttleLegs(a)); return a.legs[0] && a.legs[0].kind !== 'retry'; }
      return true;
    }
    // ---------- reopening: back to the timetable ----------
    function reopen(t) {
      S.reopened = t; S.cl = null; S.parts = [[0, last]];
      CLOSED = null; usedRuns.clear();
      for (const a of S.agents) {
        if (a.status === 'parked' && !a.hidden && a.mode === 'static') { resumeDay(a, t); continue; }
        if (a.hidden || a.status === 'parked') continue;
        a.slowUntil = t + 120;                        // 20 km/h for 2 minutes
        a.part = [0, last];
        if (a.mode === 'shuttle' || a.mode === 'moving') {
          // the moves of a turn it has started go on; the next passenger run goes the whole way to the terminus
          const i = a.legs.findIndex(l => !l.kind && l.status === 'service');
          if (i < 0) { a.legs = a.legs.filter(l => !l.kind || l.kind === 'depot').concat(a.legs.some(l => l.kind === 'depot') ? [] : [{ kind: 'assign' }]); }
          else {
            const cur = a.legs[i];
            if (cur.viaB && i === 0 && a.pid === cur.pid && a.d < cur.noBlocksAfter + 150) {
              // not yet at the crossover: the B path is the main path up to there, so it stays on the main track
              const main = cur.dir === 'N' ? G.N : G.S; a.pid = main.pid;
              const first = cur.stops[0]; cur.pid = main.pid; cur.viaB = false; cur.noBlocksAfter = null;
              cur.stops = [{ st: first.st, d: stopOf(cur.dir, first.st) }]; cur.end = cur.stops[0].d; cur.arrive = { at: first.st, dir: cur.dir }; cur.shuttle = false;
              a.legs = [cur, { kind: 'assign' }];
            } else if (cur.viaB) { a.legs = a.legs.slice(0, i + 1).concat([{ kind: 'boundary' }]); }
            else {
              const first = i === 0 && a.stopAt == null ? cur.stops[0] : cur.stops[0];
              cur.stops = first ? [first] : []; cur.end = first ? first.d : cur.end; cur.arrive = first ? { at: first.st, dir: cur.dir } : cur.arrive; cur.shuttle = false;
              a.legs = a.legs.slice(0, i + 1).concat([{ kind: 'assign' }]);
            }
          }
          a.mode = 'shuttle';
        } else if (a.status === 'stopped' || a.mode === 'inside' || a.status === 'held' || a.mode === 'held') {
          a.status = a.status === 'stopped' ? 'service' : a.status; a.legs = [{ kind: 'assign' }]; a.mode = 'shuttle';
        }
      }
    }
    // after reopening, a train switched off in the depot: its next run out of the depot (the ones missed are gone)
    function resumeDay(a, t) {
      const plan = planOf(a.k); if (a.seg0 == null) return;
      for (let j = Math.max(0, a.seg0); j < plan.length; j++) {
        const s = plan[j]; if (s[3][0] < t - 60) continue;
        if (s[1] !== 'from_depot' && !(s[1] === 'empty' && s.length > 5 && s[5] != null) && !(s[3][0] >= 29 * 3600)) continue;
        a.mode = 'plan'; a.si = j - 1; a.legs = []; a.wait = 0; a.status = 'parked'; return;
      }
    }
    // the station it stands at (or is about to reach) and which way it goes on
    // standing still somewhere: at a platform (which station), or in a tail at a terminus (out to the platform first)
    function placeOf(a) {
      const z = (o.zones && o.zones[a.pid]) || [];
      const at = z.find(x => a.d >= x[0] - 3 && a.d <= x[1] + 3);
      if (at) return { st: at[3], dir: at[3] === 0 ? 'N' : at[3] === last ? 'S' : null };
      return null;
    }
    function outOfTail(a) {
      // in a tail at a terminus: out to the platform on the main path that starts in this tail
      for (const P of (G.pairs && G.pairs.length ? G.pairs : [{ N: G.N, S: G.S }])) for (const dir of ['N', 'S']) {
        const mp = P[dir], d2 = mapTo(a.pid, a.d, mp.pid), T = dir === 'N' ? 0 : last;
        if (d2 != null && d2 < (dir === 'N' ? mp.stops[0] : mp.stops[0]) - half) {
          a.legs = [{ pid: mp.pid, status: 'turnback', stops: [], start: d2, end: dir === 'N' ? mp.stops[0] : mp.stops[0], rev: a.pid !== mp.pid || false }, { kind: 'assign' }];
          a.at = T; a.arr = opp(dir); return true;
        }
      }
      return false;
    }
    function whereNow(a) {
      if (a.inside) return { st: a.inside.stops[a.inside.q].st, dir: a.inside.dir };
      if (a.at == null) { const p = placeOf(a); if (p) { a.at = p.st; if (p.dir) a.arr = opp(p.dir); } }
      if (a.at != null) {
        const end = a.at === 0 || a.at === last;
        return { st: a.at, dir: end ? (a.at === 0 ? 'N' : 'S') : (a.mode === 'limit' ? opp(a.arr) : a.arr) };
      }
      return null;
    }
    // from the station where it stands, a passenger run that way to the terminus, with timetable times
    function assign(a) {
      if (a.at == null && !placeOf(a) && outOfTail(a)) return;
      const here = whereNow(a); a.legs = [];
      if (!here || !here.dir) return;
      a.inside = null;
      const T = here.dir === 'N' ? last : 0;
      if (here.st === T) { a.at = T; a.arr = opp(here.dir); a.mode = 'shuttle'; a.part = [0, last]; a.legs = nextShuttleLegs(a); return; }
      const main = here.dir === 'N' ? G.N : G.S;
      // on the main path if it stands on it (same track), else on its own path (same main track further on)
      let pid = main.pid, off = 0, d2 = mapTo(a.pid, a.d, main.pid);
      if (d2 == null || Math.abs(d2 - stopOf(here.dir, here.st)) > 80) {
        // another main path of the same direction through this platform (at San Donato: platform 1 or 2)
        for (const P of G.pairs || []) { const mp = P[here.dir], x = mapTo(a.pid, a.d, mp.pid), sx = here.dir === 'N' ? mp.stops[here.st] : mp.stops[last - here.st];
          if (x != null && Math.abs(x - sx) < 80) { pid = mp.pid; d2 = x; off = sx - stopOf(here.dir, here.st); break; } }
      }
      if (pid === main.pid && (d2 == null || Math.abs(d2 - stopOf(here.dir, here.st)) > 80)) {
        if (here.st === 0 || here.st === last) { a.at = here.st; a.arr = opp(here.dir); a.mode = 'shuttle'; a.part = [0, last]; a.legs = nextShuttleLegs(a); return; }
        pid = a.pid; off = a.d - stopOf(here.dir, here.st); d2 = a.d;
      }
      const stops = [];
      for (let i = here.st; here.dir === 'N' ? i <= T : i >= T; i += here.dir === 'N' ? 1 : -1) stops.push({ st: i, d: i === here.st ? d2 : stopOf(here.dir, i) + off });
      const r = { pid, status: 'service', trip: -1, stops, end: stops[stops.length - 1].d, start: d2, dir: here.dir, arrive: { at: T, dir: here.dir }, frame: { off } };
      withTimetable(r, here.st, here.dir);
      a.legs = [r]; a.mode = 'shuttle'; a.part = [0, last]; a.stopAt = null; a.dwellUntil = S.t;
      S.log.push({ t: S.t, k: a.k, at: G.names[here.st], dir: here.dir, ref: r.ref });
    }

    const nextOf = k => { const a = S.agents[k]; return a && a.inside && a.inside.q + 1 < a.inside.stops.length ? a.inside.stops[a.inside.q + 1].st : null; };
    // ---------- one step of one agent ----------
    function stepAgent(a) {
      if (a.mode === 'static' || a.hidden) return;
      if (S.t < a.wait) {
        // its next move starts in a few seconds (the cab change is done): the route is set in advance, the switches
        // move while the driver gets ready
        const nx = a.legs[0];
        if (a.mode === 'plan' && nx && !nx.kind && a.wait - S.t <= 15 && !(o.holdAt && o.holdAt(a.k, a.si, a))) {
          const t = Object.assign({}, a, { pid: nx.pid, d: nx.pid !== a.pid && nx.start != null ? nx.start : a.d, v: 0, stopAt: null });
          authority(t, nx);
        }
        return;
      }
      if (a.status === 'stopped') return;
      // held where it stands before this move of its day (test loop: waiting at #A94 for the loop, or for a depot place)
      if (a.mode === 'plan' && o.holdAt && o.holdAt(a.k, a.si, a)) { a.v = 0; a.why = 'anello'; return; }
      let leg = a.legs[0];
      while (leg && leg.kind) { a.legs.shift(); if (!marker(a, leg)) return; leg = a.legs[0]; }
      if (!leg) {
        if (a.mode === 'plan') { nextPlanLeg(a); return; }
        if (a.mode === 'shuttle' && a.at != null) { a.legs.push(...nextShuttleLegs(a)); return; }
        if (a.mode === 'timetable') { assign(a); if (!a.legs.length) { a.mode = 'static'; a.status = 'held'; } }
        if (a.mode === 'held') { a.mode = 'static'; a.status = 'held'; }
        return;
      }
      if (leg.cTurn && leg.rev) {
        // C: backwards over the crossover behind the station. Not while a train is coming on that track: then it
        // goes on, empty, to the next station of the closed stretch and waits there for the PC
        const test = { k: a.k, pid: leg.pid, d: leg.start, v: 0, legs: [] };
        const au = authority(test, { status: 'turnback', stops: [], end: leg.start + 300 });
        if (au.lim < leg.start + 5 && au.why && au.why.train != null) {
          a.cWait = a.cWait || S.t;
          if (S.t - a.cWait < 60) return;
          a.cWait = null; goInside(a); return;
        }
        a.cWait = null;
      }
      // a path that goes round (the test loop, twice round): the next hop starts one lap back, at the same place
      const cyc = o.cyclic && o.cyclic[leg.pid];
      if (cyc && leg.pid === a.pid && a.v === 0 && leg.start != null && Math.abs(Math.abs(a.d - leg.start) - cyc) < 8) a.d = leg.start;
      if (leg.pid !== a.pid || leg.rev) {                     // new path from a standing start (same place)
        const rev = leg.rev; leg.rev = false;
        a.pid = leg.pid; a.d = leg.start != null ? leg.start : a.d; a.v = 0;
        if (rev) { a.wait = S.t + reverse; a.status = 'turnback'; return; }      // change of cab
      }
      if (leg.stops && leg.stops.length && a.stopAt == null && Math.abs(leg.stops[0].d - a.d) < 1 && a.v === 0) {
        // the move starts at a station (the first stop of a run): board there first
        const st = leg.stops[0]; a.stopAt = st.st; a.at = st.st; planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase;
      }
      a.status = leg.status; a.trip = leg.trip; a.viaB = !!leg.viaB;
      if (a.stopAt != null) {
        // standing at a stop: passengers, then the departure conditions
        const st = leg.stops[0];
        const ex = a.stopKey && o.extra ? (o.extra(a.k, a.stopKey) || 0) : 0;      // longer stop ordered by radio
        a.dwellUntil = (a.arriveT != null ? a.arriveT : S.t) + (a.dwBase || 0) + ex;
        // the departure signal is set while the doors are still open (the route is ready when the train leaves)
        if (S.t < a.dwellUntil) { if (S.t >= a.dwellUntil - 10 && leg.stops.length > 1) authority(a, leg); a.why = ex ? 'sosta' : null; return; }
        if (!st || leg.stops.length === 1 && st.d >= leg.end - 0.5) {      // last stop of the run: it ends here
          leg.stops.shift(); a.stopAt = null; a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } return;
        }
        if (a.pcHold) { a.why = 'pc'; return; }                                                              // held by the PC
        // never early; departure signals: via libera 30 s before leaving
        if (leg.plan && st.dep && S.t < st.dep) { if (S.t >= st.dep - 30) authority(a, leg); a.why = 'orario'; return; }
        // closure and after reopening: the times of a timetable run, at most a minute's wait for them
        if (leg.timed && !leg.plan && st.dep && S.t < st.dep && S.t - a.dwellUntil < 60) { a.why = 'orario'; return; }
        // at least two minutes after the train before it left this station the same way (90 s when not in service)
        const key = st.st + ':' + (leg.dir || '');
        if (S.lastDep[key] != null && S.t - S.lastDep[key] < (leg.status === 'service' ? HEADWAY : NON_SERVICE_HEADWAY)) { a.why = 'intervallo'; return; }
        const au = authority(a, leg);
        if (au.lim < a.d + 5) { a.why = 'segnale'; if (!a.red) a.red = { since: S.t, why: au.why }; return; }
        S.lastDep[key] = S.t; a.red = null; a.why = null; a.stopAt = null; leg.stops.shift();
        if (a.vlim && a.vlimTo === st.st) { a.vlim = null; a.vlimTo = null; }    // speed limit "as far as this station": over
        a.late = st.dep && leg.timed ? S.t - st.dep : null; a.depSi = leg.si;
        a.at = st.st; a.arr = leg.dir;
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
          if (leg.stops && leg.stops.length) {
            const st = leg.stops[0];
            if (leg.skipSet && leg.skipSet.has(st.st) && leg.stops.length > 1) { leg.stops.shift(); return; }
            a.stopAt = st.st; a.at = st.st; a.arrLate = st.arr != null ? S.t - st.arr : null; a.exitClosed = false;
            if (leg.plan) { planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase; }
            else { a.arriveT = S.t; a.stopKey = null; a.dwBase = leg.status !== 'service' ? 1 : Math.abs(st.d - leg.start) < 1 ? 30 : 20; a.dwellUntil = S.t + a.dwBase; }
          } else { a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } }
          a.red = null;
        } else if (au.why && !a.red) a.red = { since: S.t, why: au.why };
      } else if (a.v > 0.5) { a.red = null; a.why = null; }
    }
    function step(t) {
      let guard = 0;
      while (S.t + DT <= t && guard++ < 40000) {
        // events whose time has come (again, after going back in time)
        for (const e of TL.events) if (!e.done && e.t <= S.t + DT) { e.done = true; apply(e); }
        S.t += DT; S.rt.t = S.t; refresh();
        for (const a of S.agents) {
          const p0 = a.pid, n0 = a.d + half;
          stepAgent(a);
          if (a.v > 0.5 && S.rt.wants && S.rt.wants[a.k]) delete S.rt.wants[a.k];     // it moves: it no longer waits
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
          RT.release(S.rt, a.k, a.pid, a.d - half, a.hidden || (a.status === 'parked' && !(S.t < a.wait && a.wait - S.t <= 15)) || a.mode === 'static', S.t < a.wait && a.legs[0] ? a.legs[0].pid : null);
          if (o.record) o.record(a.k, a, S.t);
        }
        if (Math.floor(S.t / SNAP) !== Math.floor((S.t - DT) / SNAP)) snapshot();
      }
      return S.t;
    }

    // ---------- time line: saved states and events ----------
    const SNAP = 600, TL = { snaps: [], events: [] };
    function snapshot() {
      const snap = structuredClone({ t: S.t, il: S.il, rt: S.rt, agents: S.agents, log: S.log, lastDep: S.lastDep, cl: S.cl, parts: S.parts, reopened: S.reopened, usedRuns: [...usedRuns] });
      TL.snaps = TL.snaps.filter(x => x.t < S.t); TL.snaps.push(snap);
      if (TL.snaps.length > 220) TL.snaps.splice(1, 1);
    }
    function restore(snap) {
      const c = structuredClone(snap);
      Object.assign(S, { t: c.t, il: c.il, rt: c.rt || RT.fresh(), agents: c.agents, log: c.log, lastDep: c.lastDep || {}, cl: c.cl || null, parts: c.parts || [], reopened: c.reopened != null ? c.reopened : null });
      CLOSED = S.cl ? closedPieces(S.cl) : null; usedRuns.clear(); (c.usedRuns || []).forEach(x => usedRuns.add(x));
      TL.events.forEach(e => { e.done = e.t <= S.t; });
    }
    let lastResult = null;
    function apply(e) {
      if (e.kind === 'order') lastResult = order(e.k, e.what, e.arg);
      else if (e.kind === 'close') { close(e.cl); lastResult = true; }
      else if (e.kind === 'reopen') { reopen(S.t); lastResult = true; }
      else if (e.kind === 'normal') { S.cl = null; S.parts = []; S.reopened = null; CLOSED = null; start(S.t, o.initAt(S.t)); }
      else if (e.kind === 'pc') lastResult = RT.authorize(S.rt, e.key);         // the PC authorises a signal or a movement
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
      if (a.mode === 'inside' && a.status === 'stopped') {
        const I = a.inside, q = I.q;
        if (kind === 'depot') {                     // empty to the end of its path (San Donato) and into the depot
          if (I.dir !== 'S' || I.end == null) return false;
          a.legs = [{ pid: I.pid, status: 'empty', stops: [], end: I.end, start: a.d }, { kind: 'depot' }];
          a.status = 'empty'; a.mode = 'moving'; return true;
        }
        if (kind !== 'next' || q + 1 >= I.stops.length) return false;
        const next = I.stops[q + 1], P = partOf(next.st);
        I.q = q + 1;
        a.legs = [{ pid: I.pid, status: 'empty', stops: [], end: next.d, start: a.d }];
        if (P && I.m != null) {                     // it reaches the open line: from there it runs with the others
          a.mode = 'shuttle'; a.part = P; a.legs.push(...legsFromPlan(I.m, I.j, P, next.d)); a.inside = null;
        } else if (P) { a.mode = 'shuttle'; a.part = P; a.at = next.st; a.arr = I.dir; a.inside = null; a.legs.push({ kind: 'boundary' }); }
        else { a.mode = 'inside'; a.legs.push({ kind: 'stopped' }); }
        a.status = 'empty'; return true;
      }
      if (kind !== 'hold') a.pcHold = false;
      // a train standing at a station: the PC holds it there, or lets it go
      if (kind === 'hold') { if (a.stopAt == null && a.status !== 'stopped') return false; a.pcHold = true; return G.names[a.stopAt != null ? a.stopAt : a.at] || true; }
      if (kind === 'release') { a.pcHold = false; return true; }
      // after reopening, a late train: skip stops, end the run early and turn back, or empty to the depot
      const leg = a.legs.find(l => !l.kind && l.stops && l.status === 'service' && l.stops.length);
      if (S.reopened && leg) {
        if (kind === 'skip') { leg.skipSet = new Set(leg.stops.slice(a.stopAt != null ? 1 : 0, 4).filter((z, i, arr) => z !== leg.stops[leg.stops.length - 1]).map(z => z.st)); leg.skip = true; return true; }
        if (kind === 'depot') {
          if (leg.dir !== 'S') return false;
          const end = pathEdges[leg.pid] ? pathEdges[leg.pid].e[pathEdges[leg.pid].e.length - 1][3] - half - 5 : leg.end;
          a.legs = [{ pid: leg.pid, status: 'empty', stops: [], end, start: null }, { kind: 'depot' }]; a.stopAt = null; return true;
        }
        if (kind === 'limit') {                     // end the run where it can turn back, then back the other way
          const i = leg.stops.findIndex((z, n) => n > 0 && n < leg.stops.length - 1 && G.turns[z.st + ':' + leg.dir] && (G.turns[z.st + ':' + leg.dir].A || G.turns[z.st + ':' + leg.dir].C));
          if (i < 0) return false;
          leg.stops = leg.stops.slice(0, i + 1); leg.end = leg.stops[i].d; leg.timed = false; leg.arrive = { at: leg.stops[i].st, dir: leg.dir };
          a.legs = [leg, { kind: 'boundary' }]; a.part = [0, last]; a.limitTo = leg.stops[i].st;
          return G.names[leg.stops[i].st];
        }
      }
      return false;
    }

    function state(k) {
      const a = S.agents[k]; if (!a) return null;
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null;
      return { inside: a.inside, to: leg && leg.arrive ? leg.arrive.at : null, pid: a.pid, d: a.d, v: a.v, status: a.status, mode: a.mode, hidden: !!a.hidden, red: a.red, late: a.late, stopAt: a.stopAt, why: a.why, trip: a.trip,
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
    return { S, TL, IL, RT, il: () => S.il, rt: () => S.rt, start, step, seek, event, order, replan, state, snapshot, mapTo, nextOf, close, reopen, closed: () => CLOSED, agents: () => S.agents, occ: ei => edgeMap.get(ei) };
  }

  const api = { create, DT, HEADWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLAgents = api;
})(typeof window !== 'undefined' ? window : globalThis);
