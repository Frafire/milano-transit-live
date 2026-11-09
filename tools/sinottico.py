"""Tools for the sinottici (the control-room drawings) of the M3: the depot of San Donato and the line.

    cd build && python3 ../tools/sinottico.py deposito      # the depot: keeps the nodes as they are in the file
    cd build && python3 ../tools/sinottico.py linea         # the line: a first drawing, to correct in the editor

Both read m3.json (a build) and write a file in data/ that the page draws (Editor dei binari, tab Sinottico: the nodes and
the bends are moved by hand there and the file exported again). The build never runs this tool, so the hand work stays.

The file: nodes = where each node of the track is in the drawing (px); edges = the track pieces drawn, from node to node;
via = bends of a piece (px, in order from its node a to its node b); part = a piece drawn only in part ([from, to], 0-1
from node a: the pieces where the drawing begins); signals = the piece each signal is on and how far along (0-1);
places = the depot places by node; labels = names written in the drawing.

deposito (Giovanni 9 Nov 2026: "togli la stazione di San Donato, il sinottico del deposito copre dai segnali A04 e A05
in poi tutto il deposito; ho provato a dargli una forma: riesci a tenerla e aggiungere più punti per farla con delle
forme un po' più simili alla realtà e più graziose"): his nodes stay where he put them; the pieces beyond #A04 and #A05
(the station) are left out, the two pieces with those signals drawn from the signal on; a piece whose real track bends
gets bends: its real shape, turned and scaled onto his two nodes (so that its ends stay where he put them).

linea: a first drawing of the line (proposal): the stations in a row, at their distance along the line, track 1 above and
track 2 below, the crossovers and the tails where they are; the depot left out (it has its own).
"""
import json, math, os, sys, collections, cmath

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KX, KY = 111320 * math.cos(math.radians(45.43)), 111320


def load(path='m3.json'):
    d = json.load(open(path)); return d, d['net']


def dec(p):
    """the points of a track piece (lat, lon in millionths, the first absolute then steps) in metres, y to the north"""
    lat, lon, out = p[0], p[1], [(p[0], p[1])]
    for i in range(2, len(p), 2): lat += p[i]; lon += p[i + 1]; out.append((lat, lon))
    return [(b / 1e6 * KX, a / 1e6 * KY) for a, b in out]


def rdp(P, eps):
    """fewer points, the shape kept within eps"""
    if len(P) < 3: return P
    (ax, ay), (bx, by) = P[0], P[-1]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
    i, dm = 0, -1
    for k in range(1, len(P) - 1):
        d_ = abs((P[k][0] - ax) * dy - (P[k][1] - ay) * dx) / L
        if d_ > dm: i, dm = k, d_
    if dm <= eps: return [P[0], P[-1]]
    return rdp(P[:i + 1], eps)[:-1] + rdp(P[i:], eps)


def bends(real, A, B, eps=1.6):
    """the real shape of a piece (metres, y north) turned and scaled so that its ends fall on A and B (px, y down):
    the bends in between, or [] when it is straight enough"""
    z = [complex(x, -y) for x, y in real]                 # (y down, as in the drawing)
    if abs(z[-1] - z[0]) < 1e-6: return []
    s = (complex(*B) - complex(*A)) / (z[-1] - z[0]); t = complex(*A) - s * z[0]
    w = [s * q + t for q in z]
    ch = abs(w[-1] - w[0]) or 1
    dev = max(abs(((q - w[0]) / (w[-1] - w[0])).imag) * ch for q in w)
    if dev < max(3.0, 0.035 * ch): return []
    # (a track that turns right round, as the test loop or a long curve between two nodes put close together: its shape
    # would swell into a balloon; left to the horizontal and 45-degree drawing, to shape by hand)
    if sum(abs(w[i + 1] - w[i]) for i in range(len(w) - 1)) > 1.2 * ch: return []
    P = rdp([(q.real, q.imag) for q in w], eps)
    return [[round(x, 1), round(y, 1)] for x, y in P[1:-1]]


def deposito(m3='m3.json', start=(4, 5)):
    d, net = load(m3); E = net['edges']
    OUT = os.path.join(ROOT, 'data', 'schema_deposito_m3.json'); S = json.load(open(OUT)); N = S['nodes']
    edges = [ei for ei in S['edges']]
    # the pieces with the first signals (#A04, #A05): drawn from the signal on, towards the depot; what lies beyond them
    # (cut off from the depot by those pieces) left out
    sig_e = {sg['e']: sg for sg in S['signals'] if sg['n'] in start}
    adj = collections.defaultdict(list)
    for ei in edges:
        if ei in sig_e: continue
        e = E[ei]; adj[e['a']].append(e['b']); adj[e['b']].append(e['a'])
    # the depot: the part with the rimessa's places in it
    seed = next(int(p['node']) for p in S['places'])
    keep, st = {seed}, [seed]
    while st:
        n = st.pop()
        for m in adj[n]:
            if m not in keep: keep.add(m); st.append(m)
    part = {}
    for ei, sg in sig_e.items():
        e = E[ei]; f = sg['f']
        if e['a'] in keep: part[str(ei)] = [0, round(min(1, f + 0.08), 3)]
        elif e['b'] in keep: part[str(ei)] = [round(max(0, f - 0.08), 3), 1]
    out_e = [ei for ei in edges if ei in sig_e or (E[ei]['a'] in keep and E[ei]['b'] in keep)]
    dropped = sorted(set(edges) - set(out_e))
    # (Giovanni 9 Nov 2026, the Rogoredo board: level lines and 45 degrees, no curves; the bends from the real track only
    # with CURVE=1)
    via = {}
    for ei in (out_e if os.environ.get('CURVE') else []):
        e = E[ei]; A, B = N.get(str(e['a'])), N.get(str(e['b']))
        if not A or not B or str(ei) in part or e.get('cat') == 'test': continue
        v = bends(dec(e['p']), A, B)
        if v: via[str(ei)] = v
    # a switch drawn with all its three pieces going off the same side (Giovanni: "i nodi alcune volte sembrano molto
    # strani"): its trunk (the piece that leaves the other way in the real track) goes out the other side and turns
    # round, with 45-degree corners, to its far node, as the loop on the Rogoredo board
    deg = collections.Counter(n for ei in out_e for n in (E[ei]['a'], E[ei]['b']))
    def tang(ei, n):
        P = dec(E[ei]['p']); a, b = (P[0], P[min(len(P) - 1, 3)]) if E[ei]['a'] == n else (P[-1], P[max(0, len(P) - 4)])
        return math.atan2(b[1] - a[1], b[0] - a[0])
    ang = lambda x, y: min(abs(x - y) % (2 * math.pi), 2 * math.pi - abs(x - y) % (2 * math.pi))
    turned = []
    for n, k in deg.items():
        if k != 3 or str(n) not in N: continue
        eis = [ei for ei in out_e if n in (E[ei]['a'], E[ei]['b']) and str(ei) not in part]
        if len(eis) != 3: continue
        far = lambda ei: E[ei]['b'] if E[ei]['a'] == n else E[ei]['a']
        P = N[str(n)]; xs = [N[str(far(ei))][0] - P[0] for ei in eis]
        if not (all(x > 3 for x in xs) or all(x < -3 for x in xs)): continue
        t = {ei: tang(ei, n) for ei in eis}; tr = max(eis, key=lambda ei: sum(ang(t[ei], t[o]) for o in eis if o != ei))
        Q = N[str(far(tr))]; sx = 1 if xs[0] > 0 else -1; G, R = 16, 10
        up = -1 if Q[1] < P[1] else 1
        x1 = P[0] - sx * G
        v = [[x1, P[1]], [x1 - sx * R, P[1] + up * R], [x1 - sx * R, Q[1] - up * R], [x1, Q[1]]]
        if abs(Q[1] - P[1]) < 2 * R + 2: v = [[x1, P[1]], [x1 - sx * R, P[1] + up * R], [x1, Q[1]]]
        if E[tr]['a'] != n: v = v[::-1]
        via[str(tr)] = v; turned.append((n, tr))
    if turned: print('switches turned round (the trunk out the other side):', turned)
    used = {str(E[ei]['a']) for ei in out_e} | {str(E[ei]['b']) for ei in out_e}
    S['edges'] = out_e; S['nodes'] = {k: v for k, v in N.items() if k in used}; S['via'] = via; S['part'] = part
    # (the signals all stay in the file, the ones of the station too: the San Donato tails' signals are read from here by
    # the agents; the page draws only the ones on the pieces drawn)
    S['places'] = [p for p in S['places'] if str(p['node']) in used]
    S['_about'] = ('Sinottico del deposito di San Donato (Giovanni): nodes = dove sta ogni nodo nel disegno (px, li ha messi lui); '
                   'via = le curve di una tratta (dalla forma vera del binario, girata sui suoi due nodi; si spostano a mano); part = '
                   'le tratte disegnate solo in parte (da #A04 e #A05 in poi: la stazione di San Donato non c\'è). '
                   'tools/sinottico.py deposito le rifà; l\'editor (Sinottico) le corregge e le esporta.')
    json.dump(S, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('sinottico del deposito: %d tratte (%d tolte, la stazione), %d con curve, %d in parte, %d segnali, %d posti'
          % (len(out_e), len(dropped), len(via), len(part), len(S['signals']), len(S['places'])))


def find_signals(net, ids, polys, maxd=3.0):
    """the signals on the pieces ids: the piece each is on (the nearest, within maxd m) and how far along it (0-1)"""
    E = net['edges']; out = []
    for si, sg in enumerate(net['signals']):
        if sg.get('n') is None or sg.get('kind') == 'stop': continue
        la, lo = sg.get('on_track') or (sg['lat'], sg['lon']); x, y = lo * KX, la * KY; best = None
        for i in ids:
            P = polys[i]; run = 0.0; tot = sum(math.dist(P[j], P[j + 1]) for j in range(len(P) - 1)) or 1
            for j in range(len(P) - 1):
                (ax, ay), (bx, by) = P[j], P[j + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy; L = math.sqrt(L2) or 1
                u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (L2 or 1))); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
                if dd < maxd and (best is None or dd < best[1]): best = (i, dd, (run + u * L) / tot)
                run += L
        if best: out.append({'n': sg['n'], 'si': si, 'e': best[0], 'f': round(best[2], 3)})
    return out


def linea(m3='m3.json'):
    """a first drawing of the line (proposal): Comasina on the left, San Donato on the right, at their distance along the
    line (SX px a metre); the northbound main track on one row, the southbound on the row below; the other track pieces of
    the line (crossovers, tails, sidings) between or beside them, where they are along the line; the depot left out"""
    d, net = load(m3); E = net['edges']; NODES = net['nodes']; PE = d['path_edges']; DG = d['degraded']
    pN, pS = DG['N']['pid'], DG['S']['pid']
    polys = {i: dec(e['p']) for i, e in enumerate(E)}
    # the chainage along the northbound main track (San Donato 0), and a point of it every 5 m (to place the other nodes)
    ch, line_pts = {}, []
    for ei, dr, x0, x1 in PE[str(pN)]['e'] if isinstance(PE, dict) else PE[pN]['e']:
        P = polys[ei] if dr > 0 else polys[ei][::-1]
        a, b = (E[ei]['a'], E[ei]['b']) if dr > 0 else (E[ei]['b'], E[ei]['a'])
        ch.setdefault(a, x0); ch[b] = x1
        for j in range(len(P) - 1):
            L = math.dist(P[j], P[j + 1]); k = max(1, int(L / 5))
            for t in range(k): line_pts.append((0, P[j][0] + (P[j + 1][0] - P[j][0]) * t / k, P[j][1] + (P[j + 1][1] - P[j][1]) * t / k))
    # (recompute the chainage of the sample points along the polyline)
    S2, c = [], 0.0
    for i, (_, x, y) in enumerate(line_pts):
        if i: c += math.dist(line_pts[i - 1][1:], (x, y))
        S2.append((c, x, y))
    TOT = S2[-1][0]
    north_e = {ei for ei, *_ in (PE[str(pN)] if isinstance(PE, dict) else PE[pN])['e']}
    south_e = {ei for ei, *_ in (PE[str(pS)] if isinstance(PE, dict) else PE[pS])['e']}

    def where(n):
        x, y = NODES[str(n)][1] * KX, NODES[str(n)][0] * KY; best = None
        for i in range(0, len(S2) - 1):
            c0, ax, ay = S2[i]; c1, bx, by = S2[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, c0 + u * (c1 - c0), (dx * (y - ay) - dy * (x - ax)) / math.sqrt(L2))
        return best
    SX, YN, YS, ROW = 0.25, 200, 222, 22
    line_e = [i for i, e in enumerate(E) if e.get('cat') in ('main', 'siding', 'crossover', 'link')]
    pos, side_of = {}, {}
    for ei in line_e:
        for n in (E[ei]['a'], E[ei]['b']):
            if n in pos: continue
            dd, s_, side = where(n)
            if dd > 60: continue                          # (the depot and the test loop: far from the line)
            x = round(40 + (TOT - s_) * SX, 1)
            on_n = any(n in (E[i]['a'], E[i]['b']) for i in north_e); on_s = any(n in (E[i]['a'], E[i]['b']) for i in south_e)
            if on_n and not on_s: y = YN
            elif on_s and not on_n: y = YS
            elif on_n and on_s: y = YN
            else:
                # beside: the side of the line it is on, one row further out (a tail between the tracks: in the middle)
                y = YN - ROW if side > 4 else YS + ROW if side < -4 else (YN + YS) / 2
            pos[n] = [x, y]
    edges = [i for i in line_e if E[i]['a'] in pos and E[i]['b'] in pos]
    used = {E[i]['a'] for i in edges} | {E[i]['b'] for i in edges}
    stops = DG['N']['stops']; names = DG['names']
    labels = [{'text': {'DUOMO M3': 'Duomo'}.get(nm, nm.title().replace('Fs', 'FS').replace('T.I.B.B.', 'T.I.B.B.').replace('Fn', 'FN')), 'x': round(40 + (TOT - s_) * SX, 1), 'y': YN - 2 * ROW - 8}
              for nm, s_ in zip(names, stops)]
    out = {'_about': 'Sinottico della linea M3 (proposta, fatta da tools/sinottico.py linea): Comasina a sinistra, San Donato a destra, '
                     'alla loro distanza (0,25 px al metro); un binario di corsa per riga; nodes = dove sta ogni nodo (px), via = curve, '
                     'labels = le stazioni. Si corregge nell\'editor dei binari (Sinottico, Linea) e si esporta.',
           'edges': edges, 'nodes': {str(n): pos[n] for n in sorted(used)}, 'via': {}, 'part': {},
           'signals': find_signals(net, edges, polys), 'places': [], 'labels': labels}
    OUT = os.path.join(ROOT, 'data', 'sinottico_linea_m3.json')
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('sinottico della linea: %d tratte, %d nodi, %d segnali, %d stazioni, lunga %d m -> %s'
          % (len(edges), len(out['nodes']), len(out['signals']), len(labels), TOT, os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else ''
    if what == 'deposito': deposito()
    elif what == 'linea': linea()
    else: print(__doc__)
