"""The sinottico of the depot (data/schema_deposito_m3.json): every node and every signal of the depot is in it, every
place, every track piece it names exists. Usage (from build/): python3 ../tests/schema_check.py"""
import json, math, sys
d = json.load(open('m3.json')); net = d['net']; E = net['edges']; S = net.get('schema_depot')
if not S: print('FAIL no schema of the depot (data/schema_deposito_m3.json)'); sys.exit(1)
BOX = (45.4285, 45.4335, 9.2515, 9.2585)              # the depot (tools/build_line.py depot_box)
inb = lambda ll: BOX[0] <= ll[0] <= BOX[1] and BOX[2] <= ll[1] <= BOX[3]
dep_e = [i for i, e in enumerate(E) if e.get('cat') in ('yard', 'test') and inb(net['nodes'][str(e['a'])]) and inb(net['nodes'][str(e['b'])])]
dep_n = {E[i]['a'] for i in dep_e} | {E[i]['b'] for i in dep_e}
SE, SN = set(S['edges']), set(int(n) for n in S['nodes'])
bad = []
miss_e = [i for i in dep_e if i not in SE]; miss_n = sorted(n for n in dep_n if n not in SN)
if miss_e: bad.append('depot track pieces not in the schema: %s' % miss_e[:20])
if miss_n: bad.append('depot nodes not in the schema: %s' % miss_n[:20])
unk = [i for i in S['edges'] if i >= len(E) or E[i]['a'] not in SN or E[i]['b'] not in SN]
if unk: bad.append('schema pieces with no node: %s' % unk[:20])
# the signals on the depot pieces (as tools/schema_deposito.py finds them) are all drawn
placed = {s['n'] for s in S['signals']}
dep_sig = sorted(sg['n'] for sg in net['signals'] if sg.get('n') and inb(sg.get('on_track') or (sg['lat'], sg['lon'])) and sg.get('kind') != 'stop'
                 and any(E[i]['way'] == sg.get('w') for i in dep_e))
miss_s = [n for n in dep_sig if n not in placed]
if miss_s: bad.append('depot signals not in the schema: %s' % miss_s)
places = {p['node'] for p in S.get('places', [])}; miss_p = [p['name'] for p in net.get('depot', []) if p['node'] not in places]
if miss_p: bad.append('depot places not in the schema: %s' % miss_p)
print('%s sinottico of the depot: %d pieces, %d nodes, %d signals, %d places | depot: %d pieces, %d nodes, %d signals%s'
      % ('FAIL' if bad else 'ok  ', len(SE), len(SN), len(placed), len(places), len(dep_e), len(dep_n), len(dep_sig), (' | ' + ' | '.join(bad)) if bad else ''))
sys.exit(1 if bad else 0)
