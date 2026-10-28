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
t = t.replace('<script src="agents.js"></script>', '<script>' + open(os.path.join(web, 'agents.js')).read() + '</script>')
t = t.replace('<script src="DepotM3.js"></script>', '<script>' + open(os.path.join(web, 'DepotM3.js')).read() + '</script>')
assert 'unpkg' not in t and 'src="engine.js"' not in t and 'src="agents.js"' not in t and 'src="interlocking.js"' not in t and 'src="DepotM3.js"' not in t
d = base64.b64encode(open('data.json.gz', 'rb').read()).decode()
# M3 only for now (the page shows only M3); ALL_LINES=1 packs every line again
fleets = [json.load(open(f)) for f in (('m1.json', 'm3.json', 'm4.json', 'b130.json', 'b64.json') if os.environ.get('ALL_LINES') else ('m3.json',))]
m = base64.b64encode(gzip.compress(json.dumps({'fleets': fleets}, separators=(',', ':')).encode(), 9)).decode()
live = base64.b64encode(gzip.compress(open('m3_live.json', 'rb').read(), 9)).decode() if os.path.exists('m3_live.json') else ''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write(t.replace('__DATA__', d).replace('__M3__', m).replace('__LIVE__', live))
print('written', OUT, round(os.path.getsize(OUT) / 1e6, 1), 'MB')
