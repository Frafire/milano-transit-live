"""Itinerari M3 per ogni gruppo di scambi, calcolati dal tracciato (build/m3.json): tutta la linea.

Per ogni gruppo (un incrocio, una doppia comunicazione, i tronchetti...) si cercano tutti i percorsi possibili tra i suoi
binari di accesso, rispettando la geometria degli scambi: un treno passa da un pezzo all'altro solo se i due binari
continuano nella stessa direzione (niente inversioni a U sullo scambio). Un treno inverte solo fermo, in una banchina o in
un tronchetto, davanti a un segnale (cambio banco).

Per ogni movimento: da dove parte e dove arriva, se e' nel senso legale (binario di destra) o contromano, il segnale che lo
apre (l'ultimo segnale prima del primo scambio, rivolto nel senso di marcia), il segnale che il treno trova dopo, gli
scambi con la loro posizione, 15 km/h se usa un deviatoio. Poi la tabella di chi puo' muoversi insieme.
Uso: cd build && python3 ../tools/itineraries.py [out.json] [itineraries_m3.json]"""
import json, sys, math, collections

M = json.load(open('m3.json')); N = M['net']; E = N['edges']; ND = N['nodes']; PE = M['path_edges']
TRAIN = 105.0; ARM = 200.0; HALF = M['half']
KX = 111320 * math.cos(math.radians(45.47)); KY = 110540


def pts(i):
    p = E[i]['p']; la, lo = p[0], p[1]; out = [(la / 1e6, lo / 1e6)]
    for k in range(2, len(p), 2): la += p[k]; lo += p[k + 1]; out.append((la / 1e6, lo / 1e6))
    return out


def xy(q): return ((q[1] - 9.19) * KX, (q[0] - 45.46) * KY)


def tangent(i, at_node):
    """unit direction of travel leaving node at_node along edge i (first ~8 m)"""
    P = [xy(q) for q in pts(i)]
    if E[i]['a'] != at_node: P = P[::-1]
    a = P[0]; b = P[-1]; acc = 0
    for k in range(1, len(P)):
        acc += math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); b = P[k]
        if acc >= 8: break
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
    return dx / L, dy / L


_ADJ = collections.defaultdict(list)
for _i, _e in enumerate(E): _ADJ[_e['a']].append(_i); _ADJ[_e['b']].append(_i)
# nodes with four tracks: a diamond crossing (straight on only) unless listed as two switches back to back
DOUBLE_SWITCH = {117, 118, 155}          # San Donato tronchetti (Giovanni: two switches)


def _ang(a, b, n):
    ax, ay = tangent(a, n); bx, by = tangent(b, n)
    return math.degrees(math.acos(max(-1, min(1, -ax * bx - ay * by))))


def through_ok(e_in, node, e_out):
    """a train arriving at node on e_in may go on along e_out (no U-turn): the tracks continue the same way"""
    g = _ang(e_in, e_out, node)
    if g > 40: return False
    if len(_ADJ[node]) == 4 and node not in DOUBLE_SWITCH:      # diamond: only the straight line through it
        return g <= min(_ang(e_in, j, node) for j in _ADJ[node] if j != e_in) + 0.5
    return True


# ---- legal direction of the main tracks: the direction of the normal service paths (N: pid 2, S: pid 6)
LEGAL = {}
for pid in (2, 6):
    for ei, dr, x0, x1 in PE[pid]['e']:
        if E[ei]['cat'] == 'main': LEGAL.setdefault(ei, (E[ei]['a'], E[ei]['b']) if dr > 0 else (E[ei]['b'], E[ei]['a']))
# San Donato platforms: binario 1 legal towards the tails (arrivals), binari 2 and 3 towards the line (departures)
LEGAL.update({174: (153, 160), 173: (143, 165), 225: (120, 196), 226: (196, 165)})

# ---- every signal on the network: (edge, metres from a, facing +1 a->b / -1 b->a, label)
SIGS = collections.defaultdict(list)


def on_path(pid, d):
    for ei, dr, x0, x1 in PE[pid]['e']:
        if x0 - 0.5 <= d <= x1 + 0.5:
            k = E[ei]['len'] / ((x1 - x0) or 1); off = (d - x0) * k if dr > 0 else (x1 - d) * k
            return ei, off, dr
    return None


for b in M['blocks']:
    if b.get('hidden') or b.get('n') is None: continue
    r = on_path(b['pid'], b['signal_d'])
    if r: SIGS[r[0]].append((r[1], r[2], 'A%d' % b['n'], b.get('stype'), True))
for b in M['illegal']:
    r = on_path(b['pid'], b['d'])
    if r: SIGS[r[0]].append((r[1], -r[2], 'A%d' % b['n'], b.get('stype'), False))
blocks_placed = {b.get('placed') for b in M['blocks'] if b.get('placed')}
for sg in N['signals']:
    if not sg.get('n') or sg.get('kind') not in ('atp', 'shunt') or sg['n'] in blocks_placed: continue
    px, py = xy(sg.get('on_track') or [sg['lat'], sg['lon']]); best = None
    for i in range(len(E)):
        P = [xy(q) for q in pts(i)]; acc = 0
        for k in range(len(P) - 1):
            (ax, ay), (bx, by) = P[k], P[k + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            if L2:
                u = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2)); dd = math.hypot(px - ax - u * dx, py - ay - u * dy)
                if best is None or dd < best[0]:
                    brg = (math.degrees(math.atan2(dx, dy)) + 360) % 360; diff = abs(((brg - (sg.get('heading') or 0)) % 360 + 540) % 360 - 180)
                    best = (dd, i, (acc + u * math.sqrt(L2)), 1 if diff < 90 else -1, acc)
            acc += math.sqrt(L2)
    if best and best[0] < 6:
        geo = sum(math.hypot(b_[0] - a_[0], b_[1] - a_[1]) for a_, b_ in zip([xy(q) for q in pts(best[1])], [xy(q) for q in pts(best[1])][1:])) or 1
        SIGS[best[1]].append((best[2] * E[best[1]]['len'] / geo, best[3], 'A%02d' % sg['n'], sg.get('stype') or ('m' if sg.get('manual') else None), sg.get('legal', True) is not False))

# ---- platforms: from the departure blocks (platform = the 105 m behind the departure signal)
PLAT = []      # (pid, d0, d1, station)
for b in M['blocks']:
    if b['kind'] == 'departure':
        PLAT.append((b['pid'], b['signal_d'] - 2.5 - TRAIN, b['signal_d'] - 2.5, b['name'][2:].split(' → ')[0].title().replace('Fs', 'FS').replace('Fn', 'FN')))
PLAT_EDGE = collections.defaultdict(set)
for pid, d0, d1, nm in PLAT:
    for ei, dr, x0, x1 in PE[pid]['e']:
        if x1 > d0 and x0 < d1: PLAT_EDGE[ei].add(nm)
NAMES = N.get('names', {})
N_EDGES = {x[0] for x in PE[2]['e']}


PLAT_AT = collections.defaultdict(list)          # edge -> [(m from a, m from a, station)]
for pid, d0, d1, nm in PLAT:
    for ei, dr, x0, x1 in PE[pid]['e']:
        if x1 > d0 and x0 < d1:
            k = E[ei]['len'] / ((x1 - x0) or 1); lo, hi = max(d0, x0), min(d1, x1)
            a_, b_ = ((lo - x0) * k, (hi - x0) * k) if dr > 0 else ((x1 - hi) * k, (x1 - lo) * k)
            PLAT_AT[ei].append((a_, b_, nm))


def plat_near(i, node, within=260):
    """the platform on edge i within this distance of node (the switch end)"""
    L = E[i]['len']; best = None
    for a_, b_, nm in PLAT_AT.get(i, []):
        dist = a_ if E[i]['a'] == node else L - b_
        if dist <= within and (best is None or dist < best[0]): best = (dist, nm)
    return best[1] if best else None


EDGE_LABEL = {224: 'banchina Comasina (arrivi)', 116: 'banchina Comasina (partenze)', 166: 'deposito San Donato (ingresso)', 239: 'Brenta tronchetto',
              184: 'Centrale tronchino di ricovero (A33)', 183: 'raccordo verso la M2', 129: 'Repubblica binario di rimessa'}
EXTRA_START = {('SD', 'deposito San Donato (ingresso)', 'San Donato binario 1 (arrivi)'): ('A04', 'davanti ad A04, dopo cambio banco')}
# where the train ends up: the depot is one place, whichever track the train goes in by
SAME_PLACE = {'deposito San Donato (ingresso)': 'deposito San Donato', 'San Donato uscita deposito': 'deposito San Donato'}


def edge_name(i, node=None):
    e = E[i]
    if i in EDGE_LABEL: return EDGE_LABEL[i]
    if str(e['way']) in NAMES: return NAMES[str(e['way'])]
    if node is not None:
        pn = plat_near(i, node)
        if pn: return 'banchina ' + pn + ('' if e['cat'] != 'main' else (' (bin. verso Comasina)' if i in N_EDGES else ' (bin. verso San Donato)'))
    elif PLAT_EDGE.get(i) and len(PLAT_EDGE[i]) == 1: return 'banchina ' + next(iter(PLAT_EDGE[i]))
    if str(e['way']) in NAMES: return NAMES[str(e['way'])]
    if e['cat'] == 'crossover': return 'deviatoio %d' % i
    if e['cat'] == 'main':
        far = None
        if node is not None and PLAT_AT.get(i):
            L = e['len']; far = min(PLAT_AT[i], key=lambda x: (x[0] if e['a'] == node else L - x[1]))[2]
        return 'binario verso %s%s' % ('Comasina' if i in N_EDGES else 'San Donato', ' (lato %s)' % far if far else '')
    return {'link': 'raccordo', 'siding': 'binario di servizio', 'yard': 'deposito'}.get(e['cat'], e['cat']) + ' %d' % i


GROUPS = [   # key, title, track pieces, long access pieces (counted 200 m), pieces where a train stops (platforms, tails)
    ('SD', 'San Donato: gola, tronchetti, deposito', [110, 111, 112, 113, 132, 133, 142, 145, 146, 166, 167, 171, 172, 173, 174, 175, 209, 225, 226, 227, 228, 229, 234, 235, 236], [142, 175, 166], [173, 174, 225, 171, 110, 132]),
    ('ROG', 'Rogoredo FS: incrocio lato San Donato', [127, 141, 142, 175, 176], [141, 142, 175, 176], [141, 176]),
    ('BRE', 'Brenta: tronchetto tra Lodi e Brenta', [139, 140, 141, 237, 239, 241], [139, 141], [239, 141]),
    ('LOD', 'Lodi T.I.B.B.: incrocio lato Brenta', [138, 139, 176, 177, 205], [138, 139, 176, 177], [138, 177]),
    ('PRS', 'Porta Romana: comunicazione singola lato Lodi', [137, 138, 177, 178, 206], [138, 177], [137, 178]),
    ('PRN', 'Porta Romana: doppia comunicazione lato Crocetta', [135, 136, 137, 178, 179, 180, 181, 182, 207, 208], [135, 180], [137, 178]),
    ('REP', 'Repubblica: raccordo M2 e binario di rimessa', [213, 214, 114, 115, 128, 129, 130, 131, 125, 126, 183], [213, 214, 125, 126, 183], [213, 126, 129]),
    ('CEN', 'Centrale FS: doppia comunicazione lato Sondrio e tronchino A33', [123, 124, 125, 194, 195, 196, 197, 214, 215, 216, 217, 184], [123, 125, 214, 217], [214, 125, 184]),
    ('SON', 'Sondrio: comunicazione singola lato Centrale', [122, 123, 185, 217, 218], [122, 123, 217, 218], [218, 122]),
    ('ZS', 'Sondrio lato Zara: doppia comunicazione', [120, 121, 122, 186, 187, 188, 189, 218, 219, 220], [120, 122, 218, 220], [218, 122]),
    ('MCS', 'Maciachini: comunicazione singola lato Zara', [119, 120, 200, 220, 221], [119, 120, 220, 221], [221, 119]),
    ('MCN', 'Maciachini: doppia comunicazione lato Dergano', [117, 118, 119, 198, 199, 201, 202, 221, 222, 223], [117, 119, 221, 223], [221, 119]),
    ('COS', 'Comasina: comunicazione singola prima della stazione', [116, 117, 223, 224, 233], [116, 117, 223, 224], [224, 116]),
    ('CON', 'Comasina: incrocio e tronchini nord', [116, 224, 190, 191, 192, 193, 203, 204, 231, 232], [116, 224], [224, 116, 190, 193]),
]


def group_graph(edges, cap):
    adj = collections.defaultdict(list); L = {}
    for i in edges:
        e = E[i]; L[i] = min(e['len'], ARM) if i in cap else e['len']
        adj[e['a']].append(i); adj[e['b']].append(i)
    return adj, L


def other(i, n): return E[i]['b'] if E[i]['a'] == n else E[i]['a']


def walks(edges, cap, stops):
    """every route through the group. It starts on an access piece (coming in) or in a stop piece (a train standing
    there, either way after a cambio banco), passes at least one switch, and ends on an access piece (going out) or on
    entering a stop piece (it stops there). Continuity is checked at every node (no U-turn on a switch)."""
    adj, L = group_graph(edges, cap)
    deg = {n: len(v) for n, v in adj.items()}
    stops = set(stops)
    access = [i for i in edges if deg[E[i]['a']] == 1 or deg[E[i]['b']] == 1]
    starts = []
    for e0 in access:
        far = E[e0]['a'] if deg[E[e0]['a']] == 1 else E[e0]['b']; starts.append((e0, far, other(e0, far)))
    for e0 in stops:
        if e0 in access: continue
        for n in (E[e0]['a'], E[e0]['b']):
            if deg.get(n, 0) >= 2: starts.append((e0, other(e0, n), n))
    out = []
    for st in starts:
        stack = [[st]]
        while stack:
            route = stack.pop(); k, a, b = route[-1]
            for j in adj[b]:
                if j == k or any(j == x[0] for x in route) or not through_ok(k, b, j): continue
                c = other(j, b); r2 = route + [(j, b, c)]
                if j in stops or deg[c] == 1: out.append(r2)          # stops there / leaves the group
                else: stack.append(r2)
    return [r for r in out if any(deg[b] >= 3 for _, _, b in r[:-1])], L, deg


def legal_of(step):
    k, a, b = step; lg = LEGAL.get(k)
    return None if lg is None else lg == (a, b)


def sig_before(route, deg):
    """the signal that opens the movement: the last one facing the travel before the first switch"""
    found = None; past = None          # past: metres since the first switch (a signal a few metres after it still opens it)
    for n, (k, a, b) in enumerate(route):
        sgs = SIGS.get(k, []); L = E[k]['len']; face = 1 if (a, b) == (E[k]['a'], E[k]['b']) else -1
        c = [(off if face > 0 else L - off, lab, st, lg) for off, f, lab, st, lg in sgs if f == face]
        if past is not None:
            c = [x for x in c if past + x[0] <= 20]
            if c: found = min(c)[1:]
            break
        if c: found = max(c)[1:]
        if deg.get(b, 0) >= 3:
            past = 0
            # a signal standing just past the switch on another branch still protects the whole switch
            if n + 1 < len(route):
                near = []
                for j in _ADJ[b]:
                    if j == k: continue
                    Lj = E[j]['len']; fj = 1 if E[j]['a'] == b else -1
                    near += [(off if fj > 0 else Lj - off, lab, st, lg) for off, f, lab, st, lg in SIGS.get(j, []) if f == fj and (off if fj > 0 else Lj - off) <= 5]
                if near and not [1 for off, f, lab, st, lg in SIGS.get(route[n + 1][0], []) if f == (1 if E[route[n + 1][0]]['a'] == b else -1)]:
                    return min(near)[1:]
    return found


def _facing(k, x, y):
    """signals on piece k facing a train going x -> y: [(metres from x, label, type, legal)]"""
    L = E[k]['len']; face = 1 if (x, y) == (E[k]['a'], E[k]['b']) else -1
    return sorted((off if face > 0 else L - off, lab, st, lg) for off, f, lab, st, lg in SIGS.get(k, []) if f == face)


def _straight_on(k, node, back=False):
    """the piece a train takes after (or, back=True, came from before) piece k at node, going straight where it can"""
    c = [j for j in _ADJ[node] if j != k and through_ok(k, node, j)]
    return min(c, key=lambda j: _ang(k, j, node)) if c else None


def sig_after(step, limit=2500):
    """the first signal the train meets after the movement (it stops in front of it): on the last piece, or further on
    going straight (a platform ends with its departure signal just past the switch, the depot has its own)"""
    k, a, b = step; done = 0
    while k is not None and done < limit:
        c = _facing(k, a, b)
        if c: return c[0][1:]
        done += E[k]['len']; nk = _straight_on(k, b)
        if nk is None: return None
        a, b, k = b, other(nk, b), nk
    return None


def sig_back(step, limit=600):
    """no signal on the way in: the last one the train passed before it, going back along the track"""
    k, a, b = step; done = 0
    while done < limit:
        pk = _straight_on(k, a)
        if pk is None: return None
        x = other(pk, a); c = _facing(pk, x, a)
        if c: return c[-1][1:]
        done += E[pk]['len']; k, a, b = pk, x, a
    return None


def describe(route, deg, stops):
    first, last = route[0], route[-1]
    dev = any(E[k]['cat'] in ('crossover',) or (E[k]['cat'] == 'siding' and E[k]['way'] not in (78, 79, 103)) for k, a, b in route[1:-1]) or \
        any(E[k]['cat'] == 'crossover' for k, a, b in route)
    l0, l1 = legal_of(first), legal_of(last)
    wall = len(_ADJ[last[2]]) == 1 and last[0] != 183     # a tail: the train stops at the buffer, no signal in front of it (183 goes on into the M2)
    s0 = sig_before(route, deg) or sig_back(first); s1 = None if wall else sig_after(last)
    stop_end = wall
    sw = [(b, k, route[n + 1][0]) for n, (k, a, b) in enumerate(route[:-1]) if deg[b] >= 3]
    a_ = l0 if l0 is not None else l1; b_ = l1 if l1 is not None else l0
    sense = 'legale' if a_ is not False and b_ is not False else 'contromano' if a_ is False and b_ is False else 'rientra sul legale' if a_ is False else 'va contromano'
    return dict(sense=sense, steps=route, legal_start=l0, legal_end=l1, start=s0, end=s1, deviata=dev, stops_end=stop_end, switches=sw,
                frm=edge_name(first[0], first[2]), to=edge_name(last[0], last[1]))


def compat(A, B, L):
    ra = {}; cum = 0
    for k, a, b in A['steps']: ra[('E', k)] = cum + L[k]; cum += L[k]
    for n, k, nk in A['switches']: ra.setdefault(('N', n), 0)
    sh = [x for x in [('E', k) for k, a, b in B['steps']] + [('N', n) for n, _, _ in B['switches']] if x in ra]
    if not sh: return ('par', None)
    if A['stops_end'] and ('E', A['steps'][-1][0]) in sh: return ('excl', None)
    return ('seq', round(max(ra[x] for x in sh) + TRAIN))


def run():
    res = {}
    for key, title, edges, cap, stops in GROUPS:
        rs, L, deg = walks(edges, set(cap), stops)
        ms = []
        for r in rs:
            m = describe(r, deg, set(stops))
            # a train arriving the usual way never turns onto the wrong track in a station without first stopping (it would
            # arrive contromano): that is a U-turn on the switch, already excluded by the geometry; what is left is real
            ms.append(m)
        # the same movement by more than one way (two switches back to back at San Donato, two ways into the depot):
        # one line, the shortest way; the others are kept as alternatives
        best = {}
        for m in ms:
            m['to'] = SAME_PLACE.get(m['to'], m['to'])
            m['len'] = sum(L[k] for k, a, b in m['steps'])
            key_ = ((m['start'] or [None])[0], m['frm'], m['to'], m['sense'])
            if key_ not in best: best[key_] = m; m['alt'] = []
            else:
                b_ = best[key_]
                if m['len'] < b_['len']: m['alt'] = b_['alt'] + [b_['steps']]; best[key_] = m
                else: b_['alt'].append(m['steps'])
        ms = list(best.values())
        # a train that went into the depot entry up to A04, changes cab there and comes back (Giovanni: every possibility)
        for (gk, frm_, to_), (lab_, where_) in EXTRA_START.items():
            if gk != key: continue
            for m in list(ms):
                if m['frm'] == frm_ and m['to'] == to_:
                    ms.append(dict(m, start=[lab_, None, True], frm=where_, alt=[]))
        # order: legal first, then by entry
        ms.sort(key=lambda m: (['legale', 'va contromano', 'rientra sul legale', 'contromano'].index(m['sense']), m['frm'], m['to']))
        for n, m in enumerate(ms): m['id'] = '%s-%d' % (key, n + 1)
        mx = {}
        for A in ms:
            for B in ms:
                if A is not B: mx[A['id'] + '>' + B['id']] = compat(A, B, L)
        res[key] = dict(title=title, moves=ms, matrix=mx)
    return res


def fmt_sig(s):
    if not s: return '—'
    lab, st, lg = s
    return lab + (' (%s%s)' % (st, '' if lg else ', illegale') if st else '')


if __name__ == '__main__':
    R = run()
    for key, g in R.items():
        print('\n== %s (%d)' % (g['title'], len(g['moves'])))
        for m in g['moves']:
            sense = m['sense'][:3]
            print('%-7s %s %-44s -> %-44s %-16s -> %-14s %s %s' % (m['id'], sense, m['frm'][:44], m['to'][:44], fmt_sig(m['start']), fmt_sig(m['end']),
                                                         '15km/h' if m['deviata'] else '', ' '.join('%s:%s>%s' % x for x in m['switches'])))
    out = sys.argv[1] if len(sys.argv) > 1 else 'itineraries_all.json'
    json.dump(R, open(out, 'w'), ensure_ascii=False, indent=1, default=str)
    if len(sys.argv) > 2:      # the data the interlocking reads
        num = lambda x: int(x[0][1:]) if x else None
        its = [dict(id=m['id'], group=k, sense=m['sense'], frm=m['frm'], to=m['to'], start_signal=num(m['start']), end_signal=num(m['end']),
                    limit_kmh=15 if m['deviata'] else None, stops_end=m['stops_end'], edges=[list(x) for x in m['steps']], switches=[list(x) for x in m['switches']])
               for k, g in R.items() for m in g['moves']]
        json.dump({'_about': 'Itinerari M3 su tutta la linea, calcolati da tools/itineraries.py dal tracciato: geometria degli scambi (niente inversioni a U), un treno inverte solo fermo in banchina o in tronchetto (cambio banco). start_signal: #A del segnale che apre il movimento (null = manca un segnale). sense: legale, contromano, va contromano (da legale a contromano), rientra sul legale.',
                   'itineraries': its}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
