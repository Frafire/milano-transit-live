"""The sinottico files as drawn (Giovanni 16 Nov 2026): nodes less than 10 px apart and pieces drawn shorter than 10 px,
the ones that cannot be moved by hand in the editor. Run in a build directory (it reads m3.json for the pieces' ends).

    python3 tests/sinottico_check.py [file.json ...] [--strict]

With no file: data/sinottico_linea_m3.json and data/schema_deposito_m3.json, or the file exported by the editor given
by name. It only reports (a warning in the build) unless --strict, then it fails when there is something to report.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEAR = 10.0
args = [a for a in sys.argv[1:] if not a.startswith('--')]
strict = '--strict' in sys.argv
files = args or [os.path.join(ROOT, 'data', 'sinottico_linea_m3.json'), os.path.join(ROOT, 'data', 'schema_deposito_m3.json')]
net = json.load(open('m3.json'))['net'] if os.path.exists('m3.json') else None
if not net:
    print('sinottico: no m3.json here (run it in a build directory)'); sys.exit(0)
E = net['edges']
found = 0
for f in files:
    if not os.path.exists(f): print('sinottico: missing', f); continue
    S = json.load(open(f)); N = S['nodes']; V = S.get('via') or {}; P = S.get('part') or {}
    shown = sorted({str(E[ei][k]) for ei in S['edges'] for k in ('a', 'b')} & set(N), key=lambda n: N[n][0])
    near = []
    for i, a in enumerate(shown):
        for b in shown[i + 1:]:
            if N[b][0] - N[a][0] >= NEAR: break
            d = math.dist(N[a], N[b])
            if d < NEAR: near.append((a, b, d))
    short = []
    for ei in S['edges']:
        a, b = str(E[ei]['a']), str(E[ei]['b'])
        if a not in N or b not in N: continue
        pts = [N[a]] + list(V.get(str(ei)) or []) + [N[b]]
        pr = P.get(str(ei)) or [0, 1]
        L = sum(math.dist(pts[k - 1], pts[k]) for k in range(1, len(pts))) * (pr[1] - pr[0])
        if L < NEAR: short.append((a, b, ei, L))
    name = os.path.basename(f)
    print('sinottico %s: %d nodes, nodes less than %g px apart: %d, pieces shorter than %g px: %d'
          % (name, len(shown), NEAR, len(near), NEAR, len(short)))
    for a, b, d in near: print('   nodes %s and %s: %.1f px' % (a, b, d))
    for a, b, ei, L in short: print('   piece %s - %s (edge %s): %.1f px' % (a, b, ei, L))
    found += len(near) + len(short)
if strict and found:
    print('FAIL sinottico: %d things to fix' % found); sys.exit(1)
