import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
D=json.load(open('xl_data.json'))
F='Arial'; f=Font(name=F,size=10); fb=Font(name=F,size=10,bold=True); fh=Font(name=F,size=10,bold=True,color='FFFFFF')
blue=Font(name=F,size=10,color='0000FF'); title=Font(name=F,size=14,bold=True)
H=PatternFill('solid',fgColor='1F3A5F'); Y=PatternFill('solid',fgColor='FFF2CC'); G=PatternFill('solid',fgColor='F2F2F2')
thin=Side(style='thin',color='BFBFBF'); B=Border(left=thin,right=thin,top=thin,bottom=thin)
wrap=Alignment(wrap_text=True,vertical='top')
wb=Workbook()

def header(ws,cols,widths,fill_cols):
    for i,(c,w) in enumerate(zip(cols,widths),1):
        x=ws.cell(row=1,column=i,value=c); x.font=fh; x.fill=H; x.alignment=Alignment(wrap_text=True,vertical='center'); x.border=B
        ws.column_dimensions[x.column_letter].width=w
    ws.freeze_panes='A2'; ws.row_dimensions[1].height=32
def style_row(ws,r,n,fill_cols):
    for c in range(1,n+1):
        x=ws.cell(row=r,column=c); x.font=f if c not in fill_cols else blue; x.border=B; x.alignment=wrap
        x.fill=Y if c in fill_cols else G

# ---- Istruzioni
ws=wb.active; ws.title='Istruzioni'
lines=[('Regole dell\'interlocking M3',title),('',f),
 ('Come si compila',fb),
 ('Celle GIALLE: da compilare o correggere (testo blu). Celle GRIGIE: calcolate dal programma dal tracciato, non serve toccarle.',f),
 ('Ogni foglio è una tabella: una riga = una regola. Usa i numeri dei semafori (A13, A285...) e gli ID degli itinerari (SD-12, ROG-3...) come nella tabella degli itinerari.',f),
 ('Le liste a tendina (Quando si usa, Priorità, Chi lo comanda) si possono anche scavalcare scrivendo a mano: il programma legge il testo.',f),('',f),
 ('I fogli',fb),
 ('Tempi: i valori fissi (cambio banco, ago dello scambio, verde prima della partenza, fermo al rosso). Già inseriti quelli che mi hai dato.',f),
 ('Semafori: tutti i semafori. Per ognuno: aspetto normale, quando dà via libera, chi lo comanda. "Itinerari che apre" è calcolato.',f),
 ('Itinerari: i 138 movimenti. Per ognuno: quando si usa (sempre, ritardo, guasto, chiusura, mai...), la priorità e le condizioni in più.',f),
 ('Precedenze: le scelte del cervello, frasi "se... allora..." numerate. Le prime due righe sono ESEMPI da cancellare o correggere.',f),
 ('Chiusure: una riga per ogni tratta che il PC può chiudere dal menù "chiudi tratta". Per ognuna: se succede davvero, cosa succede sul lato San Donato e sul lato Comasina (servizio e dove girano i treni), semafori e scambi bloccati, treni rimasti dentro, e le regole scritte a mano (binari utilizzabili, eccezioni).',f),
 ('Pannello PC: cosa può fare il Posto Centrale e cosa vede (fase B). Le righe in corsivo blu sono una proposta: correggi, completa, cancella quello che non serve, aggiungi in fondo. "Serve? Priorità": alta / media / bassa / non serve. "Nel programma oggi" dice cosa c\'è già.',f),
 ('Guasti: i guasti da simulare (fase D). Per ognuno: come si presenta, cosa fanno il macchinista e il PC, quando diventa soccorso e come si fa, i tempi, quanto spesso succede (Volte al giorno: stima per la simulazione). In corsivo quello completato dal programma: correggi, cancella, aggiungi.',f),
 ('Situazioni: l\'elenco delle situazioni usate nelle tendine. Aggiungine quante vuoi in fondo, compariranno nelle tendine.',f),('',f),
 ('Cosa sa già il programma (non serve scriverlo)',fb),
 ('Dove passa ogni treno, quali scambi usa e in che posizione, quando due movimenti sono frontali o incompatibili, quando uno scambio si libera dietro la coda del treno, 15 km/h sul ramo deviato.',f),
 ('Generato dal tracciato il 30/10/2026 (itinerari: tools/itineraries.py).',Font(name=F,size=9,italic=True,color='808080'))]
for i,(t,ft) in enumerate(lines,1):
    c=ws.cell(row=i,column=1,value=t); c.font=ft; c.alignment=Alignment(wrap_text=True,vertical='top')
ws.column_dimensions['A'].width=120

# ---- Situazioni (lists)
wl=wb.create_sheet('Situazioni')
header(wl,['Situazione','Che cosa vuol dire'],[26,90],[])
sit=[('sempre','in ogni momento del servizio'),('servizio normale','giornata regolare, orario rispettato'),('ritardo','il treno è in ritardo sull\'orario (dire quanto nelle condizioni)'),
     ('guasto treno','un treno guasto da togliere dalla linea'),('guasto binario','un binario o uno scambio non utilizzabile'),('chiusura tratta','una parte della linea chiusa, navetta sul resto'),
     ('chiusura con navetta','lato di una tratta chiusa servito da una navetta'),('binario unico','un solo binario utilizzabile: i treni si alternano nei due sensi'),('chiusura servizio limitato','lato di una tratta chiusa dove la linea continua normale fino alla stazione limite'),
     ('emergenza','emergenza in linea o in stazione (persona sui binari, investimento, incendio): il PC mette a rosso i semafori'),('sera','fine servizio: ricovero nei tronchetti e in deposito'),('mattina','inizio servizio: uscita dai tronchetti e dal deposito'),
     ('notte','linea chiusa al pubblico'),('sciopero','sciopero: servizio ridotto o fasce garantite'),('soccorso','treno guasto che non può muoversi: lo va a prendere il trattorino'),('manovra deposito','movimenti tra deposito e stazione'),('mai','movimento possibile sul tracciato ma non usato')]
for i,(a,b) in enumerate(sit,2):
    wl.cell(row=i,column=1,value=a); wl.cell(row=i,column=2,value=b); style_row(wl,i,2,{1,2})
for i in range(len(sit)+2,len(sit)+22): style_row(wl,i,2,{1,2})
wl.cell(row=len(sit)+22,column=1,value='Aggiungi le tue situazioni nelle righe gialle vuote qui sopra.').font=Font(name=F,size=9,italic=True)
LIST_END=len(sit)+21

# ---- Tempi
wt=wb.create_sheet('Tempi',1)
header(wt,['Voce','Minimo (s)','Massimo (s)','Da dove viene'],[52,14,14,70],[])
rows=[('Cambio banco: togliere il setup alla cabina di testa',25,45,'Giovanni, 30/10/2026'),
      ('Cambio banco: camminare 105 m fino all\'altra cabina',80,80,'Assunto: 105 m a circa 1,3 m/s (passo normale). Da correggere se serve'),
      ('Cambio banco: margine in più sulla camminata',15,15,'Giovanni, 30/10/2026'),
      ('Cambio banco: setup della nuova cabina di guida',30,60,'Giovanni, 30/10/2026'),
      ('Cambio banco: totale',None,None,'Somma delle quattro righe sopra'),
      ('Ago dello scambio: tempo per cambiare posizione',3,4,'Giovanni, 30/10/2026'),
      ('Via libera della partenza prima dell\'orario (semafori tipo e)',30,30,'Regola già in uso (Giovanni)'),
      ('Fermo al rosso: dopo quanto il macchinista chiama il PC',60,120,'Giovanni, 30/10/2026'),
      ('Ritardo di apertura del segnale (la chiusura è istantanea)',None,None,'Da compilare (Giovanni)'),
      ('Distanza minima tra due treni (secondi)',90,90,'Giovanni: minimo della linea'),
      ('Distanza normale tra due treni (secondi)',120,120,'Giovanni: solitamente almeno 120 s'),
      ('Trattorino di soccorso: velocità massima (km/h, non secondi)',25,25,'Giovanni 31/10/2026: stima, da verificare'),
      ('Marcia a vista (km/h, non secondi)',5,5,'Giovanni 31/10/2026: stima, da verificare'),
      ('Accostamento al treno da agganciare (km/h, non secondi)',2,2,'Giovanni 31/10/2026: stima, da verificare')]
for i,(a,mn,mx,src) in enumerate(rows,2):
    wt.cell(row=i,column=1,value=a); wt.cell(row=i,column=2,value=mn); wt.cell(row=i,column=3,value=mx); wt.cell(row=i,column=4,value=src)
    style_row(wt,i,4,{2,3} if mn is not None or i==10 else {2,3})
wt['B6']='=SUM(B2:B5)'; wt['C6']='=SUM(C2:C5)'
for c in ('A6','B6','C6','D6'): wt[c].font=fb; wt[c].fill=G
for i in range(len(rows)+2,len(rows)+8): style_row(wt,i,4,{1,2,3,4})

dv_sit=lambda: DataValidation(type='list',formula1="=Situazioni!$A$2:$A$%d" % LIST_END,allow_blank=True,showErrorMessage=False)

# ---- Semafori
wsg=wb.create_sheet('Semafori',2)
cols=['Semaforo','Tipo','Lato','Ruolo','Dove','Itinerari che apre (calcolato)','Aspetto normale','Via libera quando','Chi lo comanda','Note']
header(wsg,cols,[10,7,10,24,42,30,14,48,16,40],[])
dv_asp=DataValidation(type='list',formula1='"via libera,rosso"',allow_blank=True,showErrorMessage=False)
dv_cmd=DataValidation(type='list',formula1='"automatico,semi-automatico,PC,giocatore,manuale con controllo sezioni"',allow_blank=True,showErrorMessage=False)
wsg.add_data_validation(dv_asp); wsg.add_data_validation(dv_cmd)
r=2
for s in D['signals']:
    asp='via libera' if s['legal'] and s['typ'] in ('a','b','c','d') else 'rosso'
    cmd='semi-automatico' if s['kind']=='manovra (deposito)' or s['n'] in (2,3,4,5) else ('manuale con controllo sezioni' if s['manual'] else 'automatico')
    vals=[s['lab'],s['typ'],'legale' if s['legal'] else 'illegale',s['kind'],s['where'],', '.join(s['opens']),asp,None,cmd,None]
    for c,v in enumerate(vals,1): wsg.cell(row=r,column=c,value=v)
    style_row(wsg,r,10,{7,8,9,10}); r+=1
dv_asp.add('G2:G%d'%(r-1)); dv_cmd.add('I2:I%d'%(r-1))
wsg.auto_filter.ref='A1:J%d'%(r-1)

# ---- Itinerari
wi=wb.create_sheet('Itinerari',3)
cols=['ID','Gruppo di scambi','Dal semaforo','Al semaforo','Da','A','Senso','Velocità','Altre strade','Quando si usa','Priorità','Condizioni in più','Note']
header(wi,cols,[9,34,11,11,34,34,16,10,8,18,10,44,36],[])
dv1=dv_sit(); dv_p=DataValidation(type='list',formula1='"alta,media,bassa"',allow_blank=True,showErrorMessage=False)
wi.add_data_validation(dv1); wi.add_data_validation(dv_p)
r=2
for m in D['moves']:
    vals=[m['id'],m['group'],m['start'],m['end'] or '',m['frm'],m['to'],m['sense'],m['speed'],m['alt'] or None,None,None,None,None]
    for c,v in enumerate(vals,1): wi.cell(row=r,column=c,value=v)
    style_row(wi,r,13,{10,11,12,13}); r+=1
dv1.add('J2:J%d'%(r-1)); dv_p.add('K2:K%d'%(r-1))
wi.auto_filter.ref='A1:M%d'%(r-1)

# ---- Precedenze
wp=wb.create_sheet('Precedenze',4)
cols=['N.','Situazione','Dove (gruppo o semafori)','Se... (chi chiede cosa)','Allora... (decisione)','Perché','Note']
header(wp,cols,[6,18,26,52,52,36,30],[])
dv2=dv_sit(); wp.add_data_validation(dv2)
ex=[(1,'servizio normale','A13 e A379, San Donato','ESEMPIO: arrivano due treni ad A13 e ad A379 nello stesso momento','passa prima quello in orario; l\'altro resta al rosso','il treno in orario non deve prendere ritardo',''),
    (2,'servizio normale','Comasina, A11','ESEMPIO: il tronchetto 1 posizione 1 è occupato','usa il tronchetto 2 posizione 1; se sono pieni tutti e due, il treno aspetta in banchina arrivi','cambio banco sempre in posizione 1','')]
for i,row in enumerate(ex,2):
    for c,v in enumerate(row,1): wp.cell(row=i,column=c,value=v)
    style_row(wp,i,7,set(range(2,8)))
    for c in range(1,8): wp.cell(row=i,column=c).font=Font(name=F,size=10,italic=True,color='0000FF')
for i in range(4,104):
    wp.cell(row=i,column=1,value=i-1); style_row(wp,i,7,set(range(2,8)))
dv2.add('B2:B103')
wc=wb.create_sheet('Chiusure',5)
cols=['CHIUSURA','Succede davvero?','Lato San Donato: servizio e dove girano i treni','Lato Comasina: servizio e dove girano i treni','Semafori rossi fissi e scambi bloccati','Treni rimasti nella tratta (su ordine del PC)','Regole (scritte a mano: binari utilizzabili, eccezioni...)','Nel programma oggi']
header(wc,cols,[34,16,42,42,40,40,60,14],[])
dvR=DataValidation(type='list',formula1='"sì,raramente,mai successo"',allow_blank=True); wc.add_data_validation(dvR)
ST=['San Donato','Rogoredo FS','Porto di Mare','Corvetto','Brenta','Lodi T.I.B.B.','Porta Romana','Crocetta','Missori','Duomo','Montenapoleone','Turati','Repubblica','Centrale FS','Sondrio','Zara','Maciachini','Dergano','Affori Centro','Affori FN','Comasina']
TB=[0,1,5,6,13,14,16,20]
PROG={frozenset(x) for x in [('Rogoredo FS','San Donato'),('Porta Romana','Rogoredo FS'),('Porta Romana','San Donato'),('Centrale FS','Porta Romana'),('Centrale FS','Maciachini'),('Centrale FS','Comasina'),('Comasina','Sondrio'),('Comasina','Maciachini')]}
EX={('San Donato','Rogoredo FS'):[None,
  'nessun servizio. I treni in banchina fanno cambio banco in banchina, gli altri rientrano in deposito. Su ordine del PC i treni in stazione possono andare in deposito o sul tronchino in attesa della riapertura.',
  'servizio a Rogoredo FS. Solo binario 1 o solo binario 2 utilizzabile: navetta fino a Porta Romana.',
  'A14, A45, A349, A379, A13 rossi (San Donato); A310, A290 rossi fissi (Rogoredo). Scambi di San Donato bloccati.',
  'su ordine del PC i treni in galleria possono continuare verso San Donato: tutti i binari: binario libero; solo binario 1: verso il binario 2; solo binario 2: verso il binario 1 o 3.',
  None]}
r=2
for i,x in enumerate(TB):
    for y in TB[i+1:]:
        if x==0 and y==20: continue
        cA,cB=ST[x],ST[y]; ex=list(EX.get((cA,cB),[None]*6))
        if cB=='Comasina' and not ex[2]: ex[2]='nessun servizio (chiusura di fondo). Su ordine del PC i treni in stazione o nel tunnel possono rientrare sui tronchini in attesa della riapertura.'
        vals=['CHIUSURA %s – %s' % (cA,cB)]+ex+['sì' if frozenset((cA,cB)) in PROG else 'non ancora']
        for c,v in enumerate(vals,1): wc.cell(row=r,column=c,value=v)
        style_row(wc,r,8,{2,3,4,5,6,7})
        wc.cell(row=r,column=1).font=Font(name=F,size=12,bold=True)
        for c in range(3,8):
            if ex[c-2]: wc.cell(row=r,column=c).font=Font(name=F,size=10,italic=True,color='0000FF')
        wc.row_dimensions[r].height=60 if ex[1] else 30
        r+=1
vals=['CHIUSURA totale della linea',None,None,None,None,None,None,'non ancora']
for c,v in enumerate(vals,1): wc.cell(row=r,column=c,value=v)
style_row(wc,r,8,{2,3,4,5,6,7}); wc.cell(row=r,column=1).font=Font(name=F,size=12,bold=True); r+=1
dvR.add('B2:B%d' % (r-1))
wc.freeze_panes='B2'

# ---- Pannello PC (Fase B): what the Posto Centrale can do and what it sees. Rows: what the simulator already has
# (from the radio, the closure menu, the depot) and what is missing; Giovanni corrects, completes, adds
wpc=wb.create_sheet('Pannello PC',6)
cols=['N.','Gruppo','Comando o informazione','Cosa fa','Quando si può usare','Cosa vede il PC (prima e dopo)','Serve? Priorità','Nel programma oggi','Note']
header(wpc,cols,[6,20,38,52,32,46,16,16,40],[])
dvG=DataValidation(type='list',formula1='"alta,media,bassa,non serve"',allow_blank=True,showErrorMessage=False); wpc.add_data_validation(dvG)
PC=[
 ('Segnali e itinerari','Via libera a un semaforo comandato dal PC','Il semaforo dà via libera una volta, per il prossimo treno (es. uscite dal deposito, segnali di soccorso)','Su richiesta del macchinista o di sua iniziativa','Semaforo rosso → via libera, poi torna rosso dietro il treno','sì'),
 ('Segnali e itinerari','Autorizzare un movimento fuori dal servizio normale','Autorizza un itinerario della tabella (es. SD-10) che non si usa in servizio normale; vale per un treno','Ritardo, guasto, manovre','Itinerario in attesa di autorizzazione → formato','sì'),
 ('Segnali e itinerari','Formare un itinerario a mano','Da un semaforo a un altro, scegliendo la strada (gli scambi si mettono da soli)',None,'Itinerario illuminato sul quadro, scambi in posizione','no'),
 ('Segnali e itinerari','Annullare un itinerario già formato','Toglie l\'itinerario non ancora impegnato dal treno; il semaforo torna rosso',None,'Itinerario spento, semaforo rosso','no'),
 ('Segnali e itinerari','Semaforo a rosso fisso','Blocca un semaforo al rosso finché il PC non lo libera',None,'Semaforo marcato bloccato','in parte (chiusure)'),
 ('Segnali e itinerari','Comandare uno scambio a mano','Normale / rovescio, solo se libero e senza itinerari sopra',None,'Posizione dello scambio, tempo dell\'ago','no'),
 ('Segnali e itinerari','Bloccare uno scambio (fuori servizio)','Lo scambio resta in una posizione; gli itinerari che lo usano dall\'altra parte non si formano','Guasto scambio','Scambio marcato bloccato','no'),
 ('Deposito','Deposito automatico / manuale','Automatico: i segnali del deposito si aprono da soli. Manuale: li apre il PC','Sempre','Interruttore sul pannello','sì'),
 ('Deposito','Aprire un segnale del deposito (manuale)','Via libera al treno fermo al segnale del deposito','Deposito in manuale','Treno fermo al segnale, chiamata del macchinista dopo 2 e 7 minuti','sì'),
 ('Deposito','Cambiare il posto in deposito di un treno','Il treno che rientra va in un altro binario/posto','Treno in rientro','Posto assegnato prima e dopo','sì'),
 ('Deposito','Mandare un treno all\'anello di prova','Il treno esce dal deposito, fa i giri e rientra; un solo treno sull\'anello alla volta','Treno in deposito','Anello libero / occupato, treno in attesa al #A94','sì'),
 ('Radio al treno','Sosta prolungata in una stazione','Il treno tiene le porte aperte per i minuti indicati, con il motivo','Treno in servizio','Ritardo che si forma, soste ordinate in attesa','sì'),
 ('Radio al treno','Limitazione di velocità','Velocità massima per il treno (km/h) fino a nuovo ordine o fino a una stazione','Sempre','Velocità del treno, limite attivo','sì'),
 ('Radio al treno','Resta fermo / Riparti','Il treno resta in stazione con le porte aperte finché il PC non lo fa ripartire','Treno fermo in stazione','Treno trattenuto','sì'),
 ('Radio al treno','Salta le prossime fermate','Il treno non ferma nelle prossime stazioni (annuncio ai passeggeri)','Ritardo, chiusure','Fermate saltate','sì'),
 ('Radio al treno','Limitazione corsa','Il treno termina a una stazione prima del capolinea e inverte lì','Ritardo, chiusure','Nuovo capolinea della corsa','sì'),
 ('Radio al treno','Prosegui vuoto fino a una stazione','I passeggeri scendono, il treno prosegue vuoto','Chiusure','Treno vuoto, stazione di arrivo','sì'),
 ('Radio al treno','Rientro in deposito','Il treno lascia il servizio e rientra (vuoto)','Sempre','Treno fuori servizio, corse scoperte','sì'),
 ('Radio al treno','Cambio binario o tronchetto all\'arrivo','San Donato: binario 2 o 3; Comasina: tronchetto, o entra al binario 2 e inverte lì','Arrivo al capolinea','Binario/tronchetto assegnato','sì'),
 ('Radio al treno','Messaggio libero e risposte','Il PC scrive al treno; il macchinista risponde. Chiamate del macchinista fermo al rosso','Sempre','Registro della radio','sì'),
 ('Tratte e chiusure','Chiudi tratta','Chiude una tratta scegliendo i binari utilizzabili ai capi (servizio limitato, navetta)','Guasto, intervento, emergenza','Tratta chiusa sul quadro, treni dentro, navetta','sì'),
 ('Tratte e chiusure','Riapri tratta / Torna all\'orario','Riapre la tratta (20 km/h per 2 minuti) e i treni riprendono l\'orario','Tratta chiusa','Treni che tornano in orario','sì'),
 ('Tratte e chiusure','Istruzioni ai treni fermi nella tratta chiusa','Restano fermi, proseguono, tornano indietro o rientrano in deposito','Tratta chiusa','Treni fermi e da quanto','in parte'),
 ('Tratte e chiusure','Scegliere il treno della navetta','Il PC indica quale treno fa la navetta (oggi la sceglie il programma)','Chiusura con un solo binario','Treno navetta','no'),
 ('Servizio e orario','Regolare il distanziamento','Allungare o accorciare le soste per tenere i treni equidistanti (ATO, fase C)','Ritardi','Intervalli tra i treni','no'),
 ('Servizio e orario','Inserire o togliere un treno','Far uscire un treno in più dal deposito o ritirarne uno (orario flessibile, fase E)','Ritardi, guasti, sciopero','Treni in linea, corse scoperte','no'),
 ('Guasti ed emergenze','Treno guasto: soccorso','Soccorso con un altro treno o con il trattorino (fase D)','Guasto treno','Treno guasto, mezzo di soccorso, tratta impegnata','no'),
 ('Guasti ed emergenze','Guasto a scambio o segnale','Segnare il guasto: gli itinerari che lo usano non si formano (fase D)','Guasto binario','Elemento guasto sul quadro','no'),
 ('Guasti ed emergenze','Pulsante rosso: tutti i semafori a rosso','Il PC mette a rosso tutti i semafori (della linea o di una tratta); chi è vicino frena d\'emergenza','Persona sui binari, investimento, emergenze','Semafori rossi, treni fermi','no'),
 ('Guasti ed emergenze','Sciopero / fasce garantite','Servizio ridotto negli orari dello sciopero','Sciopero','Treni in linea','no'),
 ('Cosa vede il PC','Quadro della linea: treni e sezioni occupate','Schema della linea con i binari, le sezioni occupate e il numero del treno',None,None,'in parte (mappa)'),
 ('Cosa vede il PC','Stato di semafori, scambi e itinerari','Colore dei semafori, posizione degli scambi, itinerari formati e in attesa',None,None,'in parte'),
 ('Cosa vede il PC','Ritardo e anticipo dei treni','Per ogni treno: ritardo/anticipo, prossima stazione, corsa',None,None,'sì (pannello M3)'),
 ('Cosa vede il PC','Allarmi','Treno fermo al rosso da troppo, porte, emergenze, guasti: con l\'ora',None,None,'in parte'),
 ('Cosa vede il PC','Registro degli eventi','Ordini dati, risposte, chiusure e riaperture, con l\'ora',None,None,'in parte (radio)'),
 ('Radio alla stazione','Chiamare una stazione','Il PC parla con l\'agente di stazione (tutte le stazioni sono presenziate); messaggio libero e risposta','Sempre','Registro della radio di stazione','no'),
 ('Radio alla stazione','Annuncio ai passeggeri','L\'agente fa l\'annuncio in stazione: ritardo, servizio limitato, tratta chiusa, navetta, treno che non ferma','Ritardi, chiusure, guasti','Annuncio fatto (ora)','no'),
 ('Radio alla stazione','Messaggio sugli schermi di banchina','Al posto degli avvisi normali gli schermi mostrano un testo del PC (es. SERVIZIO LIMITATO A …)','Chiusure, guasti, sciopero','Testo sugli schermi della stazione','no'),
 ('Radio alla stazione','Verifica in banchina','L\'agente controlla e riferisce: porte, passeggero sui binari, oggetto caduto, treno fermo in banchina. L\'esito può essere negativo: per un oggetto 2 volte su 3 non c\'è niente; per una persona, al massimo non c\'è più','Su segnalazione del macchinista o del PC','Risposta dell\'agente (trovato / niente da segnalare), tempo','no'),
 ('Radio alla stazione','Assistenza a un treno','L\'agente va sul treno fermo in stazione (malore, guasto, porte bloccate, evacuazione)','Guasti, emergenze','Agente sul treno, treno trattenuto','no'),
 ('Radio alla stazione','Chiudere o riaprire gli accessi della stazione','Ingressi chiusi: i treni passano senza fermare o fermano solo per scendere','Sovraffollamento, emergenza, chiusura tratta','Stazione chiusa al pubblico','no'),
 ('Radio alla stazione','Chiamate dalla stazione al PC','L\'agente avvisa il PC: persona sui binari, investimento, incendio, sovraffollamento, guasto in stazione','Sempre','Allarme sul pannello con la stazione e il motivo','no'),
 ('Radio manutenzione','Radio Manutenzione di linea (San Donato)','Il PC chiama la centrale di manutenzione di San Donato','Guasti a treni, scambi, segnali','Registro della radio di manutenzione','sì'),
 ('Radio manutenzione','Tecnico a bordo di un treno','Il PC indica il treno: il tecnico sale sempre a San Donato, va con il treno sul tronchetto e verifica tutto durante il cambio banco; poi scende a San Donato o a Rogoredo (e torna con il treno dopo)','Treno che funziona ma chiede di essere riarmato','Tecnico in attesa a San Donato, a bordo, esito','sì'),
]
r=2
for i,(g,cmd,what,when,sees,now) in enumerate(PC,1):
    vals=[i,g,cmd,what,when,sees,None,now,None]
    for c,v in enumerate(vals,1): wpc.cell(row=r,column=c,value=v)
    style_row(wpc,r,9,{3,4,5,6,7,9})
    for c in (4,5,6):
        if vals[c-1]: wpc.cell(row=r,column=c).font=Font(name=F,size=10,italic=True,color='0000FF')
    r+=1
for i in range(r,r+25):
    wpc.cell(row=i,column=1,value=i-1); style_row(wpc,i,9,{2,3,4,5,6,7,9})
dvG.add('G2:G%d'%(r+24)); wpc.auto_filter.ref='A1:I%d'%(r-1)

# ---- Guasti (Fase D): the failures to simulate, what the driver and the PC do, when it becomes a rescue (soccorso).
# The rows: Giovanni's (1 Nov 2026), completed where empty (tools/excel/guasti_base.json: the cells completed by the
# program are in italics); how many times a day each one happens in a realistic day (an estimate, for the simulation)
import os
wg=wb.create_sheet('Guasti',7)
cols=['N.','Tipo','Guasto','Come si presenta (cosa vedono macchinista e PC)','Cosa fa il macchinista (e quanto ci mette)','Cosa fa il PC','Quando diventa soccorso','Come si risolve / soccorso','Tempi (min - max)','Quanto spesso / come si attiva','Volte al giorno (stima)','Nel programma oggi','Note']
header(wg,cols,[6,12,30,40,40,40,30,40,16,24,12,14,36],[])
dvT=DataValidation(type='list',formula1='"treno,linea,stazione,energia,soccorso,sciopero"',allow_blank=True,showErrorMessage=False); wg.add_data_validation(dvT)
GB=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'guasti_base.json')))
FILL={c for c in range(2,14) if c!=12}
r=2
for d in GB:
    for c,h in enumerate(cols,1):
        wg.cell(row=r,column=c,value=d.get(h))
    style_row(wg,r,13,FILL)
    for c,h in enumerate(cols,1):
        if c in FILL and d.get(h) not in (None,''): wg.cell(row=r,column=c).font=Font(name=F,size=10,color='0000FF',italic=h in d.get('_mine',[]))
    wg.cell(row=r,column=11).number_format='0.###'
    r+=1
for i in range(r,r+25):
    wg.cell(row=i,column=1,value=i-1); style_row(wg,i,13,FILL)
dvT.add('B2:B%d'%(r+24)); wg.auto_filter.ref='A1:M%d'%(r-1)
wg.cell(row=r+26,column=3,value='Volte al giorno: quante volte succede in media in una giornata intera su tutta la linea (circa 300 corse). 0,1 = una volta ogni 10 giorni. "conseguenza": succede solo come seguito di un altro guasto.').font=Font(name=F,size=9,italic=True)

# carry over what Giovanni already filled in (python3 mkxl.py his_file.xlsx): rows matched by key, columns by header
import sys, warnings
if len(sys.argv)>1:
    warnings.filterwarnings('ignore')
    import openpyxl
    old=openpyxl.load_workbook(sys.argv[1]); KEYN={'Stazioni limite':3}; n_cp=0
    # cells changed here after his remarks (1 Nov 2026: no emergency button on the M3 platforms): his old text must not come back
    KEEP_NEW={('Pannello PC',29,h) for h in ('Comando o informazione','Cosa fa','Quando si può usare','Cosa vede il PC (prima e dopo)')}|{('Pannello PC',42,'Cosa fa'),('Pannello PC',39,'Cosa fa'),('Pannello PC',39,'Cosa vede il PC (prima e dopo)')}
    for ws in wb:
        if ws.title not in old.sheetnames or ws.title=='Situazioni' or ws.title in os.environ.get('BASE_ONLY','').split(','): continue
        if ws.title=='Istruzioni':      # what he added himself: only cells that are empty here
            for row in old['Istruzioni'].iter_rows():
                for c in row:
                    if c.value is not None and ws[c.coordinate].value is None: ws[c.coordinate].value=c.value; n_cp+=1
            continue
        wo=old[ws.title]; kn=KEYN.get(ws.title,1)
        hn={c.value:c.column for c in ws[1] if c.value}; ho={c.column:c.value for c in wo[1] if c.value}
        rows={tuple(ws.cell(row=r,column=c).value for c in range(1,kn+1)):r for r in range(2,ws.max_row+1)}
        for ro in range(2,wo.max_row+1):
            key=tuple((lambda v: v.strip() if isinstance(v,str) else v)(wo.cell(row=ro,column=c).value) for c in range(1,kn+1))
            if key[0] is None: continue
            if key not in rows:      # a row he added himself (a comment, a new closure): keep it at the bottom
                vals_=[wo.cell(row=ro,column=c).value for c in range(1,wo.max_column+1)]
                if any(v is not None for v in vals_):
                    rr=ws.max_row+2 if not any(ws.cell(row=ws.max_row,column=c).value for c in range(1,3)) or ws.max_row<3 else ws.max_row+1
                    rr=max(rr, ws.max_row+1)
                    for c,v in enumerate(vals_,1):
                        if v is not None: ws.cell(row=rr,column=c,value=v)
                    rows[key]=rr; n_cp+=1
                continue
            for co,h in ho.items():
                v=wo.cell(row=ro,column=co).value
                if v is None or h not in hn or hn[h]<=kn or (ws.title,key[0],h) in KEEP_NEW: continue
                cell=ws.cell(row=rows[key],column=hn[h])
                if cell.value!=v: cell.value=v; n_cp+=1
    print('copiati',n_cp,'valori')
    # closures that never happened: grey
    for r_ in range(2,wc.max_row+1):
        if wc.cell(row=r_,column=2).value=='mai successo':
            for c in range(1,9): wc.cell(row=r_,column=c).font=Font(name=F,size=10,color='999999',bold=(c==1))
# senses fixed in the simulator win over the old file
_it=json.load(open('/home/claude/milano-transit-live/data/itineraries_m3.json'))
_fix={m['id']:m['sense'] for m in (_it['itineraries'] if isinstance(_it,dict) and 'itineraries' in _it else _it) if isinstance(m,dict) and m.get('sense','').startswith('misto')}
for r_ in range(2,wi.max_row+1):
    if wi.cell(row=r_,column=1).value in _fix: wi.cell(row=r_,column=7,value=_fix[wi.cell(row=r_,column=1).value])
wb.save('out/Regole_interlocking_M3.xlsx')
print('ok')
