"""Put every passenger trip of a line on its real OSM track (right-hand running).
Trains appear at the first stop and disappear at the last (depot moves come later).
Also generates station platforms beside the tracks. LINE=M1 TRACKS=osm_m1.txt"""
import os, sys, json, math, heapq, collections
sys.path.insert(0, '.')
LINE = os.environ.get('LINE', 'M1')
from router import *
print('main-line directions (right-hand running):', infer_main_directions())
from dwell import add_dwell

D = json.load(open('data.json'))
RI = [i for i, r in enumerate(D['routes']) if r['id'] == LINE][0]
MAIN = lambda e: edges[e]['svc'] == '' or edges[e]['name'].startswith('Linea')

# keep only the connected part of the network that contains the line's main tracks
adj = collections.defaultdict(set)
for i, e in enumerate(edges): adj[e['a']].add(e['b']); adj[e['b']].add(e['a'])
seed = {edges[i]['a'] for i in range(len(edges)) if edges[i]['name'].startswith('Linea')}
seen = set(seed); stack = list(seed)
while stack:
    n = stack.pop()
    for m in adj[n]:
        if m not in seen: seen.add(m); stack.append(m)
keep_edge = [e['a'] in seen for e in edges]

def closest_on_edge(ei, px, py):
    p = edges[ei]['pts']; best = (1e18, 0, 0, None)
    acc = 0
    for i in range(len(p) - 1):
        ax, ay = p[i]; bx, by = p[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy; L = math.sqrt(L2) or 1e-9
        t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
        qx, qy = ax + t * dx, ay + t * dy; d = (px - qx) ** 2 + (py - qy) ** 2
        if d < best[0]: best = (d, acc + t * L, (dx / L, dy / L), (qx, qy))
        acc += L
    return math.sqrt(best[0]), best[1], best[2], best[3]

def pick_track(lat, lon, v):
    """edge + direction on the right-hand track at a stop travelling along v."""
    px, py = xy(lat, lon); cands = []
    for ei, e in enumerate(edges):
        if not keep_edge[ei] or not MAIN(ei): continue
        d, along, tan, q = closest_on_edge(ei, px, py)
        if d > 90: continue
        dot = tan[0] * v[0] + tan[1] * v[1]
        if abs(dot) < 0.6: continue
        cross = v[0] * (q[1] - py) - v[1] * (q[0] - px)   # >0 left of travel, <0 right
        cands.append((d, cross, ei, 1 if dot > 0 else -1, along))
    if not cands: return None
    near = min(c[0] for c in cands)
    cands = [c for c in cands if c[0] < near + 25]          # the tracks of this station
    c = min(cands, key=lambda c: c[1])                      # rightmost
    return (c[2], c[3])

def route_states(start, goal):
    if start == goal: return [start]
    pq = [(0, start)]; best = {start: 0}; prev = {start: None}
    while pq:
        c, s = heapq.heappop(pq)
        if s == goal:
            out = []
            while s: out.append(s); s = prev[s]
            return out[::-1]
        if c > best[s]: continue
        for t in successors(*s):
            if not keep_edge[t[0]]: continue
            nc = c + edges[t[0]]['len']
            if nc < best.get(t, 1e18): best[t] = nc; prev[t] = s; heapq.heappush(pq, (nc, t))
    return None

# ---- trips grouped by stop pattern ----
pat_trips = collections.defaultdict(list)
for ti, t in enumerate(D['trips']):
    if t[0] != RI: continue
    stops = tuple(s for s in t[5] if s >= 0)
    pat_trips[stops].append(ti)

paths, pat_info, fails = [], {}, 0
station_tracks = collections.defaultdict(set)    # station name -> {(edge, dir)}
for stops, tis in pat_trips.items():
    coords = [D['stops'][s] for s in stops]
    states = []
    for i, (n, la, lo) in enumerate(coords):
        j = i + 1 if i + 1 < len(coords) else i - 1
        a = xy(la, lo); b = xy(coords[j][1], coords[j][2])
        v = (b[0] - a[0], b[1] - a[1]) if j > i else (a[0] - b[0], a[1] - b[1])
        L = math.hypot(*v) or 1; v = (v[0] / L, v[1] / L)
        st = pick_track(la, lo, v)
        states.append(st)
        if st: station_tracks[n.upper().replace(' M1', '').strip()].add(st)
    if None in states: fails += 1; continue
    full = [states[0]]; ok = True
    for i in range(1, len(states)):
        r = route_states(full[-1], states[i])
        if r is None: ok = False; break
        full += r[1:]
    if not ok: fails += 1; print('no route for pattern', coords[0][0], '->', coords[-1][0], len(stops)); continue
    p = path_poly(full); c = cum(p)
    ds, last = [], 0.0
    for n, la, lo in coords:
        d, _ = project(p, c, la, lo, last, 4000); d = max(d, last); ds.append(d); last = d
    pid = len(paths); paths.append((p, c)); pat_info[stops] = (pid, ds)
print('patterns', len(pat_trips), 'routed', len(pat_info), 'failed', fails)

# ---- trips -> moving trains (one per trip) ----
trains = []
for stops, tis in pat_trips.items():
    if stops not in pat_info: continue
    pid, sd = pat_info[stops]
    for ti in tis:
        t = D['trips'][ti]; ts, a = [], 0
        for x in t[3]: a += x; ts.append(a)
        ev, last = [], None
        for tt, s in zip(ts, t[5]):
            if s >= 0: last = s
            ev.append((tt, last))
        ev = add_dwell(ev)
        idx = {s: k for k, s in enumerate(stops)}
        ts = [e[0] for e in ev]; ds = [round(sd[idx[e[1]]], 1) for e in ev]
        trains.append([[pid, 'service', ti, ts, ds]])
trains.sort(key=lambda segs: segs[0][3][0])

# ---- station platforms beside each used track ----
PLAT_LEN, PLAT_W, GAP = 110.0, 4.0, 2.6
platforms = []
for name, sts in station_tracks.items():
    # station centre = mean of the projections
    rec = [s for s in D['stops'] if s[0].upper().replace(' M1', '').strip() == name]
    if not rec: continue
    la = sum(r[1] for r in rec) / len(rec); lo = sum(r[2] for r in rec) / len(rec)
    px, py = xy(la, lo)
    for ei, d in sts:
        dist, along, tan, q = closest_on_edge(ei, px, py)
        pts = edges[ei]['pts']; cc = cum(pts)
        def at(s):
            s = max(0, min(cc[-1], s)); i = max(0, min(len(cc) - 2, next((k for k in range(len(cc) - 1) if cc[k + 1] >= s), len(cc) - 2)))
            f = (s - cc[i]) / (cc[i + 1] - cc[i]) if cc[i + 1] > cc[i] else 0
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f; y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f
            tx, ty = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]; L = math.hypot(tx, ty) or 1
            return x, y, tx / L, ty / L
        side = -1 * d     # right of travel direction = outer side for right-hand running
        inner, outer = [], []
        for k in range(12):
            s = along - PLAT_LEN / 2 + PLAT_LEN * k / 11
            x, y, tx, ty = at(s); nx, ny = ty * side, -tx * side
            inner.append(ll(x + nx * GAP, y + ny * GAP)); outer.append(ll(x + nx * (GAP + PLAT_W), y + ny * (GAP + PLAT_W)))
        poly = inner + outer[::-1]
        flat, pa, pb = [], 0, 0
        for a_, b_ in poly:
            A, B = round(a_ * 1e6), round(b_ * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
        platforms.append({'n': name.title(), 'p': flat})
print('platforms', len(platforms), 'stations', len(station_tracks))

# ---- tracks to draw ----
tracks = []
for w in W:
    if not any(n and n in seen for a, b, n in w['pts']): continue
    cat = 'main' if w['name'].startswith('Linea') else (w['svc'] or 'main')
    flat, pa, pb = [], 0, 0
    for a, b, n in w['pts']:
        A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    tracks.append({'c': cat, 'p': flat, 'w': w['i']})

def enc(p):
    flat, pa, pb = [], 0, 0
    for x, y in p:
        a, b = ll(x, y); A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    return flat
json.dump({'line': LINE, 'mode': 'trips', 'home': '', 'far': '', 'half': 52.5,
           'paths': [{'p': enc(p), 'd': [round(x, 1) for x in c]} for p, c in paths],
           'trains': trains, 'where': [], 'tracks': tracks, 'platforms': platforms},
          open(LINE.lower() + '.json', 'w'), separators=(',', ':'))
print(LINE.lower() + '.json written, trips', len(trains))
