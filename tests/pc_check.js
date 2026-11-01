// The PC's commands on signals and switches (Pannello PC, web/routes.js): a signal held at red stops the next train
// and lets it go when given back; an itinerary formed by hand for another movement holds the train until the PC
// takes it back; a switch locked the other way does the same; one formed for the train's own movement is taken.
// Usage (from build/): node ../tests/pc_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const day = L.runDay(M, D);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
// the first train after T0 that sets a route from signal N (San Donato arrival #A13): which one, when, which movement
function firstAt(N, T0, setup) {
  const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T0, L.posAt(day, T0)); if (setup) setup(ag);
  for (let t = T0 + 5; t < T0 + 3600; t += 5) { ag.step(t);
    for (const [k, rs] of Object.entries(ag.rt().routes)) for (const r of rs) if (r.n === N) return { ag, k: +k, t, id: r.id }; }
  return { ag };
}
const T0 = 8 * 3600, N = 13;
const base = firstAt(N, T0);
ok(base.k != null, `normal: train ${base.k} sets ${base.id} from #A${N} at ${Math.round(base.t - T0)} s`);
// held at red for 10 minutes, then given back
{
  const ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T0, L.posAt(day, T0)); ag.event({ kind: 'pccmd', what: 'red', n: N, on: true });
  let set = null; for (let t = T0 + 5; t <= base.t + 600; t += 5) { ag.step(t); if (Object.values(ag.rt().routes).flat().some(r => r.n === N)) set = t; }
  const a = ag.agents()[base.k];
  ok(set == null && a.v === 0, `red: no route from #A${N} for 10 minutes, train ${base.k} standing (${a.why || ''})`);
  ag.event({ kind: 'pccmd', what: 'red', n: N, on: false });
  let after = null; for (let t = ag.S.t + 5; t <= ag.S.t + 300 && after == null; t += 5) { ag.step(t); if ((ag.rt().routes[base.k] || []).some(r => r.n === N)) after = t; }
  ok(after != null, 'red taken back: the train gets its route');
}
// another movement formed by hand from the same signal: the train waits; taken back: it goes
{
  const other = base.ag.RT.fromSignal(N).find(x => x.id !== base.id);
  const r = firstAt(N, T0, ag => ok(ag.event({ kind: 'pccmd', what: 'form', id: other.id }) == null, `formed ${other.id} by hand`));
  ok(r.k == null || r.id === other.id, `formed ${other.id}: train does not get ${base.id} (${r.k == null ? 'none set' : r.id})`);
}
{
  const r = firstAt(N, T0, ag => ag.event({ kind: 'pccmd', what: 'form', id: base.id }));
  ok(r.k === base.k && r.id === base.id && !Object.keys(r.ag.rt().pcRoutes || {}).length, `formed ${base.id} by hand: taken by train ${r.k}, reservation used up`);
}
// a switch of the movement locked in the other position
{
  const it = base.ag.RT.fromSignal(N).find(x => x.id === base.id), nd = it.switches[0], pos = base.ag.RT.switchPositions(nd).find(p => !p.ids.includes(base.id));
  const r = firstAt(N, T0, ag => ag.event({ kind: 'pccmd', what: 'lock', nd, pos: pos.pos }));
  ok(r.k == null || r.id !== base.id, `switch ${nd} locked for ${pos.ids.join('/')}: ${base.id} not set`);
}
process.exit(fail ? 1 : 0);
