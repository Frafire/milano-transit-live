// Milano Transit Live — the M3 trains as "almost sentient" agents: the one engine that moves them.
//
// Every train drives itself, half a second at a time, looking only at the track in front of it. In normal service
// it follows its day from the timetable as a reference: it never leaves a station early, and when late it drives
// as fast as allowed to catch up. The same rules hold in every situation:
//  - it never passes a red signal: a block section, a terminal junction, a tail or a crossover held by another train;
//  - it never runs into another train (it looks at the real track pieces, also when reversing over a crossover);
//  - on the open parts of the line it runs as a shuttle (navetta), with no timetable: it leaves a station when the
//    signal is green and the train in front left that station at least HEADWAY seconds before;
//  - at the station next to the closure passengers get off, it changes cab, goes over a crossover and back;
//  - trains caught between the two closed stations stop at the next station and wait for the PC (radio).
// When the stretch reopens every train takes a timetable run again from the next station it stops at. Late, it
// drives as fast as allowed to catch up; very late, the driver asks the PC what to do.
//
// Time line: the state of all trains is saved every 10 minutes and before every event (closure, reopening, radio
// order). Going back in time restores the last saved state before that moment and drives on from there; the events
// after it are applied again when their time comes (the same input gives the same result). The day computed in
// advance by engine.js is only used to start quickly at any time when nothing has happened yet.
(function (root) {
  const DT = 0.5, HEADWAY = 120, NON_SERVICE_HEADWAY = 90, LOOK = 700, GAP = 15, CLAIM = 8;

  const ILmod = typeof module !== 'undefined' && module.exports ? require('./interlocking.js') : root.MTLInterlocking;

  function create(o) {
    // o: { G, ops, reverse, half, prof, pathEdges, netEdges, resources, locks(cl), planOf(k), stopsOf, zones,
    //      dwell[k](pid, d, tArrive, late, key), extra(k, key), initAt(t) -> positions }
    const { G, ops, reverse, half, prof, pathEdges, netEdges, stopsOf } = o;
    const planOf = k => o.planOf ? o.planOf(k) : o.plans0[k];
    const nTrains = () => o.planOf ? o.count : o.plans0.length;
    const acc = ops.acceleration_ms2 || 1.1, brk = ops.braking_ms2 || 1.2, last = G.names.length - 1;
    const stopOf = (dir, i) => dir === 'N' ? G.N.stops[i] : G.S.stops[last - i];
    const opp = d => d === 'N' ? 'S' : 'N';
    const runDir = sts => sts[sts.length - 1].st > sts[0].st ? 'N' : 'S';
    const S = { agents: [], t: 0, cl: null, parts: [], lastDep: {}, reopened: null, log: [] };
    let R = [];
    const byPid = {};
    function setResources(list) {
      R = list; for (const k in byPid) delete byPid[k];
      R.forEach((r, ri) => { r.claim = null; for (const [pid, [a, b]] of Object.entries(r.ranges)) (byPid[pid] = byPid[pid] || []).push([a + (r.pad || 0), b, ri]); });
      for (const k in byPid) byPid[k].sort((x, y) => x[0] - y[0]);
    }
    setResources(o.resources.slice());
    const partOf = i => S.parts.find(p => i >= p[0] && i <= p[1]) || null;

    // ---------- legs: what an agent still has to drive ----------
    // { pid, status, trip, stops: [{ d, st, dep }], end, start, dir, timed, shuttle, arrive, rev, frame, noBlocks }
    // markers: { kind: 'boundary' | 'held' | 'stopped' | 'depot' | 'assign' }
    function legOfSeg(s, fromD) {
      const sts = stopsOf(s), stops = [];
      sts.forEach(z => { if (fromD == null || z.d >= fromD - 0.5) stops.push({ d: z.d, st: z.st, j: z.j, arr: s[3][z.j], dep: s[4][z.j + 1] === z.d ? s[3][z.j + 1] : s[3][z.j] }); });
      return { pid: s[0], status: s[1], trip: s[2], stops, end: s[4][s[4].length - 1], start: fromD != null ? fromD : s[4][0], dir: sts.length > 1 ? runDir(sts) : null };
    }
    // the day of train m from run j: legs until a run leaves part P (cut at the boundary station)
    function legsFromPlan(m, j, P, fromD) {
      const plan = planOf(m), legs = [];
      for (; j < plan.length; j++) {
        const s = plan[j], sts = stopsOf(s), leg = legOfSeg(s, fromD); fromD = null;
        if (!sts.length) { legs.push(leg); if (s[1] === 'to_depot') { legs.push({ kind: 'park' }); return legs; } continue; }
        if (!P) { legs.push(leg); continue; }
        const k = leg.stops.findIndex(z => z.st < P[0] || z.st > P[1]);
        if (k < 0) { leg.arrive = { at: leg.stops.length ? leg.stops[leg.stops.length - 1].st : null, dir: leg.dir }; legs.push(leg); continue; }
        if (k === 0) { legs.push({ kind: 'held' }); return legs; }
        const X = leg.stops[k - 1].st, tr = G.turns[X + ':' + leg.dir];
        if (tr && !tr.A && !tr.C && tr.B && k >= 2 && stopOf(leg.dir, leg.stops[k - 2].st) < tr.B.du - 60) {
          // only B here: from the station before, over the crossover onto the other track and into its platform
          const prev = leg.stops[k - 2];
          leg.stops = leg.stops.slice(0, k - 1); leg.end = prev.d; leg.arrive = null; legs.push(leg);
          const dPrev = stopOf(leg.dir, prev.st);
          legs.push({ pid: tr.B.pid, status: 'service', trip: leg.trip, stops: [{ st: prev.st, d: dPrev }, { st: X, d: tr.B.d_arr }], end: tr.B.d_arr, start: dPrev,
            dir: leg.dir, shuttle: true, viaB: true, noBlocksAfter: tr.B.du - 200, arrive: { at: X, dir: leg.dir }, frame: { off: 0 } });
          legs.push({ kind: 'boundary' });
          return legs;
        }
        leg.stops = leg.stops.slice(0, k); leg.end = leg.stops[k - 1].d; leg.arrive = { at: X, dir: leg.dir };
        legs.push(leg); legs.push({ kind: 'boundary' });
        return legs;
      }
      return legs;
    }
    // shuttle legs after arriving at the end of the part: a.at (station), a.arr (direction it came)
    // San Donato (the depot end of the line) and the last passenger departure of the day
    const DEPOT_END = Math.max(0, G.names.findIndex(n => /SAN DONATO/i.test(n)));
    let lastDep_ = null;
    function lastDeparture() {
      if (lastDep_ == null) { lastDep_ = 0; for (let m = 0; m < nTrains(); m++) for (const z of planOf(m)) if (z[1] === 'service') lastDep_ = Math.max(lastDep_, z[3][0]); }
      return lastDep_;
    }
    function nextShuttleLegs(a) {
      const P = a.part, X = a.at, dir = a.arr, o2 = opp(dir), T = o2 === 'N' ? P[1] : P[0], out = [];
      const run = (pid, off, firstD) => {
        const stops = [];
        for (let i = X; o2 === 'N' ? i <= T : i >= T; i += o2 === 'N' ? 1 : -1) stops.push({ d: i === X ? firstD : stopOf(o2, i) + off, st: i });
        return { pid, status: 'service', trip: -1, stops, end: stops[stops.length - 1].d, start: firstD, dir: o2, shuttle: true, arrive: { at: T, dir: o2 }, frame: { off } };
      };
      if (X === 0 || X === last) {
        // terminus: into a free tail, change cab, out on the main path of the same tail the other way
        const tr = !(T === 0 || T === last) && G.turns[T + ':' + o2], needB = tr && !tr.A && tr.B;
        const cands = (G.pairs && G.pairs.length ? G.pairs : [{ N: G.N, S: G.S }]).filter(p => (!needB || p.N.pid === G.N.pid) && mapTo(a.pid, a.d, p[dir].pid) != null);
        if (!cands.length) { goInside(a); return a.legs.splice(0); }
        const P = cands.find(p => tailFree(a, p[dir])) || (S.t - (a.tailWait || (a.tailWait = S.t)) > 600 ? cands[0] : null);
        if (!P) return [{ kind: 'retry' }];
        a.tailWait = null;
        const inP = P[dir], outP = P[o2], stopP = (pp, dd, i) => dd === 'N' ? pp.stops[i] : pp.stops[last - i];
        out.push({ pid: inP.pid, status: 'turnback', stops: [], end: inP.tail[1], start: mapTo(a.pid, a.d, inP.pid), tailOf: inP.pid });
        out.push({ pid: outP.pid, status: 'turnback', stops: [], end: stopP(outP, o2, X), start: outP.tail[0], rev: true });
        if (needB) {     // towards a B turn: on the B path, arriving on the other track
          const r = run(tr.B.pid, 0, stopOf(o2, X)); r.stops[r.stops.length - 1].d = tr.B.d_arr; r.end = tr.B.d_arr; r.viaB = true; r.noBlocksAfter = tr.B.du - 200;
          out[1].pid = tr.B.pid; out.push(r);
        } else {
          const r = run(outP.pid, 0, stopP(outP, o2, X));
          r.stops.forEach(z => { z.d = stopP(outP, o2, z.st); }); r.end = r.stops[r.stops.length - 1].d;
          if (S.reopened) withTimetable(r, X, o2);
          // after reopening, once the timetable has no more runs for it (end of the service): empty to San Donato and
          // into the depot, where it is switched off
          if (S.reopened && !r.timed && S.t > lastDeparture() - 600) {
            if (X === DEPOT_END) { out.length = 0; out.push({ kind: 'depot' }); return out; }
            r.status = 'empty'; r.stops = [r.stops[0], r.stops[r.stops.length - 1]];
          }
          out.push(r);
        }
        return out;
      }
      const tr = G.turns[X + ':' + dir];
      const main = o2 === 'N' ? G.N : G.S;
      if (!tr || (!a.viaB && !tr.A && !tr.C)) { goInside(a); return a.legs.splice(0); }
      if (a.viaB) { const r = run(main.pid, 0, stopOf(o2, X)); r.rev = true; r.noBlocksUntil = stopOf(o2, X) + 400; out.push(r); return out; }
      if (tr.A) {   // on beyond the crossover, change cab, over it into the other platform
        const stub = a.d + (tr.A.stub_d - stopOf(dir, X)), dP = stopOf(o2, X) + tr.A.off;
        out.push({ pid: a.pid, status: 'turnback', stops: [], end: stub, start: a.d });
        out.push({ pid: tr.A.pid, status: 'turnback', stops: [], end: dP, start: tr.A.d0, rev: true });
        out.push(run(tr.A.pid, tr.A.off, dP));
        return out;
      }
      if (tr.C) {   // passengers board here; change cab and leave backwards over the crossover behind the station
        const off = tr.C.d_dep - stopOf(o2, X), r = run(tr.C.pid, off, tr.C.d_dep);
        r.rev = true; r.cTurn = true; r.noBlocksUntil = tr.C.d_dep + 600; out.push(r); return out;
      }
      goInside(a); return a.legs.splice(0);
    }

    // ---------- normal service: each train follows its own day ----------
    function planLeg(k, si, fromD) {
      const s = planOf(k)[si], leg = legOfSeg(s, fromD);
      leg.si = si; leg.plan = true; leg.timed = true; leg.t0 = s[3][0];
      return leg;
    }
    // pos[k]: { pid, d, v, seg, before, startAt, leaveAt, status } from the day computed in advance at time t
    // interlocking: controlled signals (junction groups, depot signals worked by the player)
    const IL = o.interlocking && ILmod ? ILmod.create(Object.assign({}, o.interlocking, { sigpos: o.sigpos, half: o.half })) : null;
    S.il = IL ? IL.fresh(null) : null;
    function start(t, pos) {
      S.il = IL ? IL.fresh(S.il) : null;
      S.t = t; S.cl = null; S.lockCl = null; S.parts = [[0, last]]; S.reopened = null; S.lastDep = {}; S.log = [];
      setResources(o.resources.slice()); claimed.clear(); usedRuns.clear();
      S.agents = pos.map((p, k) => {
        const plan = planOf(k), a = { k, pid: p.pid, d: p.d, v: 0, status: 'parked', legs: [], stopAt: null, wait: 0, mode: 'plan', si: p.seg, part: [0, last], red: null };
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
    // stop time at a station of its day: like the day computed in advance (station times, radio extras)
    function planDwell(a, leg, st) {
      const k = a.k, key = leg.si + ':' + st.j;
      a.arriveT = S.t; a.stopKey = key;
      if (st.j === 0) { const planned = Math.max(0, st.dep - st.arr); a.dwBase = Math.min(planned, 20); return; }
      const dw = o.dwell && o.dwell[k] ? o.dwell[k](leg.pid, st.d, S.t, S.t - st.arr, key) : null;
      a.dwBase = dw != null ? dw : 20;
    }

    // ---------- closing: every M3 train becomes an agent ----------
    // pos[k]: { pid, d, v, seg (index in its plan), status } where each train is at tc
    function close(tc, cl, pos) {
      S.t = tc; S.cl = cl; S.lastDep = {}; S.reopened = null;
      S.parts = []; if (cl.a > 0) S.parts.push([0, cl.a]); if (cl.b < last) S.parts.push([cl.b, last]);
      S.lockCl = cl; setResources(o.resources.concat(o.locks ? o.locks(cl) : []));
      S.agents = pos.map((p, k) => {
        const a = { k, pid: p.pid, d: p.d, v: 0, status: p.status === 'parked' ? 'parked' : 'held', legs: [], stopAt: null, wait: 0, mode: 'static', part: null, red: null, seg0: p.seg };
        const plan = planOf(k);
        if (p.seg < 0 || p.seg >= plan.length || p.status === 'parked') return a;
        const s = plan[p.seg], sts = stopsOf(s);
        a.v = Math.min(p.v || 0, 22);
        if (sts.length) {
          const q0 = sts.findIndex(z => z.d >= p.d - 0.5), q = q0 < 0 ? sts.length - 1 : q0, P = partOf(sts[q].st);
          a.status = 'service';
          if (P) { a.mode = 'shuttle'; a.part = P; a.legs = legsFromPlan(k, p.seg, P, p.d); return a; }
          // between two closed stations: on to the next station, then wait for the PC
          const leg = legOfSeg(s, p.d); leg.stops = leg.stops.slice(0, 1); leg.end = leg.stops.length ? leg.stops[0].d : p.d;
          a.mode = 'inside'; a.inside = { m: k, j: p.seg, q, dir: runDir(sts), pid: s[0], stops: sts.map(z => ({ st: z.st, d: z.d })), end: s[4][s[4].length - 1] };
          a.legs = [leg, { kind: 'stopped' }];
          return a;
        }
        let j = p.seg; while (j < plan.length && !stopsOf(plan[j]).length) j++;
        if (j >= plan.length) return a;
        const P = partOf(stopsOf(plan[j])[0].st);
        a.status = s[1];
        // an empty run on the line that would go through the closed stretch: it stops at the last open station
        const z = (o.zones && o.zones[s[0]]) || [], dEnd = s[4][s[4].length - 1];
        const ahead = z.filter(x => x[0] > p.d - half && x[0] < dEnd).sort((x, y) => x[0] - y[0]);
        const ci = ahead.findIndex(x => !partOf(x[3]));
        if (s[1] === 'empty' && ci > 0 && partOf(ahead[ci - 1][3])) {
          const X = ahead[ci - 1][3], dir = ahead[ci][3] > X ? 'N' : 'S', P2 = partOf(X);
          a.mode = 'shuttle'; a.part = P2; a.at = X; a.arr = dir;
          a.legs = [{ pid: s[0], status: 'empty', stops: [], end: (ahead[ci - 1][0] + ahead[ci - 1][1]) / 2, start: p.d, arrive: { at: X, dir } }, { kind: 'boundary' }];
          return a;
        }
        if (P) { a.mode = 'shuttle'; a.part = P; a.legs = legsFromPlan(k, p.seg, P, p.d); return a; }
        // its next run starts on the closed side: what is moving finishes, then it waits there
        // (a train going into the depot finishes the move and is switched off there; one standing in the depot stays off)
        const inDepot = s[1] === 'to_depot' || s[1] === 'from_depot' || s.length > 5 && s[5] != null;
        if (p.v > 0.1 && s[1] !== 'from_depot') { a.mode = 'held'; a.legs = [legOfSeg(s, p.d), { kind: inDepot ? 'park' : 'held' }]; }
        else a.status = inDepot ? 'parked' : 'held';
        return a;
      });
    }

    // ---------- the track in front ----------
    const occ = [], edgeMap = new Map();
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
      R.forEach((_, ri) => { if (!occ[ri]) occ[ri] = new Set(); else occ[ri].clear(); });
      edgeMap.clear();
      for (const a of S.agents) {
        if (a.hidden) continue;
        for (const f of footprint(a)) { if (!edgeMap.has(f[0])) edgeMap.set(f[0], []); edgeMap.get(f[0]).push([a.k, f[1], f[2]]); }
        for (const [s0, e0, ri] of byPid[a.pid] || []) { if (s0 > a.d + half) break; if (a.d - half <= e0) occ[ri].add(a.k); }
      }
    }
    const busyFor = (ri, k) => { for (const x of occ[ri]) if (x !== k) return true; const c = R[ri].claim; return !!(c && c.k !== k && S.t - c.t < CLAIM); };
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
      // signals: block sections, junctions, tails, crossovers for turning back
      const skipBlocks = leg.status === 'turnback' || (leg.noBlocksUntil != null && a.d < leg.noBlocksUntil) || (leg.noBlocksAfter != null && a.d > leg.noBlocksAfter);
      const list = byPid[a.pid] || [];
      for (let n = 0; n < list.length; n++) {
        const [s0, e0, ri] = list[n];
        if (s0 < nose - 1) continue;
        if (s0 > nose + LOOK || s0 - half - 3 >= lim) break;
        if (skipBlocks && R[ri].block && !R[ri].lock) continue;
        // (a turn-back area: wait 40 m further back, the train turning there may stop just outside it, facing this one)
        if (busyFor(ri, a.k)) { lim = Math.min(lim, R[ri].lock ? s0 - half - 43 : atSignal(a, s0)); why = { res: ri }; break; }
        // a junction (nobody may stop in it): go in only if the train can get right through it
        if (R[ri].noWait) {
          // the whole train must be able to get out of it (its rear past the end), and what follows must be free
          let blocked = lim < e0 + half + 2 ? why : null;
          for (let m = n + 1; m < list.length && !blocked; m++) { const [s1, , r1] = list[m]; if (s1 > e0 + half + 5) break; if (r1 !== ri && busyFor(r1, a.k)) blocked = { res: r1 }; }
          if (blocked) { lim = Math.min(lim, S.lockCl ? s0 - half - 3 : atSignal(a, s0)); why = blocked; break; }
        }
      }
      // controlled signals (interlocking): pass only with via libera for this train
      if (IL) for (const c of IL.ahead(a.pid, nose, LOOK)) {
        const stop = a.d > c.d - half - 3 ? a.d : c.d - half - 3;
        if (stop >= lim) break;
        // it stops before the signal first (a station, or the end of this move): it asks when it leaves from there
        const next = leg.stops && leg.stops.length && a.stopAt == null ? leg.stops[0].d : leg.end;
        if (next != null && next < c.d - half) break;
        if (IL.request(S.il, a.k, c.si, c.d, nose, lim + half, a.pid, limTrains + half)) continue;
        lim = stop; why = { sig: c.si }; break;
      }
      return { lim, why };
    }
    // where to stop for a section starting at s0: just before the signal that protects it (a placed one, up to 150 m
    // before; else the section's own start)
    function atSignal(a, s0) {
      const sp = o.sigpos && o.sigpos[a.pid]; let best = null;
      // (a train standing a few metres past a signal, as in the short San Donato tails, stays where it is)
      if (sp) for (const [d] of sp) { if (d > s0 + 5) break; if (d >= s0 - 150 && d > a.d + half - 12 && clearStand(a.pid, Math.max(a.d, d - half - 3))) best = d; }
      return best != null ? Math.max(Math.min(a.d, s0 - half - 3), best - half - 3) : s0 - half - 3;
    }
    // a train standing with its middle at c is not in a junction nor in a turn-back area (it would block them)
    function clearStand(pid, c) {
      for (const [s1, e1, ri] of byPid[pid] || []) { if (s1 > c + half) break; if ((R[ri].noWait || R[ri].lock) && e1 >= c - half) return false; }
      return true;
    }
    function claimAhead(a) {
      if (a.v < 0.2) return;                      // a train standing at a signal does not hold what is behind it
      for (const [s0, e0, ri] of byPid[a.pid] || []) {
        if (s0 > a.d + half + 5) break;
        if (e0 < a.d - half) continue;
        const c = R[ri].claim; if (!c || c.k === a.k || S.t - c.t >= CLAIM) R[ri].claim = { k: a.k, t: S.t };
      }
    }
    function speedLimit(a, leg) {
      let v = (ops.train_max_kmh || 90) / 3.6;
      const p = prof[a.pid];
      if (p) for (const sg of p) { if (sg[0] > a.d + half + 400) break; if (sg[1] < a.d - half) continue;
        v = Math.min(v, sg[0] <= a.d + half ? sg[2] : Math.sqrt(sg[2] * sg[2] + 2 * brk * (sg[0] - a.d - half))); }
      // empty (no passengers), shunting, skipping stops: through the platforms at 40 km/h
      const z = o.zones && o.zones[a.pid];
      if (z && (leg.status !== 'service' || leg.skip)) for (const [z0, z1, zv] of z) {
        if (z1 < a.d - half || z0 > a.d + half + 300) continue;
        v = Math.min(v, z0 <= a.d + half ? zv : Math.sqrt(zv * zv + 2 * brk * (z0 - a.d - half))); }
      if (a.slowUntil && S.t < a.slowUntil) v = Math.min(v, 20 / 3.6);      // after reopening: 20 km/h for 2 minutes
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
    // a tail is free when nobody stands in its last 200 m and nobody else is on the way in
    function tailFree(a, mp) {
      const pe = pathEdges[mp.pid]; if (!pe) return true;
      for (const b of S.agents) if (b !== a && !b.hidden && b.legs[0] && b.legs[0].tailOf === mp.pid) return false;
      for (const [ei, , x0, x1] of pe.e) { if (x1 < mp.tail[1] - 200) continue; const l = edgeMap.get(ei); if (l && l.some(z => z[0] !== a.k)) return false; }
      return true;
    }
    // after reopening: the run takes the times of a timetable run from that station, that way (it never leaves more
    // than a minute early; late, it catches up as it can)
    const usedRuns = new Set();
    function withTimetable(r, X, dir) {
      let best = null;
      Array.from({ length: nTrains() }, (_, m) => planOf(m)).forEach((p, m) => p.forEach((z, j) => {
        if (usedRuns.has(m + ':' + j)) return;
        const zs = stopsOf(z); if (zs.length < 2 || runDir(zs) !== dir) return;
        const x = zs.findIndex(y => y.st === X); if (x < 0 || x === zs.length - 1) return;
        const tx = z[4][zs[x].j + 1] === zs[x].d ? z[3][zs[x].j + 1] : z[3][zs[x].j];
        if (tx < S.t - 3600 || tx > S.t + 1800) return;
        const score = tx > S.t + 120 ? 2 * (tx - S.t) : S.t - tx;
        if (!best || score < best.score) best = { m, j, zs, z, score };
      }));
      if (!best) return;
      usedRuns.add(best.m + ':' + best.j);
      const dep = {}; best.zs.forEach(y => { dep[y.st] = best.z[4][y.j + 1] === y.d ? best.z[3][y.j + 1] : best.z[3][y.j]; });
      r.stops.forEach(z => { if (dep[z.st] != null) z.dep = dep[z.st]; });
      r.timed = true; r.shuttle = false; r.ref = best.z[2];
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
    // ---------- one step of one agent ----------
    function marker(a, m) {
      if (m.kind === 'boundary') { a.legs.unshift(...nextShuttleLegs(a)); return true; }
      if (m.kind === 'held') { a.mode = 'static'; a.status = 'held'; return false; }
      if (m.kind === 'park') { a.mode = 'static'; a.status = 'parked'; a.v = 0; return false; }
      if (m.kind === 'stopped') { a.status = 'stopped'; a.stoppedSince = S.t; return false; }
      if (m.kind === 'depot') { a.hidden = true; a.mode = 'static'; a.status = 'depot'; return false; }
      if (m.kind === 'assign') { assign(a); return a.legs.length > 0; }
      if (m.kind === 'retry') { a.legs.unshift(...nextShuttleLegs(a)); return a.legs[0] && a.legs[0].kind !== 'retry'; }
      return true;
    }
    function stepAgent(a) {
      if (a.mode === 'static' || a.hidden || a.status === 'stopped' || S.t < a.wait) return;
      // held where it stands before this move of its day (test loop: waiting at #A94 for the loop, or for a depot place)
      if (a.mode === 'plan' && o.holdAt && o.holdAt(a.k, a.si, a)) { a.v = 0; a.why = 'anello'; return; }
      let leg = a.legs[0];
      while (leg && leg.kind) { a.legs.shift(); if (!marker(a, leg)) return; leg = a.legs[0]; }
      if (!leg) {
        if (a.mode === 'plan') { nextPlanLeg(a); return; }
        if (a.mode === 'shuttle' && a.at != null) { a.legs.push(...nextShuttleLegs(a)); return; }
        if (a.mode === 'timetable') { assign(a); if (!a.legs.length) { a.mode = 'static'; a.status = 'held'; } }
        return;
      }
      if (leg.cTurn && leg.rev) {
        // C: backwards over the crossover behind the station. Not while a train is coming on that track: then it
        // goes on, empty, to the next station of the closed stretch and waits there for the PC
        const test = { k: a.k, pid: leg.pid, d: leg.start };
        const au = authority(test, { status: 'turnback' });
        if (au.lim < leg.start + 250) {
          a.cWait = a.cWait || S.t;
          if (S.t - a.cWait < 20) return;
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
        if (rev) { a.wait = S.t + reverse; a.status = 'turnback'; return; }
      }
      if (leg.plan && leg.stops.length && a.stopAt == null && Math.abs(leg.stops[0].d - a.d) < 1 && a.v === 0) {
        // the move starts at a station (the first stop of a run): board there first
        const st = leg.stops[0]; a.stopAt = st.st; a.at = st.st; planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase;
      }
      a.status = leg.status; a.trip = leg.trip; a.frame = leg.frame || a.frame;
      a.viaB = !!leg.viaB;
      if (a.stopAt != null) {
        // standing at a stop: passengers, then the departure conditions
        const st = leg.stops[0];
        const ex = a.stopKey && o.extra ? (o.extra(a.k, a.stopKey) || 0) : 0;      // longer stop ordered by radio
        a.dwellUntil = (a.arriveT != null ? a.arriveT : S.t) + (a.dwBase || 0) + ex;
        if (S.t < a.dwellUntil) { a.why = ex ? 'sosta' : null; return; }
        if (!st || leg.stops.length === 1 && st.d >= leg.end - 0.5) {      // last stop of the run: it ends here
          leg.stops.shift(); a.stopAt = null; a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } return;
        }
        if (a.pcHold) { a.why = 'pc'; return; }                                                              // held by the PC
        if (leg.plan && st.dep && S.t < st.dep) { a.why = 'orario'; return; }                               // never early
        if (leg.timed && !leg.plan && st.dep && S.t < st.dep && S.t - a.dwellUntil < 60) { a.why = 'orario'; return; }   // after reopening: a minute at most
        const key = st.st + ':' + (leg.dir || '');
        const minHeadway = leg.status === 'service' ? HEADWAY : NON_SERVICE_HEADWAY;
        if (S.lastDep[key] != null && S.t - S.lastDep[key] < minHeadway) { a.why = 'intervallo'; return; }
        const au = authority(a, leg);
        if (au.lim < a.d + 5) { a.why = 'segnale'; if (!a.red) a.red = { since: S.t, why: au.why }; return; }
        S.lastDep[key] = S.t; a.red = null; a.why = null; a.stopAt = null; leg.stops.shift();
        if (a.vlim && a.vlimTo === st.st) { a.vlim = null; a.vlimTo = null; }    // speed limit "as far as this station": over
        a.late = leg.timed && st.dep ? S.t - st.dep : null;
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
          if (leg.stops.length) {
            const st = leg.stops[0];
            if (leg.skipSet && leg.skipSet.has(st.st) && leg.stops.length > 1) { leg.stops.shift(); return; }
            a.stopAt = st.st; a.at = st.st;
            if (leg.plan) { planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase; }
            else { a.arriveT = S.t; a.stopKey = null; a.dwBase = leg.status !== 'service' ? 1 : Math.abs(st.d - leg.start) < 1 ? 30 : 20; a.dwellUntil = S.t + a.dwBase; }
          } else { a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } }
          a.red = null;
        } else if (au.why && !a.red) a.red = { since: S.t, why: au.why };
      } else if (a.v > 0.5) { a.red = null; a.why = null; }
      claimAhead(a);
    }
    function step(t) {
      let guard = 0;
      while (S.t + DT <= t && guard++ < 40000) {
        // events whose time has come (again, after going back in time)
        for (const e of TL.events) if (!e.done && e.t <= S.t + DT) { e.done = true; apply(e); }
        S.t += DT; refresh();
        for (const a of S.agents) { const p0 = a.pid, n0 = a.d + half; stepAgent(a); if (IL) IL.release(S.il, a.k, a.pid, a.d + half, a.hidden || a.status === 'parked', a.pid === p0 ? n0 : null, a.v); }
        if (Math.floor(S.t / SNAP) !== Math.floor((S.t - DT) / SNAP)) snapshot();
      }
      return S.t;
    }

    // ---------- time line: saved states and events ----------
    const SNAP = 600, TL = { snaps: [], events: [] };
    function snapshot() {
      const snap = structuredClone({ t: S.t, il: S.il, agents: S.agents, lastDep: S.lastDep, cl: S.cl, lockCl: S.lockCl, parts: S.parts, reopened: S.reopened, log: S.log,
        claims: R.map(r => r.claim), claimed: [...claimed], usedRuns: [...usedRuns] });
      TL.snaps = TL.snaps.filter(x => x.t < S.t); TL.snaps.push(snap);
      if (TL.snaps.length > 220) TL.snaps.splice(1, 1);
    }
    function restore(snap) {
      const c = structuredClone(snap);
      Object.assign(S, { t: c.t, il: c.il, agents: c.agents, lastDep: c.lastDep, cl: c.cl, lockCl: c.lockCl, parts: c.parts, reopened: c.reopened, log: c.log });
      setResources(o.resources.concat(S.lockCl && o.locks ? o.locks(S.lockCl) : []));
      c.claims.forEach((x, i) => { if (R[i]) R[i].claim = x; });
      claimed.clear(); c.claimed.forEach(x => claimed.add(x)); usedRuns.clear(); c.usedRuns.forEach(x => usedRuns.add(x));
      TL.events.forEach(e => { e.done = e.t <= S.t; });
    }
    const posNow = () => S.agents.map(a => ({ pid: a.pid, d: a.d, v: a.v, seg: a.mode === 'plan' ? a.si : (a.si != null ? a.si : -1),
      status: a.hidden || a.status === 'parked' ? 'parked' : a.status, before: a.mode === 'plan' && S.t < a.wait }));
    let lastResult = null;
    function apply(e) {
      if (e.kind === 'close') close(S.t, e.cl, posNow());
      else if (e.kind === 'reopen') reopen(S.t);
      else if (e.kind === 'order') lastResult = order(e.k, e.what, e.arg);
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
    // With nothing happened yet (no events), a big jump starts again from the day computed in advance (instant).
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

    // ---------- reopening: back to the timetable ----------
    const claimed = new Set();
    function reopen(t) {
      // the crossovers used for turning back stay protected (a train may still be turning there)
      S.reopened = t; S.cl = null; S.parts = [[0, last]];
      setResources(o.resources.concat(S.lockCl && o.locks ? o.locks(S.lockCl) : [])); claimed.clear(); usedRuns.clear();
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

    function state(k) {
      const a = S.agents[k]; if (!a) return null;
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null;
      return { pid: a.pid, d: a.d, v: a.v, status: a.status, mode: a.mode, hidden: !!a.hidden, red: a.red, late: a.late, stopAt: a.stopAt, why: a.why, inside: a.inside, trip: a.trip,
               seg: a.mode === 'plan' ? a.si : -1, waiting: S.t < a.wait, pcHold: !!a.pcHold, vlim: a.vlim ? Math.round(a.vlim * 3.6) : null, vlimTo: a.vlimTo,
               stops: leg && leg.stops ? leg.stops.map(z => z.st) : [],
               dir: leg ? leg.dir : (a.inside ? a.inside.dir : null), to: leg && leg.arrive ? leg.arrive.at : null, timed: !!(leg && leg.timed), at: a.at };
    }
    const nextOf = k => { const a = S.agents[k]; return a && a.inside && a.inside.q + 1 < a.inside.stops.length ? a.inside.stops[a.inside.q + 1].st : null; };
    // a radio change to a train's day (platform, tail, test loop...): it takes it from where it is
    function replan(k) {
      const a = S.agents[k]; if (!a || a.mode !== 'plan') return;
      const cur = a.legs[0];
      if (cur && cur.si === a.si && !cur.kind) {
        // the new plan may run this stretch on another path (San Donato: platform 1 instead of 2): same place on it
        const pid2 = planOf(k)[a.si][0]; let d = a.d;
        if (pid2 !== a.pid) { d = mapTo(a.pid, a.d, pid2); if (d == null) return false; a.pid = pid2; a.d = d; }
        const fresh = planLeg(k, a.si, d); if (S.t < a.wait) fresh.start = cur.start; else fresh.start = d;
        if (a.stopAt != null && fresh.stops.length && Math.abs(fresh.stops[0].d - a.d) > 1) a.stopAt = null; a.legs = [fresh]; a.red = null; }
      return true;
    }
    return { S, TL, IL, il: () => S.il, start, close, step, seek, event, order, reopen, replan, state, nextOf, snapshot, mapTo, agents: () => S.agents, resources: () => R };
  }

  const api = { create, HEADWAY, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLAgents = api;
})(typeof window !== 'undefined' ? window : globalThis);
