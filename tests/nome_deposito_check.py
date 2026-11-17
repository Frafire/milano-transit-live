"""The depot is "Deposito Rogoredo" (ROD), not San Donato (Giovanni 17 Nov 2026: Rogoredo is its real name; San Donato is
only the terminus station). Fails when a text the player sees, or a document, still calls the depot "deposito (di) San
Donato" (or "San Donato deposito", "San Donato depot", "depot of San Donato"). The station "San Donato" stays allowed.
Looks at the page and its scripts (web/), the data (data/, JSON and every cell of the Excel files), tools/excel and the
documents (README, CREDITS, docs/*.md)."""
import glob, os, re, sys
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAD = re.compile(r"deposit[oi]\s+(?:officina\s+)?(?:di\s+)?san\s+donato|san\s+donato\s+deposito|"
                 r"depot\s+of\s+san\s+donato|san\s+donato\s+depot", re.I)
FILES = (glob.glob(ROOT + '/web/*.html') + glob.glob(ROOT + '/web/*.js') + glob.glob(ROOT + '/data/**/*.json', recursive=True)
         + glob.glob(ROOT + '/tools/excel/*.json') + glob.glob(ROOT + '/docs/*.md') + glob.glob(ROOT + '/docs/planning/*.md')
         + [ROOT + '/README.md', ROOT + '/CREDITS.md'])
bad = []
for f in FILES:
    if not os.path.exists(f): continue
    for n, line in enumerate(open(f, encoding='utf-8'), 1):
        for m in BAD.finditer(line):
            bad.append('%s:%d: %s' % (os.path.relpath(f, ROOT), n, m.group(0)))
for f in glob.glob(ROOT + '/data/**/*.xlsx', recursive=True):
    for ws in openpyxl.load_workbook(f, read_only=True):
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str):
                    for m in BAD.finditer(c.value):
                        bad.append('%s, foglio %s, %s: %s' % (os.path.relpath(f, ROOT), ws.title, getattr(c, 'coordinate', '?'), m.group(0)))
if bad:
    print('FAIL il deposito si chiama "Deposito Rogoredo" (ROD), non San Donato:'); print('\n'.join('   ' + b for b in bad)); sys.exit(1)
print('ok   nome del deposito: nessun "deposito (di) San Donato" nei testi e nei documenti (%d file)' % len(FILES))
