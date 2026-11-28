# Milano Transit Live

A free, open-source simulation of Milan's public transport that is growing into a game. You are the **Posto Centrale** (the DCT) of metro line M3: trains run by themselves from the real ATM timetable, and you deal with what goes wrong: faults, closed stretches, signals, the depot, the radio.

**Unofficial fan project, not affiliated with ATM.** No ads, nothing to buy. Code under GPL-3.0; data credits in [CREDITS.md](CREDITS.md).

## Play

Online: <https://frafire.github.io/milano-transit-live/> (GitHub Pages, branch `main`, folder `/docs`). Or open `docs/index.html` in Chrome or Firefox.

The menu (Gioca! → Metro → line) opens the game, `docs/gioca.html?linee=M3`. What can be opened is in [`data/linee.json`](data/linee.json):

- **M3**: playable, with today's timetable and two historical ones (Expo 2015 and Milano Cortina 2026, `gioca.html?linee=M3&orario=expo2015`).
- **M2**: "in test", trains on the real tracks from the timetable, no signals or depots in the running yet (see below).
- Everything else (M1, M4, M5, tram, bus): grey, "In arrivo".

The game is in Italian.

## What the M3 does today

- **Live engine in the browser.** Every train is an agent with acceleration, braking and ATO-style driving, moved second by second (`web/agents.js`, `web/engine.js`). The timetable says what should happen, the engine what happens.
- **Timetable and days.** Weekday, Saturday and Sunday from the ATM GTFS. At 3:00 the next day starts without reloading the page, and trains start again from where they ended (Comasina tails, San Donato, their place in the depot). Each tabella keeps one train for the whole day; the real fleet, with a panel (Turni del giorno) to change which train takes which tabella.
- **Signals and interlocking.** Every signal of the line, the itineraries worked out from the track at build time (`data/itineraries_m3.json`), switches, timings and priorities. A train moves only on a route the interlocking has set.
- **Synoptic boards.** One for the line and one for the Rogoredo depot (ROD), drawn like the real ACEI board, with its buttons: start signal, then arrival, then the way is cleared.
- **Rogoredo depot.** Parking places in the sheds, workshop, wash, the test loop (anello di prova), the Badoni locomotive that goes out to rescue a failed train.
- **Closures.** A stretch closed with trains turning back at its ends, single-track running, shuttles, trains put away in a tail or in a siding (ricovero) on the DCT's order, the whole line closed, Rosso totale, and the reopening: trains take the free runs of the timetable until the service is regular again.
- **Faults.** Train failures and re-arming, rescue, signal and switch failures, people on the tracks, orders of the Prefettura, strikes with the guaranteed bands (`web/faults.js`). They can be started by hand or come at random.
- **Radio.** To the trains and to the station agents (`web/radio.js`). Every phrase is in the Radio sheet of the rules Excel, not in the code.
- **Regolatore panel.** The timetable as departures to cover: take a train out of service, call a reserve from the depot.
- **Admin mode.** Track editor (track use and direction, signals, missing tracks, export), speed limits, time slider. Player mode is the game.

## How it is built: three levels

1. **Itineraries**: what is possible. Worked out from the track by `tools/itineraries.py`.
2. **Regolatore**: what to choose. The programme of each tabella, and the player.
3. **Interlocking**: whether it is safe. `web/routes.js` on the line, `web/interlocking.js` in the depot.

**The operating rules are in an Excel file, not in the code**: [`data/Regole_interlocking_M3.xlsx`](data/Regole_interlocking_M3.xlsx) (sheets Tempi, Semafori, Itinerari, Precedenze, Chiusure, Ricoveri, Tratte parallele, Pannello PC, Guasti, Radio, Schema chiamate, Situazioni). `python3 tools/rules_from_excel.py` (needs `openpyxl`) writes `data/regole_m3.json` and `data/radio_m3.json`, which the build reads. Rows marked PROPOSTA are proposals still to be confirmed by someone who knows the line.

Other data you can change:

- [`data/operations_m3.json`](data/operations_m3.json): speeds (line 80 km/h, diverging side of a switch 15, depot and tails 15, sheds 5, wrong way 30), braking, times at the terminus.
- `data/dwell_m3.json`: how long trains stop at each station, longer in the rush hours.
- `data/rules_m3.json`: track use, signals, speed limits and cuts from the track editor (Admin → Track editor → **Copy all**, then paste the `MTL-EDIT {...}` text into the file or into an issue).
- `data/schema_deposito_m3.json`, `data/sinottico_linea_m3.json`: the two boards.

After any change run `./build.sh`: the whole day is planned again and the checks say if a rule is broken.

## Build it yourself

Needs Python 3.10+, Node.js and bash. Optional: Playwright (the checks of the page in a headless browser; skipped without it), ESLint (the lint check; skipped without it), `openpyxl` (only to read the Excel files again).

1. Run `./build.sh`. It uses `data/gtfs_m3/`, an M3-only extract of the ATM/AMAT GTFS kept in the project (feed version and dates in its README), so the build is the same for everyone. A service day can be given as second argument: `./build.sh data/gtfs_m3 YYYYMMDD`.
2. It takes 40–50 minutes with the page checks: the weekday, Saturday, Sunday, the two historical timetables and the M2, each with its day driven by the agents and its checks.
3. Output: the menu in `docs/index.html`, the game in `docs/gioca.html`, the data in `docs/dati/` (one file per line and kind of day: `m3_1.js` weekday, `m3_6.js` Saturday, `m3_7.js` Sunday; the game loads only the line chosen in the menu).
4. For a newer timetable: download the full GTFS zip from the Comune di Milano open data portal (dataset "Orari del trasporto pubblico locale nel Comune di Milano in formato GTFS", about 470 MB unzipped), unzip it into `gtfs/` (ignored by git), then `python3 tools/extract_gtfs.py gtfs data/gtfs_m3` and `./build.sh`. `ALL_LINES=1 ./build.sh gtfs` also builds M4, M1 and bus lines 130 and 64, which are not in the menu yet.

### Checks

The build stops if a check fails. In `tests/`:

- the plan: tails and depot tracks never hold two trains, the timetable can be kept with the speed limits and stop times;
- the engine: a normal day driven by the agents with no train late, no signal passed without a route, itineraries and rules as in the Excel;
- the game on the engine: closures and reopenings, orders to trains in a closed stretch, sidings, faults, two whole days played by a DCT who goes along (an investimento with San Donato closed, a strike with the whole line closed);
- the page in a headless browser: about 40 scenarios (`tests/page_check.js`), the menu, the boards;
- the texts: no radio phrase left in the code, the radio files up to date with the Excel.

Two checks only warn: `lavaggio` (page) and the changes of cab beyond their signal (`tests/cambio_banco_check.js`). The historical timetables only warn too.

## M2 (in test, tappa 1)

The menu opens the M2 marked "In test": every run of the weekday, Saturday or Sunday timetable moves on the real
tracks (as the M1, `tools/build_trips.py`), and the track editor works on the M2 tracks (Admin → Track editor: mark
use and direction, place signals, draw missing tracks, export). No depots, turns or signals in the running yet.
Everything M2 is in its own files, so the M3 build does not change:

- `data/gtfs_m2/`: the M2 extract of the same ATM/AMAT feed as `data/gtfs_m3/` (version 423).
- `tools/turni_m2.py` links the runs into trains (turni): a run arriving at a terminus takes the next run leaving
  the same terminus if it leaves within `turni_link_max_min` minutes (and not before `turni_link_min_min`) of
  `data/operations_m2.json`; otherwise the train goes to the depot. Branch choices and two trains for one departure
  are listed as ambiguous, not solved. A proposal, to be checked against how the M2 really runs.
- `tests/m2_check.py`: every run in one turno, links at the right terminus and within the limits.
- `tools/assemble_m2.py`: the M2 data files `docs/dati/m2_1.js`, `m2_6.js`, `m2_7.js`, called by `tools/assemble.py`.
- `data/osm_m2.txt`: the M2 tracks from OpenStreetMap (Overpass export of 3 Nov 2026, 401 ways: line, the four
  branches, Cascina Gobba, the depots of Gorgonzola, Cologno Nord and Famagosta, the links to M1, M3 and M5), made
  by `tools/osm_to_txt.py` (the query is in that file), checked by Giovanni.
- `data/osm_m2_platforms.json`: the M2 platforms from OpenStreetMap (34 at 17 stations, e.g. Cascina Gobba: two side
  platforms and the island in the middle, all four tracks), made by `tools/osm_platforms.py` from an Overpass export of
  the platforms; the other stations get the 110 m platforms the build draws by itself.
- **M2 signals in the track editor** (Admin → Track editor → Signals, on the M2 page): Semaforo, Manovra (low, as at
  San Donato), Fermata, Bandiere, Taglio. A semaforo also carries galleria / superficie (a switch: the head with three
  lamps, or one or two velas on a pole), the lettera P (luminosa, fissa, nessuna, on the same side as the signal) and
  legale / illegale (from the way the track is run, right-hand running: legale vela tonda and name ending in a,
  illegale vela quadra and b; the editor warns when a signal stands on the unusual side). Names: galleria S + 3 digits
  + a/b, superficie POSTO + number + a/b. Roles (blocco, partenza, protezione...) come later from
  `data/Regole_M2.xlsx`. Copy all, then `python3 tools/import_edit_m2.py export.txt` puts the M2 part into
  `data/rules_m2.json` (never into the M3's file); `tests/m2_signals_check.py` checks every signal in the build.
- `data/osm_m2_fix.json`: Giovanni's corrections to the OSM tracks (kind of track, tunnel / surface / covered
  station), by OSM way id, so a new export keeps them. `tools/osm_to_txt.py` applies them after every conversion;
  `python3 tools/osm_fix.py data/osm_m2.txt data/osm_m2_fix.json` applies them to the file as it is.

## Layout

| Folder | What is in it |
|---|---|
| `web/` | The menu (`home.html`), the game page (`template.html`), the engine (`agents.js`, `engine.js`), the interlockings (`routes.js`, `interlocking.js`), faults, depot, radio |
| `tools/` | Build steps: timetable → compact JSON (`build_data.py`), the M3 plan (`build_line.py`), itineraries, the boards (`sinottico.py`, `schema_deposito.py`), rules from the Excel, the day driven by the agents (`precompute_live.js`), page assembly (`assemble.py`), the M2 tools |
| `data/` | Tracks from OpenStreetMap, the rules Excel and the files made from it, operating numbers, fleets, the GTFS extracts, the historical timetables (`storico/`) |
| `tests/` | Checks run by the build |
| `docs/` | The built game (served by GitHub Pages), notes on the M3 signalling ([`m3-signalling.md`](docs/m3-signalling.md), [`m3-turnback-points.md`](docs/m3-turnback-points.md)) and the roadmap |

## Roadmap

[`docs/planning/roadmap.md`](docs/planning/roadmap.md) and the Excel next to it, both made by `python3 tools/roadmap.py`. In short: finish the M3 game (DCT panel, score), then the M2 with its depots and signals, then the other metro lines, buses, drivers' shifts and trams.

## Real data

Tracks come from OpenStreetMap and the timetable from the ATM/AMAT feed. Signals, depot places, operating rules and procedures come from people who worked on the line; nothing of that kind is made up, and what is still a guess is marked as a proposal (PROPOSTA) in the Excel. Corrections are welcome: open an issue.
