"""The schema of the San Donato depot (sinottico, Giovanni 3 Nov 2026): a drawing like the wall of a control room, with
horizontal lines and 45-degree diagonals, not the geography. This tool makes a first one from the real track and writes it
to data/schema_deposito_m3.json, the file that is then corrected by hand (the editor, later). Run it once from build/
after a build (it reads m3.json); the build does not run it, so the corrections stay:

    cd build && python3 ../tools/schema_deposito.py

How: the depot track pieces (yard, test loop, links); the real positions of their nodes turned so that the shed tracks lie
horizontal; the nodes on rows (one row a track, 4 m apart in the real depot); the x kept (metres, squeezed). The page draws
each piece from node to node as a horizontal line then a 45-degree diagonal. The signals of the depot are kept as the
piece they are on and how far along it (0-1), the depot places as their nodes, so moving a node moves them too.
"""
import json, math, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'schema_deposito_m3.json')
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'm3.json'))
net = d['net']; E = net['edges']; NODES = net['nodes']
KX, KY = 111320 * math.cos(math.radians(45.43)), 111320


def dec(p):
    lat, lon, out = p[0], p[1], [(p[0], p[1])]
    for i in range(2, len(p), 2): lat += p[i]; lon += p[i + 1]; out.append((lat, lon))
    return [(b / 1e6 * KX, a / 1e6 * KY) for a, b in out]


xy = lambda la, lo: (lo * KX, la * KY)
BOX = (45.4272, 45.4340, 9.2510, 9.2605)                       # the depot (tools/build_line.py depot_box, a little larger: #A02-#A05)
inbox = lambda n: BOX[0] <= NODES[str(n)][0] <= BOX[1] and BOX[2] <= NODES[str(n)][1] <= BOX[3]
DEP = [i for i, e in enumerate(E) if inbox(e['a']) and inbox(e['b'])]            # (all the track in the box: the depot, the test loop, San Donato)
nodes = sorted({E[i]['a'] for i in DEP} | {E[i]['b'] for i in DEP})
# the angle of the shed tracks: the long straight-ish yard pieces, weighted by length
acc = [0.0, 0.0]
for i in DEP:
    e = E[i]
    if e.get('cat') != 'yard' or e['len'] < 40: continue
    (x0, y0), (x1, y1) = xy(*NODES[str(e['a'])]), xy(*NODES[str(e['b'])])
    a = math.atan2(y1 - y0, x1 - x0) * 2                    # (doubled: a track has no direction)
    acc[0] += math.cos(a) * e['len']; acc[1] += math.sin(a) * e['len']
th = math.atan2(acc[1], acc[0]) / 2
c, s = math.cos(-th), math.sin(-th)
P = {n: xy(*NODES[str(n)]) for n in nodes}
x0 = min(p[0] for p in P.values()); y0 = min(p[1] for p in P.values())
rot = {n: ((p[0] - x0) * c - (p[1] - y0) * s, (p[0] - x0) * s + (p[1] - y0) * c) for n, p in P.items()}
ROW_M, SX, SY = 4.0, 0.9, 11.0                                 # 4 m a track; px per metre along, px per row
ymin = min(v[1] for v in rot.values()); ymax = max(v[1] for v in rot.values())
sch = {n: [round(v[0] * SX, 1), round((ymax - v[1]) / ROW_M) * SY] for n, v in rot.items()}   # (north up)
xmin = min(v[0] for v in sch.values())
for v in sch.values(): v[0] = round(v[0] - xmin + 40, 1); v[1] = v[1] + 40


# the signals of the depot: the piece they are on (the nearest, within 3 m) and how far along it
def proj(pts, x, y):
    best, run, tot = None, 0.0, sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) or 1
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy; L = math.sqrt(L2) or 1
        u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (L2 or 1))); dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
        if best is None or dd < best[0]: best = (dd, (run + u * L) / tot)
        run += L
    return best


polys = {i: dec(E[i]['p']) for i in DEP}
sigs = []
for si, sg in enumerate(net['signals']):
    if sg.get('n') is None: continue
    x, y = xy(*(sg.get('on_track') or (sg['lat'], sg['lon'])))
    best = None
    for i in DEP:
        r = proj(polys[i], x, y)
        if r and r[0] < 3 and (best is None or r[0] < best[1]): best = (i, r[0], r[1])
    if best: sigs.append({'n': sg['n'], 'si': si, 'e': best[0], 'f': round(best[2], 3)})
places = [{'node': p['node'], 'name': p['name']} for p in net.get('depot', []) if p['node'] in sch]
out = {'_about': 'Schema del deposito di San Donato (sinottico, proposta di Giovanni 3 nov 2026): nodes = posizione di ogni nodo nel '
                 'disegno (px); le tratte si disegnano da nodo a nodo, orizzontale poi diagonale a 45 gradi. Fatto la prima volta da '
                 'tools/schema_deposito.py, poi si corregge a mano (i nodi). signals: la tratta e quanto lungo (0-1); places: i posti.',
       'angle_deg': round(math.degrees(th), 1), 'edges': DEP, 'nodes': {str(n): v for n, v in sorted(sch.items())}, 'signals': sigs, 'places': places}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('schema del deposito: %d tratte, %d nodi, %d segnali, %d posti, angolo %.1f gradi -> %s'
      % (len(DEP), len(sch), len(sigs), len(places), math.degrees(th), os.path.relpath(OUT, ROOT)))
