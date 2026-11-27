"""Giovanni's rules (data/Regole_interlocking_M3.xlsx) -> data/regole_m3.json, what the build reads, and the radio
phrases of the line of the Excel -> data/radio_<linea>.json.

The Excel file is where the rules are written; the json is the same thing in a form the build can read without
Excel libraries. Run after every change to the Excel file:  python3 tools/rules_from_excel.py
(needs openpyxl: pip install openpyxl). Only values are read: colours, comments and formulas are not.

One file of radio phrases per line, never the file of another line (tools/radio_excel.py says which rows go where):
  python3 tools/rules_from_excel.py                         M3: regole_m3.json and radio_m3.json
  python3 tools/rules_from_excel.py data/Regole_M2.xlsx     M2: only radio_m2.json (the other M2 sheets have their tools)
  python3 tools/rules_from_excel.py --linea M2 file.xlsx    the line given, whatever the file name
"""
import json, os, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import radio_excel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]; LINEA = None
if '--linea' in args:
    i = args.index('--linea'); LINEA = args[i + 1].upper(); del args[i:i + 2]
SRC = args[0] if len(args) > 0 else os.path.join(ROOT, 'data', 'Regole_interlocking_M3.xlsx')
LINEA = LINEA or radio_excel.line_of(SRC)
if not LINEA: sys.exit('%s: di che linea è? Usa --linea M3 o --linea M2' % SRC)
if LINEA not in radio_excel.EXCELS: sys.exit('linea %s: le linee con un Excel delle regole sono %s' % (LINEA, ', '.join(radio_excel.EXCELS)))
OUT = args[1] if len(args) > 1 else os.path.join(ROOT, 'data', 'regole_%s.json' % LINEA.lower())
DATA = os.path.dirname(os.path.abspath(OUT))


def radio():
    # the radio phrases of the line (Radio sheets, column Linea) -> data/radio_<linea>.json (the build puts them in net.radio)
    frasi, problems = radio_excel.build(LINEA, dict(radio_excel.EXCELS, **{LINEA: SRC}))
    for p in problems: print('radio, ATTENZIONE:', p)
    out = radio_excel.out_path(LINEA, DATA)
    json.dump(radio_excel.document(LINEA, frasi), open(out, 'w'), ensure_ascii=False, indent=1)
    print('radio %s: %d frasi -> %s' % (LINEA, len(frasi), os.path.relpath(out, ROOT)))


if LINEA != 'M3':
    # the rules below are the M3's sheets: for the other lines only the radio (their sheets are read by their own tools)
    radio(); sys.exit(0)
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
for r in rows('Semafori' if 'Semafori' in wb.sheetnames else 'Segnali'):      # (the M2's sheet: "Segnali", Giovanni 22/11/2026)
    n = num(r.get('Semaforo') or r.get('Segnale'))
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

# the ricoveri of a closure (sheet Ricoveri: the tail of Brenta, Bin rimessa Centrale 2) and the stretches with the two
# tracks side by side (sheet Tratte parallele): read by the game as they are, nothing of them is written in the code
ricoveri = [] if 'Ricoveri' not in wb.sheetnames else [
    {'id': r['ID'], 'nome': r.get('Ricovero'), 'verso': r.get('Verso del treno'), 'scende_a': r.get('Scende tutti a'), 'entra': r.get('Itinerario di entrata'),
     'si_ferma': r.get('Dove si ferma'), 'esce': r.get('Itinerario di uscita'), 'esce_quando': r.get('Può uscire quando'), 'rientro': r.get('Come rientra in servizio'),
     'rientra_a': r.get('Rientra in servizio a'), 'ordine': r.get("Testo dell'ordine al treno"), 'richiamo': r.get('Testo del richiamo (Regolatore)'),
     'non_esce': r.get('Testo se non può uscire'), 'note': r.get('Note')} for r in rows('Ricoveri') if r.get('ID') and r.get('Itinerario di entrata')]
parallele = [] if 'Tratte parallele' not in wb.sheetnames else [
    {'da': r['Da'], 'a': r['A'], 'entrambi': r.get('Persona o oggetto sui binari: entrambi i binari (%)'), 'note': r.get('Note')} for r in rows('Tratte parallele') if r.get('Da') and r.get('A')]

out = {'_about': 'Regole dell\'interlocking M3 scritte da Giovanni in data/Regole_interlocking_M3.xlsx, lette da tools/rules_from_excel.py. Non modificare a mano: si cambia il file Excel e si rilancia lo script.',
       'tempi': tempi, 'semafori': semafori, 'itinerari': itinerari, 'precedenze': precedenze, 'chiusure': chiusure, 'situazioni': situazioni, 'pannello_pc': pannello, 'guasti': guasti,
       'ricoveri': ricoveri, 'tratte_parallele': parallele}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1, default=str)
radio()
print('regole: %d tempi, %d semafori, %d itinerari, %d precedenze, %d chiusure, %d ricoveri, %d tratte parallele, %d righe del pannello PC -> %s' % (len(tempi), len(semafori), len(itinerari), len(precedenze), len(chiusure), len(ricoveri), len(parallele), len(pannello), os.path.relpath(OUT, ROOT)))
