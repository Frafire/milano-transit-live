"""M2, tappa 1 (timetable, turni, runs on the real tracks). Run from an M2 build folder (build_m2/<day>).
- every M2 run of the day is in exactly one turno
- a link turns at the same terminus, within the limits of data/operations_m2.json
- a turno's runs follow one another in time
Exit code 1 if one fails."""
import json, sys
T = json.load(open('m2_turni.json')); R = T['runs']; bad = 0
def check(ok, what):
    global bad
    print(('ok   ' if ok else 'FAIL ') + what); bad += not ok
seen = [i for t in T['turni'] for i in t['runs']]
check(sorted(seen) == list(range(len(R))), 'M2 %s: %d runs, each in one turno (%d turni)' % (T['day'], len(R), len(T['turni'])))
lo, hi = T['link_min_min'] * 60, T['link_max_min'] * 60
links = [(a, b) for t in T['turni'] for a, b in zip(t['runs'], t['runs'][1:])]
check(all(R[a]['to'] == R[b]['from'] for a, b in links), 'M2 %s: every link turns at the terminus where the run ends (%d links)' % (T['day'], len(links)))
check(all(lo <= R[b]['dep'] - R[a]['arr'] < hi for a, b in links), 'M2 %s: every link within %d-%d min' % (T['day'], T['link_min_min'], T['link_max_min']))
check(all(R[i]['dep'] <= R[i]['arr'] for i in range(len(R))), 'M2 %s: no run arrives before it leaves' % T['day'])
import os
if os.path.exists('m2.json'):
    F = json.load(open('m2.json'))
    check(len(F['trains']) == len(R), 'M2 %s: every run on the real tracks (%d of %d)' % (T['day'], len(F['trains']), len(R)))
    P = F['paths']; drawn = {t['w'] for t in F['tracks']}
    check(len(drawn) == len(F['tracks']), 'M2 %s: %d tracks drawn for the editor, each once' % (T['day'], len(F['tracks'])))
    if os.path.exists('osm_m2_platforms.json'):
        O = json.load(open('osm_m2_platforms.json'))['platforms']
        E = json.load(open('banchine_m2.json')) if os.path.exists('banchine_m2.json') else {}
        merged = sum(len(g) - 1 for g in E.get('unisci', []))
        got = sum(1 for p in F['platforms'] if 'osm' in p)
        check(got == len(O) - merged, 'M2 %s: the platforms from OpenStreetMap on the map (%d of %d, %d merged by Giovanni)' % (T['day'], got, len(O), merged))
sys.exit(1 if bad else 0)
