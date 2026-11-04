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
            fleet = base64.b64encode(gzip.compress(json.dumps({'fleets': [F]}, separators=(',', ':')).encode(), 9)).decode()
        name = 'm2_%s.js' % folder
        js = '(window.MTL_PACK = window.MTL_PACK || {})[%s] = %s;\n' % (json.dumps('M2' + sfx), json.dumps({'data': data, 'fleet': fleet, 'live': '', 'turni': turni}))
        open(os.path.join(dati, name), 'w').write(js)
        packs.setdefault('M2', []).append(sfx)
        print('  dati/%s  %.1f MB' % (name, len(js) / 1e6))
    return packs
