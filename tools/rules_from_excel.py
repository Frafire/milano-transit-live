"""Giovanni's rules (data/Regole_interlocking_M3.xlsx) -> data/regole_m3.json, what the build reads.

The Excel file is where the rules are written; the json is the same thing in a form the build can read without
Excel libraries. Run after every change to the Excel file:  python3 tools/rules_from_excel.py
(needs openpyxl: pip install openpyxl). Only values are read: colours, comments and formulas are not.
"""
import json, os, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'Regole_interlocking_M3.xlsx')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'regole_m3.json')
wb = openpyxl.load_workbook(SRC, data_only=True)
clean = lambda v: v.strip() if isinstance(v, str) else v


def rows(name):
    ws = wb[name]
    head = [clean(c.value) for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r and any(v is not None and v != '' for v in r):
            yield {h: clean(v) for h, v in zip(head, r) if h}


def num(lab):        # 'A13' -> 13
    try: return int(str(lab).lstrip('#A'))
    except ValueError: return None


# times: name -> [min, max] (a total row without numbers is skipped: it is computed from the others)
tempi = {}
for r in rows('Tempi'):
    if r.get('Voce') and (isinstance(r.get('Minimo (s)'), (int, float)) or isinstance(r.get('Massimo (s)'), (int, float))):
        tempi[r['Voce']] = [r.get('Minimo (s)'), r.get('Massimo (s)'), r.get('Da dove viene')]

semafori = {}
for r in rows('Semafori'):
    n = num(r.get('Semaforo'))
    if n is None: continue
    semafori[str(n)] = {'legale': r.get('Lato') == 'legale', 'aspetto': r.get('Aspetto normale'), 'via_libera': r.get('Via libera quando'),
                        'comando': r.get('Chi lo comanda'), 'note': r.get('Note')}

itinerari = {}
for r in rows('Itinerari'):
    if not r.get('ID'): continue
    itinerari[r['ID']] = {'quando': r.get('Quando si usa'), 'priorita': r.get('Priorità'), 'condizioni': r.get('Condizioni in più'), 'note': r.get('Note'),
                          'da': num(r.get('Dal semaforo')), 'a': r.get('Al semaforo')}

precedenze = [r for r in rows('Precedenze') if any(r.get(k) for k in ('Situazione', 'Dove (gruppo o semafori)', 'Se... (chi chiede cosa)', 'Allora... (decisione)'))]
chiusure = [r for r in rows('Chiusure') if r.get('CHIUSURA')]
situazioni = [r['Situazione'] for r in rows('Situazioni') if r.get('Situazione') and r.get('Che cosa vuol dire')]
pannello = [r for r in rows('Pannello PC') if r.get('Comando o informazione')] if 'Pannello PC' in wb.sheetnames else []
guasti = [r for r in rows('Guasti') if r.get('Guasto') and r.get('N.') is not None] if 'Guasti' in wb.sheetnames else []

out = {'_about': 'Regole dell\'interlocking M3 scritte da Giovanni in data/Regole_interlocking_M3.xlsx, lette da tools/rules_from_excel.py. Non modificare a mano: si cambia il file Excel e si rilancia lo script.',
       'tempi': tempi, 'semafori': semafori, 'itinerari': itinerari, 'precedenze': precedenze, 'chiusure': chiusure, 'situazioni': situazioni, 'pannello_pc': pannello, 'guasti': guasti}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1, default=str)
# the radio phrases (sheet Radio): code -> { chi, quando, testi } -> data/radio_m3.json (the build puts them in net.radio)
if 'Radio' in wb.sheetnames:
    frasi = {}
    for r in rows('Radio'):
        c = r.get('Codice')
        if not c: continue
        testi = [r.get(h) for h in ('Testo', 'Variante 2', 'Variante 3', 'Variante 4', 'Variante 5')]
        testi = [str(x) for x in testi if x not in (None, '')]
        if testi: frasi[c] = {'chi': r.get('Chi parla'), 'quando': r.get('Quando si dice'), 'testi': testi}
    RADIO = os.path.join(os.path.dirname(OUT), 'radio_m3.json')
    json.dump({'_about': 'Le frasi della radio, dal foglio Radio di data/Regole_interlocking_M3.xlsx (tools/rules_from_excel.py). Non modificare a mano: si cambia il foglio e si rilancia lo script. {T} e {R}: i numeri del treno e del treno di soccorso.', 'frasi': frasi},
              open(RADIO, 'w'), ensure_ascii=False, indent=1)
    print('radio: %d frasi -> %s' % (len(frasi), os.path.relpath(RADIO, ROOT)))
print('regole: %d tempi, %d semafori, %d itinerari, %d precedenze, %d chiusure, %d righe del pannello PC -> %s' % (len(tempi), len(semafori), len(itinerari), len(precedenze), len(chiusure), len(pannello), os.path.relpath(OUT, ROOT)))
