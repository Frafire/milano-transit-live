# M3 signalling — notes for the engine

From Giovanni (source: Italian Wikipedia, "Metropolitana di Milano", signalling section).

- **System:** Siemens LZB 700M, **fixed block**, since the line opened. ATP (automatic train protection) and ATO (automatic train operation): departure, stopping, spacing and speed are handled on board from information sent by the ground systems. Line signals exist anyway.
- **Driver:** opens and closes the doors and gives the start consent. Drives by hand only for unexpected situations (people or objects on the track) or when the signalling or the train fails.
- **Two ATP modes:**
  - *continuous ATP*: normal running, line state received continuously;
  - *discontinuous ATP* ("ZUB"): used only for the first run of the two trains leaving each terminus, or when the continuous system is degraded. It works station to station (marcia interstazionale), reading loops placed before the departure signals in stations and service points.
- **Signal aspects on M3** (two lights, red and white):
  - red: stop (via impedita imperativa);
  - red + white: proceed (via libera on M3; on M1 the same aspect means conditional proceed);
  - white alone: used only on M1 (proceed with station-to-station running).
- **Depot:** shunting signals; 15 km/h maximum everywhere in the depot except the anello di prova.

## How the game uses this

- Step 3: block sections between signals; one train per block; signal shows red or red + white.
- Degraded mode (fault scenarios): ZUB station-to-station running — a train may only enter the section between two stations when the whole section is free, so headways stretch to several minutes.

## Block scheme (October 2026)

- Two kinds of signal only: standard (blocco / ATP) and shunting (manovra).
- Along the line, each station and direction has two signals: the entry (protection) signal where the tunnel ends, and the departure signal just past the platform. Sections are [tunnel] → [station].
- A signal placed on the map (standard, facing the train) replaces the computed one when it is near: departure within −15/+40 m, entry within 120 m before the platform. Placed signals in the middle of a tunnel add a section. A stretch longer than 1 km with no placed signal is cut in equal parts (exception: San Donato – Rogoredo).
- A signal shows via libera as soon as its section (and the junction or tail just behind it) is free. Trains never enter an occupied section.
- Other placed signals (terminal junctions, tails, depot) show the state of the track ahead of them, up to the next signal facing the same way or 300 m.
- Via impedita: a train that should be moving by the timetable but is stopped at a red signal calls the DCO on the radio. It calls at once in the tunnel, 30 s past its departure at a platform, and after 45 s in tails and terminal junctions. For now nobody answers. The train moves again when the signal clears, and says so. About 50 calls on a normal weekday.

## One engine (October 2026)

The M3 trains on the page are always driven by `web/agents.js`. In normal service each train follows its own day from the timetable as a reference: it never leaves a station early, it uses the same station stop times and radio extras as before, and when late it drives as fast as allowed. The signal and spacing rules are the same as in a closure.

The day computed in advance (`engine.js`, `m3_live.json`) is used only to place the trains when the page opens, or when the clock jumps while nothing has happened yet. The block planner keeps at least 90 s between non-service movements and targets 120 s when passenger service is involved; the live agents apply the same minimum at station departures. Empty depot dispatches have no published timetable and keep a 12-minute recovery reserve to be ready for their next passenger run.

**Time line:**
- The state of all trains is saved every 10 minutes and before every event (closure, reopening, radio order).
- Going back in time restores the last saved state and drives on from there. Later events are applied again when their time comes.
- A new event drops what came after it (a new branch of the day).
- Changes to a train's day by radio (platform, tail, test loop) are not undone by going back.
- Known issue: after reopening Rogoredo – San Donato, trains can lock each other in the San Donato junction (one going into a tail, one coming out). The other seven closures are clean.

**Test:** `tests/day_agents_check.js`. It drives the normal day with the agents, checks that no two trains are ever on the same track piece and that nobody gets stuck, compares punctuality with the computed day, and checks that going back in time gives the same positions again.

## Line closures: emergency mode (October 2026)

Computing a new conflict-free day in advance after a closure ran into deadlocks. So closing a stretch switches every M3 train to `web/agents.js`: each train drives itself every half second and looks only at what is in front of it.

- **Signals:** a train never passes a red signal. That means a block section, a terminal junction, a tail or a turn-back crossover held by another train.
- **Other trains:** it never runs into another train. It checks the real track pieces, so this also holds when reversing over a crossover.
- **Shuttles:** the open parts of the line run without a timetable. A train leaves when the signal is green and the train in front left that station at least 120 s earlier.
- **Turning back:** at the station next to the closure the train turns back over a crossover, prepared at build time:
  - A: on beyond the crossover, change cab, back into the other platform;
  - B: across before the station, arriving on the other track;
  - C: backwards over a crossover close behind the station.

  One train at a time uses each crossover area (a "lock"). If a turn back is not possible, the train goes on empty to the next closed station and waits there.
- **Termini:** at San Donato and Comasina the train takes a free tail.
- **Trains caught inside:** they stop at the next station and call the PC. By radio the PC can send them on empty to the next station, or back to the depot (towards San Donato only).
- **Reopening:**
  - 20 km/h for 2 minutes;
  - every run then takes the times of a timetable run from the next station: never more than a minute early, and if late it catches up;
  - more than 10 minutes late, the driver asks the PC for skipped stops, a shortened run or the depot.
- **"Torna all'orario":** puts every train back on its planned day.
- **Red signals:** a train calls the PC only after 5 minutes held at the same signal.
- **Empty trains** (not in service) pass the platforms at 40 km/h, in normal service too.
- **Test:** `tests/agents_check.js` (one closure, 08:00–10:00, in a few seconds).

## Placed signals and removing them

- A train held by a busy section stops just before the placed signal that protects it (up to 150 m before the
  section), never with its body in a junction or a turn-back area. A train standing a few metres past a signal (the
  short San Donato tails) stays where it is instead of creeping to the junction.
- A placed signal shows red when the section that starts at it (within 150 m ahead) is occupied.
- "Togli semafori" in the editor hides signals with a click; the MTL-EDIT export lists them under `removed`.
  Copied into `data/rules_m3.json` as `removed_signals`, the build drops them and merges their sections.
