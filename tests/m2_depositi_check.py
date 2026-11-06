"""The M2 depots in an M2 build folder (build_m2/<day>, after tools/depositi_m2.py), against data/depositi_m2.json:
- every track of the file is in OpenStreetMap, except those the file does not know yet (osm null: Famagosta 19);
- each track has as many places as trains it holds, each place 115 m (posto_m), one after the other without gaps or
  overlaps, numbered binario.1, binario.2 (1 at the far end);
- the places of a depot add up to the trains of its tracks (Famagosta 7-18: 24, Gorgonzola 3-11: 17, Cologno: 9);
- a track lengthened only at its dead end: its drawing begins or ends at the new far end;
- the places of a track in a shed inside the shed's outline from OpenStreetMap (except the ones in KNOWN).
Usage: python3 tests/m2_depositi_check.py [path/to/data/depositi_m2.json]. Exit code 1 if one fails."""
import json, math, os, sys
CFG = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'depositi_m2.json')))
F = json.load(open('m2.json')); DEP = F.get('depots', []); TR = {t['w']: t for t in F['tracks']}
P = CFG['posto_m']; bad = 0
def check(ok, what):
    global bad
    print(('ok   ' if ok else 'FAIL ') + what); bad += not ok
KY = 110540
dist = lambda a, b: math.hypot((b[0] - a[0]) * KY, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))
plen = lambda pts: sum(dist(a, b) for a, b in zip(pts, pts[1:]))
def decode(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((a / 1e6, b / 1e6))
    return o
want = {(d, b['n']): b for d, bs in CFG['depositi'].items() for b in bs}
got = {(d['dep'], d['n']): d for d in DEP}
check(set(want) == set(got), 'depots: every track of data/depositi_m2.json built (%d)' % len(got))
missing = [k for k, d in got.items() if d.get('manca')]
check(all(want[k].get('osm') is None for k in missing), 'tracks not in OpenStreetMap only where the file does not know them yet: %s' % (', '.join('%s %d' % k for k in missing) or 'none'))
new = [k for k, d in got.items() if d.get('nuovo')]
check(all(got[k].get('posti') or not want[k]['treni'] for k in new), 'tracks drawn because OpenStreetMap lacks them (between two numbered ones): %s' % (', '.join('%s %d' % k for k in new) or 'none'))
wash = [d for d in DEP if want[(d['dep'], d['n'])].get('lavaggio')]
check(all(d.get('lavaggio') and abs(plen(d['lavaggio']) - CFG['lavaggio'][d['dep']]['lunghezza_m']) < 0.5 for d in wash), 'washing: its stretch of %s m on the washing track (%d)' % ('/'.join(str(CFG['lavaggio'][d['dep']]['lunghezza_m']) for d in wash), len(wash)))
ctr = [p for d in DEP for p in d['posti'] if not p.get('centro') or abs(dist(p['centro'], p['pts'][0]) - P / 2) > 0.5]
check(not ctr, 'each place has its stop at its centre, give or take %s%%' % CFG['fermata']['margine_pct'])
wrong = []
for k, d in got.items():
    if d.get('manca'): continue
    n = want[k]['treni'] or 0
    if len(d['posti']) != n: wrong.append('%s %d: %d places for %d trains' % (k + (len(d['posti']), n))); continue
    if [p['id'] for p in d['posti']] != ['%d.%d' % (k[1], i + 1) for i in range(n)]: wrong.append('%s %d: numbering' % k)
    for p in d['posti']:
        if abs(plen(p['pts']) - P) > 0.5: wrong.append('%s %d %s: %.1f m' % (k + (p['id'], plen(p['pts']))))
    for a, b in zip(d['posti'], d['posti'][1:]):
        if dist(a['pts'][-1], b['pts'][0]) > 0.5: wrong.append('%s %d: gap or overlap between %s and %s' % (k + (a['id'], b['id'])))
check(not wrong, 'each track: one place of %d m per train, numbered from the far end, one after the other%s' % (P, ': ' + '; '.join(wrong[:4]) if wrong else ''))
for dep, n in (('Famagosta', 24 + 12 + 1), ('Gorgonzola', 17 + 3 + 2), ('Cologno Nord', 9)):
    tot = sum(len(d['posti']) for d in DEP if d['dep'] == dep)
    check(tot == n, '%s: %d places (%d expected)' % (dep, tot, n))
ends = []
for d in DEP:
    if not d.get('allunga_m'): continue
    T = decode(TR[d['w']]['p']); far = tuple(d['tronco'])
    if min(dist(T[0], far), dist(T[-1], far)) > 0.5 or abs(TR[d['w']].get('x', 0) - d['allunga_m']) > 0.05: ends.append('%s %d' % (d['dep'], d['n']))
check(not ends, 'lengthened tracks: only at their dead end (%d tracks%s)' % (sum(1 for d in DEP if d.get('allunga_m')), ': ' + ', '.join(ends) if ends else ''))
# every place of a shed track inside the shed's outline (capannoni), except the ones listed here, with the reason
KNOWN = {('Famagosta', 19): "the washing track: 90 m of shed with the washing, then the stub out of the shed (Giovanni, 6 Nov); its place is at the end of the stub"}
def inpoly(p, poly):
    x, y, c = p[1], p[0], False
    for (y1, x1), (y2, x2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
outside = []
for d in DEP:
    sheds = CFG.get('capannoni', {}).get(d['dep'], [])
    if d['capannone'] != 'edificio' or not d['posti'] or not sheds: continue
    for p in d['posti']:
        pts = p['pts']; inn = [inpoly(q, sh['pts']) for q in [pts[0], pts[-1]] + [((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)] for sh in sheds]
        if sum(inn) < 3 and (d['dep'], d['n']) not in KNOWN: outside.append('%s %s' % (d['dep'], p['id']))
check(not outside, 'places of the shed tracks inside the shed (OpenStreetMap outline)%s' % (': ' + ', '.join(outside[:6]) if outside else ''))
for k, why in KNOWN.items(): print('note %s %d: %s' % (k + (why,)))
touch = ['%s %s' % (d['dep'], p['id']) for d in DEP for p in d['posti'] if p.get('tocca_linea')]
for t in touch: print('note ' + t + ': the lengthened track runs into the main line (the shed is to be checked)')
sys.exit(1 if bad else 0)
