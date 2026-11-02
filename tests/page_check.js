// The game page (docs/gioca.html, M3 chosen in the menu) in a headless browser: the parts of the game that live in the page.
// - loop: two trains from the depot to the test loop; the second is told to wait at #A94 and goes in when the first
//   reports the loop free; both get a depot place on the way back (never the same one)
// - manual: depot on manual, a train going to the loop calls at a red depot signal after 2 and after 7 minutes
// - twice: a train goes round the loop, comes back, and can go again
// - radio: the radio on a train in service: a longer stop, a speed limit, the answers (no free message)
// - laps: two laps; it stops a few seconds at each test stop and nowhere else on the loop, faster than 15 km/h
// - a94: a train given a west shed leaves the loop back through #A94; meanwhile no other train is sent to the loop
// - place: a train on its way into the depot gets a place; the player changes it by radio
// - navetta: closure San Donato – Rogoredo with Rogoredo solo binario 1: the menu offers it, a navetta runs
// - stazione: radio alla stazione, Corvetto closed to the public: trains go through, the screens say so
// - segnale: the PC holds #A13 at red from its card: no route from it
// - linea: admin menu Guasti, a signal in front of a running train stays red: the driver asks, the PC gives the marcia a vista
// - emergenza: Emergenze PC, pulsante rosso on the stretch of a running train: it stops; Togli from the alarms: it goes again
// - giorno: Friday 02:58 with a signal failed: at 02:59 Saturday's timetable is loaded, at 03:30, the failure still there
// - nuovo: the new Hitachi (9201-9202) in test goes round the test loop by itself at 09:40, its card says "in prova";
//   admitted from the admin menu at night, from the next day it runs a traditional train's duties, out of its own place
// - comasina: by radio, a train from San Donato goes into Comasina platform 1 and changes cab there (no tail)
// - guasto: admin menu Guasti, a train in service does not start again: the call among the PC alarms, the PC answers Riarma
// Needs Playwright with Chromium (npm i playwright; npx playwright install chromium).
// Usage: node tests/page_check.js [loop|twice|manual|place|radio|laps|a94|navetta|stazione|segnale|guasto|linea|emergenza|giorno ...]   (no argument: all of them). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const PAGE = 'file://' + path.resolve(__dirname, '../docs/gioca.html') + '?linee=M3&day=' + (process.env.DAY || 1);      // (the weekday timetable unless DAY=6/7)

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
  async radio(p) {      // the radio on a train in service: stop order, speed limit, the driver's answers, no free text
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
      out.noFree = !document.getElementById('radioFree');
      st.playing = true; st.speed = 60; await sleep(3000); st.playing = false;
      return { ok: out.stop && out.speed && out.noFree, out, log: log().split('\n').slice(-6) };
    });
  },
  async laps(p) {      // two laps: round without a stop at the junction, a few seconds at each test stop, faster than 15 km/h
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths), T = F.test;
      st.playing = false; st.t = 11.5 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const at = Object.entries(F.depot.at).map(([k, q]) => [+k, q]), A = at.find(([, q]) => F.test.trip[q] && q.startsWith('2000')) || at[0], k = A[0];
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); await sleep(200);
      const b = document.querySelector('[data-loop="2"]'); if (!b) return { ok: false, why: 'no 2-lap button' }; b.click(); await sleep(200);
      st.playing = true; st.speed = 30; const t0 = Date.now(), stops = [], role = a => { const s = F.trains[k].segs[a.si]; return s && typeof s[6] === 'string' ? s[6] : ''; };
      let vmax = 0, was = null, lapsSeen = 0;
      while (Date.now() - t0 < 150000) {
        await sleep(100); const a = F.ag.agents()[k]; if (!a) break; const r = role(a);
        if (r === 'loop:lap' && a.pid === T.cycle) { vmax = Math.max(vmax, a.v); lapsSeen++;
          const here = Math.round(((a.d % T.lap) + T.lap) % T.lap); if (a.v === 0 && was !== 0) stops.push(here); was = a.v; }
        else was = null;
        if (lapsSeen && !(F.dm.loopInfo(k) || {}).onLoop && F.depot.target[k] == null) break;
      }
      st.playing = false;
      const near = (x, y) => Math.min(Math.abs(x - y), T.lap - Math.abs(x - y)) < 12;
      const atStops = stops.filter(x => T.stops.some(y => near(x, y))).length, other = stops.filter(x => !T.stops.some(y => near(x, y)) && !near(x, 0));
      return { ok: atStops >= 4 && other.length === 0 && vmax * 3.6 > 30, train: k, stops, other, vmaxKmh: Math.round(vmax * 3.6), place: F.depot.at[k] };
    });
  },
  async a94(p) {        // a train given a west shed (A66-A75) leaves the loop back through #A94; meanwhile no train may go to #A94
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.depotPaths), T = F.test;
      const west = q => (T.a94_places || []).includes(F.dm.name(q));
      st.playing = false; st.t = 11.5 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const at = Object.entries(F.depot.at).map(([k, q]) => [+k, q]), A = at.find(([, q]) => T.trip[q] && q.startsWith('1000')) || at[0];
      // every other free place that is not a west shed is taken (stand-ins), so the depot can only give a west shed
      const tk = F.dm.taken(); Object.keys(F.depotPaths).filter(q => !tk.has(q) && !west(q)).forEach((q, i) => { F.depot.target[9000 + i] = q; });
      const B = at.find(([k, q]) => k !== A[0] && T.trip[q] && !west(q));
      const k = A[0]; st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); await sleep(200);
      document.querySelector('[data-loop="1"]').click(); await sleep(200);
      st.playing = true; st.speed = 30; const t0 = Date.now(); let refused = null, tried = false;
      while (Date.now() - t0 < 150000) {
        await sleep(200);
        const log = document.getElementById('radioLog').innerText;
        if (!tried && /passando dal #A94/.test(log) && B) {          // the exit via #A94 is decided: another train may not go now
          tried = true; st.playing = false; st.sel = 'f' + M.fleets.indexOf(F) + ':' + B[0]; M.renderCard(); await sleep(200);
          const b = document.querySelector('[data-loop="1"]'); if (b) b.click(); await sleep(200);
          refused = !(F.dm.loopInfo(B[0]) || {}).onLoop; st.playing = true; }
        if (tried && !(F.dm.loopInfo(k) || {}).onLoop && F.depot.target[k] == null) break;
      }
      st.playing = false;
      const log = document.getElementById('radioLog').innerText, q = F.depot.at[k];
      return { ok: /passando dal #A94/.test(log) && /dopo il #A94/.test(log) && q != null && west(q) && refused === true, train: k, from: F.dm.name(A[1]), to: q && F.dm.name(q), refused,
               log: log.split('\n').filter(l => /A94|anello/.test(l)).slice(-5) };
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
  async navetta(p) {   // a closure with one track only at an end (Rogoredo, solo binario 1): a navetta Rogoredo – Porta Romana
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.ag && f.line === 'M3') || M.fleets.find(f => f.depotPaths);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const sel = document.querySelector('.closures #clSel'), o = [...sel.options].find(x => /San Donato – Rogoredo/.test(x.textContent));
      if (!o) return { ok: false, why: 'no closure San Donato – Rogoredo in the menu' };
      sel.value = o.value; sel.onchange(); await sleep(200);
      const end = document.querySelector('.closures select[data-end]'), one = end && [...end.options].find(x => x.value === '2');
      if (!one || one.disabled) return { ok: false, why: 'option solo binario 1 not enabled', options: end ? [...end.options].map(x => x.textContent) : null };
      end.value = '2'; document.querySelector('.closures #closeBtn').click(); await sleep(300);
      const nav = F.ag.S.log.filter(x => x.nav);
      st.playing = true; st.speed = 30; await sleep(8000); st.playing = false; await sleep(300);
      const a = F.ag.agents().find(x => x.mode === 'navetta'), log = document.getElementById('radioLog').innerText;
      return { ok: !!a && /Navetta/.test(log), option: one.textContent, nav, train: a && a.k, at: a && a.at };
    });
  },
  async stazione(p) {   // radio alla stazione: Corvetto closed to the public, the trains go through without stopping; screens say so
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, fi = M.fleets.findIndex(f => f.line === 'M3' && f.boards), F = M.fleets[fi];
      st.playing = false; st.t = 9 * 3600; await sleep(2500); st.playing = true; st.speed = 1; await sleep(1200); st.playing = false; await sleep(300);
      const bi = F.boards.findIndex(x => /corvetto/i.test(x.n)); st.sel = 'b' + fi + ':' + bi; M.renderCard(); await sleep(300);
      const btn = document.getElementById('stRadio'); if (!btn) return { ok: false, why: 'no station radio button' };
      btn.click(); await sleep(300);
      const sit = document.querySelector('[data-st="sit"]'); sit.click(); await sleep(2500);
      document.querySelector('[data-acc="close"]').click(); await sleep(300);
      const X = F.engine.G.names.findIndex(n => /CORVETTO/.test(n)), stopsBefore = F.ag.agents().filter(a => a.stopAt === X).length;
      // 15 minutes of game: nobody stops at Corvetto (only those already standing there leave)
      const stopped = new Set(); st.playing = true; st.speed = 60; const t0 = Date.now();
      while (Date.now() - t0 < 15000) { await sleep(200); F.ag.agents().forEach(a => { if (a.stopAt === X && a.v === 0) stopped.add(a.k); }); }
      st.playing = false; await sleep(200);
      M.renderCard(); await sleep(200);
      const scr = [...document.querySelectorAll('#card img.scr')].map(i => i.alt).join(' | '), log = document.getElementById('radioLog').innerText;
      return { ok: /Staz\. Corvetto/.test(log) && stopped.size <= stopsBefore && /STAZIONE CHIUSA/.test(scr), stopsBefore, stoppedAfter: stopped.size, scr, log: log.split('\n').slice(-4) };
    });
  },
  async segnale(p) {   // the PC on a signal: #A13 held at red, its card says so and the map shows it red
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 1; await sleep(1200); st.playing = false; await sleep(300);
      st.sel = 'g13'; M.renderCard(); await sleep(300);
      const red = document.querySelector('[data-pc="red"]'); if (!red) return { ok: false, why: 'no red button' };
      red.click(); await sleep(300);
      const sub = document.querySelector('#card .sub').textContent, its = [...document.querySelectorAll('[data-form]')].map(b => b.dataset.form);
      st.playing = true; st.speed = 60; await sleep(4000); st.playing = false; await sleep(200);
      const passed = Object.values(F.ag.rt().routes).flat().some(r => r.n === 13);
      return { ok: /Rosso fisso/.test(sub) && its.length > 0 && !passed, sub, its, passed };
    });
  },
  async guasto(p) {    // failures (fase D1): from the admin menu, train does not start again; the PC answers from the alarms
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 1; await sleep(1200); st.playing = false; await sleep(300);
      st.playing = true; st.speed = 30; await sleep(3000); st.playing = false; await sleep(200);     // the trains get going
      const a = F.ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 17); if (!a) return { ok: false, why: 'no train running' };
      const kSel = document.getElementById('fxKind'), tSel = document.getElementById('fxTrain'); if (!kSel.options.length) return { ok: false, why: 'empty failure menu' };
      kSel.value = 'trazione'; tSel.value = String(a.k); document.getElementById('fxGo').click(); await sleep(300);
      // the driver re-arms by himself first: it works (he goes, then tells the DCT) or he calls for instructions
      st.playing = true; st.speed = 10; let btn = null; const t0 = Date.now(), FX0 = F.ag.FX;
      while (Date.now() - t0 < 20000 && !(btn = document.querySelector('#pcAlarms [data-fxa="rearm"]')) && FX0.list().some(f => f.k === a.k && f.kind === 'trazione')) await sleep(200);
      st.playing = false; await sleep(200);
      if (!btn) { st.sel = 'f' + M.fleets.indexOf(F) + ':' + a.k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(300);
        const log = document.getElementById('radioLog').innerText, over = !FX0.list().some(f => f.k === a.k && f.kind === 'trazione');
        return { ok: over && /Ho riarmato e sono ripartito/.test(log) && !/riarma il treno/.test(log), self: true, over, log: log.split('\n').filter(l => /riarm|non riparte/i.test(l)).slice(-3) }; }
      const call = btn.closest('li').innerText; if (!/Ho provato a riarmare/.test(call)) return { ok: false, why: 'called before re-arming by himself', call };
      btn.click(); await sleep(300);
      st.playing = true; st.speed = 60; const t1 = Date.now(), FX = F.ag.FX;
      while (Date.now() - t1 < 40000 && FX.list().some(f => f.k === a.k && f.kind === 'trazione')) await sleep(250);
      st.playing = false; await sleep(200);
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + a.k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(300);
      const log = document.getElementById('radioLog').innerText, over = !FX.list().some(f => f.k === a.k && f.kind === 'trazione');
      return { ok: /non riparte/.test(call) && /riarma il treno/.test(log) && over, call: call.slice(0, 120), over, log: log.split('\n').filter(l => /riarm|non riparte|soccorso/i.test(l)).slice(-5) };
    });
  },
  async linea(p) {     // failures of the line (fase D2): a signal stays red; the call; Marcia a vista from the alarms
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 30; await sleep(3000); st.playing = false; await sleep(200);
      const FX = F.ag.FX, ok = new Set(FX.targets('segnale').map(x => x.v)), half = F.engine.half;
      const a = F.ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 15); if (!a) return { ok: false, why: 'no train running' };
      const sig = F.ag.RT.ahead(a.pid, a.d + half + 30, 3000).find(c => ok.has(c.n)); if (!sig) return { ok: false, why: 'no signal ahead' };
      const kSel = document.getElementById('fxKind'); kSel.value = 'segnale'; kSel.onchange(); await sleep(200);
      const tSel = document.getElementById('fxTrain'); tSel.value = String(sig.n); document.getElementById('fxGo').click(); await sleep(300);
      st.playing = true; st.speed = 10; let btn = null; const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !(btn = document.querySelector('#pcAlarms [data-fxa="vista"]'))) await sleep(200);
      st.playing = false; await sleep(200);
      if (!btn) return { ok: false, why: 'no call for the marcia a vista', alarms: document.getElementById('pcAlarms').innerText.slice(0, 300) };
      const call = btn.closest('li').innerText; btn.click(); await sleep(300);
      st.playing = true; st.speed = 5; let vmax = 0, went = false; const t1 = Date.now();
      while (Date.now() - t1 < 15000) { await sleep(100); F.ag.agents().forEach(x => { if (x.avista) { went = true; vmax = Math.max(vmax, x.v * 3.6); } }); }
      st.playing = false; await sleep(200);
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + a.k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(300);
      const log = document.getElementById('radioLog').innerText;
      return { ok: /non si apre/.test(call) && went && vmax <= 15.5 && /marcia a vista/.test(log), sig: sig.n, call: call.slice(0, 120), went, vmax: +vmax.toFixed(1), log: log.split('\n').filter(l => /vista|guasto/i.test(l)).slice(-4) };
    });
  },
  async emergenza(p) {  // the PC by hand (fase D3): red button between two stations; then taken away from the alarms
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 30; await sleep(3000); st.playing = false; await sleep(300);
      const a = F.ag.agents().find(x => !x.hidden && x.status === 'service' && x.v > 8 && x.at > 3 && x.at < 15); if (!a) return { ok: false, why: 'no train running' };
      const dir = (a.legs[0] || {}).dir, A = dir === 'S' ? a.at - 1 : a.at, B = A + 1;
      document.getElementById('emA').value = String(A); document.getElementById('emB').value = String(B); document.getElementById('emRed').click(); await sleep(300);
      st.playing = true; st.speed = 10; await sleep(3000); st.playing = false; await sleep(300);
      const stopped = a.v === 0 && a.why === 'rosso', btn = [...document.querySelectorAll('#pcAlarms [data-fxa="fix"]')].find(b => /pulsante rosso/.test(b.closest('li').innerText));
      if (!btn) return { ok: false, why: 'no PC alarm with Togli', stopped, alarms: document.getElementById('pcAlarms').innerText.slice(0, 200) };
      btn.click(); await sleep(300); const d0 = a.d;
      st.playing = true; st.speed = 10; await sleep(4000); st.playing = false; await sleep(200);
      return { ok: stopped && Math.abs(a.d - d0) > 5 && !F.ag.zones().length, train: a.k, stretch: [A, B], stopped, movedAfter: Math.round(Math.abs(a.d - d0)) };
    });
  },
  async comasina(p) {  // Comasina platform 1 by radio: the order, the driver's answer, the plan changed
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 9 * 3600; await sleep(2500);
      const k = F.trains.findIndex(tr => (tr.carr1 || []).some(c => !c.done && st.t >= c.open && st.t <= c.close - 300));
      if (k < 0) return { ok: false, why: 'no train to send into platform 1' };
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(400);
      const b = document.getElementById('radioC1'); if (!b) return { ok: false, why: 'no Comasina button in the radio' };
      b.click(); await sleep(300);
      const tr = F.trains[k], log = document.getElementById('radioLog').innerText;
      return { ok: !!tr.c1 && /binario 1/.test(log) && tr.segs.some(s => s[1] === 'turnback' && s[4][0] === s[4][1] && s[4][0] > 10000), k, c1: tr.c1, log: log.split('\n').filter(l => /binario 1/.test(l)).slice(-2) };
    });
  },
  async nuovo(p) {     // the new train in test: test laps by itself; admitted: the duties of a traditional train the next day
    const a = await p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      try { localStorage.removeItem('mtl-admit'); } catch (e) {}
      st.playing = false; st.t = 9.6 * 3600; await sleep(2500);
      const k = F.trains.findIndex(tr => { const r = M.realTrain(F, tr, st.t); return r && r.trial; });
      if (k < 0) return { ok: false, why: 'no train in test' };
      st.playing = true; st.speed = 30; const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !(F.dm && (F.dm.loopInfo(k) || {}).onLoop)) await sleep(250);
      st.playing = false; await sleep(200);
      st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); await sleep(200);
      const card = document.getElementById('card'), front = document.getElementById('trainFront');
      return { ok: !!(F.dm.loopInfo(k) || {}).onLoop && /in prova/.test(card.innerText) && !!front && front.dataset.k.startsWith('hitachi') && !!card.querySelector('.lnlogo'),
        k, onLoop: !!(F.dm.loopInfo(k) || {}).onLoop, t: Math.round(st.t), card: card.innerText.split('\n').slice(0, 4) };
    });
    if (!a.ok) return a;
    const b = await p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 26.95 * 3600; await sleep(2500);
      const box = document.querySelector('#newTrains [data-adm="9201-9202"]'); if (!box) return { ok: false, why: 'no admission switch' };
      box.click(); await sleep(200); const note = document.getElementById('admNote').textContent;
      st.speed = 60; st.playing = true; const t0 = Date.now();
      while (Date.now() - t0 < 30000 && st.t > 4 * 3600) await sleep(250);
      st.playing = false; await sleep(500);
      const k1 = F.trains.findIndex(tr => { const r = M.realTrain(F, tr, st.t); return r && r.units === '9201-9202'; });
      const tr = F.trains[k1], service = !!tr && tr.segs.some(s => s[1] === 'service');
      const place = F.depot && F.depot.at[k1];
      try { localStorage.removeItem('mtl-admit'); } catch (e) {}
      return { ok: service && String(place) === '77', note, k1, service, place, t: Math.round(st.t) };
    });
    return { ok: a.ok && b.ok, inTest: a, admitted: b };
  },
  async giorno(p) {    // continuity (Giovanni): Friday night into Saturday, the failures of the line carried
    const before = await p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      document.querySelector('.dayb[data-d="5"]').click(); await sleep(300);
      st.playing = false; st.t = 26.9 * 3600; await sleep(2500);
      F.ag.event({ kind: 'fault', what: 'new', fault: 'segnale', target: 232 });
      const pressed = document.querySelector('.dayb[aria-pressed="true"]').dataset.d;
      st.speed = 60; st.playing = true; return { pressed, label: document.getElementById('day').textContent };
    });
    await p.waitForTimeout(4000); await p.waitForLoadState('load'); await p.waitForTimeout(7000);
    const after = await p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl; for (let i = 0; i < 40 && !(M.fleets.find(f => f.line === 'M3' && f.ag)); i++) await sleep(250);
      const F = M.fleets.find(f => f.line === 'M3' && f.ag);
      return { label: document.getElementById('day').textContent, t: M.state.t, failed: !!(F && F.ag.rt().sigFail && F.ag.rt().sigFail[232]), list: F ? F.ag.FX.list().map(f => f.kind) : null };
    });
    return { ok: before.pressed === '6' && /sabato/.test(after.label) && after.t < 4 * 3600 && after.failed, before, after };
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
