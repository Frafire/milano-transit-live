"""The roadmap (docs/planning/milano-transit-live-roadmap.xlsx and docs/planning/roadmap.md), from the list below.

Edit the list (or the Excel file by hand: Stato and Chi have drop-downs) and run:  python3 tools/roadmap.py
State as of 2 Nov 2026, checked against the code, the rules Excel and the chats.
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'planning', 'milano-transit-live-roadmap.xlsx')
MD = os.path.join(ROOT, 'docs', 'planning', 'roadmap.md')

STATI = ['Fatto', 'In corso', 'Prossimo', 'Pianificato', 'Più avanti', 'Aspetta Giovanni']
CHI = ['Claude', 'Giovanni', 'Entrambi']
FASI = ['0 Fondamenta', '1 M3 giocabile', 'E Orario ibrido e continuità', '2 Calendario', '3 Analisi e punteggio',
        '4 Pagina iniziale', '5 Altre linee metro', '6 Bus', '7 Turni dei macchinisti', '8 Tram', 'Dati da Giovanni']

R = [
    # fase, area, cosa, stato, chi, note
    ('0 Fondamenta', 'Dati', 'Orario ATM (GTFS), giornata di servizio 03:30–02:59', 'Fatto', 'Claude', 'Feriale, sabato e domenica dal feed'),
    ('0 Fondamenta', 'Mappa', 'Satellite, ibrida, OSM e binari; satellite solo sulla Lombardia', 'Fatto', 'Claude', ''),
    ('0 Fondamenta', 'Rete', 'Tutti i mezzi di metro, tram e bus come punti dall\'orario', 'Fatto', 'Claude', 'Tram e bus solo come orario'),
    ('0 Fondamenta', 'M3', 'Tracciato M3 da OpenStreetMap, capolinea, tronchetti, deposito ROD', 'Fatto', 'Entrambi', ''),
    ('0 Fondamenta', 'M1 / M4', 'M1 e M4 sui binari veri, solo orario', 'Fatto', 'Claude', 'Oggi la pagina impacchetta solo la M3'),
    ('0 Fondamenta', 'Bus', 'Linee 130 e 64 con display di fermata', 'Fatto', 'Claude', ''),
    ('0 Fondamenta', 'Editor', 'Editor del tracciato: uso dei binari, semafori, export', 'Fatto', 'Claude', ''),
    ('0 Fondamenta', 'Progetto', 'Repo pubblico GPL-3.0, GitHub Pages, crediti, "non ufficiale, non ATM"', 'Fatto', 'Entrambi', 'frafire.github.io/milano-transit-live'),
    ('0 Fondamenta', 'Progetto', 'Build e test automatici (./build.sh) a ogni modifica', 'Fatto', 'Claude', '123 controlli + 16 scenari della pagina'),

    ('1 M3 giocabile', 'Motore', 'Motore dal vivo nel browser: i treni sono agenti (accelerazione, frenata, ATO)', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'Segnali', 'Tutti i semafori M3, itinerari calcolati dal tracciato (138)', 'Fatto', 'Entrambi', 'Excel delle regole'),
    ('1 M3 giocabile', 'Segnali', 'Interlocking: itinerari della tabella, scambi, tempi, precedenze', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'Segnali', 'Zona di uscita a Comasina binario 2 (comunicazione dei tronchetti libera)', 'Fatto', 'Claude', 'San Donato: circuito in mezzo, niente zona'),
    ('1 M3 giocabile', 'Segnali', 'Precedenza 8: treno dal deposito fermo al #A06 in orario passa prima dei treni dei tronchetti', 'Prossimo', 'Claude', 'Nell\'Excel, non ancora nel codice'),
    ('1 M3 giocabile', 'DCT', 'Pannello DCT provvisorio: scheda del semaforo, allarmi, emergenze', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'DCT', 'Pannello DCT definitivo', 'Aspetta Giovanni', 'Giovanni', 'Disegno di Giovanni'),
    ('1 M3 giocabile', 'Deposito', 'Pannello di controllo del deposito', 'In corso', 'Entrambi', 'Bozza: scheda ROD alla torre di controllo e schema del deposito su sfondo bianco; da decidere con Giovanni'),
    ('1 M3 giocabile', 'Chiusure', 'Chiusura di tratta: 27 tratte, binario unico, navette, riapertura', 'Fatto', 'Entrambi', ''),
    ('1 M3 giocabile', 'Chiusure', 'Chiusura totale della linea', 'Fatto', 'Claude', 'Avviso radio a tutti i treni, si fermano alla prossima stazione e aspettano; Rosso totale nelle Emergenze'),
    ('1 M3 giocabile', 'Deposito', 'Anello: cambio banco davanti ad #A94 (non fino ad #A103), niente fermata dopo #A47; #A98-#A99 anche manuali', 'Fatto', 'Claude', 'Giovanni, 3 nov 2026'),
    ('1 M3 giocabile', 'Chiusure', 'Il DCT sceglie quale treno fa la navetta', 'Pianificato', 'Claude', 'Pannello PC riga 24'),
    ('1 M3 giocabile', 'Chiusure', 'Treni contromano più lenti (30 km/h)', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'Radio', 'Radio al treno, alla stazione, manutenzione di linea', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'Radio', 'Tutte le frasi della radio in un file a parte (foglio Radio dell\'Excel, 306 frasi)', 'Fatto', 'Claude', 'tests/radio_check.js: nessun testo nel codice'),
    ('1 M3 giocabile', 'Radio', 'Easter egg Leo583 in una chiamata rara', 'Pianificato', 'Claude', 'Dopo il file della radio'),
    ('1 M3 giocabile', 'Stazioni', 'Testo del DCT sugli schermi (SERVIZIO LIMITATO, per disposizione della Prefettura)', 'Prossimo', 'Claude', 'Pannello PC riga 38'),
    ('1 M3 giocabile', 'Stazioni', 'Annunci dell\'agente in stazione ai passeggeri', 'Pianificato', 'Claude', 'Pannello PC riga 37'),
    ('1 M3 giocabile', 'Guasti', 'Guasti D1–D5: treno, linea, persone, soccorso, sciopero, Prefettura', 'Fatto', 'Entrambi', '26 righe del foglio Guasti'),
    ('1 M3 giocabile', 'Guasti', 'Riarmo: prima il macchinista da solo, poi il DCT', 'Fatto', 'Claude', ''),
    ('1 M3 giocabile', 'Guasti', 'Badoni visibile sulla mappa durante il soccorso', 'Prossimo', 'Claude', ''),
    ('1 M3 giocabile', 'Comasina', 'Scambio del tronchetto di Comasina modificabile in gioco', 'Prossimo', 'Claude', ''),
    ('1 M3 giocabile', 'Comasina', 'Arrivo diretto al binario 1 con cambio banco (radio)', 'Fatto', 'Claude', 'Come San Donato binario 2'),
    ('1 M3 giocabile', 'Flotta', 'Flotta reale, numero del treno = tabella, matricola nella scheda', 'Fatto', 'Entrambi', ''),
    ('1 M3 giocabile', 'Flotta', 'Hitachi "Galileo" 9201-9202 in prova, ammissione al servizio dall\'admin', 'Fatto', 'Claude', 'I prossimi: una riga in tools/fleet_m3.py'),
    ('1 M3 giocabile', 'Flotta', 'Trazione da potenza e massa, carico per fascia oraria', 'Più avanti', 'Claude', 'Oggi prestazioni per tipo di treno'),
    ('1 M3 giocabile', 'Giorni', 'Sabato e domenica; continuità della linea tra un giorno e l\'altro', 'Fatto', 'Claude', 'Venerdì→sabato ricarica ancora la pagina'),
    ('1 M3 giocabile', 'Grafica', 'Scheda treno, scheda stazione con interscambi, frontali dei treni', 'Fatto', 'Entrambi', ''),

    ('E Orario ibrido e continuità', 'Giorni', 'Cambio giornata senza ricaricare la pagina', 'Fatto', 'Claude', 'Alle 3:00 arriva il giorno dopo, anche se cambia il tipo di giorno (feriale, sabato, festivo)'),
    ('E Orario ibrido e continuità', 'Turni', 'Assegnazione dei turni a inizio giornata (pannello alle 3:30)', 'Fatto', 'Claude', 'Pannello Turni del giorno: un treno per tabella, si cambia finché i treni sono fermi in deposito'),
    ('E Orario ibrido e continuità', 'Turni', 'Le tabelle vanno ai treni fisici dove si trovano', 'Fatto', 'Claude', 'Chi ha finito a Comasina o in deposito riparte da lì; in deposito dallo stesso posto'),
    ('E Orario ibrido e continuità', 'Test', 'Una settimana di fila senza ricaricare', 'Fatto', 'Claude', 'Test della pagina: 7 cambi di giorno di fila'),
    ('E Orario ibrido e continuità', 'Turni', 'Rinumerazione dopo un\'interruzione (nuove tabelle ai treni)', 'Fatto', 'Claude', 'Il DCT lo dice per radio; il treno senza una corsa sua va col numero di matricola'),
    ('E Orario ibrido e continuità', 'Regolatore', 'Regolatore: l\'orario come partenze da coprire', 'Fatto', 'Claude', 'Pannello Regolatore: partenze dei prossimi 60 minuti, chi le fa, quelle scoperte'),
    ('E Orario ibrido e continuità', 'Regolatore', 'Inserire o togliere un treno', 'Fatto', 'Claude', 'Ritira a fine corsa (in deposito: resta lì); una riserva copre la tabella dalla prima partenza da San Donato. Preparazione 10 min: proposta da verificare (foglio Tempi)'),
    ('E Orario ibrido e continuità', 'Guasti', 'Treno guasto in manutenzione almeno 2 giorni (3–4 se grave)', 'Fatto', 'Claude', '2 giorni, 3 con UdT o soccorso, 4 con i Badoni: proposta da verificare. La sua tabella la prende una riserva'),

    ('2 Calendario', 'Dati', 'Festivi, Natale, Capodanno, giorni a servizio ridotto', 'Pianificato', 'Entrambi', 'Dal feed o dai PDF di Giovanni'),
    ('3 Analisi e punteggio', 'Analisi', 'Ogni ritardo con la sua causa', 'Pianificato', 'Claude', ''),
    ('3 Analisi e punteggio', 'Gioco', 'Punteggio: minuti di ritardo e corse perse', 'Pianificato', 'Claude', 'Senza modello dei passeggeri'),
    ('3 Analisi e punteggio', 'Analisi', 'Programmato contro reale, indicatori, confronto di due simulazioni, report', 'Pianificato', 'Claude', ''),
    ('4 Pagina iniziale', 'Gioco', 'Gioca! → scelta del mezzo → linee metro (M1, M2, M3, M4+M5, insieme)', 'Fatto', 'Claude', 'Chat della pagina iniziale; linee non pronte: "in arrivo" (data/linee.json)'),
    ('4 Pagina iniziale', 'Dati', 'Dati divisi per linea e giorno, caricati a richiesta', 'Fatto', 'Claude', 'docs/dati/<linea>_<giorno>.js'),
    ('4 Pagina iniziale', 'Grafica', 'Sfondo del menu (foto) e schema della rete', 'Aspetta Giovanni', 'Giovanni', 'Fonte da confermare (CREDITS.md)'),
    ('5 Altre linee metro', 'M2', 'M2: binari, deposito, segnali (con il macchinista M2)', 'In corso', 'Entrambi', 'Chat a parte'),
    ('5 Altre linee metro', 'M2', 'Raccordo M2–M3 a Repubblica (solo il binario lato Caiazzo), precedenza 22', 'Più avanti', 'Entrambi', ''),
    ('5 Altre linee metro', 'M1', 'M1: depositi, segnali, manovre ai capolinea', 'Più avanti', 'Entrambi', ''),
    ('5 Altre linee metro', 'M4', 'M4: segni dei binari di Linate', 'Aspetta Giovanni', 'Giovanni', ''),
    ('5 Altre linee metro', 'M5', 'M5: binari, deposito, flotta', 'Più avanti', 'Entrambi', ''),
    ('6 Bus', 'Bus', 'Altre linee, traffico, guasti dei bus', 'Più avanti', 'Entrambi', ''),
    ('7 Turni dei macchinisti', 'Personale', 'Turni, pause, cambi, incroci, "manca il macchinista"', 'Più avanti', 'Entrambi', ''),
    ('8 Tram', 'Tram', 'Binari, incroci stradali, depositi', 'Più avanti', 'Entrambi', 'Il lavoro a mano più grande'),

    ('Dati da Giovanni', 'M3', 'Distanziamento all\'ACEI di Comasina (circa 200 s): ricontrollare con la zona di uscita', 'Aspetta Giovanni', 'Giovanni', ''),
    ('Dati da Giovanni', 'M3', 'Uso del tronchino di Centrale', 'Aspetta Giovanni', 'Giovanni', ''),
    ('Dati da Giovanni', 'M3', 'Dettagli di A275 / A277', 'Aspetta Giovanni', 'Giovanni', ''),
    ('Dati da Giovanni', 'M3', 'Orari inventati da correggere', 'Aspetta Giovanni', 'Giovanni', ''),
    ('Dati da Giovanni', 'M3', 'Limiti di velocità della linea (80 km/h confermato solo San Donato–Rogoredo)', 'Aspetta Giovanni', 'Giovanni', ''),
    ('Dati da Giovanni', 'M3', 'Binari X del deposito: solo movimenti, niente sosta', 'Aspetta Giovanni', 'Giovanni', 'Export dall\'editor'),
    ('Dati da Giovanni', 'Flotta', 'Hitachi: prestazioni vere e prossimi numeri', 'Aspetta Giovanni', 'Giovanni', 'Per ora quelle del Meneghino'),
]

F = 'Arial'
fn, fb, fh, ft = Font(name=F, size=10), Font(name=F, size=10, bold=True), Font(name=F, size=10, bold=True, color='FFFFFF'), Font(name=F, size=14, bold=True)
H = PatternFill('solid', fgColor='1F3A5F')
thin = Side(style='thin', color='BFBFBF'); B = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='top')
COL = {'Fatto': 'D9EAD3', 'In corso': 'FFF2CC', 'Prossimo': 'FCE5CD', 'Pianificato': 'DDEBF7', 'Più avanti': 'EFEFEF', 'Aspetta Giovanni': 'F4CCCC'}

wb = Workbook()
ws = wb.active; ws.title = 'Riepilogo'
ws['A1'] = 'Milano Transit Live — avanzamento per fase'; ws['A1'].font = ft
ws['A2'] = 'I conteggi vengono dal foglio Roadmap. Aggiornato al 2 novembre 2026.'; ws['A2'].font = Font(name=F, size=9, italic=True)
heads = ['Fase'] + STATI + ['Totale', '% fatto']
for i, h in enumerate(heads, 1):
    c = ws.cell(row=4, column=i, value=h); c.font = fh; c.fill = H; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
for r, fa in enumerate(FASI + ['Tutte'], 5):
    ws.cell(row=r, column=1, value=fa).font = fb
    for j, s in enumerate(STATI, 2):
        crit = '"*"' if fa == 'Tutte' else '$A%d' % r
        ws.cell(row=r, column=j, value='=COUNTIFS(Roadmap!$B$5:$B$400,%s,Roadmap!$E$5:$E$400,"%s")' % (crit, s))
    n = len(STATI) + 2
    ws.cell(row=r, column=n, value='=COUNTIF(Roadmap!$B$5:$B$400,%s)' % ('"*"' if fa == 'Tutte' else '$A%d' % r))
    ws.cell(row=r, column=n + 1, value='=IF(%s%d=0,0,B%d/%s%d)' % (ws.cell(row=r, column=n).column_letter, r, r, ws.cell(row=r, column=n).column_letter, r)).number_format = '0%'
    for c in range(1, n + 2): ws.cell(row=r, column=c).border = B; ws.cell(row=r, column=c).font = fb if fa == 'Tutte' or c == 1 else fn
ws.column_dimensions['A'].width = 30
for c in 'BCDEFGHI': ws.column_dimensions[c].width = 13

wr = wb.create_sheet('Roadmap')
wr['A1'] = 'Milano Transit Live — roadmap'; wr['A1'].font = ft
wr['A2'] = 'Stato e Chi hanno le tendine. Le righe nuove in fondo; poi: python3 tools/roadmap.py per rigenerare dal codice (oppure si aggiorna la lista in tools/roadmap.py).'
wr['A2'].font = Font(name=F, size=9, italic=True)
cols = ['#', 'Fase', 'Area', 'Cosa', 'Stato', 'Chi', 'Note']
for i, (h, w) in enumerate(zip(cols, [5, 26, 14, 70, 18, 11, 44]), 1):
    c = wr.cell(row=4, column=i, value=h); c.font = fh; c.fill = H; c.border = B
    wr.column_dimensions[c.column_letter].width = w
for k, row in enumerate(R, 1):
    for i, v in enumerate((k,) + row, 1):
        c = wr.cell(row=4 + k, column=i, value=v or None); c.font = fn; c.border = B; c.alignment = wrap
wr.freeze_panes = 'A5'; wr.auto_filter.ref = 'A4:G%d' % (4 + len(R))
for s, col in COL.items():
    wr.conditional_formatting.add('E5:E400', CellIsRule(operator='equal', formula=['"%s"' % s], fill=PatternFill('solid', fgColor=col)))
dv = DataValidation(type='list', formula1='"%s"' % ','.join(STATI), allow_blank=True); dv.add('E5:E400'); wr.add_data_validation(dv)
dc = DataValidation(type='list', formula1='"%s"' % ','.join(CHI), allow_blank=True); dc.add('F5:F400'); wr.add_data_validation(dc)
wl = wb.create_sheet('Liste')
for i, fa in enumerate(FASI, 1): wl.cell(row=i, column=1, value=fa)
df = DataValidation(type='list', formula1='Liste!$A$1:$A$%d' % len(FASI), allow_blank=True); df.add('B5:B400'); wr.add_data_validation(df)
os.makedirs(os.path.dirname(OUT), exist_ok=True); wb.save(OUT)

# the same as text (for the docs and the Project): by phase, what is done in one line, the rest one by one
lines = ['# Milano Transit Live — roadmap', '', 'Aggiornata al 2 novembre 2026. Generata da `tools/roadmap.py` (anche il foglio `milano-transit-live-roadmap.xlsx`).', '']
for fa in FASI:
    rs = [r for r in R if r[0] == fa]
    if not rs: continue
    done = [r for r in rs if r[3] == 'Fatto']
    lines += ['## ' + fa, '']
    if done: lines += ['Fatto: ' + '; '.join(r[2] for r in done) + '.', '']
    for r in rs:
        if r[3] != 'Fatto': lines.append('- **%s** — %s (%s)%s' % (r[3], r[2], r[4], ': ' + r[5] if r[5] else ''))
    lines.append('')
open(MD, 'w').write('\n'.join(lines))
print('roadmap:', len(R), 'righe ->', OUT, 'e', MD)
