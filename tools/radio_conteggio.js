// How often each radio phrase is said in a day of play (fase 2 of the radio chat): the game page (docs/gioca.html, M3) in
// a headless browser, random failures on as in the Excel (Guasti casuali, Volte al giorno), the whole service day played
// fast with nobody at the controls; every t('code') of web/frasi.js is counted. Writes data/radio_uso_m3.json, which
// tests/radio_varieta_check.js reads to warn when a phrase said often has only one text.
// What it does not see: the orders the player gives (stops, speeds, depot...) — a day with nobody playing has none of them.
// Usage: node tools/radio_conteggio.js [day 1|6|7] [speed]     (needs Playwright with Chromium, and a built docs/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DAY = process.argv[2] || '1', SPEED = +(process.argv[3] || 300);
const PAGE = 'file://' + path.join(ROOT, 'docs/gioca.html') + '?linee=M3&day=' + DAY;
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  // every phrase table made by the page (web/frasi.js) counts the codes it is asked for
  await p.addInitScript(() => {
    window.__radioUso = {}; let api;
    Object.defineProperty(window, 'MTLFrasi', { configurable: true, get: () => api, set: v => {
      const make = v.create;
      v.create = (T, r) => { const f = make(T, r), t = f.t; f.t = (code, vars, rr) => { window.__radioUso[code] = (window.__radioUso[code] || 0) + 1; return t(code, vars, rr); }; return f; };
      api = v;
    } });
  });
  await p.goto(PAGE); await p.waitForTimeout(6000);
  const t0 = Date.now();
  const res = await p.evaluate(async SPEED => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const M = window.mtl, st = M.state, F = M.fleets.find(f => f.line === 'M3' && f.ag);
    F.ag.event({ kind: 'fault', what: 'random', on: true });
    const start = st.t, end = 27 * 3600 - 60;          // (the service day: 03:00 to 02:59 of the next day)
    window.__radioUso = {};
    st.playing = true; st.speed = SPEED;
    let last = st.t, still = 0;
    while (st.t < end && st.t >= start && still < 40) { await sleep(1000); if (st.t === last) still++; else { still = 0; last = st.t; } }
    st.playing = false;
    return { from: start, to: st.t, uso: window.__radioUso };
  }, SPEED);
  await b.close();
  const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radio_m3.json'), 'utf8')).frasi;
  const uso = Object.fromEntries(Object.entries(res.uso).sort((a, b) => b[1] - a[1]));
  const hh = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  const out = { _about: 'Quante volte il gioco chiede ogni frase della radio in una giornata giocata senza nessuno ai comandi, guasti casuali accesi (tools/radio_conteggio.js). Gli ordini del giocatore non ci sono. pezzo.* sono pezzi di frase, non chiamate.',
                giorno: DAY, dalle: hh(res.from), alle: res.to < res.from || res.to >= 27 * 3600 - 60 ? '02:59' : hh(res.to), velocita: SPEED, secondi: Math.round((Date.now() - t0) / 1000), uso };
  fs.writeFileSync(path.join(ROOT, 'data/radio_uso_m3.json'), JSON.stringify(out, null, 1));
  const calls = Object.entries(uso).filter(([c]) => !c.startsWith('pezzo.'));
  console.log(`radio: day ${DAY} ${out.dalle}-${out.alle} at ${SPEED}x in ${out.secondi} s, ${calls.length} phrases said ${calls.reduce((s, x) => s + x[1], 0)} times` + (errs.length ? `, page errors: ${errs.slice(0, 3).join(' | ')}` : ''));
  for (const [c, n] of calls.slice(0, 30)) console.log(String(n).padStart(6), (R[c] ? R[c].testi.length : 0) + ' testi', c);
})().catch(e => { console.error(e); process.exit(1); });
