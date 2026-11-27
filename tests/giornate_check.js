// Two whole days on the engine with a DCT who goes along (27 Nov 2026): an investimento at Porto di Mare in the afternoon
// (San Donato – Lodi T.I.B.B. closed for hours, the trains due out of the depot kept in, the reopening in the evening) and a
// strike at 90% (the whole line closed outside the guaranteed bands, reopened for 15:00-18:00). What went wrong when
// they were played: a train left for ever at a signal of the depot, two trains sent to the same ricovero, a train parked
// in a tail of Comasina that took its next run out of the depot from there, the service of a strike day that never ended.
const L = require('./lib.js');
const { M, D } = L.load(), day = L.runDay(M, D), names = M.degraded.names, last = names.length - 1;
const hm = t => Math.floor(t / 3600) + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0');
let bad = 0;
const fail = (what, x) => { bad++; console.log('FAIL ' + what + (x != null ? ': ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); };
function play(T0, T1, each) {
  const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T0, L.posAt(day, T0)); ag.step(T0);
  const answered = {}, instr = {}, st = { ag, worst: 0, worstK: null, orders: 0, reopened: null, ricDouble: 0 };
  for (let t = T0; t < T1; t += 10) {
    ag.step(t); each(ag, t, st);
    // the DCT answers every call with its first option, a minute after it comes
    for (const f of ag.FX.list()) { if (!f.call || f.done) continue; const key = f.id + ':' + f.ph + ':' + (f.call.opts || []).join(',');
      if (answered[key] == null) { answered[key] = t; continue; } if (answered[key] === true || t - answered[key] < 60) continue;
      const o = (f.call.opts || [])[0]; answered[key] = true; if (o) ag.event({ kind: 'fault', what: 'answer', id: f.id, answer: o }); }
    // the trains standing in a closed stretch: the first order with nobody on its way (out of it, the depot, a tail, a ricovero)
    for (const a of ag.agents()) { if (!a || a.hidden || a.mode !== 'inside' || a.v > 0.1 || (a.legs && a.legs.length) || (instr[a.k] && t - instr[a.k] < 1800)) continue;
      const ops = ag.instrOptions(a.k) || [], free = ops.filter(x => !x.ill && !(x.blocked && x.blocked.length));
      const o = free.find(x => x.open) || free.find(x => x.key === 'dep') || free.find(x => x.key === 'tail') || free.find(x => /^[A-Z]/.test(x.key)) || ops.find(x => x.key === 'ill:dep' && !(x.blocked && x.blocked.length));
      if (o) { instr[a.k] = t; st.orders++; ag.event({ kind: 'order', k: a.k, what: 'instr', arg: { key: o.key } }); } }
    if (ag.S.cl) st.reopened = null; else if (st.reopened == null) st.reopened = t;
    // a train waiting at a red with the line open (not in the first quarter of an hour after a reopening)
    const A = ag.agents().filter(a => a && !a.hidden);
    if (!ag.S.cl && t - st.reopened > 900) for (const a of A) if (a.red && a.mode !== 'static' && a.red.since > st.reopened) { const w = t - a.red.since; if (w > st.worst) { st.worst = w; st.worstK = a.k; } }
    // two trains for one ricovero
    const ric = {}; for (const a of A) { const r = a.inTail || (a.legs.find(l => l.kind === 'ricIn' || l.kind === 'ricPark') || {}).ric; if (r) ric[r] = (ric[r] || 0) + 1; }
    if (Object.values(ric).some(n => n > 1)) st.ricDouble++;
  }
  return st;
}
const out = ag => ag.agents().filter(a => a && !a.hidden && a.mode !== 'static' && a.mode !== 'plan').map(a => [a.k + 1, a.mode, a.status, a.pid, Math.round(a.d)]);

// ---- 1. investimento at Porto di Mare, 16:12
{
  const X = names.findIndex(n => /PORTO DI MARE/i.test(n)), T = 16.2 * 3600; let id = null, closed = null, opened = null;
  const st = play(T - 1200, 26.6 * 3600, (ag, t) => {
    if (!id && t >= T && !ag.FX.cannot('investimento', X)) id = ag.event({ kind: 'fault', what: 'new', fault: 'investimento', target: X });
    if (ag.S.cl && closed == null) closed = t; if (closed != null && !ag.S.cl && opened == null) opened = t; });
  const left = out(st.ag);
  console.log((left.length || st.worst > 5400 || !opened ? 'FAIL' : 'ok  ') + ' investimento at ' + names[X] + ': closed ' + (closed ? hm(closed) : '-') + ' – ' + (opened ? hm(opened) : '-') +
    ' | longest wait at a red after the reopening: ' + Math.round(st.worst / 60) + ' min (train ' + (st.worstK + 1) + ') | still out at the end of the day: ' + left.length + ' | without route: ' + (st.ag.S.rt.viol || 0));
  if (left.length) fail('trains still on the line at 26:36', left.slice(0, 6)); if (st.worst > 5400) fail('a train waited more than 90 min at a red after the reopening'); if (!opened) fail('never reopened');
  if (st.ag.S.rt.viol) fail('signals passed without a route', st.ag.S.rt.violAt);
}
// ---- 2. strike at 90%: the line closed when fewer than a quarter of the 24 tabelle run (9:30-14:30), reopened at 14:45
{
  let id = null, low = null, closedAt = null, reopenedAt = null, band = 0;
  const st = play(5.2 * 3600, 26.6 * 3600, (ag, t) => {
    if (!id) id = ag.event({ kind: 'fault', what: 'new', fault: 'sciopero', target: 90 });
    const run = ag.agents().filter(a => a && !a.hidden && a.mode !== 'static' && a.mode !== 'home' && a.mode !== 'inside' && (a.status === 'service' || a.status === 'turnback' || a.mode === 'shuttle')).length;
    low = run < 6 ? (low || t) : null;
    if (!closedAt && !ag.S.cl && low && t - low >= 600 && t > 9.5 * 3600 && t < 14.5 * 3600) { ag.event({ kind: 'close', cl: { a: 0, b: last, ends: {}, all: true }, label: 'tutta la linea' }); closedAt = t; }
    if (closedAt && !reopenedAt && t >= 14.75 * 3600) { ag.event({ kind: 'reopen' }); reopenedAt = t; }
    if (t >= 16.5 * 3600 && t < 17.5 * 3600) band = Math.max(band, ag.agents().filter(a => a && !a.hidden && a.status === 'service').length); });
  const left = out(st.ag);
  console.log((left.length || st.worst > 2400 || st.ricDouble || !closedAt || band < 12 ? 'FAIL' : 'ok  ') + ' strike 90%: whole line closed ' + (closedAt ? hm(closedAt) : '-') + ' – ' + (reopenedAt ? hm(reopenedAt) : '-') + ' | orders given ' + st.orders +
    ' | two trains for a ricovero: ' + (st.ricDouble ? 'yes' : 'no') + ' | in service at 17:00: ' + band + ' | longest wait at a red with the line open: ' + Math.round(st.worst / 60) + ' min | still out at the end of the day: ' + left.length + ' | without route: ' + (st.ag.S.rt.viol || 0));
  if (!closedAt) fail('the line was never closed (the strike left a quarter of the tabelle running)');
  if (st.ricDouble) fail('two trains sent to the same ricovero'); if (band < 12) fail('the 15:00-18:00 band did not start', band);
  if (st.worst > 2400) fail('a train waited more than 40 min at a red with the line open', st.worstK + 1); if (left.length) fail('trains still running at 26:36 (the service never ended)', left.slice(0, 6));
  if (st.ag.S.rt.viol) fail('signals passed without a route', st.ag.S.rt.violAt);
}
if (bad) { console.log(bad + ' problem(s)'); process.exit(1); }
