"""Giovanni's corrections to a track file made from OpenStreetMap (data/osm_<line>.txt), kept apart in
data/osm_<line>_fix.json so a new Overpass export does not lose them: tools/osm_to_txt.py applies them after every
conversion, and this tool applies them again to the file as it is.

The corrections are keyed by the OSM way id (the 4th field of each line), not by the way number of the editor (w186),
which can change when OSM changes. Each one may set:
  "svc":  the kind of track: "" (running line), "yard" (depot), "siding" (tail, service track), "crossover"
  "tun":  "T" in a tunnel, "" on the surface, "C" on the surface under a covered station (the platform roof: it shows
          how long the platform is). For the signals "C" counts as surface, like "".
  "name": the name of the way
  "split": {"at": [lat, lon], "rest": {...}}: cut the way at its point with these coordinates (an OSM node): the part
          up to it keeps the way and its corrections, the part after it becomes a new way at the end of the file (so
          the editor's numbers of the other ways do not change), with the fields of "rest" (svc, tun, name) and the
          OSM id followed by "b"
  "w", "note": the editor's number when the correction was written and why (for people; not applied)
A correction for an OSM way that is no longer in the file is reported, not dropped.

Usage: python3 tools/osm_fix.py data/osm_m2.txt data/osm_m2_fix.json"""
import json, sys


def decode(data):
    v = list(map(int, data.split(','))); pts = []; a = b = 0
    for k in range(0, len(v), 3):
        a += v[k]; b += v[k + 1]; pts.append([a, b, v[k + 2]])
    return pts


def encode(pts):
    v, a, b = [], 0, 0
    for la, lo, n in pts:
        v += [la - a, lo - b, n]; a, b = la, lo
    return ','.join(map(str, v))


def fields(svc, name, tun, ref, f):
    svc = f.get('svc', svc); name = f.get('name', name); tun = f.get('tun', tun)
    assert svc in ('', 'yard', 'siding', 'crossover', 'spur'), 'osm %s: svc %r' % (ref, svc)
    assert tun in ('', 'T', 'C'), 'osm %s: tun %r' % (ref, tun)
    return svc, name, tun


def apply(lines, fixes):
    """lines: the track file's lines; fixes: {osm id: {...}}. Returns (new lines, applied, missing ids)."""
    # pieces of an earlier split go back on their way first, so the corrections can be applied again to the same file
    rest = {ln.split('#', 1)[0].split('|')[3][:-1]: ln.split('#', 1)[1] for ln in lines if ln.split('#', 1)[0].split('|')[3].endswith('b')}
    lines = [ln for ln in lines if not ln.split('#', 1)[0].split('|')[3].endswith('b')]
    for i, ln in enumerate(lines):
        tags, data = ln.split('#', 1); ref = tags.split('|')[3]
        if ref in rest: lines[i] = tags + '#' + encode(decode(data) + decode(rest[ref])[1:])
    out, extra, done = [], [], set()
    top = max(p[2] for ln in lines for p in decode(ln.split('#', 1)[1]))
    for ln in lines:
        tags, data = ln.split('#', 1)
        svc, name, tun, ref = tags.split('|')
        f = fixes.get(ref)
        if f:
            svc, name, tun = fields(svc, name, tun, ref, f)
            if f.get('split'):
                pts = decode(data); at = [round(x * 1e6) for x in f['split']['at']]
                k = next((i for i, p in enumerate(pts) if p[0] == at[0] and p[1] == at[1]), None)
                assert k is not None and 0 < k < len(pts) - 1, 'osm %s: split point %s not inside the way' % (ref, f['split']['at'])
                if not pts[k][2]: top += 1; pts[k][2] = top       # a plain point becomes a junction
                data = encode(pts[:k + 1])
                r = f['split'].get('rest', {}); rs, rn, rt = fields(svc, name, tun, ref, r)
                extra.append('%s|%s|%s|%sb#%s' % (rs, rn, rt, ref, encode(pts[k:])))
            done.add(ref)
        out.append('%s|%s|%s|%s#%s' % (svc, name, tun, ref, data))
    return out + extra, done, sorted(set(fixes) - done)


def load_fixes(path):
    J = json.load(open(path))
    return {str(k): v for k, v in J.items() if not k.startswith('_')}


if __name__ == '__main__':
    txt, fx = sys.argv[1], sys.argv[2]
    lines = open(txt).read().strip().split('\n')
    new, done, missing = apply(lines, load_fixes(fx))
    open(txt, 'w').write('\n'.join(new) + '\n')
    print('%s: %d corrections applied from %s%s' % (txt, len(done), fx, ('; not in the file (OSM changed?): ' + ', '.join(missing)) if missing else ''))
