"""Write the site into docs/ (served by GitHub Pages):
  index.html      the menu (web/home.html): Gioca! -> mezzo -> linea; what can be played comes from data/linee.json
  gioca.html      the game (web/template.html) with Leaflet and the scripts, but without the data
  dati/<line>_<day>.js   the data of one line for one kind of day (1 weekday, 6 Saturday, 7 Sunday), loaded by
                  gioca.html only for the line chosen in the menu. A <script> file, so it also works opened from the disk."""
import base64, gzip, json, os, glob
ROOT = os.environ.get('ROOT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DOCS = os.environ.get('DOCS', os.path.join(ROOT, 'docs'))
OUT = os.path.join(DOCS, 'gioca.html')
web = os.path.join(ROOT, 'web')
def uri(path, mt=None):
    mt = mt or {'.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}[os.path.splitext(path)[1].lower()]
    return 'data:%s;base64,%s' % (mt, base64.b64encode(open(path, 'rb').read()).decode())
t = open(os.path.join(web, 'template.html')).read()
css = open(os.path.join(web, 'vendor/leaflet/leaflet.css')).read()
js = open(os.path.join(web, 'vendor/leaflet/leaflet.js')).read()
t = t.replace('<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">', '<style>' + css + '</style>')
t = t.replace('<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>', '<script>' + js + '</script>')
t = t.replace('<script src="engine.js"></script>', '<script>' + open(os.path.join(web, 'engine.js')).read() + '</script>')
t = t.replace('<script src="interlocking.js"></script>', '<script>' + open(os.path.join(web, 'interlocking.js')).read() + '</script>')
t = t.replace('<script src="routes.js"></script>', '<script>' + open(os.path.join(web, 'routes.js')).read() + '</script>')
t = t.replace('<script src="agents.js"></script>', '<script>' + open(os.path.join(web, 'agents.js')).read() + '</script>')
t = t.replace('<script src="DepotM3.js"></script>', '<script>' + open(os.path.join(web, 'DepotM3.js')).read() + '</script>')
t = t.replace('<script src="frasi.js"></script>', '<script>' + open(os.path.join(web, 'frasi.js')).read() + '</script>')
t = t.replace('<script src="faults.js"></script>', '<script>' + open(os.path.join(web, 'faults.js')).read() + '</script>')
t = t.replace('<script src="radio.js"></script>', '<script>' + open(os.path.join(web, 'radio.js')).read() + '</script>')
assert 'unpkg' not in t and 'src="engine.js"' not in t and 'src="agents.js"' not in t and 'src="interlocking.js"' not in t and 'src="routes.js"' not in t and 'src="DepotM3.js"' not in t and 'src="radio.js"' not in t and 'src="faults.js"' not in t and 'src="frasi.js"' not in t
d = base64.b64encode(open('data.json.gz', 'rb').read()).decode()
# M3 only for now (the page shows only M3); ALL_LINES=1 packs every line again
fleets = [json.load(open(f)) for f in (('m1.json', 'm3.json', 'm4.json', 'b130.json', 'b64.json') if os.environ.get('ALL_LINES') else ('m3.json',))]
m = base64.b64encode(gzip.compress(json.dumps({'fleets': fleets}, separators=(',', ':')).encode(), 9)).decode()
live = base64.b64encode(gzip.compress(open('m3_live.json', 'rb').read(), 9)).decode() if os.path.exists('m3_live.json') else ''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
logo = os.path.join(web, 'img', 'm3_logo.png')        # the M3 mark on the train card (Giovanni's image)
t = t.replace('__M3LOGO__', 'data:image/png;base64,' + base64.b64encode(open(logo, 'rb').read()).decode() if os.path.exists(logo) else '')
# the marks of the other lines and services on the M3 station cards (Giovanni's images: S, R, trains, M1, M2, M4, M5...)
ld = os.path.join(web, 'img', 'lines'); logos = {}
if os.path.isdir(ld):
    for fn in sorted(os.listdir(ld)):
        nm, ext = os.path.splitext(fn); mt = {'.png': 'image/png', '.svg': 'image/svg+xml'}.get(ext)
        if mt: logos[nm] = 'data:%s;base64,%s' % (mt, base64.b64encode(open(os.path.join(ld, fn), 'rb').read()).decode())
t = t.replace('__LINELOGOS__', json.dumps(logos))
# ---------- the data, one file per line and kind of day ----------
# Today only M3 is built (the timetable data.json is the M3 extract), so the packs are M3's. A new line gets its own
# timetable and fleet build and its own packs here; data/linee.json says when it can be played.
dati = os.path.join(DOCS, 'dati'); os.makedirs(dati, exist_ok=True)
for old in glob.glob(os.path.join(dati, '*.js')): os.remove(old)
packs = {}
def write_pack(line, suf, data, fleet, live):
    name = '%s_%s.js' % (line.lower(), suf or '1')
    js = '(window.MTL_PACK = window.MTL_PACK || {})[%s] = %s;\n' % (json.dumps(line + suf), json.dumps({'data': data, 'fleet': fleet, 'live': live}))
    open(os.path.join(dati, name), 'w').write(js)
    packs.setdefault(line, []).append(suf)
    print('  dati/%s  %.1f MB' % (name, len(js) / 1e6))
write_pack('M3', '', d, m, live)
# Saturday and Sunday (their own builds next to this one: ../build_sat, ../build_sun); missing: the page uses the weekday
for suf, dn in (('6', 'build_sat'), ('7', 'build_sun')):
    bd = os.path.join(os.path.dirname(os.path.abspath('.')), dn)
    if all(os.path.exists(os.path.join(bd, f)) for f in ('data.json.gz', 'm3.json', 'm3_live.json')):
        d2 = base64.b64encode(open(os.path.join(bd, 'data.json.gz'), 'rb').read()).decode()
        m2 = base64.b64encode(gzip.compress(json.dumps({'fleets': [json.load(open(os.path.join(bd, 'm3.json')))]}, separators=(',', ':')).encode(), 9)).decode()
        l2 = base64.b64encode(gzip.compress(open(os.path.join(bd, 'm3_live.json'), 'rb').read(), 9)).decode()
        write_pack('M3', suf, d2, m2, l2)
# the other lines' data, each from its own file (tools/assemble_<line>.py): nothing of theirs in this file
import sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble_m2
packs.update(assemble_m2.write(dati))
t = t.replace('__PACKS__', json.dumps(packs))
# what each line has in the page (data/capacita.json): panels with data-cap are shown only for lines with that capability
t = t.replace('__CAPS__', json.dumps({k: v for k, v in json.load(open(os.path.join(ROOT, 'data', 'capacita.json'))).items() if not k.startswith('_')}, ensure_ascii=False))
assert '__DATA' not in t and '__PACKS__' not in t and '__CAPS__' not in t
open(OUT, 'w').write(t)
print('written', OUT, round(os.path.getsize(OUT) / 1e6, 1), 'MB')

# ---------- the menu ----------
linee = json.load(open(os.path.join(ROOT, 'data', 'linee.json')))
play = {k: v for k, v in linee.items() if not k.startswith('_')}
for k, v in play.items():
    assert v in ('giocabile', 'in test', 'in arrivo'), 'data/linee.json: %s = %r (giocabile / in test / in arrivo)' % (k, v)
    if v in ('giocabile', 'in test') and k.startswith('M'):      # a metro line or a set of lines: each one needs its data
        for ln in k.split('+'):
            assert ln in packs, 'data/linee.json says %s is giocabile, but there are no data for %s (dati/%s_1.js)' % (k, ln, ln.lower())
        assert '+' not in k, 'data/linee.json: %s together cannot be played yet (gioca.html loads one line)' % k
h = open(os.path.join(web, 'home.html')).read()
img = os.path.join(web, 'img')
assets = {'__LINEE__': json.dumps(play, ensure_ascii=False),
          '__M1__': uri(os.path.join(img, 'lines', 'M1.png')), '__M2__': uri(os.path.join(img, 'lines', 'M2.png')),
          '__M3__': uri(os.path.join(img, 'm3_logo.png')), '__M4__': uri(os.path.join(img, 'lines', 'M4.png')),
          '__M5__': uri(os.path.join(img, 'lines', 'M5.svg')), '__METRO__': uri(os.path.join(img, 'home', 'metro.png')),
          '__RETE__': uri(os.path.join(img, 'home', 'rete.png')),
          '__SIG_STOP__': uri(os.path.join(web, 'assets', 'signals', 'stop@8x.png')), '__SIG_GO__': uri(os.path.join(web, 'assets', 'signals', 'go@8x.png'))}
bg = os.path.join(img, 'home', 'sfondo.jpg')      # the blurred photo behind the menu; without it, a plain dark blue
assets['__SFONDO__'] = "url('%s')" % uri(bg) if os.path.exists(bg) else 'none'
for k, v in assets.items():
    assert k in h, 'web/home.html has no ' + k
    h = h.replace(k, v)
open(os.path.join(DOCS, 'index.html'), 'w').write(h)
print('written', os.path.join(DOCS, 'index.html'), round(os.path.getsize(os.path.join(DOCS, 'index.html')) / 1e3), 'kB')
