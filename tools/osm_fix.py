"""Giovanni's corrections to a track file made from OpenStreetMap (data/osm_<line>.txt), kept apart in
data/osm_<line>_fix.json so a new Overpass export does not lose them: tools/osm_to_txt.py applies them after every
conversion, and this tool applies them again to the file as it is.

The corrections are keyed by the OSM way id (the 4th field of each line), not by the way number of the editor (w186),
which can change when OSM changes. Each one may set:
  "svc":  the kind of track: "" (running line), "yard" (depot), "siding" (tail, service track), "crossover"
  "tun":  "T" in a tunnel, "" on the surface, "C" on the surface under a covered station (the platform roof: it shows
          how long the platform is). For the signals "C" counts as surface, like "".
  "name": the name of the way
  "w", "note": the editor's number when the correction was written and why (for people; not applied)
A correction for an OSM way that is no longer in the file is reported, not dropped.

Usage: python3 tools/osm_fix.py data/osm_m2.txt data/osm_m2_fix.json"""
import json, sys


def apply(lines, fixes):
    """lines: the track file's lines; fixes: {osm id: {...}}. Returns (new lines, applied, missing ids)."""
    out, done = [], set()
    for ln in lines:
        tags, data = ln.split('#', 1)
        svc, name, tun, ref = tags.split('|')
        f = fixes.get(ref)
        if f:
            svc = f.get('svc', svc); name = f.get('name', name); tun = f.get('tun', tun)
            assert svc in ('', 'yard', 'siding', 'crossover', 'spur'), 'osm %s: svc %r' % (ref, svc)
            assert tun in ('', 'T', 'C'), 'osm %s: tun %r' % (ref, tun)
            done.add(ref)
        out.append('%s|%s|%s|%s#%s' % (svc, name, tun, ref, data))
    return out, done, sorted(set(fixes) - done)


def load_fixes(path):
    J = json.load(open(path))
    return {str(k): v for k, v in J.items() if not k.startswith('_')}


if __name__ == '__main__':
    txt, fx = sys.argv[1], sys.argv[2]
    lines = open(txt).read().strip().split('\n')
    new, done, missing = apply(lines, load_fixes(fx))
    open(txt, 'w').write('\n'.join(new) + '\n')
    print('%s: %d corrections applied from %s%s' % (txt, len(done), fx, ('; not in the file (OSM changed?): ' + ', '.join(missing)) if missing else ''))
