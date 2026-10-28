"""Build a metro line's fleet simulation on its real OSM tracks. LINE=M3 or LINE=M4."""
import sys, os, json, math, collections
sys.path.insert(0, '.')
LINE = os.environ.get('LINE', 'M3')
CFG = {
  'M3': dict(tracks='osm_m3.txt', main='Linea M3', home='San Donato', far='Comasina',
             HOME_STOP=(45.42893, 9.25585), FAR_STOP=(45.52885, 9.16333),
             SD_TAILS=[163, 116], COM_TAILS=[183, 179], SD_DEP={1: 143, 2: 120}, PLATS=[1, 2],
             SD_OUT_NODE=165, IN_VIA=[124, 153, 160], DEPOT_IN_VIA=[124, 153, 160], AFTER_ARR=160,
             PULL_OUT=300, PLAT_WAIT=120,
             depot_box=(45.4285, 45.4335, 9.2515, 9.2585), skip_dead=(201,), half=52.5, training=True, through=True, tail_at_signal=True, nose_stop=True, blocks=True, degraded=True, recovery=[['BRENTA', 'S', (45.4428, 45.4450, 9.2140, 9.2180)], ['CENTRALE FS', 'S', (45.4815, 45.4850, 9.1995, 9.2070)], ['CENTRALE FS', 'N', (45.4815, 45.4850, 9.1995, 9.2070)]], com_choice=True, ARR2=dict(via=[124, 153, 196], end=120, lift=[103]), SECTION=dict(sb=[136, 153], nb=[165, 137], lift=[66]), THROATS=dict(home=dict(ends=[120, 143, 160], p1=[143, 165], depot=[[141, 142], [142, 143]]), far=dict(ends=[124, 181])),
             labels=[('1', 78, 70, 'on'), ('2', 103, 85, 'on'), ('3', 79, 100, 'on')]),
  'M4': dict(tracks='osm_m4.txt', main='Linea M4', home='San Cristoforo', far='Linate Aeroporto',
             HOME_STOP=(45.44236, 9.12977), FAR_STOP=(45.46284, 9.27800),
             SD_TAILS=[18, 107], COM_TAILS=[3, 4], SD_DEP={1: 20}, PLATS=[1],
             SD_OUT_NODE=34, IN_VIA=[39, 40], DEPOT_IN_VIA=[39, 40, 16], AFTER_ARR=16,
             PULL_OUT=450, PLAT_WAIT=30,
             depot_box=(45.431, 45.4385, 9.122, 9.1335), skip_dead=(), half=25.25, training=False, through=False),
}[LINE]
os.environ['TRACKS'] = CFG['tracks']
from router import *
print('track rules from the editor:', load_rules('rules_%s.json' % LINE.lower(), LINE))
print('main-line directions (right-hand running):', infer_main_directions())
for _w in {'M4': [18, 88]}.get(LINE, []):      # Linate station tracks: used both ways until Giovanni marks them
    ONEWAY.pop(_w, None)
from dwell import add_dwell

D = json.load(open('data.json'))
R = D['routes']
M3 = [i for i, r in enumerate(R) if r['id'] == LINE][0]

SD_STOP, COM_STOP = CFG['HOME_STOP'], CFG['FAR_STOP']
SD_TAILS, COM_TAILS = CFG['SD_TAILS'], CFG['COM_TAILS']
SD_DEP = CFG['SD_DEP']; SD_OUT_NODE = CFG['SD_OUT_NODE']
TRAIN_HALF = CFG['half']
# operating rules Giovanni can tune without touching code: data/operations_<line>.json
OPS = {'station_stop_s': 30, 'terminus_unload_s': 45, 'platform_wait_min_s': 30, 'platform_wait_max_s': 120,
       'min_turnaround_min': 7, 'depot_rest_if_wait_over_min': 15, 'tail_speed_kmh': 12.5, 'depot_speed_kmh': 15,
       'driver_walk_speed_ms': 1.4, 'cab_setup_s': 30, 'line_max_kmh': 80, 'train_max_kmh': 90, 'diverging_kmh': 15, 'curve_radius_m': 400, 'curve_minus_kmh': 10, 'acceleration_ms2': 1.0, 'braking_ms2': 1.0}
_ops = 'operations_%s.json' % LINE.lower()
if os.path.exists(_ops):
    OPS.update({k: v for k, v in json.load(open(_ops)).items() if not k.startswith('_')})
    print('operating rules from', _ops)
V_YARD = OPS['depot_speed_kmh'] / 3.6   # depot speed limit 15 km/h (confirmed by ATM staff; not on the test loop)
EMPTY_MARGIN = int(os.environ.get("EMPTY_MARGIN", 720))  # unscheduled empty runs need recovery time before the next service
V_EMPTY = 13.0    # m/s ~47 km/h empty run on the line
PULL_OUT = CFG['PULL_OUT']   # depot -> platform (M3: 5 min; M4: 7-8 min, very slow)
PLAT_WAIT = CFG['PLAT_WAIT'] # wait at platform before first departure (M3 2 min, M4 30 s)
DWELL_END = OPS['terminus_unload_s']    # passengers leave at the terminus (Giovanni: 30 s - 1 min)
TRAIN_LEN = 2 * CFG['half']
REVERSE = round(TRAIN_LEN / OPS['driver_walk_speed_ms']) + OPS['cab_setup_s']   # driver walks the train (~1.4 m/s) and sets up the cab (>= 30 s)
V_TAIL = OPS['tail_speed_kmh'] / 3.6                       # Giovanni: 10-15 km/h entering and leaving the dead-end tracks
LAYOVER_DEPOT = 25 * 60

# depot storage tracks, nearest first
depot_dead = [n for n in node_pos if len(node_edges[n]) == 1]
def in_depot(n):
    la, lo = ll(*node_pos[n]); b = CFG['depot_box']; return b[0] < la < b[1] and b[2] < lo < b[3]
STORE_EXIT = {}       # through-track middle node -> node to leave by (the far end, or the same end: cambio banco)
STORE_ARR_FROM = {}   # through-track place -> the end trains come in by
STORE_SAME = set()    # through tracks left by the end the train came in
STORE_WAY = {}        # depot place -> OSM way of its track (for numbering and names)
LINKS_BY_MID = {}
if CFG.get('through'):
    _fixed = (json.load(open('rules_%s.json' % LINE.lower())) if os.path.exists('rules_%s.json' % LINE.lower()) else {}).get('depot_through', {}).get('pairs')
    if _fixed:                       # fixed by Giovanni: part of the depot
        for _a, _b in _fixed:
            if _a in node_pos and _b in node_pos: add_link(_a, _b)
    else: auto_links(CFG['depot_box'], CFG['skip_dead'])
    print('depot through tracks:', len(LINKS))
    LINKS_BY_MID = {m: (a, b) for a, b, m in LINKS}
storage = []
import router as _router
FIT = 2 * TRAIN_HALF + 10      # a parked train must not stick out over a switch
def _side_len(n):              # length of the depot track beyond a through-track end, up to its switch
    return sum(edges[e]['len'] for e in node_edges[n] if 'mid' not in edges[e])
too_short = no_park = 0
for a_, b_, m in LINKS:
    half_room = min(math.dist(node_pos[a_], node_pos[m]) + _side_len(a_), math.dist(node_pos[b_], node_pos[m]) + _side_len(b_))
    if half_room < FIT / 2: too_short += 1; continue
    if {edges[e]['way'] for x in (a_, b_) for e in node_edges[x] if 'mid' not in edges[e]} & NOPARK: no_park += 1; continue
    _router.THROUGH_ALLOWED = {m}
    for entry, exit_ in ((a_, b_), (b_, a_)):
        r_in = route_nodes(CFG['AFTER_ARR'], m)
        if not r_in: break
        last = r_in[-1]; came_from = start_node(*last)
        ex = b_ if came_from == a_ else a_
        # Giovanni: most depot tracks are left by the end the train came in (the driver changes cab);
        # only tracks marked "Stabling: through" are left by the other end
        here = {edges[e]['way'] for x in (a_, b_) for e in node_edges[x] if 'mid' not in edges[e]}
        # out by the end it came in (cab change) or straight on through the far end: the shorter way out (Giovanni:
        # leaving from the front is quicker, so preferable); "Stabling: through" marks force the far end
        r_same = route_nodes(m, SD_OUT_NODE, via=[SD_DEP[1]], first=came_from)
        r_fwd = route_nodes(m, SD_OUT_NODE, via=[SD_DEP[1]], first=ex)
        if not (here & _router.THROUGH_STABLE) and r_same and (not r_fwd or plen(path_poly(r_same)) <= plen(path_poly(r_fwd)) + 50): ex = came_from
        STORE_WAY[m] = min(here) if here else -1
        if ex == came_from: STORE_SAME.add(m)
        STORE_ARR_FROM[m] = came_from
        r_out = route_nodes(m, SD_OUT_NODE, via=[SD_DEP[1]], first=ex)
        if r_out: storage.append((0, m)); STORE_EXIT[m] = ex
        break
_router.THROUGH_ALLOWED = set()          # a dead-end track must be reachable without cutting through a parked train
for n in depot_dead:
    if not in_depot(n) or n in CFG['skip_dead'] or len(node_edges[n]) != 1: continue
    if edges[node_edges[n][0]]['len'] < FIT: too_short += 1; continue
    if edges[node_edges[n][0]]['way'] in NOPARK: no_park += 1; continue
    a = route_nodes(CFG['AFTER_ARR'], n); b = route_nodes(n, SD_OUT_NODE, via=[SD_DEP[1]])
    if a and b: storage.append((plen(path_poly(b)), n)); STORE_WAY[n] = edges[node_edges[n][0]]['way']
_router.THROUGH_ALLOWED = set()          # from now on no route may cut through a through track...
# Giovanni's flags on the through tracks: the end of the parked train stands a few metres before the shunting signal.
# The train arrives from STORE_ARR_FROM[m] and stops with its nose at m: m goes where that puts the train's end at the flag
def _place_link(li, a_, b_, m):
    f = _router.LINK_FLAG.get(li); came = STORE_ARR_FROM.get(m)
    if came is None: return
    (ax, ay), (bx, by) = node_pos[a_], node_pos[b_]; L_ = math.hypot(bx - ax, by - ay) or 1; ux, uy = (bx - ax) / L_, (by - ay) / L_
    if not f:                       # no flag on it: the end of the train 8 m inside the north-east end (as the flagged ones)
        ne_b = ux * math.sin(math.radians(50)) + uy * math.cos(math.radians(50)) > 0
        fx, fy = (bx - ux * 8, by - uy * 8) if ne_b else (ax + ux * 8, ay + uy * 8); f = (fx, fy, 50)
    t = (f[0] - ax) * ux + (f[1] - ay) * uy                      # flag along a_ -> b_
    hx, hy = math.sin(math.radians(f[2])), math.cos(math.radians(f[2]))
    toward_b = hx * ux + hy * uy > 0                               # the flagged end of the train is towards b_
    arr_to_b = came == a_                                          # moving towards b_ when arriving
    tm = t if toward_b == arr_to_b else (t - 2 * TRAIN_HALF if toward_b else t + 2 * TRAIN_HALF)
    tm = max(8, min(L_ - 8, tm)); node_pos[m] = (ax + ux * tm, ay + uy * tm)
    for ei in node_edges[m]:
        e = edges[ei]; P0, P1 = node_pos[e['a']], node_pos[e['b']]; n_ = max(2, int(math.hypot(P1[0] - P0[0], P1[1] - P0[1]) / 10) + 1)
        e['pts'] = [(P0[0] + (P1[0] - P0[0]) * i / (n_ - 1), P0[1] + (P1[1] - P0[1]) * i / (n_ - 1)) for i in range(n_)]; e['len'] = plen(e['pts'])
# two trains on one through track (Giovanni's "Bandiera 2"): the first stands at the shunting signals end and uses that end
# only; the second stands at the other end and uses the other end (with the small loop to get to the station)
def _ne_end(a_, b_):
    (ax, ay), (bx, by) = node_pos[a_], node_pos[b_]
    return b_ if (bx - ax) * math.sin(math.radians(50)) + (by - ay) * math.cos(math.radians(50)) > 0 else a_
SECOND = {}                     # link index -> second place node
for _w, _f in _router.LINK_FLAG2_W.items():      # flags on the track just outside the building: the through track it leads to
    for _li, (_a, _b, _m) in enumerate(LINKS):
        if any(edges[e]['way'] == _w for x in (_a, _b) for e in node_edges[x] if 'mid' not in edges[e]): _router.LINK_FLAG2.setdefault(_li, _f)
for li_, (a_, b_, m_) in enumerate(LINKS):
    if li_ not in _router.LINK_FLAG2 or m_ not in STORE_EXIT: continue
    ne_ = _ne_end(a_, b_)
    _router.THROUGH_ALLOWED = {m_}
    if not route_nodes(CFG['AFTER_ARR'], m_, via=[ne_]) or not route_nodes(m_, SD_OUT_NODE, via=[SD_DEP[1]], first=ne_):
        print('second place on through track', li_, 'skipped: its first train cannot use the shunting-signal end only'); continue
    STORE_ARR_FROM[m_] = ne_; STORE_EXIT[m_] = ne_; STORE_SAME.add(m_); SECOND[li_] = None
_router.THROUGH_ALLOWED = set()
for li_, (a_, b_, m_) in enumerate(LINKS): _place_link(li_, a_, b_, m_)
for li_ in list(SECOND):
    a_, b_, m_ = LINKS[li_]; ne_ = _ne_end(a_, b_); sw_ = a_ if ne_ == b_ else b_
    fx, fy, _h = _router.LINK_FLAG2[li_]
    (sx, sy), (mx, my) = node_pos[sw_], node_pos[m_]; L_ = math.hypot(mx - sx, my - sy) or 1; ux, uy = (mx - sx) / L_, (my - sy) / L_
    t2 = (fx - sx) * ux + (fy - sy) * uy + 2 * TRAIN_HALF        # it arrives from the far end: its nose 105 m past the flag
    gap = L_ - t2                                                 # the first train stands beyond m (it came in by the other end)
    print('second place on through track', li_, ': room between the two trains', round(gap), 'm')
    if gap < -1: print('   skipped: they would touch'); del SECOND[li_]; continue
    t2 = min(t2, L_ - 1)
    m2 = 300000 + li_; node_pos[m2] = (sx + ux * t2, sy + uy * t2)
    e = next(e for e in node_edges[m_] if sw_ in (edges[e]['a'], edges[e]['b']))
    node_edges[sw_].remove(e)
    for x_, y_, mid_, reuse in ((m_, m2, m_, e), (m2, sw_, m2, None)):     # the old piece becomes the first half
        P0, P1 = node_pos[x_], node_pos[y_]; n_ = max(2, int(math.hypot(P1[0] - P0[0], P1[1] - P0[1]) / 10) + 1)
        pts = [(P0[0] + (P1[0] - P0[0]) * i / (n_ - 1), P0[1] + (P1[1] - P0[1]) * i / (n_ - 1)) for i in range(n_)]
        ne_e = dict(a=x_, b=y_, pts=pts, len=plen(pts), way=-1, svc='yard', name='through track', mid=mid_)
        if reuse is not None: edges[reuse] = ne_e; node_edges[m2].append(reuse); continue
        ei = len(edges); edges.append(ne_e); node_edges[x_].append(ei); node_edges[y_].append(ei)
    _router.THROUGH_ALLOWED = {m2}
    if route_nodes(CFG['AFTER_ARR'], m2, via=[sw_]) and route_nodes(m2, SD_OUT_NODE, via=[SD_DEP[1]], first=sw_):
        storage.append((0, m2)); STORE_EXIT[m2] = sw_; STORE_SAME.add(m2); STORE_ARR_FROM[m2] = sw_; STORE_WAY[m2] = STORE_WAY.get(m_, -1); SECOND[li_] = m2
        print('second place on through track', li_, '(D place with two trains): node', m2)
    else: print('second place on through track', li_, 'skipped: no route to it from its own end')
    _router.THROUGH_ALLOWED = set()
storage = [n for _, n in sorted(storage, key=lambda x: x[0])]
_unused = set((json.load(open('rules_%s.json' % LINE.lower())) if os.path.exists('rules_%s.json' % LINE.lower()) else {}).get('depot_unused', {}).get('nodes', []))
if _unused: storage = [n for n in storage if n not in _unused]; print('depot places not used (accantonamento):', sorted(_unused))
print('storage places:', len(storage), 'of which through tracks:', len(STORE_EXIT), '(left by the same end, cambio banco:', len(STORE_SAME), ')', '| depot tracks too short for a train:', too_short, '| marked movements only:', no_park)

# ---------------- path library ----------------
paths, path_key = [], {}
PATH_STATES = {}      # pid -> [(edge, dir)], for speed limits along each path
def make_path(key, states):
    if key in path_key: return path_key[key]
    p = path_poly(states); c = cum(p)
    pid = len(paths); paths.append((p, c)); path_key[key] = pid; PATH_STATES[pid] = list(states); return pid

def fwd_place(n): return n in STORE_EXIT and n not in STORE_SAME          # through track left straight on (forward)
def start_off(n):
    """where the train's centre is at the start of a path from n"""
    if len(node_edges[n]) == 1: return tail_off(n)
    if n in STORE_SAME: return TRAIN_HALF                                     # parked behind the node, leaves backwards
    if fwd_place(n):                                                          # parked behind the node, leaves forwards
        e = next(e for e in node_edges[n] if STORE_ARR_FROM[n] in (edges[e]['a'], edges[e]['b']))
        return edges[e]['len'] - TRAIN_HALF
    return 0
def end_off(n, L):
    """where the train's centre is at the end of a path into n"""
    if len(node_edges[n]) == 1: return L - tail_off(n)
    if n in STORE_EXIT: return L - TRAIN_HALF                                 # a depot place: the nose at the node
    return L
def leg_path(start, via, end):
    key = ('leg', start, tuple(via), end)
    if key in path_key: return path_key[key]
    _router.THROUGH_ALLOWED = {x for x in (start, end) if x in STORE_EXIT}   # ...except its own parking track
    if fwd_place(start):            # parked behind the node: the path starts at the end it came in by, straight through
        st = route_nodes(STORE_ARR_FROM[start], end, via=[start] + list(via), first=start)
    else: st = route_nodes(start, end, via=via, first=STORE_EXIT.get(start))
    _router.THROUGH_ALLOWED = set()
    if st is None: raise RuntimeError('no route %s %s %s' % (start, via, end))
    return make_path(key, st)

# ---------------- trips ----------------
trips = []
for ti, t in enumerate(D['trips']):
    if t[0] != M3: continue
    ts, a = [], 0
    for x in t[3]: a += x; ts.append(a)
    ev = []; last = None
    for tt, s in zip(ts, t[5]):
        if s >= 0: last = s
        ev.append((tt, last))
    ev = add_dwell(ev, dwell=OPS['station_stop_s'])
    first = D['stops'][t[5][0]][0].upper(); out = first.startswith(CFG['home'].upper())
    trips.append(dict(ti=ti, dep=ts[0], arr=ts[-1], out=out, ev=ev))
trips.sort(key=lambda x: x['dep'])

# ---------------- chain trips into trains ----------------
TURN = int(os.environ.get('TURN', OPS['min_turnaround_min'] * 60))      # shortest possible turnaround: unload, into tail, change cab, to platform, board
LAYOVER_DEPOT = int(os.environ.get('LAYOVER', OPS['depot_rest_if_wait_over_min'] * 60))     # a train with more than this to wait at the home terminal rests in the depot
FAR_HORIZON = int(os.environ.get('FAR_HORIZON', 24 * 3600))   # look ahead to the end of the day: never send back a train that will be needed again
far_deps = sorted([tr for tr in trips if not tr['out']], key=lambda x: x['dep'])
far_arrs = sorted([tr['arr'] for tr in trips if tr['out']])
import bisect
def need_far(t):
    """trains that must already be waiting at the far terminal at time t to cover its departures"""
    need, k = 0, 0
    i0 = bisect.bisect_right([d['dep'] for d in far_deps], t)
    for d in far_deps[i0:]:
        if d['dep'] > t + FAR_HORIZON: break
        k += 1
        arrivals_in_time = bisect.bisect_right(far_arrs, d['dep'] - TURN) - bisect.bisect_right(far_arrs, t)
        need = max(need, k - arrivals_in_time)
    return need

trains = []                         # list of list of trips
DEPOT_AFTER, RETIRE = {}, {}        # trip -> goes to depot after it / goes back empty from the far end
pool_home, pool_far, depot = [], [], []     # (arrival time, train)
timeline = sorted([(tr['dep'], 1, tr) for tr in trips] + [(tr['arr'], 0, tr) for tr in trips], key=lambda e: (e[0], e[1]))
last_far_dep = far_deps[-1]['dep']
for t, kind, tr in timeline:
    if kind == 0:                                   # arrival
        k = tr['train']
        if tr['out']:
            pool_far.append((tr['arr'], k))
            FAR_CAP = int(os.environ.get('FAR_CAP', 4))   # 2 tails + arrival + departure platform
            if len(pool_far) > max(need_far(tr['arr']), FAR_CAP - 1):  # only when the terminus is really full
                pool_far.pop(); RETIRE[tr['ti']] = True
                depot.append((tr['arr'] + 45 * 60, k))
        else:
            pool_home.append((tr['arr'], k))
        continue
    # departure
    pool = pool_home if tr['out'] else pool_far
    ready = [x for x in pool if x[0] + TURN <= tr['dep']]
    if ready:
        # home terminal: the train that has just finished its turnaround goes (spares stay for the depot);
        # far terminal: first come, first served
        x = max(ready) if tr['out'] else min(ready); pool.remove(x); k = x[1]
        prev = trains[k][-1]
        if tr['out'] and tr['dep'] - prev['arr'] > LAYOVER_DEPOT: DEPOT_AFTER[prev['ti']] = True
    else:
        lead = 10 * 60 if tr['out'] else 50 * 60
        avail = [x for x in depot if x[0] <= tr['dep'] - lead]
        if avail:
            x = min(avail); depot.remove(x); k = x[1]
        else:
            k = len(trains); trains.append([])
    trains[k].append(tr); tr['train'] = k
# whatever is left: home trains to the depot, far trains go back empty (last two stay overnight)
for _, k in pool_home: DEPOT_AFTER[trains[k][-1]['ti']] = True
for _, k in pool_far: RETIRE[trains[k][-1]['ti']] = True
for c in trains:
    if not c[-1]['out']: DEPOT_AFTER[c[-1]['ti']] = True
far_end = sorted([c for c in trains if c[-1]['out']], key=lambda c: c[-1]['arr'])
NIGHT_COM_END = {c[-1]['train']: tail for c, tail in zip(far_end[-2:][::-1], COM_TAILS)}
far_start = sorted([c for c in trains if not c[0]['out']], key=lambda c: c[0]['dep'])
NIGHT_COM_START = {c[0]['train']: tail for c, tail in zip(far_start[:2], COM_TAILS)}
# Giovanni: at San Donato too one train sleeps in each tail (not every depot track is available)
home_end = sorted([c for c in trains if not c[-1]['out']], key=lambda c: c[-1]['arr'])
NIGHT_SD_END = {c[-1]['train']: tail for c, tail in zip(home_end[-2:][::-1], SD_TAILS)} if LINE == 'M3' else {}
home_start = sorted([c for c in trains if c[0]['out']], key=lambda c: c[0]['dep'])
NIGHT_SD_START = {c[0]['train']: tail for c, tail in zip(home_start[:2], SD_TAILS)} if LINE == 'M3' else {}
for k in NIGHT_SD_END: DEPOT_AFTER.pop(trains[k][-1]['ti'], None)
def after_break(c, j):
    """True when the train is not at the terminal before trip j (start of day or back from depot)"""
    if j == 0: return True
    p = c[j - 1]['ti']; return DEPOT_AFTER.get(p) or RETIRE.get(p)
print('empty runs back from', CFG['far'], 'during the day:', sum(1 for c in trains for tr in c[:-1] if RETIRE.get(tr['ti'])))

# ---------------- allocate tails and platforms (no two trains on one track) ----------------
def allocate(requests, options):
    """requests: list of (start, end, key, allowed options). greedy interval assignment."""
    busy = {o: [] for o in options}; got = {}; clashes = 0
    for s0, s1, key, allowed in sorted(requests, key=lambda r: r[0]):
        free = [o for o in allowed if all(e <= s0 or b >= s1 for b, e in busy[o])]
        if free:
            o = min(free, key=lambda o: max([e for b, e in busy[o]] + [0]))  # least recently used
        else:
            clashes += 1; o = min(allowed, key=lambda o: max([e for b, e in busy[o]] + [0]))
        busy[o].append((s0, s1)); got[key] = o
    return got, clashes

# Terminal model: arrive, passengers off, run into a tail, reverse, then move up to the
# departure platform as soon as it is free and wait there with doors open.
T_IN, T_OUT = 100, 90          # typical platform->tail and tail->platform running times
turns = []                      # (terminal, arrival trip, departure trip)
for chain in trains:
    for j in range(len(chain) - 1):
        a_, b_ = chain[j], chain[j + 1]
        if after_break(chain, j + 1): continue
        turns.append(('COM' if a_['out'] else 'SD', a_, b_))
TE, PLAT_OF, ENTRY, TAIL_OF, PLAT_ARR, PULL_PLAT, EARLY_TAIL = {}, {}, {}, {}, {}, {}, {}
# where a train stops in a tail: by default at the very end; at Comasina the ATO stops it just behind the tail's
# exit signal (Giovanni), to save distance. Value: distance from the tail end to the train's centre.
TAIL_STOP = {}
_rules_ = json.load(open('rules_%s.json' % LINE.lower())) if os.path.exists('rules_%s.json' % LINE.lower()) else {}
def _gone(sg):
    return any(math.hypot((sg['lat'] - la) * 111000, (sg['lon'] - lo) * 78000) < 3 for la, lo in _rules_.get('removed_signals', []))
_all_signals = _rules_.get('signals', [])
# every signal keeps its #A number (its place in the rules, flags and cut points not counted) even when others are removed
# #A numbers are fixed in the rules ('n'); a signal without one (just added with the editor) gets the next free number
_n = max([_sg.get('n', 0) for _sg in _all_signals] + [0])
for _sg in _all_signals:
    if _sg.get('type') in ('nose', 'nose2', 'cut'): continue
    if not _sg.get('n'): _n += 1; _sg['n'] = _n; print('new signal numbered #A%02d' % _n, _sg.get('w'), _sg.get('on_track'))
    _sg['_n'] = _sg['n']
    if not _sg.get('kind'): _sg['kind'] = 'shunt' if _sg.get('type') == 'shunt' else 'atp'      # (drawn on the map)
_rules_['signals'] = [sg for sg in _all_signals if not _gone(sg) and sg.get('type') not in ('cut', 'nose', 'nose2')]
NOSE_FLAGS = [sg for sg in _all_signals if sg.get('type') == 'nose']        # where the nose stops (stations, depot)
# interlocking groups and depot signals name signals by their #A number in rules (1 = first): to indexes after removals
def _sig_index(n):     # #A number (as shown on the map) -> index in the list of signals in use
    return next((i for i, x in enumerate(_rules_['signals']) if x.get('_n') == n), None)
_IL = _rules_.get('interlocking', {})
_side_lon = _IL.get('depot_sides', {}).get('lon')
_sides = [[i for i, sg in enumerate(_rules_['signals']) if sg.get('type') == 'shunt' and (sg['lon'] > _side_lon) == east] for east in (True, False)] if _side_lon else []
# ---- interlocking: one model (web/interlocking.js). Groups, depot sides, manual signals, block sections, zones ----
_ix = lambda ns: [i for i in (_sig_index(n) for n in ns) if i is not None]
_G = [{'name': g.get('name', ''), 'signals': _ix(g['signals']), 'hold': bool(g.get('hold')), 'section': bool(g.get('section'))} for g in _IL.get('groups', [])]
# the depot: one movement at a time on each side (the signal stays given until the train stops or has gone 400 m)
for nm_, g_ in zip(('Deposito lato est: una manovra alla volta', 'Deposito lato ovest: una manovra alla volta'), _sides):
    _G.append({'name': nm_, 'signals': g_, 'hold': True, 'section': True})
_manual = set(_ix(_IL.get('manual', []))) | {i for g_ in _sides for i in g_}      # with the depot on manual the player opens every shunting signal
_section = _manual | {i for g in _G if g['section'] for i in g['signals']}
_Z = [{'name': z['name'], 'entry': _ix(z['entry'])} for z in _IL.get('zones', [])]
_ctl = sorted(_manual | _section | {i for g in _G for i in g['signals']} | {i for z in _Z for i in z['entry']})
INTERLOCKING = {'signals': {str(i): {'n': _rules_['signals'][i]['_n'], 'manual': i in _manual, 'section': i in _section} for i in _ctl},
                'groups': [{k: v for k, v in g.items() if k != 'section'} for g in _G], 'zones': _Z, 'manual': sorted(_manual)}
print('interlocking: %d controlled signals, %d groups, %d zones, %d worked by the player, %d with a block section' % (
    len(_ctl), len(_G), len(_Z), len(_manual), len(_section)))
for _t in (COM_TAILS if CFG.get('tail_at_signal') else []):
    _e = edges[node_edges[_t][0]]; _P = _e['pts'] if _e['b'] == _t else _e['pts'][::-1]; _P = _P[::-1]   # from the tail end
    _best = None
    for _sg in _rules_.get('signals', []):
        if _sg.get('kind') != 'atp' or _sg['w'] != _e['way']: continue
        _x, _y = xy(*_sg['on_track']); _acc = 0
        for _i in range(len(_P) - 1):
            (_ax, _ay), (_bx, _by) = _P[_i], _P[_i + 1]; _dx, _dy = _bx - _ax, _by - _ay; _L2 = _dx * _dx + _dy * _dy
            _u = max(0, min(1, ((_x - _ax) * _dx + (_y - _ay) * _dy) / _L2)) if _L2 else 0
            if math.hypot(_x - _ax - _u * _dx, _y - _ay - _u * _dy) < 4 and (_best is None or _acc + _u * math.sqrt(_L2) > _best):
                _best = _acc + _u * math.sqrt(_L2)
            _acc += math.sqrt(_L2)
    if _best: TAIL_STOP[_t] = max(TRAIN_HALF, _best - TRAIN_HALF - 5)
print('tail stop positions from signals (m from the end):', {k: round(v) for k, v in TAIL_STOP.items()})
def tail_off(n): return TAIL_STOP.get(n, TRAIN_HALF)
# running times measured on the real tracks
def _stop_d(pid, stop):
    p, c = paths[pid]; d, _ = project(p, c, *stop, 0, None); return d, c[-1]
T_IN, T_OUT = {}, {}
for t in SD_TAILS:
    pid = make_path(('in', t), route_nodes(CFG['IN_VIA'][-2], t, via=CFG['IN_VIA'][-1:]))
    d, L = _stop_d(pid, SD_STOP); T_IN[t] = (L - tail_off(t) - d) / V_TAIL
    for pn in CFG['PLATS']:
        pid = leg_path(t, [SD_DEP[pn], SD_OUT_NODE], COM_TAILS[0]); d, L = _stop_d(pid, SD_STOP)
        T_OUT[(t, pn)] = (d - tail_off(t)) / V_TAIL
for t in COM_TAILS:
    pid = leg_path(SD_TAILS[0], [SD_DEP[1], SD_OUT_NODE], t); d, L = _stop_d(pid, COM_STOP)
    T_IN[t] = (L - tail_off(t) - d) / V_TAIL
    pid = leg_path(t, CFG['IN_VIA'], SD_TAILS[0]); d, L = _stop_d(pid, COM_STOP)
    T_OUT[(t, 0)] = (d - tail_off(t)) / V_TAIL
print('tail running times (s):', {k: round(v) for k, v in {**T_IN, **{str(k): v for k, v in T_OUT.items()}}.items()})

INF = 10 ** 9
plat_free = {('COM', 0): 0, **{('SD', p): 0 for p in CFG['PLATS']}}
tail_free = {t: 0 for t in SD_TAILS + COM_TAILS}
TAIL_LOG = collections.defaultdict(list)            # tail -> [(in, out, train)] for checking
TAIL_STAYS = []
# Giovanni: two trains spend the night in the Comasina tail tracks (NIGHT_COM_START / END above)
pulls = [c[j] for c in trains for j in range(len(c)) if c[j]['out'] and after_break(c, j)]
early = [c[j] for c in trains for j in range(len(c)) if not c[j]['out'] and after_break(c, j)]
ends_far = [tr for c in trains for tr in c if tr['out'] and RETIRE.get(tr['ti'])]
events = sorted([(b_['dep'], 0, 'turn', (term, a_, b_)) for term, a_, b_ in turns] +
                [(tr['dep'], 0, 'pull', tr) for tr in pulls] +
                [(tr['dep'], 0, 'early', tr) for tr in early] +
                [(tr['arr'] + 600, 1, 'end', tr) for tr in ends_far] +
                [(trains[k][-1]['arr'] + 600, 1, 'endsd', trains[k][-1]) for k in NIGHT_SD_END], key=lambda e: (e[0], e[1]))
held = late = 0

PREF_WAIT = 120     # a train would rather wait in the tail until ~2 min before departure...
LAST_IN_TAIL = {}   # ...but leaves earlier (and waits on the platform) when the tail is needed
def leave_tail(term, tail, t_tail, dep, key_choices):
    """returns (preferred exit, earliest exit, platform, travel time) for the tail stay"""
    best = None
    for key, tout in key_choices:
        te_min = max(t_tail + REVERSE, plat_free[key])
        if best is None or te_min + tout < best[0] + best[2]: best = (te_min, key, tout)
    te_min, key, tout = best
    te = max(te_min, dep - tout - PREF_WAIT)
    return te, te_min, key, tout

def claim_tail(tail, t_arrive_platform_side):
    """make the previous occupant leave early enough for a train arriving at this time"""
    prev = LAST_IN_TAIL.get(tail)
    if prev is None: return tail_free[tail]
    need = t_arrive_platform_side - 40
    if prev['te'] > need:
        prev['te'] = max(prev['te_min'], need)
        TE[prev['ti']] = prev['te']; PLAT_ARR[prev['ti']] = min(prev['te'] + prev['tout'], prev['dep'] - 30)
    return prev['te'] + 40

def record(tail, ti, te, te_min, tout, dep):
    rec = {'ti': ti, 'te': te, 'te_min': te_min, 'tout': tout, 'dep': dep}
    LAST_IN_TAIL[tail] = rec; TE[ti] = te; PLAT_ARR[ti] = min(te + tout, dep - 30)
    return rec

for _, _, kind, obj in events:
    if kind == 'pull' and obj['train'] in NIGHT_SD_START and trains[obj['train']][0] is obj:
        tail = NIGHT_SD_START[obj['train']]
        te, te_min, key, tout = leave_tail('SD', tail, 0, obj['dep'], [(('SD', p), T_OUT[(tail, p)]) for p in CFG['PLATS']])
        PLAT_OF[obj['ti']] = key[1]
        rec = record(tail, obj['ti'], te, te_min, tout, obj['dep']); rec['log'] = (0, obj['train']); TAIL_STAYS.append((tail, rec))
        tail_free[tail] = te + 40; plat_free[key] = obj['dep'] + 20; continue
    if kind == 'pull':
        tp = max(obj['dep'] - PLAT_WAIT, plat_free[('SD', 1)])
        PULL_PLAT[obj['ti']] = min(tp, obj['dep'] - 30); PLAT_OF[obj['ti']] = 1
        plat_free[('SD', 1)] = obj['dep'] + 20; continue
    if kind == 'early':
        k = obj['train']
        if k in NIGHT_COM_START and trains[k][0] is obj:
            tail = NIGHT_COM_START[k]; t_tail = 0
        else:
            tail = min(COM_TAILS, key=lambda t: tail_free[t])
            t_tail = max(tail_free[tail], obj['dep'] - 900)
        te, te_min, key, tout = leave_tail('COM', tail, t_tail, obj['dep'], [(('COM', 0), T_OUT[(tail, 0)])])
        EARLY_TAIL[obj['ti']] = (tail, t_tail)
        rec = None
        rec = record(tail, obj['ti'], te, te_min, tout, obj['dep']); rec['log'] = (t_tail, k); TAIL_STAYS.append((tail, rec))
        tail_free[tail] = te + 40; plat_free[key] = obj['dep'] + 20
        continue
    if kind == 'endsd':
        k = obj['train']; tail = NIGHT_SD_END[k]
        for t in SD_TAILS:
            if LAST_IN_TAIL.get(t): tail_free[t] = min(tail_free[t], claim_tail(t, obj['arr'] + DWELL_END))
        entry = max(obj['arr'] + DWELL_END, tail_free[tail]); held += entry > obj['arr'] + DWELL_END + 5
        ENTRY[obj['ti']] = entry; TAIL_OF[obj['ti']] = tail
        TAIL_LOG[tail].append((entry, INF, k)); tail_free[tail] = INF; LAST_IN_TAIL.pop(tail, None)
        continue
    if kind == 'end':
        k = obj['train']; night = k in NIGHT_COM_END and trains[k][-1] is obj
        for t in COM_TAILS:
            if LAST_IN_TAIL.get(t): tail_free[t] = min(tail_free[t], claim_tail(t, obj['arr'] + DWELL_END))
        tail = NIGHT_COM_END[k] if night else min(COM_TAILS, key=lambda t: tail_free[t])
        entry = max(obj['arr'] + DWELL_END, tail_free[tail]); held += entry > obj['arr'] + DWELL_END + 5
        ENTRY[obj['ti']] = entry; TAIL_OF[obj['ti']] = tail
        if night: TAIL_LOG[tail].append((entry, INF, k)); tail_free[tail] = INF; LAST_IN_TAIL.pop(tail, None)
        else:
            out_t = entry + T_IN[tail] + REVERSE; TE[('end', obj['ti'])] = out_t
            TAIL_LOG[tail].append((entry, out_t, k)); tail_free[tail] = out_t + 40; LAST_IN_TAIL.pop(tail, None)
        continue
    term, a_, b_ = obj
    tails = COM_TAILS if term == 'COM' else SD_TAILS
    want = a_['arr'] + DWELL_END
    for t in tails: tail_free[t] = min(tail_free[t], claim_tail(t, want)) if LAST_IN_TAIL.get(t) else tail_free[t]
    tail = min(tails, key=lambda t: tail_free[t])
    entry = max(want, tail_free[tail])        # waits on the arrival platform if needed
    if entry > a_['arr'] + DWELL_END + 5: held += 1
    t_tail = entry + T_IN[tail]
    if term == 'COM': choices = [(('COM', 0), T_OUT[(tail, 0)])]
    else: choices = [(('SD', p), T_OUT[(tail, p)]) for p in CFG['PLATS']]
    te, te_min, key, tout = leave_tail(term, tail, t_tail, b_['dep'], choices)
    if term == 'SD': PLAT_OF[b_['ti']] = key[1]
    ENTRY[a_['ti']] = entry; TAIL_OF[a_['ti']] = tail
    rec = record(tail, b_['ti'], te, te_min, tout, b_['dep']); rec['log'] = (entry, a_['train'])
    TAIL_STAYS.append((tail, rec))
    tail_free[tail] = te + 40; plat_free[key] = b_['dep'] + 20
# check: never two trains in one dead-end track; count late departures
for tail, rec in TAIL_STAYS: TAIL_LOG[tail].append((rec['log'][0], rec['te'], rec['log'][1]))
late = sum(1 for tail, rec in TAIL_STAYS if rec['te'] + rec['tout'] > rec['dep'] - 30)
clash = 0
for t, log in TAIL_LOG.items():
    log.sort()
    for x, y in zip(log, log[1:]):
        if y[0] < x[1]: clash += 1
print('tail clashes:', clash, '| held on arrival platform for a free tail:', held, '| departures that would be late:', late)
SD_TAIL_OF = COM_TAIL_OF = TAIL_OF

# ---------------- timeline builder ----------------
class TL:
    def __init__(s, k): s.k = k; s.segs = []; s.pos = None
    def add(s, pid, status, ts, ds, trip=-1):
        s.segs.append([pid, status, trip, [round(x) for x in ts], [round(x, 1) for x in ds]])
        s.pos = (pid, ds[-1])

def move(tl, pid, d0, d1, t0, v, status):
    t1 = t0 + abs(d1 - d0) / v
    tl.add(pid, status, [t0, t1], [d0, d1]); return t1

# where the nose stops at a station (Giovanni): at a "nose" flag if one is placed there, otherwise almost touching the
# station signal (an ATP signal just beyond the platform end, facing the train). Without either, the train stops
# centred on the station point from the timetable.
_STOPMARK = [sg for sg in NOSE_FLAGS + _rules_.get('signals', []) if sg.get('line', LINE) == LINE and (sg.get('type') == 'nose' or sg.get('kind') == 'atp')]
NOSE_GAP = 3.0                       # metres between the nose and the signal
_marks_cache = {}
def stop_marks(pid):
    """Flags and signals that lie on this path and face its direction of travel: [(d, 'nose'|'atp')]."""
    if pid in _marks_cache: return _marks_cache[pid]
    p, c = paths[pid]; out = []
    for sg in _STOPMARK:
        x, y = xy(*sg['on_track']); best = None
        for i in range(len(p) - 1):
            (ax, ay), (bx, by) = p[i], p[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            if not L2: continue
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); e = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if e < 1.8 and (best is None or e < best[0]):
                brg = math.degrees(math.atan2(dx, dy)) % 360
                best = (e, c[i] + u * (c[i + 1] - c[i]), brg)
        if best and abs((best[2] - sg.get('heading', best[2]) + 180) % 360 - 180) < 60:
            out.append((best[1], 'nose' if sg.get('type') == 'nose' else 'atp'))
    _marks_cache[pid] = sorted(out); return _marks_cache[pid]
NOSE_LOG = {}
def nose_stop(pid, d, name, lo, hi):
    """Move a stop so the nose is at the flag / station signal. lo..hi: where the train's centre may be."""
    m = stop_marks(pid)
    flags = [x for x, k in m if k == 'nose' and abs(x - TRAIN_HALF - d) < 150]
    if flags: nd = min(flags, key=lambda x: abs(x - TRAIN_HALF - d)) - TRAIN_HALF
    else:
        sigs = [x for x, k in m if k == 'atp' and d + TRAIN_HALF - 25 <= x <= d + TRAIN_HALF + 40]
        if not sigs: return d
        nd = min(sigs) - TRAIN_HALF - NOSE_GAP
    nd = max(lo, min(hi, nd))
    NOSE_LOG.setdefault(name, set()).add(round(nd - d))
    return nd

def service_leg(tl, start, via, end, trip, t_leave, plat_stop, end_stop, approach_status, t_plat_arr=None):
    """One leg from a reversal point through a full passenger trip to the next reversal point."""
    pid = leg_path(start, via, end); p, c = paths[pid]
    L = c[-1]
    d_start = start_off(start)
    d_end = end_off(end, L)
    # project passenger stops
    ds, last_d = [], d_start
    for tt, s in trip['ev']:
        name, la, lo = D['stops'][s]
        if s == trip['ev'][0][1]: la, lo = plat_stop
        elif s == trip['ev'][-1][1]: la, lo = end_stop
        d, _ = project(p, c, la, lo, last_d, 3000)
        d = max(d, last_d)
        if CFG.get('nose_stop'): d = nose_stop(pid, d, name, last_d, d_end)
        ds.append(d); last_d = d
    t_dep = trip['ev'][0][0]
    if t_plat_arr is None:
        t_plat_arr = t_dep - 30
    # approach from reversal point to the departure platform
    tl.add(pid, approach_status, [t_leave, t_plat_arr], [d_start, ds[0]])
    tl.add(pid, 'service', [t_plat_arr] + [e[0] for e in trip['ev']], [ds[0]] + ds, trip['ti'])
    if tl.k >= 0:                      # station boards: when this train reaches each platform
        direction = CFG['far'] if trip['out'] else CFG['home']
        seen_stop = set()
        for i, (tt, s_) in enumerate(trip['ev']):
            if s_ in seen_stop: continue
            seen_stop.add(s_)
            BOARD[station_key(D['stops'][s_][0])][direction].append(round(t_plat_arr if i == 0 else tt))
    t_arr = trip['ev'][-1][0]
    return pid, ds[-1], d_end, t_arr

DWELL_MIN, DWELL_MAX = OPS['platform_wait_min_s'], OPS['platform_wait_max_s']   # Giovanni: trains wait 30 s to 2 min at the departure platform
def when_leave(t_in_tail, tr, d_pl):
    """Leave the tail so the train sits at the platform as long as possible (up to 2 min)
    without ever departing late; never less than 30 s if it can be helped."""
    approach = (d_pl - TRAIN_HALF) / V_YARD
    t_leave = max(t_in_tail + REVERSE, TE.get(tr['ti'], 0), tr['dep'] - approach - DWELL_MAX)
    t_plat = t_leave + approach
    if t_plat > tr['dep'] - DWELL_MIN:
        t_plat = max(tr['dep'] - DWELL_MIN, t_leave + 25)   # drive in a little quicker
    return t_leave, t_plat

ALTS = collections.defaultdict(list)
BOARD = collections.defaultdict(lambda: collections.defaultdict(list))
def station_key(name):
    return name.upper().replace(' ' + LINE, '').strip()
# ---- parking places: one per depot stay, never two trains on one track ----
STORE_BEFORE, STORE_AFTER = {}, {}
stays = []                                   # (start, end, key_after, key_before)
for k, c in enumerate(trains):
    def leave_at(tr): return tr['dep'] - (75 * 60 if not tr['out'] else 12 * 60)
    if k not in NIGHT_COM_START and k not in NIGHT_SD_START: stays.append((0, leave_at(c[0]), None, c[0]['ti']))
    for j, tr in enumerate(c):
        if DEPOT_AFTER.get(tr['ti']) or (RETIRE.get(tr['ti']) and not (j == len(c) - 1 and k in NIGHT_COM_END)):
            arrive = tr['arr'] + (5 * 60 if not tr['out'] else 40 * 60)
            nxt = c[j + 1] if j + 1 < len(c) else None
            stays.append((arrive, leave_at(nxt) if nxt else INF, tr['ti'], nxt['ti'] if nxt else None))
place_free = {p: -1 for p in storage}
pref = sorted(storage, key=lambda p: (p not in STORE_EXIT, storage.index(p)))
shared = 0
for s0, s1, after, before in sorted(stays, key=lambda x: x[0]):
    free = [p for p in pref if place_free[p] <= s0]
    if free: p = free[0]
    else: p = min(pref, key=lambda q: place_free[q]); shared += 1
    place_free[p] = s1
    if after is not None: STORE_AFTER[after] = p
    if before is not None: STORE_BEFORE[before] = p
print('depot stays', len(stays), '| a track shared at the same time:', shared)
def platform_alternatives(tl, seg0, start, ctail, tr, t_leave, t_plat, chosen):
    """Store the same departure via every San Donato platform so the page can switch it."""
    if len(CFG['PLATS']) < 2: return
    opts = {}
    for pn in CFG['PLATS']:
        if pn == chosen: continue
        tmp = TL(-1)
        service_leg(tmp, start, [SD_DEP[pn], SD_OUT_NODE], ctail, tr, t_leave, SD_STOP, COM_STOP, 'turnback', t_plat)
        opts[str(pn)] = tmp.segs
    opts[str(chosen)] = [list(x) for x in tl.segs[seg0:seg0 + 2]]
    ALTS[tl.k].append({'i': seg0, 'n': 2, 'plat': chosen, 'opts': opts, 'from': round(t_plat), 'dep': tr['dep'], 'leave': round(t_leave)})

ARR2 = collections.defaultdict(list)
def arrive_p2(tl, pd, nxt, ctail2):
    """Player order: the train from Rogoredo runs into platform 2 instead of 3 and reverses there
    (no tail). Replaces its arrival, the tail visit and the next departure."""
    a = CFG['ARR2']; tr = pd['tr']; tmp = TL(-1)
    saved = {w: ONEWAY.pop(w) for w in a['lift'] if w in ONEWAY}   # platform 2 run the wrong way, on order only
    try:
        pidA, dA, _, tA = service_leg(tmp, pd['ctail'], a['via'], a['end'], tr, pd['t_leave'], COM_STOP, SD_STOP, 'turnback', pd['t_plat'])
    except RuntimeError as e:
        print('ARR2 route', e); return
    finally:
        ONEWAY.update(saved)
    t_ready = tA + DWELL_END + REVERSE                  # passengers off, driver changes cab
    if nxt['dep'] - 30 < t_ready: return                # not enough time to reverse in place
    t_board = max(t_ready, nxt['dep'] - DWELL_MAX)
    tmp.add(pidA, 'turnback', [tA, t_ready], [dA, dA])
    tmpB = TL(-1)
    pidB, dB_arr, dB_end, tB = service_leg(tmpB, a['end'], [SD_OUT_NODE], ctail2, nxt, t_ready, SD_STOP, COM_STOP, 'turnback', t_board)
    appr, serv = tmpB.segs
    d0 = serv[4][0]; appr[4] = [d0, d0]                 # it is already standing at the platform
    last = tl.segs[-1]                                  # the run into the Comasina tail keeps its times
    tail_move = [pidB, last[1], -1, list(last[3]), [round(dB_arr, 1), round(dB_end, 1)]]
    rog = max(tt for tt, s_ in tr['ev'] if 'ROGOREDO' in D['stops'][s_][0].upper())
    ARR2[tl.k].append({'i': pd['i'], 'n': len(tl.segs) - pd['i'], 'segs': tmp.segs + [appr, serv, tail_move],
                       'open': round(rog), 'close': round(tA - 40), 'from': round(tA), 'dep': nxt['dep'], 'arr': round(tA)})

CALTS = collections.defaultdict(list)
def tail_alternative(tl, cp, tr_in, end_in, via_in, t_leave_in, t_plat_in, go_depot):
    """The same turnaround at Comasina through the other tail track (the player can choose it)."""
    i0 = cp['seg0']; n = len(tl.segs) - i0
    orig = [list(x) for x in tl.segs[i0:]]
    opts = {str(cp['tail']): orig}
    for t2 in COM_TAILS:
        if t2 == cp['tail']: continue
        tmp = TL(-1)
        try:
            pid2, d_arr2, _, _ = service_leg(tmp, cp['start'], cp['via'], t2, cp['tr'], cp['t_leave'], SD_STOP, COM_STOP, cp['status'], cp['t_plat'])
            if cp['store'] is not None: tmp.segs[-2].append(cp['store'])
            move(tmp, pid2, d_arr2, paths[pid2][1][-1] - tail_off(t2), cp['t_move'], V_TAIL, 'turnback')
            pid3, d_arr3, d_end3, _ = service_leg(tmp, t2, via_in, end_in, tr_in, t_leave_in, COM_STOP, SD_STOP, 'turnback', t_plat_in)
        except RuntimeError:
            continue
        last = orig[-1]                                   # the run after the arrival at San Donato keeps its times
        tmp.segs.append([pid3, last[1], last[2], list(last[3]), [round(d_arr3, 1), round(d_end3, 1)], *last[5:]])
        if len(tmp.segs) != n: continue
        opts[str(t2)] = tmp.segs
    if len(opts) > 1:
        CALTS[tl.k].append({'i': i0, 'n': n, 'tail': cp['tail'], 'opts': opts, 'open': cp['tr']['dep'], 'close': round(cp['t_arr'] - 60),
                            'arr': round(cp['t_move']), 'leave': round(t_leave_in), 'names': {str(t): j + 1 for j, t in enumerate(COM_TAILS)}})

out = []
pending = None
com_pending = None
for k, chain in enumerate(trains):
    tl = TL(k)
    sd_tail_i = k % 3; com_tail_i = k % 2; plat = 1 + (k % 2)
    # where the train is before its first trip
    loc = ('depot', STORE_BEFORE.get(chain[0]['ti'], storage[0]))
    first = chain[0]
    start_where = 'depot'; end_where = 'depot'
    if k in NIGHT_COM_START:
        loc = ('com', NIGHT_COM_START[k], 0); start_where = CFG['far']
    if k in NIGHT_SD_START:
        loc = ('sd', NIGHT_SD_START[k], 0); start_where = CFG['home']
    for j, tr in enumerate(chain):
        nxt = chain[j + 1] if j + 1 < len(chain) else None
        if tr['out']:
            ctail = COM_TAIL_OF.get(tr['ti'], COM_TAILS[com_tail_i]); com_tail_i ^= 1
            if loc[0] == 'depot':
                # pull out: depot -> platform 1 in 5 min, wait 2 min, depart
                start = STORE_BEFORE.get(tr['ti'], loc[1]); via = [SD_DEP[1], SD_OUT_NODE]
                pid0 = leg_path(start, via, ctail); d_pl, _ = project(paths[pid0][0], paths[pid0][1], *SD_STOP, 0, None)
                d0 = start_off(start)
                run = max(PULL_OUT if LINE == 'M4' else 0, (d_pl - d0) / V_YARD)     # M3: at 15 km/h all the way
                t_plat = PULL_PLAT[tr['ti']]; t_leave = t_plat - run
                com_seg0 = len(tl.segs)
                pid, d_arr, d_end, t_arr = service_leg(tl, start, via, ctail, tr, t_leave, SD_STOP, COM_STOP, 'from_depot', t_plat)
                tl.segs[-2].append(start)
                com_leg = dict(seg0=com_seg0, start=start, via=via, tr=tr, t_leave=t_leave, t_plat=t_plat, status='from_depot', store=start)
            else:
                start = loc[1]; p_no = PLAT_OF.get(tr['ti'], 1)
                via = [SD_DEP[p_no], SD_OUT_NODE]
                t_leave, t_plat = TE[tr['ti']], PLAT_ARR[tr['ti']]
                seg0 = len(tl.segs)
                pid, d_arr, d_end, t_arr = service_leg(tl, start, via, ctail, tr, t_leave, SD_STOP, COM_STOP, 'turnback', t_plat)
                platform_alternatives(tl, seg0, start, ctail, tr, t_leave, t_plat, p_no)
                com_leg = dict(seg0=seg0, start=start, via=via, tr=tr, t_leave=t_leave, t_plat=t_plat, status='turnback', store=None)
            # terminus: passengers off, run into the tail
            ctail = TAIL_OF.get(tr['ti'], ctail)
            pid = leg_path(start, via, ctail); d_end = paths[pid][1][-1] - tail_off(ctail)
            t_end = move(tl, pid, d_arr, d_end, ENTRY.get(tr['ti'], t_arr + DWELL_END), V_TAIL, 'turnback')
            com_leg.update(tail=ctail, t_move=ENTRY.get(tr['ti'], t_arr + DWELL_END), t_arr=t_arr)
            com_pending = None if RETIRE.get(tr['ti']) else com_leg
            if pending and loc[0] == 'sd':
                arrive_p2(tl, pending, tr, ctail)
            pending = None
            loc = ('com', ctail, t_end)
            if RETIRE.get(tr['ti']):
                if nxt is None and k in NIGHT_COM_END:
                    end_where = CFG['far']                     # sleeps in the tail
                else:                                          # not needed here: back to the depot empty
                    store = STORE_AFTER[tr['ti']]
                    pidE = leg_path(ctail, CFG['DEPOT_IN_VIA'], store); cE = paths[pidE][1]
                    d0, d1 = tail_off(ctail), cE[-1] - TRAIN_HALF
                    t0 = TE.get(('end', tr['ti']), t_end + REVERSE)
                    t1 = t0 + (d1 - d0 - 900) / V_EMPTY
                    tl.add(pidE, 'empty', [t0, t1, t1 + 900 / V_YARD], [d0, d1 - 900, d1]); tl.segs[-1].append(store)
                    loc = ('depot', store)
        else:
            # leaving Comasina tail (or arriving from depot by empty run)
            if loc[0] == 'depot':
                # early train: empty run from the depot to Comasina tail first
                ctail, t_ready = EARLY_TAIL[tr['ti']]
                pidE = leg_path(STORE_BEFORE.get(tr['ti'], loc[1]), [SD_DEP[1], SD_OUT_NODE], ctail); cE = paths[pidE][1]
                LE = cE[-1]; d0, d1 = start_off(STORE_BEFORE.get(tr['ti'], loc[1])), LE - tail_off(ctail)
                t0 = t_ready - (d1 - d0) / V_EMPTY - 90 - EMPTY_MARGIN    # leave early: on the way it may wait behind passenger trains
                tl.add(pidE, 'empty', [t0, t0 + 90, t_ready], [d0, d0 + 200, d1]); tl.segs[-1].append(STORE_BEFORE.get(tr['ti'], loc[1]))
                loc = ('com', ctail, t_ready)
            ctail = loc[1]
            if loc[0] != 'com' or len(loc) < 3: com_pending = None
            go_depot = bool(DEPOT_AFTER.get(tr['ti']))
            if nxt is None and k in NIGHT_SD_END:
                end = NIGHT_SD_END[k]; via = CFG['IN_VIA']; end_where = CFG['home']
            elif go_depot:
                end = STORE_AFTER[tr['ti']]; via = CFG['DEPOT_IN_VIA']
            else:
                end = SD_TAIL_OF[tr['ti']]
                via = CFG['IN_VIA']
            t_leave, t_plat = TE[tr['ti']], PLAT_ARR[tr['ti']]
            seg_in0 = len(tl.segs)
            pid, d_arr, d_end, t_arr = service_leg(tl, ctail, via, end, tr, t_leave, COM_STOP, SD_STOP, 'turnback', t_plat)
            pending = None
            if CFG.get('ARR2') and not go_depot and nxt is not None and nxt['out'] and not (nxt is None and k in NIGHT_SD_END):
                pending = dict(i=seg_in0, tr=tr, ctail=ctail, t_leave=t_leave, t_plat=t_plat)
            if go_depot:
                t_end = move(tl, pid, d_arr, d_end, t_arr + DWELL_END, V_YARD, 'to_depot'); tl.segs[-1].append(end)
                loc = ('depot', end)
                # midday layover: comes back out later from the depot (handled by next OUT trip)
            else:
                t_end = move(tl, pid, d_arr, d_end, ENTRY.get(tr['ti'], t_arr + DWELL_END), V_TAIL, 'turnback')
                loc = ('sd', end, t_end)
            if com_pending and CFG.get('com_choice'):
                tail_alternative(tl, com_pending, tr, end, via, t_leave, t_plat, go_depot)
            com_pending = None
    tl.start_where, tl.end_where = start_where, end_where
    out.append(tl)

if CFG['training']:
    # ---------------- driver training on the anello di prova ----------------
    loop_states = None
    r1 = route_nodes(78, 78, via=[157, 144, 145, 162])
    cyc = route_nodes(157, 157, via=[144, 145, 162, 78])
    # Giovanni decides when an idle train goes round the test loop: routes from every depot track
    # the loop path goes round twice: a train between two test stops (or across #A95's junction at 157) is always on it
    # in one piece, never past its ends (Giovanni 28 Oct: trains were drawn bent at the seam). Laps run from stop to stop.
    _lap1 = make_path(('cycle1',), cyc); _L1 = paths[_lap1][1][-1]
    pcy = make_path(('cycle',), cyc + cyc)
    _CYC_E = {ei for ei, _ in cyc}                    # all of it is the loop's own track (also the 19 m piece 157-144)
    TEST = {'cycle': pcy, 'lap': round(_L1, 1), 'v_lap': 8.0, 'v_yard': V_YARD, 'reverse': REVERSE, 'cyclic': True,
            'acc': OPS['acceleration_ms2'], 'brk': OPS['braking_ms2'],
            'v_run': (OPS.get('line_max_kmh', 80) - OPS.get('curve_minus_kmh', 0)) / 3.6, 'dwell': 15}
    _solo = [u['node'] for u in getattr(__import__('fleet_' + LINE.lower()), 'SOLO', [])] if LINE == 'M3' else []
    # ---- the way to the loop as Giovanni describes it (28 Oct): every train asks at #A94 to go in (one train at a time);
    # west side: to #A94, change cab, ask; middle (#A93-#A75): to #A94 and ask; east side (#A48-#A65): change cab at
    # the turning point on w71 (east of the red line), then through #A93 to #A94 and ask. Back: out by #A96, stop
    # beyond #A94, a place is given, on (straight or after a change of cab) to it.
    _sig = {s_['_n']: s_ for s_ in _rules_['signals'] if s_.get('_n')}
    _A94 = _sig.get(94)
    _TURN71 = _rules_.get('loop_turn')
    def _proj(pid, x, y):
        p_, c_ = paths[pid]; best = None
        for i in range(len(p_) - 1):
            (a1, b1), (a2, b2) = p_[i], p_[i + 1]; dx, dy = a2 - a1, b2 - b1; L2 = dx * dx + dy * dy
            if not L2: continue
            u = max(0, min(1, ((x - a1) * dx + (y - b1) * dy) / L2)); e = math.hypot(x - a1 - u * dx, y - b1 - u * dy)
            if best is None or e < best[0]: best = (e, c_[i] + u * math.sqrt(L2), math.degrees(math.atan2(dx, dy)) % 360)
        return best
    def _pt(pid, d):
        p_, c_ = paths[pid]; i = max(0, min(bisect.bisect_right(c_, d) - 1, len(c_) - 2)); f = (d - c_[i]) / ((c_[i + 1] - c_[i]) or 1)
        return p_[i][0] + (p_[i + 1][0] - p_[i][0]) * f, p_[i][1] + (p_[i + 1][1] - p_[i][1]) * f
    def _passes_a94(pid):
        if not _A94: return True
        b_ = _proj(pid, *xy(*_A94['on_track'])); return b_ and b_[0] < 3 and abs((b_[2] - _A94['heading'] + 180) % 360 - 180) < 60
    def _turn(pid1, d1, pid2):
        """the train standing with its centre at d1 on pid1, on pid2 (after a change of cab): its centre there, if it
        stands on the same track (both ends match), else None"""
        ends = [_proj(pid2, *_pt(pid1, d1 + k_ * TRAIN_HALF)) for k_ in (-1, 0, 1)]
        if any(e_ is None or e_[0] > 1.5 for e_ in ends): return None
        return ends[1][1]
    _mk = lambda key, st: make_path(key, st)
    def _start(p_):        # the path out of place p_ and the train's centre on it
        if fwd_place(p_): return STORE_ARR_FROM[p_], [p_], p_
        return p_, [], STORE_EXIT.get(p_)
    def loop_trip(p_):
        _router.THROUGH_ALLOWED = {p_} if p_ in STORE_EXIT else set()
        a_, v_, f_ = _start(p_); legs = None
        r = route_nodes(a_, 157, via=v_, first=f_)
        if r:
            pid = _mk(('ltrip', p_, 'd'), r)
            if _passes_a94(pid): legs = [[pid, start_off(p_), paths[pid][1][-1], 0]]
        if legs is None:                 # one change of cab: beyond #A94 (west side) or at the w71 turning point (east side)
            cands = [8, 9, 6, 23]
            for X in cands:
                r1 = route_nodes(a_, X, via=v_, first=f_); r2 = route_nodes(X, 157, via=[7]) if X != 7 else None
                if not r1 or not r2: continue
                p1, p2 = _mk(('ltrip', p_, 1, X), r1), _mk(('ltrip', p_, 2, X), r2)
                if not _passes_a94(p2): continue
                d1 = paths[p1][1][-1] - TRAIN_HALF; d2 = _turn(p1, d1, p2)
                if d2 is None: continue
                legs = [[p1, start_off(p_), d1, 1], [p2, d2, paths[p2][1][-1], 0]]; break
        if legs is None and _TURN71:
            tx, ty = xy(*_TURN71['on_track'])
            for X in (154, 114, 115, 43, 42):
                if X not in node_pos: continue
                r1 = route_nodes(a_, X, via=v_, first=f_); r2 = route_nodes(X, 157, via=[8, 7])
                if not r1 or not r2: continue
                p1, p2 = _mk(('ltrip', p_, 1, X), r1), _mk(('ltrip', p_, 2, X), r2)
                b1 = _proj(p1, tx, ty)
                if not b1 or b1[0] > 4 or not _passes_a94(p2): continue
                d1 = b1[1] + TRAIN_HALF + 3                     # the whole train past the turning point
                if d1 > paths[p1][1][-1]: continue
                d2 = _turn(p1, d1, p2)
                if d2 is None: continue
                legs = [[p1, start_off(p_), d1, 1], [p2, d2, paths[p2][1][-1], 0]]; break
        _router.THROUGH_ALLOWED = set()
        return legs
    TEST['trip'] = {}; _no = []
    for p_ in storage + _solo:
        L_ = loop_trip(p_)
        if not L_: _no.append(p_); continue
        # the stop in front of #A94 on the last leg, where the train asks to go in (its centre; None: it asks where it
        # stands, right after its change of cab beyond #A94)
        pl_, s_, e_, _r = L_[-1]; b_ = _proj(pl_, *xy(*_A94['on_track'])) if _A94 else None
        _w = _rules_.get('loop_wait'); _bw = _proj(pl_, *xy(*_w['on_track'])) if _w else None
        if _bw and _bw[0] < 3: gate = _bw[1] - TRAIN_HALF                      # its nose at Giovanni's flag in front of #A94
        else: gate = b_[1] - TRAIN_HALF - 8 if b_ else None
        if gate is not None and gate <= s_ + 2: gate = None
        TEST['trip'][str(p_)] = {'legs': [[a, round(b, 1), round(c, 1), d] for a, b, c, d in L_], 'gate': round(gate, 1) if gate else None}
    # back: from the loop out by #A96, the train stops beyond #A94 (its rear past node 8's switch), there it gets a place
    # and goes on to it: straight on, after a change of cab, or (east side) after a change of cab and a second one at
    # the w71 turning point
    # out of the loop by #A96 and through the junction onto the w72 track (not the w1 track where the next train waits
    # at #A94): it stops with its rear past the switch at node 94, then goes on to its place
    r_ret = route_nodes(157, 31, via=[94], first=78)
    print('loop exit:', [(_e, _dd) for _e, _dd in r_ret] if r_ret else None)
    TEST['ret'] = None; TEST['home'] = {}
    def home_legs(pr, dr, q_):
        _router.THROUGH_ALLOWED = {q_} if q_ in STORE_EXIT else set()
        try:
            sx, sy = _pt(pr, dr)
            cont = lambda r_: r_ret + r_ if r_ and r_[0][0] != r_ret[-1][0] else None   # straight on from the stop
            r = cont(route_nodes(31, q_))
            if r:
                ph = make_path(('lhome', q_, 's'), r); return [[ph, 0, end_off(q_, paths[ph][1][-1]), 0]]   # from the loop, no stop
            r = route_nodes(31, q_, first=94)                       # change of cab beyond #A94 (back the way it came)
            if r:
                ph = make_path(('lhome', q_, 'r'), r); d_ = _turn(pr, dr, ph)
                if d_ is not None: return [[ph, d_, end_off(q_, paths[ph][1][-1]), 0]]
            if _TURN71:                                              # change of cab, then again at the w71 turning point
                tx, ty = xy(*_TURN71['on_track'])
                for X in (154, 114, 115, 43, 42):
                    r1 = cont(route_nodes(31, X)) or route_nodes(31, X, first=94); r2 = route_nodes(X, q_)
                    if not r1 or not r2: continue
                    if r1[:len(r_ret)] == r_ret: p1 = make_path(('lhome', q_, '1s', X), r1); d0 = 0
                    else: p1 = make_path(('lhome', q_, 1, X), r1); d0 = _turn(pr, dr, p1)
                    p2 = make_path(('lhome', q_, 2, X), r2); b1 = _proj(p1, tx, ty)
                    if d0 is None or not b1 or b1[0] > 4: continue
                    d1 = b1[1] + TRAIN_HALF + 3
                    if d1 > paths[p1][1][-1]: continue
                    d2 = _turn(p1, d1, p2)
                    if d2 is None: continue
                    return [[p1, d0, d1, 1], [p2, d2, end_off(q_, paths[p2][1][-1]), 0]]
            return None
        finally:
            _router.THROUGH_ALLOWED = set()
    _nohome = []
    if r_ret:
        pr = make_path(('lret',), r_ret)
        _d94 = None; _acc = 0.0
        for _e, _dd in r_ret:
            if start_node(_e, _dd) == 94: _d94 = _acc; break
            _acc += plen(path_poly([(_e, _dd)]))
        dr = min(paths[pr][1][-1] - TRAIN_HALF, (_d94 if _d94 is not None else paths[pr][1][-1]) + TRAIN_HALF + 15)
        _x = _rules_.get('loop_exit_stop'); _bx = _proj(pr, *xy(*_x['on_track'])) if _x else None
        if _bx and _bx[0] < 3: dr = _bx[1] + TRAIN_HALF          # the trains that turn back: their tail end at Giovanni's flag past #A95
        print('loop exit stop: flag', _bx and (round(_bx[0], 1), round(_bx[1])), '| d94', _d94 and round(_d94), '| stop centre', round(dr))
        TEST['free_at'] = round(dr, 1)                           # the loop is free when the tail of the train is past here
        TEST['ret'] = [pr, 0, round(dr, 1)]
        for q_ in storage + _solo:
            L_ = home_legs(pr, dr, q_)
            if L_: TEST['home'][str(q_)] = {'legs': [[a, round(b, 1), round(c, 1), d] for a, b, c, d in L_], 'straight': L_[0][1] == 0}
            else: _nohome.append(q_)
    print('test loop trips (Giovanni\'s way in by #A94):', len(TEST['trip']), 'places | no way for', _no, '| way back to', len(TEST['home']), 'places, not to', _nohome)
    # test platforms (fermate di prova): 110 m of platform ending at each stopping-point signal on the loop
    TEST['platforms'] = []; TEST['stops'] = []
    _pp, _pc = paths[_lap1]
    for sg in _rules_.get('signals', []):
        if (sg.get('type') != 'stop' and not sg.get('test_stop')) or sg.get('line', LINE) != LINE: continue
        x0, y0 = xy(*(sg.get('on_track') or (sg['lat'], sg['lon']))); best = None
        for i in range(len(_pp) - 1):
            (ax, ay), (bx, by) = _pp[i], _pp[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            if not L2: continue
            u = max(0, min(1, ((x0 - ax) * dx + (y0 - ay) * dy) / L2)); e = math.hypot(x0 - ax - u * dx, y0 - ay - u * dy)
            if best is None or e < best[0]: best = (e, _pc[i] + u * (_pc[i + 1] - _pc[i]), math.degrees(math.atan2(dx, dy)) % 360)
        if not best or best[0] > 5: continue
        same = abs((best[2] - sg.get('heading', best[2]) + 180) % 360 - 180) < 90      # the loop is run the signal's way?
        d1 = best[1]; d0 = d1 - 110 if same else d1 + 110; side = -1 if sg.get('side') == 'left' else 1; pts_ = []
        for k_ in range(23):
            d_ = d0 + (d1 - d0) * k_ / 22; d_ %= _pc[-1]
            i = max(0, next((j for j in range(1, len(_pc)) if _pc[j] >= d_), len(_pc) - 1) - 1)
            f = (d_ - _pc[i]) / ((_pc[i + 1] - _pc[i]) or 1); (ax, ay), (bx, by) = _pp[i], _pp[i + 1]
            L_ = math.hypot(bx - ax, by - ay) or 1; nx, ny = (by - ay) / L_ * side, -(bx - ax) / L_ * side   # to the signal's side
            la_, lo_ = ll(ax + (bx - ax) * f + nx * 3.2, ay + (by - ay) * f + ny * 3.2); pts_.append([round(la_, 6), round(lo_, 6)])
        TEST['platforms'].append({'name': sg.get('test_stop_name') or sg.get('name') or 'Fermata di prova', 'pts': pts_})
        TEST['stops'].append(round(((d0 + d1) / 2) % _pc[-1], 1))       # the train stops with its centre mid-platform
    TEST['stops'].sort()
    print('test stops on the loop (centre of the train, m from 157):', TEST['stops'], '| lap', TEST['lap'])
    print('test platforms:', [t['name'] for t in TEST['platforms']])
else:
    TEST = None


# ---------------- depot paths for the page's depot manager (places are given live, Giovanni 28 Oct) ----------------
# in: from San Donato platform 3 (the train has unloaded there, signal #A40) to the place; out[p]: from the place to
# departure platform p and on to the junction; positions: the stop on platform 3, the parked train, the platform stop
DEPOT_PATHS = {}
if LINE == 'M3':
    for p_ in storage:
        try:
            pin = leg_path(CFG['IN_VIA'][1], CFG['IN_VIA'][2:], p_); cin = paths[pin][1]
            d_in, _ = project(paths[pin][0], cin, *SD_STOP, 0, None)
            rec = {'in': pin, 'in_stop': round(d_in, 1), 'in_end': round(end_off(p_, cin[-1]), 1), 'out': {}}
            for pl in CFG['PLATS']:
                pout = leg_path(p_, [SD_DEP[pl]], SD_OUT_NODE); cout = paths[pout][1]
                d_pl_, _ = project(paths[pout][0], cout, *SD_STOP, 0, None)
                rec['out'][str(pl)] = {'pid': pout, 'start': round(start_off(p_), 1), 'plat': round(d_pl_, 1)}
            DEPOT_PATHS[str(p_)] = rec
        except RuntimeError as e_: print('depot paths: no route for place', p_, e_)
    print('depot paths for the live depot manager:', len(DEPOT_PATHS), 'places')

# ---------------- real trains (M3 fleet list from Giovanni) ----------------
STOCK, DUTIES = [], [[] for _ in out]
if LINE in ('M3', 'M4'):
    real_trains = __import__('fleet_' + LINE.lower()).trains
    STOCK, SPARE = real_trains()
    duties = []
    for tl in out:
        segs, start = tl.segs, None
        for i, sg in enumerate(segs):
            if start is None: start = 0 if (i == 0 and tl.start_where != 'depot') else sg[3][0]
            nxt = segs[i + 1] if i + 1 < len(segs) else None
            into = sg[1] == 'to_depot' or (sg[1] == 'empty' and (nxt is None or nxt[1] == 'from_depot'))
            if into or nxt is None:
                end = sg[3][-1] if into else INF
                duties.append([start, end, tl.k, None]); start = None
    duties.sort(key=lambda d: d[0])
    free = {i: -1 for i in range(len(STOCK))}
    # trains sleeping in a tail overnight: the evening train is the same as the morning one
    night_pairs = list(zip(sorted(NIGHT_COM_START, key=lambda k: trains[k][0]['dep']), sorted(NIGHT_COM_END, key=lambda k: trains[k][-1]['arr']))) + \
                  list(zip(sorted(NIGHT_SD_START, key=lambda k: trains[k][0]['dep']), sorted(NIGHT_SD_END, key=lambda k: trains[k][-1]['arr'])))
    reserved = {}
    for i, (ms, ev) in enumerate(night_pairs):
        for d in duties:
            if d[2] == ms and d[0] == 0: d[3] = i; free[i] = d[1]
            if d[2] == ev and d[1] == INF: reserved[id(d)] = i
    short = 0
    for d in duties:
        if d[3] is not None: continue
        if id(d) in reserved:
            i = reserved[id(d)]
            if free[i] + 600 <= d[0]: d[3] = i; free[i] = d[1]; continue
        ok = [i for i, f in free.items() if f + 600 <= d[0] and i not in reserved.values()] or \
             [i for i, f in free.items() if f + 600 <= d[0]]
        if ok: i = min(ok, key=lambda i: free[i]); d[3] = i; free[i] = d[1]
        else: short += 1; d[3] = -1
    # peak: stretches out of the depot running at the same moment
    ev_ = sorted([(d[0], 1) for d in duties] + [(min(d[1], 27 * 3600) + 600, -1) for d in duties]); c_ = m_ = 0; at_ = 0
    for t_, x_ in ev_:
        c_ += x_
        if c_ > m_: m_, at_ = c_, t_
    print('trains needed at the busiest moment:', m_, 'at %02d:%02d' % (at_ // 3600 % 24, at_ // 60 % 60))
    for d in duties: DUTIES[d[2]].append([d[0], min(d[1], 10 ** 6), d[3]])
    print('real fleet:', len(STOCK), 'trains | stretches out of the depot:', len(duties), '| not covered by a real train:', short)
    # units standing alone in the depot (no service): a train of their own that never leaves (test loop only)
    for u in getattr(__import__('fleet_' + LINE.lower()), 'SOLO', []):
        n_ = u['node']; pid_ = leg_path(CFG['AFTER_ARR'], [], n_); c_ = paths[pid_][1]
        tl = TL(len(out)); d_ = c_[-1] - TRAIN_HALF
        tl.add(pid_, 'to_depot', [30 * 3600, 30 * 3600 + 1], [d_, d_]); tl.segs[-1].append(n_)
        tl.start_where = tl.end_where = 'depot'; out.append(tl)
        STOCK.append({k: v for k, v in u.items() if k != 'node'}); DUTIES.append([[0, 10 ** 6, len(STOCK) - 1]])
        print('unit standing alone in the depot:', u['units'], 'at node', n_)
    # every real train on the map: the units that are not running at a given moment stand in the depot. The 24 trains of
    # the timetable carry the units they run; the units left over are shown on these depot places (nobody else uses them)
    _used = {sg[5] for tl in out for sg in tl.segs if len(sg) > 5 and sg[5] is not None}
    _unused_cfg = (json.load(open('rules_%s.json' % LINE.lower())) if os.path.exists('rules_%s.json' % LINE.lower()) else {}).get('depot_unused', {}).get('nodes', [])
    _free_places = [p for p in storage if p not in _used] + [p for p in _unused_cfg if p not in _used]
    n_extra = len(STOCK) - len(out); RESERVE_NODES = []
    for _ in range(max(0, n_extra)):
        if not _free_places: print('no free depot place for a reserve train'); break
        n_ = _free_places.pop(0); pid_ = leg_path(CFG['AFTER_ARR'], [], n_); c_ = paths[pid_][1]
        tl = TL(len(out)); d_ = c_[-1] - TRAIN_HALF
        tl.add(pid_, 'to_depot', [30 * 3600, 30 * 3600 + 1], [d_, d_]); tl.segs[-1].append(n_)
        tl.start_where = tl.end_where = 'depot'; out.append(tl); DUTIES.append([]); RESERVE_NODES.append(n_)
    print('depot places for the units not running (reserve):', RESERVE_NODES, '| trains on the map:', len(out), 'units:', len(STOCK))

# ---------------- report ----------------
print('trains', len(trains), 'storage tracks', len(storage), 'paths', len(paths))

# overlap check: max trains waiting at each terminal tail
def fmt(s): return '%02d:%02d' % (s // 3600 % 24, s // 60 % 60)
for k, tl in enumerate(out[:3]):
    print('train', k + 1, [(s[1], fmt(s[3][0]), fmt(s[3][-1])) for s in tl.segs][:8])

# ---------------- tracks to draw ----------------
tracks = []
for w in W:
    cat = 'main' if w['name'] == CFG['main'] else ('test' if 'anello' in w['name'] else w['svc'] or 'main')
    if 'Raccordo' in w['name']: cat = 'link'
    flat, pa, pb = [], 0, 0
    for a, b, n in w['pts']:
        A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    tracks.append({'c': cat, 'p': flat, 'w': w['i']})

for li_, (a_, b_, m) in enumerate(LINKS):     # depot through tracks (inside the depot building)
    flat, pa, pb = [], 0, 0
    for n in (a_, m, b_):
        la_, lo_ = ll(*node_pos[n]); A, B = round(la_ * 1e6), round(lo_ * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    tracks.append({'c': 'yard', 'p': flat, 'w': -1 - li_})

for ti_, dt in enumerate(_rules_.get('tracks', [])):     # tracks drawn by Giovanni (inside the depot building): shown only
    flat, pa, pb = [], 0, 0
    for la_, lo_ in dt['points']:
        A, B = round(la_ * 1e6), round(lo_ * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    tracks.append({'c': 'yard', 'p': flat, 'w': -1000 - ti_, 'drawn': True})

def enc(p):
    flat, pa, pb = [], 0, 0
    for x, y in p:
        a, b = ll(x, y); A, B = round(a * 1e6), round(b * 1e6); flat += [A - pa, B - pb]; pa, pb = A, B
    return flat
def boards_out():
    pos = collections.defaultdict(list)
    for name, la, lo in D['stops']:
        k = station_key(name)
        if k in BOARD: pos[k].append((la, lo))
    res = []
    for k, dirs in BOARD.items():
        la = sum(p[0] for p in pos[k]) / len(pos[k]); lo = sum(p[1] for p in pos[k]) / len(pos[k])
        enc_dirs = {}
        for dname, ts in dirs.items():
            ts.sort(); prev = 0; out_ = []
            for t in ts: out_.append(t - prev); prev = t
            enc_dirs[dname] = out_
        res.append({'n': k.title(), 'la': round(la, 6), 'lo': round(lo, 6), 'dirs': enc_dirs})
    return res

# a shunting signal at the entrance of every depot track (Giovanni will adjust them in the editor)
AUTO_SIGNALS = []
def _entry_signal(n, ei, k):
    e = edges[ei]; pts = e['pts'] if e['b'] == n else e['pts'][::-1]     # from the fan junction towards the parking track
    c = cum(pts); target = min(12.0, c[-1] * 0.5)
    i = next(j for j in range(len(c) - 1) if c[j + 1] >= target); f = (target - c[i]) / ((c[i + 1] - c[i]) or 1)
    x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f; y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f
    hdg = (math.degrees(math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])) + 360) % 360
    la_, lo_ = ll(x, y)
    AUTO_SIGNALS.append({'line': LINE, 'w': e['way'], 'lat': round(la_, 6), 'lon': round(lo_, 6), 'heading': round(hdg),
                         'dir': 1 if e['b'] == n else -1, 'type': 'shunt', 'name': 'SM%02d' % k, 'auto': True})
if LINE == 'M3':
    k = 1
    for p in storage:
        ends = [x for x in (LINKS_BY_MID.get(p) or (p,))]
        for n in ends:
            for ei in node_edges[n]:
                if 'mid' in edges[ei]: continue
                _entry_signal(n, ei, k); k += 1
    print('shunting signals placed at depot track entrances:', len(AUTO_SIGNALS))
# ---------------- San Donato - Rogoredo: closure and ZUB data for the page ----------------
# sb: southbound track Rogoredo crossover (136) -> San Donato (153); nb: San Donato (165) -> crossover (137)
# rev[pid]: the same run starting from the reversing stub beyond the Rogoredo crossover (short turn)
SECTION = None
if CFG.get('SECTION'):
    SC = CFG['SECTION']
    def node_d(pid, n):
        p, c = paths[pid]; q = node_pos[n]; best = (1e9, None)
        for i in range(len(p) - 1):
            (ax, ay), (bx, by) = p[i], p[i + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            u = max(0.0, min(1.0, ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2)) if L2 else 0.0
            dd = math.hypot(q[0] - ax - u * dx, q[1] - ay - u * dy)
            if dd < best[0]: best = (dd, c[i] + u * (c[i + 1] - c[i]))
        return round(best[1], 1) if best[0] < 1.0 else None
    STUB = TRAIN_HALF + 15                      # centre of a reversing train beyond the crossover
    ranges, rev = {}, {}
    end_of = {pid: k[3] for k, pid in list(path_key.items()) if k[0] == 'leg'}
    n_paths = len(paths)
    for pid in range(n_paths):
        a, b = node_d(pid, SC['sb'][0]), node_d(pid, SC['sb'][1])
        c_, d_ = node_d(pid, SC['nb'][0]), node_d(pid, SC['nb'][1])
        r = {}
        if a is not None and b is not None and b > a: r['sb'] = [a, b]
        if c_ is not None and d_ is not None and d_ > c_: r['nb'] = [c_, d_]
        if r: ranges[pid] = r
        if 'nb' in r and pid in end_of:
            key = ('rev', end_of[pid])
            if key not in path_key:
                saved = {w: ONEWAY.pop(w) for w in SC['lift'] if w in ONEWAY}
                try: st = route_nodes(SC['sb'][1], end_of[pid], via=[SC['sb'][0], SC['nb'][1]])
                finally: ONEWAY.update(saved)
                if st: make_path(key, st)
            if key in path_key:
                rp = path_key[key]; x137 = node_d(rp, SC['nb'][1]); x136 = node_d(rp, SC['sb'][0])
                if x137 is not None and x136 is not None:
                    rev[pid] = [rp, round(x137 - r['nb'][1], 1), round(x136 - STUB, 1), round(x136, 1)]
    SECTION = {'stub': STUB, 'ranges': {str(k): v for k, v in ranges.items()}, 'rev': {str(k): v for k, v in rev.items()},
               'sb_signal': list(ll(*node_pos[SC['sb'][0]])), 'nb_signal': list(ll(*node_pos[SC['nb'][0]]))}
    print('San Donato-Rogoredo: paths through the section', len(ranges), '| short-turn versions', len(rev))
# ---------------- terminal junctions ("incrocio") for the live engine ----------------
# one train at a time between the platforms and the tail tracks; at the home terminal also the depot access to platform 1
THROATS = []
if CFG.get('THROATS'):
    def _throat(ends, tails, extra_from=()):
        es = set()
        for a in ends:
            for t in tails:
                for start in (a,):
                    for r in (route_nodes(start, t), route_nodes(t, start)):
                        if r: es |= {ei for ei, _ in r}
        for src in extra_from:                       # depot -> platform 1
            r = route_nodes(src, CFG['THROATS']['home']['p1'][0])
            if r: es |= {ei for ei, _ in r}
        # keep the junction area only: no tail tracks, no platform/main tracks, no long depot tracks
        keep = set()
        for ei in es:
            e = edges[ei]
            if e['a'] in tails or e['b'] in tails: continue
            if W[e['way']]['name'] == CFG['main']: continue
            if e['len'] > 250: continue
            keep.add(ei)
        return sorted(keep)
    TH = CFG['THROATS']
    home_ex = [STORE_BEFORE.get(chain[0]['ti'], storage[0]) for chain in trains][:3] if storage else []
    _dep = [ei for ei in range(len(edges)) if any({edges[ei]['a'], edges[ei]['b']} == set(pr) for pr in TH['home'].get('depot', []))]
    THROATS.append({'name': CFG['home'], 'edges': sorted(set(_throat(TH['home']['ends'], SD_TAILS, home_ex)) | set(_dep)), 'p1': [ei for ei in range(len(edges)) if {edges[ei]['a'], edges[ei]['b']} == set(TH['home']['p1'])]})
    THROATS.append({'name': CFG['far'], 'edges': _throat(TH['far']['ends'], COM_TAILS), 'p1': []})
    THROATS[0]['tails'] = [node_edges[t][0] for t in SD_TAILS]; THROATS[1]['tails'] = [node_edges[t][0] for t in COM_TAILS]
    for t in THROATS: print('junction area', t['name'], '- track pieces:', len(t['edges']))
# ---------------- network for the live engine (step 1) ----------------
# every track piece between two junctions, with its category and speed limit, plus the signals
def _edge_cat(e):
    if 'mid' in e: return 'yard'
    w = W[e['way']]
    if 'Raccordo' in w['name']: return 'link'
    if w['name'] == CFG['main']: return 'main'
    if 'anello' in w['name']: return 'test'
    return w['svc'] or 'main'
_tails = set(CFG['SD_TAILS']) | set(CFG['COM_TAILS'])
def _edge_kmh(e, cat):
    if cat == 'test': return OPS.get('line_max_kmh', 80)               # anello di prova: not limited to 15
    if cat in ('yard', 'link'): return OPS['depot_speed_kmh']        # depot tracks, through tracks, depot access
    if e['a'] in _tails or e['b'] in _tails: return OPS['tail_speed_kmh']
    return OPS.get('line_max_kmh', 80)
NET = {'nodes': {}, 'edges': [], 'signals': []}
_CYC_E = globals().get('_CYC_E', set())
for ei, e in enumerate(edges):
    cat = 'test' if ei in _CYC_E else _edge_cat(e)
    for n in (e['a'], e['b']):
        if n not in NET['nodes']: NET['nodes'][n] = [round(v, 6) for v in ll(*node_pos[n])]
    NET['edges'].append({'a': e['a'], 'b': e['b'], 'len': round(e['len'], 1), 'way': e['way'] if 'mid' not in e else -1,
                         'cat': cat, 'kmh': _edge_kmh(e, cat), 'p': enc(e['pts']), 'nm': W[e['way']]['name'] if 'mid' not in e else ''})
NET['nodes'] = {str(k): v for k, v in NET['nodes'].items()}
for ei, e in enumerate(edges):
    ne = NET['edges'][ei]; ne['key'] = '%s-%s' % (e['a'], e['b'])
    ne['fixed'] = ne['cat'] in ('crossover', 'yard', 'link') or ne['kmh'] < OPS.get('line_max_kmh', 80)   # depot, tails, crossovers: not editable
    if ne['cat'] == 'crossover': ne['kmh'] = 15
# ---------------- degraded service: shuttles when a stretch of the line is closed ----------------
# LINE_MAP: the stations in order San Donato -> Comasina, the two main paths (N, S) and every stop on them.
# TURNS[station:dir]: how a train arriving in that direction turns back at that station over a crossover:
#  'B' crossover before the station: it crosses over and arrives on the other track, reverses on the platform;
#  'A' crossover after the station: passengers off, on beyond the crossover, reverse, over it, back to the platform.
# RECOVERY: tracks where a train can be put away (ricovero), by radio.
DEGRADED = None
if CFG.get('degraded'):
    leg_ends = {pid: (k[1], k[3]) for k, pid in path_key.items() if k[0] == 'leg'}
    full = {}
    for tl in out:
        for sg in tl.segs:
            if sg[1] != 'service' or sg[2] < 0 or sg[0] not in leg_ends: continue
            nm = [D['stops'][x][0] for x in D['trips'][sg[2]][5] if x >= 0]
            if len(nm) < 21: continue
            dr_ = 'N' if nm[0].upper().startswith(CFG['home'].upper()) else 'S'
            st_ = [];  ds_ = sg[4]
            for i in range(len(ds_)):
                if i == 0 or ds_[i] != ds_[i - 1]: st_.append(ds_[i])
            if len(st_) != len(nm): continue
            full.setdefault(dr_, {})[sg[0]] = (nm, st_)
    # a pair whose tails match: N starts in the San Donato tail where S ends, and ends in the Comasina tail where S starts
    pair = None
    for pn, (nmN, stN) in full.get('N', {}).items():
        for ps, (nmS, stS) in full.get('S', {}).items():
            if leg_ends[pn][0] == leg_ends[ps][1] and leg_ends[pn][1] == leg_ends[ps][0]: pair = (pn, ps); break
        if pair: break
    if pair:
        pN, pS = pair; names = full['N'][pN][0]
        stopN = full['N'][pN][1]; stopS = full['S'][pS][1][::-1]          # both in San Donato -> Comasina order
        def nodes_of(pid):
            out_, d = [], 0.0
            for ei, dr in PATH_STATES[pid]:
                out_.append((start_node(ei, dr), d)); d += plen(poly(ei, dr))
            ei, dr = PATH_STATES[pid][-1]; out_.append((end_node(ei, dr), d)); return out_
        nN, nS = nodes_of(pN), nodes_of(pS)
        posN = {n: d for n, d in nN}; posS = {n: d for n, d in nS}
        def path_d_of(pid, lat, lon, near):
            p_, c_ = paths[pid]; d_, err = project(p_, c_, lat, lon, max(0, near - 400), 800); return d_ if err < 3 else None
        main_nodes = set(posN) | set(posS)
        def xov_pairs(posD, posO):
            """(u on D, v on O): joined only by crossover pieces (a scissors crossover has a middle node)."""
            for u in posD:
                seen, todo = {u}, [(u, 0)]
                while todo:
                    n, k = todo.pop()
                    for ei in node_edges[n]:
                        e = edges[ei]
                        if _edge_cat(e) != 'crossover': continue
                        m_ = e['b'] if e['a'] == n else e['a']
                        if m_ in seen: continue
                        seen.add(m_)
                        if m_ in posO and m_ not in posD: yield u, m_
                        elif m_ not in main_nodes and k < 3: todo.append((m_, k + 1))
        def has_xov(r): return any(_edge_cat(edges[e_]) == 'crossover' for e_, _ in r)
        def rlen(r): return sum(plen(poly(e_, d_)) for e_, d_ in r)
        def at_d(pid, d):
            pp, cc = paths[pid]; import bisect as _bb
            j = max(0, min(len(cc) - 2, _bb.bisect_right(cc, d) - 1)); f = (d - cc[j]) / ((cc[j + 1] - cc[j]) or 1)
            return ll(pp[j][0] + (pp[j + 1][0] - pp[j][0]) * f, pp[j][1] + (pp[j + 1][1] - pp[j][1]) * f)
        TURNS = {}
        saved = dict(ONEWAY)
        def free_route(starts, goal):
            ONEWAY.clear()
            try: return route(starts, goal)
            finally: ONEWAY.update(saved)
        stopS_f = full['S'][pS][1]
        for i, nm in enumerate(names):
            if i in (0, len(names) - 1): continue
            for dr_ in ('N', 'S'):
                Dp, Op = (pN, pS) if dr_ == 'N' else (pS, pN)
                posD, posO = (posN, posS) if dr_ == 'N' else (posS, posN)
                nD, nO = (nN, nS) if dr_ == 'N' else (nS, nN)
                dX = stopN[i] if dr_ == 'N' else stopS_f[len(names) - 1 - i]
                dXo = stopS_f[len(names) - 1 - i] if dr_ == 'N' else stopN[i]
                cands = []
                for u, v in xov_pairs(posD, posO):
                    du, dv = posD[u], posO[v]
                    kD = [n for n, _ in nD].index(u); kO = [n for n, _ in nO].index(v)
                    if dX - 900 < du < dX - TRAIN_HALF - 10 and dv > dXo + TRAIN_HALF:
                        # B: cross over before the station and arrive on the other track (running against its direction)
                        goal = max((n for n, d in nO if d < dXo - TRAIN_HALF - 10), key=lambda n: posO[n], default=None)
                        r = free_route(list(successors(*PATH_STATES[Dp][kD - 1])), goal) if kD > 0 and goal is not None else None
                        if r and has_xov(r) and rlen(r) < 8000:
                            pid = make_path(('turnB', nm, dr_), PATH_STATES[Dp][:kD] + r)
                            q = path_d_of(pid, *at_d(Op, dXo), dX)
                            xo = [e_ for e_, _ in r if _edge_cat(edges[e_]) == 'crossover']
                            if q is not None: cands.append((0, rlen(r), {'kind': 'B', 'pid': pid, 'd_arr': round(q, 1), 'd_dep': round(dXo, 1), 'du': round(du, 1),
                                                                         '_lock': [(Op, dXo - TRAIN_HALF - 5, dv + 5), (Dp, du - 30, du + 5), xo]}))
                        # C: arrive on its own track, board there, reverse and leave backwards over the crossover behind it
                        k0 = max(k for k, (n, d) in enumerate(nD[:-1]) if d <= dX)
                        e0, dir0 = PATH_STATES[Dp][k0]
                        goalC = nO[kO + 1][0] if kO + 1 < len(nO) else None
                        r = free_route([(e0, -dir0)], goalC) if goalC is not None else None
                        # C runs backwards on its own track to the crossover: only if that is close (a short move)
                        back = 0.0
                        for e_, _ in (r or []):
                            if _edge_cat(edges[e_]) == 'crossover': break
                            back += plen(poly(e_, _))
                        back -= (nD[k0 + 1][1] - dX)
                        if r and has_xov(r) and rlen(r) < 8000 and back < 350:
                            pid = make_path(('turnC', nm, dr_), r + PATH_STATES[Op][kO + 1:])
                            dEnd = nD[k0 + 1][1]
                            xo = [e_ for e_, _ in r if _edge_cat(edges[e_]) == 'crossover']
                            cands.append((1, rlen(r), {'kind': 'C', 'pid': pid, 'd_dep': round(dEnd - dX, 1), 'off': round(rlen(r) - posO[goalC], 1),
                                                       '_lock': [(Dp, du - 5, dX + TRAIN_HALF + 5), (Op, dv - 5, dv + 30), xo]}))
                    if dX + TRAIN_HALF < du < dX + 700 and dv < dXo - TRAIN_HALF:
                        # A: passengers off, on beyond the crossover, reverse, over it and back into the other platform
                        if kD >= len(PATH_STATES[Dp]): continue
                        e_next, dn = PATH_STATES[Dp][kD]
                        if edges[e_next]['len'] < TRAIN_HALF + 20: continue
                        goal = min((n for n, d in nO if d > dXo + TRAIN_HALF + 10), key=lambda n: posO[n], default=None)
                        r = free_route([(e_next, -dn)], goal) if goal is not None else None
                        if not r or not has_xov(r) or rlen(r) > 8000: continue
                        kg = [n for n, _ in nO].index(goal)
                        pid = make_path(('turnA', nm, dr_), r + PATH_STATES[Op][kg:])
                        stub = TRAIN_HALF + 15
                        xo = [e_ for e_, _ in r if _edge_cat(edges[e_]) == 'crossover']
                        cands.append((2, rlen(r), {'kind': 'A', 'stub_d': round(du + stub, 1), 'pid': pid, 'd0': round(plen(poly(e_next, dn)) - stub, 1), 'off': round(rlen(r) - posO[goal], 1),
                                                   '_lock': [(Dp, dX - TRAIN_HALF - 5, du + stub + TRAIN_HALF + 5), (Op, dv - 5, dXo + TRAIN_HALF + 5), xo]}))
                if os.environ.get('DEBUG_TURN') == nm: print('turn debug', nm, dr_, 'dX', round(dX), 'dXo', round(dXo), 'xov', [(u, v, round(posD[u]), round(posO[v])) for u, v in xov_pairs(posD, posO)], [c[2]['kind'] for c in cands])
                if cands:       # every way found, shortest first; B is the usual choice, C or A when coming from another path
                    t_ = {}
                    for c_ in sorted(cands, key=lambda x: (x[0], x[1])): t_.setdefault(c_[2]['kind'], c_[2])
                    for c_ in t_.values(): c_.setdefault('_lock', None)
                    TURNS['%d:%s' % (i, dr_)] = t_
        # ricovero: dead-end tracks where a train is put away (Giovanni): Brenta towards San Donato, Centrale both ways
        RECOVERY = {}
        dead = [n for n in node_edges if len(node_edges[n]) == 1]
        for nm, dr_, box in CFG.get('recovery', []):
            if nm not in names: continue
            i = names.index(nm); Dp = pN if dr_ == 'N' else pS; nD = nN if dr_ == 'N' else nS
            dX = stopN[i] if dr_ == 'N' else stopS_f[len(names) - 1 - i]
            goals = [g for g in dead if box[0] <= node_pos[g] and False] if False else [g for g in dead if box[0] <= ll(*node_pos[g])[0] <= box[1] and box[2] <= ll(*node_pos[g])[1] <= box[3]]
            best = None
            def ok_end(r):
                tail_len = 0.0
                for e_, _ in reversed(r):
                    tail_len += edges[e_]['len']
                    if _edge_cat(edges[e_]) == 'main' or tail_len > 2 * TRAIN_HALF + 10: break
                return tail_len > 2 * TRAIN_HALF + 10 and _edge_cat(edges[r[-1][0]]) != 'main'
            k0 = max(k for k, (n, d) in enumerate(nD[:-1]) if d <= dX)
            for g in goals:
                # R1: on from the platform and into the track, no reversal
                for k in range(k0 + 1, len(nD) - 1):
                    if nD[k][1] > dX + 900: break
                    r = free_route(list(successors(*PATH_STATES[Dp][k - 1])), g)
                    if r and ok_end(r) and rlen(r) < 2500 and r[0] != PATH_STATES[Dp][k]:
                        c_ = (0, rlen(r), {'how': 'on', 'pid': make_path(('ricovero', nm, dr_, g, k), PATH_STATES[Dp][:k] + r)})
                        if not best or c_[:2] < best[:2]: best = c_
                # R2: reverse on the platform, back into the track
                e0, dir0 = PATH_STATES[Dp][k0]
                r = free_route([(e0, -dir0)], g)
                if r and ok_end(r) and rlen(r) < 2500:
                    c_ = (1, rlen(r), {'how': 'back', 'pid': make_path(('ricovero-r', nm, dr_, g), r), 'd_from': round(nD[k0 + 1][1] - dX, 1)})
                    if not best or c_[:2] < best[:2]: best = c_
                # R3: on beyond the next junction, reverse there, back into the track
                for k in range(k0 + 1, len(nD) - 1):
                    if nD[k][1] > dX + 700: break
                    e_next, dn = PATH_STATES[Dp][k]
                    if edges[e_next]['len'] < TRAIN_HALF + 20: continue
                    r = free_route([(e_next, -dn)], g)
                    if r and ok_end(r) and rlen(r) < 2500:
                        stub = TRAIN_HALF + 15
                        c_ = (2, rlen(r), {'how': 'beyond', 'stub_d': round(nD[k][1] + stub, 1), 'pid': make_path(('ricovero-b', nm, dr_, g, k), r), 'd_from': round(plen(poly(e_next, dn)) - stub, 1)})
                        if not best or c_[:2] < best[:2]: best = c_
            if best:
                rec = best[2]; pp_, cc_ = paths[rec['pid']]
                rec.update({'d_stop': round(dX, 1), 'd_end': round(cc_[-1] - TRAIN_HALF - 5, 1), 'name': nm})
                RECOVERY['%d:%s' % (i, dr_)] = rec
        # platforms on every path: an empty train passes them at 40 km/h (Giovanni)
        ZONES = {}
        plat_pts = [(at_d(pN, d), i) for i, d in enumerate(stopN)] + [(at_d(pS, d), len(names) - 1 - i) for i, d in enumerate(stopS_f)]
        for pid in range(len(paths)):
            pp_, cc_ = paths[pid]; z_ = []
            for (la_, lo_), st_ in plat_pts:
                d_, err = project(pp_, cc_, la_, lo_, 0, None)
                if err < 1.5 and TRAIN_HALF < d_ < cc_[-1] - 1: z_.append([round(d_ - TRAIN_HALF - 5, 1), round(d_ + TRAIN_HALF + 5, 1), st_])
            if z_: ZONES[str(pid)] = sorted(z_)
        print('ricovero tracks:', {k: (v['name'], v['how']) for k, v in RECOVERY.items()})
        def tail_d(pid):
            st_, en_ = leg_ends[pid]; L_ = paths[pid][1][-1]
            return round(tail_off(st_) if len(node_edges[st_]) == 1 else 0, 1), round(L_ - tail_off(en_) if len(node_edges[en_]) == 1 else L_, 1)
        # every pair of main paths with matching tails (one per tail at each end): trains turning back at a terminus
        # take the pair whose tail is free
        PAIRS = []
        for pn_, (nmN_, stN_) in full.get('N', {}).items():
            for ps_, (nmS_, stS_) in full.get('S', {}).items():
                if leg_ends[pn_][0] == leg_ends[ps_][1] and leg_ends[pn_][1] == leg_ends[ps_][0] and nmN_ == names \
                   and leg_ends[pn_][0] in SD_TAILS and leg_ends[pn_][1] in COM_TAILS and [leg_ends[pn_][0], leg_ends[pn_][1]] not in [q_['tails'] for q_ in PAIRS]:
                    PAIRS.append({'N': {'pid': pn_, 'stops': [round(x, 1) for x in stN_], 'tail': tail_d(pn_)},
                                  'S': {'pid': ps_, 'stops': [round(x, 1) for x in stS_], 'tail': tail_d(ps_)},
                                  'tails': [leg_ends[pn_][0], leg_ends[pn_][1]]})
        print('main path pairs (San Donato tail, Comasina tail):', [p_['tails'] for p_ in PAIRS])
        DEGRADED = {'names': names, 'N': {'pid': pN, 'stops': [round(x, 1) for x in stopN], 'tail': tail_d(pN)},
                    'S': {'pid': pS, 'stops': [round(x, 1) for x in full['S'][pS][1]], 'tail': tail_d(pS)}, 'turns': TURNS, 'recovery': RECOVERY, 'platforms': ZONES, 'pairs': PAIRS}
        print('degraded service: turns at', sorted(TURNS))
    else:
        print('degraded service: no matching pair of main paths')
# for every path: which track piece covers which stretch, and where it takes the diverging side of a junction (15 km/h)
def _ang(u, v): return math.degrees(math.acos(max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1]))))
PATH_EDGES = []
for pid in range(len(paths)):
    st = PATH_STATES.get(pid); spans, div, d = [], [], 0.0
    if st:
        for k, (ei, dr) in enumerate(st):
            L_ = plen(poly(ei, dr)); spans.append([ei, dr, round(d, 1), round(d + L_, 1)])
            if k + 1 < len(st):
                n = end_node(ei, dr); e2, d2 = st[k + 1]
                if len(node_edges[n]) >= 3 and _ang(tangent(poly(ei, dr), False), tangent(poly(e2, d2), True)) > 6:
                    div.append([round(d + L_, 1), n])
            d += L_
    # curves: where the track turns tighter than ~curve_radius_m (heading measured over +-25 m)
    curves = []
    if st:
        pp, cc = paths[pid]; L_ = cc[-1]
        import bisect as _b
        def _at(d):
            d = max(0.0, min(L_, d)); i = max(0, min(len(cc) - 2, _b.bisect_right(cc, d) - 1)); f = (d - cc[i]) / ((cc[i + 1] - cc[i]) or 1)
            return (pp[i][0] + (pp[i + 1][0] - pp[i][0]) * f, pp[i][1] + (pp[i + 1][1] - pp[i][1]) * f)
        def _hd(d):
            a, b = _at(d - 25), _at(d + 25); return math.atan2(b[1] - a[1], b[0] - a[0])
        R = OPS.get('curve_radius_m', 400); x = 25.0; run = None
        while x < L_ - 25:
            dth = abs((_hd(x + 10) - _hd(x - 10) + math.pi) % (2 * math.pi) - math.pi)
            tight = dth > 1e-6 and 20.0 / dth < R
            if tight and run is None: run = x
            if not tight and run is not None:
                if x - run >= 20: curves.append([round(run - 10, 1), round(x + 10, 1)])
                run = None
            x += 5
        if run is not None and x - run >= 20: curves.append([round(run - 10, 1), round(x + 10, 1)])
    PATH_EDGES.append({'e': spans, 'div': div, 'curves': curves})
_rules = 'rules_%s.json' % LINE.lower()
if os.path.exists(_rules):
    NET['signals'] = [{**{k: v for k, v in sg.items() if k in ('w', 'lat', 'lon', 'on_track', 'heading', 'dir', 'type', 'kind', 'name')}, 'n': sg.get('_n')}
                      for sg in _rules_.get('signals', []) if sg.get('line') == LINE]
    NET['removed'] = _rules_.get('removed_signals', [])
    NET['interlocking'] = INTERLOCKING
    # depot places, numbered across the yard (1 = first track from the north-west side); names can be set in rules
    _dn = _rules_.get('names', {}).get('depot', {})
    def _place_pos(n, k):     # label where the train stands, staggered along its track (the tracks are 4-5 m apart)
        if n not in LINK_ENDS: return NET['nodes'].get(str(n))
        a_, b_ = LINK_ENDS[n]; (ax, ay), (bx, by) = node_pos[a_], node_pos[b_]; L_ = math.hypot(bx - ax, by - ay) or 1
        f = 0.5 + ((k % 5) - 2) * 22 / L_
        la_, lo_ = ll(ax + (bx - ax) * f, ay + (by - ay) * f); return [round(la_, 6), round(lo_, 6)]
    LINK_ENDS = {m: (a_, b_) for a_, b_, m in LINKS}
    _pl = [(n, NET['nodes'].get(str(n))) for n in storage]; _pl = [(n, q) for n, q in _pl if q]
    _c = math.cos(math.radians(45.43))
    def _sortpos(n, q):        # numbering: the middle of the track (through tracks), so it does not change when a place moves
        if n in LINK_ENDS: (ax, ay), (bx, by) = node_pos[LINK_ENDS[n][0]], node_pos[LINK_ENDS[n][1]]; return ll((ax + bx) / 2, (ay + by) / 2)
        return q
    # numbering (Giovanni): from the top of the map down, across the tracks (they run north-east)
    _pl.sort(key=lambda x: (lambda q: (q[1] - 9.25) * 78000 * math.sin(math.radians(140)) + (q[0] - 45.43) * 111000 * math.cos(math.radians(140)))(_sortpos(*x)))
    _pl = [(n, _place_pos(n, i) or q) for i, (n, q) in enumerate(_pl)]
    NET['depot'] = [{'node': n, 'lat': q[0], 'lon': q[1], 'way': STORE_WAY.get(n, -1), 'out': 'through' if n in STORE_EXIT and n not in STORE_SAME else 'same end',
                     'name': _dn.get(str(n), 'Deposito binario %d' % (i + 1))} for i, (n, q) in enumerate(_pl)]
    NET['names'] = {k: v for k, v in _rules_.get('names', {}).get('ways', {}).items()}
    print('interlocking groups:', [(g['name'], ['A%02d' % _rules_['signals'][i]['_n'] for i in g['signals']]) for g in INTERLOCKING['groups']])
# where each placed signal is on every path that goes over it facing it: trains stop just before it, and it shows
# the state of the junction / tail / section right behind it. sigpos[pid] = [[d, signal index], ...]
SIGPOS = {}
for si_, sg in enumerate(NET['signals']):
    if 'on_track' not in sg: continue
    x, y = xy(*sg['on_track'])
    for pid in range(len(paths)):
        p_, c_ = paths[pid]; best = None
        for i in range(len(p_) - 1):
            (ax, ay), (bx, by) = p_[i], p_[i + 1]
            if min(ax, bx) - 3 > x or max(ax, bx) + 3 < x or min(ay, by) - 3 > y or max(ay, by) + 3 < y: continue
            dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
            if not L2: continue
            u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); e = math.hypot(x - ax - u * dx, y - ay - u * dy)
            if e < 1.8 and (best is None or e < best[0]): best = (e, c_[i] + u * (c_[i + 1] - c_[i]), math.degrees(math.atan2(dx, dy)) % 360)
        if best and abs((best[2] - sg.get('heading', best[2]) + 180) % 360 - 180) < 60:
            SIGPOS.setdefault(str(pid), []).append([round(best[1], 1), si_])
for v in SIGPOS.values(): v.sort()
NET['sigpos'] = SIGPOS
# a depot place is called by the signal in front of it (Giovanni: easier for maintenance), e.g. "A78"
if LINE == 'M3' and NET.get('depot'):
    _used = set()
    for dp in NET['depot']:
        if str(dp['node']) in _rules_.get('names', {}).get('depot', {}): continue
        r_ = DEPOT_PATHS.get(str(dp['node']))
        if not r_: continue
        o_ = r_['out'][str(CFG['PLATS'][0])]
        ahead = [(d, si) for d, si in SIGPOS.get(str(o_['pid']), []) if o_['start'] <= d <= o_['start'] + TRAIN_HALF + 60]
        if not ahead: continue
        nm = 'A%02d' % NET['signals'][ahead[0][1]]['n']
        if nm in _used: nm += '-2'
        _used.add(nm); dp['name'] = nm
    print('depot places named after the signal in front:', [dp['name'] for dp in NET['depot']])
print('network for the live engine:', len(NET['nodes']), 'nodes,', len(NET['edges']), 'track pieces,', len(NET['signals']), 'signals')
# ---------------- block sections along the line (fixed block, one train per section) ----------------
# A section runs from a station's departure signal (end of the platform, direction of travel) to the next station's.
# signals Giovanni removed with the editor (rules_m3.json "removed_signals": [[lat, lon], ...])
REMOVED = [tuple(x) for x in _rules_.get('removed_signals', [])]
def removed_near(pid, d, m=8.0):
    if not REMOVED: return False
    p_, c_ = paths[pid]; import bisect as _bb
    j = max(0, min(len(c_) - 2, _bb.bisect_right(c_, d) - 1)); f = (d - c_[j]) / ((c_[j + 1] - c_[j]) or 1)
    x, y = p_[j][0] + (p_[j + 1][0] - p_[j][0]) * f, p_[j][1] + (p_[j + 1][1] - p_[j][1]) * f
    return any(math.hypot(x - xy(la, lo)[0], y - xy(la, lo)[1]) < m for la, lo in REMOVED)
BLOCKS = []
ENTRY_GAP = 15                      # computed entry signal: this far before the platform start
if CFG.get('blocks'):
    def _parts(pid, x0, x1):
        out_ = []
        for ei, dr, a, b in PATH_EDGES[pid]['e']:
            if b <= x0 or a >= x1: continue
            k = edges[ei]['len'] / ((b - a) or 1)
            lo, hi = max(a, x0), min(b, x1)
            l0, l1 = ((lo - a) * k, (hi - a) * k) if dr > 0 else ((b - hi) * k, (b - lo) * k)
            out_.append([ei, round(l0, 1), round(l1, 1)])
        return out_
    done = set()
    for tl in out:
        for sg in tl.segs:
            if sg[1] != 'service' or sg[2] < 0: continue
            names = [D['stops'][x][0] for x in D['trips'][sg[2]][5] if x >= 0]
            dr_ = 'N' if names[0].upper().startswith(CFG['home'].upper()) else 'S'
            if dr_ in done: continue
            ds, st = sg[4], []
            for i in range(len(ds)):
                if i == 0 or ds[i] != ds[i - 1]: st.append(ds[i])
            if len(st) != len(names):
                if dr_ not in done: print('blocks: stops do not match', dr_, len(st), len(names), [round(x) for x in st][:6])
                continue
            done.add(dr_)
            # Giovanni's scheme: [tunnel] -> [station]. Two signals per station and direction: the entry (protection)
            # signal where the tunnel ends, before the platform, and the departure signal just past the platform end.
            # A signal he placed on the map (standard / ATP, facing this way) is used instead of the computed one.
            real = []
            for x in sorted(x for x, k in stop_marks(sg[0]) if k == 'atp'):
                if not real or x - real[-1] > 25: real.append(x)          # one signal each side of the track: count it once
            def snap(d0, lo, hi):
                c_ = [x for x in real if d0 + lo <= x <= d0 + hi]
                return (min(c_, key=lambda x: abs(x - d0)), True) if c_ else (d0, False)
            last = len(st) - 1
            dep = [snap(d + TRAIN_HALF + 2.5, -15, 40) for d in st]
            ent = [None] + [snap(st[j] - TRAIN_HALF - (2.5 if j == last else ENTRY_GAP), -120, 5) for j in range(1, last + 1)]
            def add(kind, nm, a_, b_, is_real):
                BLOCKS.append({'name': '%s %s' % (dr_, nm), 'dir': dr_, 'kind': kind, 'parts': _parts(sg[0], a_, b_), 'signal_d': round(a_, 1),
                               'pid': sg[0], 'station': kind == 'departure', 'real': is_real})
            # every signal along the run, in order: (position, kind, name, placed by Giovanni)
            bounds = []
            for j in range(last):
                a_, b_ = dep[j][0], ent[j + 1][0]
                bounds.append((a_, 'departure', '%s → %s' % (names[j], names[j + 1]), dep[j][1]))
                # signals he placed in the tunnel between the two stations: more block sections
                for x in real:
                    if a_ + 60 < x < b_ - 60: bounds.append((x, 'block', '%s → %s (blocco)' % (names[j], names[j + 1]), True))
                bounds.append((b_, 'entry', '%s%s' % (names[j + 1], ' arrivo' if j + 1 == last else ''), ent[j + 1][1]))
            end_d = dep[last][0]
            # signals Giovanni removed with the editor: no signal there, the two sections become one
            gone = [b for b in bounds[1:] if removed_near(sg[0], b[0])]
            if gone: print('  signals removed (%s):' % dr_, [b[2] for b in gone])
            bounds = [bounds[0]] + [b for b in bounds[1:] if b not in gone]
            for q, (x0, kind, nm, is_real) in enumerate(bounds):
                x1 = bounds[q + 1][0] if q + 1 < len(bounds) else end_d
                # exception: a very long stretch with no signal is cut in equal parts (LZB-like)
                n = max(1, math.ceil((x1 - x0) / CFG.get('block_max_m', 1000))) if kind != 'entry' else 1
                for r_ in range(n):
                    y0 = x0 + (x1 - x0) * r_ / n; y1 = x0 + (x1 - x0) * (r_ + 1) / n
                    if r_ == 0: add(kind, nm, y0, y1, is_real)
                    else: add('block', nm.split(' (')[0] + ' (blocco)', y0, y1, False)
    print('block sections:', len(BLOCKS))
if DEGRADED:
    def _parts2(pid, x0, x1):
        out_ = []
        for ei, dr, a, b in PATH_EDGES[pid]['e']:
            if b <= x0 or a >= x1: continue
            k = edges[ei]['len'] / ((b - a) or 1); lo, hi = max(a, x0), min(b, x1)
            l0, l1 = ((lo - a) * k, (hi - a) * k) if dr > 0 else ((b - hi) * k, (b - lo) * k)
            out_.append([ei, round(l0, 1), round(l1, 1)])
        return out_
    # one lock per station and direction: everything a turning train may use there (A, B or C), held from when it
    # arrives until it has left; a following train waits at its start
    LOCKS = {}
    for key, kinds_ in DEGRADED['turns'].items():
        parts_ = []
        for kd, t_ in kinds_.items():
            spec = t_.pop('_lock', None)
            if spec:
                (p1, a1, b1), (p2, a2, b2), xo = spec
                parts_ += _parts2(p1, a1, b1) + _parts2(p2, a2, b2) + [[e_, 0, round(edges[e_]['len'], 1)] for e_ in xo]
        if parts_: LOCKS[key] = parts_
    DEGRADED['locks'] = LOCKS
if NOSE_LOG: print('nose stops (shift of the stop in m, by station):', {k: sorted(v) for k, v in sorted(NOSE_LOG.items())})
PLATMAP = {'station': CFG['home'], 'plats': [[l[0], l[1]] for l in CFG.get('labels', [])], 'stop': list(SD_STOP)}
# platform number labels at the home terminal
PLAT_LABELS = []
for text, way, metres, side in CFG.get('labels', []):
    pp = [xy(a, b) for a, b, n in W[way]['pts']]; cc = cum(pp)
    s0, _ = project(pp, cc, *SD_STOP, 0, None)
    sw_at_start = W[way]['pts'][0][0] < W[way]['pts'][-1][0]          # which end of the way is south-west
    target = max(0, min(cc[-1], s0 - metres if sw_at_start else s0 + metres))
    i = max(0, min(len(cc) - 2, next(k for k in range(len(cc) - 1) if cc[k + 1] >= target)))
    f = (target - cc[i]) / ((cc[i + 1] - cc[i]) or 1)
    la_, lo_ = ll(pp[i][0] + (pp[i + 1][0] - pp[i][0]) * f, pp[i][1] + (pp[i + 1][1] - pp[i][1]) * f)
    PLAT_LABELS.append({'t': text, 'la': la_, 'lo': lo_, 's': side})
# depot places that get in each other's way: a train parked at p stands on track that the way in or out of q uses
def _cover(pid, lo, hi):
    out = []
    for ei, dr, x0, x1 in PATH_EDGES[pid]['e']:
        if x1 < lo or x0 > hi: continue
        a_, b_ = max(lo, x0), min(hi, x1)
        out.append((ei, a_ - x0, b_ - x0) if dr > 0 else (ei, x1 - b_, x1 - a_))
    return out
for p_, rec in DEPOT_PATHS.items():
    park = _cover(rec['in'], rec['in_end'] - TRAIN_HALF - 3, rec['in_end'] + TRAIN_HALF + 3)
    blocks = []
    for q_, rq in DEPOT_PATHS.items():
        if q_ == p_: continue
        ways = [_cover(rq['in'], rq['in_stop'], rq['in_end'] - TRAIN_HALF)] + [_cover(o['pid'], o['start'] + TRAIN_HALF, o['plat']) for o in rq['out'].values()]
        if any(e1 == e2 and a1 < b2 - 0.5 and a2 < b1 - 0.5 for (e1, a1, b1) in park for w in ways for (e2, a2, b2) in w): blocks.append(q_)
    rec['blocks'] = blocks
print('depot places in the way of others when occupied:', {k: v['blocks'] for k, v in DEPOT_PATHS.items() if v.get('blocks')})
# the test loop: places a train going to or coming back from the loop would run over (they must be free)
if TEST and TEST.get('trip'):
    _park = {p_: _cover(rec['in'], rec['in_end'] - TRAIN_HALF - 3, rec['in_end'] + TRAIN_HALF + 3) for p_, rec in DEPOT_PATHS.items()}
    def _over(legs, own):
        cov = [c for i_, (pid, d0, d1, _r) in enumerate(legs) for c in _cover(pid, min(d0, d1) + (TRAIN_HALF if i_ == 0 else 0), max(d0, d1) - (TRAIN_HALF if i_ == len(legs) - 1 else 0))]
        return [q_ for q_, pk in _park.items() if q_ != own and any(e1 == e2 and a1 < b2 - 0.5 and a2 < b1 - 0.5 for (e1, a1, b1) in pk for (e2, a2, b2) in cov)]
    TEST['trip_blocks'] = {p_: _over(v['legs'], p_) for p_, v in TEST['trip'].items()}
    TEST['home_blocks'] = {q_: _over(v['legs'], q_) for q_, v in TEST['home'].items()}
    print('test loop: places in the way, going', {k: v for k, v in TEST['trip_blocks'].items() if v}, '| coming back', {k: v for k, v in TEST['home_blocks'].items() if v})
json.dump({'paths': [{'p': enc(p), 'd': [round(x, 1) for x in c]} for p, c in paths],
           'trains': [tl.segs for tl in out],
           'where': [[tl.start_where, tl.end_where] for tl in out],
           'alts': [ALTS.get(tl.k, []) for tl in out],
           'arr2': [ARR2.get(tl.k, []) for tl in out],
           'calts': [CALTS.get(tl.k, []) for tl in out],
           'pulls': [[PULL_PLAT[ti], dep] for ti, dep in ((tr['ti'], tr['dep']) for tr in pulls) if ti in PULL_PLAT],
           'labels': PLAT_LABELS,
           'platmap': PLATMAP,
           'boards': boards_out(),
           'stock': STOCK, 'duties': DUTIES, 'test': TEST, 'depot_paths': DEPOT_PATHS,
           'tracks': tracks, 'net': NET, 'path_edges': PATH_EDGES, 'speeds': (json.load(open(_rules)).get('speeds', {}) if os.path.exists(_rules) else {}), 'cuts': (json.load(open(_rules)).get('cuts', {}) if os.path.exists(_rules) else {}), 'ops': OPS, 'section': SECTION, 'throats': THROATS, 'blocks': BLOCKS, 'degraded': DEGRADED, 'dwell': (json.load(open('dwell_%s.json' % LINE.lower())) if os.path.exists('dwell_%s.json' % LINE.lower()) else None), 'reverse_s': REVERSE,
           'storage': len(storage), 'line': LINE, 'home': CFG['home'], 'far': CFG['far'], 'half': TRAIN_HALF},
          open(LINE.lower() + '.json', 'w'), separators=(',', ':'))
print(LINE.lower() + '.json written')

# --- diagnostics: trains present at each terminal at once ---
if __name__ == '__main__':
    for name, out_flag in (('Comasina', True), ('San Donato', False)):
        iv = []
        for chain in trains:
            for j in range(len(chain) - 1):
                if chain[j]['out'] == out_flag and not (not out_flag and chain[j+1]['dep'] - chain[j]['arr'] > LAYOVER_DEPOT):
                    iv.append((chain[j]['arr'], chain[j+1]['dep']))
        ev = sorted([(a, 1) for a, b in iv] + [(b, -1) for a, b in iv]); c = m = 0
        for t, d in ev: c += d; m = max(m, c)
        lay = sorted(b - a for a, b in iv) or [0]
        print(name, 'max trains present', m, 'layover median %.1f min, max %.1f' % (lay[len(lay)//2]/60, lay[-1]/60))

if __name__ == '__main__':
    for term_out, name in ((False, CFG['home']), (True, CFG['far'])):
        arr = sorted((tr['arr'], ENTRY.get(tr['ti'], tr['arr'] + DWELL_END)) for c in trains for tr in c if tr['out'] == term_out)
        block = [(a2, e1) for (a1, e1), (a2, e2) in zip(arr, arr[1:]) if e1 > a2 - 20]
        waits = sorted(e - a - DWELL_END for a, e in arr)
        print(name, 'arrival platform: held trains', sum(1 for w in waits if w > 5), 'longest hold %.1f min' % (waits[-1] / 60),
              '| next arrival blocked', len(block))

if __name__ == '__main__':
    # trains physically at the far terminal over the day (fixed by the timetable)
    ev = []
    for c in trains:
        for j, tr in enumerate(c):
            if tr['out']: ev.append((tr['arr'], 1))
            elif j > 0 or c[0]['train'] in NIGHT_COM_START or True: ev.append((tr['dep'], -1))
        if not c[0]['out']: ev.append((c[0]['dep'] - 600, 1))     # trains that start there
        if c[-1]['out'] and c[-1]['train'] not in NIGHT_COM_END: ev.append((c[-1]['arr'] + 400, -1))
    ev.sort(); n = 0; hist = collections.Counter(); peak = []
    for t, d in ev:
        n += d
        if n >= 5: peak.append('%02d:%02d' % (t // 3600 % 24, t // 60 % 60))
        hist[n] += 1
    print(CFG['far'], 'trains present at once (count of moments):', dict(sorted(hist.items())), 'times with 5+:', peak[:20])

if __name__ == '__main__' and os.environ.get('REPORT'):
    for name, is_out in ((CFG['home'], False), (CFG['far'], True)):
        lay = sorted(b_['dep'] - a_['arr'] for term, a_, b_ in turns if a_['out'] == is_out)
        print('%s turnarounds: %d, shortest %.1f min, median %.1f, longest %.1f' % (name, len(lay), lay[0] / 60, lay[len(lay) // 2] / 60, lay[-1] / 60))
    hd = sorted(b['dep'] - a['dep'] for a, b in zip(sorted(trips, key=lambda x: x['dep'])[::1], sorted(trips, key=lambda x: x['dep'])[1:]))
    ev = sorted([(tl.segs[0][3][0], 1) for tl in out] + [(max(s[3][-1] for s in tl.segs), -1) for tl in out])
    on = mx = 0
    for t, d in ev: on += d; mx = max(mx, on)
    svc = sorted([(tr['dep'], 1) for tr in trips] + [(tr['arr'], -1) for tr in trips]); c = m = 0
    for t, d in svc: c += d; m = max(m, c)
    print('trains in passenger service at the busiest moment:', m, '| trains out of the depot at the busiest moment:', mx)


