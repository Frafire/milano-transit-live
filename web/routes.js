// Route interlocking (itinerari): one model for the whole line, the system that replaces the block sections.
//
// Every signal is the start of a route: the stretch of the train's own path from the signal up to the next signal
// facing the same way (or to the end of the path: a tail, the end of a platform where the train reverses). A train
// that wants to pass a signal asks for the route in front of it; the route is set (the signal shows via libera, for
// that train only) when nothing on it is taken:
//   - no other train on any of its track pieces;
//   - no piece locked by another train's route;
//   - no switch (node) on it locked by another route or touched by another train (fouling, diamonds, scissors).
// The pieces are released behind the tail of the train as it goes (sequential release); everything is released when
// the train changes path (it reverses, it goes into the depot) or is switched off.
// The geometry of the switches is already in the paths (built from the track): a path never takes a U-turn on a switch.
// It never moves a train; it only answers. The state is a plain object kept by the caller (saved, going back in time).
//
// Giovanni's rules (Regole_interlocking_M3.xlsx, through the build):
//   - every route over a switch is a movement of the table of the itineraries (with its ID); a movement whose rules
//     say it is not for the normal service (a breakdown, a closure, single track...) is set only when the PC has
//     authorised it; the same for the signals worked by the PC ("manuale con controllo sezioni");
//   - a switch that has to change position takes the time of the blade (Tempi: ago dello scambio), then the signal
//     opens after its own delay (Tempi: ritardo di apertura del segnale); a route is ready only then;
//   - a siding with a capacity (a tail, the tunnel to the M2) takes no more trains than that;
//   - a movement with other ways (San Donato) can be given on another way when the usual one is taken (the caller
//     moves the train to the twin path, o.variants).
(function (root) {
  function create(o) {
    // o: { sigall: { pid: [[d, n, flags]] }, pathEdges: [{ e: [[edge, dir, from, to]] }], netEdges: [{ a, b, len }],
    //      itineraries: [{ id, start, ways, when }], times: { blade, signal } (s), capacity: { edge: trains },
    //      pcSignals: [n], normal: [situations of the normal service] }
    const SA = o.sigall || {}, PE = o.pathEdges, NE = o.netEdges;
    const BLADE = (o.times && o.times.blade) || 0, SIGNAL = (o.times && o.times.signal) || 0;
    const CAP = o.capacity || {}, PC_SIG = new Set(o.pcSignals || []);
    const NORMAL = new Set(o.normal || ['servizio normale', 'sempre', 'mattina', 'sera', 'ritardo', 'manovra deposito']);
    const WHEN = {}, PRIO = {}, WAYS = {}, P = { alta: 3, media: 2, bassa: 1 };
    for (const it of o.itineraries || []) { WHEN[it.id] = it.when; PRIO[it.id] = P[it.prio] || 0; WAYS[it.id] = it.ways; }

    // routes[k] = [{ pid, d0, d1, n, pieces: [[edge, l0, l1, pEnd]], nodes: [[node, p]], id, way, ready }]
    // allow: situations in force now besides the normal service (a closure: its movements need no authorisation)
    // sw[node]: the position of a switch (the two pieces it joins); pc[key]: authorisations given by the PC
    function fresh() { return { routes: {}, sw: {}, pc: {}, t: 0 }; }

    // signals ahead of a train on its path (front at nose): [{ d, n, fl }], nearest first
    function ahead(pid, nose, look) {
      const out = [], sp = SA[pid]; if (!sp) return out;
      for (const [d, n, fl] of sp) { if (d > nose + look) break; if (d > nose - 12) out.push({ d, n, fl }); }
      return out;
    }
    function nextSignal(pid, d) {
      const sp = SA[pid]; if (sp) for (const x of sp) if (x[0] > d + 5) return x[0];
      const pe = PE[pid]; return pe && pe.e.length ? pe.e[pe.e.length - 1][3] : d;
    }
    // the track pieces of path pid between d0 and d1 (metres along each piece from its node a) and the nodes passed
    function span(pid, d0, d1) {
      const pieces = [], nodes = [], pe = PE[pid]; if (!pe) return { pieces, nodes };
      for (const [ei, dir, x0, x1] of pe.e) {
        if (x1 <= d0 || x0 >= d1) continue;
        const k = (NE[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(d0, x0), q = Math.min(d1, x1);
        pieces.push([ei, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k, q, dir]);
        if (x1 <= d1) nodes.push([dir > 0 ? NE[ei].b : NE[ei].a, x1]);      // the node at the end of this piece
      }
      return { pieces, nodes };
    }
    const overlap = (a0, a1, b0, b1) => a0 < b1 - 0.5 && b0 < a1 - 0.5;
    // is the route free for train k? occ(ei) -> [[k, l0, l1]] other trains on that piece now
    function free(st, k, pieces, nodes, occ, skipPc) {
      const nodeSet = new Set(nodes.map(x => x[0]));
      for (const [ei, l0, l1] of pieces) for (const [k2, m0, m1] of occ(ei) || []) if (k2 !== k && overlap(l0, l1, m0, m1)) return { train: k2 };
      // a train standing on a switch (touching the node from any side)
      for (const nd of nodeSet) for (const ei of nodeEdges(nd)) for (const [k2, m0, m1] of occ(ei) || []) {
        if (k2 === k) continue;
        const L = NE[ei].len, atA = NE[ei].a === nd;
        if (atA ? m0 < 1 : m1 > L - 1) return { train: k2, node: nd };
      }
      // the itineraries prepared by the PC (formed by hand, waiting for their train)
      for (const [n2, r] of Object.entries(st.pcRoutes || {})) {
        if (skipPc != null && +n2 === skipPc) continue;
        for (const [ei, m0, m1] of r.pieces) for (const [e2, l0, l1] of pieces) if (e2 === ei && overlap(l0, l1, m0, m1)) return { pcRoute: +n2, id: r.id };
        for (const nd of r.nodes) if (nodeSet.has(nd)) return { pcRoute: +n2, id: r.id, node: nd };
      }
      for (const [k2, rs] of Object.entries(st.routes)) {
        if (+k2 === k) continue;
        for (const r of rs) {
          for (const [ei, m0, m1] of r.pieces) for (const [e2, l0, l1] of pieces) if (e2 === ei && overlap(l0, l1, m0, m1)) return { route: +k2, n: r.n };
          for (const [nd] of r.nodes) if (nodeSet.has(nd)) return { route: +k2, n: r.n, node: nd };
        }
      }
      return null;
    }
    const NODE_EDGES = new Map();
    NE.forEach((e, i) => { for (const nd of [e.a, e.b]) { if (!NODE_EDGES.has(nd)) NODE_EDGES.set(nd, []); NODE_EDGES.get(nd).push(i); } });
    const nodeEdges = nd => NODE_EDGES.get(nd) || [];

    // the table of the itineraries (o.itineraries, from the build): which movement of the table a route is.
    // A route runs from a signal to the next one on the train's path; the movement of the table from its start signal
    // to its end signal: the same track pieces, in the same order, one way or the other (the usual one or another)
    const BY_START = new Map();
    for (const it of o.itineraries || []) { if (it.start == null) continue; if (!BY_START.has(it.start)) BY_START.set(it.start, []); BY_START.get(it.start).push(it); }
    const isSwitch = nd => nodeEdges(nd).length >= 3;
    // a switch of the depot (all its track pieces in the depot): the depot moves are not in the table (depot rules)
    const depotSwitch = nd => nodeEdges(nd).every(ei => NE[ei].cat === 'yard');
    // the tail positions (Comasina: 3 of 110 m, 1 the outermost, next to the switch): the movements of the table into
    // and out of a tail differ only by the position, so it is read from the metres on the dead-end piece
    const SLOT = (o.tailSlots && o.tailSlots.slot_m) || 110, NPOS = (o.tailSlots && o.tailSlots.positions) || 3, HALF = o.half || 52.5;
    const fromWall = (ei, x) => { const e = NE[ei]; return nodeEdges(e.a).length === 1 ? x : nodeEdges(e.b).length === 1 ? (e.len || 0) - x : null; };
    const slotOf = c => c == null || c > SLOT * NPOS + 20 ? null : Math.max(1, Math.min(NPOS, NPOS - Math.floor(c / SLOT)));
    const posOf = txt => { const m = /posizione (\d)/.exec(txt || ''); return m ? +m[1] : null; };
    function identify(n, pieces) {
      const R = []; for (const [ei] of pieces) if (R[R.length - 1] !== ei) R.push(ei);
      let best = null;
      // out of a tail position (a route from where the train stands: its nose, the centre half a train towards the
      // wall) and into one (the route ends just past the nose: the centre half a train back)
      const f = pieces[0], l = pieces[pieces.length - 1];
      const w0 = f && n == null ? fromWall(f[0], f[4] > 0 ? f[1] : f[2]) : null, w1 = l ? fromWall(l[0], l[4] > 0 ? l[2] : l[1]) : null;
      const startPos = w0 != null ? slotOf(w0 - HALF) : null, endPos = w1 != null ? slotOf(w1 + HALF + 3) : null;
      for (const it of n != null ? BY_START.get(n) || [] : o.itineraries || []) it.ways.forEach((W, wi) => {
        // (a signal at the very end of a track piece: the table starts on that piece, the route on the next one)
        const o0 = n == null ? W.indexOf(R[0]) : W[0] === R[0] ? 0 : W[1] === R[0] ? 1 : -1; if (o0 < 0) return;
        const m = Math.min(W.length - o0, R.length); for (let i = 0; i < m; i++) if (W[i + o0] !== R[i]) return;
        // in a tail: the movement of the right position
        const pf = posOf(it.frm), pt = posOf(it.to);
        if (pf != null && startPos != null && pf !== startPos) return;
        if (pt != null && endPos != null && pt !== endPos) return;
        // the longest match; the same length: the usual way first
        const score = m * 10 - wi;
        if (!best || score > best.score) best = { score, id: it.id, way: wi };
      });
      return best;
    }
    // the switches of the line on a path between two points (not the depot ones): [[d, node]]
    const SW = {};
    function switchesOn(pid, a, b) {
      if (!SW[pid]) { SW[pid] = []; const pe = PE[pid]; if (pe) for (const [ei, dir, x0, x1] of pe.e) { const nd = dir > 0 ? NE[ei].b : NE[ei].a; if (isSwitch(nd) && !depotSwitch(nd)) SW[pid].push([x1, nd]); } }
      return SW[pid].filter(([x]) => x > a && x <= b);
    }
    // does train k hold a route over this switch? (check for the tests: no train goes over a switch without a route)
    const heldNode = (st, k, nd) => (st.routes[k] || []).some(r => r.nodes.some(x => x[0] === nd));
    function held(st, k, pid, d) { return (st.routes[k] || []).some(r => r.pid === pid && Math.abs(r.d0 - d) < 1); }
    // train k asks for the route that starts at the signal at d on its path: true if it is set (now or before)
    // a siding with a capacity: how many trains are in it or on their way into it (routes ending there)
    function full(st, k, pieces, occ) {
      for (const [ei] of pieces) {
        const cap = CAP[ei]; if (cap == null) continue;
        const who = new Set((occ(ei) || []).map(x => x[0]).filter(x => x !== k));
        for (const [k2, rs] of Object.entries(st.routes)) if (+k2 !== k && rs.some(r => r.pieces.some(x => x[0] === ei))) who.add(+k2);
        if (who.size >= cap) return { full: ei, trains: who.size };
      }
      return null;
    }
    // the PC authorises a signal ('n:13') or a movement of the table ('id:SD-10') for the next train
    function authorize(st, key) { st.pc[key] = (st.pc[key] || 0) + 1; return true; }
    // train k asks for the route that starts at the signal at d on its path: true if it is set (now or before)
    // (upTo: the train stops before the next signal, at the end of its move: the route ends there, a tail position)
    // dry: only tell whether it would be set now (nothing changes)
    function request(st, k, pid, d, n, occ, blocked, upTo, dry) {
      if (held(st, k, pid, d)) return true;
      const d1 = Math.min(nextSignal(pid, d), upTo != null && upTo > d + 1 ? upTo : Infinity), { pieces, nodes } = span(pid, d, d1);
      let it = BY_START.size ? identify(n, pieces) : null;
      // the rest of a movement this train is already making (a signal half way along it, as #A363 at Sondrio inside
      // SON-4): the same movement, not the one that starts at that signal
      if (BY_START.size && (!it || (WHEN[it.id] && !NORMAL.has(WHEN[it.id]))) && nodes.some(([nd]) => isSwitch(nd) && !depotSwitch(nd))) {
        const R = []; for (const [ei] of pieces) if (R[R.length - 1] !== ei) R.push(ei);
        for (const r0 of st.routes[k] || []) {
          const W = r0.id && WAYS[r0.id] && WAYS[r0.id][r0.way || 0]; if (!W || r0.id === (it && it.id)) continue;
          const i0 = W.indexOf(R[0]); if (i0 < 0) continue;
          let okW = true; for (let i = 0; i < R.length && i0 + i < W.length; i++) if (W[i0 + i] !== R[i]) { okW = false; break; }
          if (okW && i0 > 0 && i0 + R.length <= W.length + 1) { it = { id: r0.id, way: r0.way || 0, cont: true }; break; }
        }
      }
      // the PC's signals and the movements that are not for the normal service: only with the PC's authorisation
      const needPc = (n != null && PC_SIG.has(n) ? 'n:' + n : null) || (it && WHEN[it.id] && !NORMAL.has(WHEN[it.id]) && !(st.allow || []).includes(WHEN[it.id]) ? 'id:' + it.id : null);
      if (needPc && !(st.pc[needPc] > 0)) { if (!dry) st.lastNo = { pc: needPc }; else st.dryNo = { pc: needPc }; return false; }
      // precedence (Giovanni's priorities, Itinerari: alta / media / bassa): a train waiting for a movement of higher
      // priority that needs the same pieces or switches goes first; this one waits for it
      const prio = it ? PRIO[it.id] || 0 : 0;
      st.wants = st.wants || {};
      const nodeSet = new Set(nodes.map(x => x[0]));
      let why = null;
      for (const [k2, w] of Object.entries(st.wants)) {
        // (only when that movement could be set now, but for this one: else it would wait for nothing, or two
        // trains would wait for each other)
        // (a train that waits a long time for the same thing goes first too, at the same priority: no train waits for ever)
        // (during a closure, after 3 minutes also at a lower priority: the navetta, the turns of the limited service)
        const mine = st.wants[k], ref = mine ? mine.since : (st.t || 0), cl = st.allow && st.allow.length;
        const older = (w.prio === prio && w.since + 90 < ref) || (cl && w.prio < prio && w.since + 180 < ref);
        if (+k2 === k || (st.t || 0) - w.t > 150 || w.by === k) continue;
        // a train that has waited 3 minutes during a closure: no other train goes on its way any more, but the ones
        // already on it (they clear it); after 15 minutes, as before (nothing waits for ever for it)
        const waited = (st.t || 0) - w.since, starving = cl && waited > 180 && waited < 900;
        if ((w.prio <= prio && !older) && !starving) continue;
        if (!(w.nodes.some(nd => nodeSet.has(nd)) || w.pieces.some(([e, m0, m1]) => pieces.some(([e2, l0, l1]) => e2 === e && overlap(l0, l1, m0, m1))))) continue;
        if (starving && !w.pieces.some(([e]) => (occ(e) || []).some(z => z[0] === k))) { why = { yield: +k2, id: w.id, starving: true }; break; }
        if (w.prio <= prio && !older) continue;
        if (free(st, +k2, w.pieces, w.nodes.map(nd => [nd, 0]), occ)) continue;
        why = { yield: +k2, id: w.id }; break;
      }
      // the PC: a signal held at red; a switch locked in the other position; an itinerary it prepared by hand for this
      // movement (taken by the train: it is not a conflict)
      const mine = n != null && st.pcRoutes && st.pcRoutes[n] && it && st.pcRoutes[n].id === it.id ? n : null;
      if (!why && n != null && st.redFix && st.redFix[n]) why = { redFix: n };
      // failures (web/faults.js, fase D2): a signal that stays red, a section that shows occupied with no train on it,
      // a switch that does not go into position (or worked by hand: only with the PC's authorisation). The PC lets one
      // train by in marcia a vista (st.avista[k] = n): it passes this signal, at walking pace up to the next one
      const perm = n != null && st.avista && st.avista[k] === n;
      if (!why && n != null && st.sigFail && st.sigFail[n] && !perm) why = { sigFail: n };
      if (!why && st.ghost && !perm) for (const [ei] of pieces) if (st.ghost[ei]) { why = { ghost: ei, n }; break; }
      if (!why && st.swFail) for (let i = 0; i < nodes.length; i++) { const nd = nodes[i][0], f = st.swFail[nd]; if (f == null) continue;
        if (f === true || i + 1 >= pieces.length) { why = { swFail: nd }; break; }
        const pos = Math.min(pieces[i][0], pieces[i + 1][0]) + '-' + Math.max(pieces[i][0], pieces[i + 1][0]);
        if (pos !== f) { why = { swFail: nd, pos: f }; break; }
        if (!perm) { why = { swHand: nd }; break; } }
      if (!why && st.swLock) for (let i = 0; i + 1 < pieces.length && i < nodes.length; i++) { const nd = nodes[i][0], lk = st.swLock[nd];
        if (lk != null && isSwitch(nd) && lk !== Math.min(pieces[i][0], pieces[i + 1][0]) + '-' + Math.max(pieces[i][0], pieces[i + 1][0])) { why = { swLock: nd }; break; } }
      why = why || free(st, k, pieces, nodes, occ, mine) || full(st, k, pieces, occ) || (blocked ? blocked(pieces) : null);
      if (dry) { st.dryNo = why; return !why; }
      if (why) {
        st.lastNo = why;
        if (it && why.yield == null) { const w0 = st.wants[k]; st.wants[k] = { pieces: pieces.map(x => x.slice(0, 3)), nodes: nodes.map(x => x[0]), prio, t: st.t || 0, since: w0 && w0.id === it.id ? w0.since : st.t || 0, id: it.id, by: why.train != null ? why.train : why.route }; }
        else if (why.yield != null) st.yields = (st.yields || 0) + 1;
        return false;
      }
      delete st.wants[k];
      if (needPc) st.pc[needPc]--;
      if (mine != null) delete st.pcRoutes[mine];
      // the switches: the ones that must change position take the time of the blade, then the signal opens
      let moved = false;
      for (let i = 0; i + 1 < pieces.length && i < nodes.length; i++) {
        const nd = nodes[i][0]; if (!isSwitch(nd) || (st.swFail && st.swFail[nd] != null)) continue;      // (worked by hand: it stays)
        const pos = Math.min(pieces[i][0], pieces[i + 1][0]) + '-' + Math.max(pieces[i][0], pieces[i + 1][0]);
        if (st.sw[nd] != null && st.sw[nd] !== pos) moved = true;
        st.sw[nd] = pos;
      }
      const r = { pid, d0: d, d1, n, pieces, nodes, ready: (st.t || 0) + (moved ? BLADE : 0) + SIGNAL };
      if (perm) { r.vista = true; delete st.avista[k]; }
      if (it) { r.id = it.id; r.way = it.way; st.uses = st.uses || {}; st.uses[it.id] = (st.uses[it.id] || 0) + 1; }
      else if (BY_START.size && nodes.some(([nd]) => isSwitch(nd) && !depotSwitch(nd))) { st.noId = (st.noId || 0) + 1; st.noIdAt = st.noIdAt || {}; const key = n + '@' + pid; st.noIdAt[key] = (st.noIdAt[key] || 0) + 1; }
      (st.routes[k] = st.routes[k] || []).push(r);
      return true;
    }
    // take back a route not entered yet (the train asked for two routes together and got only the first)
    function cancel(st, k, pid, d) { const rs = st.routes[k]; if (!rs) return; st.routes[k] = rs.filter(r => !(r.pid === pid && Math.abs(r.d0 - d) < 1)); if (!st.routes[k].length) delete st.routes[k]; }
    // is the route of train k from d on its path ready (switches in place, signal open)?
    const readyNode = (st, k, nd) => (st.routes[k] || []).filter(r => r.nodes.some(x => x[0] === nd)).every(r => r.ready == null || r.ready <= (st.t || 0));
    function ready(st, k, pid, d) { const r = (st.routes[k] || []).find(x => x.pid === pid && Math.abs(x.d0 - d) < 1); return !r || r.ready == null || r.ready <= (st.t || 0); }
    // behind the train's tail: release; another path or switched off: release all
    // (next: the path of the train's next move, when it is about to start it: its route, set in advance, stays)
    function release(st, k, pid, tail, gone, next) {
      const rs = st.routes[k]; if (!rs) return;
      const keep = [];
      for (const r of rs) {
        if (!gone && next != null && r.pid === next && r.pid !== pid) { keep.push(r); continue; }
        if (gone || r.pid !== pid) continue;
        r.pieces = r.pieces.filter(x => x[3] > tail - 1);
        r.nodes = r.nodes.filter(x => x[1] > tail - 1);
        if (r.pieces.length) keep.push(r);
      }
      if (keep.length) st.routes[k] = keep; else delete st.routes[k];
    }
    // the signals showing via libera now: numbers of the routes set (not yet passed by the front of the train)
    function green(st, fronts) {
      const out = new Set();
      for (const [k, rs] of Object.entries(st.routes)) for (const r of rs) { const f = fronts[k]; if (r.n != null && !(st.redFix && st.redFix[r.n]) && !(st.sigFail && st.sigFail[r.n]) && !r.vista && (r.ready == null || r.ready <= (st.t || 0)) && (!f || f.pid !== r.pid || f.nose < r.d0 + 1)) out.add(r.n); }
      return out;
    }
    // is the stretch behind a signal free (for the signals that are normally green: a, b, c, d on the legal side)?
    function clearAhead(st, pid, d, occ) {
      const d1 = nextSignal(pid, d), { pieces, nodes } = span(pid, d, d1);
      return !free(st, -1, pieces, nodes, occ);
    }
    // ---------- the PC's commands (Pannello PC, Regole_interlocking_M3.xlsx) ----------
    // the positions of every switch of the line, from the ways of the itineraries: [{ pos: 'e1-e2', ids }]
    const nodeOf = (e1, e2) => { const a = NE[e1], b = NE[e2]; return a.a === b.a || a.a === b.b ? a.a : a.b === b.a || a.b === b.b ? a.b : null; };
    const SWPOS = {};
    for (const it of o.itineraries || []) for (const W of it.ways || []) for (let i = 0; i + 1 < W.length; i++) {
      const nd = nodeOf(W[i], W[i + 1]); if (nd == null || !isSwitch(nd) || depotSwitch(nd)) continue;
      const pos = Math.min(W[i], W[i + 1]) + '-' + Math.max(W[i], W[i + 1]), L = SWPOS[nd] = SWPOS[nd] || [];
      let x = L.find(y => y.pos === pos); if (!x) L.push(x = { pos, ids: [] }); if (!x.ids.includes(it.id)) x.ids.push(it.id);
    }
    const switchPositions = nd => SWPOS[nd] || [];
    // the itineraries that start at signal n, and the switches they go over
    function fromSignal(n) {
      return (BY_START.get(n) || []).map(it => {
        const W = it.ways[0], sws = []; for (let i = 0; i + 1 < W.length; i++) { const nd = nodeOf(W[i], W[i + 1]); if (nd != null && isSwitch(nd) && !depotSwitch(nd)) sws.push(nd); }
        return { id: it.id, frm: it.frm, to: it.to, when: it.when, switches: sws };
      });
    }
    const isPcSignal = n => PC_SIG.has(n);
    // a signal held at red by the PC (on) or given back to the interlocking (off)
    function setRed(st, n, on) { st.redFix = st.redFix || {}; if (on) st.redFix[n] = true; else delete st.redFix[n]; return true; }
    // take back the routes set from signal n that their train has not entered yet (front: k -> { pid, nose })
    function cancelAt(st, n, front) {
      let c = 0;
      for (const [k, rs] of Object.entries(st.routes)) { const f = front(+k);
        st.routes[k] = rs.filter(r => { const keep = !(r.n === n && (!f || f.pid !== r.pid || f.nose < r.d0 + 1)); if (!keep) c++; return keep; });
        if (!st.routes[k].length) delete st.routes[k]; }
      if (st.pcRoutes && st.pcRoutes[n]) { delete st.pcRoutes[n]; c++; }
      return c;
    }
    // the PC forms itinerary id (from its signal) by hand: the switches go into position and the pieces are locked
    // for the next train that takes it; refused when something on it is taken or locked the other way
    function formPc(st, id, occ) {
      const it = (o.itineraries || []).find(x => x.id === id); if (!it || it.start == null) return { no: 'itinerario' };
      // the same stretch a train would ask for: from the signal to the next one, on a path that takes this movement
      let pieces = null, nodes = null;
      for (const [pid, list] of Object.entries(SA)) { const x = list.find(y => y[1] === it.start); if (!x) continue;
        const sp = span(+pid, x[0], nextSignal(+pid, x[0])), m = identify(it.start, sp.pieces);
        if (m && m.id === id) { pieces = sp.pieces; nodes = sp.nodes; break; } }
      if (!pieces) return { no: 'percorso' };
      const W = it.ways[0];
      const why = free(st, -1, pieces, nodes, occ, it.start);
      if (why) return why;
      for (let i = 0; i + 1 < W.length; i++) { const nd = nodeOf(W[i], W[i + 1]); if (nd == null || !isSwitch(nd)) continue;
        const pos = Math.min(W[i], W[i + 1]) + '-' + Math.max(W[i], W[i + 1]); if (st.swLock && st.swLock[nd] != null && st.swLock[nd] !== pos) return { swLock: nd };
        if (st.swFail && st.swFail[nd] != null && st.swFail[nd] !== pos) return { swFail: nd }; }
      for (let i = 0; i + 1 < W.length; i++) { const nd = nodeOf(W[i], W[i + 1]); if (nd != null && isSwitch(nd)) st.sw[nd] = Math.min(W[i], W[i + 1]) + '-' + Math.max(W[i], W[i + 1]); }
      st.pcRoutes = st.pcRoutes || {}; st.pcRoutes[it.start] = { id, pieces: pieces.map(x => x.slice(0, 3)), nodes: nodes.map(x => x[0]), t: st.t || 0 };
      return null;
    }
    // a switch moved by hand (only free: no route over it, no train on it) and locked or unlocked in a position
    function setSwitch(st, nd, pos, occ) {
      if (st.swFail && st.swFail[nd] != null) return { swFail: nd };          // failed, or worked by hand by the squad
      if (st.swLock && st.swLock[nd] != null && st.swLock[nd] !== pos) return { swLock: nd };
      const why = free(st, -1, [], [[nd, 0]], occ); if (why) return why;
      st.sw[nd] = pos; return null;
    }
    function lockSwitch(st, nd, pos) { st.swLock = st.swLock || {}; if (pos == null) delete st.swLock[nd]; else st.swLock[nd] = pos; return true; }
    return { fresh, ahead, request, release, held, ready, readyNode, authorize, cancel, green, clearAhead, nextSignal, span, identify, switchesOn, heldNode,
             switchPositions, fromSignal, isPcSignal, setRed, cancelAt, formPc, setSwitch, lockSwitch };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
