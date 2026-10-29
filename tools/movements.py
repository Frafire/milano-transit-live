"""Itinerari (movimenti dei treni) per ogni gruppo di scambi tra San Donato e Lodi, dal tracciato (build/m3.json).

Un movimento e' un percorso di un treno: i pezzi di binario che copre e gli scambi che usa. Due movimenti sono
  - par:  nessun pezzo e nessuno scambio in comune -> possono avere via libera insieme
  - seq:  il secondo puo' partire quando il primo ha liberato l'ultima cosa in comune (coda del treno passata): metri di corsa
  - excl: il primo SI FERMA su un pezzo in comune (banchina, tronchetto): si aspetta che riparta
I segnali di partenza/arrivo sono scritti a mano (ruolo certo dal file di Giovanni); gli altri campi vengono dal grafo.
Uso: cd build && python3 ../tools/movements.py [out.json]"""
import json, sys, heapq, collections

M = json.load(open('m3.json')); N = M['net']; E = N['edges']
TRAIN = 105.0; ARM = 200.0          # le braccia lunghe (linea aperta) si contano per 200 m dopo/prima dello scambio


def make_group(allowed, pseudo=None, cap=()):
    EDGES = {}
    for i in allowed:
        e = E[i]; EDGES[i] = (e['a'], e['b'], min(e['len'], ARM) if i in cap else e['len'])
    for k, v in (pseudo or {}).items(): EDGES[k] = v
    adj = collections.defaultdict(list)
    for k, (a, b, l) in EDGES.items(): adj[a].append((b, k, l)); adj[b].append((a, k, l))
    sw = {n for n, v in adj.items() if len(v) >= 3}
    return dict(EDGES=EDGES, adj=adj, SW=sw)


def route(G, wps):
    out = []
    for s, t in zip(wps, wps[1:]):
        dist = {s: 0}; prev = {}; pq = [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18): continue
            if u == t: break
            for v, k, l in G['adj'][u]:
                if out and out[-1][0] == k and u == s: continue
                if d + l < dist.get(v, 1e18): dist[v] = d + l; prev[v] = (u, k); heapq.heappush(pq, (d + l, v))
        seg = []; u = t
        while u != s: p, k = prev[u]; seg.append((k, p, u)); u = p
        out += seg[::-1]
    return out


def finish(G, m):
    s = m['steps']; cum = 0; res = []; sw = []
    for i, (k, a, b) in enumerate(s):
        L = G['EDGES'][k][2]; res.append(('E', k, cum, cum + L)); cum += L
        if i + 1 < len(s) and b in G['SW']:
            nk = s[i + 1][0]; sw.append((b, k, nk)); res.append(('N', b, cum, cum))
    m['res'] = res; m['switches'] = sw; m['len'] = cum
    return m


def compare(A, B):
    ra = {(r[0], r[1]): r for r in A['res']}; sh = [(r[0], r[1]) for r in B['res'] if (r[0], r[1]) in ra]
    if not sh: return ('par', None, [])
    if A.get('stops_end') and (A['res'][-1][0], A['res'][-1][1]) in sh: return ('excl', None, sh)
    return ('seq', max(ra[x][3] for x in sh) + TRAIN, sh)


def label(G, x, names):
    if x[0] == 'N': return 'scambio ' + str(x[1])
    return names.get(x[1], 'tratto %s' % x[1])


GROUPS = {}

# ---------------------------------------------------------------- San Donato
sd = make_group([110, 111, 112, 113, 132, 133, 145, 146, 166, 167, 171, 172, 173, 174, 209, 225, 226, 227, 228, 229, 234, 235, 236],
                {'ARR': ('ARRL', 153, 1.0), 'DEP': (165, 'DEPL', 1.0)})
SD_NAMES = {173: 'binario 3', 174: 'binario 1 (arrivi)', 225: 'binario 2 (lato est)', 226: 'binario 2 (lato ovest)', 171: 'tronchetto 1',
            110: 'tronchetto 2', 166: 'accesso deposito', 132: 'uscita deposito', 133: 'uscita deposito', 236: 'comunicazione 153-196',
            'ARR': 'linea da Rogoredo', 'DEP': 'linea verso Rogoredo'}


def sdm(i, label_, wps, legal, start, end, lim, first=None, last=None, stops_end=False, note=''):
    r = route(sd, wps)
    if first: r = [first] + r
    if last: r = r + [last]
    return finish(sd, dict(id=i, label=label_, legal=legal, steps=r, start=start, end=end, lim=lim, stops_end=stops_end, note=note))


SDM = [
    sdm('SD-1', 'Arrivo sul binario 1', ['ARRL', 153, 160], True, 'A13 (f)', 'ferma in banchina; poi attende A40', 'normale', stops_end=True),
    sdm('SD-2', 'Arrivo sul binario 2 con cambio banco (solo ritardi/anomalie)', ['ARRL', 153, 196, 120], True, 'A13 (f)', 'ferma in banchina b2; poi attende A44/A45', '15 km/h sulla comunicazione', stops_end=True),
    sdm('SD-3', 'Binario 1 -> deposito', [160, 160], True, 'A40', 'A04 (ingresso deposito)', 'tronchetto/deposito', first=(174, 153, 160), last=(166, 160, 40)),
    sdm('SD-4', 'Binario 1 -> tronchetto 1', [160, 163], True, 'A40', 'ferma al tronchetto 1', '15 km/h', first=(174, 153, 160), stops_end=True),
    sdm('SD-5', 'Binario 1 -> tronchetto 2', [160, 116], True, 'A40', 'ferma al tronchetto 2', '15 km/h', first=(174, 153, 160), stops_end=True),
    sdm('SD-6', 'Tronchetto 1 -> binario 3', [163, 143], True, 'A08', 'ferma in banchina b3; poi attende A14', '15 km/h', last=(173, 143, 165), stops_end=True),
    sdm('SD-7', 'Tronchetto 1 -> binario 2', [163, 120], True, 'A08', 'ferma in banchina b2; poi attende A45', '15 km/h', last=(225, 120, 196), stops_end=True),
    sdm('SD-8', 'Tronchetto 2 -> binario 3', [116, 143], True, 'A07', 'ferma in banchina b3; poi attende A14', '15 km/h', last=(173, 143, 165), stops_end=True),
    sdm('SD-9', 'Tronchetto 2 -> binario 2', [116, 120], True, 'A07', 'ferma in banchina b2; poi attende A45', '15 km/h', last=(225, 120, 196), stops_end=True),
    sdm('SD-10', 'Deposito -> binario 3', [141, 143], True, 'A06', 'ferma in banchina b3; poi attende A14', 'deposito/15 km/h', last=(173, 143, 165), stops_end=True),
    sdm('SD-11', 'Deposito -> binario 2 (mai visto, possibile)', [141, 120], True, 'A06', 'ferma in banchina b2; poi attende A45', '15 km/h', last=(225, 120, 196), stops_end=True),
    sdm('SD-12', 'Binario 3 -> linea Rogoredo (partenza normale)', [143, 'DEPL'], True, 'A14 (e)', 'A290 (prossimo segnale in linea)', 'normale'),
    sdm('SD-13', 'Binario 2 -> linea Rogoredo (partenza normale)', [120, 196, 165, 'DEPL'], True, 'A45 (e)', 'A290 (prossimo segnale in linea)', 'normale'),
    sdm('SD-14', 'Binario 1 -> linea Rogoredo (ILLEGALE, navetta: possibile ma congestiona il tunnel)', [160, 153, 'ARRL'], False, 'A349 (d, rosso)', 'primo segnale in linea contromano (A310 a Rogoredo)', '15 km/h sulla comunicazione se usata', first=None),
    sdm('SD-15', 'Binario 3 guasto -> deposito (ILLEGALE)', [143, 141], False, 'A41', 'A06 lato deposito', 'deposito/15 km/h', first=(173, 165, 143)),
    sdm('SD-16', 'Binario 2 guasto -> deposito (ILLEGALE)', [196, 120, 119, 118, 117, 142, 141], False, 'A44', 'A06 lato deposito', '15 km/h', first=None),
    sdm('SD-17', 'Binario 3 -> tronchetto 1 (cambio banco, poi inverte)', [165, 143, 163], False, 'A41', 'ferma al tronchetto 1', '15 km/h', stops_end=True),
    sdm('SD-18', 'Binario 3 -> tronchetto 2 (cambio banco, poi inverte)', [165, 143, 116], False, 'A41', 'ferma al tronchetto 2', '15 km/h', stops_end=True),
    sdm('SD-19', 'Binario 2 -> tronchetto 1 (cambio banco, poi inverte)', [196, 120, 163], False, 'A44', 'ferma al tronchetto 1', '15 km/h', stops_end=True),
    sdm('SD-20', 'Binario 2 -> tronchetto 2 (cambio banco, poi inverte)', [196, 120, 116], False, 'A44', 'ferma al tronchetto 2', '15 km/h', stops_end=True),
]
# SD-14: la partenza contromano dal binario 1 parte dal fondo banchina verso la gola
for m in SDM:
    if m['id'] == 'SD-14': m['steps'] = [(174, 160, 153), ('ARR', 153, 'ARRL')]; finish(sd, m)
GROUPS['SD'] = dict(title='San Donato (gola della stazione + tronchetti + deposito)', G=sd, names=SD_NAMES, moves=SDM)

# ---------------------------------------------------------------- Rogoredo: incrocio 136(binario sud)-137(binario nord), edge 127
rog = make_group([127, 141, 142, 175, 176], cap=(141, 142, 175, 176))
ROG_NAMES = {175: 'binario nord lato SD (legale N)', 142: 'binario sud lato SD (legale S)', 176: 'binario nord lato Porto di Mare / banchina', 141: 'binario sud lato Porto di Mare / banchina', 127: 'incrocio'}


def rg(i, lab, wps, legal, start, end, lim, stops_end=False, note=''):
    return finish(rog, dict(id=i, label=lab, legal=legal, steps=route(rog, wps), start=start, end=end, lim=lim, stops_end=stops_end, note=note))


ROGM = [
    rg('RG-1', 'Da SD sul binario nord, dritto alla banchina nord (normale)', [165, 137, 166], True, 'A290 (b)', 'ferma in banchina nord; poi A204', 'normale', True),
    rg('RG-2', 'Da SD sul binario nord, incrocio -> banchina sud (contromano)', [165, 137, 136, 152], False, 'A290 (b)', 'ferma in banchina sud; poi A348', '15 km/h', True),
    rg('RG-3', 'Da SD sul binario sud (contromano), dritto alla banchina sud', [153, 136, 152], False, 'A301 (b illegale)', 'ferma in banchina sud; poi A348', 'normale (contromano)', True),
    rg('RG-4', 'Da SD sul binario sud (contromano), incrocio -> banchina nord', [153, 136, 137, 166], True, 'A301 (b illegale)', 'ferma in banchina nord; poi A204', '15 km/h', True),
    rg('RG-5', 'Dalla banchina sud verso SD, dritto sul binario sud (normale)', [152, 136, 153], True, 'A285 (d)', 'A13 (entrata SD)', 'normale'),
    rg('RG-7', 'Dalla banchina nord verso SD, dritto sul binario nord (contromano)', [166, 137, 165], False, 'A310 (d illegale)', 'primo segnale contromano su binario nord', 'normale (contromano)'),
    rg('RG-8', 'Dalla banchina nord verso SD, incrocio -> binario sud (normale)', [166, 137, 136, 153], True, 'A310 (d illegale)', 'A13 (entrata SD)', '15 km/h'),
]
GROUPS['ROG'] = dict(title='Rogoredo FS: incrocio (scambi 136 e 137) sul lato San Donato', G=rog, names=ROG_NAMES, moves=ROGM)

# ---------------------------------------------------------------- Brenta: tronchetto sul binario sud tra Lodi e Brenta
bre = make_group([139, 140, 141, 237, 238, 239, 240, 241], cap=(139, 141))
BRE_NAMES = {139: 'binario sud verso Lodi', 140: 'binario sud, tratto del tronchetto', 141: 'binario sud / banchina Brenta', 241: 'raccordo tronchetto lato Lodi', 239: 'tronchetto (225 m)',
             237: 'raccordo tronchetto lato Brenta', 238: 'moncone lato Lodi (32 m)', 240: 'moncone lato Brenta (27 m)'}


def br(i, lab, wps, legal, start, end, lim, stops_end=False, note=''):
    return finish(bre, dict(id=i, label=lab, legal=legal, steps=route(bre, wps), start=start, end=end, lim=lim, stops_end=stops_end, note=note))


BREM = [
    br('BR-1', 'Da Lodi dritto a Brenta (normale)', [150, 151, 152, 136], True, 'A277 (b)', 'ferma in banchina Brenta; poi A279', 'normale', True),
    br('BR-2', 'Da Lodi deviato sul tronchetto', [150, 151, 199, 197], True, 'A277 (b)', 'ferma nel tronchetto (A19/A20 manuali)', '15 km/h', True),
    br('BR-3', 'Dal tronchetto a Brenta (uscita con A20)', [197, 152, 136], True, 'A20 (manuale)', 'ferma in banchina Brenta; poi A279', '15 km/h', True),
    br('BR-4', 'Dal tronchetto verso Lodi (uscita con A19, contromano)', [197, 199, 151, 150], False, 'A19 (manuale)', 'segnale illegale di Lodi (A308)', '15 km/h'),
    br('BR-5', 'Da Brenta verso Lodi dritto (contromano)', [136, 152, 151, 150], False, 'A345 (d illegale)', 'segnale illegale di Lodi (A308)', 'normale (contromano)'),
    br('BR-6', 'Da Brenta deviato sul tronchetto (contromano)', [136, 152, 197, 199], False, 'A345 (d illegale)', 'ferma nel tronchetto', '15 km/h', True),
]
GROUPS['BRE'] = dict(title='Brenta: tronchetto (scambi 151, 152, 199, 197)', G=bre, names=BRE_NAMES, moves=BREM)

# ---------------------------------------------------------------- Lodi: incrocio 150(binario sud)-166(binario nord), edge 205
lod = make_group([138, 139, 176, 177, 205], cap=(138, 139, 176, 177))
LOD_NAMES = {138: 'binario sud / banchina Lodi', 139: 'binario sud lato Brenta', 176: 'binario nord lato Brenta', 177: 'binario nord / banchina Lodi', 205: 'incrocio'}


def ld(i, lab, wps, legal, start, end, lim, stops_end=False, note=''):
    return finish(lod, dict(id=i, label=lab, legal=legal, steps=route(lod, wps), start=start, end=end, lim=lim, stops_end=stops_end, note=note))


LODM = [
    ld('LD-1', 'Da Brenta sul binario nord, dritto alla banchina nord (normale)', [137, 166, 167], True, 'A211 (b)', 'ferma in banchina nord; poi A212', 'normale', True),
    ld('LD-2', 'Da Brenta sul binario nord, incrocio -> banchina sud (contromano)', [137, 166, 150, 149], False, 'A211 (b)', 'ferma in banchina sud; poi A344', '15 km/h', True),
    ld('LD-3', 'Da Brenta sul binario sud (contromano), dritto alla banchina sud', [151, 150, 149], False, 'A308 (b illegale)', 'ferma in banchina sud; poi A344', 'normale (contromano)', True),
    ld('LD-4', 'Da Brenta sul binario sud (contromano), incrocio -> banchina nord', [151, 150, 166, 167], True, 'A308 (b illegale)', 'ferma in banchina nord; poi A212', '15 km/h', True),
    ld('LD-5', 'Dalla banchina sud verso Brenta, dritto (normale)', [149, 150, 151], True, 'A276 (d)', 'A277 (b)', 'normale'),
    ld('LD-7', 'Dalla banchina nord verso Brenta, dritto (contromano)', [167, 166, 137], False, 'A314 (d illegale)', 'segnale contromano su binario nord', 'normale (contromano)'),
    ld('LD-8', 'Dalla banchina nord verso Brenta, incrocio -> binario sud (normale)', [167, 166, 150, 151], True, 'A314 (d illegale)', 'A277 (b)', '15 km/h'),
]
GROUPS['LOD'] = dict(title='Lodi T.I.B.B.: incrocio (scambi 150 e 166) sul lato Brenta', G=lod, names=LOD_NAMES, moves=LODM)


# cambio banco: un treno contromano parte sempre da un segnale che ha davanti dopo aver fermato e invertito la cabina
REVERSE = {'SD-14': 'binario 1', 'SD-15': 'binario 3', 'SD-16': 'binario 2', 'SD-17': 'binario 3', 'SD-18': 'binario 3', 'SD-19': 'binario 2', 'SD-20': 'binario 2',
           'RG-3': 'binario 1 di San Donato (SD-14)', 'RG-4': 'binario 1 di San Donato (SD-14)', 'RG-7': 'banchina nord di Rogoredo', 'RG-8': 'banchina nord di Rogoredo',
           'BR-4': 'tronchetto', 'BR-5': 'banchina di Brenta', 'BR-6': 'banchina di Brenta',
           'LD-3': 'tronchetto/banchina di Brenta (BR-5)', 'LD-7': 'banchina nord di Lodi', 'LD-8': 'banchina nord di Lodi'}
# i movimenti contromano che NON hanno bisogno di inversione perche' il treno e' gia' in marcia (arrivo in banchina dopo un incrocio): RG-2, LD-2
NO_REVERSE = {'RG-2', 'LD-2'}


def export(path):
    import re
    out = []
    for key, g in GROUPS.items():
        for m in g['moves']:
            sig = re.match(r'A(\d+)', m['start'])
            out.append(dict(id=m['id'], group=key, label=m['label'], legal=m['legal'], start_signal=int(sig.group(1)) if sig else None, start=m['start'], end=m['end'],
                            limit=m['lim'], reverse_at=REVERSE.get(m['id']), no_reverse=m['id'] in NO_REVERSE, stops_end=bool(m['stops_end']),
                            edges=[[k, a, b] for k, a, b in m['steps']], switches=[list(x) for x in m['switches']]))
    json.dump({'_about': 'Itinerari M3 San Donato-Lodi, generati da tools/movements.py. start_signal: numero #A del segnale che li apre. reverse_at: dove il treno inverte la cabina prima di partire contromano.', 'itineraries': out}, open(path, 'w'), ensure_ascii=False, indent=1, default=str)


def matrix(g):
    ms = g['moves']; out = {}
    for A in ms:
        for B in ms:
            if A is B: continue
            k, d, sh = compare(A, B); out[A['id'] + '>' + B['id']] = [k, d, [label(g['G'], x, g['names']) for x in sh]]
    return out


if __name__ == '__main__':
    res = {}
    for key, g in GROUPS.items():
        print('\n==', g['title'])
        for m in g['moves']:
            print('%-6s %-70s %s  sw %s | %s -> %s | %s' % (m['id'], m['label'], 'L' if m['legal'] else 'I', ' '.join('%s:%s>%s' % x for x in m['switches']), m['start'], m['end'], m['lim']))
        ms = g['moves']
        print('       ' + ' '.join('%-6s' % m['id'][-4:] for m in ms))
        for A in ms:
            print('%-6s' % A['id'], ' '.join('%-6s' % ('.' if A is B else (lambda r: 'par' if r[0] == 'par' else 'EXCL' if r[0] == 'excl' else '%dm' % r[1])(compare(A, B))) for B in ms))
        res[key] = dict(title=g['title'], moves=[{k: m[k] for k in ('id', 'label', 'legal', 'start', 'end', 'lim', 'switches', 'len', 'steps', 'stops_end')} for m in ms], matrix=matrix(g))
    json.dump(res, open(sys.argv[1] if len(sys.argv) > 1 else 'movements.json', 'w'), ensure_ascii=False, indent=1, default=str)
    if len(sys.argv) > 2: export(sys.argv[2])
