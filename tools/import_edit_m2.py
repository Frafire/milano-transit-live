"""Put the M2 part of an editor export (the "MTL-EDIT {...}" text of Copy all) into data/rules_m2.json.

Only the entries with "line": "M2" are taken (signals, marks, drawn tracks with line M2): everything else, the M3's
included, is left out and counted, and data/rules_m3.json is never opened. A signal with the id (code) of one already in
the file replaces it (moved or changed in Sposta segnali); one without an id replaces the one at the same place (within
0.5 m) facing the same way, so the same export can be imported twice. The ids in "sigdel" (deleted in Sposta segnali) are
taken out of the file. The M2's speed limits (speeds_M2, cuts_M2 of the Speed limits tab) go into speeds and cuts; the
M3's (speeds, cuts) are left out. A new signal keeps its own id; one without an id gets the next free M2-s code. Nothing
else of a signal is changed (only the editor's "moved" flag is left out).

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
got = {'signals': 0, 'marks': 0, 'tracks': 0, 'deleted': 0}; other = 0
ids = {x.get('id') for x in R['signals']}
def next_id():
    n = 1 + max([int(i[4:]) for i in ids if i and i.startswith('M2-s') and i[4:].isdigit()] or [0]); ids.add('M2-s%03d' % n); return 'M2-s%03d' % n
for sg in ED.get('signals', []):
    if sg.get('line') != 'M2': other += 1; continue
    sg = {k: v for k, v in sg.items() if k != 'moved'}
    if sg.get('id') and sg['id'] in ids: R['signals'] = [x for x in R['signals'] if x.get('id') != sg['id']] + [sg]
    else:
        old = [x for x in R['signals'] if same(x, sg)]
        R['signals'] = [x for x in R['signals'] if not same(x, sg)]
        # its own id when it has one (kept as it is), the replaced one's, or the next free M2-s code
        nid = sg.get('id') or (old[0]['id'] if old and old[0].get('id') else next_id()); ids.add(nid)
        sg = dict(id=nid, **{k: v for k, v in sg.items() if k != 'id'})
        R['signals'].append(sg)
    got['signals'] += 1
gone = set(ED.get('sigdel', []))
got['deleted'] = sum(1 for x in R['signals'] if x.get('id') in gone)
R['signals'] = [x for x in R['signals'] if x.get('id') not in gone]
for m in ED.get('marks', []):
    if m.get('line') != 'M2': other += 1; continue
    R['marks'] = [x for x in R['marks'] if x.get('w') != m.get('w')] + [m]; got['marks'] += 1
for t in ED.get('tracks', []):
    if t.get('line') != 'M2': other += 1; continue          # a drawn track says its line only when the editor knows it
    R['tracks'].append(t); got['tracks'] += 1
# the speed limits of the M2 (editor tab Speed limits, line M2: speeds_M2, cuts_M2): replace the file's ones they name
# (the M3's speeds and cuts of the same export are left out); a cut list made empty in the editor is not in the export
sp, cu = ED.get('speeds_M2', {}), ED.get('cuts_M2', {})
R.setdefault('speeds', {}); R.setdefault('cuts', {})
for k in list(R['speeds']):          # a piece re-cut in the editor: its old parts go
    if k.split('#')[0] in cu or (k.split('#')[0] in sp and '#' in k): del R['speeds'][k]
R['speeds'].update(sp); R['cuts'].update(cu)
got['speeds'] = len(sp); got['cuts'] = len(cu)
if ED.get('speeds') or ED.get('cuts'): other += len(ED.get('speeds', {})) + len(ED.get('cuts', {}))
R['signals'].sort(key=lambda x: (x.get('name') or '~', x['lat'], x['lon']))
json.dump(R, open(dst, 'w'), ensure_ascii=False, indent=1)
open(dst, 'a').write('\n')
print('%s: M2 signals %d, marks %d, tracks %d, speed limits %d, cut pieces %d imported, %d deleted; %d entries of other lines left out (rules_m3.json untouched); '
      'now %d signals in the file' % (dst, got['signals'], got['marks'], got['tracks'], got['speeds'], got['cuts'], got['deleted'], other, len(R['signals'])))
