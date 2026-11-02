// Milano Transit Live — failures (guasti, fase D) of the M3 trains, from Giovanni's foglio Guasti.
//
// A failure lives in the state of the day (S.faults: saved with the rest, so going back in time and the same events
// give the same day). Each one has its phases and times; at some phases the driver (or the station agent) calls the DCT
// and waits for an answer: the call shows among the DCT alarms with the answers it can take. When nobody answers for
// 3 minutes the DCT answers by itself (the train must not stand there for ever when the player is away).
// Random failures (admin: "Guasti casuali"): every minute, each kind happens with the chance of its "Volte al giorno"
// of the Excel (people blocking the doors more in the peak hours), on a train in service. The random draws come from
// a seeded generator kept in the state (the same day again gives the same failures).
//
// D1: the failures of the train. trazione (1: does not start again, re-arming, after 3 failed re-armings it needs the
// rescue), porta (2), freno (3: emergency braking in the line, re-arming), ato (5: manual driving), allarme (6:
// passenger alarm, the agent checks at the next station; sometimes a passenger taken ill, 21), porte_persone (19),
// malore_treno (21), riarmo (23: the train keeps asking to be re-armed; the line maintenance of San Donato sends a
// technician who gets on at San Donato). The rescue itself (D4) is still simple: the train waits, then goes on.
//
// D2: the failures of the line (no train: a signal, a switch, a stretch). segnale (8: it stays red), sezione (9: the
// section after a signal shows occupied with no train on it), scambio (7: it does not go into position; the DCT sends
// the team, who work it by hand and clamp it in the position the DCT says; then every train over it needs the DCT's
// authorisation), tensione (10: no power between two stations; the trains there stand; when it is repaired the DCT
// gives the power back). A train stopped by one of them calls the DCT, who lets it by in marcia a vista (vista: 15 km/h
// up to the next signal; web/routes.js). The DCT can also let a train standing at a signal by from its card.
//
// D3: people and emergencies (a station, or a stretch). persona (11: someone on the tracks; the DCT presses the red
// button and cuts the power around the station; rarely the person is gone when the agent gets there), investimento
// (12: a person hit by a train: the station and its tracks out of use for 3-5 hours), tunnel (13: someone in the
// tunnel; after the police the first trains go through in marcia a vista), incendio (20: fire in a station, it closes;
// smoke in the tunnel: red button and no power), malore_stazione (22: a person taken ill in a station: the trains slow
// down coming in, and the agent sometimes asks to hold them a moment), oggetto (24: something fallen on the track: the
// agent checks, 2 times in 3 there is nothing). The zones (no power, red button, held, slow, marcia a vista) are kept by
// the engine (web/agents.js); the DCT can set them by hand too (Emergenze).
//
// D4 (after a colleague of Giovanni's, Nov 2026): every train is two independent units (UdT). When re-arming does not
// work the driver cuts out the broken unit and the train goes on with the other (half the traction): passengers off
// at the next station, then empty to the depot of Rogoredo (ROD) or to a tail at Comasina. ATP failed: limited speed,
// back to ROD at the end of the run. Only when both units are dead (very rare) the train behind rescues it (pushes it
// at 15 km/h; web/agents.js). The Badoni tractor needs the line cut off: not simulated.
(function (root) {
  // the kinds, with the words of the Excel (the row of foglio Guasti is matched by these at build time)
  const KINDS = {
    trazione: { label: 'Il treno non riparte (trazione)' },
    porta: { label: 'Una porta non si chiude' },
    freno: { label: 'Frenatura di emergenza intempestiva' },
    ato: { label: 'Guasto ATO' },
    atp: { label: 'Guasto ATP' },
    udt: { label: 'Guasto a una unità (UdT esclusa, rientro)', as: 'trazione' },
    soccorso: { label: 'Guasto totale del treno (soccorso)', as: 'trazione' },
    allarme: { label: 'Allarme passeggero' },
    porte_persone: { label: 'Persone bloccano le porte' },
    malore_treno: { label: 'Persona si sente male sul treno' },
    riarmo: { label: 'Il treno chiede continuamente il riarmo' },
    secondario: { label: 'Problema secondario (tecnico a bordo)' },
    segnale: { label: 'Segnale guasto (resta rosso)', on: 'signal' },
    sezione: { label: 'Sezione occupata falsa', on: 'signal' },
    scambio: { label: 'Scambio guasto (non va in posizione)', on: 'switch' },
    tensione: { label: 'Mancanza di tensione su una tratta', on: 'stretch' },
    persona: { label: 'Persona sui binari', on: 'station' },
    oggetto: { label: 'Oggetto caduto sul binario', on: 'station' },
    malore_stazione: { label: 'Persona si sente male in stazione', on: 'station' },
    tunnel: { label: 'Persona nel tunnel', on: 'stretch' },
    investimento: { label: 'Investimento', on: 'station' },
    incendio: { label: 'Incendio in stazione', on: 'station' },
    prefettura: { label: 'Chiusura per disposizione della Prefettura', on: 'station' },
    vista: { label: 'Richiesta di marcia a vista', on: 'none' },
    pc: { label: 'Comando del DCT', on: 'none' },
    rientro: { label: 'Rientro per sciopero', on: 'none' },
    sciopero: { label: 'Sciopero', on: 'day' },
  };
  const tag = n => '#A' + String(n).padStart(2, '0');
  const G1 = 8.75 * 3600, G2a = 15 * 3600, G2b = 18 * 3600;             // the guaranteed service of a strike day
  const AUTO = 180, DAYS = 19 * 3600;                 // the DCT answers by itself after 3 minutes; ~19 hours of service a day
  const ANSWERS = { rearm: 'Riarma', agent: "Manda l'agente", tech: 'Tecnico a bordo', rescue: 'Manda il soccorso', ack: 'Ricevuto', vista: 'Marcia a vista',
                    team: 'Manda la squadra', power: 'Ridai tensione', red: 'Pulsante rosso e togli tensione', clear: 'Ridai tensione e via libera',
                    cut: 'Togli tensione', rback: 'Soccorso con il treno dietro (spinta 15 km/h)', rfront: 'Soccorso con il treno davanti (traino 30 km/h)',
                    badoni: 'Badoni da ROD (serve l\'interruzione)', evac: 'Evacuazione dei passeggeri', reopen: 'Riapri la tratta',
                    reopenSt: 'Riapri la stazione', gaps: 'Lascia l\'orario (corse scoperte)', freq: 'Frequenza più bassa (orario ibrido)', limit: 'Servizio limitato (chiudi tu una tratta)', home: 'Scarica e rientra a ROD', homeEnd: 'A fine corsa rientra a ROD', hold: 'Ferma i treni', fire: 'Chiudi la stazione, chiama i vigili del fuoco', police: 'Chiama polizia e soccorsi' };

  function create(c) {
    // c: { S, G, DT, emBrake(a) m/s2, loadAt(t), catalog: [{ id, perDay }] }
    const { S, G, DT } = c, SD = 0;                    // San Donato: station 0
    const F = () => S.faults || (S.faults = { on: false, rng: 20261101, seq: 0, list: [], feed: [], roll: 0 });
    // seeded random numbers (mulberry32), the seed in the state
    function rnd() { const f = F(); let t = (f.rng = (f.rng + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    const between = (a, b) => Math.round(a + (b - a) * rnd());
    const name = st => st != null && G ? G.names[st].replace(/\s+M\d$/, '').toLowerCase().replace(/\b\w/g, x => x.toUpperCase()).replace(/\b(Fs|Fn)\b/g, x => x.toUpperCase()) : '';
    // what is said on the radio: who (dr: the driver of train k, pc, ag: the agent of station st, man: line maintenance)
    function say(f, who, text) { const Q = F().feed; Q.push({ t: S.t, id: f.id, k: f.k, r: f.rk, who, st: f.st, text }); if (Q.length > 200) Q.splice(0, Q.length - 200); }
    function call(f, text, opts, auto) { f.call = { t: S.t, text, opts, auto: auto || AUTO }; say(f, f.callWho || 'dr', text); }
    function end(f, text, who) { if (text) say(f, who || 'dr', text); f.done = S.t; f.call = null; }
    const live = () => F().list.filter(f => !f.done);
    const of = a => live().filter(f => f.k === a.k);

    // a new failure on train k (or the first train in service when k is null: tests)
    function add(kind, k, extra) {
      if (!KINDS[kind]) return null;
      if (KINDS[kind].on && KINDS[kind].on !== 'none') return addLine(kind, extra && extra.target, extra);
      if (KINDS[kind].as) { extra = Object.assign({ force: kind, tries: 2 }, extra || {}); kind = KINDS[kind].as; }     // (admin: how it must end)
      const a = S.agents[k]; if (!a || a.hidden || a.mode === 'static') return null;
      if (of(a).some(f => f.kind === kind)) return null;
      const f = Object.assign({ id: ++F().seq, kind, k, t0: S.t, ph: 'armed', tries: 0, st: null }, extra || {});
      F().list.push(f); if (F().list.length > 300) F().list.splice(0, 100);
      begin(f, a); return f.id;
    }
    function begin(f, a) {
      if (f.kind === 'ato') { f.ph = 'manual'; call(f, `DCT, treno {T}: guasto all'ATO, proseguo in guida manuale.`, ['ack']); }
      else if (f.kind === 'atp') { f.ph = 'limited'; call(f, `DCT, treno {T}: guasto all'ATP, proseguo in marcia limitata a 30 km/h.`, ['homeEnd']); }
      else if (f.kind === 'riarmo') { f.ph = 'run'; f.next = S.t + between(120, 420); }
      else if (f.kind === 'secondario') { f.ph = 'run'; const what = ['la climatizzazione di una cassa non funziona', 'un display interno per i passeggeri è spento', 'una luce di cabina non si accende', 'il pannello diagnostico segnala un\'anomalia su un carrello', 'un annuncio automatico non parte'];
        call(f, `DCT, treno {T}: ${what[Math.floor(rnd() * what.length)]}. Il treno marcia, chiedo un tecnico a bordo.`, ['tech']); }
      else if (f.kind === 'trazione') f.ph = 'stopping';              // it stops where it is (at a station: when leaving)
      else if (f.kind === 'malore_treno' && a.stopAt != null) atStation(f, a);
    }
    // ---------- the line ----------
    const L = c.line || {}, RT = () => S.rt;
    const lineOf = () => live().filter(f => f.k == null);
    function targets(kind) {
      const on = KINDS[kind] && KINDS[kind].on;
      if (on === 'signal') return (L.sigs ? L.sigs() : []).map(n => ({ v: n, label: 'Semaforo ' + tag(n) }));
      if (on === 'switch') return (L.switches ? L.switches() : []).map(nd => ({ v: nd, label: 'Scambio ' + nd }));
      if (on === 'day') return [5, 10, 15, 20, 25, 30, 35, 40].map(p => ({ v: p, label: 'Adesione ' + p + '%' }));
      if (on === 'station') return G.names.map((x, i) => ({ v: i, label: name(i) }));
      if (on === 'stretch') { const out = []; for (let i = 0; i < (L.last ? L.last() : 0); i++) out.push({ v: i, label: name(i) + ' – ' + name(i + 1) }); return out; }
      return [];
    }
    function addLine(kind, target, extra) {
      const T = targets(kind); if (!T.length) return null;
      if (target == null && kind !== 'sciopero') target = T[Math.floor(rnd() * T.length)].v;
      if ((!T.some(x => x.v === target) && kind !== 'sciopero') || lineOf().some(f => f.kind === kind && f.target === target)) return null;
      if (kind === 'tensione' && lineOf().some(f => f.kind === 'tensione')) return null;          // one stretch at a time
      if (kind === 'sciopero' && lineOf().some(x => x.kind === 'sciopero')) return null;
      if (kind === 'prefettura' && (lineOf().some(x => x.kind === 'prefettura') || F().prefDone)) return null;     // once a day
      if (kind === 'prefettura' && target == null) target = G.names.findIndex(n => rnd() < 0.5 ? /DUOMO/.test(n) : /CENTRALE/.test(n));
      if (kind === 'sciopero' && target == null) target = 5 + 5 * Math.floor(rnd() * 8);
      const X = target, around = [Math.max(0, X - 1), Math.min(L.last(), X + 1)];
      const f = Object.assign({ id: ++F().seq, kind, k: null, target, t0: S.t, ph: 'on' }, extra || {}); f.target = target;
      const st = RT();
      if (kind === 'segnale') { st.sigFail = st.sigFail || {}; st.sigFail[target] = true; f.what = 'Semaforo ' + tag(target); f.until = S.t + between(1800, 5400);
        say(f, 'sys', `Semaforo ${tag(target)} guasto: resta rosso.`); }
      else if (kind === 'sezione') { st.ghost = st.ghost || {}; f.edges = L.sigEdges(target); f.edges.forEach(ei => { st.ghost[ei] = f.id; }); f.what = 'Sezione dopo il ' + tag(target); f.until = S.t + between(1200, 3600);
        say(f, 'sys', `La sezione dopo il ${tag(target)} risulta occupata, ma non c'è nessun treno.`); }
      else if (kind === 'scambio') { st.swFail = st.swFail || {}; st.swFail[target] = true; f.what = 'Scambio ' + target; f.ph = 'failed';
        f.callWho = 'sys'; call(f, `Scambio ${target} guasto: non va in posizione, gli itinerari che lo usano non si formano.`, ['team']); }
      else if (kind === 'tensione') { f.zones = [L.zone('power', target, target + 1)]; f.what = name(target) + ' – ' + name(target + 1); f.until = S.t + between(300, 3600); f.ph = 'off';
        f.callWho = 'en'; call(f, `DCT, qui Energia: mancanza di tensione tra ${f.what}. I treni nella tratta sono fermi.`, ['ack']); }
      // public order (Giovanni): the Prefettura orders a station closed, nearly always Duomo or Centrale, so that the people
      // leave through two stations instead of one. Announced at the start of the shift; once a day; 2 to 6 hours; the
      // trains go through without stopping
      else if (kind === 'prefettura') {
        F().prefDone = true; f.st = X; f.what = name(X); f.ph = 'announced'; f.callWho = 'pref';
        f.from = f.random ? Math.round((10 + 9 * rnd()) * 3600 / 300) * 300 : Math.ceil((S.t + 900) / 300) * 300; f.until = f.from + Math.round((2 + 4 * rnd()) * 3600 / 900) * 900;
        const hm = x => Math.floor(x / 3600) % 24 + ':' + String(Math.floor(x / 60) % 60).padStart(2, '0');
        call(f, `DCT, qui la Prefettura: per motivi di ordine pubblico oggi la stazione di ${name(X)} resta chiusa dalle ${hm(f.from)} alle ${hm(f.until)}. I treni non fermano.`, ['ack']);
      }
      // the strike (D5): a percentage of the drivers; guaranteed service from the start to 8:45 and 15:00-18:00
      else if (kind === 'sciopero') {
        f.pct = target; f.what = 'adesione ' + f.pct + '%'; f.ph = 'day'; f.callWho = 'uff';
        const all = S.agents.filter(a => !(a.mode === 'static' && a.hidden)), n = Math.round(all.length * f.pct / 100), pool = all.slice();
        f.strikers = []; while (f.strikers.length < n && pool.length) { const a = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; a.strike = true; f.strikers.push(a.k); }
        f.marks = { out1: S.t >= G1 + 60, back: S.t >= G2a + 60, out2: S.t >= G2b + 60 };
        call(f, `DCT, qui Ufficio Movimento: oggi sciopero, adesione del ${f.pct}% (${n} treni su ${all.length}). Fasce di garanzia: dall'inizio del servizio alle 8:45 e dalle 15:00 alle 18:00. Fuori dalle fasce come fai il servizio?`, ['freq', 'gaps', 'limit']);
      }
      // people and emergencies (D3)
      else if (kind === 'persona') { f.st = X; f.what = name(X); f.ph = 'alarm'; f.around = around; f.callWho = 'ag'; f.zones = [L.zone('stop', X, X)];
        call(f, `DCT, qui ${name(X)}: c'è una persona sui binari! Ho chiuso i segnali di partenza e di protezione della stazione.`, ['red'], 30); }
      else if (kind === 'oggetto') { f.st = X; f.what = name(X); f.ph = 'told'; f.callWho = 'ag';
        call(f, `DCT, qui ${name(X)}: un passeggero dice che è caduto qualcosa sul binario.`, ['agent']); }
      else if (kind === 'malore_stazione') { f.st = X; f.what = name(X); f.ph = 'help'; f.callWho = 'ag'; f.until = S.t + between(600, 1800); f.holdAt = S.t + between(120, 400);
        call(f, `DCT, qui ${name(X)}: una persona si sente male in banchina, ho chiamato i soccorsi.`, ['ack']); }
      else if (kind === 'tunnel') { f.what = name(X) + ' – ' + name(X + 1); f.a = X; f.ph = 'alarm'; f.callWho = 'drx';
        call(f, `DCT, qui un macchinista: c'è una persona nel tunnel tra ${f.what}!`, ['red'], 30); }
      else if (kind === 'investimento') { f.st = X; f.what = name(X); f.ph = 'alarm'; f.around = around; f.callWho = 'ag'; f.zones = [L.zone('stop', X, X)];
        { const t0 = S.agents.find(a => !a.hidden && a.stopAt === X) || S.agents.filter(a => !a.hidden && a.status === 'service' && a.legs[0] && a.legs[0].stops && a.legs[0].stops[0] && a.legs[0].stops[0].st === X)[0]; f.tk = t0 ? t0.k : null; if (t0) t0.broken = true; }
        call(f, `DCT, qui ${name(X)}: investimento! Un treno ha investito una persona in banchina. Ho chiuso i segnali della stazione.`, ['red'], 30); }
      else if (kind === 'incendio') { f.st = X; f.what = name(X); f.ph = 'alarm'; f.around = around; f.callWho = 'ag'; f.smoke = rnd() < 0.4 ? S.t + between(60, 300) : null;
        f.until = S.t + (rnd() < 0.15 ? between(5400, 18000) : between(1800, 5400));
        call(f, `DCT, qui ${name(X)}: incendio in stazione, fumo e allarme antincendio!`, ['fire'], 30); }
      F().list.push(f); return f.id;
    }
    // the position of switch nd a waiting train needs (the squad puts it there), else the first one
    function posFor(nd) {
      for (const w of Object.values(RT().wants || {})) { const i = w.nodes.indexOf(nd); if (i >= 0 && i + 1 < w.pieces.length) return Math.min(w.pieces[i][0], w.pieces[i + 1][0]) + '-' + Math.max(w.pieces[i][0], w.pieces[i + 1][0]); }
      return null;
    }
    function tickLine(f) {
      const st = RT();
      if (f.kind === 'segnale' && S.t >= f.until) { delete st.sigFail[f.target]; end(f, `Semaforo ${tag(f.target)} riparato.`, 'man'); }
      else if (f.kind === 'sezione' && S.t >= f.until) { for (const ei of f.edges) if (st.ghost[ei] === f.id) delete st.ghost[ei]; end(f, `Sezione dopo il ${tag(f.target)} riparata: torna libera.`, 'man'); }
      else if (f.kind === 'scambio') {
        if (f.ph === 'team' && S.t >= f.until) {
          const P = L.positions(f.target), want = posFor(f.target), order = P.slice().sort((x, y) => (y.pos === want) - (x.pos === want));
          f.ph = 'pos'; f.pos = order.map(p => p.pos); f.callWho = 'man';
          f.labels = Object.fromEntries(order.map((p, i) => ['p' + i, 'Posizione ' + p.ids.slice(0, 2).join(', ')]));
          call(f, `DCT, qui la squadra: siamo allo scambio ${f.target}. In che posizione lo mettiamo?`, order.map((p, i) => 'p' + i));
        }
        if (f.ph === 'hand' && S.t >= f.until) { delete st.swFail[f.target]; end(f, `Scambio ${f.target} riparato: torna comandato dall'apparato.`, 'man'); }
      }
      else if (f.kind === 'persona' && f.ph === 'recover' && S.t >= f.until) { f.ph = 'done'; call(f, f.gone ? `DCT, qui ${name(f.st)}: quando sono arrivato la persona non c'era più, è risalita. Puoi ridare tensione e via libera.` : `DCT, qui ${name(f.st)}: la persona è stata recuperata, i binari sono liberi. Puoi ridare tensione e via libera.`, ['clear']); }
      else if (f.kind === 'oggetto' && f.ph === 'verify' && S.t >= f.until) {
        if (!f.found) end(f, `Qui ${name(f.st)}: ho controllato, sul binario non c'è niente.`, 'ag');
        else { f.ph = 'found'; call(f, `DCT, qui ${name(f.st)}: c'è davvero un oggetto sul binario. Serve togliere tensione in stazione per recuperarlo.`, ['cut']); }
      }
      else if (f.kind === 'oggetto' && f.ph === 'recover' && S.t >= f.until) { f.ph = 'done'; call(f, `DCT, qui ${name(f.st)}: oggetto recuperato, puoi ridare tensione.`, ['clear']); }
      else if (f.kind === 'malore_stazione') {
        if (f.holdAt && S.t >= f.holdAt && f.ph === 'help' && !f.call) { f.holdAt = null; f.ph = 'ask'; call(f, `DCT, qui ${name(f.st)}: fermate un momento i treni in stazione, i soccorritori lavorano in banchina.`, ['hold']); }
        if (f.ph === 'holding' && S.t >= f.holdUntil) { unzone(f, 'stop'); f.ph = 'help'; say(f, 'ag', `Qui ${name(f.st)}: i treni possono ripartire, grazie.`); }
        if (f.ph === 'help' && !f.holdAt && S.t >= f.until) { unLine(f); end(f, `Qui ${name(f.st)}: la persona è stata soccorsa, emergenza rientrata.`, 'ag'); }
      }
      else if (f.kind === 'tunnel' && f.ph === 'recover' && S.t >= f.until) { f.ph = 'done'; f.callWho = 'pol'; call(f, `DCT, qui la polizia: la persona nel tunnel tra ${f.what} è stata allontanata.`, ['clear']); }
      else if (f.kind === 'prefettura') {
        if (f.ph === 'announced' && S.t >= f.from - 300 && !f.warned) { f.warned = true; say(f, 'ag', `Qui ${name(f.st)}: tra 5 minuti chiudo gli accessi come da disposizione della Prefettura, faccio gli annunci.`); }
        if (f.ph === 'announced' && S.t >= f.from) { f.ph = 'closed'; L.station(f.st, true); say(f, 'ag', `Qui ${name(f.st)}: accessi chiusi, la stazione è vuota. I treni possono transitare.`);
          const near = [f.st - 1, f.st + 1].filter(i => i >= 0 && i <= L.last()).map(name).join(' e ');
          say(f, 'pc', `Annuncio a ${near}: la stazione di ${name(f.st)} è chiusa per disposizione della Prefettura, i treni non fermano.`); }
        if (f.ph === 'closed' && S.t >= f.until && !f.call) { f.ph = 'end'; call(f, `DCT, qui la Prefettura: la disposizione è revocata, potete riaprire ${name(f.st)}.`, ['reopenSt']); }
      }
      else if (f.kind === 'sciopero') {
        // end of a guaranteed band: the drivers on strike ask to go back to the depot; at 15:00 they are back
        const out = when => { for (const k of f.strikers) { const a = S.agents[k]; if (!a || a.hidden || a.mode === 'static' || live().some(x => x.k === k && x.kind === 'rientro')) continue;
          if (L.keepIn && L.keepIn(k)) continue;                                   // still in the depot: it stays there
          const g = { id: ++F().seq, kind: 'rientro', k, t0: S.t, ph: 'call', st: null }; F().list.push(g);
          call(g, `DCT, treno {T}: è finita la fascia di garanzia, sciopero. Chiedo di rientrare in deposito a fine corsa.`, ['homeEnd']); }
          if (f.choice === 'freq' && L.hybrid) L.hybrid(); say(f, 'sys', `Fine della fascia di garanzia (${when}): i treni in sciopero rientrano.`); };
        if (!f.marks.out1 && S.t >= G1) { f.marks.out1 = true; out('8:45'); }
        // 15:00: back in service, one at a time out of the depot (every 4 minutes, when the way out is free)
        if (!f.marks.back && S.t >= G2a) { f.marks.back = true; f.wakeQ = f.strikers.slice(); f.nextWake = S.t; say(f, 'sys', 'Inizio della fascia di garanzia (15:00): i treni in sciopero tornano in servizio.'); }
        if (f.wakeQ && f.wakeQ.length && S.t >= f.nextWake && S.t < G2b) { const k = f.wakeQ[0], a = S.agents[k];
          if (!a || !(a.hidden || a.mode === 'static')) f.wakeQ.shift(); else if (L.wake(k)) { f.wakeQ.shift(); f.nextWake = S.t + 240; } else f.nextWake = S.t + 30; }
        if (!f.marks.out2 && S.t >= G2b) { f.marks.out2 = true; out('18:00'); }
        if (S.t >= 26 * 3600) end(f, 'Fine della giornata di sciopero.', 'sys');
      }
      else if (f.kind === 'investimento' && f.ph === 'recover' && f.closeAsk === undefined && L.closures) {
        // the DCT must close a stretch around the station (he chooses which one)
        const cl = L.closures(f.st); f.closeAsk = cl.map(c => c.i);
        if (cl.length) { f.labels = Object.assign({}, f.labels || {}, Object.fromEntries(cl.map((c, i) => ['cl' + i, 'Chiudi ' + c.label]))); call(f, `${name(f.st)} resterà chiusa per ore: chiudi la tratta.`, cl.map((c, i) => 'cl' + i)); }
      }
      else if (f.kind === 'investimento' && f.ph === 'recover' && S.t >= f.until && !f.call) { f.ph = 'done'; call(f, `DCT, qui ${name(f.st)}: la polizia ha finito i rilievi. Si può ridare tensione; il treno va portato in deposito.`, ['clear']); }
      else if (f.kind === 'incendio') {
        if (f.smoke && S.t >= f.smoke && f.ph === 'fire') { f.smoke = null; call(f, `DCT, qui ${name(f.st)}: c'è fumo in galleria!`, ['red'], 30); }
        if (f.ph === 'fire' && !f.smoke && !f.call && S.t >= f.until) { f.ph = 'done'; f.callWho = 'vvf'; call(f, `DCT, qui i vigili del fuoco: incendio a ${name(f.st)} spento e verificato. La stazione può riaprire.`, ['clear']); }
      }
      else if (f.kind === 'tensione' && f.ph === 'off' && !f.evacAsk && S.t - f.t0 >= 1200 && L.stuckIn && L.stuckIn().length) {
        f.evacAsk = true; call(f, `DCT, qui i macchinisti tra ${f.what}: siamo fermi in galleria da 20 minuti con i passeggeri. Evacuiamo?`, ['evac', 'ack']);
      }
      else if (f.kind === 'tensione' && f.ph === 'off' && S.t >= f.until && !f.call && !(f.evacUntil && S.t < f.evacUntil)) { f.ph = 'ready'; call(f, `DCT, qui Energia: guasto riparato tra ${f.what}, puoi ridare tensione.`, ['power']); }
    }
    // trains stopped at a red by a failure of the line: they call the DCT and ask to go by in marcia a vista
    function lineCalls() {
      if (!lineOf().some(f => f.kind !== 'tensione')) return;
      for (const a of S.agents) {
        if (a.hidden || a.v > 0 || !a.red || S.t - a.red.since < 30) continue;          // (the call: 30 s after stopping)
        const w = a.red.now || a.red.why, r = w && w.route;
        if (!w || w.sig == null || !r || !(r.sigFail != null || r.ghost != null || r.swHand != null)) continue;
        if (live().some(f => f.kind === 'vista' && f.k === a.k)) continue;
        const f = { id: ++F().seq, kind: 'vista', k: a.k, t0: S.t, ph: 'call', n: w.sig, st: null };
        F().list.push(f);
        call(f, r.sigFail != null ? `DCT, treno {T}: sono fermo al ${tag(w.sig)}, il semaforo non si apre. Chiedo di superarlo in marcia a vista.`
          : r.ghost != null ? `DCT, treno {T}: sono fermo al ${tag(w.sig)}, la sezione dopo risulta occupata ma davanti non vedo treni. Chiedo la marcia a vista.`
          : `DCT, treno {T}: sono fermo al ${tag(w.sig)}, lo scambio ${r.swHand} è manovrato a mano. Chiedo l'autorizzazione a passare.`, ['vista']);
      }
    }
    function giveVista(k, n) { const st = RT(); st.avista = st.avista || {}; st.avista[k] = n; }
    // the train has stopped at a station (or was there already)
    function atStation(f, a) {
      f.st = a.stopAt;
      if (f.kind === 'porta') { f.ph = 'dwell'; f.extra = between(60, 180); say(f, 'dr', `DCT, treno {T}: a ${name(f.st)} una porta non si chiude, la escludo e la chiudo a mano.`); }
      else if (f.kind === 'porte_persone') { f.ph = 'dwell'; f.extra = between(30, 120); }
      else if (f.kind === 'allarme') { f.ph = 'held'; call(f, `DCT, treno {T}: allarme passeggero, mi sono fermato a ${name(f.st)}. Chiedo l'agente di stazione.`, ['agent']); }
      else if (f.kind === 'malore_treno') { f.ph = 'held'; f.until = S.t + between(1200, 3600); f.callWho = 'ag';
        call(f, `DCT, qui ${name(f.st)}: un passeggero si sente male sul treno {T}, ho chiamato i soccorsi. Il treno resta fermo in banchina.`, ['ack']); }
    }

    // the DCT answers (or the admin): null when done, else why not
    function answer(id, what) {
      const f = live().find(x => x.id === id); if (!f) return { gone: true };
      if (what === 'fix') { unLine(f); if (f.st != null && (f.kind === 'investimento' || f.kind === 'incendio')) L.station(f.st, false);
        end(f, f.kind === 'pc' ? `DCT: tolto ${f.zone === 'red' ? 'il pulsante rosso' : f.zone === 'power' ? 'il taglio di tensione' : 'il fermo dei treni'} tra ${f.what}.` : 'Guasto risolto (admin).', f.kind === 'pc' ? 'pc' : 'sys'); return null; }
      if (what === 'tech') {
        if ((f.kind !== 'riarmo' && f.kind !== 'secondario') || f.tech) return { no: true };
        f.tech = 'wait'; say(f, 'pc', f.kind === 'riarmo' ? 'Manutenzione di linea del deposito di Rogoredo, mandate un tecnico sul treno {T}: chiede continuamente il riarmo.' : 'Manutenzione di linea del deposito di Rogoredo, mandate un tecnico sul treno {T}: ha un problema secondario.');
        say(f, 'man', 'Ricevuto DCT, il tecnico sale sul treno {T} a San Donato.');
        if (f.call && f.call.opts.includes('tech')) { f.call.opts = f.call.opts.filter(x => x !== 'tech'); if (!f.call.opts.length) f.call = null; }
        return null;
      }
      if (!f.call || !f.call.opts.includes(what)) return { no: true };
      f.call = null;
      if (what === 'vista') { giveVista(f.k, f.n); say(f, 'pc', `Treno {T}, autorizzato a superare il ${tag(f.n)} in marcia a vista fino al semaforo successivo.`); say(f, 'dr', `Ricevuto DCT, supero il ${tag(f.n)} in marcia a vista.`); f.ph = 'go'; return null; }
      if (what === 'team') { say(f, 'pc', `Squadra di manutenzione, andate allo scambio ${f.target}: non va in posizione.`); say(f, 'man', 'Ricevuto DCT, arriviamo.'); f.ph = 'team'; f.until = S.t + between(600, 1800); return null; }
      if (/^p\d$/.test(what) && f.kind === 'scambio') {
        const pos = f.pos[+what.slice(1)], st = RT(); st.swFail[f.target] = pos; st.sw[f.target] = pos;
        say(f, 'pc', `Mettetelo in ${f.labels[what].toLowerCase()} e bloccatelo.`); say(f, 'man', `Scambio ${f.target} manovrato a mano e bloccato. I treni passano solo con la tua autorizzazione.`);
        f.ph = 'hand'; f.until = S.t + between(1800, 5400); return null;
      }
      if (what === 'power') { unLine(f); end(f, `DCT: ridata tensione tra ${f.what}. I treni ripartono.`, 'pc'); return null; }
      if (what === 'red') {                    // pulsante rosso and no power: around the station, or the stretch of the tunnel
        const [a, b] = f.kind === 'tunnel' ? [f.a, f.a + 1] : f.around; f.zones = (f.zones || []).concat([L.zone('red', a, b), L.zone('power', a, b)]);
        say(f, 'pc', `Pulsante rosso tra ${name(a)} e ${name(b)}: tutti i semafori a rosso, tolgo tensione. Tutti i treni della tratta fermi!`);
        if (f.kind === 'persona') { f.ph = 'recover'; f.gone = rnd() < 0.1; f.until = S.t + (f.gone ? between(180, 300) : between(600, 1800)); say(f, 'ag', `Ricevuto DCT, scendo a recuperare la persona.`); }
        if (f.kind === 'tunnel') { f.ph = 'recover'; f.until = S.t + between(900, 3600); say(f, 'pc', `Chiamo la polizia. Stazioni di ${name(a)} e ${name(b)}: c'è una persona nel tunnel, la tratta è chiusa.`); }
        if (f.kind === 'investimento') { f.ph = 'recover'; f.until = S.t + between(10800, 18000); L.station(f.st, true);
          say(f, 'pc', `Chiamo polizia e soccorsi. ${name(f.st)} chiusa: i treni non fermano. Valuta la chiusura della tratta.`); }
        if (f.kind === 'incendio') say(f, 'pc', `Fumo in galleria a ${name(f.st)}: treni fermi, tensione tolta.`);
        return null;
      }
      if (what === 'fire') { L.station(f.st, true); f.ph = 'fire'; say(f, 'pc', `Chiudo ${name(f.st)}: i treni non fermano. Chiamo i vigili del fuoco; agente, fai uscire i passeggeri.`); say(f, 'ag', 'Ricevuto DCT, faccio uscire tutti.'); return null; }
      if (what === 'cut') { f.zones = (f.zones || []).concat([L.zone('power', f.st, f.st)]); f.ph = 'recover'; f.until = S.t + between(300, 900); say(f, 'pc', `Tolgo tensione in stazione a ${name(f.st)}: recuperate l'oggetto.`); return null; }
      if (what === 'hold') { f.zones = (f.zones || []).concat([L.zone('stop', f.st, f.st)]); f.ph = 'holding'; f.holdUntil = S.t + between(120, 300); say(f, 'pc', `Ricevuto ${name(f.st)}, fermo i treni in stazione.`); return null; }
      if (/^cl\d$/.test(what)) { const i = f.closeAsk[+what.slice(2)]; if (L.close(i)) { f.closed = true; say(f, 'pc', `${f.labels[what]}: i treni girano alle stazioni di fine tratta.`); } return null; }
      if (what === 'reopenSt') { L.station(f.st, false); end(f, `DCT: ${name(f.st)} riaperta.`, 'pc'); return null; }
      if (what === 'reopen') { L.reopen(); end(f, 'DCT: tratta riaperta.', 'pc'); return null; }
      if (what === 'evac') { f.evacUntil = S.t + between(1200, 2700); say(f, 'pc', `Evacuate: i macchinisti accompagnano i passeggeri a piedi alla stazione più vicina. La tensione resta tolta finché non sono tutti in stazione.`); return null; }
      if (f.kind === 'sciopero' && ['freq', 'gaps', 'limit'].includes(what)) { f.choice = what;
        say(f, 'pc', what === 'freq' ? 'Fuori dalle fasce i treni rimasti fanno le corse scoperte una dopo l\'altra: frequenza più bassa.' : what === 'gaps' ? 'Fuori dalle fasce resta l\'orario: le corse dei treni in sciopero restano scoperte.' : 'Fuori dalle fasce servizio limitato: chiudo io una tratta dal pannello.'); return null; }
      if (what === 'clear') {
        if (f.kind === 'investimento' && f.tk != null && L.home) L.home(f.tk, false);         // the train goes to the depot
        unLine(f);
        if (f.kind === 'investimento' && f.closed) { L.station(f.st, false); f.ph = 'reopen'; call(f, `${name(f.st)} riaperta, tensione ridata. Riapri la tratta chiusa.`, ['reopen']); return null; }
        if (f.kind === 'tunnel') f.zones = [L.zone('vista', f.a, f.a + 1)];          // the first train on each track: marcia a vista
        if (f.kind === 'investimento' || f.kind === 'incendio') L.station(f.st, false);
        end(f, f.kind === 'tunnel' ? `DCT: ridata tensione tra ${f.what}. I primi treni passano in marcia a vista.` : f.kind === 'incendio' ? `DCT: ${name(f.st)} riaperta.` : `DCT: ridata tensione e via libera${f.kind === 'investimento' ? `, ${name(f.st)} riaperta` : ''}.`, 'pc');
        if (f.kind === 'tunnel') f.zones = [];                                          // (it goes by itself)
        return null;
      }
      if (what === 'rearm') { say(f, 'pc', 'Treno {T}, riarma il treno.'); say(f, 'dr', 'Ricevuto DCT, riarmo.'); f.ph = 'rearm'; f.until = S.t + between(90, 150); }
      else if (what === 'agent') {
        if (f.kind === 'allarme') { say(f, 'pc', `${name(f.st)}, mandate l'agente sul treno {T}: allarme passeggero.`); say(f, 'ag', `Ricevuto DCT, salgo sul treno {T}.`); f.ph = 'verify'; f.until = S.t + between(60, 300); }
        else if (f.kind === 'porte_persone') { say(f, 'pc', `${name(f.st)}, mandate l'agente in banchina al treno {T}: non chiude le porte.`); say(f, 'ag', 'Ricevuto DCT, libero le porte.'); f.agent = S.t; }
        else if (f.kind === 'oggetto') { say(f, 'pc', `${name(f.st)}, controllate il binario.`); say(f, 'ag', 'Ricevuto DCT, vado a vedere.'); f.ph = 'verify'; f.until = S.t + between(120, 300); f.found = rnd() < 1 / 3; }
      } else if (what === 'rback' || what === 'rfront') {
        const rk = what === 'rback' ? L.rescue(f.k) : L.tow(f.k); if (rk == null) return { no: true };
        f.rk = rk; f.ph = 'coming';
        say(f, 'pc', what === 'rback' ? 'Treno {R}, fai scendere i passeggeri alla prossima stazione e vai a soccorrere il treno {T} davanti a te, in marcia a vista: lo spingi a 15 km/h.'
          : 'Treno {R}, fai scendere i passeggeri alla prossima stazione, cambia banco e torna indietro in marcia a vista fino al treno {T}: lo traini con l\'accoppiamento pneumatico, 30 km/h.');
        say(f, 'dr', 'Ricevuto DCT, attendo il soccorso.');
      } else if (what === 'badoni') {
        const a = S.agents[f.k], leg = a && a.legs[0] && !a.legs[0].kind ? a.legs[0] : null, dir = (leg && leg.dir) || (a && a.arr) || 'S';
        const far = a && a.at != null ? (dir === 'N' ? Math.min(L.last(), a.at + 1) : Math.max(1, a.at)) : 1, km = far * 0.9;
        // out of ROD 10 min, there at 25 km/h, coupling 5 min, back at 15 km/h
        f.zones = (f.zones || []).concat([L.zone('power', 0, far)]); f.ph = 'badoni'; f.until = S.t + 600 + Math.round(km / 25 * 3600) + 300 + Math.round(km / 15 * 3600);
        f.evacUntil = S.t + between(1200, 2700);
        say(f, 'pc', `Interruzione della linea tra San Donato e ${name(far)}: tensione tolta. Esce il Badoni da Rogoredo. Treno {T}, evacuate i passeggeri alla stazione più vicina.`);
        say(f, 'dr', 'Ricevuto DCT, accompagno i passeggeri a piedi.');
      } else if (what === 'rescue') {
        const rk = L.rescue ? L.rescue(f.k) : null;
        if (rk != null) { f.rk = rk; f.ph = 'coming'; say(f, 'pc', 'Treno {R}, fai scendere i passeggeri alla prossima stazione e vai a soccorrere il treno {T} davanti a te, in marcia a vista.'); say(f, 'dr', 'Ricevuto DCT, attendo il soccorso.'); }
        else { f.ph = 'rescue'; f.until = S.t + between(1800, 3600); say(f, 'pc', 'Treno {T}: nessun treno può arrivare da dietro. Serve il Badoni da ROD, con l\'interruzione della linea (non ancora simulato: il treno riparte dopo l\'attesa).'); }
      }
      else if (what === 'home' || what === 'homeEnd') {
        if (!L.home) return { no: true };
        if (!L.home(f.k, what === 'homeEnd', f.turnX)) { if (what === 'homeEnd') { f.ph = 'homeWait'; say(f, 'pc', 'Treno {T}, a fine della prossima corsa rientri in deposito.'); say(f, 'dr', 'Ricevuto DCT. Passo.'); return null; } return { no: true }; }
        f.ph = 'homing'; say(f, 'pc', what === 'homeEnd' ? 'Treno {T}, finisci la corsa, fai scendere i passeggeri al capolinea e rientra vuoto al deposito di Rogoredo.' : 'Treno {T}, fai scendere i passeggeri alla prossima stazione e rientra vuoto al deposito di Rogoredo.');
        say(f, 'dr', 'Ricevuto DCT. Passo.');
      }
      else if (what === 'ack') {
        say(f, 'pc', f.kind === 'ato' ? 'Ricevuto treno {T}, prosegui in manuale.' : f.kind === 'malore_treno' ? `Ricevuto ${name(f.st)}, il treno {T} resta fermo: tenetemi informato.`
          : f.kind === 'tensione' ? `Ricevuto Energia. Fermo i treni prima della tratta ${f.what}.`
          : f.kind === 'malore_stazione' ? `Ricevuto ${name(f.st)}. Rallento i treni in entrata.`
          : f.kind === 'prefettura' ? `Ricevuto. Avviso la stazione di ${name(f.st)} e le stazioni vicine.` : 'Ricevuto.');
        if (f.kind === 'malore_stazione') f.zones = (f.zones || []).concat([L.zone('slow', f.st, f.st, { kmh: 15 })]);
      }
      return null;
    }

    function unLine(f) {
      const st = RT();
      if (f.kind === 'segnale' && st.sigFail) delete st.sigFail[f.target];
      if (f.kind === 'sezione' && st.ghost) for (const ei of f.edges || []) if (st.ghost[ei] === f.id) delete st.ghost[ei];
      if (f.kind === 'scambio' && st.swFail) delete st.swFail[f.target];
      for (const id of f.zones || []) L.unzone(id); f.zones = [];
    }
    function unzone(f, kind) { for (const id of f.zones || []) { const z = (S.zones || []).find(x => x.id === id); if (z && z.kind === kind) L.unzone(id); }
      f.zones = (f.zones || []).filter(id => (S.zones || []).some(x => x.id === id)); }
    // every step: the phases that end by time, the trains that reach a station, the calls nobody answered
    function tick() {
      const fs = F();
      lineCalls();
      for (const f of live()) {
        if (f.call && S.t - f.call.t >= (f.call.auto || AUTO) && f.k == null) { say(f, 'sys', '(nessuna risposta: risponde il DCT automatico)'); answer(f.id, f.call.opts[0]); }
        if (f.kind === 'pc') continue;                       // the DCT's own zones: until it takes them away (answer 'fix')
        if (f.k == null) { tickLine(f); continue; }
        const a = S.agents[f.k];
        if (!a || a.hidden || a.status === 'parked') {                           // out of service: the failure goes with it
          end(f, ['homing', 'towed'].includes(f.ph) ? (a && a.hidden ? 'Treno {T} rientrato al deposito di Rogoredo.' : 'Treno {T} ricoverato in un tronchetto di Comasina.') : null, 'sys'); continue; }
        if (f.call && S.t - f.call.t >= (f.call.auto || AUTO)) {
          // (the automatic DCT also calls the line maintenance for a train that keeps asking to be re-armed)
          say(f, 'sys', '(nessuna risposta: risponde il DCT automatico)');
          if (f.call.opts.includes('tech')) answer(f.id, 'tech');
          if (f.call) answer(f.id, f.call.opts[0]);
        }
        if (f.kind === 'vista') {             // gone by (or the failure is over and the signal opened): done
          const w = a.red && (a.red.now || a.red.why);
          if (f.ph === 'go' ? a.v > 0.5 : !(a.v === 0 && w && w.sig === f.n)) end(f);
          continue;
        }
        if ((f.kind === 'porta' || f.kind === 'porte_persone' || f.kind === 'allarme' || f.kind === 'malore_treno') && f.ph === 'armed' && a.stopAt != null && a.v === 0) atStation(f, a);
        if (f.ph === 'dwell' && a.stopAt == null) {           // the train left the station: the doors are done
          end(f, f.kind === 'porta' ? 'Porta esclusa fino al deposito, riparto.' : null);
          continue;
        }
        if (f.kind === 'porte_persone' && f.ph === 'dwell' && !f.called && f.extra > 40 && S.t - (a.arriveT || f.t0) > (a.dwBase || 20) + 30) {
          f.called = true; call(f, `DCT, treno {T}: a ${name(f.st)} la gente entra all'ultimo e non riesco a chiudere le porte. Chiedo l'agente.`, ['agent']);
        }
        if (f.kind === 'freno' && f.ph === 'armed' && a.v > 5) f.ph = 'stopping';     // in the line, running
        if ((f.kind === 'trazione' || f.kind === 'freno') && f.ph === 'stopping' && a.v === 0 && !(a.stopAt != null && S.t < a.dwellUntil)) {
          f.ph = 'call'; call(f, f.kind === 'trazione' ? `DCT, treno {T}: il treno non riparte${where(a)}. Chiedo istruzioni.` : `DCT, treno {T}: frenatura di emergenza intempestiva${where(a)}, il freno non si allenta.`, ['rearm']);
        }
        if (f.ph === 'rearm' && S.t >= f.until) {
          if (f.kind === 'riarmo') { say(f, 'dr', 'Riarmato, riparto.'); f.ph = 'run'; f.next = S.t + between(300, 900); continue; }
          const ok = !f.force && rnd() < (f.kind === 'freno' ? [0.8, 0.6, 0.4] : [0.7, 0.5, 0.3])[Math.min(f.tries, 2)];
          if (ok) { end(f, 'Riarmo riuscito, riparto.'); continue; }
          f.tries++;
          // the third time: the broken unit is cut out and the train goes with the other one; both dead: the rescue
          if (f.tries >= 3 && f.force !== 'soccorso' && (f.force === 'udt' || rnd() < 0.97)) { f.ph = 'udt'; call(f, 'DCT, treno {T}: terzo riarmo non riuscito. Escludo l\'unità guasta, posso proseguire con l\'altra.', ['home']); }
          else if (f.tries >= 3) { f.ph = 'help'; const w = L.rescuers ? L.rescuers(f.k) : {};
            call(f, 'DCT, treno {T}: tutte e due le unità sono ferme, il treno non si muove. Serve il soccorso.', [w.back != null ? 'rback' : null, w.front != null ? 'rfront' : null, 'badoni'].filter(Boolean)); }
          else { f.ph = 'call'; call(f, `DCT, treno {T}: riarmo non riuscito (${f.tries}°). Chiedo istruzioni.`, ['rearm']); }
        }
        if (f.ph === 'rescue' && S.t >= f.until) end(f, 'Il treno {T} riparte.', 'sys');
        if (f.ph === 'homeWait' && L.home(f.k, true)) f.ph = 'homing';
        if (f.ph === 'badoni' && S.t >= f.until) { unLine(f); L.takeAway(f.k); end(f, 'Il Badoni ha portato il treno {T} al deposito di Rogoredo. Tensione ridata.', 'sys'); continue; }
        // the rescue by the train behind: it arrives, couples, pushes
        if (a.rescue && a.rescue.stage === 'coupling' && f.ph === 'coming') { f.ph = 'coupling'; say(f, 'drr', 'Qui treno {R}: sono al treno {T}, aggancio.'); }
        if (a.rescue && a.rescue.stage === 'towed' && f.ph === 'coupling') { f.ph = 'towed'; say(f, 'drr', 'Qui treno {R}: agganciato, spingo il treno {T} a 15 km/h. I passeggeri scendono alla prossima stazione.'); }
        if (f.kind === 'allarme' && f.ph === 'verify' && S.t >= f.until) {
          if (rnd() < 0.15) {                               // a passenger taken ill (row 21)
            end(f, `Qui ${name(f.st)}: un passeggero si sente male, chiamo i soccorsi.`, 'ag');
            const id = add('malore_treno', f.k); const g = live().find(x => x.id === id); if (g && a.stopAt != null) atStation(g, a);
          } else end(f, `Qui ${name(f.st)}: verificato, niente di grave. Il treno {T} può ripartire.`, 'ag');
        }
        if (f.kind === 'malore_treno' && f.ph === 'held' && S.t >= f.until) end(f, `Qui ${name(f.st)}: il passeggero è stato soccorso, emergenza rientrata. Il treno {T} può ripartire.`, 'ag');
        if (f.kind === 'riarmo' || f.kind === 'secondario') {
          if (f.kind === 'riarmo' && f.ph === 'run' && !f.tech0 && S.t >= f.next && a.v > 3 && a.stopAt == null) { f.ph = 'stopping'; }
          if (f.ph === 'stopping' && a.v === 0) { f.ph = 'call'; call(f, `DCT, treno {T}: il treno mi chiede di nuovo il riarmo${where(a)}.`, f.tech ? ['rearm'] : ['rearm', 'tech']); }
          // the technician: on at San Donato, he checks during the change of cab and on to Rogoredo. There: fixed, he gets off
          // (back with the next train); not fixed: passengers off, the train turns over the crossover of Rogoredo and goes
          // back empty to ROD with him (Giovanni)
          if (f.tech === 'wait' && a.at === SD && a.v === 0) { f.tech = 'board'; f.tech0 = S.t; say(f, 'man', 'Tecnico a bordo del treno {T} a San Donato: verifico durante il cambio banco e fino a Rogoredo.'); }
          if (f.tech === 'board' && a.stopAt === 1 && a.v === 0 && !f.call) {
            if (rnd() < (f.fixP != null ? f.fixP : f.kind === 'secondario' ? 0.9 : 0.8)) { end(f, 'Tecnico: treno {T} sistemato. Scendo a Rogoredo e torno a San Donato con il treno dopo.', 'man'); continue; }
            if (f.kind === 'secondario') { end(f, 'Tecnico: non riesco a sistemarlo qui, ma il treno {T} può restare in servizio: lo vediamo in deposito a fine giornata. Scendo a Rogoredo.', 'man'); continue; }
            f.tech = null; f.tech0 = null; f.ph = 'udt'; f.turnX = 1;
            f.callWho = 'man'; call(f, 'DCT, qui il tecnico: non riesco a sistemare il treno {T}. Facciamo scendere i passeggeri qui a Rogoredo e torniamo vuoti al deposito.', ['home']);
          }
        }
      }
      // random failures, once a minute
      if (fs.on && Math.floor(S.t / 60) !== Math.floor((S.t - DT) / 60)) roll();
    }
    function where(a) { return a.stopAt != null ? ' a ' + name(a.stopAt) : a.at != null ? ' dopo ' + name(a.at) : ''; }
    function roll() {
      // a strike is decided for the day (mostly Monday or Friday: Giovanni), at 4:30
      if (Math.floor(S.t / 60) === 270) { const sc = (c.catalog || []).find(x => x.id === 'sciopero'), wd = c.weekday ? c.weekday() : 1;
        if (sc && sc.perDay > 0 && (wd === 1 || wd === 5) && rnd() < sc.perDay * 2.5) add('sciopero', null, { random: true });
        const pf = (c.catalog || []).find(x => x.id === 'prefettura'); if (pf && pf.perDay > 0 && rnd() < pf.perDay) add('prefettura', null, { random: true }); }
      const cand = S.agents.filter(a => !a.hidden && a.status === 'service' && a.mode !== 'static' && !of(a).length);
      for (const { id, perDay } of c.catalog || []) {
        if (!KINDS[id] || !(perDay > 0)) continue;
        const w = id === 'porte_persone' ? (c.loadAt ? c.loadAt(S.t) / 0.6 : 1) : 1;      // more in the peak hours
        const r = rnd();
        if (r >= perDay * 60 / DAYS * w) continue;
        if (id === 'sciopero' || id === 'prefettura') continue;
        if (KINDS[id].on) { add(id, null, { random: true }); continue; }
        if (!cand.length) continue;
        const a = cand.splice(Math.floor(rnd() * cand.length), 1)[0];
        add(id, a.k, { random: true });
      }
    }

    // the train k may not drive this step (it brakes to a stop and stands): true
    function hold(a) {
      for (const f of of(a)) {
        const stop = (f.kind === 'trazione' || f.kind === 'freno' || f.kind === 'riarmo') && ['stopping', 'call', 'rearm', 'help', 'rescue', 'udt', 'coming', 'coupling'].includes(f.ph);
        if (!stop) continue;
        if (f.kind === 'trazione' && a.stopAt != null && S.t < a.dwellUntil) return false;     // the doors are still open: it fails when leaving
        if (a.v > 0) { const B = f.kind === 'freno' ? c.emBrake(a) : (a.brk || 1.1); a.v = Math.max(0, a.v - B * DT); a.d += a.v * DT; }
        a.why = 'guasto'; return true;
      }
      return false;
    }
    // more seconds at the station (doors, passenger alarm, a passenger taken ill)
    function extraDwell(a) {
      let x = 0;
      for (const f of of(a)) {
        if (f.st == null || f.st !== a.stopAt) continue;
        if (f.ph === 'dwell') x += f.agent ? Math.min(f.extra, (f.agent - (a.arriveT || f.t0)) - (a.dwBase || 20) + 20) : f.extra;
        if (f.ph === 'held' || f.ph === 'verify') x += 1e6;
      }
      return Math.max(0, x);
    }
    const manual = a => of(a).some(f => f.kind === 'ato');
    const half = a => of(a).some(f => (f.kind === 'trazione' || f.kind === 'freno') && (f.ph === 'udt' || f.ph === 'homing'));
    const vcap = a => of(a).some(f => f.kind === 'atp') ? 30 / 3.6 : Infinity;
    function event(e) {
      if (e.what === 'random') { F().on = !!e.on; return true; }
      if (e.what === 'new' && KINDS[e.fault] && KINDS[e.fault].on) return add(e.fault, null, { target: e.target });
      if (e.what === 'pczone') {            // the DCT by hand (Emergenze): red button, power off, hold the trains, on a stretch
        const a = Math.min(e.a, e.b), b = Math.max(e.a, e.b), id = L.zone(e.zone, a, b);
        const f = { id: ++F().seq, kind: 'pc', k: null, t0: S.t, ph: 'on', what: a === b ? name(a) : name(a) + ' – ' + name(b), zones: [id], zone: e.zone }; F().list.push(f);
        say(f, 'pc', e.zone === 'red' ? `Pulsante rosso tra ${f.what}: tutti i semafori a rosso, tutti i treni fermi!` : e.zone === 'power' ? `Tolgo tensione tra ${f.what}.` : `Fermo i treni tra ${f.what}.`);
        return f.id;
      }
      if (e.what === 'avista') {            // the DCT, from the card of signal n: the train standing at it goes by in marcia a vista
        const a = S.agents.find(x => !x.hidden && x.v === 0 && x.red && ((x.red.now || x.red.why) || {}).sig === e.n); if (!a) return { noTrain: true };
        giveVista(a.k, e.n); for (const f of live()) if (f.kind === 'vista' && f.k === a.k) end(f);
        const f = { id: ++F().seq, kind: 'vista', k: a.k, t0: S.t, ph: 'go', n: e.n }; F().list.push(f);
        say(f, 'pc', `Treno {T}, autorizzato a superare il ${tag(e.n)} in marcia a vista fino al semaforo successivo.`); say(f, 'dr', `Ricevuto DCT, supero il ${tag(e.n)} in marcia a vista.`);
        return a.k;
      }
      if (e.what === 'new') { if (e.k == null) { const a = S.agents.find(x => !x.hidden && x.status === 'service' && x.mode !== 'static'); if (!a) return null; e.k = a.k; } return add(e.fault, e.k, e.opts ? { fixP: e.opts.fixP } : undefined); }
      if (e.what === 'answer') return answer(e.id, e.answer);
      return null;
    }
    // for the page: the failures in force, the calls waiting for the DCT, the radio of the failures
    function list() { return live().map(f => Object.assign({ label: KINDS[f.kind].label }, f, { call: f.call && Object.assign({}, f.call, { answers: f.call.opts.map(x => [x, (f.labels && f.labels[x]) || ANSWERS[x]]) }) })); }
    return { emBrake: c.emBrake, targets, hold, extraDwell, manual, half, vcap, tick, event, list, feed: () => F().feed, random: () => F().on, kinds: () => Object.entries(KINDS).filter(([, k]) => k.on !== 'none').map(([id, k]) => ({ id, label: k.label, on: k.on || 'train', perDay: ((c.catalog || []).find(x => x.id === id) || {}).perDay })) };
  }

  const api = { create, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLFaults = api;
})(typeof window !== 'undefined' ? window : globalThis);
