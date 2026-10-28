"""Never two trains on top of each other in the depot (whole trains, not just their middle points).

Uses the network the build wrote (m3.json: net edges and how each path runs over them), so it checks the depot as it
is built: fixed through tracks, second places on a track (two trains on one track are fine if they do not touch)."""
import json, bisect, collections, sys

M = json.load(open('m3.json'))
N, PE, HALF = M['net'], M['path_edges'], M['half']
BOX = (45.4285, 45.4335, 9.2515, 9.2585)


def edge_mid(e):
    p = e['p']; la, lo = p[0], p[1]; pts = [(la, lo)]
    for j in range(2, len(p), 2): la += p[j]; lo += p[j + 1]; pts.append((la, lo))
    la, lo = pts[len(pts) // 2]; return la / 1e6, lo / 1e6


# depot tracks only (yard and the tracks through the building; the San Donato tails and platforms are checked elsewhere)
DEPOT = {i for i, e in enumerate(N['edges']) if (e.get('cat') == 'yard' or e.get('way', 0) < 0) and BOX[0] < edge_mid(e)[0] < BOX[1] and BOX[2] < edge_mid(e)[1] < BOX[3]}


def state(segs, t):
    last = None
    for s in segs:
        ts, ds = s[3], s[4]
        if ts[0] <= t <= ts[-1]:
            j = max(0, min(bisect.bisect_right(ts, t) - 1, len(ts) - 2)); sp = ts[j + 1] - ts[j]
            return s[0], ds[j] + (ds[j + 1] - ds[j]) * ((t - ts[j]) / sp if sp > 0 else 0)
        if ts[-1] < t: last = (s[0], ds[-1])
        else: break
    return last if last else (segs[0][0], segs[0][4][0])


def footprint(pid, d):
    """pieces of depot track the whole train covers: (edge, from, to) in metres along the edge"""
    out = []
    for ei, di, x0, x1 in PE[pid]['e'] if isinstance(PE, list) else PE[str(pid)]['e']:
        if x1 < d - HALF or x0 > d + HALF or ei not in DEPOT: continue
        k = (N['edges'][ei]['len'] or 1) / ((x1 - x0) or 1); p, q = max(d - HALF, x0), min(d + HALF, x1)
        out.append((ei, (p - x0) * k if di > 0 else (x1 - q) * k, (q - x0) * k if di > 0 else (x1 - p) * k))
    return out


bad = collections.Counter(); ex = {}; closest = 1e9
for t in range(3 * 3600, 27 * 3600, 60):
    by_edge = collections.defaultdict(list)
    for k, segs in enumerate(M['trains']):
        for ei, a, b in footprint(*state(segs, t)): by_edge[ei].append((k + 1, a, b))
    for ei, lst in by_edge.items():
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                g = max(lst[j][1] - lst[i][2], lst[i][1] - lst[j][2]); closest = min(closest, g)
                if g < -1:
                    key = 'edge %d (way %s)' % (ei, N['edges'][ei]['way']); bad[key] += 1
                    ex.setdefault(key, ('%02d:%02d' % (t // 3600 % 24, t // 60 % 60), [lst[i][0], lst[j][0]], round(g)))
print('depot track pieces checked:', len(DEPOT), '| trains on top of each other:', len(bad), dict(list(ex.items())[:6]),
      '| closest two trains on one piece:', round(closest), 'm')
sys.exit(1 if bad else 0)
