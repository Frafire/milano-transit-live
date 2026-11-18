"""Checks tools/lisci_m2.py in an M2 build folder: same tracks, ends and junctions where OpenStreetMap has them, never
farther from the OSM line than the caps, length almost unchanged, no sharp corners left on the main line.
Usage (in build_m2/<day>): python3 tests/m2_lisci_check.py"""
import json, math, collections, sys

LAT0 = 45.47; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
SWITCH = 1.0
CAP = {'main': 0.5, 'siding': 1.0, 'crossover': 1.0, 'yard': 1.5}
def decode(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((b / 1e6 * KX, a / 1e6 * KY))
    return o
def segd(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
def plen(P): return sum(math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) for i in range(1, len(P)))

before = json.load(open('m2_tracks_osm.json')); after = json.load(open('m2.json'))['tracks']
bad = []
if len(before) != len(after): sys.exit('FAIL: %d tracks before, %d after' % (len(before), len(after)))
use = collections.Counter()
for t in before:
    for q in set((round(x, 3), round(y, 3)) for x, y in decode(t['p'])): use[q] += 1
worst = collections.defaultdict(float); turn = 0
for k, (b, a) in enumerate(zip(before, after)):
    if b['c'] != a['c'] or b['w'] != a['w']: bad.append('track %d changed kind' % k); continue
    B, A = decode(b['p']), decode(a['p'])
    for e in (0, -1):
        if math.hypot(A[e][0] - B[e][0], A[e][1] - B[e][1]) > 0.01: bad.append('track %d: end moved' % k)
    Aset = set((round(x, 3), round(y, 3)) for x, y in A)
    for x, y in B:
        q = (round(x, 3), round(y, 3))
        if use[q] > 1 and q not in Aset and min(math.hypot(x - p[0], y - p[1]) for p in A) > 0.01:
            bad.append('track %d: junction moved' % k); break
    J = [B[0], B[-1]] + [q for q in B if use[(round(q[0], 3), round(q[1], 3))] > 1]
    cap = CAP.get(b['c'], 1.0) + 0.05
    for p in A:
        d = min(segd(p, B[i - 1], B[i]) for i in range(1, len(B))) if len(B) > 1 else 0
        # a switch branch may start along the track it leaves: up to SWITCH (1 m) in its first/last 45 m
        near = any(math.hypot(p[0] - j[0], p[1] - j[1]) < 45 for j in J)
        c = max(cap, SWITCH + 0.05) if near else cap
        if not near: worst[b['c']] = max(worst[b['c']], d)
        if d > c: bad.append('track %d (%s): %.2f m off OSM' % (k, b['c'], d)); break
    lb, la = plen(B), plen(A)
    if lb > 5 and abs(la - lb) > max(1.0, 0.01 * lb): bad.append('track %d: length %.1f -> %.1f m' % (k, lb, la))
    if b['c'] == 'main':                                 # direction change over 3 m either side (no rounding noise)
        S = [0.0]
        for i in range(1, len(A)): S.append(S[-1] + math.hypot(A[i][0] - A[i - 1][0], A[i][1] - A[i - 1][1]))
        lo = hi = 0
        for i in range(len(A)):
            while S[i] - S[lo] > 3: lo += 1
            while hi < len(A) - 1 and S[hi] - S[i] < 3: hi += 1
            if S[i] - S[lo] < 2.5 or S[hi] - S[i] < 2.5: continue
            u = (A[i][0] - A[lo][0], A[i][1] - A[lo][1]); v = (A[hi][0] - A[i][0], A[hi][1] - A[i][1])
            turn = max(turn, abs(math.degrees(math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]))))
if turn > 6: bad.append('main line: corner of %.1f degrees left' % turn)
for m in bad[:20]: print('FAIL', m)
if bad: sys.exit('m2_lisci_check: %d problems' % len(bad))
print('m2_lisci_check: %d tracks, ends and junctions in place, at most %s m off OSM, sharpest main-line corner %.1f deg'
      % (len(after), ', '.join('%s %.2f' % kv for kv in sorted(worst.items())), turn))
