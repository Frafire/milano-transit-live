// Which panels the game page shows for each line (data/capacita.json): a panel with data-cap is shown only if the line
// has one of its capabilities. Opens the page for M2 and M3 and lists the panels shown and hidden; the M3 must show
// all of its panels (nothing of it changes), the M2 only its own. Also: the M2's Aspetti e codici table and Bivi.
// Needs Playwright with Chromium. Usage: node tests/caps_check.js. Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const DOCS = process.env.DOCS || path.resolve(__dirname, '../docs');
const CAPS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/capacita.json'), 'utf8'));
(async () => {
  const b = await chromium.launch(); let bad = 0;
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  for (const line of ['M3', 'M2']) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.join(DOCS, 'gioca.html') + '?linee=' + line + '&day=3');
    await p.waitForFunction(() => window.mtl && !document.getElementById('loading'), null, { timeout: 120000 });
    const R = await p.evaluate(() => [...document.querySelectorAll('[data-cap]')].map(el => ({ cap: el.dataset.cap, shown: !el.classList.contains('nocap'),
      name: el.getAttribute('aria-label') || (el.querySelector('.label') || el).textContent.trim().split('\n')[0].slice(0, 40) })));
    const has = c => (CAPS[line] || []).includes(c), want = r => r.cap.split(' ').some(has);
    const shown = R.filter(r => r.shown).map(r => r.name), hidden = R.filter(r => !r.shown).map(r => r.name);
    console.log(`     ${line} shows: ${shown.join(' | ') || '-'}`);
    console.log(`     ${line} hides: ${hidden.join(' | ') || '-'}`);
    check(R.every(r => r.shown === want(r)), `${line}: every panel shown or hidden as data/capacita.json says (${shown.length} shown, ${hidden.length} hidden)`);
    if (line === 'M3') check(R.filter(r => !r.shown).every(r => /bivi|aspetti_codici|segnali_kit/.test(r.cap)), 'M3: only the new M2 panels hidden, all of its own shown (the M3 page as before)');
    if (line === 'M2') {
      const t = await p.evaluate(() => ({ rows: document.querySelectorAll('#aspTab tr').length, bivi: [...document.querySelectorAll('#biviRow button')].map(x => x.textContent) }));
      check(t.rows > 1, `M2: Aspetti e codici from Regole_M2.xlsx (${t.rows - 1} aspects)`);
      check(t.bivi.length === (CAPS.M2_bivi || []).length && t.bivi.length > 0, `M2: Bivi automatico / DCT (${t.bivi.join(', ')})`);
      check(hidden.some(n => /Emergenze|Guasti/.test(n)) && hidden.some(n => /M3 trains|M3 control/.test(n)), 'M2: no Badoni / guasti, no M3 signals with itinerari, no tronchetti panel');
    }
    check(!errs.length, `${line}: no errors on the page ${errs.join(' | ')}`);
    await p.close();
  }
  await b.close(); console.log(bad ? bad + ' failed' : 'panels: all ok'); process.exit(bad ? 1 : 0);
})();
