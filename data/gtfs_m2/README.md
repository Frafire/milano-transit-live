# GTFS extract: M2

Cut from the full ATM/AMAT feed by `tools/extract_gtfs.py`, so the project can be rebuilt without downloading
the whole feed (about 470 MB). Only the rows of these routes are kept; every file the build reads is here.

- Publisher: AMAT_Milan_feed (http://www.amat-mi.it)
- Feed version: 423, start 20260914, metro valid to 20261015
- Licence: CC BY 4.0, Comune di Milano / AMAT (see CREDITS.md)
- Rows: routes 1, trips 1314, stop_times 32571, stops 35, calendar 0, calendar_dates 36, shapes 3493

To use a newer timetable: download the full feed, then `python3 tools/extract_gtfs.py path/to/gtfs data/gtfs_m2 M2`.
