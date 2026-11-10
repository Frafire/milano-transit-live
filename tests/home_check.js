// The menu (docs/index.html) in a headless browser:
// - Gioca! opens the choice of the vehicle, Metro opens the choice of the line
// - what data/linee.json says is "in arrivo" is shown grey and does not open anything; what is "giocabile" or
//   "in test" (a line being built, opened to try it) does
// - choosing a line opens gioca.html?linee=<line>, which loads only that line's data file (dati/<line>_<day>.js)
// - gioca.html without lines that can be played says so and does not load any data
// Needs Playwright with Chromium. Usage: node tests/home_check.js. Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const DOCS = process.env.DOCS || path.resolve(__dirname, '../docs');
const HOME = 'file://' + path.join(DOCS, 'index.html');
const LINEE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/linee.json'), 'utf8'));
const OPEN = v => v === 'giocabile' || v === 'in test';
const playable = ['M1', 'M2', 'M3', 'M4', 'M5'].filter(l => OPEN(LINEE[l]));
const ORARI = LINEE.orari || {};

(async () => {
  const b = await chromium.launch(); let bad = 0;
  const shown = (pg, sel) => pg.waitForSelector(sel, { state: 'visible', timeout: 3000 }).then(() => true, () => false);
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  const p = await b.newPage({ viewport: { width: 1200, height: 820 } });
  const errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.goto(HOME);
  check(await p.isVisible('#avvio') && !(await p.isVisible('#mezzo')), 'the menu opens on the start screen');
  await p.click('#play');
  check(await shown(p, '#mezzo'), 'Gioca! opens the choice of the vehicle');
  for (const k of ['tram', 'bus', 'rete']) {
    const off = await p.getAttribute(`#mezzo [data-k="${k}"]`, 'aria-disabled');
    check(off === (LINEE[k] === 'giocabile' ? null : 'true'), `${k}: ${LINEE[k]}`);
  }
  await p.click('#mezzo [data-k="tram"]', { force: true });
  check(await p.isVisible('#mezzo') && await p.isVisible('#toast'), 'a tile in arrivo does not open anything, it says so');
  await p.click('#mezzo [data-k="metro"]');
  check(await shown(p, '#metro'), 'Metro opens the choice of the line');
  for (const k of ['M1', 'M2', 'M3', 'M4,M5', 'M1+M2+M3', 'metro-tutte']) {
    const yes = k.split(',').some(x => OPEN(LINEE[x]));
    check((await p.getAttribute(`#metro [data-k="${k}"]`, 'aria-disabled')) === (yes ? null : 'true'), `${k}: ${yes ? k.split(',').map(x => LINEE[x]).find(OPEN) : 'in arrivo'}`);
  }
  for (const v of ['avvio', 'mezzo', 'metro']) {      // nothing wider than a phone
    const q = await b.newPage({ viewport: { width: 400, height: 860 } }); await q.goto(HOME + '#' + v);
    check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `phone width, ${v}: no sideways scroll`); await q.close();
  }
  // the line card (Giovanni 10 Nov 2026): the "i" opens it and does not start the game; Esc and Chiudi close it; the bar
  // takes you to each section and lights it while you scroll; the tables of the trains
  { const before = p.url();
    await p.click('#metro .tilewrap .info');
    check(await shown(p, '#ls') && p.url() === before && await p.isVisible('#metro'), 'the "i" on M3 opens the line card, the game does not start');
    await p.keyboard.press('Escape'); check(await p.isHidden('#ls'), 'Esc closes the card');
    await p.focus('#metro .tilewrap .info'); await p.keyboard.press('Enter'); check(await shown(p, '#ls'), 'Enter on the "i" opens it');
    await p.click('#lsClose'); check(await p.isHidden('#ls'), 'Chiudi closes it');
    await p.click('#metro .tilewrap .info');
    const ids = await p.$$eval('#lsnav a', as => as.map(a => a.getAttribute('href').slice(1)));
    for (const id of ids) {
      await p.click(`#lsnav a[href="#${id}"]`); await p.waitForTimeout(900);
      const r = await p.evaluate(id => { const s = document.getElementById(id), t = s.getBoundingClientRect().top, on = document.querySelector('#lsnav a.on');
        const last = s === [...document.querySelectorAll('#ls section')].pop(), atEnd = document.getElementById('ls').scrollTop + innerHeight >= document.getElementById('ls').scrollHeight - 2;
        return { near: t >= 0 && t < 140, on: on && on.getAttribute('href') === '#' + id, last, atEnd }; }, id);
      check((r.near && r.on) || (r.atEnd && r.on !== false), `bar: ${id} brings its section up and lights it (${JSON.stringify(r)})`);
    }
    const T = await p.$$eval('#ls article.fam', fs => fs.map(f => ({ t: f.querySelector('h4').textContent, rows: [...f.querySelectorAll('tbody tr')].map(r => [r.cells[0].textContent, r.classList.contains('old')]) })));
    const num = s => parseInt(s.replace(/[^0-9].*$/, ''), 10), sorted = rs => rs.every((r, i) => !i || num(rs[i - 1][0]) <= num(r[0]));
    const g = re => T.find(f => re.test(f.t)) || { rows: [] };
    const abb = g(/1° lotto · inverter ABB/), soc = g(/SOCIMI/);
    check(abb.rows.filter(r => !r[1]).length === 16 && abb.rows.filter(r => r[1]).length === 2, `1° lotto ABB: 16 trains of the game + 2 old units (${abb.rows.length})`);
    check(soc.rows.length === 6 && soc.rows.every(r => r[1]), `SOCIMI: 6 old units (${soc.rows.length})`);
    check(g(/2° lotto/).rows.length >= 1 && g(/Meneghino/).rows.length >= 1 && g(/Galileo/).rows.length >= 1, 'tables of the 2° lotto, Meneghino and Galileo');
    check(T.every(f => sorted(f.rows)), 'every table in the order of the numbers');
    await p.click('#lsClose'); }
  // the choice of the timetable: the M3 tile opens it; a historical one in arrivo opens nothing, a giocabile one opens the
  // game with ?orario= (data/linee.json "orari"; Milano Cortina giocabile since 10 Nov 2026, Giovanni)
  { await p.click('#metro .tile[data-k="M3"]'); check(await shown(p, '#pick'), 'the M3 tile opens the choice of the timetable');
    for (const h of Object.keys(ORARI.M3 || {}).filter(h => h !== 'attuale' && !h.startsWith('_'))) {
      if (OPEN(ORARI.M3[h])) { const q = await b.newPage(); await q.goto(HOME + '#metro'); await q.click('#metro .tile[data-k="M3"]');
        await Promise.all([q.waitForURL(/gioca\.html/, { waitUntil: 'commit' }), q.click(`#pick .pp[data-h="${h}"]`)]);
        check(/linee=M3/.test(q.url()) && new RegExp('orario=' + h).test(q.url()), `${h}: giocabile, opens the game with that timetable`); await q.close(); continue; }
      const u = p.url(); await p.click(`#pick .pp[data-h="${h}"]`); await p.waitForTimeout(300);
      check(p.url() === u && await p.isVisible('#pick') && await p.isVisible('#toast'), `${h}: in arrivo, opens nothing, says so`); }
    await p.keyboard.press('Escape'); check(await p.isHidden('#pick'), 'Esc closes the choice'); }
  for (const what of ['card', 'pick']) {      // nothing wider than a phone
    const q = await b.newPage({ viewport: { width: 400, height: 860 } }); await q.goto(HOME + '#metro');
    if (what === 'card') await q.click('#metro .tilewrap .info'); else await q.click('#metro .tile[data-k="M3"]');
    await q.waitForTimeout(300);
    check(await q.evaluate(id => { const e = document.getElementById(id); return e.scrollWidth <= e.clientWidth && document.documentElement.scrollWidth <= innerWidth; }, what === 'card' ? 'ls' : 'pick'), `phone width, ${what === 'card' ? 'line card' : 'choice of the timetable'}: no sideways scroll`);
    await q.close(); }
  check(!errors.length, 'no errors in the menu ' + errors.join(' | '));

  // a line: only its data
  for (const line of playable) {
    const g = await b.newPage(); const asked = [];
    g.on('request', r => { const m = r.url().match(/\/dati\/([^/?#]+)$/); if (m) asked.push(m[1]); });
    await g.goto(HOME + '#metro'); await g.click(`#metro .tile[data-k="${line}"]`);
    // (a line with more than one timetable: its tile opens the choice; "Orario attuale" is today's game, as before)
    if (ORARI[line]) await g.click('#pick .pp[data-h="attuale"]');
    await g.waitForURL(/gioca\.html\?linee=/); await g.waitForFunction(() => window.mtl && window.mtl.fleets && !document.getElementById('loading'), null, { timeout: 120000 });
    const url = g.url(), fleets = await g.evaluate(() => window.mtl.fleets.map(f => f.line));
    check(url.endsWith('gioca.html?linee=' + line), `${line}: opens ${url.split('/').pop()}`);
    check(asked.length === 1 && asked[0].startsWith(line.toLowerCase() + '_'), `${line}: only its data file is loaded (${asked.join(', ')})`);
    // a line in test may have no fleet yet (only its timetable): then it must not show another line's trains
    check((fleets.length || LINEE[line] === 'in test') && fleets.every(f => f === line), `${line}: the game has only ${line} trains (${[...new Set(fleets)].join(', ') || 'timetable only'})`);
    await g.close();
  }
  // a line that cannot be played
  { const g = await b.newPage(); const asked = []; g.on('request', r => { if (/\/dati\//.test(r.url())) asked.push(r.url()); });
    await g.goto('file://' + path.join(DOCS, 'gioca.html') + '?linee=M9'); await g.waitForTimeout(800);
    check(/non ancora giocabile/.test(await g.textContent('#loading')) && !asked.length, 'gioca.html?linee=M9: says the line cannot be played, loads nothing'); await g.close(); }
  await b.close();
  console.log(bad ? bad + ' failed' : 'menu: all ok'); process.exit(bad ? 1 : 0);
})();
