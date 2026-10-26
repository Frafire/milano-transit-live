"""Station stops: GTFS gives one time per station. Treat it as the departure time and let
the train arrive 30 s earlier (Giovanni: trains stop 30 s at every station)."""
DWELL = 30
MIN_RUN = 30   # never squeeze the run from the previous station below this

def add_dwell(events, dwell=DWELL, min_run=MIN_RUN):
    """events: list of (time, stop) in order, one or two per stop. Returns (time, stop) with an
    arrival and a departure at every intermediate stop. First stop: departure only; last: arrival."""
    per = []
    for t, s in events:
        if per and per[-1][0] == s: per[-1][2] = t        # existing arr/dep pair
        else: per.append([s, t, t])
    out = []
    for i, (s, arr, dep) in enumerate(per):
        if 0 < i < len(per) - 1 and dep - arr < dwell:
            arr = max(out[-1][0] + min_run, dep - dwell)
            arr = min(arr, dep)
        if i == 0: out.append((dep, s))
        elif i == len(per) - 1: out.append((arr, s))
        else: out += [(arr, s), (dep, s)]
    return out
