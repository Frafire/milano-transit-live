// The menu (docs/index.html) in a headless browser:
// - Gioca! opens the choice of the vehicle, Metro opens the choice of the line
// - what data/linee.json says is "in arrivo" is shown grey and does not open anything; what is "giocabile" does
// - choosing a line opens gioca.html?linee=<line>, which loads only that line's data file (dati/<line>_<day>.js)
// - gioca.html without lines that can be played says so and does not load any data
// Needs Playwright with Chromium. Usage: node tests/home_check.js. Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const DOCS = process.env.DOCS || path.resolve(__dirname, '../docs');
const HOME = 'file://' + path.join(DOCS, 'index.html');
const LINEE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/linee.json'), 'utf8'));
const playable = ['M1', 'M2', 'M3', 'M4', 'M5'].filter(l => LINEE[l] === 'giocabile');

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
    const yes = k.split(',').some(x => LINEE[x] === 'giocabile');
    check((await p.getAttribute(`#metro [data-k="${k}"]`, 'aria-disabled')) === (yes ? null : 'true'), `${k}: ${yes ? 'giocabile' : 'in arrivo'}`);
  }
  for (const v of ['avvio', 'mezzo', 'metro']) {      // nothing wider than a phone
    const q = await b.newPage({ viewport: { width: 400, height: 860 } }); await q.goto(HOME + '#' + v);
    check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `phone width, ${v}: no sideways scroll`); await q.close();
  }
  check(!errors.length, 'no errors in the menu ' + errors.join(' | '));

  // a line: only its data
  for (const line of playable) {
    const g = await b.newPage(); const asked = [];
    g.on('request', r => { const m = r.url().match(/\/dati\/([^/?#]+)$/); if (m) asked.push(m[1]); });
    await g.goto(HOME + '#metro'); await g.click(`#metro [data-k="${line}"]`);
    await g.waitForURL(/gioca\.html\?linee=/); await g.waitForFunction(() => window.mtl && window.mtl.fleets && !document.getElementById('loading'), null, { timeout: 120000 });
    const url = g.url(), fleets = await g.evaluate(() => window.mtl.fleets.map(f => f.line));
    check(url.endsWith('gioca.html?linee=' + line), `${line}: opens ${url.split('/').pop()}`);
    check(asked.length === 1 && asked[0].startsWith(line.toLowerCase() + '_'), `${line}: only its data file is loaded (${asked.join(', ')})`);
    check(fleets.length && fleets.every(f => f === line), `${line}: the game has only ${line} trains (${[...new Set(fleets)].join(', ')})`);
    await g.close();
  }
  // a line that cannot be played
  { const g = await b.newPage(); const asked = []; g.on('request', r => { if (/\/dati\//.test(r.url())) asked.push(r.url()); });
    await g.goto('file://' + path.join(DOCS, 'gioca.html') + '?linee=M9'); await g.waitForTimeout(800);
    check(/non ancora giocabile/.test(await g.textContent('#loading')) && !asked.length, 'gioca.html?linee=M9: says the line cannot be played, loads nothing'); await g.close(); }
  await b.close();
  console.log(bad ? bad + ' failed' : 'menu: all ok'); process.exit(bad ? 1 : 0);
})();
