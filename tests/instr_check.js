// The PC's instructions to a train standing in a closed stretch (Pannello PC): ahead to a station, back the wrong way
// to a station, to the depot, to a Comasina tail. For a few closures: close at 08:00, at 08:06 every option of every
// train standing inside is tried (one per run), then 40 minutes: the train gets where it was sent (standing there,
// in service from there, in the depot or in a tail; only the moves with nobody in the way now), never two trains on one track piece, no signal or switch passed
// without its route. Usage (from build/): node ../tests/instr_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const day = L.runDay(M, D), CL = M.net.closures, H = M.half;
const PICK = ['Porta Romana – Centrale FS', 'Rogoredo FS – Porta Romana', 'Centrale FS – Comasina', 'San Donato – Lodi T.I.B.B.'];
const TC = 8 * 3600; let fail = 0, tried = 0;
for (const lab of PICK) {
  const c = CL.find(x => x.label === lab); if (!c) continue;
  const mk = () => { const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(TC - 600, L.posAt(day, TC - 600)); ag.step(TC); ag.event({ kind: 'close', cl: { a: c.a, b: c.b }, label: c.label }); ag.step(TC + 360); return ag; };
  const ag0 = mk(), cands = [];
  ag0.agents().forEach(a => ag0.instrOptions(a.k).forEach(o => { if (!o.blocked.length) cands.push([a.k, o]); }));
  // one of each kind per closure (ahead closed, ahead open, back closed, back open, depot, tail)
  const kinds = {}; for (const [k, o] of cands) { const kd = o.key === 'dep' || o.key === 'tail' ? o.key : (o.back ? 'b' : 'a') + (o.open ? 'open' : ''); if (!kinds[kd]) kinds[kd] = [k, o]; }
  for (const [kd, [k, o]] of Object.entries(kinds)) {
    const ag = mk(); tried++;
    const pre = ag.instrPreview(k, o.key), r = ag.event({ kind: 'order', k, what: 'instr', arg: { key: o.key } });
    let overlap = 0, served = false;
    for (let t = TC + 390; t <= TC + 360 + 2400; t += 30) {
      ag.step(t);
      // (in service from there: at some moment in the 40 minutes at another open station; at the end it may well be back
      // at the one it was sent to, going round the limited service)
      { const b = ag.agents()[k]; if (o.open && (b.mode === 'shuttle' || b.mode === 'timetable') && b.at != null && ag.S.parts.some(p => b.at >= p[0] && b.at <= p[1]) && b.at !== o.st) served = true; }
      const by = new Map(); ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
        for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue; const kk = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
          (by.get(ei) || by.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * kk : (x1 - q) * kk, dir > 0 ? (q - x0) * kk : (x1 - p) * kk]); } });
      for (const l of by.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (l[i][0] !== l[j][0] && Math.max(l[j][1] - l[i][2], l[i][1] - l[j][2]) < 0) overlap++;
    }
    const a = ag.agents()[k], rt = ag.rt(), G = M.degraded;
    const atSt = a.at != null ? G.names[a.at] : '?';
    const arrived = o.key === 'dep' ? a.hidden : o.key === 'tail' ? a.status === 'parked' : o.open ? served : (a.status === 'stopped' && a.at === o.st);
    const bad = !r || !pre || !pre.length || !arrived || overlap || rt.viol || rt.swViol;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${lab} · treno ${k + 1}: ${o.label} | given ${!!r}, preview ${pre ? pre.length + ' moves' : 'none'} | after 40 min: ${a.mode}/${a.status} at ${atSt}${a.hidden ? ' (deposito)' : ''}${bad ? ' why ' + JSON.stringify(a.red && a.red.now || a.why) + ' leg ' + JSON.stringify((a.legs[0] || {}).kind || [(a.legs[0] || {}).pid, Math.round((a.legs[0] || {}).start), Math.round((a.legs[0] || {}).end)]) + ' d ' + Math.round(a.d) + ' pid ' + a.pid : ''} | overlaps ${overlap} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0}`);
    if (bad) fail++;
  }
}
console.log(`instructions tried: ${tried}`);
process.exit(fail || !tried ? 1 : 0);
