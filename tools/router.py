"""Directional track router over the OSM M3 track graph.

Edges are way pieces between junction nodes. A train may pass from one edge to
another at a node only if the turn is gentle (like a real switch), so routes never
'reverse' through a junction. Reversals happen only where we say so.
"""
import math, heapq, collections, sys, json
sys.path.insert(0, '.')
from osmparse import load

KX = 111320 * math.cos(math.radians(45.46)); KY = 110540
def xy(lat, lon): return ((lon - 9.19) * KX, (lat - 45.46) * KY)
def ll(x, y): return (y / KY + 45.46, x / KX + 9.19)

import os
W = load(os.environ.get('TRACKS', 'osm_m3.txt'))
edges = []          # dict(a,b,pts[(x,y)],len,way)
node_edges = collections.defaultdict(list)
node_pos = {}
for w in W:
    pts = w['pts']; cur = [xy(pts[0][0], pts[0][1])]; start = pts[0][2]
    for k in range(1, len(pts)):
        cur.append(xy(pts[k][0], pts[k][1]))
        n = pts[k][2]
        if n or k == len(pts) - 1:
            if start and n:
                L = sum(math.hypot(cur[i][0]-cur[i-1][0], cur[i][1]-cur[i-1][1]) for i in range(1, len(cur)))
                e = dict(a=start, b=n, pts=cur, len=L, way=w['i'], svc=w['svc'], name=w['name'])
                ei = len(edges); edges.append(e)
                node_edges[start].append(ei); node_edges[n].append(ei)
                node_pos[start] = cur[0]; node_pos[n] = cur[-1]
            cur = [cur[-1]]; start = n

def poly(ei, d):
    p = edges[ei]['pts']
    return p if d > 0 else p[::-1]

def tangent(p, at_start, look=12.0):
    """unit direction of travel at start (leaving) or end (arriving) of polyline p."""
    if at_start:
        a = p[0]; acc = 0
        for q in p[1:]:
            acc = math.hypot(q[0]-a[0], q[1]-a[1]); b = q
            if acc >= look: break
        v = (b[0]-a[0], b[1]-a[1])
    else:
        b = p[-1]
        for q in reversed(p[:-1]):
            a = q
            if math.hypot(b[0]-q[0], b[1]-q[1]) >= look: break
        v = (b[0]-a[0], b[1]-a[1])
    n = math.hypot(*v) or 1
    return (v[0]/n, v[1]/n)

def end_node(ei, d): return edges[ei]['b'] if d > 0 else edges[ei]['a']
def start_node(ei, d): return edges[ei]['a'] if d > 0 else edges[ei]['b']

COS = math.cos(math.radians(40))

def successors(ei, d):
    n = end_node(ei, d); vin = tangent(poly(ei, d), False)
    for ej in node_edges[n]:
        if ej == ei: continue
        dj = 1 if edges[ej]['a'] == n else -1
        if edges[ej]['a'] == edges[ej]['b']: continue
        if not allowed(ej, dj): continue
        vout = tangent(poly(ej, dj), True)
        if vin[0]*vout[0] + vin[1]*vout[1] > COS:
            yield ej, dj

def route(start_states, goal_node, avoid=()):
    """start_states: list of (edge,dir) the train is already on (cost counted).
    Returns list of (edge,dir) ending with an edge whose end is goal_node."""
    pq = []; best = {}; prev = {}
    for s in start_states:
        if not allowed(*s): continue
        c = edges[s[0]]['len']; best[s] = c; prev[s] = None; heapq.heappush(pq, (c, s))
    while pq:
        c, s = heapq.heappop(pq)
        if c > best.get(s, 1e18): continue
        if end_node(*s) == goal_node:
            out = []
            while s: out.append(s); s = prev[s]
            return out[::-1]
        for t in successors(*s):
            if t[0] in avoid: continue
            nc = c + edges[t[0]]['len']
            if nc < best.get(t, 1e18): best[t] = nc; prev[t] = s; heapq.heappush(pq, (nc, t))
    return None

def leaving(node):
    """all (edge,dir) states that leave a node."""
    return [(e, 1 if edges[e]['a'] == node else -1) for e in node_edges[node]]

def route_nodes(a, b, via=(), first=None):
    """route from node a to node b, through via nodes, no reversal.
    first: optional node the first edge must lead to (sets departure direction)."""
    starts = leaving(a)
    if first is not None: starts = [s for s in starts if end_node(*s) == first]
    path = []
    targets = list(via) + [b]
    for t in targets:
        r = route(starts, t)
        if r is None: return None
        path += r
        last = r[-1]; starts = list(successors(*last))
        if t == b: break
        # continuing from 'last': next route must start from successors of last
        if not starts: return None
        path_tail = path
    return path

def path_poly(states):
    out = []
    for ei, d in states:
        p = poly(ei, d)
        out += p if not out else p[1:]
    return out

def plen(p): return sum(math.hypot(p[i][0]-p[i-1][0], p[i][1]-p[i-1][1]) for i in range(1, len(p)))

def cum(p):
    c = [0.0]
    for i in range(1, len(p)): c.append(c[-1] + math.hypot(p[i][0]-p[i-1][0], p[i][1]-p[i-1][1]))
    return c

def project(p, c, lat, lon, from_d=0.0, max_ahead=None):
    px, py = xy(lat, lon); best = (1e18, None)
    for i in range(len(p) - 1):
        if c[i+1] < from_d: continue
        if max_ahead is not None and c[i] > from_d + max_ahead: break
        ax, ay = p[i]; bx, by = p[i+1]; dx, dy = bx-ax, by-ay; L2 = dx*dx+dy*dy
        t = 0 if L2 == 0 else max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L2))
        dd = (px-ax-t*dx)**2 + (py-ay-t*dy)**2
        dist = c[i] + t*math.sqrt(L2)
        if dist >= from_d and dd < best[0]: best = (dd, dist)
    return best[1], math.sqrt(best[0])

# ---- depot through-tracks: join facing dead ends across a depot building ----
LINKS = []          # (a, b, mid node)
def auto_links(box, skip=(), max_len=400, max_err=25):
    def inbox(n):
        la, lo = ll(*node_pos[n]); return box[0] < la < box[1] and box[2] < lo < box[3]
    dead = [n for n in list(node_pos) if len(node_edges[n]) == 1 and inbox(n) and n not in skip and n not in DRAWN_ENDS]
    info = {}
    for n in dead:
        e = edges[node_edges[n][0]]; p = e['pts'] if e['b'] == n else e['pts'][::-1]
        info[n] = (node_pos[n], tangent(p, False, 15))
    cands = []
    for a in dead:
        for b in dead:
            if a >= b: continue
            (pa, ta), (pb, tb) = info[a], info[b]
            v = (pb[0] - pa[0], pb[1] - pa[1]); L = math.hypot(*v)
            if L < 30 or L > max_len: continue
            u = (v[0] / L, v[1] / L)
            ea = math.degrees(math.acos(max(-1, min(1, ta[0] * u[0] + ta[1] * u[1]))))
            eb = math.degrees(math.acos(max(-1, min(1, -(tb[0] * u[0] + tb[1] * u[1])))))
            if ea < max_err and eb < max_err:
                # sideways offset of each end from the other track's line: straight tracks have ~0
                lat_a = abs(ta[0] * v[1] - ta[1] * v[0]); lat_b = abs(tb[0] * v[1] - tb[1] * v[0])
                cands.append((lat_a + lat_b, a, b))
    cands.sort(); used = set()
    for err, a, b in cands:
        if a in used or b in used: continue
        used |= {a, b}; add_link(a, b)
    return LINKS

def add_link(a, b):
    pa, pb = node_pos[a], node_pos[b]
    mid = 100000 + len(LINKS); pm = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    node_pos[mid] = pm
    for x, y, px, py in ((a, mid, pa, pm), (mid, b, pm, pb)):
        n = max(2, int(math.hypot(py[0] - px[0], py[1] - px[1]) / 10) + 1)
        pts = [(px[0] + (py[0] - px[0]) * i / (n - 1), px[1] + (py[1] - px[1]) * i / (n - 1)) for i in range(n)]
        e = dict(a=x, b=y, pts=pts, len=plen(pts), way=-1, svc='yard', name='through track', mid=mid)
        ei = len(edges); edges.append(e); node_edges[x].append(ei); node_edges[y].append(ei)
    LINKS.append((a, b, mid))

# ---- rules marked by Giovanni in the track editor (one-way tracks, unused tracks) ----
ONEWAY, BANNED = {}, set()
NOPARK = set()      # depot tracks used to move trains around, never to park (Giovanni's X marks)
BANNED_EDGES = set()    # pieces of track (between two switches) no route may use: Giovanni's "taglio" points
DRAWN_ENDS = set()      # far ends of tracks drawn inside the depot building (never joined across the building)
THROUGH_STABLE = set()  # depot tracks marked as through: in at one end, out at the other (the others: same end)
def load_rules(path, line):
    if not os.path.exists(path): return 0
    R_ = json.load(open(path)); n = 0
    for m in R_.get('marks', []):
        if m['line'] != line: continue
        if m['role'] == 'Not used in service': BANNED.add(m['w']); n += 1; continue
        if m['role'].startswith('Depot: movements only'): NOPARK.add(m['w']); n += 1
        if m['role'].startswith('Stabling: through'): THROUGH_STABLE.add(m['w']); n += 1
        if m['dir'] in (1, -1): ONEWAY[m['w']] = m['dir']; n += 1
    # tracks drawn by Giovanni that continue a depot dead end inside the building: the dead end moves to their far end
    for ti, dt in enumerate(R_.get('tracks', [])):
        if dt.get('line', line) != line or len(dt.get('points', [])) < 2: continue
        P = [xy(*q) for q in dt['points']]
        ends = [n for n in node_pos if len(node_edges[n]) == 1]
        best = min(((math.hypot(node_pos[n][0] - P[0][0], node_pos[n][1] - P[0][1]), n, P) for n in ends), default=None)
        best2 = min(((math.hypot(node_pos[n][0] - P[-1][0], node_pos[n][1] - P[-1][1]), n, P[::-1]) for n in ends), default=None)
        b = min(x for x in (best, best2) if x)
        if b[0] > 6: continue                       # not continuing a dead end: only drawn
        _, a, P = b; nid = 200000 + ti; pts = [node_pos[a]] + P[1:]
        e = dict(a=a, b=nid, pts=pts, len=sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts))),
                 way=edges[node_edges[a][0]]['way'], svc='yard', name=dt.get('name') or 'depot track (inside the building)')
        ei = len(edges); edges.append(e); node_edges[a].append(ei); node_edges[nid].append(ei); node_pos[nid] = pts[-1]
        DRAWN_ENDS.add(nid); n += 1
    # "taglio": a point on a track; the piece between the two switches around it is closed to every route
    for sg in R_.get('signals', []) + R_.get('route_cuts', []):
        if sg.get('line', line) != line or sg.get('type') != 'cut': continue
        px, py = xy(*(sg.get('on_track') or (sg['lat'], sg['lon']))); best = None
        for ei, e in enumerate(edges):
            if e['way'] != sg.get('w', e['way']): continue
            for (ax, ay), (bx, by) in zip(e['pts'], e['pts'][1:]):
                dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
                u = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                dd = math.hypot(px - ax - u * dx, py - ay - u * dy)
                if best is None or dd < best[0]: best = (dd, ei)
        if best and best[0] < 5: BANNED_EDGES.add(best[1]); n += 1
    return n
THROUGH_ALLOWED = None      # set of through-track middles a route may use (None = all)
def allowed(ei, d):
    if THROUGH_ALLOWED is not None and 'mid' in edges[ei] and edges[ei]['mid'] not in THROUGH_ALLOWED: return False
    w = edges[ei]['way']
    if w in BANNED or ei in BANNED_EDGES: return False
    return ONEWAY.get(w, d) == d

# ---- right-hand running on the main line: each main track only in its own direction ----
def infer_main_directions(prefix='Linea', min_gap=2.0, max_gap=20.0):
    """For every main-line way, vote over its edges: travelling along the edge, is the other
    parallel main track on the left (we are the right-hand track) or on the right?"""
    main = [i for i, e in enumerate(edges) if e['name'].startswith(prefix)]
    votes = collections.defaultdict(float)
    def closest(px, py, ei):
        best = (1e18, None, None)
        p = edges[ei]['pts']
        for (ax, ay), (bx, by) in zip(p, p[1:]):
            dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            u = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            qx, qy = ax + u * dx, ay + u * dy; d = math.hypot(px - qx, py - qy)
            if d < best[0]: L = math.sqrt(L2) or 1; best = (d, (qx, qy), (dx / L, dy / L))
        return best
    for ei in main:
        p = edges[ei]['pts']
        for k in range(0, len(p) - 1, max(1, (len(p) - 1) // 6 or 1)):
            (ax, ay), (bx, by) = p[k], p[k + 1]; L = math.hypot(bx - ax, by - ay)
            if L < 1: continue
            tx, ty = (bx - ax) / L, (by - ay) / L; mx, my = (ax + bx) / 2, (ay + by) / 2
            for ej in main:
                if edges[ej]['way'] == edges[ei]['way']: continue
                d, q, tan = closest(mx, my, ej)
                if d is None or not (min_gap < d < max_gap) or abs(tan[0] * tx + tan[1] * ty) < 0.9: continue
                cross = tx * (q[1] - my) - ty * (q[0] - mx)            # >0: other track on our left
                votes[edges[ei]['way']] += (1 if cross > 0 else -1) * L
                break
    # chains: main ways that continue each other (end of one = start of the next, smooth join)
    ways = sorted({edges[i]['way'] for i in main})
    ends = {}
    for w in ways:
        es = [i for i in main if edges[i]['way'] == w]
        pts = []
        for i in es: pts += edges[i]['pts'] if not pts else edges[i]['pts'][1:]
        ends[w] = (edges[es[0]]['a'], edges[es[-1]]['b'], tangent(pts, True), tangent(pts, False))
    sign = {}
    for w0 in ways:
        if w0 in sign: continue
        sign[w0] = 1; chain = [w0]; stack = [w0]
        while stack:
            w = stack.pop(); a, b, ta, tb = ends[w]
            # travel direction of w in chain orientation: leaving b (if sign 1) ...
            for v in ways:
                if v in sign: continue
                va, vb, vta, vtb = ends[v]
                for node_w, tw, out_w in ((b, tb, 1), (a, (-ta[0], -ta[1]), -1)):
                    for node_v, tv, in_v in ((va, vta, 1), (vb, (-vtb[0], -vtb[1]), -1)):
                        if node_w == node_v and tw[0] * tv[0] + tw[1] * tv[1] > 0.8:
                            sign[v] = sign[w] * out_w * in_v; chain.append(v); stack.append(v)
                            break
                    if v in sign: break
        total = sum(sign[w] * votes.get(w, 0) for w in chain)
        for w in chain:
            if w not in ONEWAY and abs(total) > 1: ONEWAY[w] = sign[w] * (1 if total > 0 else -1)
    return {w: ONEWAY.get(w) for w in ways}
