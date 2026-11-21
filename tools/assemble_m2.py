"""The M2 data files of the site (tappa 1: timetable, turni, runs on the real tracks), kept apart from the M3's.
Called by tools/assemble.py: write(dati) writes dati/m2_<day>.js for the days built by build.sh in build_m2/<day>
(1 weekday, 6 Saturday, 7 Sunday) and returns {"M2": ["", "6", "7"]} for the page's list of packs.
A pack has the timetable (data) and the fleet (m2.json: every run on the real tracks, as the M1, and the tracks the
track editor works on); no precomputed day yet. The turni (m2_turni.json) travel with it for the next steps."""
import base64, gzip, json, os

ROOT = os.environ.get('ROOT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BUILD = os.environ.get('BUILD_M2', os.path.join(ROOT, 'build_m2'))


def write(dati):
    packs = {}
    for sfx, folder in (('', '1'), ('6', '6'), ('7', '7')):
        bd = os.path.join(BUILD, folder)
        if not all(os.path.exists(os.path.join(bd, f)) for f in ('data.json.gz', 'm2_turni.json')): continue
        data = base64.b64encode(open(os.path.join(bd, 'data.json.gz'), 'rb').read()).decode()
        turni = base64.b64encode(gzip.compress(open(os.path.join(bd, 'm2_turni.json'), 'rb').read(), 9)).decode()
        # the runs on the real tracks and the tracks for the editor (tools/build_trips.py), when built
        fp = os.path.join(bd, 'm2.json'); fleet = ''
        if os.path.exists(fp):
            F = json.load(open(fp))
            # the signals and marks Giovanni placed in the editor (data/rules_m2.json): shown on the map and in the editor
            rp = os.path.join(ROOT, 'data', 'rules_m2.json')
            if os.path.exists(rp): F['edits'] = {k: v for k, v in json.load(open(rp)).items() if not k.startswith('_')}
            # the aspects and codes for the page's panel (data/codici_m2.json, from the Codici sheet of Regole_M2.xlsx)
            cp = os.path.join(ROOT, 'data', 'codici_m2.json')
            if os.path.exists(cp): F['codici'] = json.load(open(cp))
            # the depot cards (data/depositi_m2.json): the uses, notes, washing and Giovanni's rules of the depots, without the sheds' outlines
            dp = os.path.join(ROOT, 'data', 'depositi_m2.json')
            if os.path.exists(dp): F['depinfo'] = {k: v for k, v in json.load(open(dp)).items() if k in ('posto_m', 'fermata', 'lavaggio', 'regole_giovanni', 'depositi', 'punto')}
            # the station cards (data/stazioni_m2.json): where the stations are, from the GTFS stops of the line
            sp = os.path.join(ROOT, 'data', 'stazioni_m2.json')
            if os.path.exists(sp):
                import csv
                pos = {}
                for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'gtfs_m2', 'stops.txt'), encoding='utf-8-sig')):
                    pos.setdefault(r['stop_name'], []).append((float(r['stop_lat']), float(r['stop_lon'])))
                F['stcards'] = [dict(st, la=round(sum(p[0] for p in pos[st['gtfs']]) / len(pos[st['gtfs']]), 6), lo=round(sum(p[1] for p in pos[st['gtfs']]) / len(pos[st['gtfs']]), 6))
                                for st in json.load(open(sp))['stazioni'] if st['gtfs'] in pos]
            fleet = base64.b64encode(gzip.compress(json.dumps({'fleets': [F]}, separators=(',', ':')).encode(), 9)).decode()
        name = 'm2_%s.js' % folder
        js = '(window.MTL_PACK = window.MTL_PACK || {})[%s] = %s;\n' % (json.dumps('M2' + sfx), json.dumps({'data': data, 'fleet': fleet, 'live': '', 'turni': turni}))
        open(os.path.join(dati, name), 'w').write(js)
        packs.setdefault('M2', []).append(sfx)
        print('  dati/%s  %.1f MB' % (name, len(js) / 1e6))
    return packs


# the M2's line card (data/schede/m2.json, Giovanni 20 Nov 2026: "creami la pagina informazioni come su M3"): the texts as
# they are, plus what the build knows: the stations of the timetable, the Meneghino and Leonardo of the game's fleet
# (data/flotta_m2.json, one row a train of two units), the depots' tracks (data/depositi_m2.json), the fronts (drawn in
# the menu by the game's own code, the player changes number, destination and lights; the destinations: the PIS texts of
# data/velette_m2.json). The rows of the Tradizionali: the card's own list ("storico")
def scheda():
    sp = os.path.join(ROOT, 'data', 'schede', 'm2.json')
    if not os.path.exists(sp): return None
    sc = json.load(open(sp)); sec = {s['id']: s for s in sc['sezioni']}
    dp = os.path.join(BUILD, '1', 'data.json')
    nst = len(json.load(open(dp))['stops']) if os.path.exists(dp) else len(sec['stazioni']['tabella']['righe'])
    fl = json.load(open(os.path.join(ROOT, 'data', 'flotta_m2.json')))['treni']
    V = json.load(open(os.path.join(ROOT, 'data', 'velette_m2.json'))); ecc = V['regole'].get('eccezioni_pis', {})
    MUSO = {'Meneghino': {'tipo': 'meneghinoM2', 'dest': 'GESSATE', 'no': '', 'luci': 'white', 'livrea': 'green', 'reale': True,
                          'livree': [['green', 'profili verdi'], ['yellow', 'profili gialli (949-950)']]},
            'Leonardo': {'tipo': 'leonardo', 'dest': 'ABBIATEGRASSO', 'no': '', 'luci': 'white', 'livrea': 'black',
                         'livree': [['black', 'nera, profili verdi'], ['green', 'verde, profili bianchi'], ['fineco', 'Fineco (5067-5068)']]}}
    LIV = {'black': 'nera, profili verdi', 'green': 'verde, profili bianchi', 'fineco': 'Fineco'}
    rows = {'Meneghino': [], 'Leonardo': []}
    for g in fl:
        for a in range(g['da'], g['a'] + 1, 2):
            note = [LIV.get(g.get('livrea'), '') if g['tipo'] == 'Leonardo' else ('profili gialli' if g.get('profili') == 'yellow' else '')]
            if g.get('lotto'): note.insert(0, g['lotto'] + ' lotto')
            if g.get('velette') == 'monitor': note.append('velette dall\'elenco del monitor')
            if g.get('nota') and g['tipo'] == 'Meneghino' and 'dalla M1' in g['nota']: note.append(g['nota'])
            rows[g['tipo']].append({'matricole': '%d-%d' % (a, a + 1), 'costruttore': 'AnsaldoBreda e Firema' if g['tipo'] == 'Meneghino' else ('AnsaldoBreda' if g.get('anno', 0) <= 2015 else 'Hitachi Rail Italy'),
                                    'anno': str(g.get('anno', '')), 'note': '; '.join(x for x in note if x)})
    tr = sec['treni']; num = lambda r: int(''.join(ch for ch in r['matricole'].split('-')[0] if ch.isdigit()) or 0)
    for g in tr['gruppi']:
        if g.get('flotta'):
            g['righe'] = sorted(rows[g['flotta']], key=num); g['nel_gioco'] = len(g['righe'])
            g['dati'] = g['dati'] + [['Nel gioco', '%d treni' % len(g['righe'])]]
        else:
            g['righe'] = sorted([dict(r, storico=True) for r in tr.get('storico', []) if r['gruppo'] == g.get('storico_gruppo')], key=num)
        if g.get('flotta') in MUSO: g['muso'] = MUSO[g['flotta']]
    tr.pop('storico', None)
    tr['destinazioni'] = list(dict.fromkeys([ecc.get(st['pis'], st['pis']) for st in V['stazioni'] if st.get('pis')] + V['speciali']))
    # the depots: the tracks of the game (Giovanni and his colleague)
    D = json.load(open(os.path.join(ROOT, 'data', 'depositi_m2.json')))['depositi']
    for d in sec['depositi']['lista']:
        k = d['nome'].replace('Deposito ', ''); b = D.get(k) or []
        if b: d['numeri'] = [[str(len(b)), 'binari nel gioco'], [str(sum(t.get('treni', 1) for t in b)), 'posti per un treno']]
    nt = sum(len(v) for v in rows.values())
    sec['breve']['numeri'] = [[str(nst), 'stazioni'], sec['breve']['lunghezza'], [sec['breve']['apertura']['anno'], sec['breve']['apertura']['testo']],
                              [str(sec['breve'].get('depositi', 3)), 'depositi'], [str(nt), 'treni nella flotta del gioco']]
    return sc
