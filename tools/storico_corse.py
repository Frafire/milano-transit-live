"""Gli orari storici della M3: dalle partenze per stazione (data/storico/m3_<nome>.json, tools/orari_storici.py) alle corse,
treno per treno, e a un GTFS come quello di oggi, che la build usa senza cambiare nulla (Giovanni 10 Nov 2026).

    python3 tools/storico_corse.py <nome>        # expo2015 | milanocortina2026

Scrive data/storico/m3_<nome>_corse.json (le corse, con da dove viene ogni orario) e data/storico/gtfs_m3_<nome>/ (agency,
routes, stops e shapes di data/gtfs_m3; trips, stop_times e calendar_dates nuovi: un giorno feriale, un sabato e una
domenica di quel periodo).

Come (le parti che non sono nel PDF sono PROPOSTE, scritte come tali nelle corse e nel file):
1. Il tempo da un capolinea a ogni stazione: dal PDF dove ci sono le stazioni (Milano Cortina: la mediana tra le corse
   viste in due stazioni), altrimenti da quello di oggi (GTFS dell'orario attuale, mediana per tipo di giorno) - PROPOSTA
   per l'Expo, che ha solo i capolinea.
2. Ogni orario del PDF, riportato al capolinea di partenza con quei tempi, dà una corsa; gli orari di stazioni diverse che
   cadono entro 90 s sono la stessa corsa.
3. Nella fascia in cui il PDF dice solo "ogni X'-Y'" (dalle 7 alle 19, cioè fino alle 19:59: la riga dopo è 20:00), le
   corse mancanti si mettono tra l'ultima vista prima e la prima vista dopo - PROPOSTA: il distacco segue la forma di
   quello di oggi nella stessa fascia (più stretto nelle punte), riportata dentro il minimo e il massimo del PDF, e tutto
   l'intervallo si chiude esattamente sulle corse vere ai due lati.
4. Le corse dopo mezzanotte restano nel giorno di servizio: 24:xx, 25:xx, 26:xx (la giornata del gioco cambia alle 3:00).
"""
import csv, json, math, os, statistics, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G0 = os.path.join(ROOT, 'data', 'gtfs_m3')
DAYS = ['feriale', 'sabato', 'festivo']
TODAY = {'feriale': '20260923', 'sabato': '20260919', 'festivo': '20260920'}        # (the days build.sh builds)
DATES = {'expo2015': {'feriale': '20150504', 'sabato': '20150502', 'festivo': '20150503'},
         'milanocortina2026': {'feriale': '20260209', 'sabato': '20260207', 'festivo': '20260208'}}
ORDER = None                                                                         # stations Comasina -> San Donato


def sec(t):
    h, m, *s = [int(x) for x in t.split(':')]; return h * 3600 + m * 60 + (s[0] if s else 0)


def hms(s): return '%02d:%02d:%02d' % (s // 3600, s // 60 % 60, s % 60)


def read(name): return list(csv.DictReader(open(os.path.join(G0, name), encoding='utf-8')))


def today():
    """today's runs (GTFS of now) by kind of day and way: [(origin seconds, {station: seconds})]"""
    global ORDER
    cal = collections.defaultdict(set)
    for r in read('calendar_dates.txt'): cal[r['date']].add(r['service_id'])
    trips = {r['trip_id']: r for r in read('trips.txt')}
    st = collections.defaultdict(list)
    for r in read('stop_times.txt'): st[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], sec(r['departure_time'])))
    out = {d: {'SAN DONATO': [], 'COMASINA': []} for d in DAYS}
    for d, date in TODAY.items():
        for tid, t in trips.items():
            if t['service_id'] not in cal[date]: continue
            s = sorted(st[tid]); to = s[-1][1]
            out[d][to].append((s[0][2], {x[1]: x[2] for x in s}))
            if ORDER is None and to == 'SAN DONATO' and len(s) == 21: ORDER = [x[1] for x in s]
        for to in out[d]: out[d][to].sort(key=lambda x: x[0])
    return out


def offsets(runs, stations):
    """median seconds from the origin to each station"""
    return {s: statistics.median(x[1][s] - x[0] for x in runs if s in x[1]) for s in stations}


def headway_shape(runs, t0, t1):
    """today's headway at the origin, as a function of the time, between t0 and t1 (a 30-minute moving median)"""
    deps = [x[0] for x in runs]
    def h(t):
        w = [b - a for a, b in zip(deps, deps[1:]) if t - 900 <= a <= t + 900]
        return statistics.median(w) if w else None
    return h


_T = json.load(open(os.path.join(ROOT, 'data', 'regole_m3.json'))).get('tempi', {})
# the historical timetables are the special ones (Expo, Milano Cortina): 180 s, the normal 200 s otherwise (foglio Tempi)
MIN_HEADWAY = next((v[0] for k, v in _T.items() if k.startswith('Intervallo minimo tra due treni ai capolinea negli orari speciali')), 0) or \
    next((v[0] for k, v in _T.items() if k.startswith('Intervallo minimo tra due treni ai capolinea')), 0) or 0
# (STORICO_MIN_HEADWAY, STORICO_OUT: to try another minimum without touching data/storico, e.g. how far the simulation can
# follow a tighter timetable)
MIN_HEADWAY = float(os.environ.get('STORICO_MIN_HEADWAY', MIN_HEADWAY))
OUT = os.environ.get('STORICO_OUT') or os.path.join(ROOT, 'data', 'storico')


def build(nome):
    src = json.load(open(os.path.join(ROOT, 'data', 'storico', 'm3_%s.json' % nome)))
    T = today()
    out_runs, report = [], []
    for day in DAYS:
        for to in ('SAN DONATO', 'COMASINA'):
            orig = 'COMASINA' if to == 'SAN DONATO' else 'SAN DONATO'
            order = ORDER if to == 'SAN DONATO' else ORDER[::-1]
            pages = {p['stazione']: p for p in src['stazioni'] if p['verso'] == to}
            base = offsets(T[day][to], order)                                       # (today's)
            # the pages do not always say the same (Milano Cortina, Saturday: "ogni 5'" on some, "5'-6'" on others): the lower
            # one, always (Giovanni 10 Nov 2026: "metti sempre inferiore ovvero 5")
            bands = [p['ogni'][day] for p in pages.values() if day in p['ogni']]
            band = dict(bands[0], min=min(b['min'] for b in bands), max=min(b['max'] for b in bands)) if bands else None
            seen = {s: sorted(sec(x + ':00') for x in pages[s]['partenze'][day]) for s in order if s in pages}
            # 1. the times from the origin: from the PDF where two stations see the same run, else today's
            off, off_src = {}, {}
            for s in order:
                if s == orig: off[s] = 0; off_src[s] = 'pdf'; continue
                if s in seen and orig in seen:
                    dif = []
                    for t in seen[s]:
                        o = min(seen[orig], key=lambda x: abs(t - base[s] - x)) if seen[orig] else None
                        if o is not None and abs(t - base[s] - o) <= 150: dif.append(t - o)
                    if len(dif) >= 8: off[s] = statistics.median(dif); off_src[s] = 'pdf'; continue
                off[s] = base[s]; off_src[s] = 'oggi (PROPOSTA)'
            # 2. the runs, station after station: a time at a station is the run whose time at the station before, plus the
            # time between the two, is the nearest (within 2 minutes and a bit; the first runs of the day, by hand, are
            # slower: matched station by station they stay one run); a time with no run behind it starts one (a run seen
            # first after the "ogni" stretch)
            runs = []
            for i, s in enumerate(order):
                ts = seen.get(s, [])
                pred = []
                for r in runs:
                    ls, lt = r['last']; pred.append((lt + off[s] - off[ls], r))
                used = set()
                for t in ts:
                    best = None
                    for pt, r in pred:
                        if id(r) in used: continue
                        ls = r['last'][0]; tol = 120 + 0.12 * (off[s] - off[ls])
                        if abs(t - pt) <= tol and (best is None or abs(t - pt) < abs(t - best[0])): best = (pt, r)
                    if best: r = best[1]; used.add(id(r)); r['seen'][s] = t; r['last'] = (s, t)
                    else: r = {'seen': {s: t}, 'last': (s, t)}; runs.append(r); used.add(id(r))
            for r in runs:
                f = next(s for s in order if s in r['seen']); r['o'] = r['seen'][f] - off[f]
            runs.sort(key=lambda r: r['o'])
            # 3. the gaps in the "ogni" stretch: filled (PROPOSTA)
            added = 0
            if band:
                hmin, hmax = band['min'] * 60, band['max'] * 60
                # never closer than a cab change at Comasina allows (foglio Tempi, Giovanni 10 Nov 2026: at least 200 s,
                # the ACEI, 180 s in these special timetables; "la frequenza teorica di 2 minuti è impossibile"): the PDF's
                # lower end is raised to it
                hmin = max(hmin, MIN_HEADWAY); hmax = max(hmax, hmin)
                h_today = headway_shape(T[day][to], 0, 0); tv = [h_today(t) for t in range(band['dalle'] * 3600, (band['alle'] + 1) * 3600, 300)]
                tv = [x for x in tv if x]; lo, hi = (min(tv), max(tv)) if tv else (hmin, hmax)
                def h_hist(t):
                    x = h_today(t)
                    if x is None or hi <= lo: return (hmin + hmax) / 2
                    return hmin + (min(hi, max(lo, x)) - lo) / (hi - lo) * (hmax - hmin)
                new = []
                for a, b in zip(runs, runs[1:]):
                    gap = b['o'] - a['o']
                    # (only where the gap is the "ogni" stretch: some part of it, at some station, inside 7:00-19:59)
                    if gap <= hmax * 1.25: continue
                    if not any(band['dalle'] * 3600 <= a['o'] + off[s] + x < (band['alle'] + 1) * 3600 for s in order for x in (0, gap / 2, gap)): continue
                    ts, t = [], a['o']
                    while True:
                        t += h_hist(t)
                        if t >= b['o'] - hmin * 0.5: break
                        ts.append(t)
                    # the whole gap closed exactly on the two real runs: the same steps, stretched
                    if ts:
                        k = (b['o'] - a['o']) / (ts[-1] - a['o'] + h_hist(ts[-1])); ts = [a['o'] + (x - a['o']) * k for x in ts]
                    new += [{'o': x, 'os': [x], 'seen': {}, 'proposta': True} for x in ts]
                added = len(new); runs = sorted(runs + new, key=lambda r: r['o'])
            # 4. every run at every station
            for r in runs:
                o = round(r['o']); times = {}
                # (a station not seen: from the nearest one seen before it, else from the first seen after it)
                for j, s in enumerate(order):
                    if s in r['seen']: times[s] = r['seen'][s]; continue
                    back = [x for x in order[:j] if x in r['seen']]; fwd = [x for x in order[j + 1:] if x in r['seen']]
                    times[s] = (r['seen'][back[-1]] + round(off[s] - off[back[-1]])) if back else (r['seen'][fwd[0]] - round(off[fwd[0]] - off[s])) if fwd else o + round(off[s])
                # (in order: a seen time never before the one at the station behind)
                prev = None
                for s in order:
                    if prev is not None and times[s] <= times[prev]: times[s] = times[prev] + 30
                    prev = s
                out_runs.append({'giorno': day, 'verso': to, 'parte': hms(times[orig]), 'orari': [hms(times[s]) for s in order], 'visti': len(r['seen']),
                                 **({'proposta': True} if r.get('proposta') or not r['seen'] else {})})
            # verification: every time of the PDF is a time of a run at that station
            day_runs = [x for x in out_runs if x['giorno'] == day and x['verso'] == to]
            at = {s: collections.Counter(x['orari'][i][:5] for x in day_runs) for i, s in enumerate(order)}
            miss = sum(1 for s in seen for t in seen[s] if at[s][hms(t)[:5]] == 0)
            more = sum(1 for s in seen for t in seen[s])
            report.append({'giorno': day, 'verso': to, 'corse': len(day_runs), 'corse_proposte': added, 'orari_pdf': more, 'orari_pdf_non_trovati': miss,
                           'fascia': band, 'tempi': {s: [round(off[s]), off_src[s]] for s in order},
                           'prima': day_runs[0]['parte'] if day_runs else None, 'ultima': day_runs[-1]['parte'] if day_runs else None})
    doc = {'_about': 'Corse dell\'orario storico M3 %s ricostruite da tools/storico_corse.py: orari = le stazioni da Comasina a San Donato '
                     '(o al contrario, secondo il verso); visti = in quante stazioni l\'orario è del PDF; proposta = corsa messa nella fascia '
                     '"ogni X\'-Y\'" o con orari calcolati (PROPOSTA di Claude, da confermare).' % nome,
           'fonte': src['fonte'], 'dal': src['dal'], 'al': src['al'], 'giorni': DATES[nome], 'rapporto': report, 'corse': out_runs}
    json.dump(doc, open(os.path.join(OUT, 'm3_%s_corse.json' % nome), 'w'), ensure_ascii=False, indent=0)
    # the GTFS
    G = os.path.join(OUT, 'gtfs_m3_%s' % nome); os.makedirs(G, exist_ok=True)
    for f in ('agency.txt', 'routes.txt', 'stops.txt', 'shapes.txt'):
        open(os.path.join(G, f), 'w', encoding='utf-8').write(open(os.path.join(G0, f), encoding='utf-8').read())
    sid = {d: '%s_storico_%s' % ({'feriale': 'l', 'sabato': 's', 'festivo': 'f'}[d], nome) for d in DAYS}
    with open(os.path.join(G, 'calendar.txt'), 'w') as f: f.write('"service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"\n')
    with open(os.path.join(G, 'calendar_dates.txt'), 'w') as f:
        f.write('"service_id","date","exception_type"\n')
        for d in DAYS: f.write('"%s","%s","1"\n' % (sid[d], DATES[nome][d]))
    with open(os.path.join(G, 'trips.txt'), 'w') as ft, open(os.path.join(G, 'stop_times.txt'), 'w') as fs:
        ft.write('"route_id","service_id","trip_id","trip_headsign","trip_short_name","direction_id","block_id","shape_id","wheelchair_accessible","x_trip_desc","x_shape_id_order"\n')
        fs.write('"trip_id","arrival_time","departure_time","stop_id","stop_sequence","stop_headsign","pickup_type","drop_off_type","shape_dist_traveled"\n')
        for i, r in enumerate(out_runs):
            orig = 'COMASINA' if r['verso'] == 'SAN DONATO' else 'SAN DONATO'; shape = '%s___%s' % (orig, r['verso'])
            tid = '%s_%s_%s_%d' % (shape, sid[r['giorno']][0], nome, i)
            ft.write('"M3","%s","%s","%s","","","","%s","","%s",""\n' % (sid[r['giorno']], tid, r['verso'].lower(), shape, shape.lower()))
            order = ORDER if r['verso'] == 'SAN DONATO' else ORDER[::-1]
            for j, (s, t) in enumerate(zip(order, r['orari'])):
                fs.write('"%s","%s","%s","%s","%d","%s","","",""\n' % (tid, t, t, s, j + 1, r['verso'].lower()))
    open(os.path.join(G, 'README.md'), 'w').write('GTFS fatto da tools/storico_corse.py dall\'orario storico M3 %s (%s). Corse con "proposta" nel file '
                                                  'm3_%s_corse.json: non sono nel PDF.\n' % (nome, src['fonte'], nome))
    for r in report:
        print('%-8s -> %-10s corse %3d (proposte %3d) | orari del PDF %4d, non ritrovati %d | %s-%s | fascia %s'
              % (r['giorno'], r['verso'], r['corse'], r['corse_proposte'], r['orari_pdf'], r['orari_pdf_non_trovati'], r['prima'], r['ultima'],
                 ('%d-%d ogni %d-%d' % (r['fascia']['dalle'], r['fascia']['alle'], r['fascia']['min'], r['fascia']['max'])) if r['fascia'] else '-'))
    print('tempi dal PDF:', sum(1 for r in report for v in r['tempi'].values() if v[1] == 'pdf'), 'di', sum(len(r['tempi']) for r in report))


if __name__ == '__main__':
    if len(sys.argv) > 1: build(sys.argv[1])
    else: print(__doc__)
