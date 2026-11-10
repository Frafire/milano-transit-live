"""Real M3 rolling stock (Giovanni, Oct 2026). A traditional unit is 3 cars (M+R+M); a train couples two.
Meneghino trains are already 6 cars. Units 'Accantonato' are left out.

Numbering as Giovanni wants it: 1-6 Meneghino, 7 8101+8103, 8 8109+8107, 9 8065+8067, then the 1st lot,
then the three Meneghino added in Oct 2026 (941-942, 943-944, 947-948).
SOLO: units standing alone (not coupled, not given any service); they can still go round the test loop.

FLOTTA (environment, the historical timetables, Giovanni 10 Nov 2026): '2026' (Milano Cortina) = today's fleet without the
Hitachi Galileo; '2015' (Expo) = without the Galileo and without the Meneghino that came from the M2 in 2021 (those from the M1
in 2010 were already on the M3: Giovanni put them back, 10 Nov 2026), with the six SOCIMI units of the 1st lot (8069-8080, inverter Hitachi): they work like the others
but couple only with each other (three trains of two SOCIMI units) and have traction problems more than once a day
(foglio Guasti, row 27)."""
import os
FLOTTA = os.environ.get('FLOTTA', '')
U1 = [f'{a}-{a+1}' for a in range(8001, 8041, 2)] + [f'{a}-{a+1}' for a in range(8045, 8069, 2)]   # 1st lot, 32 units
MENEGHINO = [('987-988', 2010, 'trasferito dalla M2 nel 2021'), ('989-990', 2010, 'trasferito dalla M2 nel 2021'),
             ('951-952', 2009, 'trasferito dalla M1 nel 2010'), ('953-954', 2009, 'trasferito dalla M1 nel 2010'),
             ('955-956', 2009, 'trasferito dalla M1 nel 2010'), ('957-958', 2009, 'trasferito dalla M1 nel 2010')]
MENEGHINO_NEW = [('941-942', 2009, ''), ('943-944', 2009, ''), ('947-948', 2009, '')]
# who built them (Giovanni, Nov 2026): the 1st lot by unit number, all with ABB inverters; the 2nd lot AnsaldoBreda; the Meneghino AnsaldoBreda and Firema
BUILDER1 = lambda u: 'Stanga' if int(u[:4]) <= 8028 else 'Fiat' if int(u[:4]) <= 8054 else 'SOCIMI' if int(u[:4]) >= 8069 else 'Breda'
# the SOCIMI units (1st lot, inverter Hitachi; set aside in 2019, now scrapped: data/schede/m3.json): only in the 2015 fleet
SOCIMI = [f'{a}-{a+1}' for a in range(8069, 8081, 2)]
def built(units, year):
    us = [u.strip() for u in units.split('+')]
    if int(us[0].split('-')[0]) >= 9000: return f'costruito nel {year} da Hitachi Rail STS'
    if int(us[0].split('-')[0]) < 8000: return f'costruito nel {year} da AnsaldoBreda e Firema'
    if int(us[0][:4]) >= 8100: return f'costruito da AnsaldoBreda con inverter ABB nel {year}'
    b = [BUILDER1(u) for u in us]
    who = b[0] if len(set(b)) == 1 else ' e '.join(f'{x} ({u})' for x, u in zip(b, us))
    return f'costruito da {who} con inverter {"Hitachi" if who == "SOCIMI" else "ABB"} nel {year}'
YEAR1 = lambda u: 1989 if int(u[:4]) <= 8040 else 1990
# 8105-8106: stopped, alone, on the depot track after shunting signal #A76 (OSM way 32, dead end node 73)
SOLO = [{'units': '8105-8106', 'type': 'Tradizionale 2° lotto', 'year': '2003', 'display': 'LED',
         'note': 'fermo, da solo (senza accoppiamento): 3 casse, unico nel suo genere; solo giri di prova', 'cars': 3, 'node': 73}]
# the new Hitachi Rail STS trains (Giovanni, 2 Nov 2026): 6 cars, 106.5 m, yellow edges for the M3, called "Galileo". The
# first one (9201-9202) does only test laps on the loop; enough of them come in the next couple of years to replace all
# the traditional trains. Each one stands alone in its own depot place ('node') in test ('trial'): the page admits it
# to service from the admin menu, and then it takes the duties of a traditional train. Add the next ones here.
HITACHI = [('9201-9202', 2026, 77)]          # (units, year, depot place: 77 = A77; the next ones on 74 = A78, ...)
SOLO += [] if FLOTTA else [{'units': u, 'type': 'Hitachi Galileo', 'year': str(y), 'display': 'LED', 'note': '6 carrozze, 106,5 m', 'trial': True, 'node': n}
         for u, y, n in HITACHI]

# in the officina (manutenzione) at the start of the day (Giovanni, 9 Nov 2026: "due treni di cui uno prima serie secondo
# lotto in officina ad inizio giornata"): they take no tabella at the start of the day but are reserves the player can call
# (Giovanni 9 Nov: "in servizio, posso chiamarli in riserva"). Which trains and which officina stub tracks (200002 = #A73,
# 200001 = #A74): proposed by Claude, confirmed by Giovanni (9 Nov 2026, evening: "tua proposta va bene").
OFFICINA = [{'units': '8109-8110 + 8107-8108', 'node': 200002}, {'units': '8061-8062 + 8063-8064', 'node': 200001}]

def trains():
    out = []
    for m, y, note in MENEGHINO:
        if FLOTTA == '2015' and note.startswith('trasferito') and int(note.split()[-1]) > 2015: continue      # (from the M1 in 2010: already here)
        out.append({'units': m, 'type': 'Meneghino', 'year': str(y), 'display': 'LED', 'note': note})
    out.append({'units': '8101-8102 + 8103-8104', 'type': 'Tradizionale 2° lotto', 'year': '2003', 'display': 'LED', 'note': ''})
    out.append({'units': '8109-8110 + 8107-8108', 'type': 'Tradizionale 2° lotto', 'year': '2003-2004', 'display': 'LED', 'note': ''})
    out.append({'units': '8065-8066 + 8067-8068', 'type': 'Tradizionale 1° lotto', 'year': '1990', 'display': 'dot-matrix', 'note': ''})
    rest = [u for u in U1 if u not in ('8065-8066', '8067-8068')]       # 30 units: 15 trains
    for i in range(0, len(rest) - 1, 2):
        a, b = rest[i], rest[i + 1]
        out.append({'units': f'{a} + {b}', 'type': 'Tradizionale 1° lotto', 'year': str(YEAR1(a)), 'display': 'dot-matrix', 'note': ''})
    if FLOTTA == '2015':
        for i in range(0, len(SOCIMI), 2):
            out.append({'units': f'{SOCIMI[i]} + {SOCIMI[i + 1]}', 'type': 'Tradizionale 1° lotto SOCIMI', 'year': '1990', 'display': 'dot-matrix',
                        'note': 'inverter Hitachi: si accoppia solo con un\'altra unità SOCIMI'})
    for m, y, note in MENEGHINO_NEW:
        out.append({'units': m, 'type': 'Meneghino', 'year': str(y), 'display': 'LED', 'note': note})
    for t in out + SOLO: t['built'] = built(t['units'], t['year'])
    spare = rest[-1] if len(rest) % 2 else None
    return out, spare
