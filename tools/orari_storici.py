"""Gli orari storici della M3 dai PDF ATM (Giovanni 10 Nov 2026): le partenze di ogni stazione, per senso e tipo di giorno.

    python3 tools/orari_storici.py estrai <pdf> <nome>     # -> data/storico/m3_<nome>.json (serve pdftotext)

Il PDF ATM ha una pagina per stazione e senso; in ogni pagina tre colonne (da lunedì a venerdì, sabato, festivo), una riga
per ora ("6:00  0 8 16 ..." = 6:00, 6:08, 6:16 ...) e, tra le 7 e le 19, solo la frequenza ("ogni 3' - 5'"). Le corse dopo
mezzanotte (0:xx, 1:xx, 2:xx) sono della stessa giornata: qui sono scritte come 24:xx, 25:xx, 26:xx (la giornata del gioco
cambia alle 3:00). Qui si copia il PDF, niente di più: il resto (le corse, le fasce) lo fa tools/storico_corse.py.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS = ['feriale', 'sabato', 'festivo']
NAMES = {'S.DONATO': 'SAN DONATO', 'S. DONATO': 'SAN DONATO', 'LODI TIBB': 'LODI T.I.B.B.', 'P.TA ROMANA': 'PORTA ROMANA', 'DUOMO': 'DUOMO M3'}


def pages(pdf):
    return subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout.split('\f')


def parse_page(pg):
    L = pg.split('\n'); body = [l for l in L if l.strip()]
    if not body: return None
    st = body[0].strip(); m = re.search(r'Trains to\s+(.*)', pg); to = m.group(1).strip() if m else None
    valid = re.search(r'valid from\s+(\S+)(?:\s+al to\s+(\S+))?', pg)
    # the columns: where the three "dalle from" (the frequency boxes) start
    starts = None
    for l in L:
        xs = [m_.start() for m_ in re.finditer(r'dalle from', l)]
        if len(xs) == 3: starts = xs; break
    if not starts: return None
    col = lambda x: 2 if x >= starts[2] - 6 else 1 if x >= starts[1] - 6 else 0
    dep = {d: [] for d in DAYS}; freq = {}
    for l in L:
        toks = [(m_.start(), int(m_.group(1))) for m_ in re.finditer(r'(\d{1,2}):00', l)]
        for i, (x, h) in enumerate(toks):
            end = toks[i + 1][0] if i + 1 < len(toks) else len(l)
            mins = [int(v) for v in re.findall(r'\d+', l[x + len('%d:00' % h):end])]
            hh = h + 24 if h < 3 else h
            dep[DAYS[col(x)]] += [hh * 60 + v for v in mins]
        for m_ in re.finditer(r"ogni\s+(\d+)'(?:\s*-\s*(\d+)')?", l):           # ("ogni 5'" on some pages: one number)
            freq[DAYS[col(m_.start() + 10)]] = [int(m_.group(1)), int(m_.group(2) or m_.group(1))]
    # (the band: "dalle from 7" and "alle to 19" on one line or on two)
    a_ = re.search(r'dalle from\s+(\d+)', pg) or re.search(r'(\d+)\s+alle to', pg); b_ = re.search(r'alle to\s+(\d+)', pg)
    band = [int(a_.group(1)), int(b_.group(1))] if a_ and b_ else None
    return {'stazione': NAMES.get(st, st), 'pdf_nome': st, 'verso': NAMES.get(to, to), 'dal': valid.group(1) if valid else None, 'al': valid.group(2) if valid and valid.group(2) else None,
            'partenze': {d: sorted(v) for d, v in dep.items()}, 'ogni': {d: {'dalle': band[0], 'alle': band[1], 'min': f[0], 'max': f[1]} for d, f in freq.items()} if band else {}}


def hhmm(m): return '%d:%02d' % (m // 60, m % 60)


def estrai(pdf, nome, fonte):
    out = [p for p in (parse_page(pg) for pg in pages(pdf)) if p]
    doc = {'_about': 'Orario storico M3 copiato dal PDF ATM (tools/orari_storici.py estrai). partenze: minuti dalla mezzanotte del giorno di '
                     'servizio (dopo mezzanotte: 24:xx, 25:xx...; la giornata cambia alle 3:00), per tipo di giorno; ogni: la fascia in cui il '
                     'PDF dà solo la frequenza (dalle/alle: ore; min/max: minuti tra due treni). Festivo = domenica e festivi.',
           'fonte': fonte, 'nome': nome, 'dal': out[0]['dal'] if out else None, 'al': out[0]['al'] if out else None, 'pagine': len(out),
           'stazioni': [{**p, 'partenze': {d: [hhmm(x) for x in v] for d, v in p['partenze'].items()}} for p in out]}
    path = os.path.join(ROOT, 'data', 'storico', 'm3_%s.json' % nome)
    json.dump(doc, open(path, 'w'), ensure_ascii=False, indent=1)
    for p in out:
        print('%-16s -> %-11s ' % (p['stazione'], p['verso']) + '  '.join('%s %3d%s' % (d[:3], len(p['partenze'][d]), (' ogni %d-%d' % (p['ogni'][d]['min'], p['ogni'][d]['max'])) if d in p['ogni'] else '') for d in DAYS))
    print('scritto', os.path.relpath(path, ROOT), len(out), 'pagine')


if __name__ == '__main__':
    if len(sys.argv) >= 4 and sys.argv[1] == 'estrai': estrai(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else os.path.basename(sys.argv[2]))
    else: print(__doc__)
