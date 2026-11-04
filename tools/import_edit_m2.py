"""Put the M2 part of an editor export (the "MTL-EDIT {...}" text of Copy all) into data/rules_m2.json.

Only the entries with "line": "M2" are taken (signals, marks, drawn tracks with line M2): everything else, the M3's
included, is left out and counted, and data/rules_m3.json is never opened. A signal already in the file at the same
place (within 0.5 m) facing the same way is replaced by the new one, so the same export can be imported twice.

Usage: python3 tools/import_edit_m2.py export.txt [data/rules_m2.json]"""
import json, math, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'rules_m2.json')
assert os.path.basename(dst) != 'rules_m3.json', 'this tool writes only the M2 file'
txt = open(src).read().strip()
ED = json.loads(txt[txt.index('{'):])
R = json.load(open(dst))
KX = 111320 * math.cos(math.radians(45.46)); KY = 110540
same = lambda a, b: a.get('dir') == b.get('dir') and math.hypot((a['lat'] - b['lat']) * KY, (a['lon'] - b['lon']) * KX) < 0.5
got = {'signals': 0, 'marks': 0, 'tracks': 0}; other = 0
for sg in ED.get('signals', []):
    if sg.get('line') != 'M2': other += 1; continue
    R['signals'] = [x for x in R['signals'] if not same(x, sg)] + [sg]; got['signals'] += 1
for m in ED.get('marks', []):
    if m.get('line') != 'M2': other += 1; continue
    R['marks'] = [x for x in R['marks'] if x.get('w') != m.get('w')] + [m]; got['marks'] += 1
for t in ED.get('tracks', []):
    if t.get('line') != 'M2': other += 1; continue          # a drawn track says its line only when the editor knows it
    R['tracks'].append(t); got['tracks'] += 1
R['signals'].sort(key=lambda x: (x.get('name') or '~', x['lat'], x['lon']))
json.dump(R, open(dst, 'w'), ensure_ascii=False, indent=1)
open(dst, 'a').write('\n')
print('%s: M2 signals %d, marks %d, tracks %d imported; %d entries of other lines left out (rules_m3.json untouched); '
      'now %d signals in the file' % (dst, got['signals'], got['marks'], got['tracks'], other, len(R['signals'])))
