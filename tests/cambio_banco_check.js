// Changes of cab (Giovanni 20 Nov 2026, "regola ferrea"): every change of cab at a signal is done with the train
// standing, the whole train beyond the signal that will then clear its way back: after the change no signal facing the
// new way stands under the train, and one stands ahead of it, close (no more than LOOK m from its new front).
// A day with closures (one with a navetta), the depot (in and out, the test loop), and the wash's ways of the build.
// Usage (from build/): node ../tests/cambio_banco_check.js
const L = require('./lib.js');
const { M, D } = L.load(); const day = L.runDay(M, D);
const H = M.half, LOOK = +process.env.LOOK || 150;
const SA = M.net.sigall || {}, SP = M.net.sigpos || {}, SIGS = M.net.signals || [];
const nm = si => { const s = SIGS[si]; return s ? '#A' + String(s.n).padStart(2, '0') : 'si' + si; };
// the signals facing the way of path pid: [d, name]
const facing = pid => [...(SA[pid] || []).map(([d, n]) => [d, '#A' + String(n).padStart(2, '0')]), ...(SP[pid] || []).map(([d, si]) => [d, nm(si)])].sort((p, q) => p[0] - q[0]);
function judge(pid, d) {
  const F = facing(pid), under = F.filter(([x]) => x > d - H + 1 && x < d + H - 1), ahead = F.find(([x]) => x >= d + H - 1);
  if (under.length) return `segnale ${under.map(x => x[1]).join(', ')} sotto il treno (il treno non lo ha passato tutto)`;
  if (!ahead) return 'nessun segnale davanti';
  if (ahead[0] - (d + H) > LOOK) return `il primo segnale davanti (${ahead[1]}) è a ${Math.round(ahead[0] - d - H)} m`;
  return null;
}
const bad = new Map(); let n = 0;
const note = (where, pid, d, why) => { const key = where + ' ' + pid + ':' + Math.round(d); if (!bad.has(key)) bad.set(key, why); };
// 1) the day as it is, and with closures (one with a navetta)
const CL = M.net.closures || [];
const runs = [null, ...[/^San Donato – Lodi/, /^Porta Romana – Centrale/, /^Centrale FS – Comasina/, /Repubblica/].map(r => CL.findIndex(c => r.test(c.label))).filter(i => i >= 0)];
for (const ci of runs) {
  const T0 = 6 * 3600, ag = L.agents(M, D, t => L.posAt(day, t)); ag.start(T0, L.posAt(day, T0));
  const c = ci != null ? CL[ci] : null;
  for (let t = T0 + 10; t <= (c ? 10 : 12) * 3600; t += 10) {
    ag.step(t);
    if (c && t === 7 * 3600) ag.event({ kind: 'close', cl: { a: c.a, b: c.b, ends: {} }, label: c.label });
    if (c && t === 9 * 3600) ag.event({ kind: 'reopen' });
  }
  for (const r of ag.S.revs || []) { n++; const w = judge(r.pid, r.d); if (w) note((c ? c.label : 'giornata') + ', treno ' + (r.k + 1), r.pid, r.d, w); }
}
// 2) the depot's ways of the build (web/DepotM3.js): legs [pid, from, to, rev, ...], rev = a change of cab at the end of
// that leg, the next leg starting from where it stands: the test loop (trip, tripBack, home), the wash (go, then back)
const T = M.test || {};
const chain = (where, legs) => legs.forEach((l, i) => { const nx = legs[i + 1]; if (!l[3] || !nx) return; n++; const why = judge(nx[0], nx[1]); if (why) note(where, nx[0], nx[1], why); });
for (const key of ['trip', 'tripBack', 'home']) for (const [p, w] of Object.entries(T[key] || {})) chain(key + ' dal posto ' + p, w.legs || []);
for (const [p, w] of Object.entries(T.wash || {})) for (const [q, b] of Object.entries(w.back || {})) chain('lavaggio dal posto ' + p + ' al ' + q, (w.go || []).concat([b]));
for (const [k, why] of bad) console.log('FAIL ' + k + ': ' + why);
console.log(`${bad.size ? 'FAIL' : 'ok  '} cambi banco controllati: ${n}, fuori regola: ${bad.size}`);
process.exit(bad.size ? 1 : 0);
