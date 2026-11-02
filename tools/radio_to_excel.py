"""Write the radio phrases into the Radio sheet of the rules Excel (data/Regole_interlocking_M3.xlsx).

The Excel is where the phrases are kept and edited (Giovanni); data/radio_m3.json is made from it by
tools/rules_from_excel.py. This script is for when the code gets new phrases: python3 tools/radio_to_excel.py new.json
adds the codes the sheet does not have yet (and creates the sheet the first time); what is already in the sheet is
never overwritten. Codes in the sheet that the code no longer uses get a note.
"""
import json, os, re, sys, glob, warnings
warnings.filterwarnings('ignore')
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XL = os.path.join(ROOT, 'data', 'Regole_interlocking_M3.xlsx')
new = {}
for f in sys.argv[1:]:
    j = json.load(open(f)); new.update(j.get('frasi', j))
used = set()
for f in glob.glob(os.path.join(ROOT, 'web', '*.js')) + [os.path.join(ROOT, 'web', 'template.html')]:
    used |= set(re.findall(r"'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'", open(f).read()))

COLS = ['Codice', 'Chi parla', 'Quando si dice', 'Testo', 'Variante 2', 'Variante 3', 'Variante 4', 'Variante 5', 'Note']
F = 'Arial'; fn = Font(name=F, size=10); fh = Font(name=F, size=10, bold=True, color='FFFFFF'); fb = Font(name=F, size=10, color='0000FF')
H = PatternFill('solid', fgColor='1F3A5F'); Y = PatternFill('solid', fgColor='FFF2CC'); G = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='BFBFBF'); B = Border(left=thin, right=thin, top=thin, bottom=thin); wrap = Alignment(wrap_text=True, vertical='top')

wb = openpyxl.load_workbook(XL)
if 'Radio' not in wb.sheetnames:
    ws = wb.create_sheet('Radio', wb.sheetnames.index('Situazioni') if 'Situazioni' in wb.sheetnames else None)
    for i, (h, w) in enumerate(zip(COLS, [34, 16, 44, 60, 50, 40, 30, 30, 30]), 1):
        c = ws.cell(row=1, column=i, value=h); c.font = fh; c.fill = H; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[c.column_letter].width = w
    ws.freeze_panes = 'B2'
    ist = wb['Istruzioni']; r = ist.max_row + 2
    ist.cell(row=r, column=1, value='Radio: tutte le frasi della radio (macchinisti, DCT, stazioni, manutenzione...). Il codice (colonna grigia) non si cambia: lo usa il programma. Si possono correggere i testi e aggiungere varianti (il programma ne sceglie una a caso). Tra graffe i valori messi dal programma: {stazione}, {segnale}...; {T} e {R} sono il numero del treno e del treno di soccorso: vanno lasciati come sono.').font = fn
    ist.cell(row=r, column=1).alignment = wrap
ws = wb['Radio']
have = {ws.cell(row=r, column=1).value: r for r in range(2, ws.max_row + 1) if ws.cell(row=r, column=1).value}
added = 0
for code in sorted(new):
    if code in have: continue
    e = new[code]; r = ws.max_row + 1 if ws.max_row > 1 or ws.cell(row=2, column=1).value else 2
    vals = [code, e.get('chi'), e.get('quando')] + (list(e.get('testi') or []) + [None] * 5)[:5] + [None]
    for c, v in enumerate(vals, 1):
        x = ws.cell(row=r, column=c, value=v); x.font = fn if c == 1 else fb; x.border = B; x.alignment = wrap; x.fill = G if c == 1 else Y
    have[code] = r; added += 1
gone = 0
for code, r in have.items():
    if code not in used and used:
        ws.cell(row=r, column=9, value='non più usata dal programma'); gone += 1
ws.auto_filter.ref = 'A1:I%d' % ws.max_row
wb.save(XL)
print('foglio Radio: %d frasi, %d aggiunte, %d non più usate' % (len(have), added, gone))
