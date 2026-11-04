#!/usr/bin/env bash
# Build the game from the ATM timetable (GTFS) and the track files in data/.
# Usage: ./build.sh [path/to/unzipped/gtfs] [YYYYMMDD service day]
# Without a path it uses data/gtfs_m3, the M3 extract kept in the project (feed version in its README).
# ALL_LINES=1 also builds M1, M4 and the buses: that needs the full feed (path to it as first argument).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
GTFS="$(cd "${1:-$ROOT/data/gtfs_m3}" && pwd)"
DAY="${2:-20260923}"
B="$ROOT/build"; mkdir -p "$B"
find "$ROOT/data" -maxdepth 1 -type f -exec cp {} "$B"/ \;
export PYTHONPATH="$ROOT/tools" GTFS
cd "$B"
echo "== timetable for service day $DAY"
python3 "$ROOT/tools/build_data.py" "$GTFS" "$DAY" data.json
gzip -9 -kf data.json
echo "== M3";  LINE=M3 python3 "$ROOT/tools/build_line.py" > m3.log
if [ -n "${ALL_LINES:-}" ]; then
  echo "== M4";  LINE=M4 python3 "$ROOT/tools/build_line.py" > m4.log
  echo "== M1";  LINE=M1 TRACKS=osm_m1.txt python3 "$ROOT/tools/build_trips.py" > m1.log
  echo "== bus 130"; ROUTE=B130 SIZE=18 python3 "$ROOT/tools/build_bus.py"
  echo "== bus 64";  ROUTE=B64 SIZE=12 DISPLAY=1 python3 "$ROOT/tools/build_bus.py"
fi
grep -h "tail clashes\|not covered\|test loop" m3.log || true
echo "== normal day driven by the agents"
node "$ROOT/tools/precompute_live.js"
echo "== tests"
python3 "$ROOT/tests/check_tails.py"
python3 "$ROOT/tests/check_depot.py"
node "$ROOT/tests/engine_test.js"
node "$ROOT/tests/day_agents_check.js" 5 24
node "$ROOT/tests/interlocking_check.js" 5 24
node "$ROOT/tests/timetable_check.js"
python3 "$ROOT/tests/itineraries_check.py"
node "$ROOT/tests/routes_rules_check.js"
node "$ROOT/tests/closures_check.js"
node "$ROOT/tests/c1_check.js"
node "$ROOT/tests/radio_check.js"
python3 "$ROOT/tests/schema_check.py"
node "$ROOT/tests/pc_check.js"
node "$ROOT/tests/instr_check.js"
node "$ROOT/tests/illegal_sd_check.js"
node "$ROOT/tests/faults_check.js"
node "$ROOT/tests/headway_check.js" || echo "WARNING: trains closer than 2 minutes"
# Saturday and Sunday: their own service days of the same feed (GTFS s_ and f_), built the same way next to build/
# (SAT_DAY, SUN_DAY: a Saturday and a Sunday of the feed); the main checks of the day driven by the agents on them
SAT_DAY="${SAT_DAY:-20260919}"; SUN_DAY="${SUN_DAY:-20260920}"
for pair in "sat:$SAT_DAY" "sun:$SUN_DAY"; do
  n="${pair%%:*}"; d="${pair##*:}"; BD="$ROOT/build_$n"; mkdir -p "$BD"
  find "$ROOT/data" -maxdepth 1 -type f -exec cp {} "$BD"/ \;
  echo "== $n: timetable for service day $d"
  (cd "$BD" && python3 "$ROOT/tools/build_data.py" "$GTFS" "$d" data.json > bd.log && gzip -9 -kf data.json && LINE=M3 python3 "$ROOT/tools/build_line.py" > m3.log && \
    grep -h "tail clashes\|not covered" m3.log && node "$ROOT/tools/precompute_live.js" > pre.log && python3 "$ROOT/tests/check_tails.py" && python3 "$ROOT/tests/check_depot.py" && \
    node "$ROOT/tests/day_agents_check.js" 5 24 && node "$ROOT/tests/timetable_check.js" && (node "$ROOT/tests/headway_check.js" || echo "WARNING ($n): trains closer than 2 minutes"))
done
# M2, tappa 1 (in test): its own timetable extract (data/gtfs_m2) and the turni, in build_m2/<1|6|7>; nothing of the
# M3 build is used or changed. tools/assemble_m2.py packs it.
GTFS_M2="$ROOT/data/gtfs_m2"
for pair in "1:$DAY" "6:$SAT_DAY" "7:$SUN_DAY"; do
  n="${pair%%:*}"; d="${pair##*:}"; BD="$ROOT/build_m2/$n"; mkdir -p "$BD"
  cp "$ROOT/data/operations_m2.json" "$ROOT/data/osm_m2.txt" "$ROOT/data/osm_m2_platforms.json" "$BD"/
  echo "== M2 ($n): timetable for service day $d, turni, runs on the real tracks"
  # the runs on the tracks: the M1's builder (tools/build_trips.py); PICK_DOT 0.3: see the note there (Garibaldi)
  (cd "$BD" && python3 "$ROOT/tools/build_data.py" "$GTFS_M2" "$d" data.json 2> bd.log && gzip -9 -kf data.json && \
    python3 "$ROOT/tools/turni_m2.py" && LINE=M2 TRACKS=osm_m2.txt PICK_DOT=0.3 PLATFORMS=osm_m2_platforms.json python3 "$ROOT/tools/build_trips.py" > trips.log && \
    grep -h "^patterns\|written" trips.log && python3 "$ROOT/tests/m2_check.py")
done
cd "$B"
echo "== page"
python3 "$ROOT/tools/assemble.py"
echo "== the page in a browser (depot, test loop, radio)"
if node -e "require('playwright')" 2>/dev/null; then node "$ROOT/tests/page_check.js"; else echo "(skipped: Playwright not installed)"; fi
echo "== the menu in a browser (only the chosen line is loaded)"
if node -e "require('playwright')" 2>/dev/null; then node "$ROOT/tests/home_check.js"; else echo "(skipped: Playwright not installed)"; fi
