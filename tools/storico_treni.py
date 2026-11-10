"""Quanti treni usa un orario M3 (Giovanni 10 Nov 2026): per fascia e tipo di giorno, il massimo di corse in viaggio nello
stesso momento (tra la partenza al capolinea e l'arrivo all'altro) e i treni che servono contando anche la sosta ai
capolinea (inversione: REV minuti, PROPOSTA). Confronto con l'orario di oggi (data/gtfs_m3) e con la flotta del gioco.

    python3 tools/storico_treni.py            # tutti: oggi, expo2015, milanocortina2026
"""
import json, os, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import storico_corse as SC

ROOT = SC.ROOT
FASCE = [('punta del mattino', 7 * 60, 9 * 60 + 30), ('giorno', 9 * 60 + 30, 16 * 60 + 30), ('punta del pomeriggio', 16 * 60 + 30, 19 * 60 + 30),
         ('sera', 19 * 60 + 30, 24 * 60), ('notte (dopo mezzanotte)', 24 * 60, 27 * 60)]
REV = 4      # minuti di sosta al capolinea per invertire: proposta di Claude; per il 2026 giusta (Giovanni 10/11/2026, dal macchinista M2); per il 2015 non si sa


def intervals_today():
    T = SC.today(); out = {}
    for d in SC.DAYS:
        out[d] = [(o // 60, max(v.values()) // 60) for to in T[d] for o, v in T[d][to]]
    return out


def intervals_hist(nome):
    doc = json.load(open(os.path.join(ROOT, 'data', 'storico', 'm3_%s_corse.json' % nome))); out = collections.defaultdict(list)
    for r in doc['corse']:
        ts = [SC.sec(x) // 60 for x in r['orari']]; out[r['giorno']].append((ts[0], ts[-1]))
    return out


def counts(iv):
    res = {}
    for name, a, b in FASCE:
        run = max((sum(1 for s, e in iv if s <= t < e) for t in range(a, b)), default=0)
        need = max((sum(1 for s, e in iv if s <= t < e + REV) for t in range(a, b)), default=0)
        res[name] = (run, need)
    return res


def main():
    fleet = None
    try:
        import fleet_m3; fleet = len([u for u in fleet_m3.STOCK]) if hasattr(fleet_m3, 'STOCK') else None
    except Exception: pass
    rows = {'oggi (GTFS)': intervals_today()}
    for n in ('expo2015', 'milanocortina2026'):
        if os.path.exists(os.path.join(ROOT, 'data', 'storico', 'm3_%s_corse.json' % n)): rows[n] = intervals_hist(n)
    out = {}
    for name, iv in rows.items():
        out[name] = {d: counts(iv[d]) for d in SC.DAYS}
        for d in SC.DAYS:
            print('%-20s %-8s ' % (name, d) + ' | '.join('%s %d (%d)' % (f.split()[0] if f != 'punta del pomeriggio' else 'pomer.', *out[name][d][f]) for f, _, _ in FASCE))
    json.dump({'_about': 'Treni in viaggio (massimo) e treni che servono con %d min di sosta ai capolinea (giusta per il 2026, Giovanni; per il 2015 PROPOSTA), per fascia: tools/storico_treni.py' % REV,
               'fasce': [[f, a, b] for f, a, b in FASCE], 'treni': {k: {d: {f: list(v) for f, v in dd.items()} for d, dd in x.items()} for k, x in out.items()}},
              open(os.path.join(ROOT, 'data', 'storico', 'treni_per_fascia.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__': main()
