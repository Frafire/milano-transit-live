"""The M2 tracks without corners (Giovanni 18 Nov 2026: "i binari sono frastagliati, alcuni scambi sono stranissimi, devono
essere più smooth", as done for the M3 in tools/router.py). Run in an M2 build folder (build_m2/<day>) after
tools/depositi_m2.py and before tools/net_m2.py: reads m2.json, writes it again with the tracks rounded, and keeps the
tracks as they were in m2_tracks_osm.json (for tests/m2_lisci_check.py).

- Every track is cut at its junctions (the points another track also passes through: switches, crossings): those
  points do not move, so the pieces of tools/net_m2.py and the speed limits keyed on them stay the same.
- The tracks that run on into each other (OSM cuts them at every switch) are chained, resampled every metre and
  smoothed (a gaussian of SIGMA m), then bent back exactly onto their junctions and ends with smooth bumps (FADE m); never more than SMOOTH_MAX (0.5 m, as on the M3) off the OSM line on the main line,
  1 m on sidings and crossovers, 1.5 m in the depots.
- Switches: a track that leaves another at a switch (the branch at a junction of three) starts along the track it
  leaves, as a real turnout does, and bends into its OSM line on a smooth curve, at most SWITCH_MAX (1 m) off it; where
  OpenStreetMap already has it leaving at a small angle (under SWITCH_MIN degrees) it is left as it is.
Usage: python3 tools/lisci_m2.py"""
import json, math, os, collections

SMOOTH_MAX = float(os.environ.get('SMOOTH_MAX', '0.5')); SMOOTH_KEEP = 12.0
SWITCH_MAX = float(os.environ.get('SWITCH_MAX', '1.0')); SWITCH_MIN = 3.0
F = json.load(open('m2.json'))
LAT0 = 45.47; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def decode(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((a / 1e6, b / 1e6))
    return o
def encode(P):
    flat, pa, pb = [], 0, 0
    for a, b in P:
        A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    return flat
key = lambda q: (round(q[0], 6), round(q[1], 6))
toxy = lambda q: (q[1] * KX, q[0] * KY)
toll = lambda p: (p[1] / KY, p[0] / KX)
dist = lambda a, b: math.hypot(b[0] - a[0], b[1] - a[1])
def plen(P): return sum(dist(P[i - 1], P[i]) for i in range(1, len(P)))

json.dump([{'w': t['w'], 'c': t['c'], 'p': t['p']} for t in F['tracks']], open('m2_tracks_osm.json', 'w'), separators=(',', ':'))

# the junctions: the points used by more than one track, or twice by the same one
use = collections.Counter(); arms = collections.defaultdict(list)
TR = [(t, decode(t['p'])) for t in F['tracks']]
for t, P in TR:
    for i, q in enumerate(P):
        use[key(q)] += 1
        if i > 0: arms[key(q)].append(P[i - 1])
        if i < len(P) - 1: arms[key(q)].append(P[i + 1])
JUNC = {k for k, n in use.items() if n > 1 and len(arms[k]) >= 3}

CAP = {"main": SMOOTH_MAX, "siding": 1.0, "crossover": 1.0, "yard": 1.5}; SIGMA = 6.0; FADE = 3.0
def smooth(P, pins, cap):
    """P in metres, the indices in pins stay where they are: the track resampled every metre, each point moved to the
    gaussian mean of its neighbours (SIGMA m), less and less near a pinned point (none on it), then pulled back to at
    most cap metres from the OSM line; Douglas-Peucker at 5 cm to keep the points few"""
    if len(P) < 3: return P
    D, pin = [P[0]], [True]
    for i in range(1, len(P)):
        l = dist(P[i - 1], P[i]); n = max(1, int(l))
        for j in range(1, n + 1): D.append((P[i - 1][0] + (P[i][0] - P[i - 1][0]) * j / n, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * j / n)); pin.append(j == n and i in pins)
    pin[-1] = True
    S = [0.0]
    for i in range(1, len(D)): S.append(S[-1] + dist(D[i - 1], D[i]))
    PINS = [S[i] for i, f in enumerate(pin) if f]
    W = int(3 * SIGMA) + 1; G = []
    for i, q in enumerate(D):                            # the gaussian mean of the neighbours, pins ignored
        sx = sy = sw = 0.0
        for j in range(max(0, i - W), min(len(D), i + W + 1)):
            w = math.exp(-((S[j] - S[i]) / SIGMA) ** 2 / 2); sx += w * D[j][0]; sy += w * D[j][1]; sw += w
        G.append((sx / sw, sy / sw))
    # then bent back onto the pinned points with smooth bumps (no corner left at a junction): the residual at each
    # pin, spread around it as a gaussian of FADE m, a few rounds so that pins close together all come out exact
    PI = [i for i, f in enumerate(pin) if f]
    for it in range(6):
        R = {i: (D[i][0] - G[i][0], D[i][1] - G[i][1]) for i in PI}
        if max(math.hypot(*r) for r in R.values()) < 1e-4: break
        Wc = int(3 * FADE) + 1; G2 = list(G)
        for p_, r in R.items():
            for j in range(max(0, p_ - Wc), min(len(D), p_ + Wc + 1)):
                w = math.exp(-((S[j] - S[p_]) / FADE) ** 2 / 2); G2[j] = (G2[j][0] + w * r[0], G2[j][1] + w * r[1])
        G = G2
    out = []
    for i, q in enumerate(D):
        if pin[i]: out.append(q); continue
        m = G[i]
        d = off(P, m)
        if d > cap:                                      # (back towards the OSM line: the nearest point of it)
            best, bq = 1e9, q
            for k in range(1, len(P)):
                A_, B_ = P[k - 1], P[k]; dx, dy = B_[0] - A_[0], B_[1] - A_[1]; l2 = dx * dx + dy * dy or 1
                u = max(0, min(1, ((m[0] - A_[0]) * dx + (m[1] - A_[1]) * dy) / l2)); c_ = (A_[0] + u * dx, A_[1] + u * dy)
                dd = dist(c_, m)
                if dd < best: best, bq = dd, c_
            m = (bq[0] + (m[0] - bq[0]) * cap / d, bq[1] + (m[1] - bq[1]) * cap / d)
        out.append(m)
    keep = [i for i, f in enumerate(pin) if f]
    return dp(out, keep)
def smooth2(P, pins, cap):
    """smooth() for a chain of tracks: also the index in the result of each point of P that was pinned"""
    out = smooth(P, pins, cap); where = {}; j = 0
    for i in sorted(pins | {0, len(P) - 1}):
        while j < len(out) and dist(out[j], P[i]) > 1e-6: j += 1
        where[i] = j
    return out, where
def dp(Q, keep, tol=0.05):
    """Douglas-Peucker, the indices in keep always kept"""
    mark = [False] * len(Q)
    for k in keep: mark[k] = True
    mark[0] = mark[-1] = True
    stack = []; idx = [i for i, m in enumerate(mark) if m]
    for a_, b_ in zip(idx, idx[1:]): stack.append((a_, b_))
    while stack:
        a_, b_ = stack.pop()
        if b_ - a_ < 2: continue
        A_, B_ = Q[a_], Q[b_]; dx, dy = B_[0] - A_[0], B_[1] - A_[1]; l = math.hypot(dx, dy) or 1
        far, fi = 0, -1
        for i in range(a_ + 1, b_):
            d = abs((Q[i][0] - A_[0]) * dy - (Q[i][1] - A_[1]) * dx) / l
            if d > far: far, fi = d, i
        if far > tol: mark[fi] = True; stack += [(a_, fi), (fi, b_)]
    return [q for q, m in zip(Q, mark) if m]


def at(P, s):
    """the point s metres along P, and the direction there"""
    for i in range(1, len(P)):
        l = dist(P[i - 1], P[i])
        if s <= l or i == len(P) - 1:
            f = min(1.0, s / l) if l else 0; d = ((P[i][0] - P[i - 1][0]) / (l or 1), (P[i][1] - P[i - 1][1]) / (l or 1))
            return (P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1])), d, i
        s -= l
def off(P, q):
    best = 1e9
    for k in range(1, len(P)):
        A, B = P[k - 1], P[k]; dx, dy = B[0] - A[0], B[1] - A[1]; l2 = dx * dx + dy * dy or 1
        u = max(0, min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / l2))
        best = min(best, math.hypot(q[0] - A[0] - u * dx, q[1] - A[1] - u * dy))
    return best

def switch_start(P, J, own):
    """P starts at the junction J (a switch): start it along the track it leaves, then a cubic curve into its OSM line"""
    A = [toxy(q) for q in arms[J]]; N = toxy(J); d0 = math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0])
    if len(A) != 3: return P
    ang = lambda q: math.atan2(q[1] - N[1], q[0] - N[0])
    dif = lambda a, b: abs((a - b + math.pi) % (2 * math.pi) - math.pi)
    # the arm this piece starts on, and the two others: the branch leaves the other arm that runs nearly the same way
    others = sorted((q for q in A if dist(q, own) > 0.05), key=lambda q: dif(ang(q), d0))
    if len(others) != 2: return P
    near, far = others
    # a switch: the piece and one other arm go nearly the same way (the frog), the third goes back (the through track)
    if dif(ang(far), d0) < math.radians(150): return P
    # only the branch bends: the through route is the one of the two that runs straighter on from the third arm
    if dif(ang(far), d0) >= dif(ang(far), ang(near)): return P
    div = dif(ang(near), d0)
    if div < math.radians(SWITCH_MIN) or div > math.radians(30): return P
    T = (math.cos(ang(near)), math.sin(ang(near)))             # start along the track it leaves
    total = plen(P); best = P
    for s in (40, 34, 28, 24, 20, 16, 13, 10, 8):
        if s > total * 0.6: continue
        Q, Tq, iq = at(P, s)
        B1 = (N[0] + T[0] * s / 3, N[1] + T[1] * s / 3); B2 = (Q[0] - Tq[0] * s / 3, Q[1] - Tq[1] * s / 3)
        C = []
        for j in range(1, int(s) + 1):
            u = j / (int(s) + 1); v = 1 - u
            C.append((v ** 3 * N[0] + 3 * v * v * u * B1[0] + 3 * v * u * u * B2[0] + u ** 3 * Q[0], v ** 3 * N[1] + 3 * v * v * u * B1[1] + 3 * v * u * u * B2[1] + u ** 3 * Q[1]))
        if max(off(P, q) for q in C) <= SWITCH_MAX:
            best = [P[0]] + C + [Q] + P[iq:]; break
    return best

# the tracks of OpenStreetMap end at the switches: chain them where one runs on into the other (two ends meeting nearly
# straight, or the two ends of a switch that make the through route), so the smoothing runs across their joins
XYS = [[toxy(q) for q in P] for t, P in TR]
ends = collections.defaultdict(list); passes = collections.Counter()
for ti, (t, P) in enumerate(TR):
    ends[key(P[0])].append((ti, 0)); ends[key(P[-1])].append((ti, 1))
    for q in P[1:-1]: passes[key(q)] += 1
def outdir(ti, e):
    X = XYS[ti]; a, b = (X[0], X[1]) if e == 0 else (X[-1], X[-2]); return math.atan2(b[1] - a[1], b[0] - a[0])
link = {}
for k, E in ends.items():
    if passes[k] or len(E) < 2: continue
    pairs = sorted(((abs((outdir(*x) - outdir(*y) + math.pi) % (2 * math.pi) - math.pi), x, y) for i, x in enumerate(E) for y in E[i + 1:]), reverse=True)
    used = set()
    for a_, x, y in pairs:
        if a_ < math.radians(150) or x in used or y in used or x[0] == y[0]: continue
        link[x] = y; link[y] = x; used |= {x, y}
seen = set(); chains = []
for ti in range(len(TR)):
    if ti in seen: continue
    # walk back to the start of the chain, then forward
    cur, e = ti, 0
    while (cur, e) in link and link[(cur, e)][0] not in seen and link[(cur, e)][0] != ti:
        nx = link[(cur, e)]; cur, e = nx[0], 1 - nx[1]
        if cur == ti: break
    chain, cur, rev = [], cur, (e == 1)
    while cur not in seen:
        seen.add(cur); chain.append((cur, rev)); e_out = 0 if rev else 1
        if (cur, e_out) not in link: break
        nx = link[(cur, e_out)]; cur, rev = nx[0], nx[1] == 1
    chains.append(chain)
done = collections.Counter(); n0 = sum(len(P) for t, P in TR); n1 = 0; NEW = {}
for chain in chains:
    pts, pin, owners = [], set(), []
    for ti, rev in chain:
        X = XYS[ti][::-1] if rev else XYS[ti]; P = TR[ti][1][::-1] if rev else TR[ti][1]
        base = len(pts) - 1 if pts else 0
        for i, q in enumerate(X if not pts else X[1:]):
            pts.append(q)
        owners.append((ti, rev, base, len(pts) - 1))
        pin.add(base); pin.add(len(pts) - 1)
        for i, q in enumerate(P):
            if key(q) in JUNC: pin.add(base + i)
    cap = min(CAP.get(TR[ti][0]['c'], 1.0) for ti, r in chain)
    sm, smpin = smooth2(pts, pin, cap)
    for ti, rev, a_, b_ in owners:
        piece = sm[smpin[a_]:smpin[b_] + 1]
        if rev: piece = piece[::-1]
        NEW[ti] = piece
for ti, (t, P) in enumerate(TR):
    XY = NEW[ti]
    # the pieces between the junctions; a branch that leaves at a switch starts along the track it leaves
    jidx = [k for k, q in enumerate(XY) if key(toll(q)) in JUNC or k in (0, len(XY) - 1)]
    out = []
    for k0, k1 in zip(jidx, jidx[1:]):
        piece = XY[k0:k1 + 1]; j0, j1 = key(toll(piece[0])), key(toll(piece[-1]))
        if len(piece) >= 2:
            if j0 in JUNC:
                own = next((XYS[ti][i + 1] for i, q in enumerate(P[:-1]) if key(q) == j0), None)
                if own: s2 = switch_start(piece, j0, own); done['switch'] += s2 != piece; piece = s2
            if j1 in JUNC:
                own = next((XYS[ti][i - 1] for i, q in enumerate(P) if i and key(q) == j1), None)
                if own: s2 = switch_start(piece[::-1], j1, own)[::-1]; done['switch'] += s2 != piece; piece = s2
        pts = [toll(q) for q in piece]; out += pts if not out else pts[1:]
    out[0], out[-1] = P[0], P[-1]
    n1 += len(out); t['p'] = encode(out)
json.dump(F, open('m2.json', 'w'), separators=(',', ':'))
print('tracks: smoothed (at most %s m off OpenStreetMap), %d switch branches started along their track (at most %.1f m off); points %d -> %d'
      % ('/'.join('%s %.1f' % kv for kv in CAP.items()), done['switch'], SWITCH_MAX, n0, n1))
