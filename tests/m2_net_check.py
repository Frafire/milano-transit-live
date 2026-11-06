"""The M2 track pieces for the speed limits tab (tools/net_m2.py), in an M2 build folder (build_m2/<day>):
- every piece has the fields of the M3's net (a, b, key, len, cat, kmh, fixed, p), its key unique, its nodes in nodes;
- the pieces cover the tracks: the same length in all;
- the base limits by kind from ops (data/operations_m2.json): main and sidings the line's top speed, crossovers the
  diverging speed, depot tracks the depot speed and fixed, nothing else fixed;
- the limits and cuts of data/rules_m2.json are on pieces (or junctions) of the net, each cut inside its piece.
Exit code 1 if one fails."""
import json, math, sys
F = json.load(open('m2.json')); N = F['net']; O = F['ops']; bad = 0
def check(ok, what):
    global bad
    print(('ok   ' if ok else 'FAIL ') + what); bad += not ok
E = N['edges']; keys = [e['key'] for e in E]
need = ('a', 'b', 'key', 'len', 'cat', 'kmh', 'fixed', 'p')
check(all(all(k in e for k in need) for e in E), 'M2 net: %d pieces, each with %s' % (len(E), ', '.join(need)))
check(len(set(keys)) == len(keys), 'M2 net: every key once')
check(all(str(e['a']) in N['nodes'] and str(e['b']) in N['nodes'] for e in E), 'M2 net: the ends of every piece among the %d nodes' % len(N['nodes']))
KY = 110540
def tlen(p):
    o, a, b = [], 0, 0
    for k in range(0, len(p), 2): a += p[k]; b += p[k + 1]; o.append((a / 1e6, b / 1e6))
    return sum(math.hypot((y[0] - x[0]) * KY, (y[1] - x[1]) * 111320 * math.cos(math.radians(x[0]))) for x, y in zip(o, o[1:]))
lt, le = sum(tlen(t['p']) for t in F['tracks']), sum(e['len'] for e in E)
check(abs(lt - le) < 0.005 * lt, 'M2 net: the pieces cover the tracks (%.1f km of %.1f km)' % (le / 1000, lt / 1000))
base = {'main': O['line_max_kmh'], 'siding': O['line_max_kmh'], 'crossover': O['diverging_kmh'], 'yard': O['depot_speed_kmh']}
check(all(e['kmh'] == base[e['cat']] and e['fixed'] == (e['cat'] == 'yard') for e in E),
      'M2 net: base limits main/siding %d, crossover %d, depot %d (fixed) km/h' % (O['line_max_kmh'], O['diverging_kmh'], O['depot_speed_kmh']))
ek = {e['key']: e for e in E}
sp = F.get('speeds', {}); cu = F.get('cuts', {})
off = [k for k in sp if not (k.startswith('J') and k[1:] in N['nodes']) and k.split('#')[0] not in ek]
offc = [k for k, c in cu.items() if k not in ek or not all(0 < x < ek[k]['len'] for x in c)]
check(not off and not offc, 'M2 limits from data/rules_m2.json on the net: %d limits, %d cut pieces%s' % (len(sp), len(cu), ' (not on it: %s)' % (off + offc)[:5] if off or offc else ''))
sys.exit(1 if bad else 0)
