"""Cut a small GTFS out of the full ATM/AMAT feed: only the routes we simulate (default M3).

The full feed is about 470 MB (stop_times.txt alone 440 MB), too big for the repository. The extract keeps every
file the build reads, with only the rows of these routes, so the build gives the same result for them and anyone
can rebuild the project without downloading the whole feed.

Usage: python3 tools/extract_gtfs.py path/to/full/gtfs data/gtfs_m3 [ROUTE_ID ...]
Data: Comune di Milano / AMAT, CC BY 4.0 (see CREDITS.md).
"""
import csv, os, sys

src, dst = sys.argv[1], sys.argv[2]
routes = set(sys.argv[3:]) or {'M3'}
os.makedirs(dst, exist_ok=True)


def rows(name):
    f = open(os.path.join(src, name), encoding='utf-8-sig', newline='')
    r = csv.reader(f)
    return next(r), r


def write(name, header, data):
    with open(os.path.join(dst, name), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator='\n')
        w.writerow(header); n = 0
        for row in data: w.writerow(row); n += 1
    return n


def keep(name, col, values):
    h, r = rows(name); i = h.index(col)
    return write(name, h, (x for x in r if x[i] in values))


counts = {}
h, r = rows('routes.txt'); i = h.index('route_id')
counts['routes'] = write('routes.txt', h, (x for x in r if x[i] in routes))
h, r = rows('trips.txt'); ir, it, isv, ish = h.index('route_id'), h.index('trip_id'), h.index('service_id'), h.index('shape_id') if 'shape_id' in h else None
trips = [x for x in r if x[ir] in routes]
trip_ids = {x[it] for x in trips}; services = {x[isv] for x in trips}; shapes = {x[ish] for x in trips} if ish is not None else set()
counts['trips'] = write('trips.txt', h, trips)
h, r = rows('stop_times.txt'); i, js = h.index('trip_id'), h.index('stop_id')
stop_ids = set()
def st():
    for x in r:
        if x[i] in trip_ids: stop_ids.add(x[js]); yield x
counts['stop_times'] = write('stop_times.txt', h, st())
# stations used by these stops (parent_station) are kept too
h, r = rows('stops.txt'); i = h.index('stop_id'); ip = h.index('parent_station') if 'parent_station' in h else None
allstops = list(r)
parents = {x[ip] for x in allstops if ip is not None and x[i] in stop_ids and x[ip]}
counts['stops'] = write('stops.txt', h, (x for x in allstops if x[i] in stop_ids or x[i] in parents))
counts['calendar'] = keep('calendar.txt', 'service_id', services)
counts['calendar_dates'] = keep('calendar_dates.txt', 'service_id', services)
if shapes: counts['shapes'] = keep('shapes.txt', 'shape_id', shapes)
for name in ('agency.txt', 'feed_info.txt'):
    h, r = rows(name); write(name, h, r)
h, r = rows('feed_info.txt'); info = dict(zip(h, next(r, [])))
with open(os.path.join(dst, 'README.md'), 'w') as f:
    f.write(f"""# GTFS extract: {', '.join(sorted(routes))}

Cut from the full ATM/AMAT feed by `tools/extract_gtfs.py`, so the project can be rebuilt without downloading
the whole feed (about 470 MB). Only the rows of these routes are kept; every file the build reads is here.

- Publisher: {info.get('feed_publisher_name', '?')} ({info.get('feed_publisher_url', '')})
- Feed version: {info.get('feed_version', '?')}, start {info.get('feed_start_date', '?')}, metro valid to {info.get('mm_end_date', '?')}
- Licence: CC BY 4.0, Comune di Milano / AMAT (see CREDITS.md)
- Rows: {', '.join(f'{k} {v}' for k, v in counts.items())}

To use a newer timetable: download the full feed, then `python3 tools/extract_gtfs.py path/to/gtfs data/gtfs_m3`.
""")
print('extract written to', dst, counts)
