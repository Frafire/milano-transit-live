"""Controlla gli itinerari (data/itineraries_m3.json): ogni segnale di partenza esiste, i pezzi di binario e gli scambi
sono nel tracciato, e chi va contromano parte da un segnale dopo aver invertito la cabina (reverse_at)."""
import json, sys, os
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
M = json.load(open(os.path.join(B, 'm3.json'))); I = json.load(open(os.path.join(B, 'itineraries_m3.json')))['itineraries']
E = M['net']['edges']
nums = {b['n'] for b in M['blocks'] if b.get('n')} | {b['n'] for b in M['illegal']} | {s['n'] for s in M['net']['signals'] if s.get('n')}
deg = {}
for e in E: deg[e['a']] = deg.get(e['a'], 0) + 1; deg[e['b']] = deg.get(e['b'], 0) + 1
bad = []
for it in I:
    if it['start_signal'] not in nums: bad.append('%s: segnale A%s non esiste' % (it['id'], it['start_signal']))
    for k, a, b in it['edges']:
        if isinstance(k, int) and not (0 <= k < len(E)): bad.append('%s: tratto %s non esiste' % (it['id'], k))
    for n, a, b in it['switches']:
        if deg.get(n, 0) < 3 and not isinstance(n, str): bad.append('%s: %s non e\' uno scambio' % (it['id'], n))
    if not it['legal'] and not it['reverse_at'] and not it['no_reverse']: bad.append('%s: contromano senza cambio banco' % it['id'])
print('itineraries:', len(I), '| contromano', sum(1 for i in I if not i['legal']), '| problemi', len(bad))
for b in bad: print('  ', b)
sys.exit(1 if bad else 0)
