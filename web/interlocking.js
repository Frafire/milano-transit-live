// Depot and test-loop signals: which of them may show "via libera", and for which train. The line itself (stations,
// junctions, tails) is protected by the route interlocking (web/routes.js); this keeps the depot rules: manual signals
// worked by the player, one movement at a time per depot side, the test loop zone.
//
// It knows the line, not the trains' plans. The trains (agents.js) ask it before passing a controlled signal; it
// answers yes (the signal clears for that train) or no (the train stops before it). It never moves a train.
//
// The model (built from rules_<line>.json "interlocking" by the build, net.interlocking):
//   signals[si] = { n, manual, section, groups: [gi], zone }   every controlled signal, what applies to it
//   groups[gi]  = { name, signals: [si], hold }                 only one signal of a group at via libera at a time;
//                                                                hold: the grant stays until the movement is over
//   zones[zi]   = { name, entry: [si], paths: [pid] }           a stretch for one train at a time (the test loop):
//                                                                its entry clears only for the train holding the zone,
//                                                                for the trains going into it (paths); for the others
//                                                                the entry is an ordinary signal
// Rules for one controlled signal si, asked by train k standing d - nose metres before it:
//   - the train is near (NEAR) and the track just behind the signal is free;
//   - section: no train between it and the next signal on the train's way (at most SECTION_MAX);
//   - groups: no other signal of its groups at via libera for another train;
//   - zone entry: the zone is held by this train;
//   - manual (depot on manual): the player has cleared it for one train.
// It goes back to red when the train's front is past it (hold groups: when the movement is over).
//
// Itineraries (ACEI of the depot, Giovanni 18 Nov 2026), depot on manual: the player forms an itinerary on the board from
// a manual signal to a signal, a track or the block towards the line (the page finds the way and checks it is free and
// not taken by another itinerary), then gives the via libera. st.routes[id] = { id, si, n, to, kind, edges: [[ei, dir],
// ...], mid: [si, ...] (the signals on the way, in order: cleared with the itinerary), auth, k, pid, secD, rel, passed }.
// The start clears for the first train whose way follows the itinerary edge by edge (to a track: and stops there); the
// signals on the way clear for that train. It frees itself section by section (signal to signal) behind the train.
//
// The state lives in a plain object kept by the caller (agents.js keeps it in S, so saved states and going back in
// time include it). Signal indexes are those of net.signals; their #A numbers are fixed (rules "n").
(function (root) {
  const NEAR = 300;      // a signal clears only for a train within this distance of it (m)
  const PASS = 15;       // ...and goes red again when the train's front is this far past it
  const SECTION_MAX = 600;

  function create(o) {
    // o: { signals, groups, zones, sigpos: { pid: [[d, si], ...] }, half }
    const sig = new Map(), groups = o.groups || [], zones = o.zones || [];
    for (const [si, x] of Object.entries(o.signals || {})) sig.set(+si, Object.assign({ groups: [] }, x));
    groups.forEach((g, gi) => g.signals.forEach(si => { if (!sig.has(si)) sig.set(si, { groups: [] }); const x = sig.get(si); if (!x.groups.includes(gi)) x.groups.push(gi); }));
    zones.forEach((z, zi) => z.entry.forEach(si => { if (!sig.has(si)) sig.set(si, { groups: [] }); sig.get(si).zone = zi; }));
    // a zone's entry holds only the trains going into the zone (#A94: into the test loop); for the others it is an
    // ordinary signal (no list of paths: every train)
    const zpaths = zones.map(z => z.paths ? new Set(z.paths.map(Number)) : null);
    const intoZone = (zi, pid) => !zpaths[zi] || pid == null || zpaths[zi].has(+pid);
    const controlled = si => sig.has(si);
    const isManual = si => !!(sig.get(si) || {}).manual;
    const groupOf = si => { const x = sig.get(si); return x && x.groups.length ? x.groups[0] : null; };

    function fresh(prev) { return { grant: {}, pass: prev ? prev.pass : {}, passTo: prev && prev.passTo ? prev.passTo : {}, auto: prev ? prev.auto : true, zones: prev && prev.zones ? prev.zones : {}, routes: prev && prev.routes ? prev.routes : {} }; }

    // ---- itineraries ----
    // does the way of a train (path pid, at the signal at d) follow route r? Edge by edge from the start; a way that ends
    // inside the itinerary is fine; one that goes on past an itinerary to a track is not (it would run off its end)
    function follows(r, pid, d) {
      const pe = o.pathEdges && o.pathEdges[pid] && o.pathEdges[pid].e; if (!pe || !r.edges.length) return null;
      // (a track cut by a signal on the way is two parts of the itinerary: one edge of the way)
      const E = r.edges.filter((x, i) => i === 0 || x[0] !== r.edges[i - 1][0] || x[1] !== r.edges[i - 1][1]);
      let i0 = pe.findIndex(x => x[0] === E[0][0] && x[1] === E[0][1] && x[2] <= d + 3 && x[3] >= d - 3);
      if (i0 < 0) return null;
      let j = 0; for (; j < E.length && i0 + j < pe.length; j++) if (pe[i0 + j][0] !== E[j][0] || pe[i0 + j][1] !== E[j][1]) return null;
      if (r.kind === 'trk' && j === E.length && i0 + j < pe.length) return null;
      return { i0, last: pe[Math.min(pe.length, i0 + E.length) - 1] };
    }
    // the itinerary that lets train k pass signal si (at d on path pid), if any: its start (formed, via libera, free or
    // already the train's) or a signal on its way (the train's itinerary)
    function routeFor(st, k, si, d, pid) {
      for (const r of Object.values(st.routes || {})) {
        if (r.k === k && r.pid === pid && r.mid.includes(si)) return r;
        if (r.si === si && r.k === k && r.pid === pid && !r.passed) return r;
        if (r.si === si && r.auth && r.k == null && follows(r, pid, d)) return r;
      }
      return null;
    }
    // the train takes the itinerary: where its sections end on its way (the signals on it; the end of the itinerary)
    function bind(r, k, pid, d) {
      const f = follows(r, pid, d), sp = (o.sigpos && o.sigpos[pid]) || [], secD = [d]; let at = d;
      for (const s2 of r.mid) { const h = sp.find(y => y[1] === s2 && y[0] > at + 1); if (h) { secD.push(h[0]); at = h[0]; } }
      const h = r.to != null ? sp.find(y => y[1] === r.to && y[0] > at + 1) : null;
      secD.push(h ? h[0] : f && f.last ? f.last[3] : at + SECTION_MAX);
      Object.assign(r, { k, pid, secD, rel: 0, passed: false });
    }
    function addRoute(st, r) { st.routes = st.routes || {}; if (!r || r.id == null || st.routes[r.id]) return false;
      // (a via libera given before, in automatic, to the train still standing at the signal for its own way: taken back,
      // the player's itinerary takes its place; Giovanni 18 Nov 2026, S01A to #A99: "doppio tracciato" and the train still)
      const g = st.grant[r.si]; if (g != null && !Object.values(st.routes).some(x => x.k === g && x.si === r.si)) delete st.grant[r.si];
      st.routes[r.id] = Object.assign({ auth: false, k: null, mid: [], edges: [] }, r); return true; }
    function authRoute(st, id) { const r = (st.routes || {})[id]; if (!r) return false; r.auth = true; return true; }
    // taken back by the player: only while no train has gone past its start
    function dropRoute(st, id) { const r = (st.routes || {})[id]; if (!r) return false; if (r.passed) return false;
      if (r.k != null && st.grant[r.si] === r.k) delete st.grant[r.si]; delete st.routes[id]; return true; }

    // controlled signals ahead of a train on its path: [{ d, si }], nearest first
    function ahead(pid, nose, look) {
      const sp = o.sigpos && o.sigpos[pid], out = []; if (!sp) return out;
      for (const [d, si] of sp) { if (d > nose + look) break; if (d > nose - 12 && controlled(si)) out.push({ d, si }); }
      return out;
    }
    // the block section behind signal si on path pid: up to the next signal facing the train (or SECTION_MAX)
    function sectionEnd(pid, si, d) {
      const sp = o.sigpos && o.sigpos[pid]; let e = d + SECTION_MAX;
      if (sp) for (const [d2, s2] of sp) if (d2 > d + 5 && s2 !== si) { e = Math.min(e, d2); break; }
      return e;
    }
    // may train k pass signal si now? freeTo: how far (front of the train) the track is free; freeTrains: the same,
    // counting only other trains (what lies beyond the next signal is that signal's business)
    function request(st, k, si, d, nose, freeTo, pid, freeTrains) {
      if (st.grant[si] === k) return true;
      if (st.grant[si] != null) return false;
      const x = sig.get(si); if (!x) return true;
      if (d - nose > NEAR) return false;
      if (freeTo < d + 30) return false;
      if (x.section && pid != null && (freeTrains != null ? freeTrains : freeTo) < sectionEnd(pid, si, d) - 5) return false;
      // (depot on manual: an itinerary formed on the board; the board has checked it against the others, so the
      // one-at-a-time groups do not apply to it)
      const r = x.manual && !st.auto && st.routes ? routeFor(st, k, si, d, pid) : null;
      if (r) { if (x.zone != null && intoZone(x.zone, pid) && zoneHolder(st, x.zone) !== k) return false;
        if (r.k == null) bind(r, k, pid, d); st.grant[si] = k; return true; }
      for (const gi of x.groups) { for (const [s2, k2] of Object.entries(st.grant)) if (k2 !== k && (sig.get(+s2) || { groups: [] }).groups.includes(gi)) return false; }
      if (x.zone != null && intoZone(x.zone, pid) && zoneHolder(st, x.zone) !== k) return false;
      if (x.manual && !st.auto) { if (!(st.pass[si] > 0)) return false;
        // an itinerary formed by the player (ACEI: the key of the signal, then the key of the signal it goes to): only for
        // a train whose next signal after this one is that one
        const to = st.passTo && st.passTo[si]; if (to != null && pid != null && nextAfter(pid, d, si) !== to) return false;
        st.pass[si]--; if (!st.pass[si] && st.passTo) delete st.passTo[si]; }
      st.grant[si] = k; return true;
    }
    // back to red behind the train (or when it went another way / left the line)
    function release(st, k, pid, nose, gone, prevNose, v) {
      for (const r of Object.values(st.routes || {})) { if (r.k !== k) continue;
        if (r.pid !== pid || (gone && nose > r.secD[0] + PASS)) { delete st.routes[r.id]; continue; }
        if (nose > r.secD[0] + PASS) r.passed = true;
        const tail = nose - 2 * (o.half || 0);
        while (r.rel < r.secD.length - 1 && tail > r.secD[r.rel + 1] + 1) r.rel++;
        if (r.rel >= r.secD.length - 1) delete st.routes[r.id]; }
      // check: a front that went over a controlled signal must have had via libera (counted for the tests)
      if (!gone && prevNose != null && nose > prevNose) for (const c of ahead(pid, prevNose + 12, nose - prevNose))
        if (c.d > prevNose && c.d <= nose) { st.passed = (st.passed || 0) + 1; if (st.grant[c.si] !== k) st.viol = (st.viol || 0) + 1; }
      for (const [s, k2] of Object.entries(st.grant)) {
        if (k2 !== k) continue;
        const si = +s, sp = o.sigpos && o.sigpos[pid], hit = sp && sp.find(y => y[1] === si), x = sig.get(si) || { groups: [] };
        const hold = x.groups.some(gi => groups[gi] && groups[gi].hold);
        const over = hold ? nose > hit?.[0] + PASS && (v === 0 || nose > hit[0] + 400) : nose > hit?.[0] + PASS;
        if (gone || !hit || over) delete st.grant[si];
      }
    }
    // the next signal facing the train after signal si (at d) on path pid, any signal (controlled or not), or null
    function nextAfter(pid, d, si) { const sp = o.sigpos && o.sigpos[pid]; if (sp) for (const [d2, s2] of sp) if (d2 > d + 5 && s2 !== si) return s2; return null; }
    // the player clears a manual signal for the next train (to: only for a train going on to that signal; ACEI itinerary)
    function clear(st, si, to) { if (!isManual(si)) return false; st.pass[si] = (st.pass[si] || 0) + 1;
      st.passTo = st.passTo || {}; if (to != null) st.passTo[si] = to; else delete st.passTo[si]; return true; }
    function aspect(st, si) { return st.grant[si] != null ? 'go' : 'stop'; }

    // ---- zones: one train at a time (the test loop) ----
    const zoneOf = name => { const i = zones.findIndex(z => z.name === name); return i < 0 ? null : i; };
    const zst = (st, zi) => { st.zones = st.zones || {}; return st.zones[zi] || (st.zones[zi] = { holder: null, queue: [] }); };
    function zoneHolder(st, zi) { return zst(st, zi).holder; }
    // train k asks for the zone: true if it has it now, false if it waits (in the queue)
    function zoneAsk(st, zi, k) { const z = zst(st, zi); if (z.holder == null || z.holder === k) { z.holder = k; z.queue = z.queue.filter(x => x !== k); return true; } if (!z.queue.includes(k)) z.queue.push(k); return false; }
    // train k leaves the zone (or gives up): the next train in the queue gets it (returned), or null
    function zoneFree(st, zi, k) { const z = zst(st, zi); z.queue = z.queue.filter(x => x !== k); if (z.holder !== k) return null; z.holder = z.queue.shift() ?? null; return z.holder; }

    // what applies to a signal, in words (tooltips)
    function describe(si) {
      const x = sig.get(si); if (!x) return '';
      return x.groups.map(gi => ' · uno alla volta: ' + (groups[gi].name || 'gruppo ' + (gi + 1))).join('')
        + (x.zone != null ? ' · ingresso ' + zones[x.zone].name + ': un treno alla volta (per gli altri treni è un segnale del deposito)' : '')
        + (x.section ? ' · via libera solo col binario libero fino al segnale successivo' : '')
        + (x.manual ? ' · manovrato dal giocatore (clic = via libera)' : '');
    }
    // where a signal is, in two or three words (the tooltip on the map; the rules in full are on its card): the name of its
    // group or zone before the colon ("Deposito lato est")
    function brief(si) {
      const x = sig.get(si); if (!x) return '';
      const g = x.groups.map(gi => groups[gi] && groups[gi].name).find(Boolean) || (x.zone != null && zones[x.zone] ? zones[x.zone].name : '');
      return String(g || '').split(':')[0].trim();
    }
    return { fresh, ahead, request, release, clear, nextAfter, aspect, controlled, isManual, groupOf, sectionEnd, describe, brief, zoneOf, zoneHolder, zoneAsk, zoneFree, addRoute, authRoute, dropRoute, follows };
  }

  const api = { create, NEAR, PASS, SECTION_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLInterlocking = api;
})(typeof window !== 'undefined' ? window : globalThis);
