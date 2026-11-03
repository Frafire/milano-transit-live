// Failures (web/faults.js, foglio Guasti, fase D1). For each kind of failure of a train: give it at 08:00 to a train
// in service, nobody answers (the PC answers by itself after 3 minutes), run to 10:00. Checks: the train does what the
// failure says (stands for the re-arming, longer at the station...), the failure ends (not the ATO one: manual all day),
// no signal or switch passed without its route, no two trains on one track piece. Then the random failures from 06:00 to
// 13:00: some happen, all end, the same again gives the same day, also after going back in time.
// Usage (from build/): node ../tests/faults_check.js [kind]
const L = require('./lib.js');
const { M, D } = L.load();
const day = L.runDay(M, D), H = M.half;
const FK = require('../web/faults.js').KINDS, ARG = process.argv[2];
const KINDS = Object.keys(FK).filter(k => !FK[k].on && (!ARG || k === ARG)), LINE = Object.keys(FK).filter(k => ['signal', 'switch'].includes(FK[k].on) || k === 'tensione').filter(k => !ARG || ARG === 'line' || k === ARG);
const PEOPLE = Object.keys(FK).filter(k => (FK[k].on === 'station' || k === 'tunnel') && (!ARG || ARG === 'people' || k === ARG));
let fail = 0;
function overlaps(ag) {
  const byEdge = new Map(); let n = 0;
  ag.agents().forEach(a => { if (a.hidden) return; const pe = M.path_edges[a.pid]; if (!pe) return;
    for (const [ei, dir, x0, x1] of pe.e) { if (x1 < a.d - H || x0 > a.d + H) continue;
      const k = (M.net.edges[ei].len || 1) / ((x1 - x0) || 1), p = Math.max(a.d - H, x0), q = Math.min(a.d + H, x1);
      (byEdge.get(ei) || byEdge.set(ei, []).get(ei)).push([a.k, dir > 0 ? (p - x0) * k : (x1 - q) * k, dir > 0 ? (q - x0) * k : (x1 - p) * k]); } });
  for (const list of byEdge.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i][0] !== list[j][0] && Math.max(list[j][1] - list[i][2], list[i][1] - list[j][2]) < 0) n++;
  return n;
}
const T0 = 8 * 3600, T1 = 10 * 3600, T1x = { soccorso: 11 * 3600, atp: 11 * 3600, udt: 10.5 * 3600 };
for (const kind of ['line', 'people', 'rescue', 'strike'].includes(ARG) ? [] : KINDS) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  // a train in service, running, in the middle of the line
  const a = ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 17);
  const id = ag.event({ kind: 'fault', what: 'new', fault: kind, k: a.k });
  let ov = 0, stood = 0, longDwell = 0, endT = null, phases = new Set(), lastD = a.d, vAtp = 0, rk = null;
  for (let t = T0 + 10; t <= (T1x[kind] || T1); t += 10) {
    ag.step(t);
    const f = ag.S.faults.list.find(x => x.id === id);
    phases.add(f.ph + (f.tech ? '/' + f.tech : '')); if (f.rk != null) rk = f.rk; if (kind === 'atp' && !f.done) vAtp = Math.max(vAtp, a.v * 3.6);
    if (f.done && endT == null) endT = f.done;
    if (!f.done) { if (a.v === 0 && a.stopAt == null) stood += 10; if (a.stopAt != null && a.v === 0) longDwell += 10; }
    if (t % 60 === 0) ov += overlaps(ag);
  }
  const rt = ag.rt(), f = ag.S.faults.list.find(x => x.id === id), say = ag.S.faults.feed.filter(x => x.id === id || x.k === a.k);
  // what must happen: the train stands (re-arming), longer at a station, manual driving, the failure is over
  const homed = a.hidden || a.status === 'parked' || a.mode === 'home';
  const want = { udt: homed && [...phases].includes('udt'), atp: homed && vAtp <= 30.5, soccorso: [...phases].includes('towed') && homed && (rk == null || ag.agents()[rk].hidden || ag.agents()[rk].status === 'parked' || ag.agents()[rk].mode === 'home'),
                 secondario: [...phases].some(x => x.endsWith('/board')), trazione: stood + longDwell >= 60, freno: stood >= 60, riarmo: stood >= 80, porta: longDwell >= 60, porte_persone: longDwell >= 30,
                 allarme: longDwell >= 60, malore_treno: longDwell >= 1200, ato: true }[kind];
  const ended = kind === 'ato' ? !f.done || a.hidden || a.status === 'parked' : kind === 'atp' || kind === 'soccorso' || kind === 'udt' ? homed : f.done != null;
  const techOk = kind !== 'riarmo' || [...phases].some(x => x.endsWith('/board'));
  const bad = !id || ov || rt.viol || rt.swViol || !want || !ended || !techOk;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${kind} on train ${a.k + 1}: phases ${[...phases].join(' > ')} | standing in the line ${Math.round(stood / 60)} min, at stations ${Math.round(longDwell / 60)} min | ${kind === 'ato' ? (f.done ? 'manual until it left the service' : 'still manual at 10:00') : 'over at ' + (endT ? new Date(endT * 1000).toISOString().slice(11, 16) : 'never')} | radio ${say.length} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  for (const m of say.slice(0, 4)) console.log('       ' + new Date(m.t * 1000).toISOString().slice(11, 19) + ' ' + m.who + ': ' + m.text.replace('{T}', a.k + 1));
  if (bad) fail++;
}
// the failures of the line (D2): on the line in front of a running train at 08:00; the PC answers by itself.
// Checks: the trains stopped by it ask for the marcia a vista and go by at walking pace; the failure ends; afterwards
// no train stands still for 25 minutes; no route missing, no two trains on one piece
for (const kind of ['people', 'rescue', 'strike'].includes(ARG) ? [] : LINE) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now(), FX = ag.FX;
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  const a = ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 15);
  // the target: the second signal in front of it, the first switch of the line in front of it, the stretch in front of it
  const sigs = ag.RT.ahead(a.pid, a.d + H + 50, 3000).filter(c => FX.targets('segnale').some(x => x.v === c.n));
  const sws = FX.targets('scambio').map(x => x.v), swA = ag.RT.switchesOn(a.pid, a.d + H, 1e9).find(x => sws.includes(x[1]));
  const target = kind === 'scambio' ? (swA ? swA[1] : sws[0]) : kind === 'tensione' ? ((a.legs[0] || {}).dir === 'S' ? a.at - 1 : a.at) : (sigs[1] || sigs[0]).n;
  const id = ag.event({ kind: 'fault', what: 'new', fault: kind, target });
  let ov = 0, endT = null, vistaMax = 0, vistaGo = 0, stoodOff = 0, inside = 0, phases = new Set();
  const TE = T1 + 1800, moved = new Map();
  for (let t = T0 + 10; t <= TE; t += 10) {
    ag.step(t);
    const f = ag.S.faults.list.find(x => x.id === id); phases.add(f.ph); if (f.done && endT == null) endT = f.done;
    ag.agents().forEach(x => { if (x.avista && !x.hidden) vistaMax = Math.max(vistaMax, x.v * 3.6);
      const m = moved.get(x.k); if (!m || Math.abs(m.d - x.d) > 1 || m.pid !== x.pid) moved.set(x.k, { d: x.d, pid: x.pid, t }); });
    if (kind === 'tensione' && !f.done && (ag.S.zones || []).length) stoodOff = Math.max(stoodOff, ag.agents().filter(x => !x.hidden && x.v === 0 && (x.why === 'tensione' || (((x.red && (x.red.now || x.red.why)) || {}).route || {}).power)).length);
    if (kind === 'tensione' && !f.done && (ag.S.zones || []).length) inside = Math.max(inside, ag.agents().filter(x => !x.hidden && x.why === 'tensione').length);
    if (t % 60 === 0) ov += overlaps(ag);
  }
  vistaGo = ag.S.faults.list.filter(x => x.kind === 'vista' && x.ph === 'go').length;
  const rt = ag.rt(), f = ag.S.faults.list.find(x => x.id === id);
  const stuck = ag.agents().filter(x => { const m = moved.get(x.k); return !x.hidden && x.status !== 'parked' && x.mode !== 'static' && m && TE - m.t > 1500 && !(ag.S.t < x.wait); }).length;
  const want = kind === 'tensione' ? stoodOff > 0 && inside > 0 : vistaGo > 0 && vistaMax <= 15.5;
  const bad = !id || ov || rt.viol || rt.swViol || !want || endT == null || stuck;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${kind} ${f.what}: phases ${[...phases].join(' > ')} | over at ${endT ? new Date(endT * 1000).toISOString().slice(11, 16) : 'never'} | marcia a vista: ${vistaGo} trains, fastest ${vistaMax.toFixed(1)} km/h${kind === 'tensione' ? ' | trains standing: ' + stoodOff + ' (in the stretch: ' + inside + ')' : ''} | stuck 25+ min at the end: ${stuck} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  for (const m of ag.S.faults.feed.filter(x => x.id === id).slice(0, 5)) console.log('       ' + new Date(m.t * 1000).toISOString().slice(11, 19) + ' ' + m.who + ': ' + m.text);
  if (bad) fail++;
}
// people and emergencies (D3): at the next station of a running train (the tunnel: the stretch it is in), the PC
// answers by itself. Checks: the trains stop in the red zone (none moves after 20 s of red), the trains slow down
// through the station (malore: 15 km/h), the first trains after the tunnel go through at walking pace, the station
// is closed and opened again; the failure ends; 40 minutes later no train stands still for 25 minutes
for (const kind of PEOPLE) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  const a = ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 15), dir = (a.legs[0] || {}).dir;
  const X = kind === 'tunnel' ? (dir === 'S' ? a.at - 1 : a.at) : dir === 'S' ? a.at - 1 : a.at + 1;
  const id = ag.event({ kind: 'fault', what: 'new', fault: kind, target: X });
  let clSeen = false, ov = 0, endT = null, movingRed = 0, slowMax = 0, vistaMax = 0, closedSeen = false, zonesSeen = new Set(), phases = new Set(), t = T0;
  const moved = new Map(), zv = new Map();
  for (t = T0 + 10; t <= 16 * 3600; t += 10) {
    ag.step(t);
    const f = ag.S.faults.list.find(x => x.id === id); phases.add(f.ph); if (f.done && endT == null) endT = f.done;
    for (const z of ag.zones()) { zonesSeen.add(z.kind); if (!zv.has(z.id)) zv.set(z.id, t); }
    if (ag.S.stn[X] && ag.S.stn[X].closed) closedSeen = true; if (ag.S.cl) clSeen = true;
    ag.agents().forEach(x => { if (x.hidden) return;
      if (x.why === 'rosso' && x.v > 0.1 && ag.zones().some(z => z.kind === 'red' && t - zv.get(z.id) > 20)) movingRed++;
      if (ag.zonesOf(x).includes('vista') && x.zv && !(ag.zones().find(z => z.id === x.zv.id) || { done: {} }).done[x.zv.T]) vistaMax = Math.max(vistaMax, x.v * 3.6);
      if (kind === 'malore_stazione' && ag.zonesOf(x).includes('slow')) slowMax = Math.max(slowMax, x.v * 3.6);
      const m = moved.get(x.k); if (!m || Math.abs(m.d - x.d) > 1 || m.pid !== x.pid) moved.set(x.k, { d: x.d, pid: x.pid, t }); });
    if (t % 60 === 0) ov += overlaps(ag);
    if (endT != null && t > endT + (kind === 'investimento' ? 3600 : 2400) && t > T1) break;     // (after hours of closure: an hour to settle)
  }
  const rt = ag.rt(), f = ag.S.faults.list.find(x => x.id === id);
  const stuck = ag.agents().filter(x => { const m = moved.get(x.k); return !x.hidden && x.status !== 'parked' && x.mode !== 'static' && m && t - m.t > 1500 && !(ag.S.t < x.wait); }).length;
  const want = { persona: zonesSeen.has('red') && zonesSeen.has('power') && !movingRed, tunnel: zonesSeen.has('red') && zonesSeen.has('vista') && vistaMax <= 15.5 && !movingRed,
                 investimento: zonesSeen.has('red') && closedSeen && !(ag.S.stn[X] && ag.S.stn[X].closed) && clSeen && !ag.S.cl, incendio: closedSeen && !(ag.S.stn[X] && ag.S.stn[X].closed), prefettura: closedSeen && !(ag.S.stn[X] && ag.S.stn[X].closed),
                 malore_stazione: zonesSeen.has('slow') && slowMax <= 15.5, oggetto: true }[kind];
  const bad = !id || ov || rt.viol || rt.swViol || !want || endT == null || stuck || ag.zones().some(z => z.kind !== 'vista');
  console.log(`${bad ? 'FAIL' : 'ok  '} ${kind} ${f.what}: phases ${[...phases].join(' > ')} | over at ${endT ? new Date(endT * 1000).toISOString().slice(11, 16) : 'never'} | zones ${[...zonesSeen].join(', ') || '-'} | moving after the red button: ${movingRed} | ${kind === 'malore_stazione' ? 'fastest at the station ' + slowMax.toFixed(1) + ' km/h | ' : ''}${kind === 'tunnel' ? 'marcia a vista ' + vistaMax.toFixed(1) + ' km/h | ' : ''}station closed: ${closedSeen} | stuck 25+ min at the end: ${stuck} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  for (const m of ag.S.faults.feed.filter(x => x.id === id).slice(0, 6)) console.log('       ' + new Date(m.t * 1000).toISOString().slice(11, 19) + ' ' + m.who + ': ' + m.text);
  if (bad) fail++;
}
// the rescue of a train with both units dead, each way: the train behind pushes (15 km/h), the train in front comes
// back and pulls (30 km/h), the Badoni from ROD (the line without power on the way). Checks: the broken train is taken
// away (depot or tail), the rescuing train too, nothing passes a signal without a route, no two trains overlap
if (!ARG || ARG === 'rescue') for (const how of ['rback', 'rfront', 'badoni']) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  const a = ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 15);
  const id = ag.event({ kind: 'fault', what: 'new', fault: 'soccorso', k: a.k });
  let ov = 0, answered = false, vmax = 0, phases = new Set(), t;
  for (t = T0 + 10; t <= 11 * 3600; t += 10) {
    ag.step(t); const f = ag.S.faults.list.find(x => x.id === id); phases.add(f.ph);
    if (!answered && f.call && f.call.opts.includes(how)) { answered = true; ag.event({ kind: 'fault', what: 'answer', id, answer: how }); }
    if (f.ph === 'towed') vmax = Math.max(vmax, a.v * 3.6);
    if (t % 60 === 0) ov += overlaps(ag);
    if (f.done && t > f.done + 600) break;
  }
  const f = ag.S.faults.list.find(x => x.id === id), r = f.rk != null ? ag.agents()[f.rk] : null, rt = ag.rt();
  const gone = x => x && (x.hidden || x.status === 'parked' || x.mode === 'home');
  const want = answered && f.done != null && gone(a) && (how === 'badoni' || (gone(r) && vmax <= (how === 'rfront' ? 30.5 : 15.5)));
  const bad = !want || ov || rt.viol || rt.swViol;
  console.log(`${bad ? 'FAIL' : 'ok  '} rescue ${how} of train ${a.k + 1}${r ? ' by train ' + (r.k + 1) : ''}: phases ${[...phases].join(' > ')} | over at ${f.done ? new Date(f.done * 1000).toISOString().slice(11, 16) : 'never'} | fastest towed ${vmax.toFixed(1)} km/h | broken train ${a.hidden ? 'in the depot' : a.status} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  for (const m of ag.S.faults.feed.filter(x => x.id === id).slice(-4)) console.log('       ' + new Date(m.t * 1000).toISOString().slice(11, 19) + ' ' + m.who + ': ' + m.text);
  if (bad) fail++;
}
// the Badoni from ROD on the map (Giovanni 3 Nov 2026): a train going to San Donato with nobody between it and San Donato;
// both units dead, the DCT sends the Badoni. Checks: it leaves San Donato, goes up to the train at most at its top speed,
// couples, brings the train back towards San Donato at most at the towing speed; the train is taken into the depot
if (!ARG || ARG === 'rescue' || ARG === 'badoni') {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now();
  ag.start(T0 - 600, L.posAt(day, T0 - 600)); ag.step(T0);
  const S_ = ag.agents().filter(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at >= 3 && (x.legs[0] || {}).dir === 'S').sort((p, q) => p.at - q.at);
  const a = S_[0], id = a ? ag.event({ kind: 'fault', what: 'new', fault: 'soccorso', k: a.k }) : null;
  let answered = false, bd = null, sts = [], vB = 0, vT = 0, prev = null, ov = 0, t;
  for (t = T0 + 10; a && t <= 12 * 3600; t += 10) {
    ag.step(t); const f = ag.S.faults.list.find(x => x.id === id);
    if (!answered && f.call && f.call.opts.includes('badoni')) { answered = true; ag.event({ kind: 'fault', what: 'answer', id, answer: 'badoni' }); }
    if (f.bd) { bd = bd || JSON.parse(JSON.stringify(f.bd)); if (sts[sts.length - 1] !== f.bd.st) sts.push(f.bd.st);
      if (prev && prev.st === f.bd.st) { const v = Math.abs(f.bd.d - prev.d) / 10 * 3.6; if (f.bd.st === 'coming') vB = Math.max(vB, v); if (f.bd.st === 'tow') vT = Math.max(vT, v); }
      prev = { st: f.bd.st, d: f.bd.d }; }
    if (t % 60 === 0) ov += overlaps(ag);
    if (f.done && t > f.done + 300) break;
  }
  const f = a && ag.S.faults.list.find(x => x.id === id), rt = ag.rt();
  const want = a && answered && bd && sts.join('>') === 'prep>coming>coupling>tow' && f.done != null && a.hidden && vB <= 25.5 && vB > 10 && vT <= 15.5 && vT > 5;
  const bad = !want || ov || rt.viol || rt.swViol;
  console.log(`${bad ? 'FAIL' : 'ok  '} badoni on the map for train ${a ? a.k + 1 : '-'}: ${sts.join(' > ')} | fastest out ${vB.toFixed(1)} km/h, towing ${vT.toFixed(1)} km/h | over at ${f && f.done ? new Date(f.done * 1000).toISOString().slice(11, 16) : 'never'} | broken train ${a && a.hidden ? 'in the depot' : a && a.status} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  if (bad) fail++;
}
// a strike day (D5): 30% of the drivers, from 06:00 to 19:00, both answers of the DCT. Checks: at 8:45 the trains on
// strike ask to go back and are in the depot or a tail by 10:30; at 15:00 they come back and run passenger runs; at
// 18:00 they go back again; the others go on; nothing without a route, no overlaps
if (!ARG || ARG === 'strike') for (const how of ['freq', 'gaps']) {
  const ag = L.agents(M, D, t => L.posAt(day, t)), t0 = Date.now(), S0 = 6 * 3600;
  ag.start(S0 - 600, L.posAt(day, S0 - 600)); ag.step(S0);
  const id = ag.event({ kind: 'fault', what: 'new', fault: 'sciopero', target: 30 }); ag.event({ kind: 'fault', what: 'answer', id, answer: how });
  const f = ag.S.faults.list.find(x => x.id === id), K = f.strikers;
  let ov = 0, outAt1030 = 0, backService = 0, outAt1930 = 0, inService1200 = 0, calls = 0;
  for (let t = S0 + 30; t <= 19.5 * 3600; t += 30) {
    ag.step(t);
    if (t % 120 === 0) ov += overlaps(ag);
    if (t === 10.5 * 3600) outAt1030 = K.filter(k => { const x = ag.agents()[k]; return x.hidden || x.status === 'parked'; }).length;
    if (t === 12 * 3600) inService1200 = ag.agents().filter(x => !x.hidden && x.status === 'service').length;
    if (t > 15.5 * 3600 && t < 17.5 * 3600) backService = Math.max(backService, K.filter(k => { const x = ag.agents()[k]; return !x.hidden && x.status === 'service'; }).length);
    if (t === 19.5 * 3600) outAt1930 = K.filter(k => { const x = ag.agents()[k]; return x.hidden || x.status === 'parked'; }).length;
  }
  calls = ag.S.faults.list.filter(x => x.kind === 'rientro').length;
  const rt = ag.rt(), bad = ov || rt.viol || rt.swViol || outAt1030 < K.length * 0.7 || backService < 1 || outAt1930 < K.length * 0.5 || inService1200 < 5;
  console.log(`${bad ? 'FAIL' : 'ok  '} strike 30% (${how}): ${K.length} trains on strike | asked to go back ${calls} | in the depot or a tail at 10:30: ${outAt1030}, at 19:30: ${outAt1930} | back in service after 15:00: ${backService} | trains in service at 12:00: ${inService1200} | overlaps ${ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  if (bad) fail++;
}
// random failures: 06:00 to 13:00, twice the same; then back to 09:00 and on again to 13:00
if (!process.argv[2]) {
  const R0 = 6 * 3600, R1 = 13 * 3600;
  const runR = () => { const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(R0 - 600, L.posAt(day, R0 - 600)); ag.step(R0); ag.event({ kind: 'fault', what: 'random', on: true });
    let ov = 0; for (let t = R0 + 60; t <= R1; t += 60) { ag.step(t); ov += overlaps(ag); } return { ag, ov }; };
  const t0 = Date.now(), A = runR(), B = runR(), key = ag => ag.S.faults.list.map(f => `${f.t0}:${f.kind}:${f.k}:${f.done}`).join(',');
  const byKind = {}; A.ag.S.faults.list.forEach(f => { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
  const open = A.ag.S.faults.list.filter(f => !f.done && f.kind !== 'ato' && f.t0 < R1 - 2 * 3600).length;
  const same = key(A.ag) === key(B.ag);
  A.ag.seek(9 * 3600); A.ag.seek(R1); const again = key(A.ag) === key(B.ag);
  const rt = A.ag.rt(), n = A.ag.S.faults.list.length;
  const bad = !n || A.ov || rt.viol || rt.swViol || open || !same || !again;
  console.log(`${bad ? 'FAIL' : 'ok  '} random 06:00-13:00: ${n} failures ${JSON.stringify(byKind)} | not over 2 h later: ${open} | the same twice: ${same}, after going back to 09:00: ${again} | overlaps ${A.ov} | without route: signals ${rt.viol || 0}, switches ${rt.swViol || 0} | ${Date.now() - t0} ms`);
  if (bad) fail++;
}
process.exit(fail ? 1 : 0);
