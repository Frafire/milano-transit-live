"""Controlla gli itinerari (data/itineraries_m3.json, tutta la linea): i segnali di partenza esistono, i pezzi di binario
e gli scambi sono nel tracciato, nessun movimento passa due volte dallo stesso pezzo. Elenca i movimenti senza segnale."""
import json, sys, os
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
M = json.load(open(os.path.join(B, 'm3.json'))); I = json.load(open(os.path.join(B, 'itineraries_m3.json')))['itineraries']
E = M['net']['edges']
nums = {b['n'] for b in M['blocks'] if b.get('n')} | {b['n'] for b in M['illegal']} | {s['n'] for s in M['net']['signals'] if s.get('n')}
deg = {}
for e in E: deg[e['a']] = deg.get(e['a'], 0) + 1; deg[e['b']] = deg.get(e['b'], 0) + 1
bad, nosig = [], []
for it in I:
    if it['start_signal'] is None: nosig.append(it['id'])
    elif it['start_signal'] not in nums: bad.append('%s: segnale A%s non esiste' % (it['id'], it['start_signal']))
    ks = [k for k, a, b in it['edges']]
    if len(ks) != len(set(ks)): bad.append('%s: passa due volte dallo stesso pezzo' % it['id'])
    for k, a, b in it['edges']:
        if not (0 <= k < len(E)) or {a, b} != {E[k]['a'], E[k]['b']}: bad.append('%s: tratto %s sbagliato' % (it['id'], k))
    for n, a, b in it['switches']:
        if deg.get(n, 0) < 3: bad.append("%s: %s non e' uno scambio" % (it['id'], n))
print('itineraries:', len(I), '| senza segnale di partenza:', len(nosig), nosig, '| problemi', len(bad))
for b in bad: print('  ', b)
sys.exit(1 if bad else 0)
