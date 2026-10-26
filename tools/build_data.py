"""Turn Milan GTFS into a compact JSON for one service day."""
import csv, json, math, sys, collections

SRC, DAY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LAT0 = math.radians(45.46)
KX = 111320 * math.cos(LAT0)
KY = 110540

def rd(name):
    return csv.DictReader(open(f"{SRC}/{name}", encoding="utf-8-sig"))

# active services
active = set()
for r in rd("calendar.txt"):
    pass  # empty in this feed
for r in rd("calendar_dates.txt"):
    if r["date"] == DAY and r["exception_type"] == "1":
        active.add(r["service_id"])

routes = {}
for r in rd("routes.txt"):
    routes[r["route_id"]] = r

trips = {}
for r in rd("trips.txt"):
    if r["service_id"] in active:
        trips[r["trip_id"]] = (r["route_id"], r["shape_id"], r["trip_headsign"])
print("trips", len(trips), file=sys.stderr)

def hms(s):
    h, m, x = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(x)

st = collections.defaultdict(list)
for r in csv.reader(open(f"{SRC}/stop_times.txt", encoding="utf-8-sig")):
    t = trips.get(r[0])
    if t is None:
        continue
    st[r[0]].append((int(r[4]), hms(r[1]), hms(r[2]), r[3]))
print("stop_times loaded", file=sys.stderr)

stops = {}
for r in rd("stops.txt"):
    stops[r["stop_id"]] = (r["stop_name"], float(r["stop_lat"]), float(r["stop_lon"]))

used_shapes = {t[1] for t in trips.values()}
shp = collections.defaultdict(list)
for r in rd("shapes.txt"):
    if r["shape_id"] in used_shapes:
        shp[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))

def xy(lat, lon):
    return ((lon - 9.19) * KX, (lat - 45.46) * KY)

def simplify(pts, tol):
    # Douglas-Peucker on xy tuples, returns index list
    if len(pts) < 3:
        return list(range(len(pts)))
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [i for i, k in enumerate(keep) if k]

shape_out, shape_idx, shape_geo = [], {}, {}
for sid in sorted(used_shapes):
    pts = sorted(shp.get(sid, []))
    if len(pts) < 2:
        continue
    ll = [(p[1], p[2]) for p in pts]
    xys = [xy(*p) for p in ll]
    keep = simplify(xys, 3.0)
    ll = [ll[i] for i in keep]; xys = [xys[i] for i in keep]
    cum = [0.0]
    for i in range(1, len(xys)):
        cum.append(cum[-1] + math.hypot(xys[i][0] - xys[i - 1][0], xys[i][1] - xys[i - 1][1]))
    shape_idx[sid] = len(shape_out)
    shape_geo[sid] = (xys, cum)
    flat, plat, plon = [], 0, 0
    for lat, lon in ll:
        a, b = round(lat * 1e5), round(lon * 1e5)
        flat += [a - plat, b - plon]; plat, plon = a, b
    shape_out.append({"p": flat, "d": [round(c) for c in cum]})

def project(sid, stop_ids):
    xys, cum = shape_geo[sid]
    res, seg0 = [], 0
    for s in stop_ids:
        _, lat, lon = stops[s]
        px, py = xy(lat, lon)
        best, bd, bseg = 1e18, 0, seg0
        for i in range(seg0, len(xys) - 1):
            ax, ay = xys[i]; bx, by = xys[i + 1]
            dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
            t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d < best - 1:
                best, bd, bseg = d, cum[i] + t * math.sqrt(L), i
            if best < 900 and cum[i] > bd + 400:
                break
        res.append(round(bd)); seg0 = bseg
    return res

route_list = sorted({t[0] for t in trips.values()},
                    key=lambda r: (int(routes[r]["route_type"]) != 1, int(routes[r]["route_type"]) != 0, r))
route_idx = {r: i for i, r in enumerate(route_list)}
route_out = []
for r in route_list:
    R = routes[r]
    rt = int(R["route_type"])
    color = R["route_color"].strip()
    if rt == 1 and r in ("M1", "M2", "M3", "M4", "M5"):
        color = {"M1": "e3001b", "M2": "16a34a", "M3": "f5c400", "M4": "0057b8", "M5": "8e5ea2"}[r]
    route_out.append({"id": r, "n": R["route_short_name"] if rt != 1 else r,
                      "l": R["route_long_name"].strip(), "t": rt, "c": color})

heads, head_idx = [], {}
proj_cache = {}
trip_out = []
stop_used = {}
for tid, rows in st.items():
    rid, sid, hs = trips[tid]
    if sid not in shape_idx:
        continue
    rows.sort()
    ids = tuple(r[3] for r in rows)
    key = (sid, ids)
    if key not in proj_cache:
        proj_cache[key] = project(sid, ids)
    dists = proj_cache[key]
    # event list: arrival & departure at each stop
    ts, ds, ss = [], [], []
    for (seq, arr, dep, s), d in zip(rows, dists):
        if s not in stop_used:
            stop_used[s] = len(stop_used)
        ts.append(arr); ds.append(d); ss.append(stop_used[s])
        if dep != arr:
            ts.append(dep); ds.append(d); ss.append(-1)
    if hs not in head_idx:
        head_idx[hs] = len(heads); heads.append(hs)
    # delta encode
    dt = [ts[0]] + [ts[i] - ts[i - 1] for i in range(1, len(ts))]
    dd = [ds[0]] + [max(0, ds[i] - ds[i - 1]) for i in range(1, len(ds))]
    trip_out.append([route_idx[rid], shape_idx[sid], head_idx[hs], dt, dd, ss])

trip_out.sort(key=lambda t: t[3][0])
stop_out = [None] * len(stop_used)
for s, i in stop_used.items():
    n, lat, lon = stops[s]
    stop_out[i] = [n, round(lat, 5), round(lon, 5)]

json.dump({"day": DAY, "routes": route_out, "shapes": shape_out, "heads": heads,
           "stops": stop_out, "trips": trip_out}, open(OUT, "w"), separators=(",", ":"))
print("done trips", len(trip_out), "shapes", len(shape_out), "stops", len(stop_out), file=sys.stderr)
