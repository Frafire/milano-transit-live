"""The aspects and codes of the M2 (sheet Codici of data/Regole_M2.xlsx, kept by the rules chat) as data/codici_m2.json,
for the game page's "Aspetti e codici" panel. Read only: the Excel is not changed. Needs openpyxl; run it after the
Excel changes (the build reads the JSON, so it needs no extra package).
Usage: python3 tools/codici_m2.py [data/Regole_M2.xlsx] [data/codici_m2.json]"""
import json, os, sys
import openpyxl
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'Regole_M2.xlsx')
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'codici_m2.json')
ws = openpyxl.load_workbook(src, data_only=True)['Codici']
out = []
for r in list(ws.iter_rows(values_only=True))[1:]:
    if not r[0] or str(r[0]).startswith('Successione'): break
    out.append({'aspetto': r[0], 'significato': r[1], 'codice': r[2], 'scaglione': r[3], 'leonardo': r[4], 'meneghino': r[5], 'fonte': r[6], 'note': r[7]})
json.dump({'_about': 'Aspetti e codici della M2, dal foglio Codici di data/Regole_M2.xlsx (tools/codici_m2.py). Velocità in km/h; vuoto = dato che manca.',
           'aspetti': out}, open(dst, 'w'), ensure_ascii=False, indent=1)
print('%s: %d aspects' % (dst, len(out)))
