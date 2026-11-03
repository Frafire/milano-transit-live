"""Turn an Overpass export of Milan's metro tracks into a track file for one line (data/osm_<line>.txt, the format
read by tools/osmparse.py). Written for the M2 (Nov 2026); the earlier osm_*.txt files were converted by hand.

The export (run it on https://overpass-turbo.eu, Export -> "raw OSM data", or with curl on the Overpass API):

    [out:json][timeout:180];
    way["railway"~"^(subway|light_rail)$"](45.39,9.08,45.56,9.46)->.w;
    rel(bw.w)["route"="subway"]->.r;
    (.w; .r;);
    out body;
    .w > ;
    out skel qt;

Which tracks are kept: the ways of the line's route relations (ref, e.g. 2), and everything joined to them (depots,
sidings, crossovers, tails), but not the ways of another line's route relations: a link track to another line is
kept, that line is not. Nothing is made up: every point is an OSM node.

Output, one way per line: service|name|T if in a tunnel (C: covered station, surface)|OSM way id#lat,lon,node deltas
x1e6 (see osmparse.py).
service is OSM's service tag (yard, siding, crossover, spur...) or empty for the running line; the running line is
named "Linea <line>". node is 0 for a plain point, else a number shared by every way through that point (ends and
junctions). Ways are sorted by OSM id, so the order (and the way numbers the track editor uses) stays the same when
the export is redone, as long as OSM does not change.

Usage: python3 tools/osm_to_txt.py export.json M2 data/osm_m2.txt"""
import json, sys, collections

src, line, dst = sys.argv[1], sys.argv[2].upper(), sys.argv[3]
ref = line.lstrip('M')
J = json.load(open(src))['elements']
nodes = {e['id']: (e['lat'], e['lon']) for e in J if e['type'] == 'node'}
ways = {e['id']: e for e in J if e['type'] == 'way'}
rels = [e for e in J if e['type'] == 'relation' and e.get('tags', {}).get('route') == 'subway']
mine, other = set(), set()
for r in rels:
    ws = {m['ref'] for m in r.get('members', []) if m['type'] == 'way'}
    (mine if r['tags'].get('ref', '').strip().upper().lstrip('M') == ref else other).update(ws)
other -= mine
assert mine, 'no route relation with ref %s in the export' % ref

by_node = collections.defaultdict(set)
for w in ways.values():
    for n in w['nodes']: by_node[n].add(w['id'])
keep, todo = set(), [w for w in mine if w in ways]
while todo:
    w = todo.pop()
    if w in keep or w in other: continue
    keep.add(w)
    for n in ways[w]['nodes']:
        todo += [x for x in by_node[n] if x not in keep and x not in other]
missing = [n for w in keep for n in ways[w]['nodes'] if n not in nodes]
assert not missing, '%d nodes without coordinates: the export needs ".w > ; out skel qt;"' % len(missing)

# graph nodes: the ends of every way and every point shared by two kept ways
uses = collections.Counter(n for w in keep for n in set(ways[w]['nodes']))
graph = set()
for w in keep:
    ns = ways[w]['nodes']; graph.update((ns[0], ns[-1])); graph.update(n for n in ns if uses[n] > 1)
num = {n: i + 1 for i, n in enumerate(sorted(graph))}

out, kinds = [], collections.Counter()
for wid in sorted(keep):
    w = ways[wid]; t = w.get('tags', {})
    svc = t.get('service', '')
    name = t.get('name', '') if svc else 'Linea ' + line
    tun = 'T' if t.get('tunnel', 'no') not in ('no', '') else ''
    v, a, b = [], 0, 0
    for n in w['nodes']:
        la, lo = round(nodes[n][0] * 1e6), round(nodes[n][1] * 1e6)
        v += [la - a, lo - b, num.get(n, 0)]; a, b = la, lo
    out.append('%s|%s|%s|%d#%s' % (svc, name.replace('|', ' ').replace('#', ' '), tun, wid, ','.join(map(str, v))))
# Giovanni's corrections (data/osm_<line>_fix.json, by OSM way id): see tools/osm_fix.py
import os
fx = os.path.join(os.path.dirname(os.path.abspath(dst)), 'osm_%s_fix.json' % line.lower())
if os.path.exists(fx):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import osm_fix
    out, done, missing = osm_fix.apply(out, osm_fix.load_fixes(fx))
    print('corrections from %s: %d applied%s' % (fx, len(done), ('; not in the export (OSM changed?): ' + ', '.join(missing)) if missing else ''))
open(dst, 'w').write('\n'.join(out) + '\n')
for ln in out:
    svc, _, tun, _ = ln.split('#')[0].split('|')
    kinds[(svc or 'linea') + {'T': ' galleria', 'C': ' coperta'}.get(tun, ' superficie')] += 1
print('%s: %d ways (%s), %d junction/end nodes, %d ways of other lines left out' % (
    dst, len(out), ', '.join('%s %d' % kv for kv in sorted(kinds.items())), len(num), len(other & set(ways))))
