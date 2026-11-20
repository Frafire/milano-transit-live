// The M2 fronts for the line card (data/schede/fronti/m2.json): drawn by the game itself (docs/gioca.html), the Meneghino
// with the sign as small as on the real train (Giovanni 20 Nov 2026), the Leonardo as in the game. Run from the repo after a
// change to the fronts: node tools/fronti_m2.js (tests/m2_fronts_check.js checks the file is up to date).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'data', 'schede', 'fronti', 'm2.json');
const fronti = () => { const F = window.__mtlFronts, url = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  return { Meneghino: url(F.meneghinoM2('GESSATE', 'white', '', ['#077a39', '#16a552', '#0a8a42'], true)),
           Leonardo: url(F.leonardo('ABBIATEGRASSO', 'white', '', 'black')) }; };
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.join(ROOT, 'docs', 'gioca.html') + '?linee=M2'); await p.waitForTimeout(2500);
  const r = await p.evaluate(fronti); await b.close();
  if (process.argv[2] === '--check') { const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    process.stdout.write(old === JSON.stringify(r, null, 1) + '\n' ? 'ok   line card fronts up to date\n' : 'FAIL line card fronts out of date: node tools/fronti_m2.js\n');
    process.exit(old === JSON.stringify(r, null, 1) + '\n' ? 0 : 1); }
  fs.writeFileSync(OUT, JSON.stringify(r, null, 1) + '\n'); console.log('data/schede/fronti/m2.json: ' + Object.keys(r).join(', '));
})();
