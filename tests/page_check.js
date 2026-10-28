// The page itself (docs/index.html) in a headless browser: the parts of the game that live in the page.
// - loop: two trains from the depot to the test loop; the second is told to wait at #A94 and goes in when the first
//   reports the loop free; both get a depot place on the way back (never the same one)
// - manual: depot on manual, a train going to the loop calls at a red depot signal after 2 and after 7 minutes
// - twice: a train goes round the loop, comes back, and can go again
// - radio: the radio on a train in service: a longer stop, a speed limit, a free message, the answers
// - place: a train on its way into the depot gets a place; the player changes it by radio
// Needs Playwright with Chromium (npm i playwright; npx playwright install chromium).
// Usage: node tests/page_check.js [loop|twice|manual|place|radio ...]   (no argument: all of them). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const PAGE = 'file://' + path.resolve(__dirname, '../docs/index.html');

const SCENARIOS = {
  async loop(p) {
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 10.2 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const at = Object.entries(F.depot.at).map(([k, q]) => [+k, q]);
      const A = at.find(([, q]) => q.startsWith('1000') && F.test.trip[q]) || at[0], B = at.find(([k, q]) => k !== A[0] && q.startsWith('2000') && F.test.trip[q]) || at.find(([k]) => k !== A[0]);
      for (const [k] of [A, B]) { st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); const b = document.querySelector('[data-loop="1"]'); if (!b) return { ok: false, why: 'no loop button' }; b.click(); await sleep(200); }
      st.playing = true; st.speed = 60; const t0 = Date.now();
      const busy = k => F.trains[k].segs.some((s, i) => typeof s[6] === 'string' && s[6].startsWith('loop:') && i >= F.ag.agents()[k].si);
      while (Date.now() - t0 < 150000 && (busy(A[0]) || busy(B[0]) || [A, B].some(([k]) => F.depot.target[k] != null))) await sleep(250);
      st.playing = false;
      const log = document.getElementById('radioLog').innerText, places = [A, B].map(([k]) => F.depot.at[k]);
      const ok = /Negativo treno/.test(log) && /anello di prova è libero/.test(log) && places.every(q => q != null) && places[0] !== places[1];
      return { ok, trains: [A[0], B[0]], from: [A[1], B[1]], places, log: log.split('\n').filter(l => /anello|#A94|Vai in/.test(l)).slice(-8) };
    });
  },
  async twice(p) {      // after a trip round the loop the train can go again (the trips done do not block it)
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 11 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const at = Object.entries(F.depot.at).map(([k, q]) => [+k, q]), A = at.find(([, q]) => F.test.trip[q] && q.startsWith('2000')) || at[0], k = A[0];
      const go = async () => { st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); const b = document.querySelector('[data-loop="1"]'); if (!b) return false; b.click(); await sleep(200);
        st.playing = true; st.speed = 60; const t0 = Date.now(); await sleep(1000);
        while (Date.now() - t0 < 120000 && (F.dm.loopInfo(k) || {}).onLoop || F.depot.target[k] != null) await sleep(250);
        st.playing = false; await sleep(200); return F.depot.at[k] != null; };
      const first = await go(), second = first && await go();
      return { ok: first && second, train: k, first, second, place: F.depot.at[k] };
    });
  },
  async manual(p) {
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 13 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      document.getElementById('depotAuto').click(); await sleep(200);
      const at = Object.entries(F.depot.at).map(([k, q]) => [+k, q]), A = at.find(([, q]) => q.startsWith('3000') && F.test.trip[q]) || at[0];
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + A[0]; M.renderCard(); document.querySelector('[data-loop="1"]').click();
      st.playing = true; st.speed = 30; const t0 = Date.now(); let seen = 0;
      while (Date.now() - t0 < 120000) {
        await sleep(250); const log = document.getElementById('radioLog').innerText;
        const n = (log.match(/7 minuti/g) || []).length;
        if (n > seen) { seen = n; const m = [...log.matchAll(/segnale (#A\d+)/g)].pop(), num = m && +m[1].slice(2); F.ag.event({ kind: 'il', what: 'clear', si: F.engine.net.signals.findIndex(x => x.n === num) }); }
        if (seen >= 2 && F.depot.at[A[0]] != null) break;
      }
      st.playing = false;
      const log = document.getElementById('radioLog').innerText;
      return { ok: /da 2 minuti/.test(log) && /da 7 minuti/.test(log) && !/da 5 minuti, via impedita/.test(log), calls: log.split('\n').filter(l => /minuti/.test(l)).slice(0, 4) };
    });
  },
  async radio(p) {      // the radio on a train in service: stop order, speed limit, free text, the driver's answers
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 10 * 3600; await sleep(2500); st.playing = true; st.speed = 20; await sleep(2500); st.playing = false; await sleep(300);
      const k = F.trains.findIndex(tr => { const s = M.trainState(F, tr, st.t); return s.trip >= 0 && s.agent && s.agent.mode === 'plan' && s.agent.status === 'service'; });
      if (k < 0) return { ok: false, why: 'no train in service' };
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(400);
      const out = {}, log = () => document.getElementById('radioLog').innerText;
      const stop = document.getElementById('radioSendStop'); if (stop) { stop.click(); await sleep(2200); }
      out.stop = /sosta di/.test(log());
      const sp = document.getElementById('radioSendSpeed'); if (sp) { sp.click(); await sleep(2200); }
      out.speed = /limita la velocità/.test(log()) && /km\/h/.test(log());
      document.getElementById('radioText').value = 'scendi e spingi'; document.getElementById('radioFree').requestSubmit(); await sleep(2200);
      out.free = /Hulk|riparliamo/.test(log());
      st.playing = true; st.speed = 60; await sleep(3000); st.playing = false;
      return { ok: out.stop && out.speed && out.free, out, log: log().split('\n').slice(-6) };
    });
  },
  async place(p) {
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 9.3 * 3600; await sleep(3000); st.playing = true; st.speed = 10; let k = null;
      const t0 = Date.now(); while (Date.now() - t0 < 60000) { await sleep(300); const e = Object.keys(F.depot.target)[0]; if (e != null) { k = +e; break; } }
      st.playing = false; if (k == null) return { ok: false, why: 'no train on its way in' };
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); await sleep(300);
      document.getElementById('radioOpen').click(); await sleep(400);
      const sel = document.getElementById('placeSel'); if (!sel) return { ok: false, why: 'no place section in the radio' };
      const before = F.depot.target[k]; sel.value = [...sel.options].map(o => o.value).find(v => v !== before); document.getElementById('placeGo').click(); await sleep(1500);
      return { ok: F.depot.target[k] !== before, train: k, before, after: F.depot.target[k] };
    });
  },
};

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
  const b = await chromium.launch(); let fail = 0;
  for (const name of which) {
    const p = await b.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(PAGE); await p.waitForTimeout(6000);
    const r = await SCENARIOS[name](p); if (errs.length) { r.ok = false; r.errors = errs.slice(0, 3); }
    console.log(`page ${name}: ${r.ok ? 'ok' : 'FAILED'}`, JSON.stringify(r)); if (!r.ok) fail++;
    await p.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
