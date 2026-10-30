"""Pagina HTML con gli itinerari di tutta la linea: python3 tools/itineraries_report.py build/itin_all.json out.html"""
import json, html, sys
HEAD = '<title>Itinerari M3</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n:root{--bg:#f6f7f8;--fg:#1c2127;--mut:#5d6874;--line:#d5dae0;--card:#fff;--acc:#b3541e;--ok:#e6f2e9;--okf:#1f6b3a;--wa:#fbefd9;--waf:#7a4b08;--ex:#f8e1de;--exf:#8c2a20;--il:#f8e1de}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14181c;--fg:#e4e8ec;--mut:#9aa5b1;--line:#2d353d;--card:#1b2127;--acc:#e8915a;--ok:#1d3326;--okf:#7fd09a;--wa:#3a2e14;--waf:#e6bd6e;--ex:#3b1f1c;--exf:#f0a198;--il:#3b1f1c;color-scheme:dark}}\n:root[data-theme="dark"]{--bg:#14181c;--fg:#e4e8ec;--mut:#9aa5b1;--line:#2d353d;--card:#1b2127;--acc:#e8915a;--ok:#1d3326;--okf:#7fd09a;--wa:#3a2e14;--waf:#e6bd6e;--ex:#3b1f1c;--exf:#f0a198;--il:#3b1f1c;color-scheme:dark}\nbody{background:var(--bg);color:var(--fg);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;padding-block:24px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}\nmain{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:32px}\nh1{font:600 26px/1.2 "IBM Plex Sans",sans-serif;margin:0;text-wrap:balance}h2{font:600 19px/1.3 "IBM Plex Sans",sans-serif;margin:0 0 10px;text-wrap:balance}h3{font-size:14px;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}\np{margin:0}.hint{color:var(--mut);font-size:13px;margin-bottom:8px}\n.sc{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}\ntable{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}\nthead th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);white-space:nowrap}\ntd.id{font:600 12px "IBM Plex Mono",monospace;white-space:nowrap}td.sw{font:12px "IBM Plex Mono",monospace;color:var(--mut)}\n.lg,.il{padding:1px 7px;border-radius:9px;font-size:12px;white-space:nowrap}.lg{background:var(--ok);color:var(--okf)}.il{background:var(--il);color:var(--exf)}\n.mx td,.mx th{text-align:center;font-size:12px;white-space:nowrap}.mx tbody th{text-align:left;font-family:"IBM Plex Mono",monospace}\n.par{background:var(--ok);color:var(--okf)}.sq{background:var(--wa);color:var(--waf)}.ex{background:var(--ex);color:var(--exf)}.dot{color:var(--mut)}\nul{margin:10px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px}\n.top{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}\ncode{font-family:"IBM Plex Mono",monospace;font-size:12px}\n.wa{background:var(--wa);color:var(--waf)}.rt{background:var(--ok);color:var(--okf)}.wa,.rt{padding:1px 7px;border-radius:9px;font-size:12px;white-space:nowrap}.miss{color:var(--exf);font-weight:600}.t{color:var(--mut);font-size:11px}details summary{cursor:pointer;color:var(--mut);font-size:13px;margin-top:8px}.nav a{color:var(--acc)}td.big{font-size:14px;white-space:nowrap}\n</style>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">\n'
SENSE = {'legale': ('lg', 'legale'), 'contromano': ('il', 'contromano'), 'va contromano': ('wa', 'va contromano'), 'rientra sul legale': ('rt', 'rientra sul legale')}
D = json.load(open(sys.argv[1])); h = html.escape


def sig(s):
    if not s: return '<span class="miss">manca</span>'
    lab, st, lg = s
    return '<b>%s</b>%s' % (lab, ' <span class="t">%s%s</span>' % (st, '' if lg else ' · ill.') if st else '')


def cell(v):
    k = v[0]
    return '<td class="par">libero</td>' if k == 'par' else '<td class="ex">attende</td>' if k == 'excl' else '<td class="sq">%d m</td>' % v[1]


out = []; total = 0
nav = ' · '.join('<a href="#%s">%s</a>' % (k, h(g['title'].split(':')[0])) for k, g in D.items())
for key, g in D.items():
    ms = g['moves']; total += len(ms)
    out.append('<section id="%s"><h2>%s</h2><p class="hint">%d movimenti</p><div class="sc"><table><thead><tr><th>ID</th><th>Dal semaforo</th><th>Al semaforo</th><th>Cosa fa il treno</th><th>Senso</th><th>Vel.</th></tr></thead><tbody>' % (key, h(g['title']), len(ms)))
    for m in ms:
        c, t = SENSE[m['sense']]
        endc = sig(m['end']) if m['end'] else ('<span class="t">ferma</span>' if m['stops_end'] else '<span class="miss">manca</span>')
        out.append('<tr><td class="id">%s</td><td class="big">%s</td><td class="big">%s</td><td>%s <span class="t">&rarr;</span> %s%s</td><td><span class="%s">%s</span></td><td>%s</td></tr>' % (
            m['id'], sig(m['start']), endc, h(m['frm']), h(m['to']), ' <span class="t">(%d altre strade)</span>' % len(m['alt']) if m.get('alt') else '', c, t, '15 km/h' if m['deviata'] else ''))
    out.append('</tbody></table></div>')
    out.append('<details><summary>Chi puo muoversi dopo chi</summary><p class="hint">Riga = parte per primo, colonna = segue. libero: insieme; N m: dopo N metri del primo; attende: il primo si ferma su un tratto in comune.</p><div class="sc"><table class="mx"><thead><tr><th></th>' + ''.join('<th>%s</th>' % m['id'].split('-')[1] for m in ms) + '</tr></thead><tbody>')
    for A in ms: out.append('<tr><th>%s</th>' % A['id'] + ''.join('<td class="dot">&middot;</td>' if A is B else cell(g['matrix'][A['id'] + '>' + B['id']]) for B in ms) + '</tr>')
    out.append('</tbody></table></div></details></section>')
intro = ('<header><h1>Itinerari della M3</h1><p class="hint">%d movimenti in %d gruppi di scambi, calcolati dal tracciato. Un treno passa da un binario all\'altro solo se lo scambio lo permette nella sua direzione (niente inversioni a U sullo scambio); inverte solo fermo in banchina o in tronchetto, davanti a un segnale (cambio banco). Corvetto, Porto di Mare, Zara, Dergano, Affori, Turati, Montenapoleone, Duomo, Missori e Crocetta non hanno scambi.</p><p class="nav">%s</p></header>' % (total, len(D), nav))
legend = '<div class="top"><b>Senso</b><p><span class="lg">legale</span> sul binario di destra · <span class="wa">va contromano</span> parte legale e passa sull\'altro binario · <span class="rt">rientra sul legale</span> parte contromano (dopo un cambio banco) e torna sul suo binario · <span class="il">contromano</span> sempre sul binario sinistro. <span class="miss">manca</span>: nessun segnale apre quel movimento.</p></div>'
open(sys.argv[2], 'w').write(HEAD + '<main>\n' + intro + legend + '\n'.join(out) + '</main>')
