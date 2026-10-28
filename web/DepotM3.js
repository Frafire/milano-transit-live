// The M3 depot (San Donato) and its test loop (anello di prova): who stands where, which place a train gets, and the
// trips round the test loop. Giovanni, 28 Oct.
//
// Places: trains have no fixed place. When a train leaves San Donato platform 3 for the depot (#A40 towards #A04) the
// depot gives it a free place; until it passes #A04/#A05 the player can change it by radio. Its next run out of the
// depot starts from that place. At the end of the service day the trains keep their places for the next day. A place
// is called by the signal in front of it (A48, A78...). The places after #A76, #A77, #A78 are given only when nothing
// else is free (#A76 is train 28's own place, the 8105-8106 unit).
//
// Test loop: a train standing in its place goes to #A94 and asks to go in (west side: after a change of cab beyond
// #A94; east side: after a change of cab at the turning point on w71). One train at a time: while one has asked for the
// loop or is on it, the others wait at #A94 (nose at Giovanni's flag). Before leaving the loop it says it has finished
// and the depot gives it a place: it goes there straight on, or it stops past #A95 (tail at Giovanni's flag), changes
// cab and goes back. When its tail is past that flag the loop is free (a notice, not a request).
//
// It works on the trains' days (tr.segs: [pid, kind, trip, times, distances, place, 'loop:<role>']) and on the agents
// (agents.js), and talks on the radio through env. No map, no page.
(function (root) {
  const V_YARD = 15 / 3.6, RESERVE_T = 29 * 3600;
  const LOW = ['A76', 'A77', 'A78'];          // places given only when nothing else is free

  function create(F, env) {
    // env: { say(who, text, cls), call(tr, text), trainNo(tr), fmt(t), dayStart }
    const D = { F, loopMsg: '' };
    const placeOf = s => s && s.length > 5 && s[5] != null ? String(s[5]) : null;
    const loopRole = s => s && typeof s[6] === 'string' && s[6].startsWith('loop:') ? s[6].slice(5) : null;
    const name = q => { const i = (F.engine.net.depot || []).findIndex(d => String(d.node) === String(q)); return i >= 0 ? (F.engine.net.depot[i].name || '').replace('Deposito binario ', 'D') : 'posto ' + q; };
    const low = q => LOW.includes(name(q));
    const taken = () => new Set([...Object.values(F.depot.at), ...Object.values(F.depot.target)].filter(Boolean));
    const restamp = tr => { tr.starts = tr.segs.map(x => x[3][0]); };

    // ---------- where trains stand ----------
    // a run out of a place: the first run of the day, or a run right after one into the same place; the others go in
    const isOut = (tr, i) => !!placeOf(tr.segs[i]) && tr.segs[i][1] !== 'to_depot' && (i === 0 || placeOf(tr.segs[i - 1]) != null);
    const moved = (a, s) => a.pid === s[0] && Math.abs(a.d - s[4][0]) > 5 && !(F.ag.S.t < a.wait);
    // a train stands in the place of its current run: about to leave it (not moved yet), arrived in it, or a reserve train
    const standsAt = (a, s, tr, i) => !!placeOf(s) && (s[3][0] >= RESERVE_T || isOut(tr, i) && !moved(a, s)
      || !isOut(tr, i) && a.pid === s[0] && Math.abs(a.d - s[4][s[4].length - 1]) < 3);
    function init() {
      F.depot = { at: {}, target: {}, seg: {}, done: {}, pending: {} };
      F.trains.forEach((tr, k) => { const a = F.ag.agents()[k], i = a && Math.min(a.si, tr.segs.length - 1), s = a && tr.segs[i]; if (a && s && standsAt(a, s, tr, i)) F.depot.at[k] = placeOf(s); });
    }

    // ---------- runs into and out of the depot ----------
    // the next run out of the depot after seg i (from_depot or an empty run that starts at a place)
    const nextOut = (tr, i) => { for (let j = i + 1; j < tr.segs.length; j++) { const s = tr.segs[j]; if ((s[1] === 'from_depot' || s[1] === 'empty') && placeOf(s)) return j; if (s[1] === 'service') return -1; } return -1; };
    function shiftRefs(tr, j, by) { ['alts', 'arr2', 'calts'].forEach(key => (tr[key] || []).forEach(x => { if (x.i != null && x.i > j) x.i += by; })); }
    // the run out of place q replacing seg s (same time at the platform)
    function outChoice(s, q) {
      const P = F.depotPaths[q]; if (!P) return null;
      let best = null;
      for (const [pl, o] of Object.entries(P.out)) { const m = F.ag.mapTo(o.pid, o.plat, s[0]); if (m != null && (s[1] !== 'from_depot' || Math.abs(m - s[4][s[4].length - 1]) < 40)) { best = { pl, o, m }; if (s[1] !== 'from_depot' || pl === '1') break; } }
      return best;
    }
    function rewriteOut(tr, j, q) {
      const s = tr.segs[j], oldPid = s[0], best = outChoice(s, q);
      if (!best) return false;
      const o = best.o, run = Math.max(0, o.plat - o.start) / V_YARD;
      if (s[1] === 'from_depot') { const tP = s[3][s[3].length - 1]; tr.segs[j] = [o.pid, 'from_depot', -1, [Math.round(tP - run), tP], [o.start, o.plat], +q]; }
      else {                    // an empty run on through the station (to Comasina): out of the place to platform 1, then on as planned
        const t0 = s[3][0], tP = Math.round(t0 + run), tE = s[3][s[3].length - 1], dE = s[4][s[4].length - 1];
        tr.segs.splice(j, 1, [o.pid, 'empty', -1, [t0, tP], [o.start, o.plat], +q], [oldPid, 'empty', -1, [tP, Math.max(tP + 1, tE)], [best.m, dE]]); shiftRefs(tr, j, 1);
      }
      restamp(tr); return true;
    }
    // after a train's place changed: its next run out leaves from it; a reserve train stands in it
    function followPlace(tr, g, q, pid, d) {
      const j = nextOut(tr, g); if (j >= 0 && placeOf(tr.segs[j]) !== q) rewriteOut(tr, j, q);
      for (let i = g + 1; i < tr.segs.length; i++) { const x = tr.segs[i]; if (x[3][0] >= RESERVE_T && placeOf(x) && placeOf(x) !== q) tr.segs[i] = [pid, 'to_depot', -1, [x[3][0], x[3][0] + 1], [d, d], +q]; }
    }
    // give train k place q for the run it is on now (it must already be on the way in, on San Donato platform 3)
    function assign(k, q) {
      const tr = F.trains[k], a = F.ag.agents()[k], si = a.si, s = tr.segs[si], P = F.depotPaths[q]; if (!P || !s) return false;
      const d = F.ag.mapTo(a.pid, a.d, P.in); if (d == null) return false;
      const t0 = s[3][0], d0 = Math.min(d, P.in_end), t1 = Math.round(t0 + Math.max(1, P.in_end - d0) / V_YARD);
      tr.segs[si] = [P.in, s[1], -1, [t0, Math.max(t0 + 1, t1)], [d0, P.in_end], +q];
      const j = nextOut(tr, si); if (j >= 0) rewriteOut(tr, j, q);
      restamp(tr);
      F.depot.target[k] = q; F.ag.replan(k); return true;
    }
    // the free place the depot gives: the quickest way in and out again (the places after #A76-#A78 last)
    function pick(k) {
      const tk = taken(), a = F.ag.agents()[k];
      const cand = Object.keys(F.depotPaths).filter(q => !tk.has(q) && F.ag.mapTo(a.pid, a.d, F.depotPaths[q].in) != null);
      const cost = q => { const P = F.depotPaths[q]; return P.in_end + Math.min(...Object.values(P.out).map(v => v.plat - v.start)) + (low(q) ? 1e5 : 0); };
      cand.sort((p, q) => cost(p) - cost(q));
      return cand[0] || null;
    }
    function pickAny() { const tk = taken(), all = Object.keys(F.depotPaths).filter(q => !tk.has(q)); return all.find(q => !low(q)) || all[0] || null; }
    // past #A04/#A05 (the depot entrance) the place can no longer be changed
    function pastEntrance(k) {
      const a = F.ag.agents()[k], sp = F.engine.net.sigpos[a.pid] || [], sig = F.engine.net.signals;
      const e = sp.find(([d, i]) => sig[i] && (sig[i].n === 4 || sig[i].n === 5)); return e ? a.d + F.engine.half > e[0] : false;
    }
    // every frame: places freed, places given to the trains coming in, trains arrived in their places
    function tick() {
      if (!F.depotPaths || !F.ag) return;
      if (!F.depot) init();
      F.ag.agents().forEach((a, k) => {
        const tr = F.trains[k], si = Math.min(a.si, tr.segs.length - 1), s = tr.segs[si]; if (!s || a.hidden || a.mode !== 'plan' && a.mode !== 'static') return;
        let at = F.depot.at[k];
        if (at != null && !(placeOf(s) === at && standsAt(a, s, tr, si))) { delete F.depot.at[k]; at = null; }     // it has left its place
        if (at == null && F.depot.target[k] == null && standsAt(a, s, tr, si) && !taken().has(placeOf(s))) { at = F.depot.at[k] = placeOf(s); }
        // on the way in: a place, given once (on platform 3, #A40)
        const inRun = placeOf(s) && !isOut(tr, si) && s[3][0] < RESERVE_T && !loopRole(s);
        if (inRun && F.depot.target[k] == null && at == null && F.depot.done[k] !== a.si) {
          const q = pick(k);
          if (q != null && assign(k, q)) F.depot.seg[k] = a.si;
          else { const q2 = !taken().has(placeOf(s)) ? placeOf(s) : pickAny(); F.depot.target[k] = q2; F.depot.seg[k] = a.si; if (q2 !== placeOf(s)) F.depot.pending[k] = q2; }
        } else if (F.depot.pending[k] != null && F.depot.seg[k] === a.si && !pastEntrance(k)) {
          const q = F.depot.pending[k]; delete F.depot.target[k];
          if (assign(k, q)) delete F.depot.pending[k]; else F.depot.target[k] = q;
        }
        // arrived: it stands in its place
        const g = F.depot.seg[k];
        if (F.depot.target[k] != null && (a.si > g || a.si === g && a.v === 0 && Math.abs(a.d - s[4][s[4].length - 1]) < 3)) {
          F.depot.at[k] = F.depot.target[k]; delete F.depot.target[k]; F.depot.done[k] = g; }
      });
      loopTick();
    }
    // a new service day: each train out of the place it stood in last night (keep: train -> place)
    function newDay(keep) {
      F.depot = { at: {}, target: {}, seg: {}, done: {}, pending: {} }; F.loop = null; const used = new Set();
      F.trains.forEach((tr, k) => { const p = keep[k], s = tr.segs[0]; if (p == null || !placeOf(s) || used.has(p)) return;
        if (placeOf(s) !== p && (s[1] === 'from_depot' || s[1] === 'empty')) rewriteOut(tr, 0, p);
        else if (s[1] === 'to_depot' && placeOf(s) !== p) return;           // reserve trains keep their own places
        F.depot.at[k] = p; used.add(p); });
      F.trains.forEach((tr, k) => { const s = tr.segs[0]; if (F.depot.at[k] != null || !placeOf(s) || s[1] === 'service') return;
        let p = placeOf(s);
        if (used.has(p)) { p = Object.keys(F.depotPaths).find(q => !used.has(q) && !low(q)) || Object.keys(F.depotPaths).find(q => !used.has(q)); if (p == null) return; rewriteOut(tr, 0, p); }
        F.depot.at[k] = p; used.add(p); });
    }

    // ---------- test loop ----------
    const L = () => F.loop || (F.loop = { asked: {}, exit: {} });
    // the loop is a zone of the interlocking (one train at a time, entry #A94): who holds it lives in its state
    const IL = () => F.ag.IL, ZI = () => IL() ? IL().zoneOf('anello di prova') : null;
    const holder = () => ZI() != null ? IL().zoneHolder(F.ag.il(), ZI()) : null;
    const no = k => env.trainNo(F.trains[k]);
    // a loop trip still ahead of the train (the trips done stay in its day, they do not count)
    const loopAhead = k => { const tr = F.trains[k], a = F.ag && F.ag.agents()[k], from = a ? Math.min(a.si, tr.segs.length) : 0; for (let i = from; i < tr.segs.length; i++) if (loopRole(tr.segs[i])) return true; return false; };
    // what the train's card shows: { can, onLoop, note, holder }
    function loopInfo(k) {
      const T = F.test, p = F.depot && F.depot.at[k];
      if (!T || !T.trip || !F.ag) return null;
      if (loopAhead(k)) return { onLoop: true, note: D.loopMsg || 'In giro sull\'anello di prova.' };
      if (p == null) return null;
      if (!T.trip[p]) return { can: false, note: 'Da questo posto non c\'è una via per l\'anello di prova.' };
      const h = holder(); return { can: true, holder: h != null && h !== k ? no(h) : null, note: D.loopMsg };
    }
    // the trip as moves of its day: to the loop (asking at #A94), the laps, and a stand-in for the way out (decided
    // before it leaves the loop)
    // time to run len metres from a stop to a stop on the loop (accelerate, run, brake), a little slack
    function runTime(len) {
      const T = F.test, a = T.acc || 1, b = T.brk || 1, v = T.v_run || T.v_lap, xa = v * v / (2 * a), xb = v * v / (2 * b);
      if (len <= xa + xb) { const vp = Math.sqrt(2 * len * a * b / (a + b)); return Math.max(2, (vp / a + vp / b) * 1.1); }
      return Math.max(2, (v / a + v / b + (len - xa - xb) / v) * 1.1);
    }
    function loopSegs(p, t0, laps) {
      const T = F.test, R = T.trip[p], V = T.v_yard, segs = []; let t = t0;
      const add = (pid, d0, d1, kind, role, v, place) => { const dur = Math.max(2, Math.abs(d1 - d0) / v);
        segs.push([pid, kind, -1, [Math.round(t), Math.round(t + dur)], [Math.round(d0 * 10) / 10, Math.round(d1 * 10) / 10], place, 'loop:' + role]); t += dur; };
      const addT = (pid, d0, d1, role, dur) => { segs.push([pid, 'training', -1, [Math.round(t), Math.round(t + dur)], [Math.round(d0 * 10) / 10, Math.round(d1 * 10) / 10], null, 'loop:' + role]); t += dur; };
      R.legs.forEach((l, i) => {
        const place = i === 0 ? +p : null, last = i === R.legs.length - 1;
        if (last && R.gate != null && R.gate > l[1] + 2) { add(l[0], l[1], R.gate, 'training', 'in', V, place); t += 20; add(l[0], R.gate, l[2], 'training', 'gate', V, null); }
        else add(l[0], l[1], l[2], 'training', last ? 'gate' : 'in', V, place);
        if (l[3]) t += T.reverse;
      });
      // the laps: from #A95's junction (157) round, stopping a few seconds at each test stop (doors closed), back to 157.
      // The loop path goes round twice, so each hop is on it in one piece; at a stop the train is put back by one lap
      // (same place) when the next hop starts there (agents.js, cyclic paths).
      const Lp = T.lap, st = (T.stops || []).filter(x => x > 1 && x < Lp - 1), us = [0];
      for (let n = 0; n < laps; n++) st.forEach(x => us.push(n * Lp + x));
      us.push(laps * Lp);
      for (let i = 1; i < us.length; i++) {
        const len = us[i] - us[i - 1], d0 = us[i - 1] % Lp;
        addT(T.cycle, d0, d0 + len, 'lap', runTime(len));
        if (i < us.length - 1 && us[i] % Lp) t += T.dwell || 15;
      }
      add(T.ret[0], T.ret[1], T.ret[2], 'training', 'ret', V, null);
      t += 20; add(T.ret[0], T.ret[2], T.ret[2] + 0.1, 'to_depot', 'homewait', V, null);
      return { segs, end: t };
    }
    // the player sends train k round the loop: how = number of laps or 'until' (until its next duty)
    function sendToLoop(k, how) {
      const T = F.test, tr = F.trains[k], a = F.ag && F.ag.agents()[k], p = F.depot && F.depot.at[k];
      if (!a || p == null || !T.trip[p] || loopAhead(k)) return false;
      const S = L();
      if (S.a94 != null && S.a94 !== k) { D.loopMsg = `Attendi: il treno ${no(S.a94)} sta uscendo dall'anello passando dal #A94 verso ${F.depot.target[S.a94] != null ? name(F.depot.target[S.a94]) : 'il deposito'}.`; return false; }
      const inWay = ((T.trip_blocks || {})[p] || []).filter(x => taken().has(x));
      if (inWay.length) { D.loopMsg = 'La via per l\'anello passa da ' + inWay.map(name).join(', ') + ', occupato.'; return false; }
      const idx = a.mode === 'static' ? tr.segs.length : a.si, next = tr.segs[idx], t0 = Math.round(F.ag.S.t) + 20;
      const deadline = next ? next[3][0] - 600 : 27 * 3600, lapT = loopSegs(p, t0, 1).end - loopSegs(p, t0, 0).end;
      const room = deadline - loopSegs(p, t0, 0).end;
      const laps = how === 'until' ? Math.floor(room / lapT) : +how || 1;
      if (laps < 1) { D.loopMsg = 'Non c\'è tempo per un giro prima della prossima corsa' + (next ? ' (esce dal deposito alle ' + env.fmt(next[3][0]) + ')' : '') + '.'; return false; }
      const { segs, end } = loopSegs(p, t0, laps);
      tr.segs.splice(idx, 0, ...segs); shiftRefs(tr, idx - 1, segs.length); restamp(tr);
      a.mode = 'plan'; a.si = idx - 1; a.legs = []; a.wait = 0; a.status = 'parked';
      const g = laps === 1 ? 'un giro' : laps + ' giri';
      env.say('PC', `Treno ${no(k)}, dal ${name(p)} vai al segnale #A94 e chiedi l'anello di prova: ${g}. Passo.`, 'pc');
      env.say('T' + no(k), `Ricevuto PC, ${g} sull'anello di prova, vado al #A94. Passo.`, 'dr');
      D.loopMsg = (laps === 1 ? '1 giro' : laps + ' giri') + ', di ritorno verso le ' + env.fmt(end) + ' (se l\'anello è libero).';
      if (next && next[3][0] < RESERVE_T && end > next[3][0] - 300) D.loopMsg += ' Attenzione: il prossimo turno parte alle ' + env.fmt(next[3][0]) + ', sarà in ritardo.';
      return true;
    }
    // the agents ask before each move of their day: into the loop only with the loop given (#A94); the stand-in for the
    // way out waits for a place (only if the place was not given before leaving the loop)
    function holdAt(k, si) {
      const r = loopRole(F.trains[k].segs[si]); if (r !== 'gate' && r !== 'homewait') return false;
      const S = L(); if (!S.asked[k] || S.asked[k].si !== si) S.asked[k] = { si, since: F.ag.S.t, r, said: false };
      return true;
    }
    // the trip goes on from seg si now (it was held there)
    function release(k, si, role) {
      const tr = F.trains[k], s = tr.segs[si], a = F.ag.agents()[k], sh = Math.round(F.ag.S.t + 5) - s[3][0];
      for (let j = si; j < tr.segs.length && loopRole(tr.segs[j]); j++) tr.segs[j][3] = tr.segs[j][3].map(x => x + sh);
      s[6] = 'loop:' + role; restamp(tr); delete L().asked[k];
      a.si = si - 1; a.legs = []; a.wait = 0; a.why = null;
    }
    function grant(k, si, again) {
      const man = F.ag.il() && !F.ag.il().auto;
      env.say('PC', again ? `Treno ${no(k)}, l'anello di prova è libero: ${man ? 'attendi l\'apertura del #A94 ed' : 'via libera al #A94,'} entra. Passo.`
        : man ? `Treno ${no(k)}, autorizzato: l'anello di prova è tuo, attendi l'apertura del #A94. Passo.` : `Treno ${no(k)}, autorizzato: via libera al #A94, entra nell'anello di prova. Passo.`, 'pc');
      env.say('T' + no(k), 'Ricevuto, entro nell\'anello. Passo.', 'dr'); release(k, si, 'in2');
    }
    // the place for the way out of the loop, and the moves to it (replacing the stand-in at index si, and the move out
    // of the loop before it at si - 1 when it goes straight on)
    // Giovanni 28 Oct: the west sheds (A66-A75) cannot be reached from beyond #A95; a train given one of them leaves
    // the loop back through #A94 on w1, which is possible only while no other train is going to #A94 or waiting there
    const viaA94 = q => (F.test.a94_places || []).includes(name(q)) && !!(F.test.home94 || {})[q];
    const westShed = q => (F.test.a94_places || []).includes(name(q));
    const goingToA94 = (j, k) => { if (j === k || !loopAhead(j)) return false; const tr = F.trains[j], a = F.ag.agents()[j];
      for (let i = a ? a.si : 0; i < tr.segs.length; i++) { const r = loopRole(tr.segs[i]); if (r === 'in2' || r === 'lap') return false; if (r === 'in' || r === 'gate') return true; } return false; };
    const a94Busy = k => F.ag.agents().some((_, j) => goingToA94(j, k));
    // past94: the train already stands beyond #A95 (it can no longer go back through #A94)
    function placeForExit(k, si, past94) {
      const T = F.test, tr = F.trains[k], home = T.home, tk = taken(), by94 = !past94 && !a94Busy(k);
      const jn = nextOut(tr, si), sOut = jn >= 0 ? tr.segs[jn] : null;
      const ok = q => !tk.has(q) && F.depotPaths[q] && (!sOut || placeOf(sOut) === q || outChoice(sOut, q));
      const cand = Object.keys(home).filter(q => ok(q) && !westShed(q) && !((T.home_blocks || {})[q] || []).some(x => tk.has(x)))
        .concat(by94 ? Object.keys(T.home94 || {}).filter(q => ok(q) && viaA94(q)) : []);
      const len = q => viaA94(q) && by94 ? T.home94[q].legs.reduce((x, l) => x + Math.abs(l[2] - l[1]), 0)
        : home[q].legs.reduce((x, l) => x + Math.abs(l[2] - l[1]), 0) + (home[q].legs.length > 1 ? 400 : 0) + (home[q].straight ? 0 : 300);
      const cost = q => len(q) + (low(q) ? 1e5 : 0);
      cand.sort((p, q) => cost(p) - cost(q)); return cand[0] || null;
    }
    // back through #A94 (west sheds): the move out of the loop and the stand-in are replaced by one move to the place
    function routeOut94(k, si, q) {
      const T = F.test, tr = F.trains[k], H = T.home94[q], ret = tr.segs[si - 1];
      let t = Math.max(ret[3][0], Math.round(F.ag.S.t));
      const segs = H.legs.map((l, i) => { const dur = Math.max(2, Math.abs(l[2] - l[1]) / T.v_yard), last = i === H.legs.length - 1;
        const sg = [l[0], 'to_depot', -1, [Math.round(t), Math.round(t + dur)], [l[1], l[2]], last ? +q : null, 'loop:' + (i === 0 ? 'out94' : 'home')]; t += dur + (l[3] ? T.reverse : 0); return sg; });
      tr.segs.splice(si - 1, 2, ...segs); shiftRefs(tr, si - 1, segs.length - 2); restamp(tr);
      const g = si - 1 + segs.length - 1, hl = segs[segs.length - 1];
      F.depot.target[k] = q; F.depot.seg[k] = g; followPlace(tr, g, q, hl[0], hl[4][1]);
    }
    function routeOut(k, si, q) {
      const T = F.test, tr = F.trains[k], H = T.home[q], ret = tr.segs[si - 1], straight = H.straight && loopRole(ret) === 'ret';
      let t = Math.max(ret[3][0], Math.round(F.ag.S.t)), segs = [];
      if (!straight) { segs.push(ret); t = ret[3][1] + T.reverse; }
      H.legs.forEach((l, i) => { const dur = Math.max(2, Math.abs(l[2] - l[1]) / T.v_yard), last = i === H.legs.length - 1;
        segs.push([l[0], 'to_depot', -1, [Math.round(t), Math.round(t + dur)], [l[1], l[2]], last ? +q : null, 'loop:' + (i === 0 && straight ? 'out' : 'home')]); t += dur + (l[3] ? T.reverse : 0); });
      tr.segs.splice(si - 1, 2, ...segs); shiftRefs(tr, si - 1, segs.length - 2); restamp(tr);
      const g = si - 1 + segs.length - 1, hl = segs[segs.length - 1];
      F.depot.target[k] = q; F.depot.seg[k] = g; followPlace(tr, g, q, hl[0], hl[4][1]);
      return straight;
    }
    function loopTick() {
      if (!F.test || !F.test.trip) return;
      const S = L(), ag = F.ag, t = ag.S.t, T = F.test, half = F.engine.half;
      const zi = ZI(), il = ag.il(); if (zi == null) return;
      if (holder() != null && !loopAhead(holder())) IL().zoneFree(il, zi, holder());
      if (S.a94 != null && !loopAhead(S.a94)) delete S.a94;          // back in its west shed: #A94 is open again
      // the loop is free when the train's tail is past the flag beyond #A95: a notice, then the next one goes in
      const freed = k => {
        const by94 = S.exit[k] && S.exit[k].a94; delete S.exit[k];
        env.say('T' + no(k), `PC, qui treno ${no(k)}: sono fuori dall'anello, dopo il ${by94 ? '#A94' : '#A95'}. Anello di prova libero. Passo.`, 'ok');
        const nx = IL().zoneFree(il, zi, k); if (nx != null && S.asked[nx] && S.asked[nx].r === 'gate') grant(nx, S.asked[nx].si, true);
      };
      // before leaving the loop: it says it has finished and gets its place
      ag.agents().forEach((a, k) => {
        if (a.mode !== 'plan') return;
        const tr = F.trains[k], s = tr.segs[a.si], r = loopRole(s);
        if (r === 'lap' && loopRole(tr.segs[a.si + 1]) === 'ret' && a.d > T.lap - 450 && !S.exit[k]) {
          const si = a.si + 2, q = placeForExit(k, si);
          S.exit[k] = { q };
          env.say('T' + no(k), `PC, qui treno ${no(k)}: giri finiti, esco dall'anello dal #A96. Passo.`, 'ok');
          if (q == null) { env.say('PC', `Ricevuto treno ${no(k)}: nessun posto libero, fermati dopo il #A95 e attendi. Passo.`, 'pc'); return; }
          if (viaA94(q)) {                 // west sheds: back through #A94 (nobody is going there now: kept so until it is in)
            routeOut94(k, si, q); S.exit[k].a94 = true; S.a94 = k;
            env.say('PC', `Ricevuto treno ${no(k)}, vai in ${name(q)}: esci dall'anello passando dal #A94. Passo.`, 'pc');
            env.say('T' + no(k), `Vado in ${name(q)} dal #A94. Passo.`, 'dr'); return;
          }
          const straight = routeOut(k, si, q);
          env.say('PC', `Ricevuto treno ${no(k)}, vai in ${name(q)}${straight ? '' : ': fermati dopo il #A95 e cambia banco'}. Passo.`, 'pc');
          env.say('T' + no(k), `Vado in ${name(q)}. Passo.`, 'dr');
        }
        const ex = S.exit[k];
        if (ex && ex.q != null && !ex.free) {
          const H94 = ex.a94 && (T.home94 || {})[ex.q];
          const out = r === 'out' && a.d - half > T.free_at - half && a.d >= T.free_at || r === 'out94' && H94 && a.d >= H94.free_at,
            back = r === 'home' || (r == null && !loopAhead(k));
          if (out || back) { ex.free = true; freed(k); }
        }
      });
      for (const [ks, w] of Object.entries(S.asked)) {
        const k = +ks, tr = F.trains[k], a = ag.agents()[k];
        if (!a || a.si !== w.si || loopRole(tr.segs[w.si]) !== w.r) { delete S.asked[k]; continue; }
        if (w.r === 'gate' && !w.said) {
          w.said = true; const h = Math.floor(t / 3600) % 24, hi = h >= 5 && h < 14 ? 'Buongiorno' : 'Buonasera';
          env.call(tr, `${hi} PC, qui treno ${no(k)}, fermo al segnale #A94: chiedo l'autorizzazione per entrare nell'anello di prova. Passo.`);
          if (IL().zoneAsk(il, zi, k)) grant(k, w.si, false);
          else { env.say('PC', `Negativo treno ${no(k)}: l'anello di prova è occupato dal treno ${no(holder())}. Resta fermo al #A94, ti richiamo io. Passo.`, 'pc'); env.say('T' + no(k), 'Ricevuto, resto fermo al #A94. Passo.', 'dr'); }
        } else if (w.r === 'homewait') {
          // standing past #A95 without a place (none was free before it left the loop): try again
          const q = placeForExit(k, w.si, true); if (q == null) continue;
          if (S.exit[k] && !S.exit[k].free) { S.exit[k].free = true; freed(k); }
          env.say('PC', `Treno ${no(k)}, vai in ${name(q)}. Passo.`, 'pc');
          const tr2 = F.trains[k], s = tr2.segs[w.si], H = T.home[q], tt = Math.round(t + (H.straight ? 5 : T.reverse)); let x = tt;
          const segs = H.legs.map((l, i) => { const dur = Math.max(2, Math.abs(l[2] - l[1]) / T.v_yard), last = i === H.legs.length - 1;
            const sg = [l[0], 'to_depot', -1, [Math.round(x), Math.round(x + dur)], [i === 0 && H.straight ? s[4][0] : l[1], l[2]], last ? +q : null, 'loop:home']; x += dur + (l[3] ? T.reverse : 0); return sg; });
          tr2.segs.splice(w.si, 1, ...segs); shiftRefs(tr2, w.si, segs.length - 1); restamp(tr2);
          const g = w.si + segs.length - 1, hl = segs[segs.length - 1]; F.depot.target[k] = q; F.depot.seg[k] = g; followPlace(tr2, g, q, hl[0], hl[4][1]);
          delete S.asked[k]; const a2 = ag.agents()[k]; a2.si = w.si - 1; a2.legs = []; a2.wait = 0; a2.why = null;
        }
      }
    }

    Object.assign(D, { init, tick, newDay, assign, pick, pastEntrance, rewriteOut, taken, name, placeOf, loopRole, loopInfo, sendToLoop, holdAt, standsAt, isOut });
    return D;
  }

  const api = { create, LOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLDepotM3 = api;
})(typeof window !== 'undefined' ? window : globalThis);
