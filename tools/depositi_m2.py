"""The M2 depots (data/depositi_m2.json): the depot tracks lengthened where OpenStreetMap stops short, and the parking
places (posti), 115 m each per train counted from the start of the shed (capannone) to its end. Run in an M2 build folder
(build_m2/<day>) after tools/build_trips.py: reads osm_m2.txt and m2.json, writes m2.json again with
- the depot tracks lengthened beyond their dead end (tracks[].p; 'x': the metres added),
- 'depots': for every numbered track its number, use, trains, the places (posti: id, from, to, the points between) and
  the metres added (allunga_m).
Posto 1 is the one at the far end (the first train in leaves last), then towards the way in. The sheds are the depots'
buildings in OpenStreetMap (capannoni in data/depositi_m2.json): the places go from the shed's back wall towards its way
in, and a track that OpenStreetMap stops short is lengthened along the shed's axis to the back wall. Nothing of the main line
changes; the M3 is not read. Usage: python3 tools/depositi_m2.py [path/to/data/depositi_m2.json]"""
import json, math, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CFG = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'depositi_m2.json')))
POSTO = CFG['posto_m']
lines = open('osm_m2.txt').read().strip().split('\n')
WAYS = []
for i, line in enumerate(lines):
    tags, data = line.split('#'); svc, name, tun, ref = tags.split('|'); v = list(map(int, data.split(',')))
    pts = []; a = b = 0
    for k in range(0, len(v), 3): a += v[k]; b += v[k + 1]; pts.append((a / 1e6, b / 1e6))
    WAYS.append(dict(i=i, ref=ref, tunnel=tun == 'T', pts=pts))
BYREF = {w['ref']: w for w in WAYS}
key = lambda p: (round(p[0], 6), round(p[1], 6))
ENDS, INNER = {}, set()
for w in WAYS:
    ENDS.setdefault(key(w['pts'][0]), []).append((w['i'], 0)); ENDS.setdefault(key(w['pts'][-1]), []).append((w['i'], 1))
    INNER.update(key(p) for p in w['pts'][1:-1])
KY = 110540
kx = lambda lat: 111320 * math.cos(math.radians(lat))
dist = lambda a, b: math.hypot((b[0] - a[0]) * KY, (b[1] - a[1]) * kx(a[0]))

def dead_end(w, near):
    """The end of the way with nothing else on it (the buffer); of two, the one nearer `near`."""
    c = [e for e, p in ((0, w['pts'][0]), (1, w['pts'][-1])) if len(ENDS[key(p)]) == 1 and key(p) not in INNER]
    if not c: return None
    return min(c, key=lambda e: dist(w['pts'][0 if e == 0 else -1], near)) if near else c[0]

def chain(w, e):
    """From the dead end into the depot, piece after piece, as far as the first switch: points and covered metres."""
    seq = [w['i']]; P = list(w['pts'] if e == 0 else w['pts'][::-1]); cov = [w['tunnel']] * (len(P) - 1)
    while True:
        k = key(P[-1]); nxt = [x for x in ENDS.get(k, []) if x[0] not in seq]
        if len(nxt) != 1 or k in INNER: break
        w2 = WAYS[nxt[0][0]]; P2 = w2['pts'] if nxt[0][1] == 0 else w2['pts'][::-1]
        seq.append(w2['i']); P += P2[1:]; cov += [w2['tunnel']] * (len(P2) - 1)
    covered = 0
    for (a, b), c in zip(zip(P, P[1:]), cov):
        if not c: break
        covered += dist(a, b)
    return P, covered

def along(Q, s0, s1):
    """The points of the polyline Q between s0 and s1 metres from its start."""
    out, acc = [], 0
    for a, b in zip(Q, Q[1:]):
        L = dist(a, b)
        if acc + L >= s0 and acc <= s1:
            t0, t1 = max(0, (s0 - acc) / L) if L else 0, min(1, (s1 - acc) / L) if L else 0
            p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0); p1 = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
            if not out: out.append(p0)
            out.append(p1)
        acc += L
    return [[round(p[0], 6), round(p[1], 6)] for p in out]

def point_at(Q, s):
    p = along(Q, s, s); return p[0] if p else [round(Q[-1][0], 6), round(Q[-1][1], 6)]
def inpoly(p, poly):
    x, y, c = p[1], p[0], False
    for (y1, x1), (y2, x2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def nearest_shed(sheds, p):
    return min(sheds, key=lambda sh: 0 if inpoly(p, sh['pts']) else min(dist(p, q) for q in sh['pts']))['pts']
def shed_axis(poly):
    """The long direction of a shed: its longest side (a unit vector, east and north)."""
    a, b = max(zip(poly, poly[1:]), key=lambda e: dist(e[0], e[1])); L = dist(a, b)
    return (b[1] - a[1]) * kx(a[0]) / L, (b[0] - a[0]) * KY / L
def shed_run(Q, sheds, s_dead):
    """Along Q (s from its far end), the stretch inside a shed that holds the dead end (s_dead), or begins within 5 m of
    it: (back wall, way in) in metres, or None."""
    total = sum(dist(a, b) for a, b in zip(Q, Q[1:])); step = 0.5; flags = []
    s = 0.0
    while s <= total: flags.append(any(inpoly(point_at(Q, s), sh['pts']) for sh in sheds)); s += step
    k0 = int(round(s_dead / step))
    near = [k for k in range(max(0, k0 - 10), min(len(flags), k0 + 11)) if flags[k]]
    if not near: return None
    k = min(near, key=lambda k: abs(k - k0)); a = k; b = k
    while a > 0 and flags[a - 1]: a -= 1
    while b < len(flags) - 1 and flags[b + 1]: b += 1
    return a * step, b * step
F = json.load(open('m2.json'))
TR = {t['w']: t for t in F['tracks']}
def decode(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((a / 1e6, b / 1e6))
    return o
def encode(P):
    flat, pa, pb = [], 0, 0
    for a, b in P:
        A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    return flat

depots, notes = [], []
for dep, binari in CFG['depositi'].items():
    got = [b for b in binari if str(b.get('osm')) in BYREF]
    # the row of dead ends of the depot: the middle of them, to choose the right end of a track with two
    ends0 = [BYREF[str(b['osm'])]['pts'][0] for b in got]
    near = (sum(p[0] for p in ends0) / len(ends0), sum(p[1] for p in ends0) / len(ends0)) if ends0 else None
    for b in binari:
        rec = dict(dep=dep, n=b['n'], uso=b['uso'], treni=b['treni'], capannone=b['capannone'], posti=[], allunga_m=0)
        if b.get('nuovo'): rec['nuovo'] = b['nuovo']; depots.append(rec); continue      # drawn after its neighbours (below)
        if str(b.get('osm')) not in BYREF:
            rec['manca'] = 'binario non trovato in OpenStreetMap'; depots.append(rec); notes.append('%s %d: not in OpenStreetMap' % (dep, b['n'])); continue
        w = BYREF[str(b['osm'])]; e = dead_end(w, near)
        if e is None: rec['manca'] = 'senza tronco'; depots.append(rec); notes.append('%s %d: no dead end' % (dep, b['n'])); continue
        P, covered = chain(w, e); length = sum(dist(a, c) for a, c in zip(P, P[1:]))
        n = b['treni'] or 0; need = n * POSTO
        rec['w'] = w['i']; rec['coperto_m'] = round(covered, 1); rec['osm_m'] = round(length, 1)
        # the line of the track straight on beyond its dead end, along the shed's axis (FAR m, to find the shed's back wall)
        sheds = CFG.get('capannoni', {}).get(dep, []); FAR = 400.0
        d0, d1 = P[0], P[1]; L = dist(d1, d0) or 1
        ux, uy = (d0[1] - d1[1]) * kx(d0[0]) / L, (d0[0] - d1[0]) * KY / L          # out of the dead end, the way OSM ends
        if sheds:
            ax, ay = shed_axis(nearest_shed(sheds, d0))
            if ax * ux + ay * uy < 0: ax, ay = -ax, -ay
            ux, uy = ax, ay
        far = (d0[0] + uy * FAR / KY, d0[1] + ux * FAR / kx(d0[0])); Q = [far] + P       # s: metres from `far`
        inside = shed_run(Q, sheds, FAR) if b['capannone'] == 'edificio' else None
        if inside and b.get('capannone_come'):       # the shed as long as on the track beside it (data: capannone_come)
            same = [r for r in depots if r['dep'] == dep and r['n'] == b['capannone_come'] and r.get('capannone_m')]
            if same: inside = (inside[1] - same[0]['capannone_m'], inside[1]); notes.append('%s %d: shed as long as on %d' % (dep, b['n'], b['capannone_come']))
        if inside:
            back, way_in = inside                     # the shed's far wall and its way in, along this track
            rec['capannone_m'] = round(way_in - back, 1)
            if back + need > way_in + 0.5 and not b.get('capannone_come'): notes.append('%s %d: %d trains need %d m, the shed has %d m' % (dep, b['n'], n, need, way_in - back))
            start = back; rec['inizio'] = point_at(Q, way_in)
        else:
            if b['capannone'] == 'edificio' and n: notes.append('%s %d: not in a shed of the file, places from the dead end' % (dep, b['n']))
            start = FAR; rec['inizio'] = point_at(Q, FAR + need) if need else point_at(Q, FAR)
            if need > length: notes.append('%s %d: %d m for %d trains, %d m' % (dep, b['n'], length, n, need))
        # the track lengthened up to the far end of the places (or the shed's back wall), never shortened
        ext = max(0.0, FAR - start) if n else 0.0
        if inside and n and start < FAR: ext = FAR - start
        for k in range(n):
            rec['posti'].append(dict(id='%d.%d' % (b['n'], k + 1), pts=along(Q, start + k * POSTO, start + (k + 1) * POSTO),
                                     centro=point_at(Q, start + (k + 0.5) * POSTO)))
        if b.get('lavaggio') and inside:                  # the washing: the first metres of the track in the shed
            Lw = CFG.get('lavaggio', {}).get(dep, {}).get('lunghezza_m') or 0
            if Lw: rec['lavaggio'] = along(Q, inside[1] - Lw, inside[1])
        tip = point_at(Q, FAR - ext); rec['allunga_m'] = round(ext, 1); rec['tronco'] = tip; far = tip
        depots.append(rec)
        if ext > 0.05 and w['i'] in TR:        # the track on the map, lengthened at its dead end
            T = decode(TR[w['i']]['p']); T = ([far] + T) if e == 0 else (T + [far]); TR[w['i']]['p'] = encode(T); TR[w['i']]['x'] = round(ext, 1)
# a track OpenStreetMap does not have (nuovo: between two numbered tracks): straight in the middle of them, from the way in
# to the back of the shed, as long as theirs; drawn as a new depot track (a proposal); with 'collegamento' (Giovanni's drawing) linked to the fan, its far end on the
# nearest point of a track
nextw = max(t['w'] for t in F['tracks']) + 1
CFG_TRACK = {(dep, b['n']): b for dep, bs in CFG['depositi'].items() for b in bs}
for rec in depots:
    if not rec.get('nuovo'): continue
    a, c = [next((r for r in depots if r['dep'] == rec['dep'] and r['n'] == n and r.get('posti')), None) for n in rec['nuovo']['tra']]
    if not (a and c): rec['manca'] = 'vicini senza posti'; continue
    mid = lambda p, q: [round((p[0] + q[0]) / 2, 6), round((p[1] + q[1]) / 2, 6)]
    door, back = mid(a['inizio'], c['inizio']), mid(a['posti'][0]['pts'][0], c['posti'][0]['pts'][0])
    Q = [tuple(back), tuple(door)]; n = rec['treni'] or 0
    rec['posti'] = [dict(id='%d.%d' % (rec['n'], k + 1), pts=along(Q, k * POSTO, (k + 1) * POSTO), centro=point_at(Q, (k + 0.5) * POSTO)) for k in range(n)]
    rec.update(w=nextw, inizio=door, tronco=back, capannone_m=round(dist(back, door), 1))
    path = [door, back]
    link = (CFG_TRACK.get((rec['dep'], rec['n'])) or {}).get('collegamento')
    if link:        # its link to the throat, as Giovanni drew it (from the way in to the fan): its far end on the nearest point of a track
        L = [list(q) for q in link['pts']]
        if dist(L[-1], door) < dist(L[0], door): L = L[::-1]
        fan = min((tuple(q) for t in F['tracks'] for q in decode(t['p'])), key=lambda q: dist(q, L[-1]))
        if dist(fan, L[-1]) < 3: L[-1] = [fan[0], fan[1]]
        rec['collegamento_m'] = round(sum(dist(x, y) for x, y in zip(L, L[1:])), 1)
        path = L[:0:-1] + [door, back]
        notes.append('%s %d: linked to the fan as Giovanni drew it (%.0f m)' % (rec['dep'], rec['n'], rec['collegamento_m']))
    F['tracks'].append(dict(c='yard', p=encode(path), w=nextw, g=0, nuovo=True)); nextw += 1
    notes.append('%s %d: drawn between %d and %d (not in OpenStreetMap)' % (rec['dep'], rec['n'], rec['nuovo']['tra'][0], rec['nuovo']['tra'][1]))
# the stop: the centre of the place, give or take margine_pct of it (manual driving)
MARG = round(POSTO * CFG.get('fermata', {}).get('margine_pct', 0) / 100, 1)
for rec in depots:
    for p in rec['posti']: p['margine_m'] = MARG
# a lengthened track that runs into the main line: the place is shown as to be checked (tocca_linea) and listed
def segd(p, a, b):
    ax, ay = (a[1] - p[1]) * kx(p[0]), (a[0] - p[0]) * KY; bx, by = (b[1] - p[1]) * kx(p[0]), (b[0] - p[0]) * KY
    dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy; u = max(0, min(1, -(ax * dx + ay * dy) / L2)) if L2 else 0
    return math.hypot(ax + u * dx, ay + u * dy)
MAINS = [decode(t['p']) for t in F['tracks'] if t['c'] == 'main']
for d in depots:
    for p in d['posti']:
        pts = p['pts']; samples = [(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 10, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 10) for i in range(len(pts) - 1) for k in range(11)]
        if any(segd(q, M[j], M[j + 1]) < 3 for q in samples for M in MAINS for j in range(len(M) - 1)):
            p['tocca_linea'] = True; notes.append('%s %s runs into the main line: to be checked' % (d['dep'], p['id']))
F['depots'] = depots
F['sheds'] = [dict(dep=d, osm=sh['osm'], pts=sh['pts']) for d, L in CFG.get('capannoni', {}).items() if not d.startswith('_') for sh in L]
json.dump(F, open('m2.json', 'w'), separators=(',', ':'))
n_posti = sum(len(d['posti']) for d in depots)
print('depots: %d tracks, %d places, %d lengthened (%s)' % (len(depots), n_posti, sum(1 for d in depots if d['allunga_m']), '; '.join(notes) or 'all found'))
