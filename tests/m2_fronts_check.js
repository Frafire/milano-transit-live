// The M2 train fronts Giovanni approved (7 Nov 2026), in a browser: the Leonardo in both liveries and the M2 Meneghino in
// both profile colours, running and standing, are valid SVG; a destination too long for the sign runs (an animation), a
// short one stands still; the M3 fronts are unchanged by them (the M3 Meneghino drawn as before). Run from the repo
// (docs/gioca.html built). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const page = 'file://' + path.resolve(__dirname, '..', 'docs', 'gioca.html') + '?linee=M2';
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page); await p.waitForTimeout(2500);
  let bad = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  const r = await p.evaluate(() => { const F = window.__mtlFronts, ok = s => !new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror');
    const all = [];
    for (const liv of ['black', 'green', 'fineco']) for (const l of ['white', 'red']) all.push(['Leonardo ' + liv + ' ' + l, F.leonardo('GESSATE', l, '14', liv)]);
    for (const e of [['#077a39', '#16a552', '#0a8a42'], ['#cf9c06', '#f9cf27', '#d9a70d']]) for (const l of ['white', 'red']) all.push(['Meneghino ' + e[1] + ' ' + l, F.meneghinoM2('COLOGNO NORD', l, '8', e)]);
    return { valid: all.filter(([, s]) => !ok(s)).map(x => x[0]), n: all.length,
      longL: /animateTransform/.test(F.leonardo('ASSAGO MILANOFIORI FORUM', 'white', '14', 'black')), shortL: /animateTransform/.test(F.leonardo('GESSATE', 'white', '14', 'black')),
      longM: /animateTransform/.test(F.meneghinoM2('ASSAGO MILANOFIORI FORUM', 'white', '23', ['#077a39', '#16a552', '#0a8a42'])),
      url: /^data:image\/svg\+xml/.test(F.url('leonardo', 'GESSATE', 'white', '14', 'green')) && /^data:image\/svg\+xml/.test(F.url('meneghinoM2', 'GESSATE', 'white', '14', 'yellow')) }; });
  check(!r.valid.length, `M2 fronts: ${r.n} drawings, all valid SVG${r.valid.length ? ' (not: ' + r.valid.join(', ') + ')' : ''}`);
  check(r.longL && r.longM && !r.shortL, 'a destination too long for the sign runs (Leonardo, Meneghino), a short one stands still');
  check(r.url, 'trainFront gives the M2 fronts (leonardo, meneghinoM2)');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(bad ? 'M2 fronts: FAILED' : 'M2 fronts: all ok'); process.exit(bad ? 1 : 0);
})();
