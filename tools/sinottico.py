"""Tools for the sinottici (the control-room drawings) of the M3: the depot of San Donato and the line.

    cd build && python3 ../tools/sinottico.py tutto         # both, from zero (what the editor changed is lost: export it first)
    cd build && python3 ../tools/sinottico.py deposito      # the depot only
    cd build && python3 ../tools/sinottico.py linea         # the line only
    cd build && python3 ../tools/sinottico.py strisce       # the line cut in strips (later, when Giovanni says where)

Both read m3.json (a build) and write a file in data/ that the page draws (Editor dei binari, tab Sinottico: the nodes and
the bends are moved by hand there, "Più punti" gives the pieces of the chosen nodes more points, and the file is exported
again). The build never runs this tool, so the hand work stays.

Made again from zero on 16 Nov 2026 (Giovanni: "facciamolo ripartire da 0… metti tutti i binari giù… fai una riga che poi
dividiamo… fai il piano più grande… uguale per il deposito"): every piece of the track is in one of the two drawings (the
depot: the yard and the test loop in the box of San Donato; the line: everything else, the M2 link and the track to the
depot included) and every signal on them; tests/sinottico_check.py fails the build when one is missing.

The file: nodes = where each node of the track is in the drawing (px); edges = the track pieces drawn, from node to node;
via = bends of a piece (px, in order from its node a to its node b); part = a piece drawn only in part ([from, to], 0-1
from node a); signals = the piece each signal is on and how far along (0-1); places = the depot places by node; labels =
names written in the drawing; platforms, badges, fmap: the line's.
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


# the depot (Giovanni 16 Nov 2026, from zero: "metti tutti i binari giù… fai il piano più grande… uguale per il
# deposito"): its own pieces are the yard and the test loop in the box of San Donato; every other piece is the line's
DEP_BOX = (45.4272, 45.4345, 9.2505, 9.2610)


def split(net):
    """the pieces of the depot drawing and of the line drawing: each piece of the track in exactly one of them"""
    E, N = net['edges'], net['nodes']
    inb = lambda n: DEP_BOX[0] <= N[str(n)][0] <= DEP_BOX[1] and DEP_BOX[2] <= N[str(n)][1] <= DEP_BOX[3]
    dep = [i for i, e in enumerate(E) if e.get('cat') in ('yard', 'test') and inb(e['a']) and inb(e['b'])]
    ds = set(dep)
    return dep, [i for i in range(len(E)) if i not in ds]


def deposito(m3='m3.json'):
    """the depot from zero: the real track turned so that the shed tracks lie level, bigger (2.4 px a metre along, one
    row of 28 px for each 4 m across), every piece of the yard and of the test loop, the signals on them; the page draws
    each piece level then at 45 degrees; the nodes and the bends then moved by hand in the editor"""
    d, net = load(m3); E, NODES = net['edges'], net['nodes']
    DEP, _ = split(net); nodes = sorted({E[i]['a'] for i in DEP} | {E[i]['b'] for i in DEP})
    xy = lambda n: (NODES[str(n)][1] * KX, NODES[str(n)][0] * KY)
    acc = [0.0, 0.0]
    for i in DEP:
        e = E[i]
        if e.get('cat') != 'yard' or e['len'] < 40: continue
        (x0, y0), (x1, y1) = xy(e['a']), xy(e['b']); a = math.atan2(y1 - y0, x1 - x0) * 2
        acc[0] += math.cos(a) * e['len']; acc[1] += math.sin(a) * e['len']
    th = math.atan2(acc[1], acc[0]) / 2; c, s_ = math.cos(-th), math.sin(-th)
    rot = {n: (xy(n)[0] * c - xy(n)[1] * s_, xy(n)[0] * s_ + xy(n)[1] * c) for n in nodes}
    SX, ROW_M, SY = 2.4, 4.0, 28.0
    ymax = max(v[1] for v in rot.values()); xmin = min(v[0] for v in rot.values())
    # (along: 2.4 px a metre, but two nodes never less than 18 px apart: the joints in the middle of a place, 2-3 m)
    xs = sorted({round(v[0], 1) for v in rot.values()}); K = [xs[0]]
    for x in xs[1:]:
        if x - K[-1] > 0.3: K.append(x)
    XK = [60.0]
    for i in range(1, len(K)): XK.append(XK[-1] + max(18.0, (K[i] - K[i - 1]) * SX))
    def xat(x):
        i = min(range(len(K)), key=lambda j: abs(K[j] - x)); return round(XK[i], 1)
    pos = {n: [xat(v[0]), round((ymax - v[1]) / ROW_M) * SY + 60] for n, v in rot.items()}
    # (two nodes on the same spot of the drawing, not joined: the second one row down, until it is free)
    for _ in range(6):
        moved = 0; seen = {}
        for n in nodes:
            key = (round(pos[n][0] / 12), pos[n][1])
            if key in seen: pos[n][1] += SY; moved += 1
            else: seen[key] = n
        if not moved: break
    # the signals: on the depot's pieces and on the tails of San Donato (the agents read those from this file:
    # sdTailSig); the page draws the ones on the pieces drawn
    polys = {i: dec(e['p']) for i, e in enumerate(E)}
    near = [i for i, e in enumerate(E) if i in set(DEP) or i in set(net.get('sd_tail_edges') or [])]
    sigs = add_dirs(net, find_signals(net, near, polys))
    places = [{'node': p['node'], 'name': p['name']} for p in net.get('depot', []) if p['node'] in pos]
    S = {'_about': 'Sinottico del deposito di San Donato, rifatto da zero (Giovanni 16/11/2026): tutti i binari del deposito e '
                   'dell\'anello di prova, il binario vero girato in orizzontale e ingrandito (2,4 px al metro, una riga di 28 px '
                   'ogni 4 m); nodes = dove sta ogni nodo (px), via = curve (si aggiungono nell\'editor), signals = la tratta e '
                   'quanto lungo (0-1), places = i posti. tools/sinottico.py deposito lo rifà da capo; l\'editor lo corregge.',
         'angle_deg': round(math.degrees(th), 1), 'edges': DEP, 'nodes': {str(n): pos[n] for n in nodes}, 'via': {}, 'part': {},
         'signals': sigs, 'places': places}
    OUT = os.path.join(ROOT, 'data', 'schema_deposito_m3.json'); json.dump(S, open(OUT, 'w'), ensure_ascii=False, indent=1)
    W = max(v[0] for v in pos.values()); H = max(v[1] for v in pos.values())
    print('sinottico del deposito: %d tratte, %d nodi, %d segnali (%d sulle tratte disegnate), %d posti, %d x %d px'
          % (len(DEP), len(pos), len(sigs), sum(1 for x in sigs if x['e'] in set(DEP)), len(places), W, H))


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
    plats = [(nm, (sN[i] - TRAIN, sN[i])) for i, nm in enumerate(names)]
    sw_s = sorted(W[n][1] for n in nearn if deg[n] >= 3)
    sig = add_dirs(net, find_signals(net, edges, polys))
    def sig_s(sg):
        P = polys[sg['e']]; C = [0.0]
        for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
        u = sg['f'] * C[-1]; j = next((i for i in range(1, len(P)) if C[i] >= u), len(P) - 1); q = (u - C[j - 1]) / ((C[j] - C[j - 1]) or 1)
        x, y = P[j - 1][0] + (P[j][0] - P[j - 1][0]) * q, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * q
        return where_xy(x, y)
    # the things to see along the line (only those near it: a signal on the track to the depot is placed with it)
    ev = [0.0, TOT] + [W[n][1] for n in nearn] + [x for p in plats for x in p[1]]
    ev += [w[1] for w in (sig_s(sg) for sg in sig) if w[0] <= NEAR]
    ev = sorted(ev); K = [ev[0]]
    for x in ev[1:]:
        if x - K[-1] > 0.5: K.append(x)
    MIN, PLAT, PXM, CAP, ZONE = 34.0, 150.0, 0.3, 300.0, 70.0
    def width(a, b):
        L = b - a; m = (a + b) / 2
        for _, (p0, p1) in plats:
            if p0 - 0.5 <= m <= p1 + 0.5: return max(MIN * min(1.0, L / 3), L * PLAT / TRAIN)
        if any(abs(m - x) <= ZONE for x in sw_s): return max(MIN, L * 1.3)
        return max(MIN, min(CAP, L * PXM))
    XK = [0.0]
    for i in range(1, len(K)): XK.append(XK[-1] + width(K[i - 1], K[i]))
    X0 = XK[-1] + 80                                      # (Comasina on the left)
    def X(s_):
        s_ = max(K[0], min(K[-1], s_)); i = max(1, next((j for j in range(1, len(K)) if K[j] >= s_), len(K) - 1))
        u = (s_ - K[i - 1]) / ((K[i] - K[i - 1]) or 1); return round(X0 - (XK[i - 1] + (XK[i] - XK[i - 1]) * u), 1)
    ROW = 28.0; YN = 200.0; YS = YN + 3 * ROW
    def side_to(P, x, y):
        best = None
        for i in range(0, len(P) - 1, 2):
            _, ax, ay = P[i]; _, bx, by = P[min(i + 2, len(P) - 1)]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, (dx * (y - ay) - dy * (x - ax)) / math.sqrt(L2))
        return best[1]
    mid_ = SS[len(SS) // 2]; refN = 1 if side_to(S2, mid_[1], mid_[2]) > 0 else -1
    midn = S2[len(S2) // 2]; refS = 1 if side_to(SS, midn[1], midn[2]) > 0 else -1
    pos = {}
    for n in nearn:
        x = X(W[n][1])
        if on(n, north_e): y = YN
        elif on(n, south_e): y = YS
        else:
            nx_, ny_ = NODES[str(n)][1] * KX, NODES[str(n)][0] * KY; a_ = side_to(S2, nx_, ny_) * refN; b_ = side_to(SS, nx_, ny_) * refS
            y = YN + ROW if a_ > 0.5 and b_ > 0.5 else YS + ROW if a_ > 0 else YN - ROW
        pos[n] = [x, y]
    # the crossovers at 45 degrees about their middle
    for i in edges:
        e = E[i]
        if e.get('cat') != 'crossover': continue
        pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb or abs(pa[1] - pb[1]) < 1: continue
        dy = abs(pa[1] - pb[1]); sg = 1 if pb[0] >= pa[0] else -1; mid = (pa[0] + pb[0]) / 2
        pa[0] = round(mid - sg * dy / 2, 1); pb[0] = round(mid + sg * dy / 2, 1)
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
                sx = 1 if X(W[n][1]) >= px else -1
                pos[n] = [round(px + sx * max(60.0, min(240.0, e['len'] * PXM)), 1), py + out * 2 * ROW if py in (YN, YS) or py < YN or py > YS else py + 2 * ROW]
                far.append(n); break
    # fmap: the pieces drawn level, metres -> drawing
    fmap = {}
    for i in edges:
        e = E[i]; pa, pb = pos.get(e['a']), pos.get(e['b'])
        if not pa or not pb or abs(pa[1] - pb[1]) > 0.5 or abs(pb[0] - pa[0]) < 8 or e['a'] not in nearn or e['b'] not in nearn: continue
        P = polys[i]; C = [0.0]
        for j in range(1, len(P)): C.append(C[-1] + math.dist(P[j - 1], P[j]))
        k = max(2, int(C[-1] / 10)); pts = []
        for t in range(k + 1):
            u = t / k * C[-1]; j = next((jj for jj in range(1, len(P)) if C[jj] >= u), len(P) - 1); q = (u - C[j - 1]) / ((C[j] - C[j - 1]) or 1)
            xx = X(where_xy(P[j - 1][0] + (P[j][0] - P[j - 1][0]) * q, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * q)[1])
            pts.append([round(t / k, 3), round(min(1, max(0, (xx - pa[0]) / (pb[0] - pa[0]))), 3)])
        if any(abs(a_ - b_) > 0.02 for a_, b_ in pts): fmap[str(i)] = pts
    badges = []
    ldeg = collections.Counter(n for i in edges for n in (E[i]['a'], E[i]['b']))
    for i in edges:
        if E[i].get('cat') != 'link': continue
        for n in (E[i]['a'], E[i]['b']):
            if ldeg[n] == 1 and not any(abs(b_['x'] - pos[n][0]) < 4 and abs(b_['y'] - pos[n][1]) < 4 for b_ in badges):
                badges.append({'text': 'M2', 'x': pos[n][0], 'y': pos[n][1], 'kind': 'm2'})
    nice = lambda nm: {'DUOMO M3': 'Duomo'}.get(nm, ' '.join(w if w in ('FS', 'FN', 'T.I.B.B.') else w.capitalize() for w in nm.split()))
    labels, platforms = [], []
    top = min(v[1] for v in pos.values())
    for nm, pn in plats:
        xa, xb = sorted((X(pn[0]), X(pn[1])))
        platforms += [{'st': nice(nm), 'x0': xa, 'x1': xb, 'y': YN, 'bin': '2'}, {'st': nice(nm), 'x0': xa, 'x1': xb, 'y': YS, 'bin': '1'}]
        labels.append({'text': nice(nm), 'x': round((xa + xb) / 2, 1), 'y': min(YN - 2 * ROW, top - ROW) - 6})
    out = {'_about': 'Sinottico della linea M3, rifatto da zero (tools/sinottico.py linea; Giovanni 16/11/2026): una riga sola da San '
                     'Donato a Comasina (Comasina a sinistra), tutte le tratte che non sono del deposito e tutti i loro segnali; non in '
                     'scala: tra due cose da vedere (nodo, segnale, fine banchina) almeno 34 px, scambi più grandi, banchina 150 px, '
                     'binario in piano 0,3 px al metro (al massimo 300 px). Binario 2 (verso Comasina) sopra, binario 1 (verso San '
                     'Donato) sotto, tre righe di 28 px in mezzo. nodes = dove sta ogni nodo (px), via = curve (si aggiungono '
                     'nell\'editor), fmap = dove cade ogni punto di una tratta in piano, platforms = le banchine, badges = il logo M2.',
           'edges': edges, 'nodes': {str(n): pos[n] for n in sorted(pos)}, 'via': {}, 'part': {}, 'fmap': fmap,
           'signals': sig, 'places': [], 'labels': labels, 'platforms': platforms, 'badges': badges, 'strips': None}
    OUT = os.path.join(ROOT, 'data', 'sinottico_linea_m3.json')
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
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
