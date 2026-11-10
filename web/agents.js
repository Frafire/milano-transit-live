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
  const FXmod = typeof module !== 'undefined' && module.exports ? require('./faults.js') : root.MTLFaults;

  function create(o) {
    // o: { G, ops, reverse, half, prof, pathEdges, netEdges, sigall, sigpos, interlocking, planOf(k) | plans0, count,
    //      stopsOf, zones, dwell[k](pid, d, tArrive, late, key), extra(k, key), initAt(t) -> positions, cyclic, holdAt,
    //      record(k, a, t) (optional: called after every step of every train, for the day driven at build time) }
    const { G, ops, reverse, half, prof, pathEdges, netEdges, stopsOf } = o;
    const planOf = k => o.planOf ? o.planOf(k) : o.plans0[k];
    const acc = ops.acceleration_ms2 || 1.1, brk = ops.braking_ms2 || 1.2;
    // ---------- the trains' performance and the smart ATO (Giovanni, 1 Nov 2026) ----------
    // each kind of train (o.kindOf(k, t): 'meneghino' or 'serie8000'): acceleration full and empty, service brake. In
    // service the load goes with the hour (ops.load_by_hour). The ATO cruises at a percentage of the limit of the
    // stretch, between min and max, chosen every few seconds to keep the trains evenly spaced (and a little more when
    // the train is late); at the minimum, a train still too close to the one ahead is an alarm for the PC (a stop held
    // at a station, his tool, is more efficient than going slower still)
    const PERF = ops.performance || {}, LOAD = ops.load_by_hour || {}, ATO = ops.ato || {};
    const ATO_MIN = (ATO.min_pct || 80) / 100, ATO_MAX = (ATO.max_pct || 100) / 100, ATO_BASE = (ATO.base_pct || (ops.ato_cruise_pct || 85)) / 100, ATO_EVERY = ATO.every_s || 5;
    function loadAt(t) {
      const h = ((t / 3600) % 24 + 24) % 24;
      if ((LOAD.peak_hours || []).some(([a, b]) => h >= a && h <= b)) return LOAD.peak != null ? LOAD.peak : 1;
      const dh = LOAD.day_hours || [6.5, 21]; return h >= dh[0] && h <= dh[1] ? (LOAD.day != null ? LOAD.day : 0.5) : (LOAD.night != null ? LOAD.night : 0.25);
    }
    function perfOf(a) {
      const P = PERF[o.kindOf ? o.kindOf(a.k, S.t) : 'meneghino'];
      if (!P) { a.accCap = acc; a.brk = brk; return; }
      const load = a.status === 'service' ? loadAt(S.t) : 0;
      a.accCap = P.acc_empty - (P.acc_empty - P.acc_full) * load; a.brk = P.brake_service || brk;
      if (byHand(a)) a.accCap *= 0.85;      // manual driving (ATO failed, through a closed station, the depot, the first runs): it accelerates less (Giovanni)
      if (FX && FX.half(a)) a.accCap *= P.one_unit != null ? P.one_unit : 0.5;  // one of its two units cut out: half the traction (performance: one_unit)
    }
    let atoLast = -Infinity;
    function atoTick() {
      if (S.t - atoLast < ATO_EVERY) return; atoLast = S.t;
      // where each train in service is along the line, each way (metres on the main path of that way)
      const pos = { N: [], S: [] };
      for (const a of S.agents) {
        if (a.hidden) continue; perfOf(a);
        const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null, dir = leg && leg.dir;
        if (!dir || a.status !== 'service') { a.ato = ATO_BASE; a.atoWarn = false; continue; }
        const main = dir === 'N' ? G.N : G.S, x = main && mapTo(a.pid, a.d, main.pid);
        if (x == null) { a.ato = ATO_BASE; a.atoWarn = false; continue; }
        pos[dir].push({ a, x });
      }
      for (const L of Object.values(pos)) {
        L.sort((p, q) => p.x - q.x);
        L.forEach((p, i) => {
          const ahead = i + 1 < L.length ? L[i + 1].x - p.x : null, behind = i > 0 ? p.x - L[i - 1].x : null;
          // evenly spaced: as far from the one ahead as from the one behind
          const e = ahead != null && behind != null ? (ahead - behind) / (ahead + behind) : 0;
          const late = Math.max(0, Math.min(0.1, (p.a.late || 0) / 2400));
          const pc = Math.max(ATO_MIN, Math.min(ATO_MAX, ATO_BASE + 0.25 * e + late));
          p.a.ato = pc; p.a.atoGap = ahead; p.a.atoWarn = pc <= ATO_MIN + 1e-6 && ahead != null && behind != null && ahead < 0.55 * behind;
        });
      }
      // ATO failed: manual driving, no even cruise (the speed goes up and down between 75 and 95% of the limit)
      for (const a of S.agents) if (byHand(a)) { a.ato = 0.75 + 0.2 * (0.5 + 0.5 * Math.sin(S.t / 37 + a.k)); a.atoWarn = false; a.man = true; } else a.man = false;
    }
    // stn[station]: what the PC set for a station (radio alla stazione): closed to the public (trains do not stop), the
    // text on its platform screens
    const S = { agents: [], t: 0, log: [], lastDep: {}, cl: null, parts: [], reopened: null, stn: {}, faults: null, zones: [] };
    // failures (web/faults.js, foglio Guasti): emergency brake of each kind of train
    const FX = FXmod ? FXmod.create({ S, G, DT, loadAt, weekday: o.weekday, radio: o.radio, tempi: o.tempi, badoni: o.badoni, half, vyard: (ops.depot_speed_kmh || 15) / 3.6, catalog: o.faults || [], unitOf: o.unitOf, hasSocimi: !!o.hasSocimi, emBrake: a => ((PERF[o.kindOf ? o.kindOf(a.k, S.t) : 'meneghino'] || {}).brake_emergency || 1.5),
      line: {
        // the signals and switches of the main tracks (where the line failures happen), the route behind a signal
        sigs: () => [...new Set([G.N.pid, G.S.pid].flatMap(pid => (o.sigall && o.sigall[pid] || []).map(x => x[1])))].filter(n => !RT.isPcSignal(n)).sort((x, y) => x - y),
        switches: () => [...new Set([G.N.pid, G.S.pid].flatMap(pid => RT.switchesOn(pid, -Infinity, Infinity).map(x => x[1])))].sort((x, y) => x - y),
        sigEdges: n => { for (const [pid, l] of Object.entries(o.sigall || {})) { const x = l.find(y => y[1] === n); if (x) return RT.span(+pid, x[0], RT.nextSignal(+pid, x[0])).pieces.map(p => p[0]); } return []; },
        positions: nd => RT.switchPositions(nd), last: () => last,
        zone: (kind, a, b, extra) => addZone(kind, a, b, extra), unzone: id => dropZone(id),
        home: (k, endOfRun, turnX) => goHome(S.agents[k], endOfRun, turnX), rescue: k => startRescue(k), tow: k => startTow(k), rescuers: k => rescuers(k),
        // the Badoni from ROD (the line cut off): the broken train is taken away; the DCT: closures, back to the hybrid timetable
        takeAway: k => { const a = S.agents[k]; if (!a) return; if (parkOff(a)) return; a.hidden = true; a.mode = 'static'; a.status = 'depot'; a.v = 0; delete S.rt.routes[a.k]; },
        badoniWay: k => badoniWay(k), place: (k, pid, d) => { const a = S.agents[k]; if (!a) return; a.pid = pid; a.d = d; a.v = 0; a.stopAt = null; },
        // (not those that would turn the trains where there is no power now: closureBlocked)
        closures: X => (o.closures || []).map((c, i) => Object.assign({ i }, c)).filter(c => c.a <= X - 1 && c.b >= X + 1 && (c.often === 'sì' || c.often === 'raramente' || c.often == null) && closureBlocked(c.a, c.b) == null).sort((p, q) => (p.b - p.a) - (q.b - q.a)).slice(0, 3),
        close: i => { const c = (o.closures || [])[i]; if (!c) return false; close({ a: c.a, b: c.b, ends: {} }); S.clLast = { label: c.label, t0: S.t, cl: { a: c.a, b: c.b, ends: {} } }; return true; },
        reopen: () => { if (S.cl) reopen(S.t); },
        hybrid: () => toHybrid(), wake: k => wake(S.agents[k]), names: () => G.names,
        // a train on strike still in the depot (its plan takes it out later): it stays there
        keepIn: k => { const a = S.agents[k]; if (!a || a.hidden || a.mode !== 'plan' || a.status !== 'parked' || a.legs.some(l => !l.kind && l.status === 'service')) return false; a.mode = 'static'; a.strikeDepot = true; return true; },
        stuckIn: () => S.agents.filter(a => !a.hidden && a.why === 'tensione' && a.stopAt == null && a.v === 0),
        station: (X, closed, why) => { const x = S.stn[X] = Object.assign({}, S.stn[X]); if (closed) { x.closed = true; if (why) x.why = why; } else { delete x.closed; delete x.why; } if (!Object.keys(x).length) delete S.stn[X]; },     // (why: 'fire', the screens say so)
      } }) : null;
    const SDT = new Set(o.sdTails || []);           // the San Donato tails' track pieces (build)
    const VISTA = (ops.marcia_a_vista_kmh || 15) / 3.6, THRU = (ops.closed_station_kmh || 30) / 3.6;         // marcia a vista: 15 km/h (30 on paper; Giovanni's colleague, Nov 2026)
    const last = G ? G.names.length - 1 : 0;
    const stopOf = (dir, i) => dir === 'N' ? G.N.stops[i] : G.S.stops[last - i];
    const opp = d => d === 'N' ? 'S' : 'N';
    const runDir = sts => sts[sts.length - 1].st > sts[0].st ? 'N' : 'S';
    const partOf = i => S.parts.find(p => i >= p[0] && i <= p[1]) || null;
    const nTrains = () => o.planOf ? o.count : o.plans0.length;
    // how a train turns at the end of a closed stretch (Giovanni's order of preference), among the turns the track has
    const TP = o.closureTurns || {};
    const turnAt = (X, dir) => { const tr = G.turns[X + ':' + dir]; if (!tr) return null; const k = ((S.turnOv && S.turnOv[X + ':' + dir]) || TP[X + ':' + dir] || ['A', 'C', 'B']).find(x => tr[x]); return k ? { kind: k, t: tr[k] } : null; };
    // one track only at an end of the closure (rules closure_one_track): another turn, or a navetta (NAV, from the build)
    const OT = o.closureOneTrack || {}, NAV = o.navette || {}, REVP = o.revPaths || {};
    // the paths that run a track the wrong way (the navette, a train going back on its track): slower there, with the
    // block the other way and its devices cut out (Giovanni, 2 Nov 2026)
    const CONTRA = new Set([...Object.values(REVP), ...Object.values(NAV).map(v => v.contra)].filter(x => x != null)), ILL = (ops.illegal_kmh || 30) / 3.6;

    // ---------- legs: what an agent still has to drive ----------
    // { pid, status, trip, stops: [{ d, st, dep, arr, j }], end, start, dir, plan, timed, si, t0 }
    function legOfSeg(s, fromD) {
      const sts = stopsOf(s), stops = [];
      sts.forEach(z => { if (fromD == null || z.d >= fromD - 0.5) stops.push({ d: z.d, st: z.st, j: z.j, arr: s[3][z.j], dep: s[4][z.j + 1] === z.d ? s[3][z.j + 1] : s[3][z.j] }); });
      return { pid: s[0], status: s[1], trip: s[2], stops, end: s[4][s[4].length - 1], start: fromD != null ? fromD : s[4][0],
               dir: sts.length > 1 ? (sts[sts.length - 1].st > sts[0].st ? 'N' : 'S') : null };
    }
    // driven by hand (MAN), Giovanni 9 Nov 2026: every move in the depot ("tutti i movimenti in deposito sono effettuati
    // in MAN"; the ATO goes in past #A02 or at the San Donato platform: here, at the platform, where the service begins),
    // and the first run of the day each way. By hand a train accelerates less and keeps under the limit (perfOf, atoTick,
    // speedLimit), and on the first runs it stops off its mark at 4 stops in 100 (manualStop)
    let FIRST = null;
    function firstRuns() {
      if (FIRST) return FIRST; FIRST = new Set(); const best = {};
      for (let k = 0; k < nTrains(); k++) (planOf(k) || []).forEach((s, si) => { if (s[1] !== 'service') return;
        const l = legOfSeg(s); if (!l.dir || l.stops.length < 2) return; const t = s[3][0];
        if (!best[l.dir] || t < best[l.dir][0]) best[l.dir] = [t, k + ':' + si]; });
      Object.values(best).forEach(b => FIRST.add(b[1])); return FIRST;
    }
    // (a number from 0 to 1 that is always the same for the same train, run and stop)
    const hash01 = (...v) => { let h = 2166136261; for (const x of v) { h ^= (x | 0) + 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; } return (h >>> 0) / 4294967296; };
    const MANSTOP = ops.manual_stop || {};
    function manualStop(k, si, leg) {
      const p = MANSTOP.miss_pct != null ? MANSTOP.miss_pct / 100 : 0.04, m0 = MANSTOP.short_m != null ? MANSTOP.short_m[0] : 2, m1 = MANSTOP.short_m != null ? MANSTOP.short_m[1] : 6;
      // (short of the mark, never past it: the station signal is 3 m beyond; not at the first and last stops, where the run
      // starts and ends on its mark for the cab change)
      leg.stops.forEach((z, i) => { if (i === 0 || i === leg.stops.length - 1) return; if (hash01(k, si, z.j, 7) < p) { const off = m0 + (m1 - m0) * hash01(k, si, z.j, 11); z.d -= off; z.off = off; } });
    }
    function planLeg(k, si, fromD) {
      const s = planOf(k)[si], leg = legOfSeg(s, fromD);
      leg.si = si; leg.plan = true; leg.timed = true; leg.t0 = s[3][0];
      if (s[1] === 'service' && firstRuns().has(k + ':' + si)) { leg.man = true; manualStop(k, si, leg); }
      return leg;
    }
    const byHand = a => { if (a.hidden) return false; if ((FX && FX.manual(a)) || a.manualTo != null) return true;
      const leg = a.legs && a.legs[0]; if (leg && leg.man) return true; return a.status !== 'service' && a.status !== 'turnback' && a.mode !== 'static'; };

    // depot and test-loop signals (web/interlocking.js); the line: route interlocking (web/routes.js)
    const IL = o.interlocking && ILmod ? ILmod.create(Object.assign({}, o.interlocking, { sigpos: o.sigpos, half: o.half })) : null;
    S.il = IL ? IL.fresh(null) : null;
    const RR = o.routeRules || {};
    const RT = RTmod.create({ sigall: o.sigall || {}, pathEdges, netEdges, itineraries: o.itineraries, times: RR.times, capacity: RR.capacity, pcSignals: RR.pcSignals, tailSlots: RR.tailSlots, exitZones: RR.exitZones, half });
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
        if (!RT.request(S.rt, a.k, pid2, c2.d, c.n, occ, blockOf(a), end2 + half + 3)) continue;
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
      S.t = t; S.log = []; S.lastDep = {}; S.cl = null; S.parts = []; S.reopened = null; CLOSED = null; usedRuns.clear(); atoLast = -Infinity;
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
        if (c.d - nose > Math.max(120, a.v * a.v / (2 * (a.brk || brk)) + 80)) { lim = Math.min(lim, stop); break; }
        const occ = ei => edgeMap.get(ei), upTo = leg.end != null ? leg.end + half + 3 : null;
        // a signal close behind this one, before the train's stop, during a closure (a crossover onto a track used both
        // ways, as in its turns): this route only if the next one can be set too (the train must not stop half way,
        // facing another train)
        const had = RT.held(S.rt, a.k, a.pid, c.d);
        const c2 = !had && (S.cl || S.reopened != null) ? RT.ahead(a.pid, c.d + 1, 700).find(x => x.d > c.d + 5) : null;
        if (c2 && next != null && c2.d < next + half && !RT.held(S.rt, a.k, a.pid, c2.d) && !RT.request(S.rt, a.k, a.pid, c2.d, c2.n, occ, blockOf(a), upTo, true)) {
          lim = stop; why = { sig: c2.n, route: Object.assign({ next: true }, S.rt.dryNo || {}) };
          // (asked for real too: it is not set, but the train is now waiting for it, and the precedence counts it)
          if (RT.request(S.rt, a.k, a.pid, c2.d, c2.n, occ, blockOf(a), upTo)) RT.cancel(S.rt, a.k, a.pid, c2.d);
          break;
        }
        if (RT.request(S.rt, a.k, a.pid, c.d, c.n, occ, blockOf(a), upTo)) {
          // the pair (a closure, the signal close behind): the second route is set together with the first, or neither
          // (else another train could take the second meanwhile, and the two would face each other half way)
          if (c2 && next != null && c2.d < next + half && !RT.held(S.rt, a.k, a.pid, c2.d) && !RT.request(S.rt, a.k, a.pid, c2.d, c2.n, occ, blockOf(a), upTo)) {
            RT.cancel(S.rt, a.k, a.pid, c.d); lim = stop; why = { sig: c2.n, route: Object.assign({ next: true }, S.rt.lastNo || {}) }; break;
          }
          { const rr = (S.rt.routes[a.k] || []).find(r => r.pid === a.pid && Math.abs(r.d0 - c.d) < 1); if (rr && rr.vista) a.avista = { pid: a.pid, d1: rr.d1 }; }
          if (RT.ready(S.rt, a.k, a.pid, c.d)) continue;
          lim = stop; why = { sig: c.n, route: { wait: 'scambio' } }; break;          // switches moving, signal opening
        }
        const no = S.rt.lastNo;
        // marcia illegale (San Donato): the DCT's order covers the routes of the whole move that need the PC
        if (leg.ill && no && no.pc && RT.authorize(S.rt, no.pc) && RT.request(S.rt, a.k, a.pid, c.d, c.n, occ, blockOf(a), upTo)) { if (RT.ready(S.rt, a.k, a.pid, c.d)) continue; lim = stop; why = { sig: c.n, route: { wait: 'scambio' } }; break; }
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
          if ((a.v > 0 && sw[0] - nose > Math.max(120, a.v * a.v / (2 * (a.brk || brk)) + 80)) || !RT.request(S.rt, a.k, a.pid, nose, null, ei => edgeMap.get(ei), blockOf(a), leg.end != null ? leg.end + half + 3 : null)) { if (stop < lim) { lim = stop; why = { route: S.rt.lastNo, start: true }; } }
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
      const B = a.brk || brk, pc = a.ato || ATO_BASE;
      // by hand in the depot: a little under its speeds (the line's are already scaled by the ATO percentage, pc)
      const pm = a.man && a.status !== 'service' ? 0.9 + 0.08 * (0.5 + 0.5 * Math.sin(S.t / 23 + a.k)) : 1;
      if (p) for (const sg of p) { if (sg[0] > a.d + half + 400) break; if (sg[1] < a.d - half) continue;
        const vs = sg[3] != null ? (sg[4] ? sg[3] * pc : sg[3] * pm) : sg[2] * pm;
        v = Math.min(v, sg[0] <= a.d + half ? vs : Math.sqrt(vs * vs + 2 * B * (sg[0] - a.d - half))); }
      // empty (no passengers), shunting: through the platforms at 40 km/h
      const z = o.zones && o.zones[a.pid];
      if (z && (leg.status !== 'service' || leg.skip)) for (const [z0, z1, zv] of z) {
        if (z1 < a.d - half || z0 > a.d + half + 300) continue;
        v = Math.min(v, z0 <= a.d + half ? zv : Math.sqrt(zv * zv + 2 * B * (z0 - a.d - half))); }
      // through a station closed to the public (manual driving): its platform at 30 km/h (Giovanni)
      if (z && a.manualTo != null) for (const [z0, z1] of z) {
        if (z1 < a.d - half || z0 > a.d + half + 300) continue;
        const own = x => x >= z0 - 10 && x <= z1 + 10;
        if ((leg.stops || []).some(x => own(x.d)) || (a.lastStop && a.lastStop.pid === a.pid && own(a.lastStop.d))) continue;
        v = Math.min(v, z0 <= a.d + half ? THRU : Math.sqrt(THRU * THRU + 2 * B * (z0 - a.d - half))); }
      if (leg.status === 'turnback') v = Math.min(v, 25 / 3.6);
      if (CONTRA.has(a.pid) || leg.ill) v = Math.min(v, ILL);               // on a track the wrong way, marcia illegale
      // after reopening: 40 km/h on the stretch that was closed, for 20 minutes (Giovanni)
      if (SLOW && S.t < SLOW.until) { const pe = pathEdges[a.pid], vz = SLOW.kmh / 3.6;
        if (pe) for (const [ei, , x0, x1] of pe.e) { if (x1 < a.d - half) continue; if (x0 > a.d + half + 300) break;
          if (SLOW.set.has(ei)) v = Math.min(v, x0 <= a.d + half ? vz : Math.sqrt(vz * vz + 2 * B * (x0 - a.d - half))); } }
      if (a.vlim) v = Math.min(v, a.vlim);                                   // speed limit ordered by the PC
      if (FX) v = Math.min(v, FX.vcap(a));                                   // a failure (ATP: limited speed)
      if (a.avista) { if (a.avista.pid !== a.pid || a.d + half > a.avista.d1 + 1) a.avista = null; else v = Math.min(v, VISTA); }   // marcia a vista
      // zones: slow (a passenger taken ill in a station), marcia a vista (the first train after a stretch was closed)
      for (const Z of ZONES) { const kz = Z.z.kind === 'slow' ? Z.z.kmh / 3.6 : Z.z.kind === 'vista' ? VISTA : null; if (kz == null) continue;
        const pe = pathEdges[a.pid]; if (pe) for (const [ei, , x0, x1] of pe.e) { if (x1 < a.d - half) continue; if (x0 > a.d + half + 300) break;
          const p = Z.map.get(ei); if (!p || (Z.z.kind === 'vista' && Z.z.done[p[2]])) continue;
          v = Math.min(v, x0 <= a.d + half ? kz : Math.sqrt(kz * kz + 2 * B * (x0 - a.d - half))); } }
      return v;
    }

    // the highest speed allowed where the train is now (no braking curves ahead): the red mark on the speedometer
    function limitHere(a) {
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : { status: a.status };
      let v = (ops.train_max_kmh || 90) / 3.6;
      for (const sg of prof[a.pid] || []) { if (sg[0] > a.d + half) break; if (sg[1] < a.d - half) continue; v = Math.min(v, sg[3] != null ? sg[3] : sg[2]); }
      const z = o.zones && o.zones[a.pid];
      if (z && (leg.status !== 'service' || leg.skip)) for (const [z0, z1, zv] of z) if (!(z1 < a.d - half || z0 > a.d + half)) v = Math.min(v, zv);
      if (leg.status === 'turnback') v = Math.min(v, 25 / 3.6);
      if (CONTRA.has(a.pid) || leg.ill) v = Math.min(v, ILL);               // on a track the wrong way, marcia illegale
      if (SLOW && S.t < SLOW.until) { const pe = pathEdges[a.pid]; if (pe) for (const [ei, , x0, x1] of pe.e) if (x1 >= a.d - half && x0 <= a.d + half && SLOW.set.has(ei)) v = Math.min(v, SLOW.kmh / 3.6); }
      if (a.vlim) v = Math.min(v, a.vlim);
      if (a.avista && a.avista.pid === a.pid) v = Math.min(v, VISTA);
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
    let CLOSED = null, SLOW = null;
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
    // (the navetta: only the closed stretch itself; the other trains: also the stretch of the navetta)
    // after reopening, while the navetta (or a train going back on its track) is still on a track the wrong way: no
    // train goes into its stretch (the ones already in it go on)
    let NAVHOLD = null;
    const inHold = a => { for (const ei of NAVHOLD) { const l = edgeMap.get(ei); if (l && l.some(z => z[0] === a.k)) return true; } return false; };
    const navDone = () => { if (NAVHOLD && !S.agents.some(x => x.mode === 'navetta' || x.navBack)) NAVHOLD = null; };
    const closedBlock = a => {
      if (!S.cl && NAVHOLD) return a.mode === 'navetta' || a.navBack || inHold(a) ? null : pieces => { for (const [ei, l0, l1] of pieces) if (NAVHOLD.has(ei) && l1 - l0 > 8) return { closed: ei, navetta: true }; return null; };
      const C = a.mode === 'navetta' || a.navOut ? CLOSED0 : CLOSED;
      return S.cl && C && a.mode !== 'inside' && a.mode !== 'held' && !a.exitClosed && !a.illMove ? pieces => { for (const [ei, l0, l1] of pieces) if (C.has(ei) && l1 - l0 > 8) return { closed: ei }; return null; } : null; };
    let CLOSED0 = null;
    // ---------- zones of the line (failures, fase D2-D3; the PC's emergency commands) ----------
    // a stretch of the main tracks between two stations (or one station: its platforms): no power, all signals red
    // (pulsante rosso: the trains in it brake at once, emergency brake), trains held by the PC, slow (km/h), marcia a
    // vista (the first train on each track at walking pace). No route into a zone that stops the trains.
    let ZONES = [];
    function zoneMap(a, b) {
      const map = new Map(), add = (pid, lo, hi, T) => { for (const [ei, l0, l1] of RT.span(pid, lo, hi).pieces) map.set(ei, [l0, l1, T]); };
      if (a === b) { add(G.N.pid, stopOf('N', a) - half - 30, stopOf('N', a) + half + 30, 'N'); add(G.S.pid, stopOf('S', a) - half - 30, stopOf('S', a) + half + 30, 'S'); }
      else { add(G.N.pid, stopOf('N', a) + half + 5, stopOf('N', b) - half - 5, 'N'); add(G.S.pid, stopOf('S', b) + half + 5, stopOf('S', a) - half - 5, 'S'); }
      return map;
    }
    // (all: the whole line, the stations and between them, both tracks: the red button on all the line)
    const pathLen = pid => Math.max(0, ...((pathEdges[pid] || {}).e || []).map(x => x[3]));
    function zoneAll() { const map = new Map(); for (const [pid, T] of [[G.N.pid, 'N'], [G.S.pid, 'S']]) for (const [ei, l0, l1] of RT.span(pid, 0, pathLen(pid)).pieces) map.set(ei, [l0, l1, T]); return map; }
    function setZones() { ZONES = (S.zones || []).map(z => ({ z, map: z.all ? zoneAll() : zoneMap(z.a, z.b) })); }
    function addZone(kind, a, b, extra) {
      const x = Math.max(0, Math.min(a, b)), y = Math.min(last, Math.max(a, b)); S.zoneSeq = (S.zoneSeq || 0) + 1;
      S.zones = (S.zones || []).concat([Object.assign({ id: S.zoneSeq, kind, a: x, b: y, done: {} }, extra || {})]); setZones(); return S.zoneSeq;
    }
    // a closure a-b whose trains would turn at an end where a zone without power (or with the red button) takes the
    // track beyond the station (the turn uses it): that end station, else null. (Giovanni 3 Nov 2026: with an
    // investimento at Brenta, San Donato – Lodi left the trains unable to turn at Lodi, and the line stuck behind them)
    function closureBlocked(a, b) {
      for (const z of S.zones || []) { if (z.kind !== 'red' && z.kind !== 'power') continue;
        if (z.all) return a > 0 ? a : b;
        if (a > 0 && z.a <= a && z.b >= a + 1) return a;
        if (b < last && z.a <= b - 1 && z.b >= b) return b; }
      return null;
    }
    function dropZone(id) { S.zones = (S.zones || []).filter(z => z.id !== id); setZones(); }
    const inZ = (Z, ei, l0, l1) => { const p = Z.map.get(ei); return p && l0 < p[1] - 2 && p[0] + 2 < l1 ? p[2] : null; };
    const STOPZ = { power: 1, red: 1, stop: 1 };
    function zoneHold(a) {
      let w = null; const fp = footprint(a);
      for (const Z of ZONES) if (STOPZ[Z.z.kind] && fp.some(f => inZ(Z, f[0], f[1], f[2]) != null)) { if (Z.z.kind === 'red') return Z.z; w = w || Z.z; }
      return w;
    }
    const blockOf = a => { const cb = closedBlock(a); if (!ZONES.some(Z => STOPZ[Z.z.kind])) return cb;
      return pieces => (cb && cb(pieces)) || (ZONES.some(Z => STOPZ[Z.z.kind] && pieces.some(([ei, l0, l1]) => inZ(Z, ei, l0, l1) != null)) ? { zone: true } : null); };
    // marcia a vista after a stretch was closed (persona nel tunnel): a track is done when its first train has gone through
    function zoneTick() {
      for (const Z of ZONES) { if (Z.z.kind !== 'vista') continue;
        for (const a of S.agents) { if (a.hidden) continue; const T = footprint(a).map(f => inZ(Z, f[0], f[1], f[2])).find(x => x != null);
          if (T) a.zv = { id: Z.z.id, T }; else if (a.zv && a.zv.id === Z.z.id) { Z.z.done[a.zv.T] = true; a.zv = null; } }
        if (Z.z.done.N && Z.z.done.S) { for (const a of S.agents) if (a.zv && a.zv.id === Z.z.id) a.zv = null; dropZone(Z.z.id); return; } }
    }
    // ---------- a train with a failure leaves the service (fase D4) ----------
    // It lets the passengers off (at the next station; endOfRun: at the end of the run it is making, ATP failed) and goes
    // empty to the depot of Rogoredo (ROD) through San Donato, or northbound to a tail at Comasina. At a terminus: there.
    function goHome(a, endOfRun, turnX) {
      if (!a || a.hidden || a.mode === 'static') return false;
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null, dir = (leg && leg.dir) || a.arr || 'S';
      // at the end of the run: only from a passenger run (a train turning at a terminus: asked again later)
      if (endOfRun && !(leg && leg.status === 'service' && leg.stops && leg.stops.length)) return false;
      if (turnX != null && a.stopAt === turnX && dir === 'N') { a.legs = [{ kind: 'unload' }, { kind: 'turnhome', X: turnX }]; a.stopAt = null; a.mode = 'home'; a.pcHold = false; return true; }
      if (endOfRun && leg.stops.length > 1) { a.legs = [leg, { kind: 'unload' }, { kind: 'home', dir }]; a.mode = 'home'; a.pcHold = false; return true; }     // the whole run first
      if (a.v === 0 && (a.at === 0 || a.at === last) && (a.stopAt != null || S.t < a.wait || !leg || a.status !== 'service')) {
        a.legs = [{ kind: 'unload' }, a.at === 0 ? { kind: 'depot' } : { kind: 'tailpark' }]; a.stopAt = null;
      } else if (leg && leg.stops && leg.stops.length && a.stopAt == null) {
        if (!endOfRun) { leg.stops = leg.stops.slice(0, 1); leg.end = leg.stops[0].d; }
        a.legs = [leg, { kind: 'unload' }, { kind: 'home', dir }];
      } else if (leg && endOfRun && leg.stops && leg.stops.length > 1) a.legs = [leg, { kind: 'unload' }, { kind: 'home', dir }];
      else { a.legs = [{ kind: 'unload' }, { kind: 'home', dir }]; a.stopAt = null; }
      a.mode = 'home'; a.pcHold = false; return true;
    }
    // the rescue (soccorso, rarissimo: both units of the train dead): the train behind it on the same track lets its
    // passengers off at its next station, comes up to it in marcia a vista (it may go into the section of the broken
    // train: S.rt.rescue), couples (5 minutes) and pushes it at 15 km/h; the broken train lets its passengers off at
    // the next station; the two go to the depot (southbound) or to the tails of Comasina
    // which trains could rescue train fk: the one behind (spinta) and the one in front (traino), same track
    // the Badoni from ROD (Giovanni 3 Nov 2026): out of San Donato on the broken train's track, up to it, coupled, back
    // to San Donato with it. Its way: the track from the end of the San Donato platform to the train (s: the way to San
    // Donato on the path); blocked when another train stands on it (that one is the rescuer)
    function badoniWay(fk) {
      const f = S.agents[fk]; if (!f || f.hidden) return null;
      const leg = f.legs[0] && !f.legs[0].kind ? f.legs[0] : null, dir = (leg && leg.dir) || f.arr || 'S', main = dir === 'N' ? G.N : G.S;
      const x = mapTo(f.pid, f.d, main.pid); if (x == null) return null;
      const sd = stopOf(dir, 0), s = sd < x ? -1 : 1, e0 = sd - s * (half + 5), lo = Math.min(e0, x), hi = Math.max(e0, x);
      const blocked = S.agents.some(r => { if (r.k === fk || r.hidden) return false; const xr = mapTo(r.pid, r.d, main.pid); return xr != null && xr > lo - half && xr < hi; });
      return { pid: main.pid, x, sd, e0, s, half, blocked };
    }
    function rescuers(fk) {
      const f = S.agents[fk]; if (!f || f.hidden) return {};
      const leg = f.legs[0] && !f.legs[0].kind ? f.legs[0] : null, dir = (leg && leg.dir) || f.arr || 'S', main = dir === 'N' ? G.N : G.S;
      const xf = mapTo(f.pid, f.d, main.pid); if (xf == null) return {};
      let back = null, front = null;
      for (const r of S.agents) { if (r.k === fk || r.hidden || r.mode === 'static' || r.attached != null || r.rescuing != null) continue;
        const rl = r.legs[0] && !r.legs[0].kind ? r.legs[0] : null; if (!rl || rl.dir !== dir) continue;
        const xr = mapTo(r.pid, r.d, main.pid); if (xr == null) continue;
        if (xr < xf && (!back || xr > back.x)) back = { k: r.k, x: xr };
        if (xr > xf && (!front || xr < front.x) && REVP[dir] != null && mapTo(r.pid, r.d, REVP[dir]) != null) front = { k: r.k, x: xr }; }
      return { back: back && back.k, front: front && front.k, dir };
    }
    function startTow(fk) {          // the train in front: passengers off, back the wrong way up to it, coupling, pulls
      const f = S.agents[fk], w = rescuers(fk); if (w.front == null) return null;
      const r = S.agents[w.front], rev = REVP[w.dir];
      S.rt.rescue = S.rt.rescue || {}; S.rt.rescue[r.k] = fk; r.rescuing = fk; f.rescue = { rk: r.k, stage: 'coming', tow: true };
      const rl = r.legs[0] && !r.legs[0].kind ? r.legs[0] : null;
      if (rl && rl.stops && rl.stops.length && r.stopAt == null) { rl.stops = rl.stops.slice(0, 1); rl.end = rl.stops[0].d; r.legs = [rl, { kind: 'unload' }, { kind: 'backto', f: fk, rev, dir: w.dir }]; }
      else { r.legs = [{ kind: 'unload' }, { kind: 'backto', f: fk, rev, dir: w.dir }]; r.stopAt = null; }
      r.mode = 'home'; r.pcHold = false; return r.k;
    }
    function startRescue(fk) {
      const f = S.agents[fk]; if (!f || f.hidden) return null;
      const leg = f.legs[0] && !f.legs[0].kind ? f.legs[0] : null, dir = (leg && leg.dir) || f.arr || 'S', main = dir === 'N' ? G.N : G.S;
      const xf = mapTo(f.pid, f.d, main.pid); if (xf == null) return null;
      let best = null;
      for (const r of S.agents) { if (r.k === fk || r.hidden || r.mode === 'static' || r.attached != null || r.rescuing != null) continue;
        const rl = r.legs[0] && !r.legs[0].kind ? r.legs[0] : null; if (!rl || rl.dir !== dir) continue;
        const xr = mapTo(r.pid, r.d, main.pid); if (xr == null || xr >= xf) continue;
        if (!best || xr > best.x) best = { r, x: xr }; }
      if (!best) return null;
      const r = best.r; S.rt.rescue = S.rt.rescue || {}; S.rt.rescue[r.k] = fk; r.rescuing = fk; f.rescue = { rk: r.k, stage: 'coming' };
      const rl = r.legs[0] && !r.legs[0].kind ? r.legs[0] : null;
      if (rl && rl.stops && rl.stops.length && r.stopAt == null && rl.stops[0].d < (mapTo(f.pid, f.d, rl.pid) || Infinity)) { rl.stops = rl.stops.slice(0, 1); rl.end = rl.stops[0].d; r.legs = [rl, { kind: 'unload' }, { kind: 'approach', f: fk, dir }]; }
      else { r.legs = [{ kind: 'unload' }, { kind: 'approach', f: fk, dir }]; r.stopAt = null; }
      r.mode = 'home'; r.pcHold = false; return r.k;
    }
    // a train taken out of the service for a fault: always into the officina (Giovanni 9 Nov 2026), on one of its stub
    // tracks the page gives (o.depotPark: { q, pid, d }), when it gets to the depot; null: into the depot as before
    function parkOff(a) {
      const r = o.depotPark ? o.depotPark(a.k) : null; if (!r) return false;
      a.hidden = false; a.mode = 'static'; a.status = 'parked'; a.pid = r.pid; a.d = r.d; a.v = 0; a.legs = []; a.stopAt = null; a.vlim = null;
      a.attached = null; a.broken = true; a.officina = r.q; a.illMove = false; delete S.rt.routes[a.k]; return true;
    }
    function follow(a) {                     // coupled to another train (rescue): it goes where that one goes, right behind it
      const f = S.agents[a.attached];
      if ((!f || f.hidden || f.officina != null) && a.rescue && parkOff(a)) return;          // the broken one, towed: to the officina
      if (f && f.officina != null) { a.attached = null; a.hidden = true; a.mode = 'static'; a.status = 'depot'; a.v = 0; delete S.rt.routes[a.k]; return; }   // the one that pushed it: into the depot
      if (!f || f.hidden) { a.attached = null; a.hidden = true; a.mode = 'static'; a.status = 'depot'; a.v = 0; delete S.rt.routes[a.k]; return; }
      if (f.status === 'parked' || (f.legs[0] && f.legs[0].tailOf)) { a.attached = null; a.v = 0; a.mode = 'home'; a.status = 'empty'; a.legs = [{ kind: 'tailpark' }]; if (f.rescue) f.rescue.stage = 'done'; return; }
      // on the side it stands (behind the one that drives it; the leader's path may change direction at a change of cab)
      const x = mapTo(a.pid, a.d, f.pid), side = x != null ? (x >= f.d ? 1 : -1) : (a.side || -1); a.side = side;
      a.pid = f.pid; a.d = f.d + side * (2 * half + 3); a.v = f.v; a.why = 'soccorso'; a.status = 'empty';
    }
    // ---------- the navetta: one train back and forth on one track between two stations ----------
    function navRun(a, nv, pid, d) {
      const Tdir = nv.track === 1 ? 'S' : 'N', legal = pid === nv.legal;
      const dd = i => legal ? stopOf(Tdir, i) - nv.off : nv.L - (stopOf(Tdir, i) - nv.off);
      const sts = []; for (let i = Math.min(nv.a, nv.b); i <= Math.max(nv.a, nv.b); i++) sts.push({ st: i, d: dd(i) });
      sts.sort((x, y) => x.d - y.d);
      const up = sts.filter(z => z.d >= d - 1);
      if (!up.length) return null;
      return { pid, status: 'service', trip: -1, stops: up, end: up[up.length - 1].d, start: d, dir: legal ? Tdir : opp(Tdir), shuttle: true, nav: true, arrive: { at: up[up.length - 1].st, dir: legal ? Tdir : opp(Tdir) } };
    }
    function navLegs(a, turn) {
      const nv = NAV[a.nav]; if (!nv) return [];
      let pid = turn ? (a.pid === nv.legal ? nv.contra : nv.legal) : nv.legal, d = mapTo(a.pid, a.d, pid);
      if (!turn && d == null) { pid = nv.contra; d = mapTo(a.pid, a.d, pid); }
      if (d == null) return [];
      let r = navRun(a, nv, pid, d);
      if (!r && !turn) { pid = pid === nv.legal ? nv.contra : nv.legal; d = mapTo(a.pid, a.d, pid); r = d != null ? navRun(a, nv, pid, d) : null; turn = true; }
      if (!r) return [];
      if (turn || r.pid !== a.pid) r.rev = turn;          // change of cab at the end of the navetta
      return [r, { kind: 'navrev' }];
    }

    // the day of train m from run j: legs until a run leaves part P (cut at the station where it must turn)
    function legsFromPlan(m, j, P0, fromD, P1) {
      const plan = planOf(m), legs = [], j0 = j;
      for (; j < plan.length; j++) {
        const s = plan[j], sts = stopsOf(s), leg = legOfSeg(s, fromD), P = j === j0 && P1 ? P1 : P0; fromD = null;
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
      const want = S.navWant && Object.keys(S.navWant).find(key => S.navInfo[key].open === a.at && S.navInfo[key].dir === a.arr);
      if (want && a.mode === 'shuttle') {
        delete S.navWant[want]; S.log.push({ t: S.t, k: a.k, nav: want, late: true });
        const nv = NAV[want];
        if (mapTo(a.pid, a.d, nv.legal) != null || mapTo(a.pid, a.d, nv.contra) != null) { a.mode = 'navetta'; a.nav = want; return navLegs(a, false); }
        // on the other track: on beyond the station, change of cab, over the crossover into the other platform (an A
        // turn), and from there into the stretch of the navetta; without an A turn there, the next train
        const tA = (G.turns[a.at + ':' + a.arr] || {}).A;
        if (!tA) { S.navWant[want] = true; S.log.pop(); return nextShuttleLegs_(a); }
        const X = a.at, dir = a.arr, stub = a.d + (tA.stub_d - stopOf(dir, X)), dP = stopOf(opp(dir), X) + tA.off;
        return [{ pid: a.pid, status: 'turnback', stops: [], end: stub, start: a.d }, { pid: tA.pid, status: 'turnback', stops: [], end: dP, start: tA.d0, rev: true }, { kind: 'navstart', nav: want }];
      }
      return nextShuttleLegs_(a);
    }
    function nextShuttleLegs_(a) {
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
        if (S.reopened) withTimetable(r, X, o2, false, a);
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
    // the departures from station X that way not taken by any train: during the closure (soft) the nearest one, at
    // most 2 minutes ago or in the next 15; after reopening (Giovanni: the hybrid system) the first one not yet
    // covered that was due at most 2 minutes ago, or the next one (no train goes back to its own day)
    function freeRuns(X, dir, from, to, exceptK) {
      const out = [];
      Array.from({ length: nTrains() }, (_, m) => planOf(m)).forEach((p, m) => p.forEach((z, j) => {
        if (usedRuns.has(m + ':' + j)) return;
        const ag = S.agents[m]; if (ag && ag.mode === 'plan' && m !== exceptK) return;    // its own train runs that tabella (also the runs it has done)
        const zs = stopsOf(z); if (zs.length < 2 || runDir(zs) !== dir) return;
        const x = zs.findIndex(y => y.st === X); if (x < 0 || x === zs.length - 1) return;
        const tx = z[4][zs[x].j + 1] === zs[x].d ? z[3][zs[x].j + 1] : z[3][zs[x].j];
        if (tx < from || tx > to) return;
        out.push({ m, j, zs, z, tx, key: m + ':' + j });
      }));
      return out.sort((p, q) => p.tx - q.tx);
    }
    function takeRun(r, best) {
      if (r.runKey) usedRuns.delete(r.runKey);
      usedRuns.add(best.key);
      const dep = {}; best.zs.forEach(y => { dep[y.st] = best.z[4][y.j + 1] === y.d ? best.z[3][y.j + 1] : best.z[3][y.j]; });
      r.stops.forEach(z => { z.dep = dep[z.st] != null ? dep[z.st] : undefined; });
      r.timed = true; r.ref = best.z[2]; r.runKey = best.key;
    }
    // a: the train. After reopening (the hybrid system, Giovanni's colleague 2 Nov 2026) the trains are renumbered: a train
    // taking a run of tabella m becomes tabella m (a.tabM) and goes on with its next runs when it can, so the trains come
    // back in line with the timetable
    function withTimetable(r, X, dir, soft, a) {
      let best = null;
      if (soft) {
        for (const c of freeRuns(X, dir, S.t - 120, S.t + 900)) { const score = c.tx > S.t + 120 ? 2 * (c.tx - S.t) : S.t - c.tx; if (!best || score < best.score) best = Object.assign(c, { score }); }
      } else {
        const C = freeRuns(X, dir, S.t - 120, S.t + 1800);
        // (the tabelle other trains have taken: not a second train with the same number, if there is another run)
        const held = new Set(S.agents.filter(x => x !== a && x.mode !== 'plan' && x.tabM != null).map(x => x.tabM));
        best = (a && a.tabM != null && C.find(c => c.m === a.tabM && c.j > (a.tabJ == null ? -1 : a.tabJ) && c.tx <= C[0].tx + 600)) || C.find(c => !held.has(c.m) && c.tx <= C[0].tx + 300) || C[0] || null;
        if (best) r.hard = true;
      }
      if (best) { takeRun(r, best); if (a && !soft) { a.tabM = best.m; a.tabJ = best.j; } }
    }
    // the PC gives a train another departure: the free ones from where its next run starts
    function nextRunOf(a) { return a.legs.find(l => !l.kind && l.stops && l.stops.length && l.status === 'service' && !l.nav); }
    function departuresFor(k) {
      const a = S.agents[k]; if (!a || a.mode === 'plan' || a.hidden) return null;
      const r = nextRunOf(a); if (!r || !r.dir) return null;
      const X = r.stops[0].st, cur = r.runKey && r.stops[0].dep != null ? { key: r.runKey, tx: r.stops[0].dep, ref: r.ref, current: true } : null;
      const list = freeRuns(X, r.dir, S.t - 120, S.t + 2400, k).slice(0, 12).map(c => ({ key: c.key, tx: c.tx, ref: c.z[2] }));
      return { st: X, dir: r.dir, list: cur ? [cur, ...list] : list };
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
      SLOW = null; S.cl = cl; S.reopened = null; S.lastDep = {}; usedRuns.clear();
      // one track only at an end: another way of turning there, or a navetta on the other track, the service turning
      // at the station on the other side of it
      const ends = cl.ends || {}; S.turnOv = {}; S.nav = []; S.navInfo = {}; S.navWant = {};
      let ea = cl.a, eb = cl.b;
      for (const [X, dir] of [[cl.a, 'N'], [cl.b, 'S']]) {
        const op = (ends[X] === '1' || ends[X] === '2') && (OT[X + ':' + dir] || {})[ends[X]]; if (!op) continue;
        if (op.turn) S.turnOv[X + ':' + dir] = op.turn;
        if (op.navetta) { const key = op.navetta.join('-') + '-' + op.track; if (NAV[key]) { S.nav.push(key); if (dir === 'N') ea = op.navetta[0]; else eb = op.navetta[1]; S.navInfo[key] = { dir, open: dir === 'N' ? op.navetta[0] : op.navetta[1] }; } }
      }
      S.clEff = { a: ea, b: eb }; CLOSED0 = closedPieces(cl); CLOSED = ea !== cl.a || eb !== cl.b ? closedPieces(S.clEff) : CLOSED0;
      // the closure's own movements (and the moves against the usual direction its turns make, as at Maciachini)
      S.rt.allow = ['chiusura servizio limitato', 'chiusura tratta', 'chiusura con navetta', 'binario unico'];
      // the signals into the closed stretch go back to red: a route over it that no train has entered yet is cancelled
      for (const [k, rs] of Object.entries(S.rt.routes)) {
        const a = S.agents[+k], nose = a ? a.d + half : -Infinity;
        S.rt.routes[k] = rs.filter(r => !(r.pieces.some(x => CLOSED.has(x[0])) && (!a || a.pid !== r.pid || nose < r.d0 + 1)));
        if (!S.rt.routes[k].length) delete S.rt.routes[k];
      }
      S.parts = []; if (ea > 0) S.parts.push([0, ea]); if (eb < last) S.parts.push([eb, last]);
      const cl0 = cl; cl = { a: ea, b: eb };
      // an interruption from San Donato (Giovanni 3 Nov 2026): its tails are closed to the service for the whole of it. A train
      // in a tail stays there (it does not come out for a run); one already going into a tail to clear the platform goes on
      // into it and stays there (the DCT can still move them by hand)
      const onTail = (pid, x0, x1) => { const pe = pathEdges[pid]; return !!pe && pe.e.some(([ei, , y0, y1]) => SDT.has(ei) && y1 > x0 && y0 < x1); };
      if (cl0.a === 0 && SDT.size) for (const a of S.agents) {
        if (a.hidden || a.mode === 'static' || !onTail(a.pid, a.d - half, a.d + half)) continue;
        const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null, intoTail = leg && leg.end != null && onTail(leg.pid, leg.end - 1, leg.end + 1);
        if (!intoTail) { a.seg0 = a.si; a.mode = 'static'; a.status = 'held'; a.v = 0; a.legs = []; a.sdTailHeld = true; delete S.rt.routes[a.k]; }
      }
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
      // the navetta: of the trains caught on its track in its stretch, the one nearest the closed stretch (so that the
      // others on that track are between it and the open side, and can get out of its way). The other trains in the
      // stretch: going towards the open side, on and out of it (into the service there, or at San Donato into the
      // depot); going towards the closed stretch on the track of the navetta, behind it: at the next station the PC has
      // them change cab and go back to the open side; on the other track: at the next station, waiting for the PC
      for (const key of S.nav) {
        const nv = NAV[key], info = S.navInfo[key], lo = Math.min(nv.a, nv.b), hi = Math.max(nv.a, nv.b);
        const inLegal = (nv.track === 1 ? 'S' : 'N') === info.dir;
        info.P = partOf(info.open);
        const xOf = a => { const d = mapTo(a.pid, a.d, nv.legal); if (d != null) return d; const d2 = mapTo(a.pid, a.d, nv.contra); return d2 != null ? nv.L - d2 : null; };
        const inStretch = a => { if (!a.inside || a.inside.m == null) return false; const q = a.inside.q, nx = a.inside.stops[q], pv = a.inside.stops[q - 1];
          const inR = z => z && z.st >= lo && z.st <= hi;
          return inR(nx) && (!pv || inR(pv) || Math.abs(nx.d - a.d) < 2); };      // between two of its stations, or standing at one
        let best = null;
        for (const a of S.agents) {
          if (a.hidden || (a.mode !== 'inside' && a.mode !== 'held')) continue;
          if (a.mode === 'inside' && !inStretch(a)) continue;
          const x = xOf(a); if (x == null || x < -50 || x > nv.L + 50) continue;
          const sc = inLegal ? x : -x; if (!best || sc > best.sc) best = { a, sc };
        }
        for (const a of S.agents) {
          if (a.hidden || a.mode !== 'inside' || (best && a === best.a) || !inStretch(a)) continue;
          const plan = planOf(a.k), s = plan[a.inside.j];
          if (a.inside.dir !== info.dir) {
            // towards the open side: on, out of the stretch
            if (info.P) { a.mode = 'shuttle'; a.part = info.P; a.navOut = true; a.legs = legsFromPlan(a.k, a.inside.j, info.P, a.d, [Math.min(info.P[0], lo), Math.max(info.P[1], hi)]); a.inside = null; }
            else { const leg = legOfSeg(s, a.d); a.legs = [leg, { kind: 'depot' }]; a.status = 'service'; }
            S.log.push({ t: S.t, k: a.k, navOut: key });
          } else if (xOf(a) != null) { a.legs = [a.legs[0], { kind: 'navback', nav: key }]; S.log.push({ t: S.t, k: a.k, navBack: key }); }
        }
        if (!best) { S.log.push({ t: S.t, nav: key, none: true }); if (info.P) S.navWant[key] = true; continue; }
        const a = best.a; a.mode = 'navetta'; a.nav = key; a.inside = null; a.stopAt = null; a.wait = 0; a.status = 'service';
        a.legs = navLegs(a, false); S.log.push({ t: S.t, k: a.k, nav: key });
      }
      void cl0;
    }
    // ---------- one step of one agent: markers of the closure ----------
    function marker(a, m) {
      if (m.kind === 'boundary') { a.legs.unshift(...nextShuttleLegs(a)); return true; }
      if (m.kind === 'held') { a.mode = 'static'; a.status = 'held'; return false; }
      if (m.kind === 'park') { a.mode = 'static'; a.status = 'parked'; a.v = 0; return false; }
      // stopped at a station of the closed stretch, waiting for the PC: the routes it held ahead go back (its own track
      // stays protected by the train itself standing there)
      if (m.kind === 'stopped') { a.status = 'stopped'; a.stoppedSince = S.t; delete S.rt.routes[a.k]; return false; }
      if (m.kind === 'depot') { if (parkOff(a)) return false; a.hidden = true; a.mode = 'static'; a.status = 'depot'; a.illMove = false; return false; }
      // marcia illegale into a San Donato tail (the DCT): it stays there, as the trains held in the tails
      if (m.kind === 'sdtail') { a.mode = 'static'; a.status = 'held'; a.v = 0; a.illMove = false; a.sdTailHeld = true; a.at = 0; delete S.rt.routes[a.k]; return false; }
      // fase D4: passengers off; then empty to the depot (southbound) or to a tail at Comasina (northbound)
      if (m.kind === 'unload') { a.status = 'empty'; a.stopAt = null; a.wait = S.t + (ops.terminus_unload_s || 45); return false; }
      if (m.kind === 'home') {
        const main = m.dir === 'N' ? G.N : G.S, d = mapTo(a.pid, a.d, main.pid);
        if (d == null && a.at === 0) { a.legs.unshift({ kind: 'depot' }); return true; }
        if (d == null && a.at === last) { a.legs.unshift({ kind: 'tailpark' }); return true; }
        if (d == null) { a.status = 'stopped'; a.stoppedSince = S.t; return false; }
        // northbound: to Comasina, the usual turn there (its tails stay free for the service), then empty to ROD
        if (m.dir === 'N') a.legs.unshift({ pid: main.pid, status: 'empty', stops: [], start: d, end: main.stops[main.stops.length - 1], rev: !!m.rev }, { kind: 'turnempty' });
        else { const pe = pathEdges[main.pid].e; a.legs.unshift({ pid: main.pid, status: 'empty', stops: [], start: d, end: pe[pe.length - 1][3] - half - 5, rev: !!m.rev }, { kind: 'depot' }); }
        return true;
      }
      if (m.kind === 'turnempty') {
        a.at = last; a.arr = 'N'; a.part = [0, last]; const L2 = nextShuttleLegs_(a), i = L2.findIndex(l => !l.kind && l.status === 'service');
        if (i < 0) { a.legs.unshift({ kind: 'tailpark' }); return true; }
        const r = L2[i]; if (r.runKey) usedRuns.delete(r.runKey); const pe = pathEdges[r.pid].e;
        a.legs.unshift(...L2.slice(0, i), { pid: r.pid, status: 'empty', stops: [], start: r.start, end: pe[pe.length - 1][3] - half - 5, rev: r.rev, cTurn: r.cTurn }, { kind: 'depot' }); return true;
      }
      if (m.kind === 'turnhome') {           // back the other way at station X over its crossover, empty to ROD
        const tr0 = G.turns[m.X + ':N'] || {}, endOf = pid => { const pe = pathEdges[pid].e; return pe[pe.length - 1][3] - half - 5; };
        // the DCT authorises the movements of the turn that are not for the normal service (as ROG-3 at Rogoredo)
        const auth = (pid, d0) => { for (const c of RT.ahead(pid, d0 + half - 1, 900)) { RT.request(S.rt, a.k, pid, c.d, c.n, ei => edgeMap.get(ei), null, null, true);
          const w = S.rt.dryNo; if (w && w.pc) RT.authorize(S.rt, w.pc); } };
        if (tr0.C) auth(tr0.C.pid, tr0.C.d_dep); else if (tr0.A) auth(tr0.A.pid, tr0.A.d0);
        if (tr0.C) { const tr = tr0.C; a.legs.unshift({ pid: tr.pid, status: 'empty', stops: [], start: tr.d_dep, end: endOf(tr.pid), rev: true }, { kind: 'depot' }); return true; }
        if (tr0.A) { const tr = tr0.A, stub = a.d + (tr.stub_d - stopOf('N', m.X));
          a.legs.unshift({ pid: a.pid, status: 'turnback', stops: [], end: stub, start: a.d }, { pid: tr.pid, status: 'empty', stops: [], end: endOf(tr.pid), start: tr.d0, rev: true }, { kind: 'depot' }); return true; }
        a.legs.unshift({ kind: 'home', dir: 'N' }); return true;
      }
      if (m.kind === 'approach') {           // the rescue: up to 3 m from the broken train, in marcia a vista
        const f = S.agents[m.f], main = m.dir === 'N' ? G.N : G.S, d = mapTo(a.pid, a.d, main.pid), xf = f && mapTo(f.pid, f.d, main.pid);
        if (d == null || xf == null) { a.status = 'stopped'; a.stoppedSince = S.t; return false; }
        a.vlim = VISTA; a.legs.unshift({ pid: main.pid, status: 'empty', stops: [], start: d, end: xf - 2 * half - 3 }, { kind: 'couple', f: m.f }); return true;
      }
      if (m.kind === 'backto') {             // the wrong way on its track (change of cab), up to 3 m from the broken train
        const f = S.agents[m.f], d = mapTo(a.pid, a.d, m.rev), xf = f && mapTo(f.pid, f.d, m.rev);
        if (d == null || xf == null) { a.status = 'stopped'; a.stoppedSince = S.t; return false; }
        // (the DCT authorises the signals along the move, as for a movement the wrong way)
        for (const c of RT.ahead(m.rev, d + half - 1, Math.max(0, xf - d) + 50)) { RT.request(S.rt, a.k, m.rev, c.d, c.n, ei => edgeMap.get(ei), null, null, true); const w = S.rt.dryNo; if (w && w.pc) RT.authorize(S.rt, w.pc); if (RT.isPcSignal(c.n)) RT.authorize(S.rt, 'n:' + c.n); }
        a.vlim = VISTA; a.legs.unshift({ pid: m.rev, status: 'empty', stops: [], start: d, end: xf - 2 * half - 3, rev: true }, { kind: 'couple', f: m.f, tow: true, dir: m.dir }); return true;
      }
      if (m.kind === 'couple' && m.tow) {    // coupled, with the air: it pulls at 30 km/h; the broken train's passengers get off at the next station
        const f = S.agents[m.f]; if (f && f.rescue) f.rescue.stage = 'coupling';
        a.wait = S.t + 300; a.legs.unshift({ kind: 'pull', f: m.f, dir: m.dir }); return false;
      }
      if (m.kind === 'pull') {
        const f = S.agents[m.f], main = m.dir === 'N' ? G.N : G.S, d = mapTo(a.pid, a.d, main.pid); delete S.rt.routes[a.k]; if (S.rt.rescue) delete S.rt.rescue[a.k]; a.vlim = 30 / 3.6; a.rescuing = null;
        if (!f || d == null) { a.legs = [{ kind: 'home', dir: m.dir }]; return true; }
        f.attached = a.k; f.rescue.stage = 'towed'; delete S.rt.routes[f.k]; f.legs = []; f.mode = 'home';
        // the next station ahead: the convoy stops with the broken train at the platform (passengers off), then home
        const x = d, nxt = [...Array(last + 1).keys()].map(i => ({ i, d: stopOf(m.dir, i) })).filter(y => y.d > x + 2 * half + 20).sort((p, q) => p.d - q.d)[0];
        const legs = [];
        if (nxt && nxt.i !== 0 && nxt.i !== last) legs.push({ pid: main.pid, status: 'empty', stops: [], start: d, end: nxt.d + 2 * half + 3, rev: true }, { kind: 'unload' }, { kind: 'home', dir: m.dir });
        else legs.push({ kind: 'home', dir: m.dir, rev: true });
        a.legs = legs; return true;
      }
      if (m.kind === 'couple') { const f = S.agents[m.f]; if (f && f.rescue) f.rescue.stage = 'coupling'; a.wait = S.t + 300; a.legs.unshift({ kind: 'convoy', f: m.f }); return false; }
      if (m.kind === 'convoy') {
        const f = S.agents[m.f]; a.vlim = null; delete S.rt.routes[a.k]; if (S.rt.rescue) delete S.rt.rescue[a.k];
        if (!f) { a.rescuing = null; a.legs = [{ kind: 'home', dir: m.dir || 'S' }]; return true; }
        a.attached = m.f; a.rescuing = null; f.rescue.stage = 'towed'; f.vlim = 15 / 3.6; goHome(f, false); return false;
      }
      if (m.kind === 'assign') { assign(a); return a.legs.length > 0; }
      if (m.kind === 'retry') { a.legs.unshift(...nextShuttleLegs(a)); return a.legs[0] && a.legs[0].kind !== 'retry'; }
      if (m.kind === 'navback') {
        // behind the navetta on its track: the PC has it change cab and go back on that track to the open side
        const nv = NAV[m.nav], info = S.navInfo && S.navInfo[m.nav]; if (!nv || !info) { a.status = 'stopped'; a.stoppedSince = S.t; return false; }
        const inLegal = (nv.track === 1 ? 'S' : 'N') === info.dir, pid = inLegal ? nv.contra : nv.legal, d = mapTo(a.pid, a.d, pid);
        const r = d != null ? navRun(a, nv, pid, d) : null;
        if (!r) { a.status = 'stopped'; a.stoppedSince = S.t; delete S.rt.routes[a.k]; return false; }
        delete S.rt.routes[a.k]; a.inside = null; r.rev = true; a.wait = S.t + 60; a.navBack = true; a.nav = m.nav;
        a.legs.unshift(r, { kind: 'navjoin', nav: m.nav }); return false;
      }
      if (m.kind === 'navjoin') {
        // back at the open side, in the platform where the trains of the service arrive: it turns with them
        const info = S.navInfo && S.navInfo[m.nav]; a.navBack = false;
        const main = info && (info.dir === 'N' ? G.N : G.S), d2 = main ? mapTo(a.pid, a.d, main.pid) : null;
        if (d2 != null) { a.pid = main.pid; a.d = d2; }
        // reopened meanwhile: back the way it came, in service
        if (!S.cl && info) { navDone(); a.mode = 'shuttle'; a.at = info.open; a.arr = info.dir; a.inside = null; assign(a); if (a.legs[0] && !a.legs[0].kind) a.legs[0].rev = true; return a.legs.length > 0; }
        if (!info || !info.P) { a.legs.unshift({ kind: 'depot' }); return true; }
        a.mode = 'shuttle'; a.part = info.P; a.at = info.open; a.arr = info.dir; a.legs.unshift(...nextShuttleLegs(a)); return true;
      }
      if (m.kind === 'join') {
        // back the wrong way to an open station, in the platform where the service arrives: it turns with them
        const main = m.dir === 'N' ? G.N : G.S, d2 = mapTo(a.pid, a.d, main.pid);
        if (d2 != null) { a.pid = main.pid; a.d = d2; }
        a.inside = null; a.at = m.st; a.arr = m.dir;
        if (!S.cl) { a.mode = 'shuttle'; assign(a); if (a.legs[0] && !a.legs[0].kind) a.legs[0].rev = true; return a.legs.length > 0; }
        a.mode = 'shuttle'; a.part = partOf(m.st) || [0, last]; a.legs.unshift(...nextShuttleLegs(a)); return true;
      }
      if (m.kind === 'tailpark') {
        // at Comasina: into a free tail and switched off there
        const cands = (G.pairs && G.pairs.length ? G.pairs : [{ N: G.N, S: G.S }]).filter(p => mapTo(a.pid, a.d, p.N.pid) != null);
        const Pp = cands.find(p => tailFree(a, p.N)) || cands[0]; if (!Pp) { a.status = 'stopped'; return false; }
        a.legs.unshift({ pid: Pp.N.pid, status: 'turnback', stops: [], end: Pp.N.tail[1], start: mapTo(a.pid, a.d, Pp.N.pid), tailOf: Pp.N.pid }, { kind: 'park' });
        return true;
      }
      if (m.kind === 'navstart') { a.mode = 'navetta'; a.nav = m.nav; a.legs.unshift(...navLegs(a, false)); return a.legs.length > 0; }
      if (m.kind === 'navrev' && !S.cl && NAV[a.nav] && a.pid === NAV[a.nav].legal) { a.mode = 'shuttle'; a.nav = null; navDone(); assign(a); return a.legs.length > 0; }   // reopened: on its own track, on in service
      if (m.kind === 'navrev') { a.legs.unshift(...navLegs(a, true)); return a.legs.length > 0; }   // the other way, after the change of cab
      return true;
    }
    // ---------- reopening: back to the timetable ----------
    function reopen(t) {
      S.reopened = t; S.cl = null; S.parts = [[0, last]]; S.turnOv = {}; S.nav = []; S.navWant = {}; S.agents.forEach(a => { a.navOut = false; });
      SLOW = CLOSED ? { set: new Set(CLOSED), until: t + 1200, kmh: 40 } : null;
      NAVHOLD = CLOSED && CLOSED0 && CLOSED !== CLOSED0 && S.agents.some(x => x.mode === 'navetta' || x.navBack) ? new Set([...CLOSED].filter(e => !CLOSED0.has(e))) : null;
      CLOSED = null; CLOSED0 = null; usedRuns.clear();
      for (const a of S.agents) {
        if (a.status === 'parked' && !a.hidden && a.mode === 'static' && !a.strike && !a.broken) { resumeDay(a, t); continue; }
        if (a.hidden || a.status === 'parked') continue;
        a.part = [0, last];
        // the navetta, and a train going back on its track, on a track the wrong way: to the next station, change of cab,
        // back on that track the right way, then on in service (meanwhile no train goes into the stretch: NAVHOLD)
        if (a.mode === 'navetta' || a.navBack) {
          const nv = NAV[a.nav], i = a.legs.findIndex(l => !l.kind), leg = a.legs[i];
          a.mode = 'navetta'; a.navBack = false;
          if (!nv || !leg) continue;
          if (leg.pid !== nv.contra) continue;                                                                     // the right way already
          if (a.pid !== nv.contra) { a.legs = a.legs.slice(0, i).concat([{ kind: 'navrev' }]); continue; }       // not started yet
          if (leg.stops && leg.stops.length) { leg.stops = leg.stops.slice(0, 1); leg.end = leg.stops[0].d; leg.arrive = null; }
          a.legs = a.legs.slice(0, i + 1).concat([{ kind: 'navrev' }]);
          continue;
        }
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
        } else if (a.status === 'stopped' || a.mode === 'inside' || a.status === 'held' || a.mode === 'held' || a.mode === 'navetta') {
          a.status = a.status === 'stopped' ? 'service' : a.status; a.legs = [{ kind: 'assign' }]; a.mode = 'shuttle';
        }
      }
    }
    // ---------- strike (fase D5) ----------
    // frequenza più bassa: every train in service runs the timetable runs not taken (hybrid, as after reopening)
    function toHybrid() {
      for (const a of S.agents) {
        if (a.hidden || a.mode !== 'plan' || a.attached != null) continue;
        const i = a.legs.findIndex(l => !l.kind && l.status === 'service' && l.stops && l.stops.length); if (i < 0) continue;
        const cur = a.legs[i], first = cur.stops[0]; cur.stops = [first]; cur.end = first.d; cur.arrive = { at: first.st, dir: cur.dir }; cur.plan = false; cur.timed = false;
        a.legs = a.legs.slice(0, i + 1).concat([{ kind: 'assign' }]); a.mode = 'shuttle'; a.part = [0, last];
      }
      S.hybrid = S.t;
    }
    // a train back from the depot (ROD: San Donato) or from a tail at Comasina: it takes the first timetable run not taken
    const wakeD = () => { const pe = pathEdges[G.S.pid].e; return pe[pe.length - 1][3] - half - 5; };
    // nobody where a train comes out of the depot (San Donato)
    function wakeFree() { const w = wakeD(); return !S.agents.some(x => !x.hidden && (x => x != null && Math.abs(x - w) < 2 * half + 250)(mapTo(x.pid, x.d, G.S.pid))); }
    function wake(a) {
      if (!a || a.attached != null) return false;
      if (a.mode === 'static' && a.status === 'parked' && a.strikeDepot) { a.strikeDepot = false; resumeDay(a, S.t); return true; }     // (in the depot by its plan)
      if (a.hidden) { if (!wakeFree()) return false; a.pid = G.S.pid; a.d = wakeD(); a.hidden = false; a.at = 0; a.arr = 'S'; }
      else if (a.status === 'parked') { a.at = last; a.arr = 'N'; }
      else return false;
      a.mode = 'shuttle'; a.status = 'empty'; a.part = [0, last]; a.v = 0; a.wait = S.t + 60; a.legs = [{ kind: 'assign' }]; a.inside = null; return true;
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
      withTimetable(r, here.st, here.dir, false, a);
      a.legs = [r]; a.mode = 'shuttle'; a.part = [0, last]; a.stopAt = null; a.dwellUntil = S.t;
      S.log.push({ t: S.t, k: a.k, at: G.names[here.st], dir: here.dir, ref: r.ref });
    }

    const nextOf = k => { const a = S.agents[k]; return a && a.inside && a.inside.q + 1 < a.inside.stops.length ? a.inside.stops[a.inside.q + 1].st : null; };
    // ---------- one step of one agent ----------
    function stepAgent(a) {
      if (a.mode === 'static' || a.hidden) return;
      if (a.wdWant) { if (a.mode !== 'plan') a.wdWant = false; else if (Math.floor(S.t) % 5 === 0 && goHome(a, true)) a.wdWant = false; }
      if (a.attached != null) { follow(a); return; }       // coupled behind a broken train (rescue)
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
      // braking to a stand without its routes ahead (a failure, no power): the ATP stops it before a signal it has no
      // route for (it never runs past one)
      const noPass = d0 => { if (a.d <= d0) return; for (const c of RT.ahead(a.pid, d0 + half, a.d - d0)) if (c.d > d0 + half && c.d <= a.d + half && !RT.held(S.rt, a.k, a.pid, c.d)) { a.d = Math.max(d0, c.d - half - 0.5); a.v = 0; return; } };
      { const d0 = a.d; if (FX && FX.hold(a)) { noPass(d0); return; } }    // a failure: it brakes to a stop and stands (web/faults.js)
      const zh = ZONES.length ? zoneHold(a) : null;         // no power, pulsante rosso, held by the PC: it stops and stands
      if (zh) { const d0 = a.d; if (a.v > 0) { a.v = Math.max(0, a.v - (zh.kind === 'red' ? FX.emBrake(a) : (a.brk || brk)) * DT); a.d += a.v * DT; noPass(d0); } a.why = zh.kind === 'power' ? 'tensione' : zh.kind === 'red' ? 'rosso' : 'fermo'; return; }
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
          if (S.t - a.cWait < 60 || (S.cl && S.navInfo && Object.values(S.navInfo).some(x => x.open === a.at))) return;
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
        const fx = FX ? FX.extraDwell(a) : 0;                                      // doors, passenger alarm, a passenger taken ill
        a.dwellUntil = (a.arriveT != null ? a.arriveT : S.t) + (a.dwBase || 0) + ex + fx;
        // the departure signal is set while the doors are still open (the route is ready when the train leaves)
        // (but not before 30 s from its departure time: the route is always for the train that leaves first. Giovanni,
        // Precedenze 4 and 27: at San Donato a train that arrived first and leaves later took the exit over the crossover
        // and held up the one leaving before it, Milano Cortina 9 Feb 2026 at 17:59)
        const early = st && st.dep && (leg.plan || leg.timed) && S.t < st.dep - 30;
        if (S.t < a.dwellUntil) { if (S.t >= a.dwellUntil - 10 && leg.stops.length > 1 && !early) authority(a, leg); a.why = fx ? 'guasto' : ex ? 'sosta' : null; return; }
        if (!st || leg.stops.length === 1 && st.d >= leg.end - 0.5) {      // last stop of the run: it ends here
          leg.stops.shift(); a.stopAt = null; a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } return;
        }
        if (a.pcHold) { a.why = 'pc'; return; }                                                              // held by the PC
        // never early; departure signals: via libera 30 s before leaving
        if (leg.plan && st.dep && S.t < st.dep) { if (S.t >= st.dep - 30) authority(a, leg); a.why = 'orario'; return; }
        // closure and after reopening: the times of a timetable run, at most a minute's wait for them
        if (leg.timed && !leg.plan && st.dep && S.t < st.dep && (leg.hard || S.t - a.dwellUntil < 60)) { if (S.t >= st.dep - 30) authority(a, leg); a.why = 'orario'; return; }
        // at least two minutes after the train before it left this station the same way (90 s when not in service)
        const key = st.st + ':' + (leg.dir || '');
        if (S.lastDep[key] != null && S.t - S.lastDep[key] < (leg.status === 'service' ? HEADWAY : NON_SERVICE_HEADWAY)) { a.why = 'intervallo'; return; }
        const au = authority(a, leg);
        if (au.lim < a.d + 5) { a.why = 'segnale'; if (!a.red) a.red = { since: S.t, why: au.why }; a.red.now = au.why; return; }
        S.lastDep[key] = S.t; if (leg.status === 'service') (S.lastSvc = S.lastSvc || {})[st.st] = S.t; a.red = null; a.why = null; a.stopAt = null; leg.stops.shift(); a.lastStop = { pid: a.pid, d: a.d };
        // a station closed to the public before its next stop: in M3 a train goes through a station without stopping only
        // by hand (the interlocking: Giovanni's colleague, Nov 2026): manual driving from here to the station after it
        { let i = 0; while (i < leg.stops.length && S.stn[leg.stops[i].st] && S.stn[leg.stops[i].st].closed) i++; a.manualTo = i > 0 && i < leg.stops.length ? leg.stops[i].st : null; }
        if (a.vlim && a.vlimTo === st.st) { a.vlim = null; a.vlimTo = null; }    // speed limit "as far as this station": over
        a.late = st.dep && leg.timed ? S.t - st.dep : null; a.depSi = leg.si;
        a.at = st.st; a.arr = leg.dir;
      }
      // a station closed to the public: the trains in service go through without stopping
      while (leg.status === 'service' && leg.stops.length > 1 && a.stopAt == null && S.stn[leg.stops[0].st] && S.stn[leg.stops[0].st].closed && leg.stops[0].d > a.d + 1) leg.stops.shift();
      const target = leg.stops.length ? leg.stops[0].d : leg.end;
      const au = authority(a, leg), goal = Math.min(target, au.lim);
      const B = a.brk || brk, vmax = Math.min(speedLimit(a, leg), Math.sqrt(2 * B * Math.max(0, goal - a.d)));
      if (a.v < vmax) a.v = Math.min(vmax, a.v + (a.accCap || acc) * DT); else a.v = Math.max(vmax, a.v - B * 1.5 * DT);
      if (goal - a.d > 0.4 && a.v < 0.3) a.v = 0.3;
      a.d = Math.min(goal, a.d + a.v * DT);
      if (goal - a.d < 0.4 && a.v <= 0.8) {
        a.v = 0;
        if (target - a.d < 6) {                        // at the stop (a few metres short counts: the platform is long)
          a.d = Math.max(a.d, target - 6);
          if (leg.stops && leg.stops.length) {
            const st = leg.stops[0];
            if (leg.skipSet && leg.skipSet.has(st.st) && leg.stops.length > 1) { leg.stops.shift(); return; }
            if (a.manualTo === st.st) a.manualTo = null;
            a.stopAt = st.st; a.at = st.st; a.arrLate = st.arr != null ? S.t - st.arr : null; a.exitClosed = false; if (a.navOut && a.part && st.st >= a.part[0] && st.st <= a.part[1] && !(S.cl && S.navInfo && Object.values(S.navInfo).some(x => x.open === st.st))) a.navOut = false;
            if (leg.plan) { planDwell(a, leg, st); a.dwellUntil = S.t + a.dwBase; }
            else { a.arriveT = S.t; a.stopKey = null; a.dwBase = leg.status !== 'service' ? 1 : Math.abs(st.d - leg.start) < 1 ? 30 : 20; a.dwellUntil = S.t + a.dwBase; }
          } else { a.legs.shift(); if (leg.arrive) { a.at = leg.arrive.at; a.arr = leg.arrive.dir; } }
          a.red = null;
        } else if (au.why) { if (!a.red) a.red = { since: S.t, why: au.why }; a.red.now = au.why; }
      } else if (a.v > 0.5) { a.red = null; a.why = null; }
    }
    function step(t) {
      let guard = 0;
      while (S.t + DT <= t && guard++ < 40000) {
        // events whose time has come (again, after going back in time)
        for (const e of TL.events) if (!e.done && e.t <= S.t + DT) { e.done = true; apply(e); }
        S.t += DT; S.rt.t = S.t; refresh(); atoTick(); if (FX) FX.tick(); if (ZONES.length) zoneTick();
        for (const a of S.agents) {
          const p0 = a.pid, n0 = a.d + half;
          stepAgent(a);
          if (a.v > 0.5 && S.rt.wants && S.rt.wants[a.k]) delete S.rt.wants[a.k];     // it moves: it no longer waits
          if (IL) IL.release(S.il, a.k, a.pid, a.d + half, a.hidden || a.status === 'parked', a.pid === p0 ? n0 : null, a.v);
          if (a.pid === p0 && !a.hidden && a.attached == null && a.d + half > n0) {
            // check: a front that went over a signal must have had its route (counted for the tests)
            for (const c of RT.ahead(a.pid, n0 + 12, a.d + half - n0)) if (c.d > n0 && c.d <= a.d + half) {
              S.rt.passed = (S.rt.passed || 0) + 1;
              if (!RT.held(S.rt, a.k, a.pid, c.d)) { S.rt.viol = (S.rt.viol || 0) + 1; (S.rt.violAt = S.rt.violAt || []).length < 5 && S.rt.violAt.push([a.k, a.pid, c.n, Math.round(S.t), a.status]); }
            }
          }
          if (a.pid === p0 && !a.hidden && a.attached == null && a.d + half > n0) for (const [, nd] of RT.switchesOn(a.pid, n0, a.d + half)) {
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
      const snap = structuredClone({ clLast: S.clLast, strike: S.strike, zones: S.zones, zoneSeq: S.zoneSeq, faults: S.faults, stn: S.stn, t: S.t, il: S.il, rt: S.rt, agents: S.agents, log: S.log, lastDep: S.lastDep, cl: S.cl, parts: S.parts, reopened: S.reopened, usedRuns: [...usedRuns], lastSvc: S.lastSvc || {}, turnOv: S.turnOv, nav: S.nav, navInfo: S.navInfo, navWant: S.navWant, clEff: S.clEff, navHold: NAVHOLD ? [...NAVHOLD] : null, slow: SLOW ? { set: [...SLOW.set], until: SLOW.until, kmh: SLOW.kmh } : null });
      TL.snaps = TL.snaps.filter(x => x.t < S.t); TL.snaps.push(snap);
      if (TL.snaps.length > 220) TL.snaps.splice(1, 1);
    }
    function restore(snap) {
      const c = structuredClone(snap);
      Object.assign(S, { t: c.t, il: c.il, rt: c.rt || RT.fresh(), agents: c.agents, log: c.log, lastDep: c.lastDep || {}, cl: c.cl || null, parts: c.parts || [], reopened: c.reopened != null ? c.reopened : null });
      S.stn = c.stn || {}; S.faults = c.faults || null; S.clLast = c.clLast || null; S.strike = c.strike || null; S.zones = c.zones || []; S.zoneSeq = c.zoneSeq || 0; setZones();
      S.turnOv = c.turnOv || {}; S.nav = c.nav || []; S.navInfo = c.navInfo || {}; S.navWant = c.navWant || {}; NAVHOLD = c.navHold ? new Set(c.navHold) : null; SLOW = c.slow ? { set: new Set(c.slow.set), until: c.slow.until, kmh: c.slow.kmh } : null;
      S.clEff = c.clEff || null;
      if (S.cl) { CLOSED0 = closedPieces(S.cl); CLOSED = S.clEff && (S.clEff.a !== S.cl.a || S.clEff.b !== S.cl.b) ? closedPieces(S.clEff) : CLOSED0; } else { CLOSED = CLOSED0 = null; }
      usedRuns.clear(); (c.usedRuns || []).forEach(x => usedRuns.add(x)); atoLast = -Infinity; S.lastSvc = c.lastSvc || {};
      TL.events.forEach(e => { e.done = e.t <= S.t; });
    }
    let lastResult = null;
    function apply(e) {
      if (e.kind === 'order') lastResult = order(e.k, e.what, e.arg);
      else if (e.kind === 'close') { close(e.cl); S.clLast = { label: e.label, t0: S.t, cl: e.cl }; lastResult = true; }
      else if (e.kind === 'reopen') { reopen(S.t); lastResult = true; }
      else if (e.kind === 'normal') { S.clLast = null; S.cl = null; S.parts = []; S.reopened = null; CLOSED = CLOSED0 = null; S.turnOv = {}; S.nav = []; S.navInfo = {}; S.navWant = {}; NAVHOLD = null; SLOW = null; start(S.t, o.initAt(S.t)); }
      else if (e.kind === 'pc') lastResult = RT.authorize(S.rt, e.key);         // the PC authorises a signal or a movement
      else if (e.kind === 'pccmd') lastResult = pcCmd(e);                      // the PC on signals and switches
      else if (e.kind === 'fault') lastResult = FX ? FX.event(e) : null;       // failures: a new one, the PC's answer, random on/off
      else if (e.kind === 'station') {                                           // the PC and a station
        const x = S.stn[e.st] = Object.assign({}, S.stn[e.st]);
        if (e.what === 'close') x.closed = true; else if (e.what === 'open') delete x.closed; else if (e.what === 'msg') { if (e.text) x.msg = e.text; else delete x.msg; }
        if (!Object.keys(x).length) delete S.stn[e.st];
        lastResult = true;
      }
      else if (e.kind === 'regola') lastResult = regola(e);                   // the regolatore: a train out of the service, a reserve out
      else if (e.kind === 'il' && IL) { if (e.what === 'clear') lastResult = IL.clear(S.il, e.si); else if (e.what === 'unclear') { S.il.pass[e.si] = 0; lastResult = true; } else if (e.what === 'auto') { S.il.auto = !!e.on; lastResult = true; } }
    }
    // the regolatore (fase E, the page decides): 'home' a train ends its run, lets the passengers off and goes in (turning at a
    // terminus: when it can, a.wdWant); 'keep' a train still in its place in the depot stays there; 'insert' a reserve train
    // starts its new day (its plan was rewritten by the page: a run out of the depot, then the runs of a tabella) from its place
    function regola(e) {
      const a = S.agents[e.k]; if (!a) return false;
      if (e.what === 'home') { if (a.mode !== 'plan') return false; a.wdWant = !goHome(a, true); return true; }
      if (e.what === 'keep') { if (a.hidden || a.mode !== 'plan' || a.legs.some(l => !l.kind && l.status === 'service')) return false; a.mode = 'static'; a.status = 'parked'; a.v = 0; a.kept = true; return true; }
      if (e.what === 'insert') { a.pid = e.pid; a.d = e.d; a.v = 0; a.mode = 'plan'; a.si = -1; a.legs = []; a.wait = 0; a.hidden = false; a.status = 'parked'; delete S.rt.routes[a.k]; return true; }
      return false;
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

    // ---------- the PC on signals and switches (Pannello PC): null or the reason it cannot ----------
    function pcCmd(e) {
      const occ = ei => edgeMap.get(ei);
      if (e.what === 'red') { RT.setRed(S.rt, e.n, !!e.on); return null; }
      if (e.what === 'cancel') return RT.cancelAt(S.rt, e.n, k => S.agents[k] ? { pid: S.agents[k].pid, nose: S.agents[k].d + half } : null) ? null : { nothing: true };
      if (e.what === 'form') return RT.formPc(S.rt, e.id, occ);
      if (e.what === 'sw') return RT.setSwitch(S.rt, e.nd, e.pos, occ);
      if (e.what === 'lock') { RT.lockSwitch(S.rt, e.nd, e.pos == null ? null : e.pos); return null; }
      return { unknown: e.what };
    }
    // ---------- marcia illegale at San Donato (Giovanni 3 Nov 2026) ----------
    // in an interruption from San Donato, a train standing there (at a platform, or held in a tail) can be sent by the DCT
    // into a tail or into the depot in marcia illegale: on the DCT's radio order, after a change of cab when it faces the
    // other way, at 30 km/h (ops illegal_kmh, the speed of a train the wrong way); no tail or way excluded. The ways are
    // paths of the build: those that end in a San Donato tail, those into the depot (they start at the arrival platform),
    // and those out of a tail to that platform (change of cab there, then into the depot). Up to three moves.
    const DEPIN = (o.depotIn || []).filter(x => pathEdges[x[0]]);                 // [[pid, the train's place at the platform]]
    const SDSIG = o.sdTailSig || {};                                               // tail track piece -> number of its signal
    const pidsAll = Object.keys(pathEdges).map(Number);
    const TAILP = SDT.size ? pidsAll.filter(p => { const e = pathEdges[p].e; return e.length && SDT.has(e[e.length - 1][0]); }) : [];
    const CONNP = SDT.size && DEPIN.length ? pidsAll.filter(p => { const e = pathEdges[p].e; return e.length > 1 && SDT.has(e[0][0]) && mapTo(DEPIN[0][0], DEPIN[0][1], p) != null; }) : [];
    const pEnd = p => { const e = pathEdges[p].e; return e[e.length - 1][3]; };
    const firstYard = p => { const e = pathEdges[p].e.find(([ei]) => netEdges[ei].cat === 'yard'); return e ? e[2] : null; };
    // the moves of each kind from (pid, d): [{ pid, start, end, rev, goal }] (goal: tail edge, 'dep', or null for the platform)
    function illHops(pid, d) {
      const out = [], fits = p => mapTo(pid, d - half + 1, p) != null && mapTo(pid, d + half - 1, p) != null;
      const same = (p, d2) => { const x = mapTo(pid, d + 3, p); if (x != null) return x > d2; const y = mapTo(pid, d - 3, p); return y == null || y < d2; };
      const add = (p, end, goal) => { const d2 = mapTo(pid, d, p); if (d2 == null || end == null || end < d2 + 20 || !fits(p)) return; out.push({ pid: p, start: d2, end, rev: !same(p, d2), goal }); };
      for (const p of TAILP) add(p, pEnd(p) - half - 1, pathEdges[p].e[pathEdges[p].e.length - 1][0]);
      for (const [p] of DEPIN) { const y = firstYard(p); add(p, y != null ? y - half - 5 : pEnd(p) - half - 5, 'dep'); }
      for (const p of CONNP) add(p, mapTo(DEPIN[0][0], DEPIN[0][1], p), null);
      return out;
    }
    // the ways: one per goal (each tail, the depot), the shortest
    function illWays(a) {
      if (!S.cl || S.cl.a !== 0 || !SDT.size || a.hidden || a.v > 0.05) return [];
      const atSD = a.mode === 'inside' && a.status === 'stopped' && a.inside && a.inside.stops[a.inside.q] && a.inside.stops[a.inside.q].st === 0 && Math.abs(a.inside.stops[a.inside.q].d - a.d) < 8;
      const own = new Set(footprint(a).map(f => f[0])), inTail = a.mode === 'static' && [...own].some(e => SDT.has(e));
      if (!atSD && !a.sdTailHeld && !inTail) return [];
      const best = {};
      let front = [{ pid: a.pid, d: a.d, legs: [], len: 0 }];
      for (let depth = 0; depth < 3 && front.length; depth++) {
        const next = new Map();
        for (const s of front) for (const h of illHops(s.pid, s.d)) {
          const legs = s.legs.concat([h]), len = s.len + h.end - h.start;
          if (h.goal != null && !own.has(h.goal)) { const g = String(h.goal); if (!best[g] || len < best[g].len) best[g] = { legs, len, goal: h.goal }; }
          if (h.goal === 'dep') continue;
          const kk = h.pid + ':' + Math.round(h.end); if (!next.has(kk) || next.get(kk).len > len) next.set(kk, { pid: h.pid, d: h.end, legs, len });
        }
        front = [...next.values()];
      }
      return Object.values(best).sort((x, y) => (x.goal === 'dep') - (y.goal === 'dep') || x.len - y.len).map(w => ({
        key: 'ill:' + w.goal, ill: true, cab: w.legs[0].rev, hops: w.legs, goal: w.goal,
        to: w.goal === 'dep' ? 'in deposito' : 'in tronchetto' + (SDSIG[w.goal] != null ? ' (segnale ' + SDSIG[w.goal] + ')' : ''),
        label: (w.goal === 'dep' ? 'In deposito' : 'In tronchetto' + (SDSIG[w.goal] != null ? ' (segnale ' + SDSIG[w.goal] + ')' : '')) + ' in marcia illegale' + (w.legs[0].rev ? ', dopo il cambio banco' : '') }));
    }
    function illOptions(a) {
      return illWays(a).map(w => { const bl = new Set(); for (const h of w.hops) for (const x of trainsOn(h.pid, h.start, h.end, a.k)) bl.add(x);
        // (a tail: one train; another already sent there by the DCT counts as in the way)
        if (w.goal !== 'dep') for (const b of S.agents) if (b !== a && b.illMove && b.illGoal === w.goal) bl.add(b.k);
        return { key: w.key, ill: true, cab: w.cab, to: w.to, label: w.label, blocked: [...bl] }; });
    }
    function illPlan(a, key) {
      const w = illWays(a).find(x => x.key === key); if (!w) return null;
      const legs = w.hops.map((h, i) => ({ pid: h.pid, status: 'empty', stops: [], start: h.start, end: h.end, rev: h.rev, ill: true }));
      legs.push(w.goal === 'dep' ? { kind: 'depot' } : { kind: 'sdtail' });
      return { legs, after: () => { a.mode = 'moving'; a.illMove = true; a.illGoal = w.goal; a.inside = null; a.sdTailHeld = false; a.kept = false; } };
    }
    // ---------- the PC's instructions to a train standing in a closed stretch (Pannello PC) ----------
    // ahead on its track to a station (to the first open one at most: there it joins the service), back the wrong way
    // to a station (likewise), on to San Donato and into the depot, on to Comasina and into a tail; at San Donato in an
    // interruption from there: into a tail or the depot in marcia illegale (above)
    function instrOptions(k) {
      const a = S.agents[k]; if (!a) return [];
      const ill = illOptions(a);
      if (a.mode !== 'inside' || a.status !== 'stopped' || !a.inside) return ill;
      const out0 = instrOptions0(a, k);
      return ill.some(x => x.key === 'ill:dep') ? out0.filter(x => x.key !== 'dep').concat(ill) : out0.concat(ill);
    }
    function instrOptions0(a, k) {
      const I = a.inside, dir = I.dir, out = [], rev = REVP[dir];
      for (let i = I.q + 1; i < I.stops.length; i++) { const Y = I.stops[i], P = partOf(Y.st);
        out.push({ key: 'a' + i, st: Y.st, open: !!P, label: 'Avanti fino a ' + G.names[Y.st] + (P ? ', poi in servizio' : '') }); if (P) break; }
      if (rev != null && mapTo(a.pid, a.d, rev) != null) for (let i = I.q - 1; i >= 0; i--) { const Y = I.stops[i], P = partOf(Y.st);
        if (mapTo(I.pid, Y.d, rev) == null) break;
        out.push({ key: 'b' + i, st: Y.st, open: !!P, back: true, label: 'Indietro contromano fino a ' + G.names[Y.st] + (P ? ', poi in servizio' : '') }); if (P) break; }
      if (dir === 'S' && I.end != null) out.push({ key: 'dep', label: 'Avanti fino a San Donato e in deposito' });
      if (dir === 'N' && I.stops[I.stops.length - 1].st === last && !out.some(x => !x.back && x.open)) out.push({ key: 'tail', label: 'Avanti fino a Comasina e in tronchetto' });
      // the trains in the way now (the train would wait behind them, or face them)
      for (const x of out) { const p = instrPlan(a, x.key), l = p && p.legs[0]; x.blocked = l ? trainsOn(l.pid, l.start, l.end, k) : []; }
      return out;
    }
    // the moves of an instruction (not applied): legs, and what changes in the train when it is given
    function instrPlan(a, key) {
      if (String(key).startsWith('ill:')) return illPlan(a, key);
      const I = a.inside, dir = I.dir;
      const onto = pid => { const d = pid === a.pid ? a.d : mapTo(a.pid, a.d, pid); return d; };
      if (key[0] === 'a') {
        const i = +key.slice(1), Y = I.stops[i], P = partOf(Y.st), d0 = onto(I.pid); if (d0 == null || !Y) return null;
        const legs = [{ pid: I.pid, status: 'empty', stops: [], end: Y.d, start: d0, rev: a.pid !== I.pid, arrive: { at: Y.st, dir } }];
        let after;
        // (out of the closed stretch: the signals let it out, exitClosed, until its first station)
        if (P && I.m != null) { legs.push(...legsFromPlan(I.m, I.j, P, Y.d)); after = () => { a.mode = 'shuttle'; a.part = P; a.inside = null; a.exitClosed = true; }; }
        else if (P) { legs.push({ kind: 'boundary' }); after = () => { a.mode = 'shuttle'; a.part = P; a.at = Y.st; a.arr = dir; a.inside = null; a.exitClosed = true; }; }
        else { legs.push({ kind: 'stopped' }); after = () => { I.q = i; }; }
        return { legs, after };
      }
      if (key[0] === 'b') {
        const i = +key.slice(1), Y = I.stops[i], rev = REVP[dir], d0 = onto(rev), d1 = Y && mapTo(I.pid, Y.d, rev); if (d0 == null || d1 == null) return null;
        const P = partOf(Y.st), legs = [{ pid: rev, status: 'empty', stops: [], end: d1, start: d0, rev: a.pid !== rev, arrive: { at: Y.st, dir: opp(dir) } }];
        legs.push(P ? { kind: 'join', st: Y.st, dir } : { kind: 'stopped' });
        return { legs, after: () => { if (!P) I.q = i; } };
      }
      if (key === 'dep') { const d0 = onto(I.pid); if (d0 == null) return null;
        return { legs: [{ pid: I.pid, status: 'empty', stops: [], end: I.end, start: d0, rev: a.pid !== I.pid }, { kind: 'depot' }], after: () => {} }; }
      if (key === 'tail') { const d0 = onto(I.pid), Y = I.stops[I.stops.length - 1]; if (d0 == null) return null;
        return { legs: [{ pid: I.pid, status: 'empty', stops: [], end: Y.d, start: d0, rev: a.pid !== I.pid }, { kind: 'tailpark' }], after: () => {} }; }
      return null;
    }
    // the trains standing (or running) on a stretch of a path now: the PC sees them on the panel before sending a train
    function trainsOn(pid, d0, d1, exceptK) {
      const out = new Set(), { pieces } = RT.span(pid, Math.min(d0, d1) + half + 1, Math.max(d0, d1) + half + 3);
      for (const [ei, l0, l1] of pieces) for (const [k2, m0, m1] of edgeMap.get(ei) || []) if (k2 !== exceptK && l0 < m1 && m0 < l1) out.add(k2);
      return [...out];
    }
    // for the map: where the instructed move goes, [[pid, from, to]]
    function instrPreview(k, key) {
      const a = S.agents[k]; if (!a || (!a.inside && !String(key).startsWith('ill:'))) return null;
      const p = instrPlan(a, key); if (!p) return null;
      const out = []; for (const l of p.legs) { if (l.kind) break; out.push([l.pid, l.start, l.end]); }
      return out;
    }
    function instruct(a, key) {
      if (!instrOptions(a.k).some(x => x.key === key)) return false;
      const p = instrPlan(a, key); if (!p) return false;
      // the PC gives the signals it works along the move (the train goes where the PC sent it)
      for (const L0 of p.legs) { if (L0.kind) break; for (const c of RT.ahead(L0.pid, Math.min(L0.start, L0.end) - 5, Math.abs(L0.end - L0.start) + 200)) if (RT.isPcSignal(c.n)) RT.authorize(S.rt, 'n:' + c.n); if (!L0.ill) break; }
      a.legs = p.legs; p.after(); a.status = 'empty'; a.stopAt = null; a.wait = 0; a.red = null;
      S.log.push({ t: S.t, k: a.k, instr: key });
      return true;
    }
    // ---------- radio orders ----------
    function order(k, kind, arg) {
      const a = S.agents[k]; if (!a) return false;
      // PC speed limit: km/h, until a new order or until the train leaves station `to`
      if (kind === 'speed') { a.vlim = arg && arg.kmh ? arg.kmh / 3.6 : null; a.vlimTo = arg && arg.to != null ? arg.to : null; return true; }
      if (kind === 'speedoff') { a.vlim = null; a.vlimTo = null; return true; }
      // the PC gives the train another departure (key m:j of a run not taken by another train)
      if (kind === 'dep') {
        const r = nextRunOf(a), dl = departuresFor(k); if (!r || !dl) return false;
        const [m, j] = String(arg && arg.key || '').split(':').map(Number), c = freeRuns(dl.st, dl.dir, -Infinity, Infinity, k).find(x => x.m === m && x.j === j);
        if (!c) return false;
        takeRun(r, c); r.hard = true; if (S.reopened) { a.tabM = c.m; a.tabJ = c.j; } return c.tx;
      }
      if (kind === 'instr') return instruct(a, arg && arg.key);
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
          a.mode = 'shuttle'; a.part = P; a.legs.push(...legsFromPlan(I.m, I.j, P, next.d)); a.inside = null; a.exitClosed = true;
        } else if (P) { a.mode = 'shuttle'; a.part = P; a.at = next.st; a.arr = I.dir; a.inside = null; a.exitClosed = true; a.legs.push({ kind: 'boundary' }); }
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
      return { tabM: a.mode !== 'plan' ? a.tabM : null, inside: a.inside, to: leg && leg.arrive ? leg.arrive.at : null, pid: a.pid, d: a.d, v: a.v, status: a.status, mode: a.mode, hidden: !!a.hidden, red: a.red, late: a.late, stopAt: a.stopAt, why: a.why, trip: a.trip,
               seg: a.mode === 'plan' ? a.si : -1, waiting: S.t < a.wait, pcHold: !!a.pcHold, vlim: a.vlim ? Math.round(a.vlim * 3.6) : null, vlimTo: a.vlimTo,
               stops: leg && leg.stops ? leg.stops.map(z => z.st) : [], dir: leg ? leg.dir : null, timed: !!(leg && leg.timed), at: a.at, vmaxHere: a.hidden ? null : Math.round(limitHere(a) * 3.6), ato: a.ato != null ? Math.round(a.ato * 100) : null, atoWarn: !!a.atoWarn, manual: byHand(a), faults: FX ? FX.list().filter(f => f.k === k) : [] };
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
    // ---------- from one service day to the next (Giovanni: the line goes on, 02:59 -> 03:30 of the next day) ----------
    // what stays: the failures of the line (signals, switches, sections, power, people, the DCT's emergencies), the zones,
    // the stations closed, the closure in force; times moved by dt (the next day starts again from 0). The failures of the
    // trains stay behind: the night in the depot fixes them.
    const TIMES = ['t0', 'until', 'holdAt', 'holdUntil', 'evacUntil', 'next', 'techUntil', 'nextWake', 'done'];
    function carryOut() {
      const f = S.faults || {}, rt = S.rt || {};
      return JSON.parse(JSON.stringify({ t: S.t, faults: { on: !!f.on, rng: f.rng, seq: f.seq || 0, list: (f.list || []).filter(x => !x.done && x.k == null && x.kind !== 'sciopero') },
        zones: S.zones || [], zoneSeq: S.zoneSeq || 0, stn: S.stn || {}, clLast: S.cl ? S.clLast : null,
        rt: { sigFail: rt.sigFail, ghost: rt.ghost, swFail: rt.swFail, swLock: rt.swLock, redFix: rt.redFix } }));
    }
    function carryIn(c, dt) {
      if (!c) return;
      const sh = x => { for (const k of TIMES) if (typeof x[k] === 'number') x[k] += dt; if (x.call && typeof x.call.t === 'number') x.call.t += dt; return x; };
      const f = S.faults || (S.faults = { on: false, rng: 20261101, seq: 0, list: [], feed: [], roll: 0 });
      f.on = c.faults.on; if (c.faults.rng != null) f.rng = c.faults.rng; f.seq = Math.max(f.seq || 0, c.faults.seq); f.list = c.faults.list.map(sh);
      S.zones = c.zones; S.zoneSeq = c.zoneSeq; setZones(); S.stn = c.stn || {};
      for (const [k, v] of Object.entries(c.rt || {})) if (v) S.rt[k] = v;
      if (c.clLast && c.clLast.cl) { close(c.clLast.cl); S.clLast = Object.assign({}, c.clLast, { t0: S.t }); }
      snapshot();
    }
    return { S, TL, IL, RT, FX, carryOut, carryIn, zones: () => S.zones || [], zonesOf: a => ZONES.filter(Z => footprint(a).some(f => inZ(Z, f[0], f[1], f[2]) != null)).map(Z => Z.z.kind), departuresFor, instrOptions, instrPreview, il: () => S.il, rt: () => S.rt, start, step, seek, event, order, replan, state, snapshot, mapTo, nextOf, close, reopen, closed: () => CLOSED, closed0: () => CLOSED0, closureBlocked, agents: () => S.agents, occ: ei => edgeMap.get(ei),
      // the regolatore (fase E): a train out of the service at the end of its run, one kept in the depot, the runs taken in the hybrid timetable
      runs: () => [...usedRuns] };
  }

  const api = { create, DT, HEADWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLAgents = api;
})(typeof window !== 'undefined' ? window : globalThis);
