# Milano Transit Live — roadmap

Aggiornata al 2 novembre 2026. Generata da `tools/roadmap.py` (anche il foglio `milano-transit-live-roadmap.xlsx`).

## 0 Fondamenta

Fatto: Orario ATM (GTFS), giornata di servizio 03:30–02:59; Satellite, ibrida, OSM e binari; satellite solo sulla Lombardia; Tutti i mezzi di metro, tram e bus come punti dall'orario; Tracciato M3 da OpenStreetMap, capolinea, tronchetti, deposito ROD; M1 e M4 sui binari veri, solo orario; Linee 130 e 64 con display di fermata; Editor del tracciato: uso dei binari, semafori, export; Repo pubblico GPL-3.0, GitHub Pages, crediti, "non ufficiale, non ATM"; Build e test automatici (./build.sh) a ogni modifica.


## 1 M3 giocabile

Fatto: Motore dal vivo nel browser: i treni sono agenti (accelerazione, frenata, ATO); Tutti i semafori M3, itinerari calcolati dal tracciato (138); Interlocking: itinerari della tabella, scambi, tempi, precedenze; Zona di uscita a Comasina binario 2 (comunicazione dei tronchetti libera); Pannello DCT provvisorio: scheda del semaforo, allarmi, emergenze; Chiusura di tratta: 27 tratte, binario unico, navette, riapertura; Treni contromano più lenti (30 km/h); Radio al treno, alla stazione, manutenzione di linea; Tutte le frasi della radio in un file a parte (foglio Radio dell'Excel, 306 frasi); Guasti D1–D5: treno, linea, persone, soccorso, sciopero, Prefettura; Riarmo: prima il macchinista da solo, poi il DCT; Arrivo diretto al binario 1 con cambio banco (radio); Flotta reale, numero del treno = tabella, matricola nella scheda; Hitachi "Galileo" 9201-9202 in prova, ammissione al servizio dall'admin; Sabato e domenica; continuità della linea tra un giorno e l'altro; Scheda treno, scheda stazione con interscambi, frontali dei treni.

- **Prossimo** — Precedenza 8: treno dal deposito fermo al #A06 in orario passa prima dei treni dei tronchetti (Claude): Nell'Excel, non ancora nel codice
- **Aspetta Giovanni** — Pannello DCT definitivo (Giovanni): Disegno di Giovanni
- **Aspetta Giovanni** — Pannello di controllo del deposito (Giovanni): Bozza: pannello a parte o vista della mappa
- **Pianificato** — Chiusura totale della linea (Claude)
- **Pianificato** — Il DCT sceglie quale treno fa la navetta (Claude): Pannello PC riga 24
- **Pianificato** — Easter egg Leo583 in una chiamata rara (Claude): Dopo il file della radio
- **Prossimo** — Testo del DCT sugli schermi (SERVIZIO LIMITATO, per disposizione della Prefettura) (Claude): Pannello PC riga 38
- **Pianificato** — Annunci dell'agente in stazione ai passeggeri (Claude): Pannello PC riga 37
- **Prossimo** — Badoni visibile sulla mappa durante il soccorso (Claude)
- **Prossimo** — Scambio del tronchetto di Comasina modificabile in gioco (Claude)
- **Più avanti** — Trazione da potenza e massa, carico per fascia oraria (Claude): Oggi prestazioni per tipo di treno

## E Orario ibrido e continuità

Fatto: Cambio giornata senza ricaricare la pagina; Assegnazione dei turni a inizio giornata (pannello alle 3:30); Le tabelle vanno ai treni fisici dove si trovano; Una settimana di fila senza ricaricare; Rinumerazione dopo un'interruzione (nuove tabelle ai treni); Regolatore: l'orario come partenze da coprire; Inserire o togliere un treno; Treno guasto in manutenzione almeno 2 giorni (3–4 se grave).


## 2 Calendario

- **Pianificato** — Festivi, Natale, Capodanno, giorni a servizio ridotto (Entrambi): Dal feed o dai PDF di Giovanni

## 3 Analisi e punteggio

- **Pianificato** — Ogni ritardo con la sua causa (Claude)
- **Pianificato** — Punteggio: minuti di ritardo e corse perse (Claude): Senza modello dei passeggeri
- **Pianificato** — Programmato contro reale, indicatori, confronto di due simulazioni, report (Claude)

## 4 Pagina iniziale

Fatto: Gioca! → scelta del mezzo → linee metro (M1, M2, M3, M4+M5, insieme); Dati divisi per linea e giorno, caricati a richiesta.

- **Aspetta Giovanni** — Sfondo del menu (foto) e schema della rete (Giovanni): Fonte da confermare (CREDITS.md)

## 5 Altre linee metro

- **In corso** — M2: binari, deposito, segnali (con il macchinista M2) (Entrambi): Chat a parte
- **Più avanti** — Raccordo M2–M3 a Repubblica (solo il binario lato Caiazzo), precedenza 22 (Entrambi)
- **Più avanti** — M1: depositi, segnali, manovre ai capolinea (Entrambi)
- **Aspetta Giovanni** — M4: segni dei binari di Linate (Giovanni)
- **Più avanti** — M5: binari, deposito, flotta (Entrambi)

## 6 Bus

- **Più avanti** — Altre linee, traffico, guasti dei bus (Entrambi)

## 7 Turni dei macchinisti

- **Più avanti** — Turni, pause, cambi, incroci, "manca il macchinista" (Entrambi)

## 8 Tram

- **Più avanti** — Binari, incroci stradali, depositi (Entrambi): Il lavoro a mano più grande

## Dati da Giovanni

- **Aspetta Giovanni** — Distanziamento all'ACEI di Comasina (circa 200 s): ricontrollare con la zona di uscita (Giovanni)
- **Aspetta Giovanni** — Uso del tronchino di Centrale (Giovanni)
- **Aspetta Giovanni** — Dettagli di A275 / A277 (Giovanni)
- **Aspetta Giovanni** — Orari inventati da correggere (Giovanni)
- **Aspetta Giovanni** — Limiti di velocità della linea (80 km/h confermato solo San Donato–Rogoredo) (Giovanni)
- **Aspetta Giovanni** — Binari X del deposito: solo movimenti, niente sosta (Giovanni): Export dall'editor
- **Aspetta Giovanni** — Hitachi: prestazioni vere e prossimi numeri (Giovanni): Per ora quelle del Meneghino
