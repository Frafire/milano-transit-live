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

Needs Python 3.10+ (no extra packages), Node.js (for the engine test) and bash.

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

## Live engine (M3)

`web/engine.js` drives every M3 train second by second with acceleration, braking and speed limits, following the plan built in Python. The plan is "what should happen", the engine is "what happens"; `tests/engine_test.js` checks that with nothing going wrong no train is more than 30 s behind the plan and no run starts late. The track network the engine uses (track pieces, junctions, speed limits, signals) is exported into `m3.json` as `net`. Signalling notes for the next steps are in [`docs/m3-signalling.md`](docs/m3-signalling.md).

## Closing San Donato – Rogoredo (Player mode)

In the M3 control panel, under "Chiusura tratte", **Chiudi la tratta**: trains inside the section stop where they are, trains at San Donato stay there (depot moves are free), every other train unloads at Rogoredo, reverses beyond the crossover and starts its next run to Comasina from Rogoredo. Only one train at a time in the reversing stub. `tests/section_test.js` checks closures at several times of day.

Signals and ZUB (station-to-station running) are on hold until the signals can be placed and controlled. The pixel-art M3 signal icons stay in the project: `tools/signal_icons.py` and `web/assets/signals/` (red = stop, red + white = proceed, white = M1).

## Speed limits (M3)

Admin mode → Track editor → **Speed limits**. Pick a speed and click the M3 track pieces (from one junction to the next); trains use the new limit straight away. Fixed limits: 15 km/h over crossovers and on the diverging side of every junction (also when turning back), 15 km/h in the depot, 12.5 km/h in the tail tracks. Pieces not set yet use `line_max_kmh` (80). To limit only part of a piece, press **✂ Cut a piece** and click where the limit changes (click a cut mark again to remove it). **Copy all** exports the limits and cuts with the other edits; they go into `data/rules_m3.json` under `speeds` and `cuts`.

With speed limits the live engine drives like the ATO: as fast as allowed, then waits at the next stop. `tests/engine_test.js` reports how much time trains have in hand at stops, and warns when the limits make the timetable impossible.

## Train card

Click a metro train: the card shows its speed as the simulation calculates it, whether the doors are open or closed, and a short timetable (last stop, next two, destination). **Orario completo** shows every stop.

## Station stop times and the timetable check

`data/dwell_m3.json` sets how long trains stop: Duomo and Centrale 30–60 s, the busier stations (Rogoredo, Corvetto, Brenta, Lodi, Porta Romana, Crocetta, Missori, Montenapoleone, Turati, Repubblica, Zara, Maciachini) 15–25 s, the others 10–15 s; rush hours (7–9, 16–19) use the upper half of the range, a late train stops for the minimum. At intermediate stations the live engine leaves when the stop is over, not when the timetable says.

`tests/timetable_check.js` (run by the build) drives the whole day with these stop times and the speed limits, and says whether the ATM timetable can be respected. `tools/fit_center_speeds.js` filled the unset limits between Porta Romana and Repubblica from measured run times.

## Radio terra-treno (M3)

On an M3 train card, **📻 Radio al treno** opens a pixel-style radio. You are the Posto Centrale; everything is in Italian. Orders: a longer stop at the next station (30 s, 1 min, 1:30, 2 min, with a reason), the departure platform at San Donato, and platform 2 with reversal there coming from Rogoredo (refused if platform 2 is not free). The driver answers, then reports when he stops and when he leaves.

## Terminal junctions (San Donato, Comasina)

Between the platforms and the tail tracks only one train at a time may use the junction (incrocio); at San Donato the depot access to platform 1 is part of it, and platform 1 itself is one train at a time. A train waits on its platform, in the tail, or at the depot exit signal until the train in front has cleared the junction. When a train is leaving a tail and another is about to go into one within a minute, the one leaving goes first. The depot exit signal is a white/red dot (Admin → Segnali) you can drag to its real place; it is saved with the other edits.

## Station signals (placeholders)

Admin → M3 trains → **Segnali** (zoom 17+): M3 is *banalizzata*, so every station has a departure signal at both ends of both tracks. For now they only show an aspect and do not control trains: red + white when the line to the next station is free in the usual direction, otherwise red; signals for running the wrong way stay red.

## Changing how M3 runs

The M3 operating rules live in [`data/operations_m3.json`](data/operations_m3.json): stop time at stations, unloading time at the terminus, platform wait, minimum turnaround, tail and depot speeds. Change a number (you can do it on github.com with the pencil icon), run `./build.sh` again and the whole day is re-planned. The build stops with an error if a change breaks a rule (two trains in a tail or on a depot track).

## Adding track rules and signals

In the game, Admin mode → Track editor. Mark tracks and place signals, then **Export** and paste the `MTL-EDIT {...}` text into an issue or into `data/rules_m3.json`, and rebuild.
