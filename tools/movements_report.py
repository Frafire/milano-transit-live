"""Pagina HTML con le tabelle degli itinerari: python3 tools/movements_report.py build/movements.json head.html out.html"""
import json, html, sys
D = json.load(open(sys.argv[1])); head = open(sys.argv[2]).read().split('<main>')[0]; h = html.escape
notes = {
 'SD': ['A14 (binario 3) e A45 (binario 2) sono di tipo e: mai verdi insieme, rossi fino a 30 s prima della partenza.', 'SD-14 (A349, tipo d) e possibile come navetta ma congestiona il tunnel.', 'A41 e A44 sono rossi di norma e controllano scambi e partenza verso deposito e tronchetti (SD-15 ... SD-20).'],
 'ROG': ["L'incrocio e' sul lato San Donato: si usa solo come cambio banco. Chi parte da A285 non puo' usarlo direttamente: deve andare a A301, invertire e ripartire da li. Dalla linea legale non si passa alla banchina opposta senza un cambio banco (RG-2 tolto).", 'Chiunque usi il deviatoio passa a 15 km/h.'],
 'BRE': ['I due monconi non si usano (troppo corti).', 'A19 e A20 sono manuali: riaperti solo dal PC dopo aver controllato le sezioni.'],
 'LOD': ["A276 puo' usare l'incrocio solo dopo un cambio banco a A308 (LD-4).", "Dal binario legale non si passa alla banchina sud senza un cambio banco a Lodi (LD-2 tolto). A314 (tipo d) puo' instradare sull'altro binario a 15 km/h (LD-8)."]}
def cell(v):
    k = v[0]
    return '<td class="par">libero</td>' if k == 'par' else '<td class="ex">attende</td>' if k == 'excl' else '<td class="sq">%d m</td>' % v[1]
out = []
for key, g in D.items():
    ms = g['moves']; out.append('<section><h2>%s</h2><div class="sc"><table><thead><tr><th>ID</th><th>Movimento</th><th>Senso</th><th>Parte da</th><th>Poi attende</th><th>Velocita</th><th>Scambi (posizione)</th></tr></thead><tbody>' % h(g['title']))
    for m in ms:
        sw = ', '.join('%s: %s&rarr;%s' % tuple(x) for x in m['switches']) or 'nessuno'
        out.append('<tr><td class="id">%s</td><td>%s</td><td><span class="%s">%s</span></td><td>%s</td><td>%s</td><td>%s</td><td class="sw">%s</td></tr>' % (m['id'], h(m['label']), 'lg' if m['legal'] else 'il', 'legale' if m['legal'] else 'illegale', h(m['start']), h(m['end']), h(m['lim']), sw))
    out.append('</tbody></table></div><h3>Chi puo muoversi dopo chi</h3><p class="hint">Riga = parte per primo, colonna = segue. libero: insieme; N m: dopo N metri del primo; attende: il primo si ferma su un tratto in comune.</p><div class="sc"><table class="mx"><thead><tr><th></th>' + ''.join('<th>%s</th>' % m['id'].split('-')[1] for m in ms) + '</tr></thead><tbody>')
    for A in ms: out.append('<tr><th>%s</th>' % A['id'] + ''.join('<td class="dot">&middot;</td>' if A is B else cell(g['matrix'][A['id'] + '>' + B['id']]) for B in ms) + '</tr>')
    out.append('</tbody></table></div><ul>' + ''.join('<li>%s</li>' % h(n) for n in notes[key]) + '</ul></section>')
open(sys.argv[3], 'w').write(head + '<main>\n<header><h1>Scambi e itinerari da San Donato a Lodi</h1><p class="hint">Dal tracciato attuale, con le tue correzioni. Corvetto e Porto di Mare non hanno scambi.</p></header>\n' + '\n'.join(out) + '</main>')
