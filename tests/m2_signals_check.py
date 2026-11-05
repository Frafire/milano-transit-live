"""The M2 signals placed in the editor (data/rules_m2.json). Every signal must have:
- a type the M2 editor offers, the line M2 and a track of data/osm_m2.txt;
- the way it faces (dir 1 or -1, heading) and, for a semaforo, galleria / superficie and legale / illegale
  with the vela that goes with it (legale tonda, illegale quadra); a semaforo also the lettera P, and in superficie
  1 or 2 vele; the indicatore di direzione (dirind, at a junction: right, left or straight) true or absent;
- a name, when it has one, in the M2 form: S + number + a / b (galleria, and some surface signals: S49a at Assago) or
  POSTO + number + a / b (superficie), a for a
  legale signal and b for an illegale one; a low shunting signal (manovra, only round) S + number (S 5);
- an indicatore di velocità (speedind: a pixel screen on its own) the speed it shows, km/h, or null while not known.
Also: no M2 signal or mark in data/rules_m3.json (the M3's file). Warnings (not failures): a semaforo without a name,
a legale signal on the left of its track or an illegale one on the right, a legale one facing against the track.
Usage: python3 tests/m2_signals_check.py [repo root]. Exit code 1 if one fails."""
import json, os, re, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import osmparse
R = json.load(open(os.path.join(ROOT, 'data', 'rules_m2.json')))
R3 = json.load(open(os.path.join(ROOT, 'data', 'rules_m3.json')))
W = osmparse.load(os.path.join(ROOT, 'data', 'osm_m2.txt'))
TYPES = {'main', 'shunt', 'speedind', 'stop', 'nose', 'nose2', 'cut'}
bad, warn = [], []
for k, sg in enumerate(R.get('signals', [])):
    who = '%s #%d (%s, %.6f %.6f)' % (sg.get('name') or 'senza nome', k, sg.get('type'), sg.get('lat', 0), sg.get('lon', 0))
    if sg.get('line') != 'M2': bad.append(who + ': line is not M2')
    if sg.get('type') not in TYPES: bad.append(who + ': type missing or unknown')
    if not (isinstance(sg.get('w'), int) and 0 <= sg['w'] < len(W)): bad.append(who + ': not on an M2 track')
    if sg.get('dir') not in (1, -1) or not isinstance(sg.get('heading'), (int, float)): bad.append(who + ': the way it faces is missing')
    if sg.get('type') == 'main':
        if sg.get('env') not in ('galleria', 'superficie'): bad.append(who + ': galleria / superficie missing')
        if not isinstance(sg.get('legal'), bool) or sg.get('vela') != ('tonda' if sg.get('legal') else 'quadra'): bad.append(who + ': legale / illegale or vela missing or not matching')
    if sg.get('type') == 'main':
        if sg.get('p') not in ('luminosa', 'fissa', 'nessuna'): bad.append(who + ': lettera P missing')
        if sg.get('env') == 'superficie' and sg.get('vele') not in (1, 2): bad.append(who + ': vele missing')
        if not sg.get('name'): warn.append(who + ': no name yet')
        if 'dirind' in sg and sg['dirind'] is not True: bad.append(who + ': indicatore di direzione should be true or absent')
    if sg.get('type') == 'speedind':
        if sg.get('kmh') is not None and not (isinstance(sg['kmh'], int) and 0 < sg['kmh'] <= 120): bad.append(who + ': speed shown not a number of km/h')
        if sg.get('kmh') is None: warn.append(who + ': speed shown not given yet')
    nm = sg.get('name') or ''
    if nm:
        form = r'^S \d+$' if sg.get('type') == 'shunt' else r'^(S\d+|POSTO \d+)[ab]$'     # at Assago the surface signals are S49a, S57 too
        if not re.match(form, nm): bad.append(who + ': name not in the M2 form (S123a or POSTO 12a, b for illegale; manovra S 5)')
        elif sg.get('type') == 'main' and sg.get('legal') is not None and nm[-1] != ('a' if sg['legal'] else 'b'): bad.append(who + ': name ends with %s but the signal is %s' % (nm[-1], 'legale' if sg['legal'] else 'illegale'))
    if sg.get('type') == 'main' and sg.get('offset_m', 0) > 1 and sg.get('side') in ('left', 'right') and isinstance(sg.get('legal'), bool):
        right = (sg['side'] == 'right') == (sg.get('dir') == 1)
        if right != sg['legal']: warn.append(who + ': %s but on the %s of the track' % ('legale' if sg['legal'] else 'illegale', 'right' if right else 'left'))
m3 = [x for x in R3.get('signals', []) + R3.get('marks', []) if x.get('line') == 'M2']
if m3: bad.append('%d M2 entries in data/rules_m3.json: they belong in data/rules_m2.json' % len(m3))
for b in bad: print('FAIL ' + b)
for w in warn[:20]: print('note ' + w)
n = len(R.get('signals', []))
print(('ok   ' if not bad else 'FAIL ') + 'M2 signals: %d placed, each with type, side (vela) and the way it faces%s' % (n, '' if not warn else '; %d notes' % len(warn)))
sys.exit(1 if bad else 0)
