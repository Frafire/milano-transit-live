# Milano Transit Live

A free, open-source simulation of Milan's public transport on a satellite map, growing into a game where you run the network: faults, held trains, closed sections, signals and junctions.

**Unofficial fan project, not affiliated with ATM.** No ads, nothing to buy. Code under GPL-3.0; data credits in [CREDITS.md](CREDITS.md).

## Play

Open `docs/index.html` in Chrome or Firefox. Once GitHub Pages is switched on (Settings → Pages → branch `main`, folder `/docs`), the game is online at the repository's Pages link.

## What works today

- Every metro, tram and bus vehicle in Milan moving from the published weekday timetable (service day 03:00–02:59).
- **M3 in depth:** real tracks and junctions, San Donato and Comasina terminal rules, depot with parking places and the test loop (anello di prova), the real 24-train fleet, station boards in Italian.
- **M4:** tracks, San Cristoforo depot, real fleet 4401–4447. **M1:** trains on real tracks.
- **Buses 130 and 64:** 18 m articulated vs 12 m buses; line 64 stops show an ATM-style waiting-time display and the stop timetable.
- **Admin / Player modes:** the player gets the M3 control panel and can order a train from Rogoredo onto platform 2 to reverse there.
- **Track editor:** mark track use and direction, place signals, draw missing tracks, export the result.

The plan is in [`docs/planning/milano-transit-live-roadmap.xlsx`](docs/planning/milano-transit-live-roadmap.xlsx). Next up: a live engine in the browser with block sections from the placed signals, and the first scenario (fault San Donato–Rogoredo).

## Build it yourself

Needs Python 3.10+ (no extra packages) and bash.

1. Download the GTFS zip from the Comune di Milano open data portal (dataset "Orari del trasporto pubblico locale nel Comune di Milano in formato GTFS") and unzip it, for example into `gtfs/` (ignored by git).
2. Run `./build.sh gtfs` (optionally add a service day as `YYYYMMDD`).
3. The game is written to `docs/index.html`. The build also runs the checks in `tests/`: no tail track ever holds two trains, no depot track ever holds two trains.

## Layout

| Folder | What is in it |
|---|---|
| `web/` | The page (`template.html`) and Leaflet |
| `tools/` | Python build steps: timetable → compact JSON, track router, M3/M4 operations (`build_line.py`), M1 (`build_trips.py`), buses (`build_bus.py`), real fleets, page assembly |
| `data/` | Metro tracks from OpenStreetMap and the track rules and signals from the editor |
| `tests/` | Checks run by the build |
| `docs/` | The built game (served by GitHub Pages) and planning files |

## Changing how M3 runs

The M3 operating rules live in [`data/operations_m3.json`](data/operations_m3.json): stop time at stations, unloading time at the terminus, platform wait, minimum turnaround, tail and depot speeds. Change a number (you can do it on github.com with the pencil icon), run `./build.sh` again and the whole day is re-planned. The build stops with an error if a change breaks a rule (two trains in a tail or on a depot track).

## Adding track rules and signals

In the game, Admin mode → Track editor. Mark tracks and place signals, then **Export** and paste the `MTL-EDIT {...}` text into an issue or into `data/rules_m3.json`, and rebuild.
