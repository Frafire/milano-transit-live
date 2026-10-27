// Interlocking: which controlled signals may show "via libera", and for which train.
//
// It knows the line, not the trains' plans. The trains (agents.js) ask it before passing a controlled signal;
// it answers yes (the signal clears for that train) or no (the train stops before it). It never moves a train.
//
// Rules (data in rules_<line>.json, "interlocking"):
// - groups: signals that lead into the same junction; only one of them shows via libera at a time
//   (San Donato: depot exit and the two tails; Comasina: the two tails; San Donato: the two departure platforms).
// - manual: signals worked by the player (depot protection). Red until the player clears them for one train,
//   unless the depot is on automatic.
// - a signal clears only when the track behind it is free (the caller says how far it is free) and the train is
//   near (no signal held for a train still far away). It goes back to red when the train's front has passed it.
//
// The state lives in a plain object kept by the caller (agents.js keeps it in S, so saved states and going back in
// time include it). Signal numbers are the indexes of net.signals (shown on the map as #A01, #A02, ...).
(function (root) {
  const NEAR = 300;      // a signal clears only for a train within this distance of it (m)
  const PASS = 15;       // ...and goes red again when the train's front is this far past it

  function create(o) {
    // o: { groups: [[si, ...], ...], manual: [si, ...], sigpos: { pid: [[d, si], ...] }, half }
    const groupOf = new Map(), manual = new Set(o.manual || []), half = o.half;
    (o.groups || []).forEach((g, gi) => g.forEach(si => groupOf.set(si, gi)));
    const controlled = si => groupOf.has(si) || manual.has(si);

    function fresh(prev) { return { grant: {}, pass: prev ? prev.pass : {}, auto: prev ? prev.auto : true }; }

    // controlled signals ahead of a train on its path: [{ d, si }], nearest first
    function ahead(pid, nose, look) {
      const sp = o.sigpos && o.sigpos[pid], out = []; if (!sp) return out;
      for (const [d, si] of sp) { if (d > nose + look) break; if (d > nose - 12 && controlled(si)) out.push({ d, si }); }
      return out;
    }
    // may train k pass signal si now? freeTo: how far (front of the train) the track behind the signal is free
    function request(st, k, si, d, nose, freeTo) {
      if (st.grant[si] === k) return true;
      if (st.grant[si] != null) return false;
      if (d - nose > NEAR) return false;
      if (freeTo < d + 30) return false;                                        // the track behind it is not free
      const g = groupOf.get(si);
      if (g != null) for (const [s2, k2] of Object.entries(st.grant)) if (k2 !== k && groupOf.get(+s2) === g) return false;
      if (manual.has(si) && !st.auto) { if (!(st.pass[si] > 0)) return false; st.pass[si]--; }
      st.grant[si] = k; return true;
    }
    // back to red behind the train (or when it went another way / left the line)
    function release(st, k, pid, nose, gone, prevNose) {
      // check: a front that went over a controlled signal must have had via libera (counted for the tests)
      if (!gone && prevNose != null && nose > prevNose) for (const c of ahead(pid, prevNose + 12, nose - prevNose))
        if (c.d > prevNose && c.d <= nose) { st.passed = (st.passed || 0) + 1; if (st.grant[c.si] !== k) st.viol = (st.viol || 0) + 1; }
      for (const [s, k2] of Object.entries(st.grant)) {
        if (k2 !== k) continue;
        const si = +s, sp = o.sigpos && o.sigpos[pid], hit = sp && sp.find(x => x[1] === si);
        if (gone || !hit || nose > hit[0] + PASS) delete st.grant[si];
      }
    }
    // the player clears a manual signal for the next train
    function clear(st, si) { if (!manual.has(si)) return false; st.pass[si] = (st.pass[si] || 0) + 1; return true; }
    function aspect(st, si) { return st.grant[si] != null ? 'go' : 'stop'; }
    return { fresh, ahead, request, release, clear, aspect, controlled, isManual: si => manual.has(si), groupOf: si => groupOf.get(si) };
  }

  const api = { create, NEAR, PASS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLInterlocking = api;
})(typeof window !== 'undefined' ? window : globalThis);
