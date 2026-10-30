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
(function (root) {
  function create(o) {
    // o: { sigall: { pid: [[d, n, flags]] }, pathEdges: [{ e: [[edge, dir, from, to]] }], netEdges: [{ a, b, len }] }
    const SA = o.sigall || {}, PE = o.pathEdges, NE = o.netEdges;

    function fresh() { return { routes: {} }; }          // routes[k] = [{ pid, d0, d1, n, pieces: [[edge, l0, l1, pEnd]], nodes: [[node, p]] }]

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

    function held(st, k, pid, d) { return (st.routes[k] || []).some(r => r.pid === pid && Math.abs(r.d0 - d) < 1); }
    // train k asks for the route that starts at the signal at d on its path: true if it is set (now or before)
    function request(st, k, pid, d, n, occ, blocked) {
      if (held(st, k, pid, d)) return true;
      const d1 = nextSignal(pid, d), { pieces, nodes } = span(pid, d, d1);
      const why = free(st, k, pieces, nodes, occ) || (blocked ? blocked(pieces) : null);
      if (why) { st.lastNo = why; return false; }
      (st.routes[k] = st.routes[k] || []).push({ pid, d0: d, d1, n, pieces, nodes });
      return true;
    }
    // behind the train's tail: release; another path or switched off: release all
    function release(st, k, pid, tail, gone) {
      const rs = st.routes[k]; if (!rs) return;
      const keep = [];
      for (const r of rs) {
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
      for (const [k, rs] of Object.entries(st.routes)) for (const r of rs) { const f = fronts[k]; if (!f || f.pid !== r.pid || f.nose < r.d0 + 1) out.add(r.n); }
      return out;
    }
    // is the stretch behind a signal free (for the signals that are normally green: a, b, c, d on the legal side)?
    function clearAhead(st, pid, d, occ) {
      const d1 = nextSignal(pid, d), { pieces, nodes } = span(pid, d, d1);
      return !free(st, -1, pieces, nodes, occ);
    }
    return { fresh, ahead, request, release, held, green, clearAhead, nextSignal, span };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
