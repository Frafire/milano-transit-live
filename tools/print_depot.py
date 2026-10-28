"""Print the depot, the test loop and the junction with the line, for drawing the interlocking by hand (tablet).
Every track piece (with its way w..), the nodes, every signal with its fixed number (#A..) pointing the way it faces,
and the depot places. One PDF with several sheets (vector: zoom in as much as you like) plus a PNG of each sheet.
Usage (from build/, after build_line.py): python3 ../tools/print_depot.py [out_dir]
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
COL = {'yard': '#8a8a8a', 'test': '#c2185b', 'main': '#111111', 'link': '#1565c0', 'crossover': '#e65100'}
deg = {}
for e in N['edges']:
    for n in (e['a'], e['b']): deg[n] = deg.get(n, 0) + 1
ilsig = {int(k): v for k, v in (IL.get('signals') or {}).items()}
groups = IL.get('groups') or []
in_group = {si for g in groups for si in g['signals']}
zone_entry = {si for z in (IL.get('zones') or []) for si in z['entry']}
places = {dp['node']: dp for dp in N.get('depot', [])}


def sig_style(si, s):
    x = ilsig.get(si)
    if s.get('kind') == 'stop': return '#1e88e5', 'fermata di prova'
    if si in zone_entry: return '#6a1b9a', 'ingresso zona (un treno alla volta)'
    if x and x.get('manual'): return '#d32f2f', 'manovrato dal PC (deposito in manuale)'
    if si in in_group: return '#ef6c00', 'gruppo (uno alla volta)'
    if x: return '#f9a825', 'controllato (blocco)'
    if s.get('kind') == 'shunt': return '#00897b', 'manovra'
    return '#2e7d32', 'blocco / ATP'


def sheet(pdf, title, box, fs=1.0, size=(23.4, 16.5), wlabels=True, nlabels=True):
    X0, X1, Y0, Y1 = box
    inb = lambda x, y: X0 - 5 < x < X1 + 5 and Y0 - 5 < y < Y1 + 5
    fig, ax = plt.subplots(figsize=size)
    for i, (e, P) in enumerate(zip(N['edges'], EDGES)):
        if not any(inb(x, y) for x, y in P): continue
        c = COL.get(e['cat'], '#111111')
        ax.plot([x for x, _ in P], [y for _, y in P], '-', color=c, lw=2.2 if e['cat'] != 'yard' else 1.6, solid_capstyle='round', zorder=1)
        if wlabels and e['way'] >= 0:
            m = P[len(P) // 2]
            if inb(*m): ax.text(m[0], m[1], f"w{e['way']}", fontsize=6.5 * fs, color='#5c6bc0', alpha=.8, ha='center', va='center', zorder=2, clip_on=True,
                                 bbox=dict(boxstyle='round,pad=0.1', fc='white', ec='none', alpha=.6))
    for n, (la, lo) in N['nodes'].items():
        x, y = xy(la, lo)
        if not inb(x, y): continue
        d = deg.get(int(n), 0)
        if d >= 3 or d == 1:
            ax.plot(x, y, 'o', ms=2.5 if d >= 3 else 3.5, color='#333' if d >= 3 else '#999', zorder=3)
            if nlabels: ax.text(x, y - 2.2 * fs, 'n' + n, fontsize=5.5 * fs, color='#2e7d32', ha='center', va='top', zorder=3, clip_on=True)
    for q, dp in places.items():
        x, y = xy(dp['lat'], dp['lon'])
        if inb(x, y): ax.plot(x, y, 's', ms=7 * fs, mfc='#c8e6c9', mec='#2e7d32', zorder=4)
    seen = {}
    for si, s in enumerate(N['signals']):
        la, lo = s.get('on_track') or (s['lat'], s['lon'])
        x, y = xy(la, lo)
        if not inb(x, y): continue
        c, what = sig_style(si, s); seen[what] = c
        h = math.radians(s['heading']) + ROT * 0
        hx, hy = math.sin(h), math.cos(h)
        hx, hy = hx * math.cos(ROT) - hy * math.sin(ROT), hx * math.sin(ROT) + hy * math.cos(ROT)
        L = 6 * fs
        ax.annotate('', xy=(x + hx * L, y + hy * L), xytext=(x, y), arrowprops=dict(arrowstyle='-|>', color=c, lw=1.8, mutation_scale=11 * fs), zorder=6)
        ax.plot(x, y, 'o', ms=4 * fs, color=c, zorder=6)
        nx, ny = -hy, hx                              # label on the left of the way it faces
        if s.get('side') == 'right': nx, ny = hy, -hx
        num = s.get('n') or si + 1
        ax.text(x + nx * 5 * fs, y + ny * 5 * fs, f"#A{num:02d}", fontsize=9 * fs, fontweight='bold', color=c, ha='center', va='center', zorder=7, clip_on=True,
                bbox=dict(boxstyle='round,pad=0.15', fc='white', ec=c, lw=.6, alpha=.9))
    hand = [plt.Line2D([], [], color=c, marker='o', lw=0, ms=7, label=w) for w, c in seen.items()]
    hand += [plt.Line2D([], [], color=COL[k], lw=2.5, label=l) for k, l in (('yard', 'binari deposito'), ('test', 'anello di prova'), ('main', 'linea'), ('link', 'raccordo'))]
    hand += [plt.Line2D([], [], marker='s', lw=0, ms=8, mfc='#c8e6c9', mec='#2e7d32', label='posto in deposito (nome = segnale davanti)')]
    fig.legend(handles=hand, loc='lower center', ncol=6, fontsize=10, frameon=False)
    ax.set_title(title + '  ·  frecce = verso in cui il segnale vale  ·  metri', fontsize=14, loc='left')
    ax.set_aspect('equal'); ax.set_xlim(X0, X1); ax.set_ylim(Y0, Y1)
    ax.grid(True, color='#eee', lw=.5); ax.set_axisbelow(True)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    pdf.savefig(fig)
    name = os.path.join(OUT, 'deposito_%s.png' % title.split('-')[0])
    fig.savefig(name, dpi=150)
    plt.close(fig)
    return name


if __name__ == '__main__':
    SHEETS = json.loads(os.environ['SHEETS']) if 'SHEETS' in os.environ else [
        ['1-Insieme: deposito, anello di prova, ingresso dalla linea', [-470, 330, -340, 330], 0.75, False, False],
        ['2-Deposito', [-300, 15, -55, 225], 0.9, True, True],
        ['3-Testate est (A47-A65)', [-120, 5, 100, 210], 1.15, True, True],
        ['4-Testate ovest (A66-A93, A96)', [-295, -105, -45, 100], 1.15, True, True],
        ['5-Ingresso dalla linea (A02-A08, A98-A99)', [40, 320, -10, 320], 1.0, True, True],
        ['6-Anello: attesa A94, uscita, zone A100-A104', [-430, 10, -335, -60], 1.0, True, True],
        ['8-Uscita e ingresso deposito (A02-A05)', [215, 290, 240, 310], 1.3, True, True],
        ['7-Zone guasto e cantiere (A100-A104)', [-250, -170, -215, -95], 1.2, True, True],
    ]
    os.makedirs(OUT, exist_ok=True)
    with PdfPages(os.path.join(OUT, 'deposito_interlocking.pdf')) as pdf:
        for t, box, fs, wl, nl in SHEETS: print(sheet(pdf, t, box, fs, wlabels=wl, nlabels=nl))
