"""The M2 track pieces for the speed limits tab of the editor (the same shape as the M3's net, tools/build_line.py), and
the limits Giovanni set (data/rules_m2.json: speeds, cuts). Run in an M2 build folder (build_m2/<day>) after
tools/depositi_m2.py: reads osm_m2.txt (the junction nodes) and m2.json (the tracks as drawn, depot tracks lengthened),
writes m2.json again with
- net: nodes {id: [lat, lon]} and edges, one per piece of track from junction to junction: a, b, key "a-b", len (m),
  cat (main, siding, crossover, yard), kmh (its base limit), fixed (not editable), p (its points), w (the track);
- ops: line_max_kmh, diverging_kmh, depot_diverging_kmh, depot_speed_kmh (data/operations_m2.json: the Velocita sheet
  of Regole_M2.xlsx);
- speeds and cuts: as Giovanni set them in the editor (keys "a-b", "a-b#i" for the parts after cuts, "J<node>" for the
  diverging side of a junction).
The base limits: main line the line's top speed, crossovers the diverging speed (editable, some are 50), depot tracks
the depot speed (fixed); sidings (tails, platform tracks) the line's top speed until Giovanni sets them (shown with ?).
No path of the trains yet (path_edges): the tab shows and edits the limits; nothing drives with them for now.
Usage: python3 tools/net_m2.py [path/to/data]"""
import json, math, os, sys

DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OPS_ALL = json.load(open(os.path.join(DATA, 'operations_m2.json')))
OPS = {k: OPS_ALL[k] for k in ('line_max_kmh', 'diverging_kmh', 'depot_diverging_kmh', 'depot_speed_kmh')}
RULES = json.load(open(os.path.join(DATA, 'rules_m2.json')))
KY = 110540
kx = lambda lat: 111320 * math.cos(math.radians(lat))
dist = lambda a, b: math.hypot((b[0] - a[0]) * KY, (b[1] - a[1]) * kx(a[0]))
key = lambda p: (round(p[0], 6), round(p[1], 6))

# the junction nodes of OpenStreetMap: the points with a node id, by place
NODE = {}
for line in open('osm_m2.txt').read().strip().split('\n'):
    v = list(map(int, line.split('#')[1].split(',')))
    a = b = 0
    for k in range(0, len(v), 3):
        a += v[k]; b += v[k + 1]
        if v[k + 2]: NODE[(round(a / 1e6, 6), round(b / 1e6, 6))] = v[k + 2]

F = json.load(open('m2.json'))
def decode(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((a / 1e6, b / 1e6))
    return o
def encode(P):
    flat, pa, pb = [], 0, 0
    for a, b in P:
        A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    return flat

# the nodes used by more than one track end or met inside a track: where a piece ends (junctions); and the track ends
uses = {}
for t in F['tracks']:
    for p in decode(t['p']):
        k = key(p)
        if k in NODE: uses[k] = uses.get(k, 0) + 1
nodes, edges = {}, []
def node_id(p, w, end):
    k = key(p)
    if k in NODE: nid = str(NODE[k])
    else: nid = 'w%d%s' % (w, end)                          # a track end OpenStreetMap gives no node (a lengthened dead end)
    nodes.setdefault(nid, [k[0], k[1]]); return nid
for t in F['tracks']:
    P = decode(t['p'])
    if len(P) < 2: continue
    cut = [0] + [i for i in range(1, len(P) - 1) if key(P[i]) in NODE and uses.get(key(P[i]), 0) > 1] + [len(P) - 1]
    for i0, i1 in zip(cut, cut[1:]):
        pts = P[i0:i1 + 1]
        a, b = node_id(pts[0], t['w'], 'a' if i0 == 0 else str(i0)), node_id(pts[-1], t['w'], 'b' if i1 == len(P) - 1 else str(i1))
        cat = t['c'] if t['c'] in ('main', 'siding', 'crossover', 'yard') else 'main'
        kmh = {'main': OPS['line_max_kmh'], 'siding': OPS['line_max_kmh'], 'crossover': OPS['diverging_kmh'], 'yard': OPS['depot_speed_kmh']}[cat]
        edges.append({'a': a, 'b': b, 'key': '%s-%s' % (a, b), 'len': round(sum(dist(x, y) for x, y in zip(pts, pts[1:])), 1), 'cat': cat,
                      'kmh': kmh, 'fixed': cat == 'yard', 'p': encode(pts), 'w': t['w']})
# the same key twice (two pieces between the same two junctions): the second gets the track's number
seen = {}
for e in edges:
    if e['key'] in seen: e['key'] = '%s-%s~w%d' % (e['a'], e['b'], e['w'])
    seen[e['key']] = 1
F['net'] = {'nodes': nodes, 'edges': edges}
F['ops'] = OPS
F['speeds'] = RULES.get('speeds', {}); F['cuts'] = RULES.get('cuts', {})
json.dump(F, open('m2.json', 'w'), separators=(',', ':'))
from collections import Counter
unknown = [k for k in F['speeds'] if not k.startswith('J') and k.split('#')[0] not in seen]
print('net: %d nodes, %d pieces (%s), %d limits set, %d cuts%s' % (len(nodes), len(edges), ', '.join('%s %d' % x for x in sorted(Counter(e['cat'] for e in edges).items())),
      len(F['speeds']), sum(len(c) for c in F['cuts'].values()), '; %d limits on pieces not in the net: %s' % (len(unknown), unknown[:5]) if unknown else ''))
