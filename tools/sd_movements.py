"""San Donato: which train movements can run at the same time (from the track layout, nothing typed in by hand).

A movement is a route of a train through the station: the track pieces it covers and the switches it uses, each
switch with the position it needs (which two tracks it joins). Two movements are
  - parallel:   they share no track piece and no switch -> both may have via libera together
  - in sequence: the second may get via libera as soon as the first has cleared the last thing they share
                 (the train's tail has passed it); the table says after how many metres of the first one's run
  - exclusive:  the first one stops inside what they share (the platform, the tail): wait until it is over
Usage: cd build && python3 ../tools/sd_movements.py [out.json]      (reads m3.json)"""
import json, sys, heapq, collections

M = json.load(open('m3.json')); N = M['net']; E = N['edges']
TRAIN = 105.0
# the station's track pieces (the test loop, the depot and the dead-end stub of node 201 are left out)
ALLOWED = [110, 111, 112, 113, 132, 133, 145, 146, 166, 167, 171, 172, 173, 174, 209, 225, 226, 227, 228, 229, 234, 235, 236]
PSEUDO = {'ARR': ('ARRL', 153, 0.0), 'DEP': ('DEPL', 165, 0.0)}        # the main line beyond the station (arrival / departure)
NAME = {'ARRL': 'linea da Rogoredo (arrivi)', 'DEPL': 'linea verso Rogoredo (partenze)'}
EDGES = {i: (E[i]['a'], E[i]['b'], E[i]['len']) for i in ALLOWED}
EDGES['ARR'] = ('ARRL', 153, 1.0); EDGES['DEP'] = (165, 'DEPL', 1.0)
adj = collections.defaultdict(list)
for k, (a, b, l) in EDGES.items(): adj[a].append((b, k, l)); adj[b].append((a, k, l))
deg = {n: len(v) for n, v in adj.items()}
SWITCH = {n for n, d in deg.items() if d >= 3}

TRACK = {173: 'binario 3 (partenze)', 174: 'binario 1 (arrivi)', 225: 'binario 2 (misto) lato est', 226: 'binario 2 (misto) lato ovest',
         171: 'tronchetto 1', 110: 'tronchetto 2', 166: 'accesso al deposito', 132: 'uscita deposito', 133: 'uscita deposito',
         236: 'comunicazione 153-196'}


def route(waypoints):
    """shortest way through the waypoints on the station graph: [(edge, from, to)]"""
    out = []
    for s, t in zip(waypoints, waypoints[1:]):
        dist = {s: 0}; prev = {}; pq = [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18): continue
            if u == t: break
            for v, k, l in adj[u]:
                if out and out[-1][0] == k and u == s: continue                # no turning round on the spot
                if d + l < dist.get(v, 1e18): dist[v] = d + l; prev[v] = (u, k); heapq.heappush(pq, (d + l, v))
        seg = []; u = t
        while u != s: p, k = prev[u]; seg.append((k, p, u)); u = p
        out += seg[::-1]
    return out


def movement(name, label, wp, start=None, stop=None):
    r = route(wp)
    if start is not None: r = [(start[0], start[1], start[2])] + r
    if stop is not None: r = r + [stop]
    return dict(name=name, label=label, steps=r)


# track ends as a train stands there: the platform edge it stops on
MOVES = [
    movement('ARR1', 'Arrivo sul binario 1', ['ARRL', 153, 160]),
    movement('ARR2', 'Arrivo sul binario 2 (cambio banco, solo ritardi/anomalie)', ['ARRL', 153, 196, 120]),
    movement('DEP', 'Binario 1 -> deposito', [160, 40 if False else 160], start=(174, 153, 160)),
    movement('T1', 'Binario 1 -> tronchetto 1', [160, 163], start=(174, 153, 160)),
    movement('T2', 'Binario 1 -> tronchetto 2', [160, 116], start=(174, 153, 160)),
    movement('T1B3', 'Tronchetto 1 -> binario 3', [163, 143], stop=(173, 143, 165)),
    movement('T1B2', 'Tronchetto 1 -> binario 2', [163, 120], stop=(225, 120, 196)),
    movement('T2B3', 'Tronchetto 2 -> binario 3', [116, 143], stop=(173, 143, 165)),
    movement('T2B2', 'Tronchetto 2 -> binario 2', [116, 120], stop=(225, 120, 196)),
    movement('DB3', 'Deposito -> binario 3 (#A06)', [141, 143], stop=(173, 143, 165)),
    movement('B3O', 'Binario 3 -> linea Rogoredo', [143, 'DEPL'], start=None),
    movement('B2O', 'Binario 2 -> linea Rogoredo', [120, 196, 165, 'DEPL']),
]
# the depot entry runs along its access track (edge 166); patch it in by hand: the route above is only the start
for m in MOVES:
    if m['name'] == 'DEP': m['steps'] = [(174, 153, 160), (166, 160, 40)]
    if m['name'] == 'B3O': m['steps'] = [(173, 143, 165), ('DEP', 165, 'DEPL')]
    if m['name'] == 'B2O': m['steps'] = [(225, 120, 196), (226, 196, 165), ('DEP', 165, 'DEPL')]

for m in MOVES:
    m['through'] = m['name'] in ('B3O', 'B2O')            # these leave the station: they do not stop inside it
    s = m['steps']; cum = 0; res = []; sw = []
    for i, (k, a, b) in enumerate(s):
        L = EDGES[k][2] if k in EDGES else 0
        res.append(('E', k, cum, cum + L)); cum += L
        if i + 1 < len(s) and b in SWITCH:
            nk = s[i + 1][0]; sw.append((b, k, nk)); res.append(('N', b, cum, cum))
    m['res'] = res; m['switches'] = sw; m['len'] = cum


def rid(r): return (r[0], r[1])


def compare(A, B):
    """A runs first, B follows: how soon may B get via libera?"""
    ra = {rid(r): r for r in A['res']}; shared = [rid(r) for r in B['res'] if rid(r) in ra]
    # a switch nobody changes: both pass the same way (same pair of tracks) and only the track pieces count
    if not shared: return ('par', None, None)
    last = A['res'][-1]
    if not A.get('through') and rid(last) in shared:      # A stops there (platform, tail): wait until it is over
        return ('excl', None, [x for x in shared][:3])
    # the stop of A is its last piece; also the first piece of B standing still where A ends
    clear = max(ra[x][3] for x in shared) + TRAIN
    return ('seq', clear, [x for x in shared])


def label(x):
    if x[0] == 'N': return 'scambio %s' % x[1]
    k = x[1]
    return TRACK.get(k) or ('linea ' + ('arrivi' if k == 'ARR' else 'partenze') if k in ('ARR', 'DEP') else 'tratto %s' % k)


if __name__ == '__main__':
    out = {'movements': [], 'matrix': {}}
    for m in MOVES:
        print('%-5s %-55s %5.0f m  switches %s' % (m['name'], m['label'], m['len'], ' '.join('%s:%s>%s' % x for x in m['switches'])))
        out['movements'].append({k: m[k] for k in ('name', 'label', 'len')} | {'switches': m['switches'], 'steps': m['steps']})
    for A in MOVES:
        for B in MOVES:
            if A is B: continue
            kind, d, sh = compare(A, B)
            out['matrix'][A['name'] + '>' + B['name']] = [kind, d, [label(x) for x in (sh or [])]]
    print()
    for A in MOVES:
        print('%-5s' % A['name'], ' '.join('%-7s' % ('.' if A is B else (lambda r: 'par' if r[0] == 'par' else 'EXCL' if r[0] == 'excl' else '%dm' % r[1])(compare(A, B))) for B in MOVES))
    print('       ' + ' '.join('%-7s' % m['name'] for m in MOVES))
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else 'sd_movements.json', 'w'), ensure_ascii=False, indent=1, default=str)
