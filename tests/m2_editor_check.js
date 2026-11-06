// M2 signals editor and map (Giovanni, 6 Nov 2026), in a browser:
// (c) the track choice gives the way (dir, heading) and the side Giovanni placed on two known signals;
// (d) with more tracks close by it takes the right one (the one with the signal on its side), not just the nearest;
// (e) at high zoom no drawn signal is higher than the largest size (KITMAX, 64 px); by zoom: dots, simple symbols, full;
//     every drawn signal has its lead to the track.
// Run from the repo (docs/gioca.html built). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const page = 'file://' + path.resolve(__dirname, '..', 'docs', 'gioca.html') + '?linee=M2';
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    let _L; Object.defineProperty(window, 'L', { configurable: true, get() { return _L; }, set(v) { _L = v; v.Map.addInitHook(function () { window.__m = this; }); } });
    try { localStorage.removeItem('mtl-edit'); localStorage.setItem('mtl-kitsig-M2', '1'); } catch (e) {}
  });
  await p.goto(page); await p.waitForTimeout(3500);
  let bad = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  // (c) known signals: placed by Giovanni, the stored track, way and side
  const known = [
    { n: 'POSTO 16a', at: [45.516363, 9.274338], heading: 101, right: true, w: 116, dir: 1, side: 'right' },
    { n: 'POSTO 14b', at: [45.516002, 9.2691], heading: 245, right: false, w: 259, dir: -1, side: 'right' },
  ];
  for (const k of known) {
    const c = await p.evaluate(k => window.__mtlKit.trackFor(k.at[0], k.at[1], k.heading, k.right), k);
    check(c && c.w === k.w && c.dir === k.dir && c.side === k.side, `${k.n}: track w${k.w}, dir ${k.dir}, side ${k.side} (got ${JSON.stringify(c)})`);
  }
  // (d) two parallel tracks at Cascina Gobba, w61 and w259 (POSTO 248a and POSTO 14a stand by them, both legale, facing 65°):
  // w259 is on the right of w61. A legale signal between them, nearer to w259, stands on the right of w61 and on the left
  // of w259: it belongs to w61, not to the nearest track
  const A = [45.51604, 9.268928], B = [45.516006, 9.269008], mid = [A[0] + (B[0] - A[0]) * 0.62, A[1] + (B[1] - A[1]) * 0.62];
  const nearest = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, null), mid);
  const chosen = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, true), mid);
  const ill = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, false), mid);
  check(nearest && nearest.w === 259 && chosen && chosen.w === 61 && chosen.side === 'right' && ill && ill.w === 259,
    `between w61 and w259, nearer w${nearest && nearest.w}: legale -> w${chosen && chosen.w} (${chosen && chosen.side}), illegale -> w${ill && ill.w}`);
  // (e) sizes by zoom
  const at = async z => { await p.evaluate(z => { window.__m.setView([45.5160, 9.2710], z); }, z); await p.waitForTimeout(1200);
    return p.evaluate(() => ({ kz: window.__m.getContainer().dataset.kz,
      img: [...document.querySelectorAll('.kitsig img')].map(i => i.getBoundingClientRect()).filter(r => r.width).map(r => r.height),
      simp: [...document.querySelectorAll('.ksimp')].map(i => i.getBoundingClientRect()).filter(r => r.width).map(r => r.width),
      dots: [...document.querySelectorAll('.kdot')].filter(i => i.getBoundingClientRect().width).length,
      leads: [...document.querySelectorAll('.ksw')].filter(i => getComputedStyle(i).display !== 'none').every(w => w.querySelector('.klead')) })); };
  const z14 = await at(14), z16 = await at(16), z18 = await at(18), z19 = await at(19);
  check(z14.kz === 'dot' && z14.dots > 0 && !z14.img.length, `zoom 14: coloured dots only (${z14.dots})`);
  check(z16.kz === 'simple' && z16.simp.length > 0 && !z16.img.length && Math.min(...z16.simp) >= 6, `zoom 16: simple symbols, at least 6 px (${z16.simp.length})`);
  check(z18.kz === 'full' && z18.img.length > 0 && Math.max(...z18.img) <= 64.5, `zoom 18: full drawings, highest ${Math.max(...z18.img).toFixed(1)} px (max 64)`);
  check(z19.img.length > 0 && Math.max(...z19.img) <= 64.5 && Math.min(...z19.img) >= 10, `zoom 19: no drawing higher than 64 px (highest ${Math.max(...z19.img).toFixed(1)}, lowest ${Math.min(...z19.img).toFixed(1)})`);
  check(z14.leads && z16.leads && z18.leads, 'every drawn signal has its lead to the track');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close();
  console.log(bad ? 'M2 editor: FAILED' : 'M2 editor: all ok'); process.exit(bad ? 1 : 0);
})();
