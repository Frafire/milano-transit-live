"""Gli orari ricostruiti di un orario storico M3 in un Excel da leggere e correggere (Giovanni 10 Nov 2026: "stampali in un
excel"). Un foglio per tipo di giorno e senso: una riga per corsa, una colonna per stazione. In nero gli orari del PDF ATM,
in arancione corsivo quelli calcolati (PROPOSTA di Claude): i tempi tra le stazioni sono quelli di oggi (GTFS) e le corse
nella fascia "ogni X'-Y'" sono messe da tools/storico_corse.py.

    python3 tools/storico_excel.py expo2015      # -> data/storico/m3_expo2015_orari.xlsx (Expo: il PDF ha solo i capolinea)
"""
import json, os, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
nome = sys.argv[1] if len(sys.argv) > 1 else 'expo2015'
if nome != 'expo2015': sys.exit('solo expo2015: per gli altri il file delle corse non dice quali orari sono del PDF stazione per stazione')
D = json.load(open(os.path.join(ROOT, 'data', 'storico', 'm3_%s_corse.json' % nome)))
OUT = os.path.join(ROOT, 'data', 'storico', 'm3_%s_orari.xlsx' % nome)

F = 'Arial'
f_head = Font(name=F, bold=True, color='FFFFFF', size=10)
fill_head = PatternFill('solid', fgColor='1F3A5F')
f_pdf = Font(name=F, bold=True, color='000000', size=10)
f_prop = Font(name=F, italic=True, color='C55A11', size=10)
fill_prop = PatternFill('solid', fgColor='FCE4D6')
f_txt = Font(name=F, size=10)
f_title = Font(name=F, bold=True, size=14)
thin = Border(bottom=Side(style='thin', color='D9D9D9'))
GIORNI = {'feriale': 'Feriale', 'sabato': 'Sabato', 'festivo': 'Festivo'}
VERSO = {'SAN DONATO': 'verso San Donato', 'COMASINA': 'verso Comasina'}


def secs(h):
    a, b, c = (int(x) for x in h.split(':'))
    return a * 3600 + b * 60 + c


wb = Workbook()
ws = wb.active; ws.title = 'Leggimi'
lines = [
    ('Orario storico M3 · %s' % {'expo2015': 'Expo 2015', 'milanocortina2026': 'Milano Cortina 2026'}.get(nome, nome), f_title),
    ('', f_txt),
    ('Fonte: %s' % D['fonte'], f_txt),
    ('In vigore: dal %s%s' % (D['dal'], (' al %s' % D['al']) if D.get('al') else ''), f_txt),
    ('Giornate usate per la build: %s' % ', '.join('%s %s' % (g, d) for g, d in D['giorni'].items()), f_txt),
    ('', f_txt),
    ('Come leggere i fogli', Font(name=F, bold=True, size=11)),
    ('Un foglio per tipo di giorno e senso. Una riga per corsa, una colonna per stazione; gli orari dopo mezzanotte sono 24:xx, 25:xx (la giornata cambia alle 3:00).', f_txt),
    ('Nero grassetto = orario del PDF ATM.', f_pdf),
    ('Arancione corsivo su fondo chiaro = orario calcolato: PROPOSTA di Claude, da confermare.', f_prop),
    ('Colonna "Corsa": PDF = la partenza è nel PDF (gli altri orari della corsa sono calcolati); PROPOSTA = corsa messa nella fascia "ogni X\'-Y\'".', f_txt),
    ('I tempi tra le stazioni (foglio Tempi) vengono dal PDF dove il PDF ha le stazioni, altrimenti dall\'orario di oggi (GTFS ATM): PROPOSTA.', f_txt),
    ('Le corse nella fascia "ogni X\'-Y\'" seguono la forma delle frequenze di oggi, riportata dentro il minimo e il massimo del PDF.', f_txt),
]
for i, (t, f) in enumerate(lines, 1):
    c = ws.cell(i, 1, t); c.font = f
ws.cell(10, 1).fill = fill_prop
ws.column_dimensions['A'].width = 150

# the times between the stations, and where they come from
wt = wb.create_sheet('Tempi')
reps = D['rapporto']
wt.append(['Minuti dalla partenza'] + ['%s %s' % (GIORNI[r['giorno']], VERSO[r['verso']]) for r in reps])
fa_row = ['Fascia "ogni"'] + [('%d-%d ogni %d\'-%d\'' % (r['fascia']['dalle'], r['fascia']['alle'], r['fascia']['min'], r['fascia']['max'])) if r.get('fascia') else '-' for r in reps]
st_sd = list(next(r for r in reps if r['verso'] == 'SAN DONATO')['tempi'].keys())
wt.append(fa_row)
for s_ in st_sd:
    row = [s_]
    for r in reps: row.append(round(r['tempi'][s_][0] / 60, 1) if s_ in r['tempi'] else None)
    wt.append(row)
    for k, r in enumerate(reps):
        c = wt.cell(wt.max_row, 2 + k); src = r['tempi'].get(s_, [0, ''])[1]
        c.font = f_pdf if src == 'pdf' else f_prop
        if src != 'pdf': c.fill = fill_prop
        c.number_format = '0.0'; c.alignment = Alignment(horizontal='center')
    wt.cell(wt.max_row, 1).font = f_txt
for c in wt[1]: c.font = f_head; c.fill = fill_head; c.alignment = Alignment(horizontal='center', wrap_text=True)
for c in wt[2]: c.font = f_txt; c.alignment = Alignment(horizontal='center')
wt.row_dimensions[1].height = 30
wt.column_dimensions['A'].width = 22
for k in range(len(reps)): wt.column_dimensions[get_column_letter(2 + k)].width = 16
wt.freeze_panes = 'B3'

tot = {}
for g in GIORNI:
    for v in VERSO:
        runs = [r for r in D['corse'] if r['giorno'] == g and r['verso'] == v]
        if not runs: continue
        rep = next(r for r in D['rapporto'] if r['giorno'] == g and r['verso'] == v)
        st = list(rep['tempi'].keys())
        sh = wb.create_sheet(('%s %s' % (GIORNI[g], VERSO[v]))[:31])
        sh.append(['N.', 'Corsa'] + st)
        for c in sh[1]: c.font = f_head; c.fill = fill_head; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        sh.row_dimensions[1].height = 30
        n_pdf = 0
        for i, r in enumerate(sorted(runs, key=lambda r: secs(r['parte'])), 1):
            prop = r.get('proposta', False)
            sh.append([i, 'PROPOSTA' if prop else 'PDF'] + [secs(h) / 86400 for h in r['orari']])
            row = sh.max_row
            sh.cell(row, 1).font = f_txt
            sh.cell(row, 2).font = f_prop if prop else f_pdf
            if prop: sh.cell(row, 2).fill = fill_prop
            for j in range(len(st)):
                c = sh.cell(row, 3 + j); c.number_format = '[h]:mm:ss'; c.alignment = Alignment(horizontal='center')
                # from the PDF: only the departure from the terminus, when the run is in the PDF (visti: how many stations)
                pdf = not prop and j == 0 and r.get('visti', 0) >= 1
                if pdf: c.font = f_pdf; n_pdf += 1
                else: c.font = f_prop; c.fill = fill_prop
                c.border = thin
        sh.freeze_panes = 'C2'
        sh.column_dimensions['A'].width = 6; sh.column_dimensions['B'].width = 11
        for j in range(len(st)): sh.column_dimensions[get_column_letter(3 + j)].width = 11
        tot[(g, v)] = (len(runs), sum(1 for r in runs if r.get('proposta')), n_pdf)

r = len(lines) + 2
ws.cell(r, 1, 'Corse per foglio').font = Font(name=F, bold=True, size=11)
for (g, v), (n, p, k) in tot.items():
    r += 1
    ws.cell(r, 1, '%s %s: %d corse, %d messe nella fascia (PROPOSTA), %d orari del PDF' % (GIORNI[g], VERSO[v], n, p, k)).font = f_txt
wb.save(OUT)
print('scritto', OUT, '|', ', '.join('%s %s %d' % (g, v[:3], n) for (g, v), (n, p, k) in tot.items()))
