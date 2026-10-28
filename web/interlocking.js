// Interlocking: which controlled signals may show "via libera", and for which train. One model for the whole line.
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

    function fresh(prev) { return { grant: {}, pass: prev ? prev.pass : {}, auto: prev ? prev.auto : true, zones: prev && prev.zones ? prev.zones : {} }; }

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
      for (const gi of x.groups) for (const [s2, k2] of Object.entries(st.grant)) if (k2 !== k && (sig.get(+s2) || { groups: [] }).groups.includes(gi)) return false;
      if (x.zone != null && intoZone(x.zone, pid) && zoneHolder(st, x.zone) !== k) return false;
      if (x.manual && !st.auto) { if (!(st.pass[si] > 0)) return false; st.pass[si]--; }
      st.grant[si] = k; return true;
    }
    // back to red behind the train (or when it went another way / left the line)
    function release(st, k, pid, nose, gone, prevNose, v) {
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
    // the player clears a manual signal for the next train
    function clear(st, si) { if (!isManual(si)) return false; st.pass[si] = (st.pass[si] || 0) + 1; return true; }
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
    return { fresh, ahead, request, release, clear, aspect, controlled, isManual, groupOf, sectionEnd, describe, zoneOf, zoneHolder, zoneAsk, zoneFree };
  }

  const api = { create, NEAR, PASS, SECTION_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLInterlocking = api;
})(typeof window !== 'undefined' ? window : globalThis);
