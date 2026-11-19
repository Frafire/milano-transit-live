"""Write the radio phrases into the Radio sheet of the rules Excel of a line (M3: data/Regole_interlocking_M3.xlsx,
M2: data/Regole_M2.xlsx; tools/radio_excel.py).

The Excel is where the phrases are kept and edited (Giovanni, the M2 driver); data/radio_<linea>.json is made from it
by tools/rules_from_excel.py. This script is for when the code gets new phrases:
  python3 tools/radio_to_excel.py new.json                  into the M3's Excel
  python3 tools/radio_to_excel.py --linea M2 new.json       into the M2's Excel
adds the codes the sheet does not have yet (and creates the sheet the first time), with Linea = that line; what is
already in the sheet is never overwritten. A phrase may carry "linea": "comune". Texts proposed by Claude go in
"proposta" (column PROPOSTA, never read by the game). Codes in the M3's sheet that the code no longer uses get a note.
"""
import json, os, re, sys, glob, warnings
warnings.filterwarnings('ignore')
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import radio_excel
args = sys.argv[1:]; LINEA = 'M3'
if '--linea' in args:
    i = args.index('--linea'); LINEA = args[i + 1].upper(); del args[i:i + 2]
if LINEA not in radio_excel.EXCELS: sys.exit('linea %s: le linee con un Excel delle regole sono %s' % (LINEA, ', '.join(radio_excel.EXCELS)))
XL = radio_excel.EXCELS[LINEA]
new = {}
for f in args:
    j = json.load(open(f)); new.update(j.get('frasi', j))
used = set()
for f in glob.glob(os.path.join(ROOT, 'web', '*.js')) + [os.path.join(ROOT, 'web', 'template.html')]:
    used |= set(re.findall(r"'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'", open(f).read()))

COLS = ['Codice', 'Chi parla', 'Quando si dice', 'Testo', 'Variante 2', 'Variante 3', 'Variante 4', 'Variante 5', 'Note', 'Pesi (%)', 'Linea', 'Chiamata', 'Parte', 'PROPOSTA', 'Stile']
F = 'Arial'; fn = Font(name=F, size=10); fh = Font(name=F, size=10, bold=True, color='FFFFFF'); fb = Font(name=F, size=10, color='0000FF')
H = PatternFill('solid', fgColor='1F3A5F'); Y = PatternFill('solid', fgColor='FFF2CC'); G = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='BFBFBF'); B = Border(left=thin, right=thin, top=thin, bottom=thin); wrap = Alignment(wrap_text=True, vertical='top')

wb = openpyxl.load_workbook(XL)
if 'Radio' not in wb.sheetnames:
    ws = wb.create_sheet('Radio', wb.sheetnames.index('Situazioni') if 'Situazioni' in wb.sheetnames else None)
    for i, (h, w) in enumerate(zip(COLS, [34, 16, 44, 60, 50, 40, 30, 30, 30, 10, 9, 26, 14, 60, 22]), 1):
        c = ws.cell(row=1, column=i, value=h); c.font = fh; c.fill = H; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[c.column_letter].width = w
    ws.freeze_panes = 'B2'
    ist = wb['Istruzioni']; r = ist.max_row + 2
    ist.cell(row=r, column=1, value='Radio: tutte le frasi della radio (macchinisti, DCT, stazioni, manutenzione...). Il codice (colonna grigia) non si cambia: lo usa il programma. Si possono correggere i testi e aggiungere varianti (il programma ne sceglie una a caso). Tra graffe i valori messi dal programma: {stazione}, {segnale}...; {T} e {R} sono il numero del treno e del treno di soccorso: vanno lasciati come sono.').font = fn
    ist.cell(row=r, column=1).alignment = wrap
ws = wb['Radio']
hc = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1) if ws.cell(row=1, column=c).value}
for h in COLS:      # (a sheet made before the columns Linea, Chiamata, Parte, PROPOSTA)
    if h not in hc:
        c = ws.cell(row=1, column=max(hc.values()) + 1, value=h); c.font = fh; c.fill = H; c.border = B; hc[h] = c.column
have = {ws.cell(row=r, column=1).value: r for r in range(2, ws.max_row + 1) if ws.cell(row=r, column=1).value}
added = 0
for code in sorted(new):
    if code in have: continue
    e = new[code]; r = ws.max_row + 1 if ws.max_row > 1 or ws.cell(row=2, column=1).value else 2
    vals = dict(zip(['Codice', 'Chi parla', 'Quando si dice', 'Testo', 'Variante 2', 'Variante 3', 'Variante 4', 'Variante 5'],
                    [code, e.get('chi'), e.get('quando')] + (list(e.get('testi') or []) + [None] * 5)[:5]))
    vals.update({'Linea': e.get('linea') or LINEA, 'Chiamata': e.get('chiamata'), 'Parte': e.get('parte'), 'PROPOSTA': e.get('proposta'), 'Stile': ', '.join(e.get('stili') or []) or None})
    for h, c in hc.items():
        x = ws.cell(row=r, column=c, value=vals.get(h)); x.font = fn if h == 'Codice' else fb; x.border = B; x.alignment = wrap; x.fill = G if h == 'Codice' else Y
    have[code] = r; added += 1
gone = 0
for code, r in have.items():
    if LINEA == 'M3' and code not in used and used:      # (the M3's code: the other lines have no radio code yet)
        ws.cell(row=r, column=hc['Note'], value='non più usata dal programma'); gone += 1
ws.auto_filter.ref = 'A1:%s%d' % (openpyxl.utils.get_column_letter(max(hc.values())), ws.max_row)
wb.save(XL)
print('foglio Radio %s: %d frasi, %d aggiunte, %d non più usate' % (LINEA, len(have), added, gone))
