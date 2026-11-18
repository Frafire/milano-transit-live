"""The M3 tracks on the map and under the trains have no corners between the OSM points (Giovanni 18 Nov 2026:
"i binari sulla mappa sono tremolanti"): tools/router.py rounds them with arcs. This checks that the rounded track
stays within SMOOTH_MAX of the OSM line, that the ends of every piece (switches, buffers) did not move, that the length
of a piece changed by less than 1 m, and that along the main line no point turns more than 3 degrees (OSM: up to 9).
Run in the build folder (it reads osm_m3.txt, rules_m3.json):
    python3 ../tests/binari_lisci_check.py"""
import importlib, math, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
os.environ['SMOOTH_MAX'] = '0'
import router as R
raw = [(e['pts'], e['len'], e['svc']) for e in R.edges]
os.environ['SMOOTH_MAX'] = '0.5'
R = importlib.reload(R)
MAX = R.SMOOTH_MAX
bad, worst_dev, worst_turn, worst_len = [], 0.0, 0.0, 0.0


def off(P, q):
    best = 1e9
    for k in range(1, len(P)):
        A, B = P[k - 1], P[k]; dx, dy = B[0] - A[0], B[1] - A[1]; l2 = dx * dx + dy * dy or 1
        u = max(0, min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / l2))
        best = min(best, math.hypot(q[0] - A[0] - u * dx, q[1] - A[1] - u * dy))
    return best


for i, (e, (P0, L0, svc)) in enumerate(zip(R.edges, raw)):
    P = e['pts']
    if P[0] != P0[0] or P[-1] != P0[-1]: bad.append('pezzo %d: le estremità si sono spostate' % i)
    d = max(off(P0, q) for q in P); worst_dev = max(worst_dev, d)
    if d > MAX + 0.01: bad.append('pezzo %d: %.2f m fuori dal tracciato OSM (massimo %.1f)' % (i, d, MAX))
    worst_len = max(worst_len, abs(L0 - e['len']))
    if abs(L0 - e['len']) > 1.0: bad.append('pezzo %d: lunghezza cambiata di %.2f m' % (i, L0 - e['len']))
    if svc: continue                                      # (the main line only: yards have switches inside a piece)
    for k in range(1, len(P) - 1):
        a = math.atan2(P[k][1] - P[k - 1][1], P[k][0] - P[k - 1][0]); b = math.atan2(P[k + 1][1] - P[k][1], P[k + 1][0] - P[k][0])
        t = abs((math.degrees(b - a) + 180) % 360 - 180); worst_turn = max(worst_turn, t)
        if t > 3: bad.append('pezzo %d, punto %d: angolo di %.1f gradi' % (i, k, t)); break

if bad:
    print('FAIL binari lisci:'); print('\n'.join('   ' + x for x in bad[:20])); sys.exit(1)
print('ok   binari lisci: al massimo %.2f m dal tracciato OSM, lunghezze +-%.2f m, angolo massimo sulla linea %.1f gradi' % (worst_dev, worst_len, worst_turn))
