"""Pack the page, Leaflet and the built data into one self-contained HTML file (docs/index.html)."""
import base64, gzip, json, os
ROOT = os.environ.get('ROOT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.environ.get('OUT', os.path.join(ROOT, 'docs', 'index.html'))
web = os.path.join(ROOT, 'web')
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
t = t.replace('<script src="faults.js"></script>', '<script>' + open(os.path.join(web, 'faults.js')).read() + '</script>')
t = t.replace('<script src="radio.js"></script>', '<script>' + open(os.path.join(web, 'radio.js')).read() + '</script>')
assert 'unpkg' not in t and 'src="engine.js"' not in t and 'src="agents.js"' not in t and 'src="interlocking.js"' not in t and 'src="routes.js"' not in t and 'src="DepotM3.js"' not in t and 'src="radio.js"' not in t and 'src="faults.js"' not in t
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
t = t.replace('__DATA__', d).replace('__M3__', m).replace('__LIVE__', live)
# Saturday and Sunday (their own builds next to this one: ../build_sat, ../build_sun); missing: '_' (the page uses the weekday)
for suf, dn in (('6', 'build_sat'), ('7', 'build_sun')):
    bd = os.path.join(os.path.dirname(os.path.abspath('.')), dn)
    if all(os.path.exists(os.path.join(bd, f)) for f in ('data.json.gz', 'm3.json', 'm3_live.json')):
        d2 = base64.b64encode(open(os.path.join(bd, 'data.json.gz'), 'rb').read()).decode()
        m2 = base64.b64encode(gzip.compress(json.dumps({'fleets': [json.load(open(os.path.join(bd, 'm3.json')))]}, separators=(',', ':')).encode(), 9)).decode()
        l2 = base64.b64encode(gzip.compress(open(os.path.join(bd, 'm3_live.json'), 'rb').read(), 9)).decode()
        print('day', suf, 'from', dn)
    else: d2 = m2 = l2 = '_'
    t = t.replace('__DATA%s__' % suf, d2).replace('__M3%s__' % suf, m2).replace('__LIVE%s__' % suf, l2)
open(OUT, 'w').write(t)
print('written', OUT, round(os.path.getsize(OUT) / 1e6, 1), 'MB')
