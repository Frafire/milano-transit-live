"""A bus line as numbered vehicles: trips chained at the two termini, 15 s at every stop.
ROUTE=B130"""
import os, sys, json, collections
sys.path.insert(0, '.')
from dwell import add_dwell
ROUTE = os.environ.get('ROUTE', 'B130')
D = json.load(open('data.json'))
RI = [i for i, r in enumerate(D['routes']) if r['id'] == ROUTE][0]
MIN_LAYOVER = 3 * 60     # bus waits at least this long at a terminus between trips

trips = []
for ti, t in enumerate(D['trips']):
    if t[0] != RI: continue
    ts, a = [], 0
    for x in t[3]: a += x; ts.append(a)
    ds, b = [], 0
    for x in t[4]: b += x; ds.append(b)
    ev, last = [], None
    for tt, s in zip(ts, t[5]):
        if s >= 0: last = s
        ev.append((tt, last))
    dist_of = {}
    for s, d in zip(t[5], ds):
        if s >= 0 and s not in dist_of: dist_of[s] = d
    ev = add_dwell(ev, dwell=15, min_run=20)
    stops = [s for s in t[5] if s >= 0]
    trips.append(dict(ti=ti, shape=t[1], ts=[e[0] for e in ev], ds=[dist_of[e[1]] for e in ev],
                      stops_ev=[e[1] for e in ev], first=D['stops'][stops[0]][0], last=D['stops'][stops[-1]][0], dep=ev[0][0], arr=ev[-1][0], stops=stops))
trips.sort(key=lambda x: x['dep'])

# chain: a bus finishing at a terminus takes the next departure from there after MIN_LAYOVER
def term(name): return name.lower().split('(')[0].strip()[:10]
pool = collections.defaultdict(list); buses = []
arrivals = sorted(trips, key=lambda x: x['arr']); ai = 0
for tr in trips:
    while ai < len(arrivals) and arrivals[ai]['arr'] <= tr['dep'] - MIN_LAYOVER:
        a = arrivals[ai]; pool[term(a['last'])].append((a['arr'], a['bus'])); ai += 1
    here = pool[term(tr['first'])]
    if here: here.sort(); _, k = here.pop(0)
    else: k = len(buses); buses.append([])
    buses[k].append(tr); tr['bus'] = k

ev = sorted([(c[0]['dep'], 1) for c in buses] + [(c[-1]['arr'], -1) for c in buses]); n = m = 0
for _, d in ev: n += d; m = max(m, n)
print(ROUTE, 'trips', len(trips), '| buses needed', len(buses), '| on the road at once (incl. layovers)', m)

shape_ids = sorted({t['shape'] for t in trips}); sidx = {s: i for i, s in enumerate(shape_ids)}
paths = []
for sid in shape_ids:
    sh = D['shapes'][sid]; flat, a, b, pa, pb = [], 0, 0, 0, 0
    for i in range(0, len(sh['p']), 2):
        a += sh['p'][i]; b += sh['p'][i + 1]
        A, B = a * 10, b * 10; flat += [A - pa, B - pb]; pa, pb = A, B     # 1e5 -> 1e6 units
    paths.append({'p': flat, 'd': sh['d']})
segs = [[[sidx[t['shape']], 'service', t['ti'], t['ts'], [round(x, 1) for x in t['ds']]] for t in c] for c in buses]
stop_ids = sorted({s for t in trips for s in t['stops']})
def fix(n):
    for _ in range(3):
        try: m = n.encode('latin1').decode('utf8')
        except Exception: break
        if m == n: break
        n = m
    return n
import csv
CODES = {}
for r in csv.DictReader(open(os.path.join(os.environ.get('GTFS', 'gtfs'), 'stops.txt'), encoding='utf-8-sig')):
    CODES[(round(float(r['stop_lat']), 5), round(float(r['stop_lon']), 5))] = r['stop_code'] or r['stop_id']
# departures from every stop (the stop where a trip ends is not a departure)
HEADS = []; deps = collections.defaultdict(list)
for t in trips:
    h = fix(D['heads'][D['trips'][t['ti']][2]]) if D['trips'][t['ti']][2] is not None else t['last']
    if h not in HEADS: HEADS.append(h)
    last_t = {}
    for tt, s in zip(t['ts'], t['stops_ev']): last_t[s] = tt      # departure = end of the 15 s stop
    for s, tt in last_t.items():
        if s != t['stops'][-1]: deps[s].append((tt, HEADS.index(h)))
stops = []
for s in stop_ids:
    dl = sorted(deps.get(s, [])); a = 0; dt = []
    for tt, _ in dl: dt.append(tt - a); a = tt
    stops.append({'n': fix(D['stops'][s][0]), 'la': D['stops'][s][1], 'lo': D['stops'][s][2],
                  'code': CODES.get((D['stops'][s][1], D['stops'][s][2]), ''), 't': dt, 'h': [x[1] for x in dl]})
json.dump({'line': ROUTE, 'mode': 'bus', 'home': '', 'far': '', 'half': int(os.environ.get('SIZE', 12)) / 2, 'paths': paths, 'trains': segs,
           'where': [], 'tracks': [], 'stops': stops, 'heads': HEADS, 'size': int(os.environ.get('SIZE', 12)), 'display': os.environ.get('DISPLAY') == '1'}, open(ROUTE.lower() + '.json', 'w'), separators=(',', ':'))
print(ROUTE.lower() + '.json written, stops', len(stops))
