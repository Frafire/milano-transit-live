"""M2: link the timetable runs into trains (turni), a first proposal (Giovanni, 3 Nov 2026).

A run that arrives at a terminus is linked to the next run leaving the same terminus if the departure comes less than
"turni_link_max_min" minutes after the arrival (data/operations_m2.json, default 4) and not before
"turni_link_min_min" (default 0: any departure counts, also one in the same minute); the train turns there. A run that cannot be linked goes to the depot; a run with nothing before it comes out of the depot. Which depot
is not decided here (Gorgonzola, Cologno Nord, Famagosta: the rules come with the depots).

Ambiguous cases are listed, not solved: an arrival with more than one departure in the window towards different
destinations (which branch?), and a departure that more than one arrival could take (who turns first?). The rule
then takes the first in time.

Run from a build folder with the M2 timetable (data.json from build_data.py): python3 ../tools/turni_m2.py
Writes m2_turni.json and prints a summary."""
import json, os, collections

D = json.load(open('data.json'))
OPS = {'turni_link_max_min': 4, 'turni_link_min_min': 0}
for f in ('operations_m2.json',):
    if os.path.exists(f):
        OPS.update({k: v for k, v in json.load(open(f)).items() if not k.startswith('_')})
LIM = OPS['turni_link_max_min'] * 60
LMIN = OPS['turni_link_min_min'] * 60
DAY0 = 3 * 3600                       # the service day runs 03:00 -> 02:59, as the page counts it

ri = [i for i, r in enumerate(D['routes']) if r['id'] == 'M2']
assert ri, 'no M2 in data.json'
ri = ri[0]

runs = []
for k, t in enumerate(D['trips']):
    if t[0] != ri: continue
    ts, a = [], 0
    for x in t[3]: a += x; ts.append(a)
    if ts[0] < DAY0: ts = [x + 86400 for x in ts]
    ss = [s for s in t[5] if s >= 0]
    runs.append({'k': k, 'dep': ts[0], 'arr': ts[-1], 'from': D['stops'][ss[0]][0].upper(), 'to': D['stops'][ss[-1]][0].upper(),
                 'head': D['heads'][t[2]]})
runs.sort(key=lambda r: r['dep'])
for i, r in enumerate(runs): r['i'] = i

fmt = lambda s: '%02d:%02d' % ((s // 3600) % 24, s // 60 % 60)
deps = collections.defaultdict(list)
for r in runs: deps[r['from']].append(r)

nxt, prv, amb = {}, {}, []
gaps = []                              # for every arrival, minutes to the first departure from the same terminus
for r in sorted(runs, key=lambda r: r['arr']):
    later = [d for d in deps[r['to']] if d['dep'] >= r['arr']]
    if later: gaps.append((later[0]['dep'] - r['arr']) / 60)
    cand = [d for d in later if LMIN <= d['dep'] - r['arr'] < LIM and d['i'] not in prv]
    if not cand: continue
    if len({d['to'] for d in cand}) > 1:
        amb.append({'kind': 'ramo', 'at': r['to'], 'arr': fmt(r['arr']), 'run': r['i'],
                    'choices': ['%s %s' % (fmt(d['dep']), d['to']) for d in cand]})
    d = cand[0]
    nxt[r['i']] = d['i']; prv[d['i']] = r['i']
# departures that another arrival could also have taken (two trains for one departure)
for d_i, a_i in prv.items():
    d = runs[d_i]
    rivals = [r for r in runs if r['to'] == d['from'] and r['i'] != a_i and LMIN <= d['dep'] - r['arr'] < LIM and r['i'] not in nxt]
    if rivals:
        amb.append({'kind': 'due treni', 'at': d['from'], 'dep': fmt(d['dep']), 'run': d_i,
                    'arrivals': ['%s da %s' % (fmt(runs[a_i]['arr']), runs[a_i]['from'])] + ['%s da %s' % (fmt(r['arr']), r['from']) for r in rivals]})

turni = []
for r in runs:
    if r['i'] in prv: continue
    chain, i = [], r['i']
    while i is not None:
        chain.append(i); i = nxt.get(i)
    turni.append(chain)
turni.sort(key=lambda c: runs[c[0]]['dep'])

out = {'_about': 'Turni M2, proposta: corse legate allo stesso capolinea se la partenza viene meno di %d min dopo l\'arrivo, '
                 'altrimenti deposito. tools/turni_m2.py' % OPS['turni_link_max_min'],
       'day': D['day'], 'link_max_min': OPS['turni_link_max_min'], 'link_min_min': OPS['turni_link_min_min'],
       'runs': [{k: r[k] for k in ('k', 'dep', 'arr', 'from', 'to')} for r in runs],
       'turni': [{'runs': c, 'out': runs[c[0]]['from'], 'in': runs[c[-1]]['to'], 'dep': runs[c[0]]['dep'], 'arr': runs[c[-1]]['arr']} for c in turni],
       'ambiguous': amb}
json.dump(out, open('m2_turni.json', 'w'), separators=(',', ':'))

# ---- summary ----
print('M2 day %s: %d runs, link if the next departure is %d to %d min after the arrival' % (D['day'], len(runs), OPS['turni_link_min_min'], OPS['turni_link_max_min']))
same = sum(1 for a in nxt if runs[nxt[a]]['dep'] - runs[a]['arr'] < 120)
print('  linked to a departure under 2 min after the arrival (a train cannot turn that fast): %d' % same)
print('  linked turns at a terminus: %d | out of a depot: %d | into a depot: %d' % (len(nxt), len(turni), len(turni)))
lens = collections.Counter(len(c) for c in turni)
print('  runs per train: ' + ', '.join('%d run%s x%d' % (n, '' if n == 1 else 's', lens[n]) for n in sorted(lens)))
busy = 0; ev = sorted([(runs[c[0]]['dep'], 1) for c in turni] + [(runs[c[-1]]['arr'], -1) for c in turni])
cur = 0
for _, x in ev: cur += x; busy = max(busy, cur)
print('  most trains out at the same time: %d' % busy)
hist = collections.Counter(min(int(g), 15) for g in gaps)
print('  minutes from an arrival to the next departure at the same terminus: ' + ' '.join('%s:%d' % (('%d' % m) if m < 15 else '15+', hist[m]) for m in sorted(hist)))
print('  ambiguous: %d (ramo %d, due treni %d)' % (len(amb), sum(a['kind'] == 'ramo' for a in amb), sum(a['kind'] == 'due treni' for a in amb)))
