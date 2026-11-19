// Variety of the radio (fase 2 of the radio chat): the phrases said most in a day (data/radio_uso_m3.json, made by
// tools/radio_conteggio.js) should have more than one text. Only a warning, never a failure: the texts are Giovanni's.
// Also checks web/frasi.js: weights and the style (vars.stile) choose among the variants, the same seed gives the same text.
// Usage: node tests/radio_varieta_check.js [how many of the most used, default 30]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), TOP = +(process.argv[2] || 30);
const FR = require(path.join(ROOT, 'web/frasi.js'));
let fail = 0;
// frasi.js: pesi and stile
{
  const T = { x: { testi: ['a', 'b', 'c'], pesi: [0, 100, 0], stili: ['calmo', 'deciso', 'aggressivo'] }, y: { testi: ['a', 'b'], stili: ['calmo', 'aggressivo'] } };
  let s = 7; const rng = () => (s = (s * 16807) % 2147483647) / 2147483647, f = FR.create(T, rng);
  const ok = f.t('x') === 'b' && [...Array(20)].every(() => f.t('y', { stile: 'aggressivo' }) === 'b') && [...Array(20)].every(() => f.t('y', { stile: 'calmo' }) === 'a')
    && f.t('y', { stile: 'nessuno' }) !== undefined;
  s = 7; const a = [...Array(10)].map(() => FR.create(T, rng).t('y')).join(); s = 7; const b = [...Array(10)].map(() => FR.create(T, rng).t('y')).join();
  console.log(`${ok && a === b ? 'ok  ' : 'FAIL'} web/frasi.js: the weights and the style choose the text, the same seed the same texts`);
  if (!(ok && a === b)) fail++;
}
const U = path.join(ROOT, 'data/radio_uso_m3.json');
if (!fs.existsSync(U)) { console.log('note radio variety: no data/radio_uso_m3.json (node tools/radio_conteggio.js)'); process.exit(fail ? 1 : 0); }
const uso = JSON.parse(fs.readFileSync(U, 'utf8')), R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radio_m3.json'), 'utf8')).frasi;
// the calls only: no pieces of phrases (pezzo.*), no names, no lines of the system (not said by anybody)
const top = Object.entries(uso.uso).filter(([c]) => R[c] && !c.startsWith('pezzo.') && R[c].chi !== 'sistema' && c !== 'stazione.os.chi').slice(0, TOP);
const one = top.filter(([c]) => R[c].testi.length < 2);
console.log(`${one.length ? 'note' : 'ok  '} radio variety: of the ${top.length} phrases said most in a day (${uso.dalle}-${uso.alle}, day ${uso.giorno}), ${one.length} have only one text` +
  (one.length ? '\n  ' + one.slice(0, 12).map(([c, n]) => `${c} (${n} volte)`).join(', ') + (one.length > 12 ? ', ...' : '') : ''));
process.exit(fail ? 1 : 0);
