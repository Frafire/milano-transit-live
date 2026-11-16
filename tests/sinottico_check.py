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
    # the strips of the line (Giovanni 16 Nov 2026): each cut where only the two main tracks pass, no node within 20 px
    # (no switch cut in half), no platform on it; the strips about as wide as each other
    cuts = (S.get('strips') or {}).get('cuts') or []
    if cuts:
        xs = [N[n][0] for n in shown]; edges_x = []
        for ei in S['edges']:
            a, b = str(E[ei]['a']), str(E[ei]['b'])
            if a in N and b in N: edges_x.append([q[0] for q in [N[a]] + list(V.get(str(ei)) or []) + [N[b]]])
        bad = 0
        for c in cuts:
            cr = sum(1 for P in edges_x if min(P) < c < max(P)); nn = [n for n in shown if abs(N[n][0] - c) < 20]
            pf = [p['st'] for p in S.get('platforms', []) if p['x0'] - 12 <= c <= p['x1'] + 12]
            ok = cr == 2 and not nn and not pf; bad += not ok
            print('   cut at x %s: %d tracks across%s%s%s' % (c, cr, ', nodes near: ' + ', '.join(nn) if nn else '', ', platforms: ' + ', '.join(pf) if pf else '', '' if ok else '  <- FAIL'))
        w = [cuts[0] - min(xs)] + [cuts[i + 1] - cuts[i] for i in range(len(cuts) - 1)] + [max(xs) - cuts[-1]]
        print('   %d strips, px wide:' % len(w), [round(v) for v in w])
        if bad:
            print('FAIL sinottico %s: %d cuts not on plain track' % (name, bad)); sys.exit(1)
if strict and found:
    print('FAIL sinottico: %d things to fix' % found); sys.exit(1)
