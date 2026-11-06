"""The M2 signals in data/rules_m2.json against what Giovanni gave:
(a) the 116 signals of his editor export of 6 Nov 2026 (tests/fixtures/m2_export_2026-11-06.txt, the Cologno - Gessate
    side, 6 of them "vela + manovra" of the old editor) are in the file, each field identical; the only addition is
    the id (code) for the ones the export did not have, and the editor's "moved" flag is not kept; the ones Giovanni
    changed afterwards (CHANGED_EXPORT) keep their place, track and way;
(b) the first 42 (Assago - Famagosta, tests/fixtures/m2_signals_42.json) are unchanged, field by field, except the
    changes Giovanni asked for afterwards, listed in CHANGED below.
Usage: python3 tests/m2_restore_check.py [repo root]. Exit code 1 if one fails."""
import json, os, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
F = os.path.join(ROOT, 'tests', 'fixtures')
R = json.load(open(os.path.join(ROOT, 'data', 'rules_m2.json')))['signals']
txt = open(os.path.join(F, 'm2_export_2026-11-06.txt')).read()
EXP = json.loads(txt[txt.index('{'):])['signals']
OLD = json.load(open(os.path.join(F, 'm2_signals_42.json')))
CHANGED = {}          # id -> the fields Giovanni changed afterwards in the first 42 (none yet)
DELETED = {'M2-s040': 'B32a, Giovanni 6 Nov: drifted far from its track, deleted'}   # of the first 42
# signals of the export Giovanni changed afterwards (not compared): id -> what he asked
CHANGED_EXPORT = {'M2-mw46zpmvnp': 'a marmotta (photo of 6 Nov), same place, track and way'}
bad = 0
def check(ok, what):
    global bad
    print(('ok   ' if ok else 'FAIL ') + what); bad += not ok
same_place = lambda a, b: abs(a['lat'] - b['lat']) < 1e-9 and abs(a['lon'] - b['lon']) < 1e-9 and a.get('dir') == b.get('dir')
miss, diff = [], []
for e in EXP:
    if e.get('id') in CHANGED_EXPORT:
        s = [x for x in R if x.get('id') == e['id']]
        if not (len(s) == 1 and all(s[0].get(k) == e.get(k) for k in ('w', 'lat', 'lon', 'on_track', 'heading', 'dir'))): miss.append(e)
        continue
    got = [s for s in R if (e.get('id') and s.get('id') == e['id']) or (not e.get('id') and same_place(s, e))]
    if len(got) != 1: miss.append(e); continue
    s = got[0]; want = {k: v for k, v in e.items() if k != 'moved'}
    have = {k: v for k, v in s.items() if not (k == 'id' and not e.get('id'))}
    if have != want: diff.append((e.get('id') or (e['lat'], e['lon']), sorted(set(have.items()) ^ set(want.items()), key=str) if all(not isinstance(v, (list, dict)) for v in list(have.values()) + list(want.values())) else 'fields differ'))
check(not miss, 'export of 6 Nov: %d of %d signals in the file' % (len(EXP) - len(miss), len(EXP)))
check(not diff, 'export of 6 Nov: every field identical (%d differ%s)' % (len(diff), ': ' + str(diff[:3]) if diff else ''))
man = [s for s in R if s.get('manovra')]
check(len([e for e in EXP if e.get('manovra')]) == len(man) == 6, 'vela + manovra of the old editor: %d in the file, as in the export (6)' % len(man))
byid = {s.get('id'): s for s in R}
d42 = []
for o in OLD:
    if o['id'] in DELETED:
        if o['id'] in byid: d42.append((o['id'], 'should be deleted'))
        continue
    s = byid.get(o['id'])
    if s is None: d42.append((o['id'], 'missing')); continue
    want = dict(o, **CHANGED.get(o['id'], {}))
    if s != want: d42.append((o['id'], sorted(k for k in set(s) | set(want) if s.get(k) != want.get(k))))
check(not d42, 'the first 42 (Assago - Famagosta) unchanged, %d deleted by Giovanni (%d differ%s)' % (len(DELETED), len(d42), ': ' + str(d42[:3]) if d42 else ''))
# the export of 6 Nov, 11:44 (Famagosta: shunts, galleria signals, S01 and S02 with their marmotta): in the file as given
txt2 = open(os.path.join(F, 'm2_export_2026-11-06b.txt')).read(); EXP2 = json.loads(txt2[txt2.index('{'):])['signals']
bad2 = [e['id'] for e in EXP2 if byid.get(e['id']) != {k: v for k, v in e.items() if k != 'moved'}]
check(not bad2, 'export of 6 Nov 11:44: %d signals in the file, each field identical%s' % (len(EXP2) - len(bad2), ': ' + ', '.join(bad2) if bad2 else ''))
sys.exit(1 if bad else 0)
