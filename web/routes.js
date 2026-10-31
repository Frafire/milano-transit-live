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
    const WHEN = {}; for (const it of o.itineraries || []) WHEN[it.id] = it.when;

    // routes[k] = [{ pid, d0, d1, n, pieces: [[edge, l0, l1, pEnd]], nodes: [[node, p]], id, way, ready }]
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
        pieces.push([ei, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k, q]);
        if (x1 <= d1) nodes.push([dir > 0 ? NE[ei].b : NE[ei].a, x1]);      // the node at the end of this piece
      }
      return { pieces, nodes };
    }
    const overlap = (a0, a1, b0, b1) => a0 < b1 - 0.5 && b0 < a1 - 0.5;
    // is the route free for train k? occ(ei) -> [[k, l0, l1]] other trains on that piece now
    function free(st, k, pieces, nodes, occ) {
      const nodeSet = new Set(nodes.map(x => x[0]));
      for (const [ei, l0, l1] of pieces) for (const [k2, m0, m1] of occ(ei) || []) if (k2 !== k && overlap(l0, l1, m0, m1)) return { train: k2 };
      // a train standing on a switch (touching the node from any side)
      for (const nd of nodeSet) for (const ei of nodeEdges(nd)) for (const [k2, m0, m1] of occ(ei) || []) {
        if (k2 === k) continue;
        const L = NE[ei].len, atA = NE[ei].a === nd;
        if (atA ? m0 < 1 : m1 > L - 1) return { train: k2, node: nd };
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
    function identify(n, pieces) {
      const R = []; for (const [ei] of pieces) if (R[R.length - 1] !== ei) R.push(ei);
      let best = null;
      // (a movement that starts with no signal behind it, out of a tail position: any movement of the table that goes
      // over the same pieces from there)
      for (const it of n != null ? BY_START.get(n) || [] : o.itineraries || []) it.ways.forEach((W, wi) => {
        // (a signal at the very end of a track piece: the table starts on that piece, the route on the next one)
        const o0 = n == null ? W.indexOf(R[0]) : W[0] === R[0] ? 0 : W[1] === R[0] ? 1 : -1; if (o0 < 0) return;
        const m = Math.min(W.length - o0, R.length); for (let i = 0; i < m; i++) if (W[i + o0] !== R[i]) return;
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
    function request(st, k, pid, d, n, occ, blocked) {
      if (held(st, k, pid, d)) return true;
      const d1 = nextSignal(pid, d), { pieces, nodes } = span(pid, d, d1);
      const it = BY_START.size ? identify(n, pieces) : null;
      // the PC's signals and the movements that are not for the normal service: only with the PC's authorisation
      const needPc = (n != null && PC_SIG.has(n) ? 'n:' + n : null) || (it && WHEN[it.id] && !NORMAL.has(WHEN[it.id]) ? 'id:' + it.id : null);
      if (needPc && !(st.pc[needPc] > 0)) { st.lastNo = { pc: needPc }; return false; }
      const why = free(st, k, pieces, nodes, occ) || full(st, k, pieces, occ) || (blocked ? blocked(pieces) : null);
      if (why) { st.lastNo = why; return false; }
      if (needPc) st.pc[needPc]--;
      // the switches: the ones that must change position take the time of the blade, then the signal opens
      let moved = false;
      for (let i = 0; i + 1 < pieces.length && i < nodes.length; i++) {
        const nd = nodes[i][0]; if (!isSwitch(nd)) continue;
        const pos = Math.min(pieces[i][0], pieces[i + 1][0]) + '-' + Math.max(pieces[i][0], pieces[i + 1][0]);
        if (st.sw[nd] != null && st.sw[nd] !== pos) moved = true;
        st.sw[nd] = pos;
      }
      const r = { pid, d0: d, d1, n, pieces, nodes, ready: (st.t || 0) + (moved ? BLADE : 0) + SIGNAL };
      if (it) { r.id = it.id; r.way = it.way; st.uses = st.uses || {}; st.uses[it.id] = (st.uses[it.id] || 0) + 1; }
      else if (BY_START.size && nodes.some(([nd]) => isSwitch(nd) && !depotSwitch(nd))) { st.noId = (st.noId || 0) + 1; st.noIdAt = st.noIdAt || {}; const key = n + '@' + pid; st.noIdAt[key] = (st.noIdAt[key] || 0) + 1; }
      (st.routes[k] = st.routes[k] || []).push(r);
      return true;
    }
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
      for (const [k, rs] of Object.entries(st.routes)) for (const r of rs) { const f = fronts[k]; if (r.n != null && (r.ready == null || r.ready <= (st.t || 0)) && (!f || f.pid !== r.pid || f.nose < r.d0 + 1)) out.add(r.n); }
      return out;
    }
    // is the stretch behind a signal free (for the signals that are normally green: a, b, c, d on the legal side)?
    function clearAhead(st, pid, d, occ) {
      const d1 = nextSignal(pid, d), { pieces, nodes } = span(pid, d, d1);
      return !free(st, -1, pieces, nodes, occ);
    }
    return { fresh, ahead, request, release, held, ready, readyNode, authorize, green, clearAhead, nextSignal, span, identify, switchesOn, heldNode };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
