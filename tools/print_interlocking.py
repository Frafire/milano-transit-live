"""Print the M3 interlocking for drawing it by hand (tablet): the depot, the test loop, then the whole line station by
station. Every track piece (with its way w..), the nodes, every placed signal with its fixed number (#A..) pointing the
way it faces, the block signals the game computes along the line (#A201...: the numbers the map shows), the wrong-way
signals at the platform ends, the stations and the depot places. One PDF (vector: zoom in as much as you like) plus a
PNG of each sheet.
Usage (from build/, after build_line.py): python3 ../tools/print_interlocking.py [out_dir]
"""
import json, math, os, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
M = json.load(open('m3.json')); N = M['net']
IL = N.get('interlocking') or {}
lat0, lon0 = 45.4305, 9.2565
kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
ROT = math.radians(float(os.environ.get('ROT', '0')))


def xy(la, lo):
    x, y = (lo - lon0) * kx, (la - lat0) * ky
    return x * math.cos(ROT) - y * math.sin(ROT), x * math.sin(ROT) + y * math.cos(ROT)


def decode(p):
    la, lo, out = p[0] / 1e6, p[1] / 1e6, []
    out.append((la, lo))
    for j in range(2, len(p), 2):
        la += p[j] / 1e6; lo += p[j + 1] / 1e6; out.append((la, lo))
    return out


EDGES = [[xy(*q) for q in decode(e['p'])] for e in N['edges']]
COL = {'yard': '#8a8a8a', 'test': '#c2185b', 'main': '#111111', 'link': '#1565c0', 'crossover': '#e65100', 'siding': '#795548'}
deg = {}
for e in N['edges']:
    for n in (e['a'], e['b']): deg[n] = deg.get(n, 0) + 1
ilsig = {int(k): v for k, v in (IL.get('signals') or {}).items()}
groups = IL.get('groups') or []
in_group = {si for g in groups for si in g['signals']}
zone_entry = {si for z in (IL.get('zones') or []) for si in z['entry']}
places = {dp['node']: dp for dp in N.get('depot', [])}


def path_pts(pid):
    P = M['paths'][pid]; return [xy(*q) for q in decode(P['p'])], P['d']


PATHS = {}
def at(pid, d):
    if pid not in PATHS: PATHS[pid] = path_pts(pid)
    pts, dd = PATHS[pid]; d = max(dd[0], min(dd[-1], d)); i = 0
    while i < len(dd) - 2 and dd[i + 1] < d: i += 1
    f = (d - dd[i]) / ((dd[i + 1] - dd[i]) or 1); (ax, ay), (bx, by) = pts[i], pts[i + 1]
    return ax + (bx - ax) * f, ay + (by - ay) * f


def heading_at(pid, d, sgn):
    a, b = at(pid, d - 3 * sgn), at(pid, d + 3 * sgn); n = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    return (b[0] - a[0]) / n, (b[1] - a[1]) / n


def _cat_at(x, y):
    best = None
    for e, P in zip(N['edges'], EDGES):
        for (ax, ay), (bx, by) in zip(P, P[1:]):
            dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1; u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
            dd = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if best is None or dd < best[0]: best = (dd, e['cat'])
    return best[1]
SIGCAT = [_cat_at(*xy(*(s.get('on_track') or (s['lat'], s['lon'])))) for s in N['signals']]   # the track a signal stands on
DEPOT_CATS = ('yard', 'test')

DG = M.get('degraded') or {}
HALF = M.get('half', 55) + 2.5
# block signals computed along the line: #A201 + block index, like the map (template.html buildSignals)
BLOCKS = [(bl.get('n') or 201 + bi, bl) for bi, bl in enumerate(M.get('blocks') or []) if bl.get('pid') is not None]
STATIONS = [(nm, at(DG['N']['pid'], d)) for nm, d in zip(DG.get('names', []), DG['N']['stops'])] if DG else []
WRONG = []                     # wrong-way signals at the platform ends (line banalizzata): placeholders, always red
for dr in ('N', 'S'):
    if dr in DG: WRONG += [(DG[dr]['pid'], d - HALF) for d in DG[dr]['stops'][1:]]


def sig_style(si, s):
    x = ilsig.get(si)
    if s.get('kind') == 'stop': return '#1e88e5', 'fermata di prova'
    if si in zone_entry: return '#6a1b9a', 'ingresso zona (un treno alla volta)'
    if x and x.get('manual'): return '#d32f2f', 'manovrato dal PC (deposito in manuale)'
    if si in in_group: return '#ef6c00', 'gruppo (uno alla volta)'
    if x: return '#f9a825', 'controllato (blocco)'
    if s.get('kind') == 'shunt': return '#00897b', 'manovra'
    return '#2e7d32', 'blocco / ATP'


def sheet(pdf, title, box, fs=1.0, wlabels=True, nlabels=True, m=None, line=False):
    X0, X1, Y0, Y1 = box
    m = m or fs                                       # arrows and label offsets: 6 m and 5 m times m
    L, OFF = 6 * m, 5 * m
    size = (23.4, 16.5) if X1 - X0 >= Y1 - Y0 else (16.5, 23.4)
    inb = lambda x, y: X0 - 5 < x < X1 + 5 and Y0 - 5 < y < Y1 + 5
    fig, ax = plt.subplots(figsize=size)
    for i, (e, P) in enumerate(zip(N['edges'], EDGES)):
        if not any(inb(x, y) for x, y in P): continue
        c = COL.get(e['cat'], '#111111'); dep = line and e['cat'] in DEPOT_CATS     # line sheets: the depot only as a faint outline
        ax.plot([x for x, _ in P], [y for _, y in P], '-', color=c, lw=0.8 if dep else 2.2 if e['cat'] != 'yard' else 1.6, alpha=.35 if dep else 1, solid_capstyle='round', zorder=1)
        if wlabels and e['way'] >= 0 and not dep:
            mid = P[len(P) // 2]
            if inb(*mid): ax.text(mid[0], mid[1], f"w{e['way']}", fontsize=6.5 * fs, color='#5c6bc0', alpha=.8, ha='center', va='center', zorder=2, clip_on=True,
                                 bbox=dict(boxstyle='round,pad=0.1', fc='white', ec='none', alpha=.6))
    for n, (la, lo) in N['nodes'].items():
        x, y = xy(la, lo)
        if not inb(x, y): continue
        d = deg.get(int(n), 0)
        if d >= 3 or d == 1:
            ax.plot(x, y, 'o', ms=2.5 if d >= 3 else 3.5, color='#333' if d >= 3 else '#999', zorder=3)
            if nlabels: ax.text(x, y - 2.2 * m, 'n' + n, fontsize=5.5 * fs, color='#2e7d32', ha='center', va='top', zorder=3, clip_on=True)
    for q, dp in places.items():
        x, y = xy(dp['lat'], dp['lon'])
        if inb(x, y) and not line: ax.plot(x, y, 's', ms=7 * fs, mfc='#c8e6c9', mec='#2e7d32', zorder=4)
    seen = {}
    for si, s in enumerate(N['signals']):
        la, lo = s.get('on_track') or (s['lat'], s['lon'])
        x, y = xy(la, lo)
        if not inb(x, y) or line and SIGCAT[si] in DEPOT_CATS: continue
        c, what = sig_style(si, s); seen[what] = c
        h = math.radians(s['heading']) + ROT * 0
        hx, hy = math.sin(h), math.cos(h)
        hx, hy = hx * math.cos(ROT) - hy * math.sin(ROT), hx * math.sin(ROT) + hy * math.cos(ROT)
        ax.annotate('', xy=(x + hx * L, y + hy * L), xytext=(x, y), arrowprops=dict(arrowstyle='-|>', color=c, lw=1.8, mutation_scale=11 * fs), zorder=6)
        ax.plot(x, y, 'o', ms=4 * fs, color=c, zorder=6)
        nx, ny = -hy, hx                              # label on the left of the way it faces
        if s.get('side') == 'right': nx, ny = hy, -hx
        num = s.get('n') or si + 1
        ax.text(x + nx * OFF, y + ny * OFF, f"#A{num:02d}", fontsize=9 * fs, fontweight='bold', color=c, ha='center', va='center', zorder=7, clip_on=True,
                bbox=dict(boxstyle='round,pad=0.15', fc='white', ec=c, lw=.6, alpha=.9))
    for num, bl in BLOCKS:
        x, y = at(bl['pid'], bl['signal_d'])
        if not inb(x, y): continue
        hx, hy = heading_at(bl['pid'], bl['signal_d'], 1); c = '#37474f'
        what = 'blocco di linea calcolato (#A201...)' if bl.get('real') else 'blocco calcolato, posizione stimata'
        seen[what] = c
        ax.annotate('', xy=(x + hx * L * 1.2, y + hy * L * 1.2), xytext=(x, y), arrowprops=dict(arrowstyle='-|>', color=c, lw=1.8, mutation_scale=11 * fs), zorder=6)
        ax.plot(x, y, 'o', ms=4.5 * fs, mfc=c if bl.get('real') else 'white', mec=c, mew=1.2, zorder=6)
        kind = {'entry': 'prot.', 'departure': 'part.', 'block': 'blocco'}.get(bl['kind'], '')
        ax.text(x - hy * OFF * 1.4, y + hx * OFF * 1.4, f"#A{num} {kind}", fontsize=8 * fs, fontweight='bold', color=c, ha='center', va='center', zorder=7, clip_on=True,
                bbox=dict(boxstyle='round,pad=0.15', fc='white', ec=c, lw=.6, alpha=.9, ls='-' if bl.get('real') else '--'))
    for pid, d in WRONG:
        x, y = at(pid, d)
        if not inb(x, y): continue
        hx, hy = heading_at(pid, d, -1); c = '#9e9e9e'; seen['senso inverso (fine banchina, sempre rosso)'] = c
        ax.annotate('', xy=(x + hx * L * .8, y + hy * L * .8), xytext=(x, y), arrowprops=dict(arrowstyle='-|>', color=c, lw=1.2, mutation_scale=8 * fs), zorder=5)
        ax.plot(x, y, 'o', ms=3 * fs, color=c, zorder=5)
    for nm, (x, y) in STATIONS:
        if inb(x, y): ax.text(x, y, nm.title(), fontsize=12 * fs, fontweight='bold', color='#0d47a1', ha='center', va='center', zorder=8, clip_on=True,
                              bbox=dict(boxstyle='round,pad=0.25', fc='#e3f2fd', ec='#0d47a1', lw=.8, alpha=.85))
    hand = [plt.Line2D([], [], color=c, marker='o', lw=0, ms=7, label=w) for w, c in seen.items()]
    hand += [plt.Line2D([], [], color=COL[k], lw=2.5, label=l) for k, l in (('yard', 'binari deposito'), ('test', 'anello di prova'), ('main', 'linea'), ('siding', 'tronchetti / comunicazioni'), ('link', 'raccordo'))]
    hand += [plt.Line2D([], [], marker='s', lw=0, ms=8, mfc='#c8e6c9', mec='#2e7d32', label='posto in deposito (nome = segnale davanti)')]
    fig.legend(handles=hand, loc='lower center', ncol=6, fontsize=10, frameon=False)
    ax.set_title(title + '  ·  frecce = verso in cui il segnale vale  ·  metri', fontsize=14, loc='left')
    ax.set_aspect('equal'); ax.set_xlim(X0, X1); ax.set_ylim(Y0, Y1)
    ax.grid(True, color='#eee', lw=.5); ax.set_axisbelow(True)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    pdf.savefig(fig)
    name = os.path.join(OUT, 'interlocking_%02d.png' % int(title.split('-')[0]))
    fig.savefig(name, dpi=150)
    plt.close(fig)
    return name


def fit(box, landscape):
    """grow the box to the sheet's proportions (A3, title and legend left out)"""
    X0, X1, Y0, Y1 = box; w, h = X1 - X0, Y1 - Y0; r = 1.48 if landscape else 1 / 1.33
    if w / h < r: g = (h * r - w) / 2; X0, X1 = X0 - g, X1 + g
    else: g = (w / r - h) / 2; Y0, Y1 = Y0 - g, Y1 + g
    return [X0, X1, Y0, Y1]


def line_sheets(first=9):
    """the line station by station: a sheet every ~1.4 km, from San Donato to the tails of Comasina"""
    if not DG: return []
    pid, st, names = DG['N']['pid'], DG['N']['stops'], DG['names']; Lp = M['paths'][pid]['d'][-1]
    out, i, k = [], 0, first
    while i < len(st) - 1:
        j = i + 1
        while j + 1 < len(st) and st[j + 1] - st[i] <= 1400: j += 1
        d0, d1 = max(0, st[i] - 250), min(Lp, st[j] + 250 if j < len(st) - 1 else Lp)
        P = [at(pid, d0 + (d1 - d0) * t / 60) for t in range(61)]
        xs, ys = [p[0] for p in P], [p[1] for p in P]
        box = [min(xs) - 70, max(xs) + 70, min(ys) - 70, max(ys) + 70]
        land = box[1] - box[0] >= box[3] - box[2]; box = fit(box, land)
        W = max(box[1] - box[0], box[3] - box[2])
        title = f"{k}-Linea {names[i].title()} – {names[j].title()}" + (' (deposito: fogli 1-8)' if i == 0 else '')
        out.append([title, box, 1.0, True, False, W / 320, True]); i = j; k += 1
    return out


def zoom_sheets(first):
    """a close-up of every group of signals placed along the line (terminals, tails, crossovers)"""
    pts = [(xy(*(sg.get('on_track') or (sg['lat'], sg['lon']))), sg.get('n') or si + 1) for si, sg in enumerate(N['signals']) if SIGCAT[si] not in DEPOT_CATS]
    groups_ = []
    for p_, n in pts:
        g = next((g for g in groups_ if any(math.dist(p_, q) < 200 for q, _ in g)), None)
        if g: g.append((p_, n))
        else: groups_.append([(p_, n)])
    out, k = [], first
    for g in groups_:
        xs, ys = [q[0] for q, _ in g], [q[1] for q, _ in g]
        box = [min(xs) - 70, max(xs) + 70, min(ys) - 70, max(ys) + 70]
        land = box[1] - box[0] >= box[3] - box[2]; box = fit(box, land); W = max(box[1] - box[0], box[3] - box[2])
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        st = min(STATIONS, key=lambda s_: math.dist(s_[1], (cx, cy)))[0].title() if STATIONS else ''
        ns = sorted(n for _, n in g)
        out.append([f"{k}-Zoom {st}: #A{ns[0]:02d}" + (f"-#A{ns[-1]:02d}" if len(ns) > 1 else ''), box, 1.0, True, True, W / 130, True]); k += 1
    return out


if __name__ == '__main__':
    SHEETS = json.loads(os.environ['SHEETS']) if 'SHEETS' in os.environ else [
        ['1-Insieme: deposito, anello di prova, ingresso dalla linea', [-470, 330, -340, 330], 0.75, False, False],
        ['2-Deposito', [-300, 15, -55, 225], 0.9, True, True],
        ['3-Testate est (A47-A65)', [-120, 5, 100, 210], 1.15, True, True],
        ['4-Testate ovest (A66-A93, A96)', [-295, -105, -45, 100], 1.15, True, True],
        ['5-Ingresso dalla linea (A02-A08, A98-A99)', [40, 320, -10, 320], 1.0, True, True],
        ['6-Anello: attesa A94, uscita, zone A100-A104', [-430, 10, -335, -60], 1.0, True, True],
        ['7-Zone guasto e cantiere (A100-A104)', [-250, -170, -215, -95], 1.2, True, True],
        ['8-Uscita e ingresso deposito (A02-A05)', [215, 290, 240, 310], 1.3, True, True],
    ]
    SHEETS += line_sheets(len(SHEETS) + 1)
    SHEETS += zoom_sheets(len(SHEETS) + 1)
    os.makedirs(OUT, exist_ok=True)
    with PdfPages(os.path.join(OUT, 'interlocking_m3.pdf')) as pdf:
        for sh in SHEETS: print(sheet(pdf, sh[0], sh[1], *sh[2:]))
