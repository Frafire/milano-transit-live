// The game's code read by ESLint for the mistakes that break the page without a word (Giovanni 27 Nov 2026, "controlla il
// codice, cerca parti duplicate o problemi generali"): a name used that nothing defines (the page stops at that line), a
// function written twice in the same place (the first copy is dead, and the next change goes into the wrong one), a key
// twice in one object, code after a return. Found that day: five functions of the page written twice, the old calls of the
// DCO after a return, a turn written twice in the engine.
// The page's script (web/template.html, the last <script>) and web/*.js. Skipped without ESLint (npm install eslint).
// Run from anywhere:  node tests/lint_check.js
const fs = require('fs'), path = require('path'), os = require('os');
let ESLint; try { ({ ESLint } = require('eslint')); } catch (e) { console.log('(lint skipped: ESLint not installed)'); process.exit(0); }
const WEB = path.join(__dirname, '..', 'web');
// the names the code takes from the browser, from Leaflet, from Node (the engine files run in both) and from the page's data
const GLOBALS = ('Blob DecompressionStream L MTLAgents MTLDepotM3 MTLEngine MTLFaults MTLFrasi MTLInterlocking MTLRadio MTLRoutes MTL_CAPS MTL_DATA MTL_PACKS Response URL ' +
  'URLSearchParams addEventListener atob cancelAnimationFrame clearInterval clearTimeout console document innerHeight innerWidth localStorage location module navigator ' +
  'performance process requestAnimationFrame require setInterval setTimeout structuredClone window').split(' ');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtl-lint-')), html = fs.readFileSync(path.join(WEB, 'template.html'), 'utf8').split('\n');
  // the page's own script: from the last line "<script>" to the last "</script>"
  const a = html.lastIndexOf('<script>'), b = html.lastIndexOf('</script>'); if (a < 0 || b < a) { console.log('FAIL lint: no script in web/template.html'); process.exit(1); }
  fs.writeFileSync(path.join(dir, 'template.js'), html.slice(a + 1, b).join('\n'));
  const files = fs.readdirSync(WEB).filter(f => f.endsWith('.js')); files.forEach(f => fs.copyFileSync(path.join(WEB, f), path.join(dir, f)));
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: [{ files: ['*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: Object.fromEntries(GLOBALS.map(g => [g, 'writable'])) },
    rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error',
      'no-const-assign': 'error', 'no-func-assign': 'error', 'no-self-assign': 'error', 'no-unsafe-negation': 'error', 'use-isnan': 'error', 'valid-typeof': 'error' } }] });
  const res = await eslint.lintFiles(['*.js']); let n = 0;
  for (const r of res) { const f = path.basename(r.filePath), tpl = f === 'template.js';
    for (const m of r.messages) { n++; console.log(`  web/${tpl ? 'template.html' : f}:${m.line + (tpl ? a + 1 : 0)}  ${m.message}${m.ruleId ? ' (' + m.ruleId + ')' : ''}`); } }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${n ? 'FAIL' : 'ok  '} lint: ${res.length} files, ${n} problems`);
  process.exit(n ? 1 : 0);
})();
