# M3 turnback points and closable sections

From Giovanni (source: Italian Wikipedia, "Linea M3"). Stations with a crossover where trains can reverse (posti di inversione):

| Station | Notes |
|---|---|
| Comasina | terminus (tails) |
| Maciachini | |
| Sondrio | |
| Centrale FS | |
| Repubblica | |
| Porta Romana | |
| Lodi TIBB | |
| Brenta | only towards Comasina; rarely used (limited) |
| Rogoredo FS | crossover on the San Donato side of the station (done: short turns when San Donato–Rogoredo is closed) |
| San Donato | terminus (tails, depot) |

## Closable sections

Any stretch between two turnback points can be closed. Giovanni's first list:

1. Rogoredo FS – San Donato (done)
2. Lodi TIBB – Rogoredo FS
3. Lodi TIBB – San Donato
4. Porta Romana – Repubblica (here the two tracks are stacked one above the other)

The goal is to compute **every possibility**: for each pair of turnback points A (Comasina side) and B (San Donato side):

- trains inside A–B stop;
- the Comasina side runs Comasina ↔ A, reversing at A;
- the San Donato side runs B ↔ San Donato, reversing at B (only if B's crossover works in that direction; Brenta works only towards Comasina), with the depot still reachable;
- each turnback point lets one train at a time reverse.

## Work needed

- Find each crossover in the OpenStreetMap tracks (osm_m3) and check its direction (which way a train can cross).
- Generalise the closure code (`closePlan` in `web/engine.js`) from the fixed San Donato–Rogoredo case to any pair A–B, including the second shuttle on the San Donato side.
- Test every pair at several times of day (no two trains reversing at once, nobody moving inside the closed section).
