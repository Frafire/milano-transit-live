"""The radio phrases of every line (tools/radio_excel.py): data/radio_<linea>.json is up to date with the Radio sheets of
the rules Excels, every row has a good Linea (M3, M2 or comune), no code is twice, and the files hold only Testo and the
variants (the column PROPOSTA is never read: a proposal goes into the game only when it is copied into Testo). Usage: python3 tests/radio_excel_check.py   (skipped without openpyxl: it reads the Excels)
"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
try:
    import openpyxl  # noqa: F401
except ImportError:
    print('note radio phrases from the Excels: skipped (openpyxl not installed)'); sys.exit(0)
import radio_excel

fail = 0; cache = {}
for line in radio_excel.EXCELS:
    frasi, problems = radio_excel.build(line, cache=cache)
    out = radio_excel.out_path(line)
    have = json.load(open(out)).get('frasi') if os.path.exists(out) else None
    same = have == frasi
    ok = same and not problems
    print('%s radio %s: %d frasi%s%s' % ('ok  ' if ok else 'FAIL', line, len(frasi),
          '' if same else ', data/radio_%s.json not up to date (python3 tools/rules_from_excel.py%s)' % (line.lower(), '' if line == 'M3' else ' ' + os.path.relpath(radio_excel.EXCELS[line], ROOT)),
          '' if not problems else ', ' + '; '.join(problems[:6])))
    if not ok: fail += 1
sys.exit(1 if fail else 0)
