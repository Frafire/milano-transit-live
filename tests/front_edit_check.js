// The front set by hand (Giovanni 20 Nov 2026): a press on the front in the train's card opens the editor; number,
// destination and lights set there go on the front and stay (only what differs from the automatic sign); "Tutto automatico"
// gives the game's sign back. In a browser, on the M3 (the M2's cards have no front yet) (docs/gioca.html built). Exit code 1 if one fails.
const { chromium } = require('playwright');
const path = require('path');
const page = 'file://' + path.resolve(__dirname, '..', 'docs', 'gioca.html') + '?linee=M3';
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page); await p.waitForTimeout(3000);
  let bad = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
  const k0 = await p.evaluate(async () => { const M = window.mtl, st = M.state; st.playing = false; st.t = 9 * 3600; await new Promise(r => setTimeout(r, 1500));
    const F = M.fleets.find(f => f.line === 'M3'), k = F.trains.findIndex(tr => M.trainState(F, tr, st.t).trip >= 0 && M.realTrain(F, tr, st.t));
    st.sel = 'f' + M.fleets.indexOf(F) + ':' + k; M.renderCard(); await new Promise(r => setTimeout(r, 300));
    return document.getElementById('trainFront') ? document.getElementById('trainFront').dataset.k : null; });
  check(!!k0, 'a M3 train\'s card with its front (' + k0 + ')');
  await p.click('#trainFront'); check(await p.isVisible('#frontEdit'), 'a press on the front opens the editor');
  await p.fill('#feNo', '77'); await p.fill('#feDest', 'PIOLA'); await p.selectOption('#feLights', 'red'); await p.click('#feOk'); await p.waitForTimeout(1500);
  const k1 = await p.$eval('#trainFront', e => e.dataset.k);
  check(/PIOLA/.test(k1) && /red/.test(k1) && /77$/.test(k1) && !(await p.isVisible('#frontEdit')), 'number, destination and lights on the front, still after a second (' + k1 + ')');
  await p.click('#trainFront'); await p.click('#feAuto'); await p.waitForTimeout(400);
  check(await p.$eval('#trainFront', e => e.dataset.k) === k0, '"Tutto automatico" gives the game\'s sign back');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(bad ? 'front editor: FAILED' : 'front editor: all ok'); process.exit(bad ? 1 : 0);
})();
