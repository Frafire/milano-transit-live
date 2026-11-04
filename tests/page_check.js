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
// - giorno: Friday 02:58 with a signal failed: at 02:59 Saturday's timetable comes in without leaving the page, the failure still there
// - rinumera: closure and reopening: the trains get the number of the tabella of the run they take, the DCT tells them
// - turni: Turni del giorno: a reserve train on a tabella before it leaves; it leaves from its own place
// - regolatore: a train taken out of the service: its runs are scoperte; a reserve train goes out for its tabella and makes them
// - totale: Chiusura totale: the DCT calls all the trains, they stop at a station and wait; reopened, they go again
// - orari: the hours of a station (OS): closed at night, any order gives ERRORE; it opens before its first train and says
//   so; it closes after its last departure and says so
// - osnome: the OS introduces himself as "Operatore di stazione" or "OS" (both, the Radio sheet's weights), the same on a new
//   page (seeded random numbers)
// - schermi: every change of the platform screens ordered by the DCT, the OS answers "Ricevuto, eseguo"
// - schermichiusura: San Donato – Porta Romana closed: the dispari screens say Porta Romana, inside "Treni per"; the closure
//   asked by the Prefettura on every station's screens; a fire: ABBANDONARE LA STAZIONE; the DCT's page TRATTA CHIUSA
// - telefono: a call of an OS left 60 s stays pending (tab, alarms, map) and a click takes it with no new call; two
//   stations with calls keep their own conversations; a later message of the same OS goes into the same conversation
// - riservacomasina: Friday -> Saturday -> Sunday: a reserve train stands at Comasina in position 3 of a tail all day
//   (Saturday it is the 17), with its train
// - riservausata: Saturday, the reserve of Comasina covers a tabella; that night its tail is full (3 trains) and an
//   empty run from the depot stops on the arrival platform of Comasina
// - incendio: a fire at Corvetto: the OS has the station evacuated by himself and does not answer; 5 minutes later the
//   station is clear, the firemen there; when they finish (no damage) the DCT reopens
// - prefetturanotte: the Prefettura closes Duomo at 3 at night: the OS is not there, no call
// - emergenzastazione: the stations' openings said also played at 300x; investimento at Corvetto: the OS asks for news,
//   answers a check "negativo", a closing "già chiusa", an opening "impossibile, ti richiamo"; the DCT's closure from the
//   menu goes to all the trains by radio and is the investimento's
// - marciaillegale: San Donato – Rogoredo FS closed: by radio the DCT sends a train at a San Donato platform and one in a
//   tail into the depot or a tail in marcia illegale (the order and the answer on the radio); they get there
// - sinottico: Mappa | Sinottico; the red track pieces are exactly the ones the trains stand on (head, tail and all), the
//   signals of the schema are drawn; at two times of day
// - rossototale: Rosso totale: every train on the line stops (stations too); taken away from the alarms, they go again
// - settimana: seven changes of day in a row; every tabella has a train; depot trains start from their places; maintenance
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
      let vmax = 0, was = null, lapsSeen = 0; const R = T.trip[F.depot.at[k]] || {}, gl = (R.legs || [])[(R.legs || []).length - 1] || [];
      while (Date.now() - t0 < 150000) {
        await sleep(100); const a = F.ag.agents()[k]; if (!a) break; const r = role(a);
        const atLap0 = R.lap0 && a.pid === gl[0] && Math.abs(a.d - gl[2]) < 5;       // (standing at the first test stop at the end of the way in)
        if (r === 'loop:lap' && (a.pid === T.cycle || atLap0)) { vmax = Math.max(vmax, a.v); lapsSeen++;
          const here = atLap0 ? Math.round(R.lap0) : Math.round(((a.d % T.lap) + T.lap) % T.lap); if (a.v === 0 && was !== 0) stops.push(here); was = a.v; }
        // (Giovanni 3 Nov: the way in goes on round the loop to the first test stop, no stop where the loop begins)
        else if (r === 'loop:gate' && R.lap0 && a.pid === gl[0] && a.d > gl[2] - R.lap0 - 30) { vmax = Math.max(vmax, a.v);
          if (a.v === 0 && was !== 0) stops.push(Math.abs(a.d - gl[2]) < 5 ? Math.round(R.lap0) : -1); was = a.v; }
        else was = null;
        if (lapsSeen && !(F.dm.loopInfo(k) || {}).onLoop && F.depot.target[k] == null) break;
      }
      st.playing = false;
      const near = (x, y) => Math.min(Math.abs(x - y), T.lap - Math.abs(x - y)) < 12;
      const atStops = stops.filter(x => T.stops.some(y => near(x, y))).length, other = stops.filter(x => x < 0 || !T.stops.some(y => near(x, y)) && !near(x, 0));
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
  async rinumera(p) {   // fase E: after reopening a closed stretch the trains are renumbered: the tabella of the run they take
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.ag && f.line === 'M3');
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const sel = document.querySelector('.closures #clSel'), o = [...sel.options].find(x => /Porta Romana – Centrale/.test(x.textContent));
      if (!o) return { ok: false, why: 'no closure Porta Romana – Centrale FS' };
      sel.value = o.value; sel.onchange(); await sleep(200);
      document.querySelector('.closures #closeBtn').click(); await sleep(300);
      st.playing = true; st.speed = 60; await sleep(15000); st.playing = false; await sleep(300);
      document.getElementById('reopenBtn').click(); await sleep(300);
      st.playing = true; st.speed = 60; await sleep(4000); st.playing = false; await sleep(1500);
      st.sel = 'f' + M.fleets.indexOf(F) + ':0'; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(400);
      const log = document.getElementById('radioLog').innerText;      // (the DCT calls come right after the reopening: the log keeps the last 80)
      st.playing = true; st.speed = 60; await sleep(16000); st.playing = false; await sleep(1500);
      const A = F.ag.agents(), renum = F.trains.filter((tr, k) => { const r = M.realTrain(F, tr, st.t); return r && r.renum; }).length;
      const nums = F.trains.map(tr => M.realTrain(F, tr, st.t)).filter(r => r && r.tab != null && !r.none).map(r => r.n);
      const dup = nums.length - new Set(nums).size;
      return { ok: renum > 0 && /da adesso sei la tabella/.test(log) && dup <= 1, renum, dup, hybrid: A.filter(a => a.tabM != null).length,
        log: log.split('\n').filter(l => /tabella/.test(l)).slice(-3) };
    });
  },
  async stazione(p) {   // radio alla stazione: Corvetto closed to the public, the trains go through without stopping; screens say so
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, fi = M.fleets.findIndex(f => f.line === 'M3' && f.boards), F = M.fleets[fi];
      st.playing = false; st.t = 9 * 3600; await sleep(2500); st.playing = true; st.speed = 1; await sleep(1200); st.playing = false; await sleep(300);
      const bi = F.boards.findIndex(x => /corvetto/i.test(x.n)); st.sel = 'b' + fi + ':' + bi; M.renderCard(); await sleep(300);
      const btn = document.getElementById('stRadio'); if (!btn) return { ok: false, why: 'no station radio button' };
      btn.click(); for (let i = 0; i < 50 && !document.querySelector('[data-st="sit"]'); i++) await sleep(200);     // (the OS answers the telephone)
      const sit = document.querySelector('[data-st="sit"]'); sit.click(); await sleep(2500);
      document.querySelector('[data-acc="close"]').click(); await sleep(300);
      const X = F.engine.G.names.findIndex(n => /CORVETTO/.test(n)), stopsBefore = F.ag.agents().filter(a => a.stopAt === X).length;
      // 15 minutes of game: nobody stops at Corvetto (only those already standing there leave)
      const stopped = new Set(); st.playing = true; st.speed = 60; const t0 = Date.now();
      while (Date.now() - t0 < 15000) { await sleep(200); F.ag.agents().forEach(a => { if (a.stopAt === X && a.v === 0) stopped.add(a.k); }); }
      st.playing = false; await sleep(200);
      M.renderCard(); await sleep(200);
      const scr = [...document.querySelectorAll('#card img.scr')].map(i => i.alt).join(' | '), log = document.getElementById('phoneLog').innerText;
      return { ok: /(Operatore di stazione|OS) Corvetto/.test(log) && stopped.size <= stopsBefore && /STAZIONE CHIUSA/.test(scr), stopsBefore, stoppedAfter: stopped.size, scr, log: log.split('\n').slice(-4) };
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
  async totale(p) {    // the whole line closed: the DCT's call to all the trains; every train stops at a station and waits
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const b = document.getElementById('totalBtn'); if (!b) return { ok: false, why: 'no button' };
      b.click(); await sleep(300);
      st.playing = true; st.speed = 60; await sleep(9000); st.playing = false; await sleep(600);
      st.sel = 'f' + M.fleets.indexOf(F) + ':0'; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(400);
      const log = document.getElementById('radioLog').innerText, A = F.ag.agents();
      const moving = A.filter(a => !a.hidden && a.v > 0.5 && a.status === 'service').length, waiting = A.filter(a => !a.hidden && a.status === 'stopped').length;
      const call = /A tutti i treni/.test(log), told = (log.match(/attendo disposizioni/g) || []).length, disabled = b.disabled;
      document.getElementById('reopenBtn').click(); await sleep(300);
      st.playing = true; st.speed = 30; await sleep(5000); st.playing = false; await sleep(300);
      const after = F.ag.agents().filter(a => !a.hidden && a.v > 0.5 && a.status === 'service').length;
      return { ok: call && moving === 0 && waiting >= 10 && told >= 5 && disabled && after >= 5, call, moving, waiting, told, after };
    });
  },
  async orari(p) {     // the hours of a station (Giovanni 3 Nov 2026): the OS opens 5 min before the first train, closes 10 min
    // after the last real departure, tells the DCT; closed, every order: "ERRORE: stazione chiusa", nobody answers
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), X = F.engine.G.names.findIndex(n => /CORVETTO/.test(n)), H = M.osHours(F)[X];
      // a call: the OS answers after 1-8 s; closed: the error at once and nobody answers. Open: "Chiedi la situazione"
      const waits = [];
      const hang = async () => { const b = document.querySelector(`#phoneWho [data-pclose="${X}"]`); if (b) { b.click(); await sleep(200); } };   // (a new call each time)
      const msgs = () => { const c = M.phone.conv(X); return c ? c.msgs.map(m => (m.who ? m.who + ': ' : '') + m.text) : []; };
      const ask = async () => { await hang(); const n0 = msgs().length, t0 = Date.now(); M.openStationRadio(F, X); let up = null;
        while (Date.now() - t0 < 9500) { await sleep(100); if (document.querySelector('[data-st="sit"]')) { up = Date.now() - t0; break; } }
        if (up != null) { waits.push(up); document.querySelector('[data-st="sit"]').click(); await sleep(2500); }
        const L = msgs().slice(n0); return { err: L.some(x => /ERRORE: stazione chiusa/.test(x)), ans: L.some(x => /^(Operatore di stazione|OS) Corvetto: (?!DCT)/.test(x)), up }; };
      st.playing = false; st.t = H.open - 1800; await sleep(2500);
      const opened0 = M.osOpen(F, X), l0 = await ask(), err0 = l0.err && !l0.ans && l0.up == null;
      st.t = H.open - 40; await sleep(2500); st.playing = true; st.speed = 10; await sleep(7000); st.playing = false; await sleep(300);
      const saidOpen = /(Operatore di stazione|OS) Corvetto: DCT, stazione aperta/.test(msgs().join('\n')), l1 = await ask(), ans1 = l1.ans && !l1.err;
      const l1b = await ask(), l1c = await ask();
      st.t = H.last + 30; await sleep(3000); st.playing = true; st.speed = 60; const t0 = Date.now();
      while (Date.now() - t0 < 40000 && !/(Operatore di stazione|OS) Corvetto: DCT, stazione chiusa alle/.test(msgs().join('\n'))) await sleep(300);
      st.playing = false; await sleep(300);
      const saidClose = /(Operatore di stazione|OS) Corvetto: DCT, stazione chiusa alle/.test(msgs().join('\n')), l2 = await ask(), err2 = l2.err && !l2.ans && l2.up == null;
      const waitOk = waits.length >= 3 && waits.every(w => w >= 900 && w <= 8600);
      return { ok: !opened0 && err0 && saidOpen && ans1 && saidClose && err2 && waitOk, waits, open: H.open, first: H.first, last: H.last, opened0, err0, saidOpen, ans1, saidClose, err2, tail: msgs().slice(-3) };
    });
  },
  async osnome(p) {    // how the OS introduces himself (Giovanni 3 Nov 2026): both ways, and the same again on a new page (seeded)
    const run = async q => q.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), X = F.engine.G.names.findIndex(n => /CORVETTO/.test(n));
      st.playing = false; st.t = 10 * 3600; await sleep(2500); M.openStationRadio(F, X); for (let i = 0; i < 50 && !document.querySelector('[data-st="sit"]'); i++) await sleep(200);
      for (let i = 0; i < 12; i++) { document.querySelector('[data-st="sit"]').click(); await sleep(150); }
      await sleep(2500);
      return document.getElementById('phoneLog').innerText.split('\n').map(l => (l.match(/^\d\d:\d\d:\d\d(Operatore di stazione Corvetto|OS Corvetto):/) || [])[1]).filter(Boolean);
    });
    const a = await run(p), q = await p.context().browser().newPage(); await q.goto(p.url()); await q.waitForTimeout(6000); const b = await run(q); await q.close();
    const full = a.filter(x => x.startsWith('Operatore')).length, os = a.filter(x => x.startsWith('OS ')).length;
    return { ok: a.length >= 12 && full >= 2 && os >= 2 && JSON.stringify(a) === JSON.stringify(b), n: a.length, full, os, same: JSON.stringify(a) === JSON.stringify(b) };
  },
  async schermi(p) {   // the DCT changes the platform screens of a station (twice, then back to normal): the OS answers each time
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), X = F.engine.G.names.findIndex(n => /CORVETTO/.test(n));
      st.playing = false; st.t = 10 * 3600; await sleep(2500); M.openStationRadio(F, X); for (let i = 0; i < 50 && !document.querySelector('[data-scr]'); i++) await sleep(200);
      const n0 = document.getElementById('phoneLog').innerText.split('\n').length;
      for (const k of ['SERVIZIO LIMITATO', 'TRATTA INTERROTTA', '']) { document.querySelector(`[data-scr="${k}"]`).click(); await sleep(1800); }
      const L = document.getElementById('phoneLog').innerText.split('\n').slice(n0 - 1), acks = L.filter(l => /Corvetto: Ricevuto, eseguo/.test(l)).length;
      return { ok: acks === 3 && !(F.ag.S.stn[X] || {}).msg, acks, log: L.slice(-4) };
    });
  },
  async schermichiusura(p) {   // the platform screens in a closure (Giovanni 3 Nov 2026)
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, fi = M.fleets.findIndex(f => f.line === 'M3' && f.ag), F = M.fleets[fi], G = F.engine.G;
      const alts = nm => { st.sel = 'b' + fi + ':' + F.boards.findIndex(x => new RegExp(nm, 'i').test(x.n)); M.renderCard(); return [...document.querySelectorAll('#card img.scr')].map(i => i.alt); };
      st.playing = false; st.t = 9 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const sel = document.querySelector('.closures #clSel'), o = [...sel.options].find(x => /^San Donato – Porta Romana$/.test(x.textContent.trim()));
      if (!o) return { ok: false, why: 'no closure San Donato – Porta Romana' };
      sel.value = o.value; sel.onchange(); await sleep(200); document.querySelector('.closures #closeBtn').click(); await sleep(300);
      st.playing = true; st.speed = 30; await sleep(4000); st.playing = false; await sleep(300);
      let mis = alts('missori'), toPR = false; const lodi = alts('lodi');
      for (let i = 0; i < 30 && !toPR; i++) { mis = alts('missori'); toPR = /PER PORTA ROMANA/.test(mis[1] || ''); if (!toPR) await sleep(1000); }   // (the pages take turns)
      const inside = lodi.length === 2 && lodi.every(a => /^TRENI PER/.test(a));
      // the DCT's page for a closure, from the station's telephone
      const X = G.names.findIndex(n => /MISSORI/.test(n)); M.openStationRadio(F, X); for (let i = 0; i < 50 && !document.querySelector('[data-scr]'); i++) await sleep(200);
      const clPage = !!document.querySelector('[data-scr="TRATTA CHIUSA / CI SCUSIAMO PER / IL DISAGIO"]'), lateBtn = (document.querySelector('[data-scr="I TRENI / VIAGGIANO IN / RITARDO"]') || {}).textContent === 'CIRCOLAZIONE RALLENTATA' && !document.querySelector('[data-scr="CIRCOLAZIONE RALLENTATA"]');   // (B-015: one button)
      document.getElementById('reopenBtn').click(); await sleep(300); st.playing = true; st.speed = 10; await sleep(1500); st.playing = false; await sleep(300);
      let back = false; for (let i = 0; i < 30 && !back; i++) { back = /PER SAN DONATO/.test(alts('missori')[1] || ''); if (!back) await sleep(1000); }
      // the Prefettura closes Duomo: its pages on the screens of another station (they take turns with the others)
      const D = G.names.findIndex(n => /DUOMO/.test(n)); F.ag.event({ kind: 'fault', what: 'new', fault: 'prefettura', target: D }); await sleep(300);
      const seen = new Set(); const t0 = Date.now();
      while (Date.now() - t0 < 45000 && !(seen.has('d') && seen.has('p'))) { alts('missori').forEach(a => { if (/DUOMO CHIUSA/.test(a)) seen.add('d'); if (/DUOMO CHIUSA DALLE \S+ ALLE \S+ PER (ORDINE|ORD\.) PUBBLICO/.test(a)) seen.add('p'); }); await sleep(1000); }
      // a fire at Corvetto: its screens say to leave the station
      const C = G.names.findIndex(n => /CORVETTO/.test(n)), id = F.ag.event({ kind: 'fault', what: 'new', fault: 'incendio', target: C });
      for (let i = 0; i < 40; i++) { const f = F.ag.FX.list().find(x => x.kind === 'incendio'); if (f && f.call && f.call.opts.includes('fire')) { F.ag.event({ kind: 'fault', what: 'answer', id: f.id, answer: 'fire' }); break; }
        if (f && f.call) F.ag.event({ kind: 'fault', what: 'answer', id: f.id, answer: f.call.opts[0] }); st.playing = true; st.speed = 10; await sleep(500); st.playing = false; }
      await sleep(300); const fire = alts('corvetto').some(a => /ABBANDONARE LA STAZIONE/.test(a));
      return { ok: toPR && inside && clPage && lateBtn && back && seen.size === 2 && fire, toPR, inside, clPage, lateBtn, back, pref: [...seen], fire, mis, lodi };
    });
  },
  async telefono(p) {   // one conversation for each station (Giovanni 3 Nov 2026)
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), G = F.engine.G;
      const X1 = G.names.findIndex(n => /CORVETTO/.test(n)), X2 = G.names.findIndex(n => /PORTA ROMANA/.test(n));
      st.playing = false; st.t = 10 * 3600; await sleep(2500);
      // (a) an OS calls (something on the tracks) and nobody answers for 60 s
      F.ag.event({ kind: 'fault', what: 'new', fault: 'oggetto', target: X1 }); await sleep(60000);
      const c1 = M.phone.conv(X1), pend60 = !!(c1 && c1.pending), tabBlink = !!document.querySelector(`#phoneWho .ptab.pend [data-ptab="${X1}"]`);
      const inAlarms = [...document.querySelectorAll('#pcAlarms li.phone')].some(li => /Corvetto/.test(li.innerText)), ring = !!document.querySelector('path.phring');
      const n0 = c1 ? c1.msgs.length : 0, t0 = Date.now(); document.querySelector(`#phoneWho [data-ptab="${X1}"]`).click(); await sleep(300);
      const taken = !c1.pending && c1.line && Date.now() - t0 < 1500 && c1.msgs.length === n0 && !c1.msgs.some(m => /Chiamata alla stazione|Pronto/.test(m.text));
      const visible = /Corvetto/.test(document.getElementById('phoneLog').innerText) && /caduto qualcosa/i.test(document.getElementById('phoneLog').innerText);
      // (b) a second station calls too: two conversations, each its own
      F.ag.event({ kind: 'fault', what: 'new', fault: 'oggetto', target: X2 }); await sleep(2500);
      const c2 = M.phone.conv(X2), sep = !!c2 && c2.msgs.every(m => !/Corvetto/.test(m.who + m.text)) && c1.msgs.every(m => !/Porta Romana/.test(m.who + m.text));
      // (c) the DCT answers Corvetto's call: what the OS says next goes into the same conversation (no new tab)
      const f1 = F.ag.FX.list().find(f => f.kind === 'oggetto' && f.st === X1), m1 = c1.msgs.filter(m => /Corvetto/.test(m.who)).length;
      if (f1 && f1.call) F.ag.event({ kind: 'fault', what: 'answer', id: f1.id, answer: f1.call.opts[0] });
      st.playing = true; st.speed = 30; const t1 = Date.now(); while (Date.now() - t1 < 30000 && c1.msgs.filter(m => /Corvetto/.test(m.who)).length <= m1) await sleep(300); st.playing = false;
      const same = c1.msgs.filter(m => /Corvetto/.test(m.who)).length > m1 && document.querySelectorAll(`#phoneWho [data-ptab="${X1}"]`).length === 1;
      // the repeat button: the OS says again his last words
      const last = c1.lastOS; M.openStationRadio(F, X1); await sleep(300); const rp = document.getElementById('phoneRepeat'); if (rp) rp.click(); await sleep(1800);
      const rep = !!rp && c1.msgs.some(m => /^Ripeto: /.test(m.text) && m.text.includes(last));
      return { ok: pend60 && tabBlink && inAlarms && ring && taken && visible && sep && same && rep, pend60, tabBlink, inAlarms, ring, taken, visible, sep, same, rep, tail: c1.msgs.slice(-4).map(m => m.who + ': ' + m.text) };
    });
  },
  async riservacomasina(p) {   // B-016: Saturday and Sunday a reserve train stands at Comasina in position 3 of a tail all day
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state; window.__stay = 1;
      document.querySelector('.dayb[data-d="5"]').click(); await sleep(400);
      const F_ = () => M.fleets.find(f => f.line === 'M3' && f.ag), days = [];
      for (let d = 0; d < 2; d++) {          // Friday -> Saturday, Saturday -> Sunday
        st.playing = false; st.t = 26.95 * 3600; await sleep(2000); const label0 = document.getElementById('day').textContent;
        st.speed = 60; st.playing = true; const t0 = Date.now(); while (Date.now() - t0 < 40000 && !(st.t < 4 * 3600 && document.getElementById('day').textContent !== label0)) await sleep(200);
        await sleep(800); st.playing = false; st.t = 11 * 3600; await sleep(2500);
        const F = F_(), G = F.engine.G, k = F.trains.findIndex(tr => (tr.segs0 || tr.segs).length === 1 && /comasina/i.test((tr.where || [])[0] || '') && !(tr.segs0 || tr.segs).some(x => x[1] === 'service'));
        const a = k >= 0 ? F.ag.agents()[k] : null, r = k >= 0 ? M.realTrain(F, F.trains[k], st.t) : null, pe = a && F.engine.pathEdges[a.pid];
        const tail = pe ? pe.e.filter(([, , x0, x1]) => x1 > a.d - 52.5 && x0 < a.d + 52.5).map(x => x[0]) : [];
        days.push({ day: document.getElementById('day').textContent.split(' · ')[1], k, n: k >= 0 ? F.trains[k].n : null, units: r && r.units, missing: !r || !!r.missing || !!r.none, hidden: a && a.hidden, v: a && a.v, tail });
      }
      return { ok: window.__stay === 1 && days.length === 2 && days.every(x => x.k >= 0 && !x.missing && !x.hidden && x.v === 0 && x.tail.length > 0) && days[0].n === 17 && days[0].units === days[1].units, days };      // (Saturday the 17; the same train on Sunday)
    });
  },
  async riservausata(p) {   // B-016: Saturday, a Comasina tabella left without its train: the DCT sends the reserve of Comasina;
    // in the evening the tail fills from the inside, the platform train goes in too; after the closing an empty run from the
    // depot to the arrival platform of Comasina
    await p.goto(PAGE.replace(/day=\d+/, 'day=6')); await p.waitForTimeout(6000);
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state;
      const F = M.fleets.find(f => f.line === 'M3' && f.ag), G = F.engine.G, last = G.names.length - 1, H = F.engine.half;
      st.playing = false; st.t = 10 * 3600; await sleep(2500);
      const RC = M.rego.comReserves(F); if (!RC.length) return { ok: false, why: 'no reserve at Comasina' };
      const kR = RC[0].k, aR = F.ag.agents()[kR], d0 = aR.d, te = F.engine.pathEdges[aR.pid].e[0][0];
      // a tabella with a departure from Comasina in 20-60 minutes, its train taken out of the service
      const m = F.trains.findIndex((tr, m) => tr.n != null && M.rego.runsOf(F, m).some(r => r.X === last && r.dir === 'S' && r.t > st.t + 1500 && r.t < st.t + 3600) && F.ag.agents()[m].mode === 'plan');
      if (m < 0) return { ok: false, why: 'no tabella to cover' };
      M.rego.withdraw(F, m); await sleep(300);
      const r = M.rego.insertComReserve(F, kR, m); if (!r || !r.com) return { ok: false, why: 'reserve not sent', r };
      const sR = F.trains[kR].segs[0][3][0];
      st.speed = 60; st.playing = true; let t0 = Date.now(); while (Date.now() - t0 < 60000 && st.t < r.t + 300) await sleep(300); st.playing = false; await sleep(500);
      const left = F.ag.agents()[kR].mode === 'plan' && Math.abs(F.ag.agents()[kR].d - d0) > 50 && F.ag.agents()[kR].pid !== aR.pid || F.ag.agents()[kR].d > d0 + 300;
      // the night: the tail and the platform
      const w = F._comInvio; if (!w) return { ok: false, why: 'no empty run planned', left };
      st.speed = 300; st.playing = true; t0 = Date.now(); while (Date.now() - t0 < 200000 && st.t < Math.min(26.8 * 3600, w.t + 3600)) await sleep(400); st.playing = false; await sleep(800);
      const A = F.ag.agents(), inTail = A.filter(a => !a.hidden && F.engine.pathEdges[a.pid].e.some(([ei, , x0, x1]) => ei === te && x1 > a.d - H && x0 < a.d + H)).length;
      const kI = F.trains.findIndex(tr => tr.cover && tr.cover.invio), aI = kI >= 0 ? A[kI] : null;
      const atPlat = !!aI && !aI.hidden && aI.v === 0 && aI.pid === w.pid && Math.abs(aI.d - w.d1) < 8;
      return { ok: left && inTail === 3 && atPlat, left, inTail, invio: kI, atPlat, sR, t: st.t / 3600, w: { t: w.t / 3600, plat: w.plat } };
    });
  },
  async incendio(p) {   // B-014: a fire at Corvetto: the OS has it evacuated by himself and is gone, 5 minutes later the station is
    // clear and the firemen there; when they have finished (no damage) the DCT reopens
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), G = F.engine.G, X = G.names.findIndex(n => /CORVETTO/.test(n));
      st.playing = false; st.t = 10 * 3600; await sleep(2500);
      const id = F.ag.event({ kind: 'fault', what: 'new', fault: 'incendio', target: X }), f = () => F.ag.FX.list().find(x => x.id === id);
      st.speed = 1; st.playing = true; await sleep(1500); st.playing = false; await sleep(500);
      const s0 = F.ag.S.stn[X] || {}, closed = !!s0.closed && s0.why === 'fire', held = F.ag.zones().some(z => z.kind === 'stop' && z.a === X && z.b === X), c = M.phone.conv(X);
      const said = c && c.msgs.some(m => /Sto facendo evacuare/.test(m.text)), noAsk = !(f().call);
      M.openStationRadio(F, X); await sleep(400); const away1 = c.msgs.slice(-1)[0].text === 'Nessuna risposta.' && !c.line;
      const t1 = Date.now(); M.openStationRadio(F, X); while (c.calling && Date.now() - t1 < 12000) await sleep(200); await sleep(300); const away2 = /Nessuna risposta/.test(c.msgs.slice(-1)[0].text) && !c.line;
      st.speed = 30; st.playing = true; const t2 = Date.now(); while (Date.now() - t2 < 30000 && !c.msgs.some(m => /stazione sgombra/.test(m.text))) await sleep(300); st.playing = false;
      const clear = c.msgs.some(m => /stazione sgombra, i vigili del fuoco sono sul posto/.test(m.text));
      { const g = F.ag.S.faults.list.find(x => x.id === id); g.smoke = null; g.until = F.ag.S.t + 30; } st.playing = true; const t3 = Date.now(); while (Date.now() - t3 < 20000 && !(f().call && f().call.opts.includes('clear'))) await sleep(300); st.playing = false; await sleep(800);
      const done = !!(f().call && f().call.opts.includes('clear')) && c.msgs.some(m => /nessun danno strutturale/.test(m.text));
      if (done) F.ag.event({ kind: 'fault', what: 'answer', id, answer: 'clear' }); await sleep(300);
      const open = !(F.ag.S.stn[X] || {}).closed;
      return { ok: closed && held && said && noAsk && away1 && away2 && clear && done && open, closed, held, said, noAsk, away1, away2, clear, done, open, tail: c.msgs.slice(-3).map(m => m.who + ': ' + m.text) };
    });
  },
  async prefetturanotte(p) {   // B-011: the Prefettura closes Duomo at 3 at night, no trains: the OS is not there, he does not call
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), G = F.engine.G, D = G.names.findIndex(n => /DUOMO/.test(n));
      st.playing = false; st.t = 3 * 3600; await sleep(2500);
      const id = F.ag.event({ kind: 'fault', what: 'new', fault: 'prefettura', target: D }), f = F.ag.FX.list().find(x => x.id === id);
      if (!f) return { ok: false, why: 'no Prefettura closure' };
      st.speed = 60; st.playing = true; const t0 = Date.now(); while (Date.now() - t0 < 40000 && st.t < f.from + 600) await sleep(200); st.playing = false; await sleep(1500);
      const c = M.phone.conv(D), os = c ? c.msgs.filter(m => m.who && m.who !== 'DCT' && m.cls !== 'sys' && m.cls !== 'err') : [];
      const g = F.ag.S.faults.list.find(x => x.id === id);
      return { ok: g.ph === 'closed' && os.length === 0 && !(c && c.pending) && !M.osOpen(F, D), ph: g.ph, osSaid: os.map(m => m.text), from: g.from, t: st.t, agT: F.ag.S.t };
    });
  },
  async emergenzastazione(p) {   // the OS in an emergency, the closure told to all, the openings played fast (Giovanni 3 Nov 2026)
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), G = F.engine.G;
      // the openings of the stations at 300x: each OS still says it
      st.playing = false; st.t = 4.8 * 3600; await sleep(2500); st.speed = 300; st.playing = true; const tq = Date.now();
      while (Date.now() - tq < 40000 && st.t < 6.6 * 3600) await sleep(300); st.playing = false; await sleep(1500);
      const opened = G.names.filter((n, X) => { const c = M.phone.conv(X); return c && c.msgs.some(m => /stazione aperta alle/.test(m.text)); }).length;
      // an investimento at Corvetto (a train coming in), the red button
      const X = G.names.findIndex(n => /CORVETTO/.test(n)); st.t = 10 * 3600; await sleep(2500);
      let id = null; st.speed = 2; st.playing = true; const t0 = Date.now();
      while (id == null && Date.now() - t0 < 60000) { if (!F.ag.FX.cannot('investimento', X)) id = F.ag.event({ kind: 'fault', what: 'new', fault: 'investimento', target: X }); await sleep(100); }
      st.playing = false; if (id == null) return { ok: false, why: 'no train coming into Corvetto', opened };
      await sleep(500); const f = () => F.ag.FX.list().find(x => x.id === id);
      if (f().call && f().call.opts.includes('red')) F.ag.event({ kind: 'fault', what: 'answer', id, answer: 'red' }); await sleep(500);
      // the DCT calls Corvetto: the OS asks for news; a check: negative, waiting for help; close: closed already; open: not now
      // (a call of the OS waiting: taken first, then the DCT hangs up and calls again)
      M.openStationRadio(F, X); const c = M.phone.conv(X); await sleep(300); const xb = document.querySelector(`#phoneWho [data-pclose="${X}"]`); if (xb) xb.click(); await sleep(300);
      M.openStationRadio(F, X); const t1 = Date.now(); while (!c.line && Date.now() - t1 < 12000) await sleep(200);
      const last = () => c.msgs.slice(-1)[0].text, news = /novità/i.test(last());
      const click = async (sel, re) => { const b = document.querySelector('#phoneCmds ' + sel); if (!b) return false; b.click(); const t2 = Date.now(); while (Date.now() - t2 < 5000 && !re.test(last())) await sleep(200); return re.test(last()); };
      const check = await click('[data-chk="Situazione in banchina"]', /Negativo DCT/);
      const shut = await click('[data-acc="close"]', /già chiusa/), notNow = await click('[data-acc="open"]', /Impossibile al momento/);
      const stillClosed = !!(F.ag.S.stn[X] || {}).closed;
      // the DCT closes San Donato – Porta Romana from the menu: to all the trains, by radio; the investimento takes it
      const sel = document.querySelector('.closures #clSel'), o = [...sel.options].find(x => /^San Donato – Porta Romana$/.test(x.textContent.trim()));
      sel.value = o.value; sel.onchange(); await sleep(200); document.querySelector('.closures #closeBtn').click(); await sleep(500);
      st.speed = 2; st.playing = true; await sleep(2500); st.playing = false; await sleep(300);
      st.sel = 'f' + M.fleets.indexOf(F) + ':0'; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(500);
      const rl = document.getElementById('radioLog').textContent, all = /A tutti i treni, qui DCT: .*San Donato – Porta Romana è chiusa/.test(rl), taken = !!f().closed;
      if (!all) console.log('radioLog: ' + rl.slice(-600) + ' | closeBtn disabled ' + document.querySelector('.closures #closeBtn').disabled + ' | clLast ' + JSON.stringify(F.ag.S.clLast));
      return { ok: opened >= 15 && news && check && shut && notNow && stillClosed && all && taken, opened, news, check, shut, notNow, stillClosed, all, taken, tail: c.msgs.slice(-4).map(m => m.who + ': ' + m.text) };
    });
  },
  async marciaillegale(p) {   // interruption from San Donato: the DCT sends a train standing there into the depot or a tail (Giovanni 3 Nov 2026)
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.ag && f.line === 'M3'), fi = M.fleets.indexOf(F);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      const sel = document.querySelector('.closures #clSel'), o = [...sel.options].find(x => /^San Donato – Rogoredo FS$/.test(x.textContent.trim()));
      if (!o) return { ok: false, why: 'no closure San Donato – Rogoredo FS' };
      sel.value = o.value; sel.onchange(); await sleep(200); document.querySelector('.closures #closeBtn').click(); await sleep(300);
      st.playing = true; st.speed = 30; await sleep(12000); st.playing = false; await sleep(500);
      const res = [];
      // one train at a platform (into the depot), one held in a tail (its radio offers the ways too, though it is not 'stopped')
      for (const want of ['plat', 'tail']) {
        const A = F.ag.agents(), k = A.findIndex(a => { const ops = F.ag.instrOptions(a.k).filter(x => x.ill && !x.blocked.length); return ops.length && (want === 'tail' ? a.mode === 'static' : a.mode === 'inside'); });
        if (k < 0) { res.push({ want, none: true }); continue; }
        const op = F.ag.instrOptions(k).filter(x => x.ill && !x.blocked.length).sort((x, y) => (y.key === 'ill:dep') - (x.key === 'ill:dep'))[0];
        st.sel = 'f' + fi + ':' + k; M.renderCard(); document.getElementById('radioOpen').click(); await sleep(600);
        const s = document.getElementById('instrSel'); if (!s) { res.push({ want, k, noSelect: true }); continue; }
        s.value = op.key; s.onchange(); await sleep(300);
        const note = /Marcia illegale: ordine via radio/.test(document.getElementById('radioCmds').textContent);
        document.getElementById('instrGo').click(); await sleep(2500);
        const log = document.getElementById('radioLog').innerText, said = /in marcia illegale/.test(log) && /Ricevuto DCT, (cambio banco e vado in )?marcia illegale/.test(log) && (!op.cab || /cambia banco/.test(log));
        st.playing = true; st.speed = 30; await sleep(25000); st.playing = false; await sleep(300);
        const a = F.ag.agents()[k], there = op.key === 'ill:dep' ? a.hidden : a.mode === 'static' && a.sdTailHeld;
        res.push({ want, k, key: op.key, note, said, there, ok: note && said && there });
      }
      return { ok: res.length === 2 && res.every(r => r.ok || r.none) && res.some(r => r.ok), res };
    });
  },
  async sinottico(p) {   // the sinottico of the depot (Giovanni 3 Nov 2026): the red pieces against the trains' positions
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag), SCH = F.engine.net.schema_depot, SE = new Set(SCH.edges), half = F.engine.half;
      if (document.querySelector('.viewsw') && document.querySelector('.viewsw').isConnected) return { ok: false, why: 'the Mappa | Sinottico switch is still on the screen' };
      M.setView('sin'); const res = [];
      for (const t of [6.2 * 3600, 10.6 * 3600]) {
        st.playing = false; st.t = t; await sleep(2500); await sleep(1300);
        const want = new Set(); F.ag.agents().forEach(a => { if (a.hidden) return; const pe = F.engine.pathEdges[a.pid]; if (!pe) return;
          for (const [ei, , x0, x1] of pe.e) if (SE.has(ei) && x1 > a.d - half && x0 < a.d + half) want.add(ei); });
        const red = new Set([...document.querySelectorAll('#depotPlan polyline[data-occ]')].map(x => +x.dataset.e));
        const sigs = document.querySelectorAll('#depotPlan circle.sg').length, edges = document.querySelectorAll('#depotPlan polyline[data-e]').length;
        res.push({ t: t / 3600, want: want.size, red: red.size, same: want.size === red.size && [...want].every(e => red.has(e)), sigs, edges });
      }
      document.getElementById('dpClose').click(); await sleep(200);
      const back = document.getElementById('depotPlan').hidden;
      return { ok: res.every(r => r.same && r.want > 0 && r.sigs === SCH.signals.length && r.edges === SCH.edges.length) && back, res, back };
    });
  },
  async rossototale(p) {  // Rosso totale (Emergenze): every train on the line stops, at the stations too; Togli: they go again
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 10; await sleep(2000); st.playing = false; await sleep(300);
      const red = getComputedStyle(document.getElementById('emRed')).backgroundColor, b = document.getElementById('emRedAll');
      if (!b) return { ok: false, why: 'no button' };
      b.click(); await sleep(300);
      st.playing = true; st.speed = 10; await sleep(6000); st.playing = false; await sleep(300);
      const inZone = F.ag.agents().filter(a => !a.hidden && F.ag.zonesOf(a).includes('red')), moving = inZone.filter(a => a.v > 0).length;
      const btn = [...document.querySelectorAll('#pcAlarms [data-fxa="fix"]')].find(x => /pulsante rosso/i.test(x.closest('li').innerText));
      if (!btn) return { ok: false, why: 'no PC alarm with Togli', n: inZone.length, moving };
      btn.click(); await sleep(300); st.playing = true; st.speed = 10; await sleep(4000); st.playing = false; await sleep(200);
      const after = F.ag.agents().filter(a => !a.hidden && a.v > 0.5 && a.status === 'service').length;
      return { ok: inZone.length >= 10 && moving === 0 && /rgb\(2[01]\d, 4\d, 4\d\)/.test(red) && !F.ag.zones().length && after >= 3, n: inZone.length, moving, red, after };
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
  async giorno(p) {    // continuity (Giovanni): Friday night into Saturday, without leaving the page, the failures of the line carried
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state; window.__stay = 1;
      document.querySelector('.dayb[data-d="5"]').click(); await sleep(300);
      st.playing = false; st.t = 26.9 * 3600; await sleep(2500);
      let F = M.fleets.find(f => f.line === 'M3' && f.ag);
      F.ag.event({ kind: 'fault', what: 'new', fault: 'segnale', target: 232 });
      const pressed = document.querySelector('.dayb[aria-pressed="true"]').dataset.d;
      st.speed = 60; st.playing = true; const t0 = Date.now();
      while (Date.now() - t0 < 40000 && !(st.t < 4 * 3600 && /sabato/.test(document.getElementById('day').textContent) && M.fleets.find(f => f.line === 'M3' && f.ag))) await sleep(250);
      await sleep(1500); st.playing = false;
      F = M.fleets.find(f => f.line === 'M3' && f.ag);
      const label = document.getElementById('day').textContent, failed = !!(F && F.ag.rt().sigFail && F.ag.rt().sigFail[232]);
      return { ok: pressed === '6' && /Orario del sabato/.test(label) && window.__stay === 1 && failed, pressed, label, stayed: window.__stay === 1, failed, t: Math.round(st.t) };
    });
  },
  async turni(p) {     // fase E: the shifts of the day; a reserve train put on a tabella before it leaves: it leaves from its place
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 3.6 * 3600; await sleep(2500);
      document.getElementById('turniBtn').click(); await sleep(300);
      const sel = [...document.querySelectorAll('#card select[data-tab]')].find(x => [...x.options].some(o => /riserva/.test(o.text)));
      if (!sel) return { ok: false, why: 'no tabella that can take a reserve train', card: document.getElementById('card').innerText.slice(0, 300) };
      const k = +sel.dataset.tab, opt = [...sel.options].find(o => /riserva/.test(o.text)), j = +opt.value;
      const uK = M.realTrain(F, F.trains[k], st.t).units, uJ = M.realTrain(F, F.trains[j], st.t).units, pK = F.depot.at[k], pJ = F.depot.at[j];
      sel.value = opt.value; sel.dispatchEvent(new Event('change')); await sleep(300);
      const now = M.realTrain(F, F.trains[k], st.t).units, placeK = F.depot.at[k];
      // on to its first departure: it leaves from the reserve's place
      const A = () => F.ag.agents()[k], d0 = A().d, p0 = A().pid, dep = F.trains[k].segs.find(x => x[1] === 'service')[3][0];
      st.t = dep - 900; await sleep(4000); st.speed = 30; st.playing = true; const t0 = Date.now();
      while (Date.now() - t0 < 60000 && !(A().pid === p0 && Math.abs(A().d - d0) >= 50) && st.t < dep + 600) await sleep(200);
      st.playing = false; const a = A();
      return { ok: now === uJ && String(placeK) === String(pJ) && F.trains[k].segs.find(s => s[1] === 'from_depot' || s[5] != null)[5] == pJ && Math.abs(a.d - d0) >= 50 && a.pid === p0,
        tabella: F.trains[k].n, before: uK, after: now, place: [pK, pJ, placeK], moved: Math.round(Math.abs(a.d - d0)), pid: [p0, a.pid] };
    });
  },
  async regolatore(p) { // fase E: Regolatore. A train in service is taken out (it ends its run and goes in); its runs are
    // scoperte; a reserve train in the depot is sent out for the tabella: it leaves its place in time, makes the first run
    // from San Donato with the number of the tabella, and the train taken out has no number of a tabella any more
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
      st.playing = false; st.t = 8 * 3600; await sleep(2500); st.playing = true; st.speed = 2; await sleep(1500); st.playing = false; await sleep(300);
      document.getElementById('regoBtn').click(); await sleep(300);
      const b = document.querySelector('#card button[data-wd]'); if (!b) return { ok: false, why: 'no train to take out', card: document.getElementById('card').innerText.slice(0, 300) };
      const m = +b.dataset.wd, tab = F.trains[m].n, uM = M.realTrain(F, F.trains[m], st.t).units; b.click(); await sleep(300);
      st.playing = true; st.speed = 60; const t0 = Date.now();
      while (Date.now() - t0 < 40000 && F.ag.agents()[m].mode === 'plan') await sleep(200);
      st.playing = false; await sleep(300);
      const homeMode = F.ag.agents()[m].mode; document.getElementById('regoBtn').click(); await sleep(100); document.getElementById('regoBtn').click(); await sleep(300);
      const sc = [...document.querySelectorAll('#card li.scoperta')].map(li => li.innerText.split('\n')[0]).filter(x => x.includes('tabella ' + tab)).length;
      const sel = document.querySelector('#card select[data-ins="' + m + '"]'); if (!sel || sel.options.length < 2) return { ok: false, why: 'no reserve offered', homeMode, sc, card: document.getElementById('card').innerText.slice(0, 400) };
      const k = +sel.options[1].value, uK = M.realTrain(F, F.trains[k], st.t).units; sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change')); await sleep(300);
      const R = F.trains[k]; if (!R.cover) return { ok: false, why: 'reserve not sent', homeMode, sc };
      const out = R.segs[0][3][0], dep = R.segs.find(x => x[1] === 'service')[3][0], A = () => F.ag.agents()[k];
      const go = out - 120; st.t = Math.max(st.t, go); const tj = Date.now(); await sleep(1000);
      while (Date.now() - tj < 90000 && st.t < go - 5) { st.t = go; await sleep(500); }        // (with events the jump is driven)
      st.speed = 30; st.playing = true; const t1 = Date.now();
      while (Date.now() - t1 < 60000 && st.t < dep + 400 && !(A().status === 'service' && A().v > 0 && A().legs[0] && A().legs[0].trip != null && st.t > dep)) await sleep(200);
      st.playing = false; await sleep(300);
      const a = A(), rK = M.realTrain(F, R, st.t), rM = M.realTrain(F, F.trains[m], st.t);
      const nums = F.trains.map(tr => M.realTrain(F, tr, st.t)).filter(r => r && r.tab != null && !r.none).map(r => r.n), dup = nums.length - new Set(nums).size;
      const log = (document.getElementById('radioLog') || {}).innerText || '';
      return { ok: homeMode !== 'plan' && sc > 0 && out >= 8 * 3600 && a.status === 'service' && rK.n === tab && rM.tab == null && dup === 0,
        tabella: tab, out: uM, reserve: uK, leaves: out, dep, status: a.status, shown: rK.n, outShown: rM.n, dup, sc };
    });
  },
  async settimana(p) {  // fase E: a whole week of changes of day without leaving the page. Every day every tabella has a
    // train; the trains in the depot start from the place they stood in; a train sent to ROD for a failure on Wednesday
    // runs no tabella on Thursday and Friday and is back on Saturday
    return p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const M = window.mtl, st = M.state; window.__stay = 1;
      try { localStorage.removeItem('mtl-maint'); } catch (e) {}
      document.querySelector('.dayb[data-d="1"]').click(); await sleep(300);
      const F_ = () => M.fleets.find(f => f.line === 'M3' && f.ag);
      const days = [];
      let broken = null;
      for (let d = 0; d < 7; d++) {
        st.playing = false; st.t = 26.95 * 3600; await sleep(2000);
        let F = F_();
        // the places of the trains in the depot tonight
        const before = {}; F.trains.forEach((tr, k) => { const r = M.realTrain(F, tr, st.t), q = F.depot && F.depot.at[k]; if (r && r.units && q != null) before[r.units] = String(q); });
        if (d === 2) {          // Wednesday: a train in service goes to ROD for a failure
          const k = F.trains.findIndex(tr => { const r = M.realTrain(F, tr, st.t); return r && r.tab != null; });
          broken = M.realTrain(F, F.trains[k], st.t).units; F.ag.S.faults.list.push({ id: 9999, kind: 'trazione', k, t0: st.t, done: st.t, maint: 2 });
        }
        const label0 = document.getElementById('day').textContent;
        st.speed = 60; st.playing = true; const t0 = Date.now();
        while (Date.now() - t0 < 40000 && !(st.t < 4 * 3600 && document.getElementById('day').textContent !== label0)) await sleep(200);
        await sleep(800); st.playing = false;
        F = F_();
        const tabs = F.trains.filter(tr => tr.segs.some(s => s[1] === 'service')), noTrain = tabs.filter(tr => { const r = M.realTrain(F, tr, st.t); return !r || r.missing || r.none; }).length;
        let same = 0, moved = 0; F.trains.forEach((tr, k) => { const r = M.realTrain(F, tr, st.t), q = F.depot && F.depot.at[k]; if (!r || !before[r.units] || q == null) return; if (String(q) === before[r.units]) same++; else moved++; });
        const brokenTab = broken ? F.trains.some(tr => { const r = M.realTrain(F, tr, st.t); return r && r.units === broken && r.tab != null; }) : null;
        let maintLeft = null; try { maintLeft = broken ? (JSON.parse(localStorage.getItem('mtl-maint') || '{}')[broken] || null) : null; } catch (e) {}
        days.push({ label: document.getElementById('day').textContent.split(' · ')[1], tabs: tabs.length, noTrain, same, moved, brokenTab, maintLeft });
      }
      const ok = window.__stay === 1 && days.every(x => x.noTrain === 0) && days.every(x => x.same >= x.moved * 3)
        && days[2].brokenTab === false && days[3].brokenTab === false && days[4].maintLeft == null && /lunedì/.test(days[6].label);
      return { ok, stayed: window.__stay === 1, broken, days };
    });
  },
};

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
  const b = await chromium.launch(); let fail = 0;
  for (const name of which) {
    const p = await b.newPage(), errs = []; p.on('pageerror', e => errs.push(process.env.STACK ? e.stack : e.message)); if (process.env.CONSOLE) p.on('console', m => console.log('  [page] ' + m.text().slice(0, 900)));
    await p.goto(PAGE); await p.waitForTimeout(6000);
    const r = await SCENARIOS[name](p); if (errs.length) { r.ok = false; r.errors = errs.slice(0, 3); }
    console.log(`page ${name}: ${r.ok ? 'ok' : 'FAILED'}`, JSON.stringify(r)); if (!r.ok) fail++;
    await p.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
