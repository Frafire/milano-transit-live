"""The radio phrases of every line, read from the Radio sheets of the rules Excels (one file of phrases per line).

Each rules Excel belongs to one line: data/Regole_interlocking_M3.xlsx is the M3, data/Regole_M2.xlsx the M2. A row
of a Radio sheet goes to the line in its column Linea: M3, M2 or comune (every line). An empty Linea is the line of
its Excel. data/radio_<linea>.json gets the rows of that line plus the "comune" rows of every Excel; a phrase of the
line's own Excel wins over a "comune" one with the same code. The column PROPOSTA (Claude's proposals, not approved
yet) is never read: only Testo and Variante 2-5 go into the game.

Used by tools/rules_from_excel.py (writes the file) and tests/radio_excel_check.py (checks the files are up to date).
"""
import os, warnings
warnings.filterwarnings('ignore')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCELS = {'M3': os.path.join(ROOT, 'data', 'Regole_interlocking_M3.xlsx'), 'M2': os.path.join(ROOT, 'data', 'Regole_M2.xlsx')}
COMUNE = 'comune'
STILI = ('calmo', 'deciso', 'aggressivo')
TEXTS = ('Testo', 'Variante 2', 'Variante 3', 'Variante 4', 'Variante 5')
ABOUT = ('Le frasi della radio della {linea}: le righe con Linea {linea} o comune dei fogli Radio degli Excel delle regole '
         '(tools/rules_from_excel.py, tools/radio_excel.py). Non modificare a mano: si cambia il foglio e si rilancia lo script. '
         '{{T}} e {{R}}: i numeri del treno e del treno di soccorso. La colonna PROPOSTA non entra mai qui.')


def line_of(path):
    """The line of a rules Excel, from its file name (None if it is not one of the known Excels)."""
    for line, p in EXCELS.items():
        if os.path.basename(p) == os.path.basename(path): return line
    return None


def sheet_rows(path):
    """The rows of the Radio sheet of one Excel, as dicts by header (empty list if the sheet is missing)."""
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    if 'Radio' not in wb.sheetnames: return []
    ws = wb['Radio']; clean = lambda v: v.strip() if isinstance(v, str) else v
    head = [clean(c.value) for c in ws[1]]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r and any(v not in (None, '') for v in r):
            out.append({h: clean(v) for h, v in zip(head, r) if h})
    return out


def row_line(r, own):
    v = r.get('Linea')
    return own if v in (None, '') else (COMUNE if str(v).lower() == COMUNE else str(v).upper())


def phrase(r):
    """code -> { chi, quando, testi[, pesi] } of one row, or None if it has no text (a row with only a PROPOSTA)."""
    testi = [str(r.get(h)) for h in TEXTS if r.get(h) not in (None, '')]
    if not testi: return None
    e = {'chi': r.get('Chi parla'), 'quando': r.get('Quando si dice'), 'testi': testi}
    # (Pesi (%): how often each variant comes out, in the order of the variants, e.g. "50, 50"; empty: all the same)
    pw = r.get('Pesi (%)')
    if pw not in (None, ''):
        try:
            pesi = [float(x) for x in str(pw).replace(';', ',').split(',') if x.strip()]
            if len(pesi) == len(testi) and sum(pesi) > 0: e['pesi'] = pesi
        except ValueError: pass
    # (Stile: calmo, deciso or aggressivo for each text, in the same order, e.g. "calmo, aggressivo"; for phase 2)
    st = r.get('Stile')
    if st not in (None, ''):
        stili = [x.strip().lower() for x in str(st).replace(';', ',').split(',')]
        if len(stili) == len(testi) and all(x in STILI for x in stili): e['stili'] = stili
    return e


def build(line, excels=None, cache=None):
    """The phrases of one line, and the problems found (bad Linea values, a code twice). excels: line -> Excel file
    (default EXCELS; tools/rules_from_excel.py puts there the file it was given for its line)."""
    cache = {} if cache is None else cache
    own, common, problems = {}, {}, []
    for xl_line, path in (excels or EXCELS).items():
        if not os.path.exists(path): continue
        if path not in cache: cache[path] = sheet_rows(path)
        for r in cache[path]:
            c = r.get('Codice')
            if not c: continue
            ln = row_line(r, xl_line)
            if ln != COMUNE and ln not in EXCELS:
                problems.append('%s, %s: Linea "%s" (M3, M2 o comune)' % (os.path.basename(path), c, r.get('Linea'))); continue
            if ln not in (line, COMUNE): continue
            e = phrase(r)
            if e is None: continue
            if r.get('Stile') not in (None, '') and 'stili' not in e:
                problems.append('%s, %s: Stile "%s" (uno per testo: %s)' % (os.path.basename(path), c, r.get('Stile'), ', '.join(STILI)))
            into = common if ln == COMUNE else own
            if c in into: problems.append('%s: codice due volte (%s)' % (c, os.path.basename(path)))
            into[c] = e
    frasi = dict(own)
    for c, e in common.items():
        if c not in frasi: frasi[c] = e
    return frasi, problems


def document(line, frasi):
    return {'_about': ABOUT.format(linea=line), 'linea': line, 'frasi': frasi}


def out_path(line, folder=None):
    return os.path.join(folder or os.path.join(ROOT, 'data'), 'radio_%s.json' % line.lower())
