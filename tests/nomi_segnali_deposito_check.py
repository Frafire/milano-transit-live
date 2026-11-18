"""The names of the depot's signals are those of the real ACEI board of Rogoredo (Giovanni 16-17 Nov 2026, with the
frames of the video of the board): on Bin.N the head west of the track is 78-N (Bin.1 = 77 ... Bin.28 = 50), the head
east of it is N+19 (Bin.4 = 23 ... Bin.21 = 40), and on Bin.4-15 the pair of talpe on the joint in the middle of the track
is 78+N (looks east) and 20-N (looks west). Fails when a name is missing, is used twice, or is on the wrong signal.

Where each signal is comes from the build (build/m3.json): a depot place is named after the signal in front of it (the
west head for the places left by the west end, the east head for the others), so the names of the places say which head
is which; the talpe are the two signals on the piece between the two places of a rimessa track. The places are named
by their track (Giovanni 17 Nov 2026): B<n>, and B<n>.1 (west half) B<n>.2 (east half) on the rimessa.
    python3 tests/nomi_segnali_deposito_check.py"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, 'data', 'schema_deposito_m3.json')))
M = json.load(open(os.path.join(ROOT, 'build', 'm3.json')))
NET = M['net']; E = NET['edges']; SIGS = NET['signals']
NM = S.get('signames', {})
bad = []

# no name twice
seen = {}
for n, nm in NM.items(): seen.setdefault(nm, []).append(n)
for nm, ns in seen.items():
    if len(ns) > 1: bad.append('nome %s usato da piu segnali: %s' % (nm, ', '.join('#A' + x for x in ns)))

# the heads, from the names of the places
place = {d['node']: d for d in NET['depot']}
heads = 0
for b in S['bins']:
    N = int(b['t'].split('.')[1])
    for node in b['nodes']:
        dp = place.get(node)
        if not dp: continue
        if node >= 300000: continue          # (the west place of a rimessa track leaves from the front through the joint)
        n = int(dp.get('sig', dp['name']).lstrip('A').split('-')[0])
        west = N <= 3 or N >= 22
        want_place = 'B%d' % N if len(b['nodes']) == 1 else 'B%d.2' % N
        if dp['name'] != want_place: bad.append('%s: il posto si chiama %s, dovrebbe essere %s' % (b['t'], dp['name'], want_place))
        want = str(78 - N) if west else str(N + 19)
        heads += 1
        if NM.get(str(n)) != want:
            bad.append('%s, posto %s: il segnale in testa (%s) #A%d si chiama %s, sul quadro e %s' % (b['t'], dp['name'], 'ovest' if west else 'est', n, NM.get(str(n)), want))
    for node in b['nodes']:
        if node >= 300000 and node in place and place[node]['name'] != 'B%d.1' % N: bad.append('%s: il posto ovest si chiama %s, dovrebbe essere B%d.1' % (b['t'], place[node]['name'], N))

# the talpe: two on the joint of each rimessa track (Bin.4-15), facing away from each other
talpe = 0
by_n = {sg['n']: sg for sg in SIGS if sg.get('n') is not None}
on_edge = {}
for sg in S['signals']: on_edge.setdefault(sg['e'], []).append(sg['n'])
for b in S['bins']:
    N = int(b['t'].split('.')[1])
    if not 4 <= N <= 15: continue
    a, c = b['nodes']
    e = next((i for i, x in enumerate(E) if {x['a'], x['b']} == {a, c}), None)
    got = sorted(n for n in on_edge.get(e, []) if (by_n.get(n) or {}).get('talpa'))
    names = {NM.get(str(n)): by_n[n] for n in got}
    if set(names) != {str(78 + N), str(20 - N)}:
        bad.append('%s: talpe %s, sul quadro %d e %d' % (b['t'], sorted(names), 78 + N, 20 - N)); continue
    talpe += 2
    he, hw = names[str(78 + N)]['heading'], names[str(20 - N)]['heading']
    if abs((he - hw) % 360 - 180) > 20: bad.append('%s: le due talpe non guardano in versi opposti (%d, %d)' % (b['t'], he, hw))
    # 78+N looks the way the east head looks (towards the east end), 20-N the way the west head looks
    if not (20 <= he % 360 <= 80): bad.append('%s: la talpa %d dovrebbe guardare verso est (rotta %d)' % (b['t'], 78 + N, he))

if bad:
    print('FAIL nomi dei segnali del deposito (quadro ACEI di Rogoredo):'); print('\n'.join('   ' + x for x in bad)); sys.exit(1)
print('ok   nomi dei segnali del deposito come sul quadro: %d teste (ovest 78-N, est N+19), %d talpe (78+N e 20-N)' % (heads, talpe))
