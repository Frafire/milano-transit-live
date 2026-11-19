"""Tools for the sinottici (the control-room drawings) of the M3: the Rogoredo depot (ROD) and the line.

    cd build && python3 ../tools/sinottico.py tutto         # both, from zero (what the editor changed is lost: export it first)
    cd build && python3 ../tools/sinottico.py deposito      # the depot only
    cd build && python3 ../tools/sinottico.py linea         # the line only
    cd build && python3 ../tools/sinottico.py strisce       # the line cut in strips (later, when Giovanni says where)

Both read m3.json (a build) and write a file in data/ that the page draws (Editor dei binari, tab Sinottico: the nodes and
the bends are moved by hand there, "Più punti" gives the pieces of the chosen nodes more points, and the file is exported
again). The build never runs this tool, so the hand work stays.

Made again from zero on 16 Nov 2026 (Giovanni: "facciamolo ripartire da 0… metti tutti i binari giù… fai una riga che poi
dividiamo… fai il piano più grande… uguale per il deposito"): every piece of the track is in one of the two drawings (the
depot: the yard and the test loop in the box of the depot (ROD); the line: everything else, the M2 link and the track to the
depot included) and every signal on them; tests/sinottico_check.py fails the build when one is missing.

On the tiles of the real board (Giovanni 16 Nov 2026, with frames of a video of the M3 depot's ACEI board: "puoi
calcolare i tiles se vuoi e farli esattamente come le foto"): every node and every bend at the middle of a tile of 28 px,
each bit of track level, upright or at 45 degrees; tile = [size, x, y of a tile's middle] for the page's grid. Each signal
has b = 1 when it is on the wrong-way side (square head, B; round head A otherwise): heads().

The file: nodes = where each node of the track is in the drawing (px); edges = the track pieces drawn, from node to node;
via = bends of a piece (px, in order from its node a to its node b); part = a piece drawn only in part ([from, to], 0-1
from node a); signals = the piece each signal is on and how far along (0-1); places = the depot places by node; labels =
names written in the drawing; platforms, badges, fmap: the line's.
"""
import json, re, math, os, sys, collections, cmath

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


def add_dirs(net, sigs):
    """which way each signal looks: d = 1 for the trains that run its piece from node a to node b, -1 the other way (its
    heading against the piece there); the page draws the signal on that side of the track, pointing that way"""
    E = net['edges']
    for sg in sigs:
        x = net['signals'][sg['si']] if sg.get('si') is not None and sg['si'] < len(net['signals']) else None
        if not x or x.get('heading') is None: continue
        P = dec(E[sg['e']]['p']); C = [0.0]
        for i in range(1, len(P)): C.append(C[-1] + math.dist(P[i - 1], P[i]))
        at = sg['f'] * C[-1]; i = next((j for j in range(1, len(P)) if C[j] >= at), len(P) - 1)
        tx, ty = P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]; h = math.radians(x['heading'])
        sg['d'] = 1 if tx * math.sin(h) + ty * math.cos(h) >= 0 else -1
    return sigs


TILE = 28.0      # the tile of the panels (px): the rows of the drawings are one tile apart


def snap(q, x0, y0):
    """a point to the middle of its tile (the drawing's tiles have their middles at x0 + k TILE, y0 + k TILE)"""
    return [round((q[0] - x0) / TILE) * TILE + x0, round((q[1] - y0) / TILE) * TILE + y0]


def otile(A, B):
    """from A to B (both on tiles) as on the panels: level or upright, then 45 degrees, the slant in the middle and its
    bends on tiles too (the points after A)"""
    dx, dy = B[0] - A[0], B[1] - A[1]
    if abs(dx) < 0.5 or abs(dy) < 0.5 or abs(abs(dx) - abs(dy)) < 0.5: return [B]
    m = min(abs(dx), abs(dy)); sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    if abs(dx) > abs(dy):
        h = round((abs(dx) - m) / 2 / TILE) * TILE; return [[A[0] + sx * h, A[1]], [A[0] + sx * (h + m), B[1]], B]
    v = round((abs(dy) - m) / 2 / TILE) * TILE; return [[A[0], A[1] + sy * v], [B[0], A[1] + sy * (v + m)], B]


def clean(P):
    """no point twice, no point in the middle of a straight bit"""
    out = []
    for q in P:
        q = [round(q[0], 1), round(q[1], 1)]
        if out and abs(q[0] - out[-1][0]) < 0.05 and abs(q[1] - out[-1][1]) < 0.05: continue
        if len(out) >= 2:
            (ax, ay), (bx, by) = out[-2], out[-1]
            if abs((bx - ax) * (q[1] - by) - (by - ay) * (q[0] - bx)) < 0.5 and (bx - ax) * (q[0] - bx) + (by - ay) * (q[1] - by) > 0: out[-1] = q; continue
        out.append(q)
    return out


# the depot (Giovanni 16 Nov 2026, from zero: "metti tutti i binari giù… fai il piano più grande… uguale per il
# deposito"): its own pieces are the yard and the test loop in the box of the depot (ROD); every other piece is the line's
DEP_BOX = (45.4272, 45.4345, 9.2505, 9.2610)


def keep_deco(path):
    """what Giovanni moved or took away in the editor (signals, windows, names…: deco, by key) stays when the drawing is made
    again"""
    try: return json.load(open(path)).get('deco') or {}
    except Exception: return {}


def split(net):
    """the pieces of the depot drawing and of the line drawing: each piece of the track in exactly one of them"""
    E, N = net['edges'], net['nodes']
    inb = lambda n: DEP_BOX[0] <= N[str(n)][0] <= DEP_BOX[1] and DEP_BOX[2] <= N[str(n)][1] <= DEP_BOX[3]
    dep = [i for i, e in enumerate(E) if e.get('cat') in ('yard', 'test') and inb(e['a']) and inb(e['b'])]
    # (and the two tracks from the depot's door to San Donato, as on the depot's board: Giovanni 17 Nov 2026)
    dn = {E[i]['a'] for i in dep} | {E[i]['b'] for i in dep}
    dep += [i for i, e in enumerate(E) if i not in set(dep) and e.get('cat') == 'siding' and (e['a'] in dn or e['b'] in dn)]
    ds = set(dep)
    return dep, [i for i in range(len(E)) if i not in ds]


def deposito(m3='m3.json'):
    """the depot from zero: the real track turned so that the shed tracks lie level, bigger (2.4 px a metre along, one
    row of 28 px for each 4 m across), every piece of the yard and of the test loop, the signals on them; the page draws
    each piece level then at 45 degrees; the nodes and the bends then moved by hand in the editor"""
    d, net = load(m3); E, NODES = net['edges'], net['nodes']
    DEP, _ = split(net); nodes = sorted({E[i]['a'] for i in DEP} | {E[i]['b'] for i in DEP})
    DOOR_E = [i for i in DEP if E[i].get('cat') == 'siding']; nodes0 = sorted({E[i]['a'] for i in DEP if i not in DOOR_E} | {E[i]['b'] for i in DEP if i not in DOOR_E})
    xy = lambda n: (NODES[str(n)][1] * KX, NODES[str(n)][0] * KY)
    acc = [0.0, 0.0]
    for i in DEP:
        e = E[i]
        if e.get('cat') != 'yard' or e['len'] < 40: continue
        (x0, y0), (x1, y1) = xy(e['a']), xy(e['b']); a = math.atan2(y1 - y0, x1 - x0) * 2
        acc[0] += math.cos(a) * e['len']; acc[1] += math.sin(a) * e['len']
    th = math.atan2(acc[1], acc[0]) / 2; c, s_ = math.cos(-th), math.sin(-th)
    rot = {n: (xy(n)[0] * c - xy(n)[1] * s_, xy(n)[0] * s_ + xy(n)[1] * c) for n in nodes0}
    SX, ROW_M, SY = 2.4, 4.0, 28.0
    ymax = max(v[1] for v in rot.values()); xmin = min(v[0] for v in rot.values())
    # (along: 2.4 px a metre, but two nodes never on the same tile: the joints in the middle of a place, 2-3 m)
    xs = sorted({round(v[0], 1) for v in rot.values()}); K = [xs[0]]
    for x in xs[1:]:
        if x - K[-1] > 0.3: K.append(x)
    # (on the tiles of the panel, Giovanni 16 Nov 2026 with the photos of the Rogoredo board: "puoi calcolare i tiles se vuoi e
    # farli esattamente come le foto": every node at the middle of a tile of 28 px, two nodes at least one tile apart)
    XK = [60.0]
    for i in range(1, len(K)): XK.append(XK[-1] + TILE * max(1, round((K[i] - K[i - 1]) * SX / TILE)))
    def xat(x):
        i = min(range(len(K)), key=lambda j: abs(K[j] - x)); return round(XK[i], 1)
    pos = {n: [xat(v[0]), round((ymax - v[1]) / ROW_M) * SY + 60] for n, v in rot.items()}
    # (two nodes on the same spot of the drawing, not joined: the second one row down, until it is free)
    for _ in range(6):
        moved = 0; seen = {}
        for n in nodes0:
            key = (round(pos[n][0] / 12), pos[n][1])
            if key in seen: pos[n][1] += SY; moved += 1
            else: seen[key] = n
        if not moved: break
    # the tracks of the places (Giovanni 17 Nov 2026: "bin 4 è il primo del capannone 1 - 2 - 3 sono i più alti e gli altri
    # sono di conseguenza"): the two places of a track (joined by their joint of 2-3 m) on one row, the row no other track's
    # place is on; then Bin.1, Bin.2… from the top
    PL = {p['node']: p['name'] for p in net.get('depot', []) if p['node'] in pos}
    tracks, done = [], set()
    for n in sorted(PL):
        if n in done: continue
        mate = next((E[i]['b'] if E[i]['a'] == n else E[i]['a'] for i in DEP if n in (E[i]['a'], E[i]['b']) and E[i]['len'] < 5
                     and (E[i]['b'] if E[i]['a'] == n else E[i]['a']) in PL), None)
        T_ = [n] + ([mate] if mate is not None else []); done |= set(T_); tracks.append(T_)
    for T_ in tracks:
        if len(T_) == 2 and pos[T_[0]][1] != pos[T_[1]][1]:
            busy = lambda y: sum(1 for U in tracks if U is not T_ for m in U if pos[m][1] == y)
            y = min((pos[m][1] for m in T_), key=busy)
            for m in T_: pos[m][1] = y
    # (and the joints beyond the places, up to the switches: on the same row, as the track is one)
    adj = {}
    for i in DEP: adj.setdefault(E[i]['a'], []).append(i); adj.setdefault(E[i]['b'], []).append(i)
    for T_ in tracks:
        y = pos[T_[0]][1]
        for n0 in T_:
            for i0 in adj.get(n0, []):
                cur, ei = n0, i0
                for _ in range(6):
                    nx = E[ei]['b'] if E[ei]['a'] == cur else E[ei]['a']
                    if nx in T_ or nx in PL or len(adj.get(nx, [])) != 2: break
                    pos[nx][1] = y; cur = nx; ei = next(j for j in adj[nx] if j != ei)
    tracks.sort(key=lambda T_: (min(pos[m][1] for m in T_), min(pos[m][0] for m in T_)))
    bins = [{'nodes': T_, 't': 'Bin.%d' % (k + 1), 'places': [PL[m] for m in T_]} for k, T_ in enumerate(tracks)]
    # the depot's door as on the board (Giovanni 16-17 Nov 2026, the photos: "questa è l'entrata"): two tracks upright, the
    # scissors between them (switches 1a, 1b, 2a, 2b), San Donato at the bottom; left the track of #A05 (in) and #A02 (out),
    # right the one of #A04 (in) and #A03 (out)
    DOOR = {'1a': 28, '1b': 154, '2a': 41, '2b': 43, 'x': 42, 'B0': 29, 'A0': 40, 'B1': 141, 'A1': 160, 'B2': 142}
    DOOR_FLAT = (27, 37, 38, 39, 144, 148, 149, 168, 143, 132, 166)
    door = all(v in pos or v in (160, 142) for v in DOOR.values()) and all(i in DEP for i in DOOR_FLAT)
    if door:
        xB, yT = pos[DOOR['2b']][0], pos[DOOR['2b']][1]
        for k, (dx, dy) in {'2b': (0, 0), '1b': (4, 0), 'x': (2, 2), '1a': (0, 4), '2a': (4, 4), 'B0': (0, 5), 'A0': (4, 5),
                            'B1': (0, 14), 'B2': (0, 18), 'A1': (4, 18)}.items():
            pos[DOOR[k]] = [xB + dx * TILE, yT + dy * TILE]
    else: print('deposito: the door of the depot not found (nodes changed?): drawn as the real track')
    for n in nodes:
        if n not in pos: pos[n] = [60.0, 60.0]
    # every piece with its own shape (Giovanni 16 Nov 2026, with his sketch: the loops round the yard, the officina, the
    # test loop round everything; "le linee del deposito devono essere dritte"): the real track turned and stretched like
    # the nodes, fewer points, each bit then level, at 45 degrees or upright
    polys = {i: dec(e['p']) for i, e in enumerate(E)}
    def xc(x):                                            # (the same stretch as the nodes, between them by proportion)
        if x <= K[0]: return XK[0] - (K[0] - x) * SX
        if x >= K[-1]: return XK[-1] + (x - K[-1]) * SX
        i = next(j for j in range(1, len(K)) if K[j] >= x); u = (x - K[i - 1]) / ((K[i] - K[i - 1]) or 1); return XK[i - 1] + (XK[i] - XK[i - 1]) * u
    def octi(A, B):
        dx, dy = B[0] - A[0], B[1] - A[1]
        if abs(dx) < 2 or abs(dy) < 2 or abs(abs(dx) - abs(dy)) < 2: return [B]
        m = min(abs(dx), abs(dy)); sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
        if abs(dx) > abs(dy): h = (abs(dx) - m) / 2; return [[A[0] + sx * h, A[1]], [A[0] + sx * (h + m), B[1]], B]
        v = (abs(dy) - m) / 2; return [[A[0], A[1] + sy * v], [B[0], A[1] + sy * (v + m)], B]
    UP = {}
    if door:
        far = {}
        for k in ('1b', '2b'):
            n = DOOR[k]; i = next(i for i in DEP if n in (E[i]['a'], E[i]['b']) and i not in DOOR_FLAT)
            m = E[i]['b'] if E[i]['a'] == n else E[i]['a']; far[k] = (i, pos[n], pos[m], pos[m][0] - pos[m][1])
        cB = far['2b'][3]; cA = max(far['1b'][3], cB + 2 * TILE)
        UP = {far['1b'][0]: (far['1b'][1], far['1b'][2], cA), far['2b'][0]: (far['2b'][1], far['2b'][2], cB)}
    via = {}
    for i in DEP:
        e = E[i]; P = polys[i]
        if door and i in DOOR_FLAT: continue
        if door and i in UP:
            # (out of the scissors upwards: upright, at 45 degrees, then level into the next node; the right-hand track
            # outside the left-hand one, two tiles apart: the board's tracks never cross there)
            A, B, cc = UP[i]
            P_ = clean([A, [A[0], A[0] - cc], [B[1] + cc, B[1]], B])[1:-1]
            if pos[e['a']] != A: P_ = P_[::-1]
            if P_: via[str(i)] = P_
            continue
        if (e['a'] in PL) != (e['b'] in PL):
            # (a place's track: level on its own row up to the switch at its end, then 45 degrees into it; not on the
            # row of the next track, as the real track rounded to rows of 4 m did)
            A, B = (pos[e['a']], pos[e['b']]) if e['a'] in PL else (pos[e['b']], pos[e['a']])
            dy = abs(B[1] - A[1]); sx = 1 if B[0] > A[0] else -1
            P_ = clean([A, [B[0] - sx * dy, A[1]], B])[1:-1] if dy > 0.5 and abs(B[0] - A[0]) > dy else []
            if e['a'] not in PL: P_ = P_[::-1]
            if P_: via[str(i)] = P_
            continue
        if len(P) < 3 and abs(pos[e['a']][1] - pos[e['b']][1]) < 0.5: continue
        Q = []
        for (x, y) in P:
            rx, ry = x * c - y * s_, x * s_ + y * c; Q.append([xc(rx), (ymax - ry) / ROW_M * SY + 60])
        if math.dist(Q[0], pos[e['a']]) > math.dist(Q[0], pos[e['b']]): Q = Q[::-1]
        # (the ends where the nodes are, the error spread along)
        ea = [pos[e['a']][0] - Q[0][0], pos[e['a']][1] - Q[0][1]]; eb = [pos[e['b']][0] - Q[-1][0], pos[e['b']][1] - Q[-1][1]]
        L = [0.0]
        for k in range(1, len(Q)): L.append(L[-1] + math.dist(Q[k - 1], Q[k]))
        Q = [[q[0] + ea[0] + (eb[0] - ea[0]) * L[k] / (L[-1] or 1), q[1] + ea[1] + (eb[1] - ea[1]) * L[k] / (L[-1] or 1)] for k, q in enumerate(Q)]
        Q = rdp([tuple(q) for q in Q], 12.0)
        # (each bend on a tile, each bit level, upright or at 45 degrees: as the bars of the panel)
        G = [list(pos[e['a']])] + [snap(q, 60, 60) for q in Q[1:-1]] + [list(pos[e['b']])]
        out = [G[0]]
        for k in range(1, len(G)):
            if G[k] != out[-1]: out += otile(out[-1], G[k])
        v = clean(out)[1:-1]
        if v: via[str(i)] = v
    # the signals: on the depot's pieces and on the tails of San Donato (the agents read those from this file:
    # sdTailSig); the page draws the ones on the pieces drawn
    near = [i for i, e in enumerate(E) if i in set(DEP) or i in set(net.get('sd_tail_edges') or [])]
    sigs = heads(d, net, add_dirs(net, find_signals(net, near, polys)))
    places = [{'node': p['node'], 'name': p['name']} for p in net.get('depot', []) if p['node'] in pos]
    # the names of the switches: the door's from the board (1a 1b 2a 2b), the others made up (Giovanni 17 Nov 2026: "numeri
    # scambi e sezioni non li so quello che riesci a capire bene sennò inventali"): from the door leftwards, top to bottom;
    # two switches joined by one piece at 45 degrees (a crossover) one number, a and b
    deg = {}
    for i in DEP: deg[E[i]['a']] = deg.get(E[i]['a'], 0) + 1; deg[E[i]['b']] = deg.get(E[i]['b'], 0) + 1
    swn = {str(DOOR[k]): k for k in ('1a', '1b', '2a', '2b')} if door else {}
    k_ = 3
    for n in sorted((n for n in nodes if deg.get(n) == 3 and str(n) not in swn), key=lambda n: (-pos[n][0], pos[n][1])):
        if str(n) in swn: continue
        mate = None
        for i in DEP:
            e = E[i]
            if n not in (e['a'], e['b']) or str(i) in via: continue
            m = e['b'] if e['a'] == n else e['a']
            if deg.get(m) == 3 and str(m) not in swn and abs(abs(pos[m][0] - pos[n][0]) - abs(pos[m][1] - pos[n][1])) < 1 and pos[m][1] != pos[n][1]: mate = m; break
        if mate is not None: swn[str(n)] = '%da' % k_; swn[str(mate)] = '%db' % k_
        else: swn[str(n)] = str(k_)
        k_ += 1
    # the sections of the door as on the board (01-04: below right, below left, above right, above left); the page numbers
    # the others after them; San Donato written at the bottom
    sec0 = {'%d:%s' % (i, f): t for i, f, t in ((166, 0.98, '01'), (143, 0.05, '02'), (150, 0.01, '03'), (165, 0.99, '04'))} if door else {}
    texts = [{'x': pos[DOOR['2b']][0] + 2 * TILE, 'y': pos[DOOR['B2']][1] + 2 * TILE, 't': 'SAN DONATO', 'c': 'lab'}] if door else []
    S = {'_about': 'Sinottico del deposito Rogoredo (ROD), rifatto da zero (Giovanni 16/11/2026): tutti i binari del deposito e '
                   'dell\'anello di prova, il binario vero girato in orizzontale e ingrandito (2,4 px al metro, una riga di 28 px '
                   'ogni 4 m); nodes = dove sta ogni nodo (px), via = curve (si aggiungono nell\'editor), signals = la tratta e '
                   'quanto lungo (0-1), places = i posti. tools/sinottico.py deposito lo rifà da capo; l\'editor lo corregge.',
         'tile': [TILE, 60, 60], 'angle_deg': round(math.degrees(th), 1), 'edges': DEP, 'nodes': {str(n): pos[n] for n in nodes}, 'via': via, 'part': {},
         'signals': sigs, 'places': places, 'bins': bins, 'swn': swn, 'sec0': sec0, 'texts': texts}
    OUT = os.path.join(ROOT, 'data', 'schema_deposito_m3.json'); S['deco'] = keep_deco(OUT); json.dump(S, open(OUT, 'w'), ensure_ascii=False, indent=1)
    W = max(v[0] for v in pos.values()); H = max(v[1] for v in pos.values())
    print('sinottico del deposito: %d tratte, %d nodi, %d segnali (%d sulle tratte disegnate), %d posti, %d x %d px'
          % (len(DEP), len(pos), len(sigs), sum(1 for x in sigs if x['e'] in set(DEP)), len(places), W, H))


# the heads of the signals (Giovanni 16 Nov 2026, the photos of the Rogoredo board: "quadrati illegale B legali tondi A"):
# b = 1 for a signal on the wrong-way side; at the depot's door S01B = #A05 and S02B = #A03 (S01A = #A04, S02A = #A02)
DEPOT_B = {3, 5}


def heads(d, net, sigs):
    """b = 1 on the signals for the trains running the wrong way: the ones the editor marks so (legal false), #A03 and #A05,
    and on the main tracks the ones facing against the way the service runs there (the paths N and S, as in
    tools/itineraries.py)"""
    E = net['edges']; PE = d['path_edges']; DG = d.get('degraded') or {}
    pe_ = lambda pid: (PE[str(pid)] if isinstance(PE, dict) else PE[pid])['e']
    LEG = {}
    for side in ('N', 'S'):
        pid = (DG.get(side) or {}).get('pid')
        if pid is None: continue
        for ei, dr, x0, x1 in pe_(pid):
            if E[ei].get('cat') == 'main': LEG.setdefault(ei, 1 if dr > 0 else -1)
    for sg in sigs:
        x = net['signals'][sg['si']] if sg.get('si') is not None and sg['si'] < len(net['signals']) else {}
        b = x.get('legal') is False or sg['n'] in DEPOT_B
        if not b and x.get('legal') is not True and sg['e'] in LEG and sg.get('d') in (1, -1): b = sg['d'] != LEG[sg['e']]
        if b: sg['b'] = 1
        else: sg.pop('b', None)
    return sigs


def find_signals(net, ids, polys, maxd=3.0):
    """the signals on the pieces ids: the piece each is on (the nearest, within maxd m) and how far along it (0-1)"""
    E = net['edges']; out = []
    for si, sg in enumerate(net['signals']):
        if sg.get('n') is None or sg.get('kind') == 'stop': continue
        la, lo = sg.get('on_track') or (sg['lat'], sg['lon']); x, y = lo * KX, la * KY; best = None
        # (on the track Giovanni put it on in the editor, its way w, when that track is among these pieces)
        same = [i for i in ids if E[i].get('way') == sg.get('w')]
        for i in (same or ids):
            P = polys[i]; run = 0.0; tot = sum(math.dist(P[j], P[j + 1]) for j in range(len(P) - 1)) or 1
            for j in range(len(P) - 1):
                (ax, ay), (bx, by) = P[j], P[j + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy; L = math.sqrt(L2) or 1
                u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (L2 or 1))); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
                if dd < maxd and (best is None or dd < best[1]): best = (i, dd, (run + u * L) / tot)
                run += L
        if best: out.append({'n': sg['n'], 'si': si, 'e': best[0], 'f': round(best[2], 3)})
    return out


# San Donato: the rows of the nodes beyond the station (row 0 = binario 2, -2 tronchetto 2 and the half tail, -4 binario 3)
SD_ROWS = {116: -2, 117: -2, 118: -2, 119: -2, 201: -2, 155: -1, 142: -4, 143: -4}
# Comasina: the two tails in line with binari 2 and 1 (Giovanni 18 Nov 2026: "tronchetti comasina stanno sulla stessa
# altezza"), the X between them; Centrale: the M2 link one row below binario 2, the binario di rimessa one row above
# binario 1 (proposal)
ROW_FIX = {**SD_ROWS, 179: 4, 180: 4, 182: 0, 183: 0, 122: 1, 123: 1, 139: 3, 138: 3, 140: 3, 202: 3}
X_NODES = {155, 191}
# San Donato: the departure signals of binario 3 (#A14) and binario 2 (#A45) at the same height; the crossover between
# binari 1 and 2 two tiles towards Comasina (Giovanni 18 Nov 2026: "così da dare più respiro a tutto")
SAME_X = [(14, 45)]
CROSS_SHIFT = {236: -2}
# the first bit of the tracks to and from the depot (they belong to the depot's drawing): 166 from the end of binario 1,
# 132 from binario 3
DEP_STUBS = (166, 132)
# moved by hand by Giovanni in the editor (18 Nov 2026, Centrale: the M2 link): the nodes where he put them, the bends he took away
LINE_MANUAL = {'nodes': {139: [4670, 284], 172: [4670, 228]}, 'via': {183: []}}


def linea(m3='m3.json'):
    """the line from zero (Giovanni 16 Nov 2026: "facciamolo ripartire da 0… metti tutti i binari giù… fai una riga che
    poi dividiamo… fai il piano più grande alcune stazioni sono così piccole che non si vedono i semafori"): one row from
    San Donato to Comasina (Comasina on the left), every piece of the track that is not the depot's (tools split), every
    signal on them. Along the line, not to scale: between two things to see (a node, a signal, an end of a platform) never
    less than 34 px, the switches bigger, a platform 150 px, the plain track 0.3 px a metre (at most 300 px). Binario 2
    (verso Comasina) on top, binario 1 (verso San Donato) below, three rows of 28 px between them (the middle track of
    Brenta, the two tracks of the M2 link), the tails and the sidings out beyond them; the pieces far from the line (the
    track to the depot, the M2 link) go on out from where they leave it"""
    d, net = load(m3); E = net['edges']; NODES = net['nodes']; PE = d['path_edges']; DG = d['degraded']
    pe_ = lambda pid: (PE[str(pid)] if isinstance(PE, dict) else PE[pid])['e']
    pN, pS = DG['N']['pid'], DG['S']['pid']
    polys = {i: dec(e['p']) for i, e in enumerate(E)}

    def path_pts(pid, step=5.0):
        out = []
        for ei, dr, x0, x1 in pe_(pid):
            P = polys[ei] if dr > 0 else polys[ei][::-1]; C = [0.0]
            for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
            k = max(1, int((x1 - x0) / step))
            for t in range(k + 1):
                u = t / k * C[-1]; j = next((i for i in range(1, len(P)) if C[i] >= u), len(P) - 1); q = (u - C[j - 1]) / ((C[j] - C[j - 1]) or 1)
                out.append((x0 + (x1 - x0) * t / k, P[j - 1][0] + (P[j][0] - P[j - 1][0]) * q, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * q))
        return out
    S2 = path_pts(pN); TOT = S2[-1][0]; SS = path_pts(pS)

    def where_xy(x, y):
        best = None
        for i in range(len(S2) - 1):
            c0, ax, ay = S2[i]; c1, bx, by = S2[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, c0 + u * (c1 - c0))
        return best
    where = lambda n: where_xy(NODES[str(n)][1] * KX, NODES[str(n)][0] * KY)
    at_d = lambda P, dd: min(P, key=lambda q: abs(q[0] - dd))
    north_e = {x[0] for x in pe_(pN)}; south_e = {x[0] for x in pe_(pS)}
    on = lambda n, es: any(n in (E[i]['a'], E[i]['b']) for i in es)
    _, edges = split(net)
    used = {E[i]['a'] for i in edges} | {E[i]['b'] for i in edges}
    W = {n: where(n) for n in used}
    NEAR = 60.0
    nearn = {n for n in used if W[n][0] <= NEAR}
    deg = collections.Counter(n for i in edges for n in (E[i]['a'], E[i]['b']))
    names = DG['names']; stN = DG['N']['stops']; sN = [at_d(S2, x)[0] for x in stN]
    TRAIN = 2 * d['half'] if isinstance(d.get('half'), (int, float)) else 105.0
    # the platforms as in the game (Giovanni 16 Nov 2026: "alcune banchine sono troppo lunghe riporta quelle del gioco"): the
    # zones of the build (degraded.platforms: the stop, half a train and 5 m each side) on binario 2 (the path N) and on
    # binario 1 (the path S), each where it is
    ZN = {}
    for a_, b_, i in DG['platforms'][str(pN)]: ZN.setdefault(i, (at_d(S2, a_)[0], at_d(S2, b_)[0]))
    def s_of(P, dd): q = at_d(P, dd); return where_xy(q[1], q[2])[1]
    ZS = {}
    for a_, b_, i in DG['platforms'][str(pS)]: ZS.setdefault(i, tuple(sorted((s_of(SS, a_), s_of(SS, b_)))))
    # (Giovanni 18 Nov 2026: "stazioni e banchine devono essere allineate"): binario 1 moved along so that at every station its
    # platform is where binario 2's is (the two are side by side in the real station; the stops of the two directions are
    # a few metres apart): TS(s) shifts a place of binario 1, by the shift of the stations each side of it
    KN = sorted(((ZS[i][0] + ZS[i][1]) / 2, (ZN[i][0] + ZN[i][1]) / 2 - (ZS[i][0] + ZS[i][1]) / 2) for i in ZS if i in ZN)
    def TS(s_):
        if not KN: return s_
        if s_ <= KN[0][0]: return s_ + KN[0][1]
        if s_ >= KN[-1][0]: return s_ + KN[-1][1]
        j = next(k for k in range(1, len(KN)) if KN[k][0] >= s_); (a0, h0), (a1, h1) = KN[j - 1], KN[j]
        return s_ + h0 + (h1 - h0) * (s_ - a0) / ((a1 - a0) or 1)
    ZS = {i: ((ZN[i] if i in ZN else (TS(z[0]), TS(z[1])))) for i, z in ZS.items()}
    plats = [(nm, ZN[i]) for i, nm in enumerate(names) if i in ZN] + [(nm, ZS[i]) for i, nm in enumerate(names) if i in ZS]
    sw_s = sorted(W[n][1] for n in nearn if deg[n] >= 3)
    # every signal of the line as the game has it (Giovanni 18 Nov 2026: "fai un controllo gigantesco sui semafori che siano
    # presenti tutti"; all of them confirmed by him the same day): the ones of the route interlocking (net.sigall: the block
    # signals of every station, entry and departure, the blocks between, the wrong-way ones, the placed ones), by the
    # number the map shows; then the other signals placed on these pieces (tails, shunting). A placed signal that is the
    # place of a block signal is drawn once, as the block (as on the map)
    ES = set(edges) | set(DEP_STUBS); SIGN = {sg.get('n'): i for i, sg in enumerate(net['signals']) if sg.get('n') is not None}
    bpl = {b_.get('placed') for b_ in d.get('blocks') or [] if b_.get('placed') is not None and not b_.get('hidden')}
    def edge_at(pid, dd):
        # (at the joint of two pieces: the one of this drawing)
        hits = [(ei, dr, x0, x1) for ei, dr, x0, x1 in pe_(pid) if x0 - 0.5 <= dd <= x1 + 0.5]
        hits.sort(key=lambda h: h[0] not in ES)
        for ei, dr, x0, x1 in hits[:1]:
            k = E[ei]['len'] / ((x1 - x0) or 1); return ei, ((dd - x0) * k if dr > 0 else (x1 - dd) * k), dr
        return None
    SG = {}
    for pid, lst in sorted((net.get('sigall') or {}).items(), key=lambda kv: int(kv[0])):
        for dd, n_, fl in lst:
            if n_ in SG: continue
            r_ = edge_at(int(pid), dd)
            if not r_ or r_[0] not in ES: continue
            x_ = {'n': n_, 'e': r_[0], 'f': round(min(1.0, max(0.0, r_[1] / (E[r_[0]]['len'] or 1))), 4), 'd': r_[2]}
            if n_ in SIGN: x_['si'] = SIGN[n_]
            if 'i' in fl: x_['b'] = 1
            SG[n_] = x_
    for x_ in heads(d, net, add_dirs(net, find_signals(net, edges, polys))):
        if x_['n'] not in SG and x_['n'] not in bpl: SG[x_['n']] = x_
    sig = sorted(SG.values(), key=lambda x_: x_['n'])
    onS = lambda ei: ei in south_e and ei not in north_e
    def sig_s(sg):
        P = polys[sg['e']]; C = [0.0]
        for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
        u = sg['f'] * C[-1]; j = next((i for i in range(1, len(P)) if C[i] >= u), len(P) - 1); q = (u - C[j - 1]) / ((C[j] - C[j - 1]) or 1)
        x, y = P[j - 1][0] + (P[j][0] - P[j - 1][0]) * q, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * q
        w_ = where_xy(x, y); return (w_[0], TS(w_[1]) if onS(sg['e']) else w_[1])
    def side_to(P, x, y):
        best = None
        for i in range(0, len(P) - 1, 2):
            _, ax, ay = P[i]; _, bx, by = P[min(i + 2, len(P) - 1)]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, (dx * (y - ay) - dy * (x - ax)) / math.sqrt(L2))
        return best[1]
    # where a node is along the line: binario 1 and the tracks on its side moved with it (TS)
    nS = {n for n in used if on(n, south_e) and not on(n, north_e)}
    sideS = lambda n: n in nS or (not on(n, north_e) and W[n][0] < 400 and abs(side_to(SS, NODES[str(n)][1] * KX, NODES[str(n)][0] * KY)) < abs(side_to(S2, NODES[str(n)][1] * KX, NODES[str(n)][0] * KY)))
    SN = {n: (TS(W[n][1]) if sideS(n) else W[n][1]) for n in used}
    # the things to see along the line (only those near it: a signal on the track to the depot is placed with it)
    ev = [0.0, TOT] + [SN[n] for n in nearn] + [x for p in plats for x in p[1]]
    SGS = [w[1] for w in (sig_s(sg) for sg in sig) if w[0] <= NEAR]
    ev += SGS
    ev = sorted(ev); K = [ev[0]]
    for x in ev[1:]:
        if x - K[-1] > 0.5: K.append(x)
    # the signals of a station just outside it (Giovanni 18 Nov 2026: "i semafori sono subito fuori la stazione"; the block
    # sections cut "all'inizio e fine di ogni stazione, fuori non dentro"): a signal up to 90 m beyond the end of a
    # platform, with no switch between, one tile out from it; the ones beyond it on the same tile
    nodes_s = sorted(SN[n] for n in nearn)
    # (a signal up to 8 m inside the end of a platform zone of the game: the drawn platform ends 1 m before it)
    for k_, (nm_, (p0, p1)) in enumerate(plats):
        ins0 = [x for x in SGS if p0 - 0.1 <= x <= p0 + 8]; ins1 = [x for x in SGS if p1 - 8 <= x <= p1 + 0.1]
        plats[k_] = (nm_, (max(ins0) + 1.0 if ins0 else p0, min(ins1) - 1.0 if ins1 else p1))
    ev = sorted(set(round(x, 1) for x in ([0.0, TOT] + [SN[n] for n in nearn] + [x for p in plats for x in p[1]] + SGS))); K = [ev[0]]
    for x in ev[1:]:
        if x - K[-1] > 0.5: K.append(x)
    SPANS = []
    for _, (p0, p1) in plats:
        for e_, sd in ((p0, -1), (p1, 1)):
            far_ = None
            for x in SGS:
                dd = (x - e_) * sd
                if -3 <= dd <= 90 and not any(0.5 < (y - e_) * sd < dd - 0.5 for y in nodes_s): far_ = max(far_ or 0, dd)
            if far_ is not None: SPANS.append((min(e_, e_ + sd * far_), max(e_, e_ + sd * far_), e_))
    MIN, PLAT, PXM, CAP, ZONE = 34.0, 105.0, 0.3, 300.0, 70.0      # (a platform: 1 px a metre)
    def width(a, b):
        L = b - a; m = (a + b) / 2
        for _, (p0, p1) in plats:
            if p0 - 0.5 <= m <= p1 + 0.5: return max(MIN * min(1.0, L / 3), L * PLAT / TRAIN)
        if any(abs(m - x) <= ZONE for x in sw_s): return max(MIN, L * 1.3)
        return max(MIN, min(CAP, L * PXM))
    # (on the tiles of the panel, Giovanni 16 Nov 2026: each width a whole number of tiles of 28 px, at least one; two
    # things closer than 9 px of the old drawing on the same tile)
    def width_(a, b):
        for lo, hi, e_ in SPANS:
            if lo - 0.6 <= a and b <= hi + 0.6: return TILE if (abs(a - e_) < 0.6 or abs(b - e_) < 0.6) else 0.0
        w_ = width(a, b); return TILE * max(1, round(w_ / TILE)) if w_ >= 9 else 0.0
    XK = [0.0]
    for i in range(1, len(K)): XK.append(XK[-1] + width_(K[i - 1], K[i]))
    X0 = XK[-1] + 3 * TILE                                # (Comasina on the left)
    def X(s_):
        s_ = max(K[0], min(K[-1], s_)); i = max(1, next((j for j in range(1, len(K)) if K[j] >= s_), len(K) - 1))
        u = (s_ - K[i - 1]) / ((K[i] - K[i - 1]) or 1); return round(X0 - (XK[i - 1] + (XK[i] - XK[i - 1]) * u), 1)
    ROW = 28.0; YN = 200.0; YS = YN + 4 * ROW         # (four rows between: an X crossover on the tiles, a track in the middle)
    mid_ = SS[len(SS) // 2]; refN = 1 if side_to(S2, mid_[1], mid_[2]) > 0 else -1
    midn = S2[len(S2) // 2]; refS = 1 if side_to(SS, midn[1], midn[2]) > 0 else -1
    # (Giovanni 18 Nov 2026: "riportare fedelmente i binari"): a track between the two main ones in the middle rows, by
    # how far it is from each; one outside them a row further out every 4 m (one in line with a main track, as the tails
    # going on from it, on its row)
    pos = {}
    for n in nearn:
        x = round(X(SN[n]) / TILE) * TILE
        if on(n, north_e): y = YN
        elif on(n, south_e): y = YS
        else:
            nx_, ny_ = NODES[str(n)][1] * KX, NODES[str(n)][0] * KY; a_ = side_to(S2, nx_, ny_) * refN; b_ = side_to(SS, nx_, ny_) * refS
            if a_ > 0.8 and b_ > 0.8: y = YN + ROW * max(1, min(3, round(4 * a_ / (a_ + b_))))
            elif a_ <= 0.8: y = YN if -a_ < 1.5 else YN - ROW * max(1, min(2, round(-a_ / 4.0)))
            else: y = YS if -b_ < 1.5 else YS + ROW * max(1, min(2, round(-b_ / 4.0)))
        pos[n] = [x, y]
    # San Donato as it is (Giovanni 18 Nov 2026: "i binari a san donato sono 4… il tronchetto è a metà tra i binari 2 e 3 e
    # ha quel mezzo tronchetto che poi porta sul 2"): binario 2 and tronchetto 1 on the row of binario 2, binario 1 below,
    # tronchetto 2 and the half tail two rows above, binario 3 four rows above; the two tails side by side with their X
    for n_, r_ in ROW_FIX.items():
        if n_ in pos: pos[n_][1] = YN + r_ * ROW
    # the X crossovers (two crossovers through one node: Giovanni 18 Nov 2026, "rifai tutti gli incroci a X"): the node in the
    # middle of the four rows, the four legs at 45 degrees to the two main tracks, on the tiles
    # (a crossover never over a platform: moved off it, with a tile to spare, on the side where its middle is)
    PLX = sorted(tuple(sorted((X(p0), X(p1)))) for _, (p0, p1) in plats)
    def clear_of_platforms(cx, h_):
        for xa, xb in PLX:
            if cx + h_ > xa - TILE and cx - h_ < xb + TILE:
                cx = xa - TILE - h_ if cx < (xa + xb) / 2 else xb + TILE + h_
        return round(cx / TILE) * TILE
    XD = set()
    for c_ in [n for n in pos if deg[n] == 4]:
        inc = [i for i in edges if c_ in (E[i]['a'], E[i]['b'])]
        oth = [(i, E[i]['b'] if E[i]['a'] == c_ else E[i]['a']) for i in inc]
        if not all(m in pos for _, m in oth): continue
        if not (all(E[i].get('cat') == 'crossover' for i in inc) or c_ in X_NODES): continue
        ys_ = sorted({pos[m][1] for _, m in oth})
        if len(ys_) != 2: continue
        yU, yD = ys_; up = sorted([m for _, m in oth if pos[m][1] == yU], key=lambda m: pos[m][0]); dn = sorted([m for _, m in oth if pos[m][1] == yD], key=lambda m: pos[m][0])
        if len(up) != 2 or len(dn) != 2: continue
        h_ = (yD - yU) / 2; cx = clear_of_platforms(round(sum(pos[m][0] for _, m in oth) / 4 / TILE) * TILE, h_)
        pos[c_] = [cx, yU + h_]; pos[up[0]] = [cx - h_, yU]; pos[up[1]] = [cx + h_, yU]; pos[dn[0]] = [cx - h_, yD]; pos[dn[1]] = [cx + h_, yD]
        XD.update(inc)
    # the crossovers at 45 degrees about their middle
    for i in edges:
        e = E[i]
        if i in XD or not (e.get('cat') == 'crossover' or ({round(pos.get(e['a'], [0, -1])[1]), round(pos.get(e['b'], [0, -1])[1])} == {round(YN), round(YS)})): continue
        pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb or abs(pa[1] - pb[1]) < 1: continue
        dy = abs(pa[1] - pb[1]); sg = 1 if pb[0] >= pa[0] else -1; mid = clear_of_platforms((pa[0] + pb[0]) / 2, dy / 2)
        pa[0] = round(round((mid - sg * dy / 2) / TILE) * TILE, 1); pb[0] = round(pa[0] + sg * dy, 1)
    # two tracks side by side on the same row: one of them a row further out
    nbr = collections.defaultdict(set)
    for i in edges:
        nbr[E[i]['a']].add(E[i]['b']); nbr[E[i]['b']].add(E[i]['a'])
    for _ in range(3):
        pairs = [(a_, b_) for a_ in pos for b_ in pos if a_ < b_ and b_ not in nbr[a_] and abs(pos[a_][1] - pos[b_][1]) < 0.5
                 and abs(pos[a_][1] - YN) > 0.5 and abs(pos[a_][1] - YS) > 0.5 and abs(pos[a_][0] - pos[b_][0]) < 14]
        if not pairs: break
        row = lambda n: [m for m in nbr[n] if n in pos and m in pos and abs(pos[m][1] - pos[n][1]) < 0.5]
        for y0 in sorted({pos[a_][1] for a_, _ in pairs}):
            A, B = {a_ for a_, b_ in pairs if pos[a_][1] == y0}, {b_ for a_, b_ in pairs if pos[a_][1] == y0}
            grow_ = True
            while grow_:
                grow_ = False
                for n in pos:
                    if n in A or n in B or abs(pos[n][1] - y0) > 0.5 or not row(n): continue
                    if all(m in B for m in row(n)) or sum(m in B for m in row(n)) >= 2: B.add(n); grow_ = True
            for n in B: pos[n][1] = y0 + ROW if YN < y0 < YS else y0 - ROW if y0 < YN else y0 + ROW
    # the pieces far from the line (the track to the depot, the M2 link): out from the node where they leave it, two rows
    # further out, along as far as their real length says (0.3 px a metre, at least 60 px)
    far, todo = [], [n for n in used if n not in pos]
    for _ in range(len(todo) + 1):
        left = [n for n in used if n not in pos]
        if not left: break
        for n in left:
            for i in edges:
                e = E[i]
                if n not in (e['a'], e['b']): continue
                m = e['b'] if e['a'] == n else e['a']
                if m not in pos: continue
                px, py = pos[m]; out = -1 if py <= YN + 0.5 else 1
                sx = 1 if X(SN[n]) >= px else -1
                pos[n] = [round(px + sx * TILE * max(2, round(min(240.0, e['len'] * PXM) / TILE)), 1), py + out * 2 * ROW if py in (YN, YS) or py < YN or py > YS else py + 2 * ROW]
                far.append(n); break
    for i, k_ in CROSS_SHIFT.items():
        for n_ in (E[i]['a'], E[i]['b']):
            if n_ in pos: pos[n_][0] += k_ * TILE
    # a short piece from a main track to another row (the legs of a tail, of a siding): at 45 degrees, its far node moved
    # along to where that falls, on the side of the rest of its track (Giovanni 18 Nov 2026: "fai fittare il tronchetto di
    # brenta meglio")
    main_ = lambda q: abs(q[1] - YN) < 0.5 or abs(q[1] - YS) < 0.5
    for i in edges:
        e = E[i]
        if e.get('cat') == 'crossover' or i in XD: continue
        pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb: continue
        dy = abs(pa[1] - pb[1]); dx = abs(pa[0] - pb[0])
        if dy < 1 or dx >= dy - 0.5 or (main_(pa) and main_(pb)): continue
        A_, Bn = (e['a'], e['b']) if main_(pa) or not main_(pb) else (e['b'], e['a'])
        rest = [pos[m][0] for m in nbr[Bn] if m != A_ and m in pos]
        sg_ = (1 if sum(rest) / len(rest) >= pos[A_][0] else -1) if rest else (1 if pos[Bn][0] >= pos[A_][0] else -1)
        pos[Bn][0] = pos[A_][0] + sg_ * dy
    # the tracks to and from the depot at San Donato (Giovanni 18 Nov 2026: "manca il binario di rientro in deposito e di
    # entrata dal deposito"): the first bit of each, on from where it leaves the line, to the sign of the depot (ROD)
    depot_stub = {}
    for i in DEP_STUBS:
        e = E[i]; n_in = e['a'] if e['a'] in pos else e['b'] if e['b'] in pos else None
        if n_in is None: continue
        n_out = e['b'] if n_in == e['a'] else e['a']; px, py = pos[n_in]
        ns_ = [pos[m][0] for m in nbr[n_in] if m in pos]; sgx = 1 if not ns_ or px >= sum(ns_) / len(ns_) else -1
        pos[n_out] = [px + sgx * 3 * TILE, py]; depot_stub[i] = (n_out, sgx)
    # a piece going from one row to another (a station's third track, a tail, a siding): at 45 degrees where it leaves the
    # track it comes from (the end on binario 1 or 2, or its node a), then level (Giovanni 16 Nov 2026: binario 3 of San
    # Donato runs beside binario 2 along the platform)
    for n_, p_ in LINE_MANUAL['nodes'].items():
        if n_ in pos: pos[n_] = list(p_)
    via = {}
    for i in edges:
        e = E[i]
        if e.get('cat') == 'crossover': continue
        pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb: continue
        dy = abs(pa[1] - pb[1]); dx = abs(pa[0] - pb[0])
        if dy < 1 or dx < dy + 8: continue
        main_ = lambda q: abs(q[1] - YN) < 0.5 or abs(q[1] - YS) < 0.5
        A_, B_ = (pb, pa) if main_(pb) and not main_(pa) else (pa, pb)          # (A_: where it leaves the track)
        sx = 1 if B_[0] > A_[0] else -1; turn = [round(A_[0] + sx * dy, 1), B_[1]]
        via[str(i)] = [turn] if A_ is pa else [turn]
    for i, v_ in LINE_MANUAL['via'].items():
        if v_: via[str(i)] = v_
        else: via.pop(str(i), None)
    def drawn_x(ei, f):
        e = E[ei]; pa, pb = pos[e['a']], pos[e['b']]; pts = [pa] + via.get(str(ei), []) + [pb]
        L = [math.dist(pts[k - 1], pts[k]) for k in range(1, len(pts))]; x_ = f * sum(L)
        for k, l in enumerate(L):
            if x_ <= l or k == len(L) - 1: u = x_ / l if l else 0; return (pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u)
            x_ -= l
    # fmap: the pieces drawn level, metres -> drawing
    fmap = {}
    # (and the pieces that go from one row to another and then on level, when along them the drawing goes one way only:
    # a point falls where its place along the line is, so the signals on them stand by those of the other tracks)
    def drawn_u(pts_, xx):
        L_ = [math.dist(pts_[k_ - 1], pts_[k_]) for k_ in range(1, len(pts_))]; T_ = sum(L_) or 1; acc = 0.0
        for k_ in range(1, len(pts_)):
            (ax, _), (bx, _) = pts_[k_ - 1], pts_[k_]
            if (ax - xx) * (bx - xx) <= 0 and abs(bx - ax) > 1e-6: return (acc + L_[k_ - 1] * (xx - ax) / (bx - ax)) / T_
            acc += L_[k_ - 1]
        return 0.0 if abs(xx - pts_[0][0]) < abs(xx - pts_[-1][0]) else 1.0
    for i in edges:
        e = E[i]; pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb or abs(pb[0] - pa[0]) < 8 or e['a'] not in nearn or e['b'] not in nearn: continue
        dpts = [pa] + via.get(str(i), []) + [pb]; level = abs(pa[1] - pb[1]) <= 0.5
        if not level and not all((dpts[k_][0] - dpts[k_ - 1][0]) * (pb[0] - pa[0]) >= 0 for k_ in range(1, len(dpts))): continue
        P = polys[i]; C = [0.0]
        for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
        k = max(2, int(C[-1] / 10)); pts = []
        for t in range(k + 1):
            u = t / k * C[-1]; j = next((jj for jj in range(1, len(P)) if C[jj] >= u), len(P) - 1); q = (u - C[j - 1]) / ((C[j] - C[j - 1]) or 1)
            s__ = where_xy(P[j - 1][0] + (P[j][0] - P[j - 1][0]) * q, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * q)[1]
            xx = X(TS(s__) if (e['a'] in nS or e['b'] in nS) and onS(i) else s__)
            pts.append([round(t / k, 3), round(min(1, max(0, (xx - pa[0]) / (pb[0] - pa[0]) if level else drawn_u(dpts, xx))), 3)])
        # (not when the piece does not span its own drawing: a short leg of an X crossing whose metres all fall outside it,
        # its map all 0 and the piece not drawn at all, edges 199 and 202 at Brenta)
        if abs(pts[-1][1] - pts[0][1]) < 0.05: continue
        if any(abs(a_ - b_) > 0.02 for a_, b_ in pts): fmap[str(i)] = pts
    # San Donato (Giovanni 18 Nov 2026): the departure signals of binario 3 and binario 2 at the same height
    for a_n, b_n in SAME_X:
        A_ = next((x_ for x_ in sig if x_['n'] == a_n), None); B_ = next((x_ for x_ in sig if x_['n'] == b_n), None)
        if not A_ or not B_: continue
        eb = E[B_['e']]; pb_ = [pos[eb['a']]] + via.get(str(B_['e']), []) + [pos[eb['b']]]
        mb = fmap.get(str(B_['e'])); fb = B_['f']
        if mb:
            k_ = next((k_ for k_ in range(1, len(mb)) if B_['f'] <= mb[k_][0]), len(mb) - 1); (t0_, u0_), (t1_, u1_) = mb[k_ - 1], mb[k_]
            fb = u0_ + (u1_ - u0_) * max(0, min(1, (B_['f'] - t0_) / ((t1_ - t0_) or 1)))
        xb = drawn_x(B_['e'], fb)[0]
        ea = E[A_['e']]; pa_ = [pos[ea['a']]] + via.get(str(A_['e']), []) + [pos[ea['b']]]; ua = drawn_u(pa_, xb)
        ma = [m1 for m1 in fmap.get(str(A_['e']), [[0, 0], [1, 1]]) if abs(m1[0] - A_['f']) > 0.01]
        ma = sorted(ma + [[A_['f'], round(ua, 3)]]); ma = [m1 for k_, m1 in enumerate(ma) if all(m1[1] >= m0[1] for m0 in ma[:k_]) and all(m1[1] <= m2[1] for m2 in ma[k_ + 1:])]
        fmap[str(A_['e'])] = ma
    badges = []
    ldeg = collections.Counter(n for i in edges for n in (E[i]['a'], E[i]['b']))
    for i in edges:
        if E[i].get('cat') != 'link': continue
        for n in (E[i]['a'], E[i]['b']):
            if ldeg[n] == 1 and not any(abs(b_['x'] - pos[n][0]) < 4 and abs(b_['y'] - pos[n][1]) < 4 for b_ in badges):
                badges.append({'text': 'M2', 'x': pos[n][0], 'y': pos[n][1], 'kind': 'm2'})
    for i, (n_out, sgx) in depot_stub.items():
        badges.append({'text': 'ROD', 'x': pos[n_out][0] + sgx * 20, 'y': pos[n_out][1], 'kind': 'rod'})
    nice = lambda nm: {'DUOMO M3': 'Duomo'}.get(nm, ' '.join(w if w in ('FS', 'FN', 'T.I.B.B.') else w.capitalize() for w in nm.split()))
    labels, platforms = [], []
    top = min(v[1] for v in pos.values())
    # the tracks by name: the places of the itineraries (data/itineraries_m3.json: "banchina Sondrio binario 1", "Comasina
    # tronchetto 1 posizione 2"...); the pieces without one by what they are
    IT = json.load(open(os.path.join(ROOT, 'data', 'itineraries_m3.json')))['itineraries']
    NM = {}
    for x in IT:
        if not x['edges']: continue
        for nm_, ei in ((x['to'], x['edges'][-1][0]), (x['frm'], x['edges'][0][0])):
            nm_ = re.sub(r' posizione \d+$', '', nm_)
            if ei in set(edges) and (ei not in NM or len(nm_) > len(NM[ei]) and 'lato' not in nm_): NM[ei] = nm_
    names_e = {}
    for i in edges:
        e = E[i]; nm_ = NM.get(i)
        if not nm_: nm_ = 'binario 2' if i in north_e else 'binario 1' if i in south_e else {'crossover': 'comunicazione', 'link': 'raccordo M2', 'siding': 'binario di servizio'}.get(e.get('cat'), e.get('cat'))
        names_e[str(i)] = nm_
    for i in depot_stub: names_e[str(i)] = 'binario del deposito (ROD)'
    # the tails (Giovanni: "segna i tronchetti sempre di grigio… con la scritta sopra in piccolo tronchetto 1 o tronchetto 2
    # (comasina pos 1 - pos 2..)"): the pieces that end a train's run, their name, at Comasina their positions (where the
    # itineraries to "posizione 1, 2" end: the signals; the third up to the end)
    tails = []
    for i in edges:
        nm_ = NM.get(i, '')
        if not re.search(r'tronchett|tronchino|rimessa', nm_): continue
        e = E[i]; pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb: continue
        short = re.sub(r'^(San Donato|Comasina|Brenta|Centrale|Repubblica) ', '', nm_).replace(' di ricovero (A33)', '')
        # (the name small above the track, Giovanni 18 Nov 2026: "tronchino centrale deve esserci scritto sopra"; the two
        # San Donato tails, side by side between the tracks, their name beyond the end of the track: "san donato
        # tronchetto 1 e 2 bisogna trovare il modo di fittarlo senza che sia in mezzo")
        t = {'e': i, 'text': short, 'x': round((pa[0] + pb[0]) / 2, 1), 'y': min(pa[1], pb[1]) - 8, 'pos': []}
        dead = [q for q in (e['a'], e['b']) if len(nbr[q]) == 1]
        if nm_.startswith('San Donato') and dead:
            q_ = pos[dead[0]]; o_ = pos[e['b'] if dead[0] == e['a'] else e['a']]; sx_ = 1 if q_[0] >= o_[0] else -1
            t.update({'text': short.capitalize(), 'x': round(q_[0] + sx_ * 10, 1), 'y': q_[1] + 3, 'anchor': 'start' if sx_ > 0 else 'end'})
        ends = sorted({sg_.get('n') for x in IT if x['edges'] and x['edges'][-1][0] == i and x.get('end_signal') for sg_ in [{'n': x['end_signal']}]})
        if ends:
            fs = sorted({sgx['f'] for sgx in sig if sgx['e'] == i and sgx['n'] in ends})
            entry_a = any(x['edges'][-1][1] == e['a'] for x in IT if x['edges'] and x['edges'][-1][0] == i)
            cuts = ([0.0] + fs + [1.0]) if entry_a else ([1.0] + fs[::-1] + [0.0])
            for k in range(len(cuts) - 1):
                f_ = (cuts[k] + cuts[k + 1]) / 2
                t['pos'].append({'text': 'pos %d' % (k + 1), 'x': round(pa[0] + (pb[0] - pa[0]) * f_, 1), 'y': min(pa[1], pb[1]) - 9})
        tails.append(t)
    # the platforms: binari 1 and 2 at every station; at San Donato also binario 3 (the labels of the map: binari 1, 2, 3)
    def on_edge(ei, la, lo, half_m):
        P = polys[ei]; x_, y_ = lo * KX, la * KY; C = [0.0]
        for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
        best = None
        for j in range(1, len(P)):
            ax, ay = P[j - 1]; bx, by = P[j]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1; u = max(0, min(1, ((x_ - ax) * dx + (y_ - ay) * dy) / L2))
            dd = math.hypot(x_ - ax - u * dx, y_ - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, C[j - 1] + u * (C[j] - C[j - 1]))
        L = C[-1] or 1; return max(0, (best[1] - half_m) / L), min(1, (best[1] + half_m) / L)
    SDE = {}
    for nm_, ei in ((v, k) for k, v in NM.items()):
        m_ = re.match(r'San Donato binario (\d)', nm_)
        if m_: SDE[m_.group(1)] = ei
    sd_done = False; nZN = len([i for i in ZN])
    for kp, (nm, pn) in enumerate(plats):
        xa, xb = sorted((X(pn[0]), X(pn[1])))
        if nm == names[0] and SDE and d.get('labels'):
            if sd_done: continue
            sd_done = True
            for lb in d['labels']:
                ei = SDE.get(lb['t']); e = E[ei] if ei is not None else None
                if not e or e['a'] not in pos or e['b'] not in pos: continue
                f0, f1 = on_edge(ei, lb['la'], lb['lo'], TRAIN / 2 + 5); q0, q1 = drawn_x(ei, f0), drawn_x(ei, f1)
                # (the three side by side, as they are: where the game's platform is on binario 2)
                # (on the row of its track where it runs level: binario 3 four rows up)
                yb = e['b'] in pos and pos[e['b']][1]; ya_ = pos[e['a']][1]
                platforms.append({'st': nice(nm), 'x0': xa, 'x1': xb, 'y': ya_ if abs(ya_ - YN) > 0.5 and abs(ya_ - YS) > 0.5 else yb if abs(yb - YN) > 0.5 and abs(yb - YS) > 0.5 else q1[1], 'bin': lb['t']})
            labels.append({'text': nice(nm), 'x': round((xa + xb) / 2, 1), 'y': min(YN - 2 * ROW, top - ROW) - 6})
            continue
        north = kp < nZN
        platforms.append({'st': nice(nm), 'x0': xa, 'x1': xb, 'y': YN if north else YS, 'bin': '2' if north else '1'})
        if north: labels.append({'text': nice(nm), 'x': round((xa + xb) / 2, 1), 'y': min(YN - 2 * ROW, top - ROW) - 6})
    out = {'_about': 'Sinottico della linea M3, rifatto da zero (tools/sinottico.py linea; Giovanni 16/11/2026): una riga sola da San '
                     'Donato a Comasina (Comasina a sinistra), tutte le tratte che non sono del deposito e tutti i loro segnali; non in '
                     'scala: tra due cose da vedere (nodo, segnale, fine banchina) almeno 34 px, scambi più grandi, banchina 150 px, '
                     'binario in piano 0,3 px al metro (al massimo 300 px). Binario 2 (verso Comasina) sopra, binario 1 (verso San '
                     'Donato) sotto, quattro righe di 28 px in mezzo (Giovanni 18/11/2026: tutti i semafori del gioco, quelli di ogni stazione '
                     'subito fuori dalla banchina, banchine dei due binari allineate, incroci a X sui tasselli, San Donato con i 4 binari, '
                     'tronchetti di Comasina sulle righe dei binari, i binari del deposito fino al cartello ROD). nodes = dove sta ogni nodo (px), via = curve (si aggiungono '
                     'nell\'editor), fmap = dove cade ogni punto di una tratta in piano, platforms = le banchine, badges = il logo M2.',
           'tile': [TILE, 0, YN], 'edges': edges + [i for i in depot_stub], 'nodes': {str(n): pos[n] for n in sorted(pos)}, 'via': via, 'part': {str(i): [0, 1] for i in depot_stub}, 'fmap': fmap,
           'signals': sig, 'places': [], 'labels': labels, 'platforms': platforms, 'badges': badges, 'strips': None,
           'tails': tails, 'names': names_e}
    OUT = os.path.join(ROOT, 'data', 'sinottico_linea_m3.json')
    out['deco'] = keep_deco(OUT); json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('sinottico della linea: %d tratte, %d nodi (%d fuori dalla linea), %d segnali, %d stazioni, %d loghi M2, una riga larga %d px (la linea %d m)'
          % (len(edges), len(pos), len(far), len(sig), len(labels), len(badges), X0, TOT))


def strisce(S, E, n=4, h=210, lead=30):
    """the line on n strips one under the other (Giovanni 16 Nov 2026: all the line on one screen): the cuts where only the two
    main tracks pass (no switch or node within 20 px, no platform within 12 px, no M2 logo), as near as can be to strips
    of the same width. Only where the drawing is cut: the nodes keep their places (the web page moves each strip)"""
    N, V = S['nodes'], S.get('via') or {}
    xs = [v[0] for v in N.values()]; X0, X1 = min(xs), max(xs)
    bad = [(p['x0'] - 12, p['x1'] + 12) for p in S.get('platforms', [])] + [(v[0] - 20, v[0] + 20) for v in N.values()] + \
          [(b['x'] - 20, b['x'] + 20) for b in S.get('badges', [])]
    polys = []
    for ei in S['edges']:
        a, b = str(E[ei]['a']), str(E[ei]['b'])
        if a in N and b in N: polys.append([q[0] for q in [N[a]] + list(V.get(str(ei)) or []) + [N[b]]])
    free = [x for x in range(int(X0) + 50, int(X1) - 50) if not any(a <= x <= b for a, b in bad)
            and sum(1 for P in polys if min(P) < x < max(P)) == 2]
    # (each cut at the free x nearest to where the strips would be equal; then in the middle of its free stretch)
    best, cs = None, []
    for k in range(1, n):
        t = X0 + (X1 - X0) * k / n; ok = [x for x in free if not cs or x > cs[-1] + 200]
        if not ok: break
        cs.append(min(ok, key=lambda x: abs(x - t)))
    if len(cs) == n - 1:
        w = [cs[0] - X0] + [cs[i + 1] - cs[i] for i in range(len(cs) - 1)] + [X1 - cs[-1]]; best = (max(w), cs, w)
    if not best: return None
    # (each cut in the middle of its free stretch, as far as can be from the switches and the platforms: Sondrio)
    fs = set(free); cs = []
    for c in best[1]:
        lo, hi = c, c
        while lo - 1 in fs: lo -= 1
        while hi + 1 in fs: hi += 1
        cs.append((lo + hi) // 2)
    w = [cs[0] - X0] + [cs[i + 1] - cs[i] for i in range(len(cs) - 1)] + [X1 - cs[-1]]
    if max(w) <= best[0] * 1.03: best = (max(w), cs, w)
    print('strisce: tagli a x %s, larghe %s px' % (best[1], [round(v) for v in best[2]]))
    return {'cuts': best[1], 'h': h, 'lead': lead, '_about': 'tagli del disegno in tre strisce (tools/sinottico.py strisce): solo binari di corsa, niente scambi né banchine'}


def strisce_file(m3='m3.json'):
    """only the strips, on the file as it is (with the nodes moved by hand in the editor)"""
    _, net = load(m3); F = os.path.join(ROOT, 'data', 'sinottico_linea_m3.json'); S = json.load(open(F))
    S['strips'] = strisce(S, net['edges']); json.dump(S, open(F, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else ''
    if what == 'deposito': deposito()
    elif what == 'tutto': deposito(); linea()
    elif what == 'linea': linea()
    elif what == 'strisce': strisce_file()
    else: print(__doc__)
