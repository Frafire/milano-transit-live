"""The sinottico files as drawn (Giovanni 16 Nov 2026): every piece of the track in one of the two drawings (the line or
the depot) and every signal drawn ("tu devi controllare che ci siano tutti i binari e soprattutto tutti i semafori": this
fails the build); then, only reported: nodes less than 10 px apart, pieces drawn shorter than 10 px, signals drawn less
than 12 px from another on the same row. Run in a build directory (it reads m3.json for the pieces' ends).

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

def sig_xy(S, sg):
    N, V, P = S['nodes'], S.get('via') or {}, S.get('part') or {}
    e = E[sg['e']]; a, b = str(e['a']), str(e['b'])
    if a not in N or b not in N: return None
    pts = [N[a]] + list(V.get(str(sg['e'])) or []) + [N[b]]
    if len(pts) == 2 and abs(pts[0][1] - pts[1][1]) > 0.5: return None      # (drawn level then at 45 degrees: not worked out)
    L = [math.dist(pts[k - 1], pts[k]) for k in range(1, len(pts))]; x = sg['f'] * sum(L)
    for k, l in enumerate(L):
        if x <= l or k == len(L) - 1:
            u = x / l if l else 0; return (pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u)
        x -= l


# every piece and every signal (only with the two files of the repository, not with one exported by hand)
if not args:
    SS = [json.load(open(f)) for f in files if os.path.exists(f)]
    drawn = {}
    for S in SS:
        for ei in S['edges']: drawn[ei] = drawn.get(ei, 0) + 1
    miss_e = [i for i in range(len(E)) if i not in drawn]; twice = [i for i, k in drawn.items() if k > 1 and not any(str(i) in (S.get('part') or {}) for S in SS)]
    shown_sig = set()
    for S in SS:
        se = set(S['edges']); P = S.get('part') or {}
        for sg in S['signals']:
            pr = P.get(str(sg['e'])) or [0, 1]
            if sg['e'] in se and pr[0] - 0.001 <= sg['f'] <= pr[1] + 0.001: shown_sig.add(sg['n'])
    # (every signal of the game, as the map shows them, Giovanni 18 Nov 2026: the placed ones, each block signal, each
    # wrong-way one; a placed signal that is the place of a block signal by the block's number)
    m3 = json.load(open('m3.json'))
    bpl = {b.get('placed') for b in m3.get('blocks') or [] if b.get('placed') is not None and not b.get('hidden')}
    want = sorted({sg['n'] for sg in net['signals'] if sg.get('n') is not None and sg.get('kind') != 'stop' and sg['n'] not in bpl}
                  | {b['n'] for b in m3.get('blocks') or [] if not b.get('hidden') and b.get('pid') is not None}
                  | {x['n'] for x in m3.get('illegal') or [] if x.get('pid') is not None})
    miss_s = [n for n in want if n not in shown_sig]
    print('%s sinottico, all of it: %d pieces of %d drawn%s%s, %d signals of %d drawn%s'
          % ('FAIL' if miss_e or miss_s or twice else 'ok  ', len(drawn), len(E), (', missing: %s' % miss_e) if miss_e else '',
             (', drawn twice: %s' % twice) if twice else '', len(shown_sig & set(want)), len(want), (', missing: %s' % ['#A%d' % n for n in miss_s]) if miss_s else ''))
    if miss_e or miss_s or twice: sys.exit(1)
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
    # the signals: two on the same row less than 12 px apart are hard to tell apart (and to click)
    se = set(S['edges']); XY = sorted(((sg['n'], q, sg.get('d')) for sg in S['signals'] if sg['e'] in se for q in [sig_xy(S, sg)] if q), key=lambda t: t[1][0])
    # (two back to back, looking opposite ways, are drawn on the two sides of the track: not counted)
    close = [(a[0], b[0], math.dist(a[1], b[1])) for i, a in enumerate(XY) for b in XY[i + 1:i + 8]
             if abs(a[1][1] - b[1][1]) < 1 and math.dist(a[1], b[1]) < 12 and not (a[2] and b[2] and a[2] != b[2])]
    print('   signals drawn: %d, less than 12 px from another on the same row: %d' % (len(XY), len(close)))
    for a, b, d in close: print('   signals #A%s and #A%s: %.1f px' % (a, b, d))
    found += len(near) + len(short) + len(close)
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
