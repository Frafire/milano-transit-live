// M2 signals editor and map (Giovanni, 6 Nov 2026), in a browser:
// (c) the track choice gives the way (dir, heading) and the side Giovanni placed on two known signals;
// (d) with two tracks about as near it takes the one with the signal on its side; one clearly by a track stays on it;
// (e) by zoom: nothing under 15, simple symbols 15-17 (no manovra, marmotta), the head turned along the track at 18, the
//     whole drawing exactly where it was placed at 19, never higher than KITMAX (64 px); by its track, a lead to it.
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
  const A = [45.51604, 9.268928], B = [45.516006, 9.269008], mid = [A[0] + (B[0] - A[0]) * 0.55, A[1] + (B[1] - A[1]) * 0.55];
  const nearest = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, null), mid);
  const chosen = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, true), mid);
  const ill = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, false), mid);
  check(nearest && nearest.w === 259 && chosen && chosen.w === 61 && chosen.side === 'right' && ill && ill.w === 259,
    `about midway between w61 and w259 (nearer w${nearest && nearest.w}): legale -> w${chosen && chosen.w} (${chosen && chosen.side}), illegale -> w${ill && ill.w}`);
  // ... but a signal clearly by one track stays on it, on whichever side it was placed (Giovanni 6 Nov: one on the left
  // of its track was moved to the track beside it)
  const by = [A[0] + (B[0] - A[0]) * 0.8, A[1] + (B[1] - A[1]) * 0.8];
  const keep = await p.evaluate(m => window.__mtlKit.trackFor(m[0], m[1], 65, true), by);
  check(keep && keep.w === 259 && keep.side === 'left', `clearly by w259, on its left: stays on w259 (got w${keep && keep.w}, ${keep && keep.side})`);
  // (e) by zoom (Giovanni 6 Nov): under 15 nothing; 15-17 simple symbols, no manovra or marmotta; 18 the head, turned along
  // the track; 19 the whole drawing exactly where it was placed; never higher than KITMAX (64 px)
  const at = async z => { await p.evaluate(z => { window.__m.setView([45.5160, 9.2692], z); }, z); await p.waitForTimeout(1200);
    return p.evaluate(() => { const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { kz: window.__m.getContainer().dataset.kz,
        track: [...document.querySelectorAll('.ksw.at-track .kturn img')].filter(vis).map(i => Math.max(i.getBoundingClientRect().width, i.getBoundingClientRect().height)),
        place: [...document.querySelectorAll('.ksw.at-place .kturn img')].filter(vis).map(i => Math.max(i.getBoundingClientRect().width, i.getBoundingClientRect().height)),
        simp: [...document.querySelectorAll('.ksimp')].filter(vis).length,
        lowSimple: [...document.querySelectorAll('.ksw.at-track.low .ksimp')].filter(vis).length,
        leads: [...document.querySelectorAll('.ksw.at-track')].filter(w => getComputedStyle(w).display !== 'none').every(w => w.querySelector('.klead')) }; }); };
  const z14 = await at(14), z16 = await at(16), z18 = await at(18), z19 = await at(19);
  check(z14.kz === 'none' && !z14.simp && !z14.track.length && !z14.place.length, 'zoom 14: no signals');
  check(z16.kz === 'simple' && z16.simp > 0 && !z16.track.length && !z16.place.length && !z16.lowSimple, `zoom 16: simple symbols only (${z16.simp}), no manovra or marmotta`);
  check(z18.kz === 'head' && z18.track.length > 0 && !z18.place.length && Math.max(...z18.track) <= 64.5, `zoom 18: the heads by their track (${z18.track.length}), highest ${Math.max(...z18.track).toFixed(1)} px`);
  check(z19.kz === 'full' && z19.place.length > 0 && !z19.track.length && Math.max(...z19.place) <= 64.5, `zoom 19: the whole drawings where they were placed (${z19.place.length}), highest ${Math.max(...z19.place).toFixed(1)} px (max 64)`);
  const placed = await p.evaluate(() => window.__mtlKit.placed());
  check(placed.length > 0 && placed.every(q => Math.abs(q.lat - q.mlat) < 1e-9 && Math.abs(q.lon - q.mlon) < 1e-9), `zoom 19: every signal drawn exactly at the point where it was placed (${placed.length})`);
  check(z16.leads && z18.leads, 'by their track: each with its lead to the track');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close();
  console.log(bad ? 'M2 editor: FAILED' : 'M2 editor: all ok'); process.exit(bad ? 1 : 0);
})();
