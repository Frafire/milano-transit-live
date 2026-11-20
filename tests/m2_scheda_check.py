"""The M2 line card (data/schede/m2.json + tools/assemble_m2.scheda): every section the menu draws, the 35 stations, every
Tradizionale of Giovanni's list in its group, the Meneghino and Leonardo of the game's fleet, the depots' numbers, the
fronts (drawn in the menu by the game's code). Run from the repo after the M2 build (build_m2/1). Exit code 1 if one fails."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import assemble_m2
S = assemble_m2.scheda(); sec = {s['id']: s for s in S['sezioni']}; bad = 0
def check(ok, what):
    global bad; print(('ok   ' if ok else 'FAIL ') + what); bad += not ok
check(all(k in sec for k in ('breve', 'storia', 'treni', 'sistemi', 'depositi', 'curiosita', 'stazioni')), 'sections of the card')
check(sec['breve']['numeri'][0][0] == '35' and len(sec['stazioni']['tabella']['righe']) == 35, '35 stations (timetable and table)')
G = {g['titolo']: g for g in sec['treni']['gruppi']}
trad = sum(len(g['righe']) for g in G.values() if not g.get('flotta'))
check(trad == 88 and all(r.get('storico') for g in G.values() if not g.get('flotta') for r in g['righe']), 'the 88 Tradizionali of the list, each in its lot (%d)' % trad)
fl = json.load(open(os.path.join(assemble_m2.ROOT, 'data', 'flotta_m2.json')))['treni']
n = {t: sum((g['a'] - g['da'] + 1) // 2 for g in fl if g['tipo'] == t) for t in ('Meneghino', 'Leonardo')}
check(all(len(G[t]['righe']) == n[t] for t in n), 'the Meneghino and Leonardo of the fleet (%s)' % ', '.join('%s %d' % kv for kv in n.items()))
check(all(G[t].get('muso', {}).get('tipo') for t in n) and 'FUORI SERVIZIO' in sec['treni']['destinazioni'], 'fronts of the Meneghino and the Leonardo, the destinations for their signs')
check(all(d.get('numeri') for d in sec['depositi']['lista']), 'tracks of the 3 depots')
sys.exit(1 if bad else 0)
