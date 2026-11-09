// Every M3 station on every M3 sign, in a browser (Giovanni 9 Nov 2026: "MONTENAPOLEONE deve stare dentro ad ogni veletta
// senza dover scorrere"). For each station name (a limited train can show any of them) and each M3 front (Meneghino,
// Leonardo, 1st and 2nd lot): the destination stands still (no animation), every LED dot lies inside the sign, after the
// train number, and the dots are not too small to read. And on the platform screens: the name fits the line in one of
// the screen's letter sizes. Run from the repo (docs/gioca.html built). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const page = 'file://' + path.resolve(__dirname, '..', 'docs', 'gioca.html') + '?linee=M3&day=1';
// the signs as drawn in web/template.html (meneghinoSVG, hitachiSVG, tradSVG)
const SIGN = { meneghino: { x: 38, y: 12, w: 185, h: 21 }, hitachi: { x: 58, y: 17, w: 145, h: 19 }, lotto1: { x: 44, y: 14, w: 173, h: 20 }, lotto2: { x: 44, y: 14, w: 173, h: 20 } };
const PMIN = 1.2;     // smallest dot pitch still readable at the size the front is shown
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page); await p.waitForTimeout(5000);
  let bad = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  const r = await p.evaluate(SIGN => {
    const M = window.mtl, F = M.fleets.find(f => f.line === 'M3' && f.ag), FR = window.__mtlFronts;
    const names = [...new Set(F.engine.G.names.map(n => String(n).toUpperCase().replace(/\s+M\d$/, '').trim()))].filter(Boolean);
    const fails = [], small = [], per = {};
    for (const kind of Object.keys(SIGN)) for (const n of names) {
      const svg = decodeURIComponent(FR.url(kind, n, 'white', '15', '8103').split(',')[1]);
      if (/animate/.test(svg)) { fails.push(kind + ' ' + n + ': runs'); continue; }
      // the LED dots: small circles inside the sign's height; number and destination split at the widest gap
      const S = SIGN[kind], dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)].map(c => [+c[1], +c[2], +c[3]])
        .filter(([, y, rr]) => rr <= 1.1 && y >= S.y && y <= S.y + S.h).sort((a, b) => a[0] - b[0]);
      let cut = -1, gap = 0; for (let i = 1; i < dots.length; i++) if (dots[i][0] - dots[i - 1][0] > gap) { gap = dots[i][0] - dots[i - 1][0]; cut = i; }
      if (cut < 1) { fails.push(kind + ' ' + n + ': no number or no destination'); continue; }
      const num = dots.slice(0, cut).map(c => [c[0], c[2]]), dest = dots.slice(cut).map(c => [c[0], c[2]]);
      const x0 = Math.min(...dest.map(c => c[0] - c[1])), x1 = Math.max(...dest.map(c => c[0] + c[1])), nEnd = Math.max(...num.map(c => c[0] + c[1])), pitch = dest[0][1] / 0.43;
      if (x0 < nEnd || x0 < S.x || x1 > S.x + S.w) fails.push(`${kind} ${n}: dots ${x0.toFixed(1)}-${x1.toFixed(1)}, sign ${S.x}-${S.x + S.w}, number to ${nEnd.toFixed(1)}`);
      if (pitch < S.pmin) small.push(`${kind} ${n} ${pitch.toFixed(2)}`);
      if (!per[kind] || pitch < per[kind][1]) per[kind] = [n, pitch];
    }
    // the platform screens (scrPage): big, then the narrow letters, then the small ones, before the minutes or to the edge
    const { W, txtW } = FR.scr, X0 = 12, xm = W - 2 - txtW('9½', 'big') + 1 - 2, rooms = [xm - txtW('min.') - 2, W - 2];
    const scr = [];
    for (const n of names) for (const room of rooms)
      if (!(X0 + txtW(n, 'big') <= room || X0 - 2 + txtW(n, 'thin1') <= room - 3 || X0 - 2 + txtW(n, 'thin') <= room || X0 + txtW(n, 'small') <= room)) scr.push(n + ' (room ' + room + ')');
    return { n: names.length, fails, small, per: Object.entries(per).map(([k, [n, q]]) => `${k} ${q.toFixed(2)} (${n})`), scr };
  }, Object.fromEntries(Object.entries(SIGN).map(([k, v]) => [k, { ...v, pmin: PMIN }])));
  check(r.n >= 21, `${r.n} M3 station names`);
  check(!r.fails.length, `every name inside every M3 sign, standing still${r.fails.length ? ': ' + r.fails.slice(0, 6).join('; ') : ''}`);
  check(!r.small.length, `dots big enough to read (pitch >= ${PMIN}; smallest: ${r.per.join(', ')})${r.small.length ? ': ' + r.small.slice(0, 6).join('; ') : ''}`);
  check(!r.scr.length, `every name fits the platform screens${r.scr.length ? ': ' + r.scr.join('; ') : ''}`);
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(bad ? 'M3 velette: FAILED' : 'M3 velette: all ok'); process.exit(bad ? 1 : 0);
})();
