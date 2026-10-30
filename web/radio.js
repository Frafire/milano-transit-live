// Radio terra-treno (M3) and the drivers' own calls: the log, the PC's orders (stop, speed, platform, tail, place,
// closure), the drivers' calls (manual depot signals, closure, red signal for 5 minutes, very late) and "via impedita".
// Giovanni, 28 Oct: out of the page. The page gives what it owns (state, trains, depot) in env; everything else lives here.
//   const R = MTLRadio.create(env); R.say(...), R.openRadio(F, tr), R.radioTick(), R.dcoTick(), R.closingTick() ...
(function (root) {
  function create(env) {
    const { D, trips, state, fmt, P2WAY, trackAt, realTrain, trainState, trainOnPlatform, relive, reliveFleet, setPlat, orderP2, closureNow, depotAssign, depotName, depotTaken, pastEntrance, loopRole, m3eng, sigNo } = env;
    // ================= RADIO TERRA-TRENO (M3) =================
    // The player is the Posto Centrale (PC). Orders: a longer stop at the next station, the departure platform at
    // San Donato, platform 2 and reversal there coming from Rogoredo. The driver answers in Italian.
    const radioEl = document.getElementById('radio'), radioLog = document.getElementById('radioLog'), radioCmds = document.getElementById('radioCmds');
    const radioTx = document.getElementById('radioTx'), radioWho = document.getElementById('radioWho');
    let radioTrain = null; const radioMsgs = [], radioWatch = [];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const durTxt = s => { const m = Math.floor(s / 60), r = s % 60; return (m ? (m === 1 ? '1 minuto' : m + ' minuti') : '') + (r ? (m ? ' e ' : '') + r + ' secondi' : ''); };
    const cap = x => x.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(Fn|Fs)\b/g, y => y.toUpperCase());
    function trainNo(F, tr) { const rt = realTrain(F, tr, state.t); return rt && !rt.missing && !rt.none ? rt.n : tr.n; }
    function stationAt(F, pid, d) {
      const st = F.engine.stations; if (!st) return null;
      const q = trackAt(F, pid, d), x = (q[1] - 9.19) * 111320 * Math.cos(45.46 * Math.PI / 180), y = (q[0] - 45.46) * 110540;
      let best = null; st.forEach(s0 => { const dd = Math.hypot(s0.x - x, s0.y - y); if (dd < 200 && (!best || dd < best.dd)) best = { dd, n: s0.n }; });
      return best && best.n;
    }
    // next station stop ahead of the train on its current run: { key, name, si }
    function nextStop(F, tr) {
      const st = trainState(F, tr, state.t); if (st.seg < 0 || st.trip < 0) return null;
      const s0 = tr.segs[st.seg]; if (!s0 || s0[1] !== 'service') return null;
      const pds = s0[4], here = st.v === 0 && st.agent && st.agent.stopAt != null;     // standing at a station: that one counts
      for (let i = 1; i < pds.length - 1; i++) if (pds[i] === pds[i + 1] && (pds[i] > st.d + 3 || here && Math.abs(pds[i] - st.d) <= 8)) {
        const n = stationAt(F, s0[0], pds[i]); if (n) return { key: st.seg + ':' + i, name: n, si: st.seg, d: pds[i], pid: s0[0], here: here && Math.abs(pds[i] - st.d) <= 8 };
      }
      return null;
    }
    function say(who, text, cls) {
      radioMsgs.push({ t: state.t, who, text, cls });
      if (radioMsgs.length > 80) radioMsgs.shift();
      drawRadioLog();
    }
    function drawRadioLog() {
      if (radioEl.hidden) return;
      radioLog.innerHTML = radioMsgs.map(m => `<div class="m ${m.cls}"><time>${fmt(m.t, true).join('')}</time>${m.who ? m.who + ': ' : ''}${m.text}</div>`).join('');
      radioLog.scrollTop = radioLog.scrollHeight;
    }
    function driverSays(text, delayMs = 1400) {
      radioTx.classList.add('on');
      setTimeout(() => { radioTx.classList.remove('on'); say('T' + radioTrain.no, text, 'dr'); drawRadioCmds(); }, delayMs);
    }
    function openRadio(F, tr) {
      radioTrain = { F, tr, no: trainNo(F, tr) };
      radioWho.textContent = 'Treno ' + radioTrain.no; radioCmdHtml = '';
      radioEl.hidden = false;
      if (!radioMsgs.length) say('', 'Canale aperto. Tu sei il Posto Centrale (PC).', 'sys');
      drawRadioLog(); drawRadioCmds();
    }
    document.getElementById('radioClose').onclick = () => { radioEl.hidden = true; };
    // free text to the driver (and an easter egg)
    document.getElementById('radioFree').onsubmit = ev => {
      ev.preventDefault();
      const inp = document.getElementById('radioText'), txt = inp.value.trim(); if (!txt || !radioTrain) return;
      inp.value = ''; say('PC', txt, 'pc');
      const st = trainState(radioTrain.F, radioTrain.tr, state.t), norm = txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
      if (norm.includes('scendi e spingi')) driverSays(st.v === 0 ? 'Eh certo, mica sono Hulk! Aspetto il via libera.' : 'Sono in marcia, PC. Ne riparliamo da fermo. Passo.');
      else driverSays(pick(['Ricevuto PC. Passo.', 'Copiato, Posto Centrale. Passo.']));
    };
    const RADIO_WHY = ['treno davanti in ritardo', 'regolarizzare l’intervallo', 'guasto più avanti', 'nessun motivo'];
    const WHY_TXT = { 'treno davanti in ritardo': 'il treno davanti a te è in ritardo', 'regolarizzare l’intervallo': 'devo regolarizzare l’intervallo',
                      'guasto più avanti': 'c’è un guasto più avanti', 'nessun motivo': 'per servizio' };
    let radioStopSel = 60, radioWhy = RADIO_WHY[0], radioCmdHtml = '';
    // emergency orders (closure, reopening)
    function emergencyCmds(F, tr) {
      const em = closureNow(F) || { label: '', ag: F.ag }, G = F.engine.G, a = F.ag.agents()[tr.agentK], s = F.ag.state(tr.agentK); let h = '';
      if (!a) return '';
      const closedTxt = `${em.label}`;
      if (window.activeClosure && window.activeClosure.active && (a.status === 'stopped' || a.red)) h += `<div class="row"><button id="emWhy">Spiega: guasto, tratta ${closedTxt} interrotta</button></div>`;
      if (a.status === 'stopped') {
        const nx = F.ag.nextOf(tr.agentK);
        h += `<div class="lbl">Treno fermo per l'interruzione</div><div class="row">` + (nx != null ? `<button data-em="next">Prosegui vuoto fino a ${cap(G.names[nx])}</button>` : '') +
             (a.inside && a.inside.dir === 'S' && a.inside.end != null ? `<button data-em="depot">Rientro in deposito, vuoto</button>` : '') + `</div>`;
      }
      if (a.stopAt != null && s.status === 'service') h += `<div class="lbl">Fermo a ${cap(G.names[a.stopAt])}</div><div class="row">` +
        (a.pcHold ? `<button data-em="release">Riparti</button>` : `<button data-em="hold">Resta fermo a ${cap(G.names[a.stopAt])}</button>`) + `</div>`;
      if (F.ag.S.reopened != null && s.timed && a.status === 'service') {
        h += `<div class="lbl">Ritardo ${s.late != null ? (s.late >= 0 ? '+' : '') + Math.round(s.late / 60) + ' min' : ''}</div><div class="row"><button data-em="skip">Salta le prossime fermate</button><button data-em="limit">Limitazione corsa</button>` +
             (s.dir === 'S' ? `<button data-em="depot">Rientro in deposito</button>` : '') + `</div>`;
      }
      return h || `<div class="lbl">${s.mode === 'shuttle' && !s.timed ? 'Navetta, senza orario: parte col verde e con l\'intervallo' : 'Nessun ordine disponibile'}</div>`;
    }
    function bindEmergencyCmds(F, tr) {
      const em = closureNow(F) || { label: '', ag: F.ag }, G = F.engine.G, no = radioTrain.no;
      const why = document.getElementById('emWhy');
      if (why) why.onclick = () => { say('PC', `Treno ${no}, c'è un guasto alla linea: la tratta ${em.label} è interrotta. Resta in attesa di istruzioni. Passo.`, 'pc'); driverSays('Ricevuto PC, avviso i passeggeri e attendo. Passo.'); };
      radioCmds.querySelectorAll('[data-em]').forEach(b => b.onclick = () => {
        const kind = b.dataset.em, nx = F.ag.nextOf(tr.agentK);
        const TXT = { next: `Treno ${no}, prosegui senza passeggeri fino a ${nx != null ? cap(G.names[nx]) : 'la prossima stazione'}. Passo.`, depot: `Treno ${no}, rientra in deposito senza passeggeri. Passo.`,
          hold: `Treno ${no}, resta fermo in stazione a porte aperte fino a nuovo ordine. Passo.`, release: `Treno ${no}, puoi ripartire, segui il segnale. Passo.`,
          skip: `Treno ${no}, autorizzato il salto delle prossime fermate. Passo.`, limit: `Treno ${no}, limita la corsa alla prima stazione utile e inverti. Passo.` };
        say('PC', TXT[kind], 'pc');
        const r = F.ag.event({ kind: 'order', k: tr.agentK, what: kind });
        if (!r) { driverSays('Negativo PC, da qui non posso. Passo.'); return; }
        if (kind === 'hold') driverSays(`Ricevuto PC, resto fermo a ${cap(String(r))} e avviso i passeggeri. Passo.`);
        else if (kind === 'release') driverSays('Ricevuto, chiudo le porte e riparto. Passo.');
        else if (kind === 'next') { driverSays(pick(['Ricevuto, faccio scendere i passeggeri e proseguo vuoto. Passo.', 'Copiato PC, proseguo a vuoto. Passo.'])); }
        else if (kind === 'depot') driverSays('Ricevuto, rientro in deposito a vuoto. Passo.');
        else if (kind === 'skip') driverSays('Ricevuto, salto le fermate e annuncio ai passeggeri. Passo.');
        else driverSays(`Ricevuto, fine corsa a ${cap(String(r))}, poi inverto. Passo.`);
        radioCmdHtml = ''; drawRadioCmds();
      });
    }
    // the radio commands in folding sections (they stay open or closed as the player left them)
    const radioOpen = new Set();
    function radioSec(id, title, body, tag, openFirst) {
      if (openFirst && !radioOpen.has('seen:' + id)) { radioOpen.add('seen:' + id); radioOpen.add(id); }
      return `<details data-sec="${id}" ${radioOpen.has(id) ? 'open' : ''}><summary>${title}${tag ? `<span class="tag">${tag}</span>` : ''}</summary><div class="in">${body}</div></details>`;
    }
    function bindRadioSecs() {
      radioCmds.querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => {
        if (d.open) radioOpen.add(d.dataset.sec); else radioOpen.delete(d.dataset.sec);
        radioCmdHtml = radioCmdHtml.replace(new RegExp(`data-sec="${d.dataset.sec}" (open)?`), `data-sec="${d.dataset.sec}" ${d.open ? 'open' : ''}`); }));
    }
    // speed limit ordered by the PC: until a new order, or until the train leaves a station still ahead of it
    const VLIMITS = [15, 20, 25, 30, 40, 50, 55, 60, 70];
    let radioVSel = 30, radioVTo = '';
    function speedSec(F, tr) {
      if (!F.ag || tr.agentK == null) return '';
      const s = F.ag.state(tr.agentK); if (!s || s.hidden || s.status === 'parked') return '';
      const G = F.engine.G, ahead = (s.stops || []).filter((st, i) => !(i === 0 && s.stopAt === st));
      if (radioVTo !== '' && !ahead.includes(+radioVTo)) radioVTo = '';
      const now = s.vlim ? `${s.vlim} km/h ${s.vlimTo != null ? 'fino a ' + cap(G.names[s.vlimTo]) : 'fino a nuovo ordine'}` : '';
      const body = (now ? `<div class="lbl">In vigore: ${now}</div>` : '') +
        `<div class="row">${VLIMITS.map(v => `<button data-vs="${v}" aria-pressed="${radioVSel === v}">${v}</button>`).join('')}</div>
         <div class="lbl">Fino a</div>
         <div class="row"><select id="radioVTo" aria-label="Fino a"><option value="" ${radioVTo === '' ? 'selected' : ''}>nuovo ordine</option>${ahead.map(st => `<option value="${st}" ${String(st) === radioVTo ? 'selected' : ''}>partenza da ${cap(G.names[st])}</option>`).join('')}</select></div>
         <div class="row"><button id="radioSendSpeed" class="send">▶ Trasmetti ${radioVSel} km/h</button>${now ? '<button id="radioSpeedOff">Annulla limitazione</button>' : ''}</div>`;
      return radioSec('speed', 'Limitazione di velocità', body, s.vlim ? s.vlim + ' km/h' : '');
    }
    function bindSpeed(F, tr) {
      radioCmds.querySelectorAll('[data-vs]').forEach(b => b.onclick = () => { radioVSel = +b.dataset.vs; drawRadioCmds(); });
      const sel = document.getElementById('radioVTo'); if (sel) sel.onchange = () => { radioVTo = sel.value; drawRadioCmds(); };
      const go = document.getElementById('radioSendSpeed'), off = document.getElementById('radioSpeedOff'), G = F.engine.G, no = radioTrain.no;
      if (go) go.onclick = () => {
        const to = radioVTo === '' ? null : +radioVTo, until = to == null ? 'fino a nuovo ordine' : 'fino alla partenza da ' + cap(G.names[to]);
        say('PC', `Treno ${no}, limita la velocità a ${radioVSel} km/h ${until}. Passo.`, 'pc');
        F.ag.event({ kind: 'order', k: tr.agentK, what: 'speed', arg: { kmh: radioVSel, to } });
        (CALLS[tr.agentK] = CALLS[tr.agentK] || {}).vlimTo = to;
        driverSays(pick([`Ricevuto PC, marcia a ${radioVSel} km/h ${until}. Passo.`, `Copiato, ${radioVSel} all'ora ${until}. Passo.`]));
      };
      if (off) off.onclick = () => {
        say('PC', `Treno ${no}, annulla la limitazione di velocità, riprendi la marcia normale. Passo.`, 'pc');
        F.ag.event({ kind: 'order', k: tr.agentK, what: 'speedoff' });
        driverSays('Ricevuto PC, riprendo la velocità normale. Passo.');
      };
    }
    function drawRadioCmds() {
      if (radioEl.hidden || !radioTrain) return;
      if (radioTrain.F.ag && radioTrain.tr.agentK != null && radioTrain.F.ag.agents()[radioTrain.tr.agentK] && radioTrain.F.ag.agents()[radioTrain.tr.agentK].mode !== 'plan') {
        const h = emergencyCmds(radioTrain.F, radioTrain.tr) + speedSec(radioTrain.F, radioTrain.tr);
        if (h === radioCmdHtml) return;
        radioCmdHtml = h; radioCmds.innerHTML = h; bindEmergencyCmds(radioTrain.F, radioTrain.tr); bindRadioSecs(); bindSpeed(radioTrain.F, radioTrain.tr); return;
      }
      const { F, tr } = radioTrain, ns = nextStop(F, tr), pend = radioWatch.filter(w => w.tr === tr).length;
      let h = '', x = '';
      // San Donato: platform 2 taken by a train reversing there, this one waits in the tail (a call: open)
      const cp = tr.agentK != null && CALLS[tr.agentK] && CALLS[tr.agentK].p2;
      if (cp && tr.alts[cp.ai]) h += radioSec('p2', 'Binario 2 occupato', `<div class="row"><button id="p2Wait">Resta fermo e attendi</button><button id="p2Divert">Devia al binario 3</button></div>`, 'retrocessione', true);
      // the depot place given to a train coming in: the PC can change it until #A04/#A05
      const tq = tr.agentK != null && F.depot && F.depot.target[tr.agentK];
      if (tq != null && !pastEntrance(F, tr.agentK)) {
        const taken = depotTaken(F), opts = Object.keys(F.depotPaths).filter(q => q === tq || !taken.has(q)).sort((p, q) => depotName(F, p).localeCompare(depotName(F, q), undefined, { numeric: true }));
        h += radioSec('place', 'Posto in deposito', `<div class="lbl">Assegnato ${depotName(F, tq)}</div><div class="row"><select id="placeSel" aria-label="Posto">${opts.map(q => `<option value="${q}" ${q === tq ? 'selected' : ''}>${depotName(F, q)}</option>`).join('')}</select><button id="placeGo" class="send">▶ Cambia posto</button></div>`, depotName(F, tq), true);
      }
      // depot on manual: open the signal the train is waiting for
      const dq = tr.agentK != null ? depotAsk(F, tr.agentK) : null;
      if (dq) h += radioSec('dep', 'Segnale del deposito', dq.open ? `<div class="lbl">${sigNo(F, dq.si)} aperto: il treno può partire</div>`
        : `<div class="lbl">${sigNo(F, dq.si)} rosso · ${dq.what}</div><div class="row"><button id="depOpen" class="send">▶ Apri ${sigNo(F, dq.si)}</button></div>`, dq.open ? 'aperto' : 'richiesta', !dq.open);
      // longer stop at a station
      if (ns) {
        const had = tr.env && tr.env.extra && tr.env.extra[ns.key] || 0;
        x = `<div class="lbl">${cap(ns.name)}${ns.here ? ' (fermo qui)' : ''}${had ? ' · già ordinati ' + durTxt(had) : ''}</div>
          <div class="row">${[30, 60, 90, 120].map(v => `<button data-rs="${v}" aria-pressed="${radioStopSel === v}">${v < 60 ? v + 's' : (v / 60) + (v % 60 ? '' : '') + ' min'}</button>`).join('').replace('1.5 min', '1:30')}</div>
          <div class="lbl">Motivo</div>
          <div class="row">${RADIO_WHY.map((w, i) => `<button data-rw="${i}" aria-pressed="${w === radioWhy}">${w}</button>`).join('')}</div>
          <div class="row"><button id="radioSendStop" class="send">▶ Trasmetti</button></div>`;
      } else x = `<div class="lbl">Nessuna fermata davanti: il treno non è in servizio</div>`;
      if (pend) x += `<div class="row"><button id="radioCancel">Annulla le soste ordinate (${pend})</button></div>`;
      h += radioSec('stop', 'Attesa in stazione', x, pend ? pend + ' ordinate' : '');
      h += speedSec(F, tr);
      // departure platform at San Donato
      const ai = tr.alts.findIndex(a => state.t <= a.leave && a.leave - state.t < 20 * 60);
      if (ai >= 0) { const a = tr.alts[ai];
        h += radioSec('plat', 'Partenza da San Donato', `<div class="lbl">Partenza delle ${fmt(a.dep)}</div><div class="row">${Object.keys(a.opts).map(Number).sort().map(p => `<button data-rp="${p}" data-ai="${ai}" ${a.plat === p ? 'disabled' : ''}>Binario ${p}</button>`).join('')}</div>`, 'binario ' + a.plat); }
      // which tail at Comasina
      const ci = (tr.calts || []).findIndex(c => !c.done && state.t >= c.open && state.t <= c.close);
      if (ci >= 0) { const c = tr.calts[ci];
        h += radioSec('tail', 'Tronchetto a Comasina', `<div class="row">${Object.keys(c.opts).map(Number).sort((a, b) => c.names[a] - c.names[b]).map(t => `<button data-rt="${t}" data-ci="${ci}" ${c.tail === t ? 'disabled' : ''}>Tronchetto ${c.names[t]}</button>`).join('')}</div>`, c.tail != null && c.names[c.tail] != null ? 'tronchetto ' + c.names[c.tail] : ''); }
      // platform 2 and reversal, coming from Rogoredo
      const k2 = (tr.arr2 || []).findIndex(a => !a.done && state.t >= a.open && state.t <= a.close);
      if (k2 >= 0) h += radioSec('arr2', 'Arrivo a San Donato', `<div class="row"><button id="radioP2">Entra al binario 2 e inverti lì</button></div>`);
      if (h === radioCmdHtml) return;          // unchanged: keep the buttons as they are (nothing closes or flickers)
      radioCmdHtml = h; radioCmds.innerHTML = h; bindRadioSecs(); bindSpeed(F, tr);
      radioCmds.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { radioStopSel = +b.dataset.rs; drawRadioCmds(); });
      radioCmds.querySelectorAll('[data-rw]').forEach(b => b.onclick = () => { radioWhy = RADIO_WHY[+b.dataset.rw]; drawRadioCmds(); });
      const send = document.getElementById('radioSendStop');
      if (send) send.onclick = () => {
        const n = nextStop(F, tr); if (!n) return;
        tr.env = tr.env || {}; tr.env.extra = tr.env.extra || {};
        const before = tr.env.extra[n.key] || 0, total = before + radioStopSel;
        say('PC', `Treno ${radioTrain.no}, ${WHY_TXT[radioWhy]}: ${before ? 'aggiungi ' + (radioStopSel === 60 ? 'un altro minuto' : 'altri ' + durTxt(radioStopSel)) + ' di sosta' : 'fai una sosta di ' + durTxt(radioStopSel)} a ${cap(n.name)}. Passo.`, 'pc');
        tr.env.extra[n.key] = total; relive(tr);           // a second order adds to the first (one more minute = one more minute)
        const w0 = radioWatch.find(w => w.tr === tr && w.key === n.key);
        if (w0) w0.dur = total; else radioWatch.push({ tr, F, key: n.key, name: n.name, dur: total, said: 0 });
        if (before) { driverSays(`Ricevuto PC, ${radioStopSel === 60 ? 'un altro minuto' : 'altri ' + durTxt(radioStopSel)} a ${cap(n.name)}: in tutto ${durTxt(total)} di sosta in più. Avviso i passeggeri. Passo.`); return; }
        const st0 = trainState(F, tr, state.t);
        const dawn = state.t < 6 * 3600 + 15 * 60 && radioWhy !== 'nessun motivo';
        if (radioWhy === 'treno davanti in ritardo' && st0.trip >= 0 && firstRuns(F).has(st0.trip))
          driverSays(pick([`Ritardo il treno davanti? PC, sono il primo della giornata: davanti a me ci sono solo i topi e il buio. Va bene, sosta di ${durTxt(radioStopSel)} a ${cap(n.name)}. Passo.`,
                           `Davanti a me? PC, ho aperto io la linea stamattina, davanti non c'è nessuno! Faccio comunque ${durTxt(radioStopSel)} a ${cap(n.name)}, magari il caffè è ancora caldo. Passo.`]));
        else if (dawn) driverSays(`Iniziamo bene la giornata! Ricevuto, sosta di ${durTxt(radioStopSel)} a ${cap(n.name)}. Passo.`);
        else if (radioStopSel > 30 && st0.trip >= 0 && lastRuns(F).has(st0.trip)) driverSays(`Ricevuto, sosta di ${durTxt(radioStopSel)} a ${cap(n.name)}. Il collega non ha voglia di tornare a casa? Passo.`);
        else driverSays(pick([`Ricevuto PC, sosta di ${durTxt(radioStopSel)} a ${cap(n.name)}. Avviso i passeggeri. Passo.`,
                         `Copiato, Posto Centrale. A ${cap(n.name)} tengo le porte aperte ${durTxt(radioStopSel)}. Passo e chiudo.`,
                         `Ricevuto. Fermata prolungata a ${cap(n.name)}, ${durTxt(radioStopSel)}. Passo.`]));
      };
      const pGo = document.getElementById('placeGo');
      if (pGo) pGo.onclick = () => { const q = document.getElementById('placeSel').value, k = tr.agentK; if (q === F.depot.target[k]) return;
        const old = F.depot.target[k]; delete F.depot.target[k];
        if (!pastEntrance(F, k) && depotAssign(F, k, q)) { say('PC', `Treno ${radioTrain.no}, cambio posto in deposito: vai in ${depotName(F, q)}. Passo.`, 'pc'); driverSays(`Ricevuto PC, vado in ${depotName(F, q)}. Passo.`); }
        else { F.depot.target[k] = old; say('PC', `Treno ${radioTrain.no}, vai in ${depotName(F, q)}. Passo.`, 'pc'); driverSays('Negativo PC, ho già passato l\'ingresso del deposito. Passo.'); }
        radioCmdHtml = ''; drawRadioCmds(); };
      const dOpen = document.getElementById('depOpen');
      if (dOpen) dOpen.onclick = () => { const q = depotAsk(F, tr.agentK); if (!q) return;
        say('PC', `Treno ${radioTrain.no}, apro il segnale ${sigNo(F, q.si)}, via libera per ${q.what}. Passo.`, 'pc');
        F.ag.event({ kind: 'il', what: 'clear', si: q.si }); env.resetSigs();
        driverSays(pick(['Ricevuto PC, segnale aperto, procedo. Passo.', 'Copiato, vedo il bianco. Mi muovo. Passo.'])); radioCmdHtml = ''; drawRadioCmds(); };
      const p2w = document.getElementById('p2Wait'), p2d = document.getElementById('p2Divert');
      if (p2w) p2w.onclick = () => { say('PC', `Treno ${radioTrain.no}, resta fermo sul tronchetto e attendi che il binario 2 si liberi. Passo.`, 'pc');
        driverSays('Ricevuto PC, attendo il via libera per il binario 2. Passo.'); };
      if (p2d) p2d.onclick = () => {
        const c = CALLS[tr.agentK], alt = c && c.p2 && tr.alts[c.p2.ai]; if (!alt) return;
        say('PC', `Treno ${radioTrain.no}, ti devio al binario 3: ci aspettiamo di partire dal binario 3. Passo.`, 'pc');
        const keep = tr.segs.slice(alt.i, alt.i + alt.n);
        setPlat(tr, alt, 1);
        if (F.ag.replan(tr.agentK) === false) {          // it is already past the switch: back to platform 2
          tr.segs.splice(alt.i, keep.length, ...keep); tr.starts = tr.segs.map(x => x[3][0]); alt.plat = 2; relive(tr);
          driverSays('Negativo PC, ho già passato lo scambio. Resto in attesa per il binario 2. Passo.');
        } else { c.p2 = null; driverSays('Ricevuto, vado sul binario 3 e parto da lì. Passo.'); }
      };
      const cancel = document.getElementById('radioCancel');
      if (cancel) cancel.onclick = () => { say('PC', `Treno ${radioTrain.no}, annulla la sosta prolungata, servizio regolare. Passo.`, 'pc');
        radioWatch.filter(w => w.tr === tr).forEach(w => { delete tr.env.extra[w.key]; radioWatch.splice(radioWatch.indexOf(w), 1); });
        relive(tr); driverSays('Ricevuto PC, riprendo il servizio regolare. Passo.'); };
      radioCmds.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => {
        const a = tr.alts[+b.dataset.ai], pl = +b.dataset.rp;
        say('PC', `Treno ${radioTrain.no}, a San Donato si aspetti di partire dal binario ${pl}. Passo.`, 'pc');
        tr.segs.splice(a.i, a.n, ...JSON.parse(JSON.stringify(a.opts[String(pl)]))); tr.starts = tr.segs.map(x => x[3][0]); a.plat = pl;
        if (tr.env) tr.env.extra = {}; relive(tr);
        driverSays(`Ricevuto, ci aspettiamo di partire dal binario ${pl}. Passo.`);
        closeAfter(F, tr, a.dep);
      });
      radioCmds.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => {
        const c = tr.calts[+b.dataset.ci], t = +b.dataset.rt, nm = c.names[t];
        say('PC', `Treno ${radioTrain.no}, a Comasina vai nel tronchetto ${nm}. Passo.`, 'pc');
        const plan = tailChain(F, tr, c, t) || (!tailBusy(F, tr, t, c) ? [{ tr, c, to: t }] : null);
        if (!plan) { driverSays(`Negativo PC, il tronchetto ${nm} resta occupato troppo a lungo. Resto sul programmato. Passo.`); return; }
        if (plan.length > 1) {
          plan.forEach(p => { applyAlt(p.tr, p.c.i, p.c.n, p.c.opts[String(p.to)], true); p.c.tail = p.to; });
          reliveFleet(F, null);
          const others = [...new Set(plan.slice(1).map(p => trainNo(F, p.tr)))];
          driverSays(`Ricevuto, a Comasina entro nel tronchetto ${nm}. ` + (others.length === 1 ? `Il treno ${others[0]} cambia tronchetto.` : `Cambiano tronchetto anche i treni ${others.join(', ')}.`) + ' Passo.');
          return;
        }
        const w = tailWait(F, tr, t, c);
        applyAlt(tr, c.i, c.n, c.opts[String(t)]); c.tail = t; c.done = false;
        closeAfter(F, tr, c.leave + 30);
        driverSays(w ? `Ricevuto, tronchetto ${nm}. Attendo in banchina che il treno ${trainNo(F, w)} lo liberi. Passo.`
                     : pick([`Ricevuto, a Comasina entro nel tronchetto ${nm}. Passo.`, `Copiato PC, tronchetto ${nm}. Passo e chiudo.`]));
      });
      const p2 = document.getElementById('radioP2');
      if (p2) p2.onclick = () => {
        say('PC', `Treno ${radioTrain.no}, a San Donato entra al binario 2 e cambia banco lì. Passo.`, 'pc');
        const before = !!tr.p2; env.p2Msg = ''; orderP2(F, tr, k2); if (tr.env) tr.env.extra = {};
        if (tr.p2 && !before) closeAfter(F, tr, tr.p2.dep);
        if (tr.p2 && !before) driverSays(pick(['Ricevuto PC, entro al binario 2 e cambio banco in stazione. Passo.', 'Copiato, binario 2 con inversione sul posto. Passo e chiudo.']));
        else driverSays('Negativo PC, ' + (env.p2Msg.replace(/^Order refused: /, '').replace('platform 2 is not free', 'il binario 2 non è libero').replace('is standing there', 'è fermo lì') || 'non posso eseguire') + ' Passo.');
      };
    }
    // replace segments i..i+n-1 of a train's plan, keeping its other choices (platform, platform 2, tail) in step
    function applyAlt(tr, i, n, segs, noRelive) {
      const add = JSON.parse(JSON.stringify(segs)), end = i + n, delta = add.length - n;
      tr.segs.splice(i, n, ...add); tr.starts = tr.segs.map(x => x[3][0]);
      const fix = list => (list || []).forEach(a => { if (a.i >= end) a.i += delta; else if (a.i + (a.n || 1) > i && a.i < end && a.i !== i) a.done = true; });
      fix(tr.alts); fix(tr.arr2); fix(tr.calts);
      tr.alts = (tr.alts || []).filter(a => !a.done);
      if (tr.env && tr.env.extra) Object.keys(tr.env.extra).forEach(k => { if (+k.split(':')[0] >= i) delete tr.env.extra[k]; });
      if (!noRelive) relive(tr);
    }
    // Comasina tail order: putting this train in tail t can push the trains behind it to the other tail, one after
    // the other, until the alternation finds a gap again. Returns the list of changes, or null if a tail stays blocked.
    function tailChain(F, tr, c, t) {
      const PAD = 60, all = [];
      F.trains.forEach(o => (o.calts || []).forEach(x => { if (!x.done) all.push({ tr: o, c: x, to: x.tail }); }));
      all.sort((a, b) => a.c.arr - b.c.arr);
      const me = all.find(a => a.c === c); if (!me) return null; me.to = t;
      const clash = (a, b) => a.to === b.to && a.c.arr < b.c.leave + PAD && b.c.arr < a.c.leave + PAD;
      // trains already ahead in that tail: fine if they leave soon after this one arrives (it waits on the platform)
      for (const a of all) if (a !== me && a.c.arr < c.arr && clash(a, me) && a.c.leave > c.arr + 240) return null;
      const changed = [me]; let reach = c.leave;
      for (const a of all) {
        if (a === me || a.c.arr <= c.arr) continue;
        if (a.c.arr > reach + PAD) break;
        const bad = to => all.some(b => b !== a && b.c.arr <= a.c.arr && (b === me || b.c.arr < a.c.arr) && b.to === to && b.c.arr < a.c.leave + PAD && a.c.arr < b.c.leave + PAD && b.c.leave > a.c.arr + 240);
        if (!bad(a.to)) continue;
        const other = Object.keys(a.c.opts).map(Number).find(x => x !== a.to);
        if (other == null || bad(other) || state.t > a.c.close) return null;
        a.to = other; changed.push(a); reach = Math.max(reach, a.c.leave);
        if (changed.length > 60) return null;
      }
      return changed;
    }
    // is that Comasina tail used by another train while this one would be there?
    function tailBusy(F, tr, t, c, also) {
      const nm = 'tronchetto ' + c.names[t] + ' ' + F.far, R = (F.engine.throatR || []).find(r => r.name === nm); if (!R) return null;
      for (const o of F.trains) { if (o === tr || o === also || !o.live) continue;
        for (const x of MTLEngine.occupancy(o.live, R, F.engine.half)) if (x.enter < c.leave + 60 && x.exit > c.leave - 120) return o; }
      return null;
    }
    // a train that leaves that tail soon after this one arrives: possible, this one waits for it on the platform
    function tailWait(F, tr, t, c) {
      const nm = 'tronchetto ' + c.names[t] + ' ' + F.far, R = (F.engine.throatR || []).find(r => r.name === nm); if (!R) return null;
      for (const o of F.trains) { if (o === tr || !o.live) continue;
        for (const x of MTLEngine.occupancy(o.live, R, F.engine.half)) if (x.enter < c.arr && x.exit > c.arr - 30) return o; }
      return null;
    }
    // every conversation ends when the train leaves: "Ripartito, passo. Buona giornata."
    const BYE = 'Ripartito, passo. Buona giornata.', closing = [];
    function closeAfter(F, tr, t) { const i = closing.findIndex(c => c.tr === tr); if (i >= 0) closing.splice(i, 1); closing.push({ F, tr, t }); }
    function closingTick() {
      for (let i = closing.length - 1; i >= 0; i--) { const c = closing[i];
        if (state.t < c.t) continue;
        const st = trainState(c.F, c.tr, state.t);
        if (st.v > 0 || state.t > c.t + 1800) { if (st.v > 0) say('T' + trainNo(c.F, c.tr), BYE, 'dr'); closing.splice(i, 1); } }
    }
    // last passenger run of the evening in each direction (easter egg on the radio)
    let LASTRUNS = null;
    // the first passenger run of the day each way (nobody in front of it)
    let FIRSTRUNS = null;
    function firstRuns(F) {
      if (FIRSTRUNS) return FIRSTRUNS;
      const best = {};
      F.trains.forEach(tr => tr.segs.forEach(sg => { if (sg[1] !== 'service' || sg[2] < 0) return; const tp = trips[sg[2]], a = D.stops[tp.st[0]], b = D.stops[tp.st[tp.st.length - 1]];
        const dir = b[1] > a[1] ? 'N' : 'S'; if (!best[dir] || tp.start < trips[best[dir]].start) best[dir] = sg[2]; }));
      return (FIRSTRUNS = new Set(Object.values(best)));
    }
    function lastRuns(F) {
      if (LASTRUNS) return LASTRUNS;
      const best = {};
      F.trains.forEach(tr => tr.segs.forEach(sg => { if (sg[1] !== 'service' || sg[2] < 0) return; const tp = trips[sg[2]], a = D.stops[tp.st[0]], b = D.stops[tp.st[tp.st.length - 1]];
        const dir = b[1] > a[1] ? 'N' : 'S'; if (!best[dir] || tp.start > trips[best[dir]].start) best[dir] = sg[2]; }));
      return (LASTRUNS = new Set(Object.values(best)));
    }
    // ---- via impedita: a train stopped in front of a red signal calls the DCO on the radio. No answer for now: the train
    // stays where it is until the signal clears by itself, then says it is moving again. Only when the train should be
    // moving by the timetable, and only after 5 minutes held at the same signal. ----
    const redStops = new Map(), dcoCalls = [];
    function sigName(bl) {
      if (bl.kind === 'throat') return 'segnale di protezione (' + bl.name.trim() + ')';
      const n = cap(bl.name.slice(2)).replace(' (Blocco)', '').replace(' Arrivo', '');
      return bl.kind === 'entry' ? 'segnale di protezione di ' + n : bl.kind === 'departure' ? 'segnale di partenza di ' + n.split(' → ')[0] : 'segnale di blocco ' + n.replace(' → ', ' – ');
    }
    // does the timetable plan have this train standing still at time t? (then a red ahead is normal, no call)
    function planStanding(tr, t) {
      const st = tr.starts; if (!st || t < st[0]) return true;
      let lo = 0, hi = st.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m] <= t) lo = m; else hi = m - 1; }
      const ts = tr.segs[lo][3], ds = tr.segs[lo][4]; if (t >= ts[ts.length - 1]) return true;
      let i = 0; while (i < ts.length - 2 && ts[i + 1] <= t) i++;
      return ds[i + 1] === ds[i];
    }
    // emergency: what the drivers say on their own (stopped by the closure, red signal for 5 minutes, very late)
    const CALLS = {};
    // depot on manual: the next depot signal a train needs (a shunting or depot protection signal still red for it)
    function depotAsk(F, k) {
      const ag = F.ag, IL = ag && ag.IL, il = ag && ag.il(); if (!IL || !il || il.auto) return null;
      const a = ag.agents()[k]; if (!a || a.hidden || a.mode !== 'plan') return null;
      const leg = a.legs[0] && !a.legs[0].kind ? a.legs[0] : null, pid = leg ? leg.pid : a.pid, from = leg && leg.start != null && pid !== a.pid ? leg.start : a.d;
      const c = IL.ahead(pid, from + F.engine.half, 900).find(x => IL.isManual(x.si) && il.grant[x.si] !== k); if (!c) return null;
      const st = leg ? leg.status : a.status, n = (F.engine.net.signals[c.si] || {}).n, lr = loopRole(F.trains[k].segs[a.si]);
      // #A02/#A03: from the depot onto the line; #A04/#A05: from the line into the depot; shunting signals: depot moves
      const what = lr === 'in' || lr === 'in2' || lr === 'gate' ? 'uscita verso l\'anello di prova' : lr === 'home' ? 'rientro in deposito dall\'anello di prova'
        : n === 2 || n === 3 ? 'entrata in linea' : n === 4 || n === 5 ? 'entrata in deposito'
        : st === 'from_depot' || st === 'empty' && (pid !== a.pid || ag.S.t < a.wait || a.status === 'parked') ? 'uscita dal deposito' : 'manovra in deposito';
      return { si: c.si, open: il.pass[c.si] > 0, what, dist: c.d - (from + F.engine.half),
               due: ag.S.t < a.wait ? a.wait : null, red: a.red && a.red.why && a.red.why.sig === c.si ? a.red.since : null, loop: !!lr };
    }
    function emergencyCalls(F) {
      const G = F.engine.G, ag = F.ag, R_ = ag.resources(), em = { ag };
      ag.agents().forEach((a, k) => {
        const tr = F.trains[k], no = trainNo(F, tr), c = CALLS[k] = CALLS[k] || {};
        const call = text => { if (radioEl.hidden) openRadio(F, tr); radioEl.classList.add('calling'); setTimeout(() => radioEl.classList.remove('calling'), 4000); say('T' + no, text, 'call'); };
        // depot on manual: 2 minutes before moving (or on reaching a red depot signal) the driver asks for it, again after 1 minute
        const dq = depotAsk(F, k);
        if (dq && !dq.open) {
          const t = ag.S.t, h = Math.floor(t / 3600) % 24, hi = h >= 5 && h < 14 ? 'Buongiorno' : 'Buonasera', key = dq.si + ':' + (dq.due || 'r');
          const atSig = dq.red != null || dq.due != null && dq.dist < 40;           // standing in front of it
          if (dq.loop) {          // going to (or back from) the test loop: it asks after 2 minutes at the red signal, again after 7
            const w = dq.red != null ? t - dq.red : -1;
            if (c.depKey !== key && w >= 120) { c.depKey = key; c.depAgain = false;
              call(`${hi} PC, qui treno ${no}: sono fermo da 2 minuti al segnale ${sigNo(F, dq.si)}, richiesta apertura per ${dq.what}. Passo.`); }
            else if (c.depKey === key && !c.depAgain && w >= 420) { c.depAgain = true;
              call(`PC, qui treno ${no}, sono fermo da 7 minuti al segnale ${sigNo(F, dq.si)}: attendo ancora l'apertura per ${dq.what}. Passo.`); }
          } else
          if (c.depKey !== key && atSig && (dq.due == null || t >= dq.due - 120)) { c.depKey = key; c.depAgain = false;
            call(`${hi} PC, qui treno ${no}: richiesta apertura segnale ${sigNo(F, dq.si)} per ${dq.what}. Passo.`); }
          else if (c.depKey === key && !c.depAgain && (dq.due != null ? t >= dq.due + 60 : dq.red != null && t - dq.red >= 60)) { c.depAgain = true;
            call(`PC, qui treno ${no}, sono ancora in attesa dell'apertura del segnale ${sigNo(F, dq.si)} per ${dq.what}. Passo.`); }
        } else if (!dq) c.depKey = null;
        if (a.status === 'stopped' && !c.stopped) {
          c.stopped = true; const at = a.inside ? G.names[a.inside.stops[a.inside.q].st] : '';
          call(`PC, qui treno ${no}, fermo a ${cap(at)}: la linea davanti è interrotta. Attendo istruzioni. Passo.`);
        }
        if (a.status !== 'stopped') c.stopped = false;
        if (a.red && em.ag.S.t - a.red.since >= 300 && !c.red && !(dq && !dq.open && dq.red != null)) {   // (depot signals on manual: their own calls)
          c.red = true; const w = a.red.why || {};
          const what = w.sig != null ? 'al segnale ' + sigNo(F, w.sig) : w.res != null ? 'al segnale ' + (R_[w.res].name.replace(/^blocco /, '').replace(/^(N|S) /, '')) : 'dietro al treno ' + trainNo(F, F.trains[w.train] || tr);
          call(`PC, qui treno ${no}, sono fermo ${what} da 5 minuti, via impedita. Chiedo spiegazioni. Passo.`);
        }
        if (!a.red && c.red) { c.red = false; say('T' + no, `Qui ${no}, via libera. Ripartito, passo. Buona giornata.`, 'dr'); }
        // San Donato: from the tail towards platform 2 while a train reverses there: it waits, then asks the PC
        if (a.mode === 'plan' && !a.hidden && a.stopAt == null && a.v === 0 && a.red && em.ag.S.t - a.red.since >= 30 && !c.p2) {
          const ai = (tr.alts || []).findIndex(x => x.plat === 2 && state.t <= x.leave && x.leave - state.t < 15 * 60 && x.opts['1']);
          const o = ai >= 0 ? trainOnPlatform(F, P2WAY, state.t, tr) : null;
          if (o && o.p2 && state.t <= o.p2.dep + 60) { c.p2 = { ai };
            call(`PC, qui treno ${no}, sono sul tronchetto di San Donato: il binario 2 è occupato dal treno ${trainNo(F, o)} in retrocessione. Resto fermo o mi mandate al binario 3? Chiedo istruzioni. Passo.`); }
        }
        if (c.p2 && (!a.red || !tr.alts[c.p2.ai] || tr.alts[c.p2.ai].plat !== 2)) c.p2 = null;
        if (c.vlimTo != null && !a.vlim) { const where = G.names[c.vlimTo]; c.vlimTo = null;
          if (!radioEl.hidden && radioTrain && radioTrain.tr === tr) say('T' + no, `Qui ${no}, lasciata ${cap(where)}: fine limitazione, riprendo la velocità normale. Passo.`, 'dr'); }
        if (a.late != null && a.late > 600 && (!c.late || em.ag.S.t - c.late > 900)) {
          c.late = em.ag.S.t;
          call(`PC, qui treno ${no}, siamo in forte ritardo (+${Math.round(a.late / 60)} min). Chiedo autorizzazione per salto fermate, limitazione corsa o rientro in deposito. Passo.`);
        }
      });
    }
    function dcoTick() {
      const F = m3eng(); if (!F || !state.engine) return;
      if (F.ag) { emergencyCalls(F); return; }
      const AR = F.engine.throatR || [], BR = AR.filter(r => r.block), BL = F.engine.blocks || [], half = F.engine.half;
      const occ = F.trains.map(tr => trainState(F, tr, state.t));
      const inside = (R, k) => occ.some((q, j) => j !== k && q.status !== 'parked' && R.ranges[q.pid] && q.d >= R.ranges[q.pid][0] - half + R.pad && q.d <= R.ranges[q.pid][1] + half);
      F.trains.forEach((tr, k) => {
        const o = occ[k]; let red = null;
        if (o.status !== 'parked' && o.seg >= 0 && o.v === 0 && !planStanding(tr, state.t)) {
          // the section in front of the nose (a block, or the terminal junction / a tail) is taken by another train
          // standing at a signal (within 40 m of the start of a section), with the route behind it not free: the section
          // itself or the junction / tail it leads to (up to 400 m ahead)
          const gapOf = R => { const r = R.ranges[o.pid]; return r ? r[0] + (R.pad || 0) - (o.d + half) : null; };
          const atSig = AR.some(R => { const g = gapOf(R); return g != null && g >= -3 && g <= 40; });
          const ahead = atSig ? AR.filter(R => { const g = gapOf(R); return g != null && g >= -3 && g <= 400; }) : [];
          if (ahead.some(R => inside(R, k))) {
            const bi = BR.findIndex(R => { const r = R.ranges[o.pid]; return r && Math.abs(r[0] - (o.d + half)) <= 40; });
            const th = ahead.find(R => !R.block && inside(R, k));
            red = bi >= 0 ? BL[bi] : { kind: 'throat', name: '  ' + (th ? th.name : 'sezione') };
          }
        }
        const w = redStops.get(tr);
        if (!red) { if (w) { if (w.called) say('T' + trainNo(F, tr), `Qui ${trainNo(F, tr)}, ${w.name} a via libera. ${BYE}`, 'dr'); redStops.delete(tr); } return; }
        if (!w) {
          // at a platform = a timetable stop of the planned run, not just near a station
          const ps = tr.segs[o.seg], pds = ps && ps[0] === o.pid ? ps[4] : [];
          let plat = false; for (let i = 1; i < pds.length; i++) if (pds[i] === pds[i - 1] && Math.abs(pds[i] - o.d) < 5) plat = true;
          // Giovanni: no call at once; only after 5 minutes held at the same signal
          redStops.set(tr, { since: state.t, name: sigName(red), wait: 300, called: false, plat }); return;
        }
        if (!w.called && state.t - w.since >= w.wait) {
          w.called = true; dcoCalls.push({ t: state.t, train: trainNo(F, tr), sig: w.name });
          if (radioEl.hidden) openRadio(F, tr);
          radioEl.classList.add('calling'); setTimeout(() => radioEl.classList.remove('calling'), 4000);
          say('T' + trainNo(F, tr), `PC, qui treno ${trainNo(F, tr)}, sono fermo al ${w.name}, via impedita. Chiedo spiegazioni. Passo.`, 'call');
        }
      });
    }
    // the driver reports when the ordered stop starts and ends
    function radioTick() {
      for (let i = radioWatch.length - 1; i >= 0; i--) {
        const w = radioWatch[i], st = trainState(w.F, w.tr, state.t), here = st.v === 0 && w.tr.segs[st.seg] && (st.seg + ':' ) && stationAt(w.F, st.pid, st.d) === w.name;
        if (w.said === 0 && here) { w.said = 1; if (radioTrain && radioTrain.tr === w.tr) { say('T' + radioTrain.no, `Fermo a ${cap(w.name)}, porte aperte, attendo ${durTxt(w.dur)}.`, 'dr'); } }
        else if (w.said === 1 && !here) { if (radioTrain && radioTrain.tr === w.tr) say('T' + radioTrain.no, BYE, 'dr'); radioWatch.splice(i, 1); }
      }
      drawRadioCmds();
    }


    return { say, cap, pick, trainNo, openRadio, radioTick, dcoTick, closingTick, applyAlt, tailChain, tailBusy, dcoCalls, firstRuns, lastRuns, sigName,
             radioEl, isOpen: () => !radioEl.hidden, current: () => radioTrain };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLRadio = api;
})(typeof window !== 'undefined' ? window : globalThis);
