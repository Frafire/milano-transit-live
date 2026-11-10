"""Le tabelle (i turni dei treni) di un orario storico M3 come le fa la build, in un Excel da controllare (Giovanni 10 Nov
2026: "quando mi stampi le varie tabelle vediamo"). Si legge build_storico/<nome>_<1|6|7>/ (m3.json, data.json, m3.log),
quindi va lanciato dopo ./build.sh.

Per ogni tipo di giorno due fogli: il riepilogo (una riga per tabella: il treno che la fa, quando esce dal deposito e
quando rientra, quante corse) e le corse (una riga per corsa: da dove e quando parte, dove e quando arriva). Una tabella o
un pezzo di tabella senza un treno vero della flotta di quell'anno (tools/fleet_m3.py, FLOTTA) è in rosso: SCOPERTA.

    python3 tools/storico_tabelle.py <nome>      # expo2015 | milanocortina2026  -> data/storico/m3_<nome>_tabelle.xlsx
"""
import json, os, re, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
nome = sys.argv[1] if len(sys.argv) > 1 else 'expo2015'
OUT = os.path.join(ROOT, 'data', 'storico', 'm3_%s_tabelle.xlsx' % nome)
GIORNI = [('1', 'Feriale'), ('6', 'Sabato'), ('7', 'Festivo')]
F = 'Arial'
f_head = Font(name=F, bold=True, color='FFFFFF', size=10); fill_head = PatternFill('solid', fgColor='1F3A5F')
f_txt = Font(name=F, size=10); f_bold = Font(name=F, bold=True, size=10)
f_red = Font(name=F, bold=True, color='C00000', size=10); fill_red = PatternFill('solid', fgColor='F8CBAD')
INF = 10 ** 6


def hm(s):
    s = int(round(s)); return '%02d:%02d' % (s // 3600, s // 60 % 60)


def head(ws, cols, widths):
    ws.append(cols)
    for c in ws[1]: c.font = f_head; c.fill = fill_head; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[1].height = 30
    for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'


wb = Workbook(); info = wb.active; info.title = 'Leggimi'
notes = []
for n, g in GIORNI:
    B = os.path.join(ROOT, 'build_storico', '%s_%s' % (nome, n))
    if not os.path.exists(os.path.join(B, 'm3.json')): continue
    M = json.load(open(os.path.join(B, 'm3.json'))); D = json.load(open(os.path.join(B, 'data.json')))
    log = open(os.path.join(B, 'm3.log')).read()
    stops = [s[0] for s in D['stops']]
    stock = M['stock']
    units = lambda i: 'SCOPERTA' if i is None or i < 0 else stock[i]['units'] + ('  (' + stock[i]['type'] + ')' if 'SOCIMI' in stock[i]['type'] else '')
    rows, runs = [], []
    for k, segs in enumerate(M['trains']):
        sv = [s for s in segs if s[1] == 'service']
        if not sv: continue                                     # (units standing alone, the officina)
        tab = M['tab_no'][k] if k < len(M['tab_no']) else k + 1
        duties = M['duties'][k] if k < len(M['duties']) else []
        def who(t):
            d = next((d for d in duties if d[0] <= t <= d[1]), None) or next((d for d in duties if d[0] > t), None)
            return d[2] if d else None
        out_ = next((s[3][0] for s in segs if s[1] == 'from_depot'), None)
        in_ = next((s[3][-1] for s in reversed(segs) if s[1] == 'to_depot'), None)
        trains_ = []
        for d in duties:
            if d[0] >= INF: continue
            trains_.append('%s (%s-%s)' % (units(d[2]), hm(d[0]), hm(d[1]) if d[1] < INF else 'fine'))
        miss = any(d[2] < 0 for d in duties)
        rows.append([tab, '; '.join(trains_), hm(out_) if out_ is not None else 'notte in linea', hm(sv[0][3][0]), hm(sv[-1][3][-1]),
                     hm(in_) if in_ is not None else 'notte in linea', len(sv), miss])
        for j, s in enumerate(sv, 1):
            tr = D['trips'][s[2]] if 0 <= s[2] < len(D['trips']) else None
            a, b = (stops[tr[5][0]], stops[tr[5][-1]]) if tr else ('?', '?')
            u = who(s[3][0])
            runs.append([tab, j, a, hm(s[3][0]), b, hm(s[3][-1]), units(u), u is None or u < 0])
    rows.sort(key=lambda r: r[0]); runs.sort(key=lambda r: (r[0], r[1]))
    ws = wb.create_sheet('%s riepilogo' % g)
    head(ws, ['Tabella', 'Treno (dalle-alle)', 'Esce dal deposito', 'Prima partenza', 'Ultimo arrivo', 'Rientra in deposito', 'Corse'], [9, 70, 14, 12, 12, 14, 8])
    for r in rows:
        ws.append(r[:7]); i = ws.max_row
        for c in ws[i]: c.font = f_txt; c.alignment = Alignment(horizontal='center')
        ws.cell(i, 2).alignment = Alignment(horizontal='left')
        if r[7]: ws.cell(i, 2).font = f_red; ws.cell(i, 2).fill = fill_red
    wc = wb.create_sheet('%s corse' % g)
    head(wc, ['Tabella', 'Corsa', 'Da', 'Parte', 'A', 'Arriva', 'Treno'], [9, 7, 18, 9, 18, 9, 46])
    for r in runs:
        wc.append(r[:7]); i = wc.max_row
        for c in wc[i]: c.font = f_txt
        if r[7]: wc.cell(i, 7).font = f_red; wc.cell(i, 7).fill = fill_red
    m = re.search(r'trains needed at the busiest moment: (\d+) at (\d\d:\d\d)', log)
    f = re.search(r'real fleet: (\d+) trains \| stretches out of the depot: (\d+) \| not covered by a real train: (\d+)', log)
    notes.append('%s (giornata %s): %d tabelle, %d corse; treni che servono nel momento di punta: %s alle %s; treni della flotta per le tabelle: %s; '
                 'uscite dal deposito %s, senza un treno vero %s' % (g, D.get('day', ''), len(rows), len(runs), m.group(1) if m else '?', m.group(2) if m else '?',
                                                                      f.group(1) if f else '?', f.group(2) if f else '?', f.group(3) if f else '?'))
lines = ['Tabelle dell\'orario storico M3 %s, come le fa la build del gioco' % {'expo2015': 'Expo 2015', 'milanocortina2026': 'Milano Cortina 2026'}.get(nome, nome), '',
         'Le corse vengono dall\'orario ricostruito (data/storico, le corse nelle fasce "ogni" sono PROPOSTA); le tabelle, le uscite e i rientri dal '
         'deposito li calcola la build come per l\'orario di oggi; i treni sono quelli della flotta di quell\'anno (tools/fleet_m3.py).',
         'In rosso: tabella o pezzo di tabella senza un treno vero (SCOPERTA): la flotta non basta in quel momento.', ''] + notes
for i, t in enumerate(lines, 1):
    c = info.cell(i, 1, t); c.font = Font(name=F, bold=True, size=14) if i == 1 else f_txt
info.column_dimensions['A'].width = 160
wb.save(OUT); print('scritto', OUT); print('\n'.join(notes))
