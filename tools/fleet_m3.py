"""Real M3 rolling stock (Giovanni, Oct 2026). A traditional unit is 3 cars (M+R+M); a train couples two.
Meneghino trains are already 6 cars. Units 'Accantonato' are left out."""
U1 = [f'{a}-{a+1}' for a in range(8001, 8041, 2)] + [f'{a}-{a+1}' for a in range(8045, 8069, 2)]   # 1st lot, 32 units
U2 = ['8101-8102', '8103-8104', '8105-8106', '8107-8108', '8109-8110']                             # 2nd lot, 5 units
MENEGHINO = [('987-988', 2010, 'trasferito dalla M2 nel 2021'), ('989-990', 2010, 'trasferito dalla M2 nel 2021'),
             ('951-952', 2009, 'trasferito dalla M1 nel 2010'), ('953-954', 2009, 'trasferito dalla M1 nel 2010'),
             ('955-956', 2009, 'trasferito dalla M1 nel 2010'), ('957-958', 2009, 'trasferito dalla M1 nel 2010')]
YEAR1 = lambda u: 1989 if int(u[:4]) <= 8040 else 1990

def trains():
    out = []
    for m, y, note in MENEGHINO:
        out.append({'units': m, 'type': 'Meneghino (Alstom)', 'year': str(y), 'display': 'LED', 'note': note})
    out.append({'units': '8101-8102 + 8103-8104', 'type': 'Tradizionale 2° lotto', 'year': '2003', 'display': 'LED', 'note': ''})
    out.append({'units': '8105-8106 + 8107-8108', 'type': 'Tradizionale 2° lotto', 'year': '2003-2004', 'display': 'LED', 'note': ''})
    out.append({'units': '8109-8110 + ' + U1[-1], 'type': 'Tradizionale misto 2° + 1° lotto', 'year': '2004 / 1990', 'display': 'LED + dot-matrix', 'note': ''})
    rest = U1[:-1]                                  # 31 units: 15 trains + 1 spare
    for i in range(0, len(rest) - 1, 2):
        a, b = rest[i], rest[i + 1]
        out.append({'units': f'{a} + {b}', 'type': 'Tradizionale 1° lotto', 'year': str(YEAR1(a)), 'display': 'dot-matrix', 'note': ''})
    spare = rest[-1] if len(rest) % 2 else None
    return out, spare
