// The radio phrases (web/frasi.js, data/radio_m3.json from the Radio sheet of the rules Excel). Checks, on the code:
// every phrase code the code uses is in the file, every phrase in the file is used, no radio text is left written in the
// code (say / call / end / driverSays / stationSays / env.say / env.call with a literal text), every phrase has a text.
// Usage: node tests/radio_check.js
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radio_m3.json'), 'utf8')).frasi || {};
const FILES = ['web/faults.js', 'web/radio.js', 'web/DepotM3.js', 'web/template.html'];
const PREF = new Set(Object.keys(R).map(c => c.split('.')[0]));
let fail = 0; const used = new Set(), missing = [], literal = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/['"]([a-z0-9_]+(?:\.[a-z0-9_]+)+)['"]/g)) {
    const c = m[1]; if (!PREF.has(c.split('.')[0])) continue;
    used.add(c); if (!R[c]) missing.push(f + ': ' + c);
  }
  // radio texts still written in the code: a literal with letters as the text of a radio call
  const pats = [/\bsay\(f, *'[a-z]+', *[`'"][A-Za-zÀ-ú(]/g, /\bcall\(f, *[`'"][A-Za-zÀ-ú]/g, /\bend\(f, *[`'"][A-Za-zÀ-ú]/g,
    /\bdriverSays\( *[`'"][A-Za-zÀ-ú]/g, /\bstationSays\( *[`'"][A-Za-zÀ-ú]/g, /\benv\.say\([^,]+, *[`'"][A-Za-zÀ-ú]/g, /\benv\.call\(tr, *[`'"][A-Za-zÀ-ú]/g,
    /\bsay\('(?:DCT|T'[^,]*|Staz[^,]*)?', *[`'"][A-Za-zÀ-ú]/g, /\bMR\.say\('', *[`'"][A-Za-zÀ-ú]/g, /\bsay\('', *[`'"][A-Za-zÀ-ú]/g, /\bcall\( *`[A-Za-zÀ-ú$]/g];
  src.split('\n').forEach((line, i) => { for (const p of pats) { p.lastIndex = 0; if (p.test(line)) { literal.push(f + ':' + (i + 1) + ': ' + line.trim().slice(0, 120)); break; } } });
}
const unused = Object.keys(R).filter(c => !used.has(c)), empty = Object.entries(R).filter(([, e]) => !e.testi || !e.testi.length || e.testi.some(x => !String(x).trim())).map(([c]) => c);
console.log(`${missing.length ? 'FAIL' : 'ok  '} radio phrases used by the code: ${used.size}, missing from data/radio_m3.json: ${missing.length}${missing.length ? ' (' + missing.slice(0, 8).join('; ') + ')' : ''}`);
console.log(`${literal.length ? 'FAIL' : 'ok  '} radio texts still written in the code: ${literal.length}${literal.length ? '\n  ' + literal.slice(0, 12).join('\n  ') : ''}`);
console.log(`${empty.length ? 'FAIL' : 'ok  '} phrases without a text: ${empty.length}${empty.length ? ' (' + empty.join(', ') + ')' : ''}`);
console.log(`${unused.length ? 'note' : 'ok  '} phrases in the file not used by the code: ${unused.length}${unused.length ? ' (' + unused.slice(0, 10).join(', ') + ')' : ''}`);
if (missing.length || literal.length || empty.length) fail++;
process.exit(fail ? 1 : 0);
