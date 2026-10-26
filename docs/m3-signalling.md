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
