"""The platforms of a line from OpenStreetMap (railway=platform / public_transport=platform areas), for the map in
place of the platforms the build would draw by itself (110 m beside each track used). Written for the M2 (Nov 2026).

Input: a JSON list of OSM ways [{"id", "t": tags, "g": [[lat, lon], ...]}] (an Overpass "out tags geom" export of the
platforms near the line's stations, cut down to these fields), the line's track file (data/osm_<line>.txt) and its
GTFS stops. A platform is kept if it lies beside one of the line's running tracks (no more than NEAR_M from it) and
near one of its stations; the platforms of the trains (train=yes) and the buses are left out, and one mapped twice is
kept once. A platform mapped as an area is used as it is (every point an OSM node); one mapped as a line (its edge)
becomes a 3.5 m strip on the side away from the track.

Output (data/osm_<line>_platforms.json): {"platforms": [{"osm": id, "station": GTFS name, "ref": OSM ref (track
numbers, e.g. "2;3"), "p": [[lat, lon], ...]}], "missing": stations with no OSM platform (the build draws those)}.

Usage: python3 tools/osm_platforms.py platforms.json data/osm_m2.txt data/gtfs_m2/stops.txt data/osm_m2_platforms.json"""
import csv, json, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osmparse

NEAR_M, STATION_M = 4.0, 300.0
src, tracks, stops, dst = sys.argv[1:5]
KX = 111320 * math.cos(math.radians(45.46)); KY = 110540
X = lambda p: ((p[1] - 9.19) * KX, (p[0] - 45.46) * KY)
P = json.load(open(src))
W = [w for w in osmparse.load(tracks) if not w['svc']]          # the running line
segs = [(X(a), X(b)) for w in W for a, b in zip(w['pts'], w['pts'][1:])]
ST = {}
for r in csv.DictReader(open(stops, encoding='utf-8-sig')):
    ST.setdefault(r['stop_name'], (float(r['stop_lat']), float(r['stop_lon'])))


def seg_d(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


LL = lambda x, y: (round(45.46 + y / KY, 7), round(9.19 + x / KX, 7))
out, seen = [], set()
for e in P:
    g, t = e['g'], e['t']
    if t.get('train') == 'yes' or not (t.get('railway') == 'platform' or t.get('subway') == 'yes'): continue   # trains, buses
    if len(g) < 2: continue
    xy = [X(q) for q in g]
    if g[0] != g[-1]:
        # a platform mapped as a line (its edge): a 3.5 m strip on the side away from the nearest track
        mx, my = xy[len(xy) // 2]; a, b = min(((a, b) for a, b in segs if abs(a[0] - mx) < 300 and abs(a[1] - my) < 300), key=lambda s: seg_d((mx, my), *s), default=(None, None))
        if a is None: continue
        dx, dy = xy[-1][0] - xy[0][0], xy[-1][1] - xy[0][1]; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
        tx, ty = b[0] - a[0], b[1] - a[1]; tl = tx * tx + ty * ty or 1; tt = max(0, min(1, ((mx - a[0]) * tx + (my - a[1]) * ty) / tl))
        if (mx - a[0] - tt * tx) * nx + (my - a[1] - tt * ty) * ny < 0: nx, ny = -nx, -ny
        far = [(x + nx * 3.5, y + ny * 3.5) for x, y in xy[::-1]]
        xy = xy + far + [xy[0]]; g = [LL(*q) for q in xy]
    cx, cy = sum(q[0] for q in xy) / len(xy), sum(q[1] for q in xy) / len(xy)
    near = min(seg_d(q, a, b) for q in xy for a, b in segs if abs(a[0] - q[0]) < 300 and abs(a[1] - q[1]) < 300) if segs else 1e9
    if near > NEAR_M: continue
    name, sd = min(((n, math.hypot(X(s)[0] - cx, X(s)[1] - cy)) for n, s in ST.items()), key=lambda x: x[1])
    if sd > STATION_M: continue
    if any(o['station'] == name and math.hypot(o['c'][0] - cx, o['c'][1] - cy) < 6 for o in out): continue   # mapped twice
    out.append({'osm': e['id'], 'station': name, 'ref': t.get('ref', ''), 'p': g, 'c': (cx, cy)}); seen.add(name)
for o in out: del o['c']
out.sort(key=lambda p: (p['station'], p['ref'], p['osm']))
missing = sorted(set(ST) - seen)
json.dump({'_about': 'Banchine della linea da OpenStreetMap (tools/osm_platforms.py). missing: stazioni senza banchine in OSM, '
                     'disegnate dalla build.', 'platforms': out, 'missing': missing}, open(dst, 'w'), ensure_ascii=False, separators=(',', ':'))
print('%s: %d platforms at %d stations; without OSM platforms: %s' % (dst, len(out), len(seen), ', '.join(missing) or 'none'))
