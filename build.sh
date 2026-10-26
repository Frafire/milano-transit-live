#!/usr/bin/env bash
# Build the game from the ATM timetable (GTFS) and the track files in data/.
# Usage: ./build.sh path/to/unzipped/gtfs [YYYYMMDD service day]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
GTFS="$(cd "${1:?give the folder of the unzipped ATM GTFS}" && pwd)"
DAY="${2:-20260923}"
B="$ROOT/build"; mkdir -p "$B"
cp "$ROOT"/data/* "$B"/
export PYTHONPATH="$ROOT/tools" GTFS
cd "$B"
echo "== timetable for service day $DAY"
python3 "$ROOT/tools/build_data.py" "$GTFS" "$DAY" data.json
gzip -9 -kf data.json
echo "== M3";  LINE=M3 python3 "$ROOT/tools/build_line.py" > m3.log
echo "== M4";  LINE=M4 python3 "$ROOT/tools/build_line.py" > m4.log
echo "== M1";  LINE=M1 TRACKS=osm_m1.txt python3 "$ROOT/tools/build_trips.py" > m1.log
echo "== bus 130"; ROUTE=B130 SIZE=18 python3 "$ROOT/tools/build_bus.py"
echo "== bus 64";  ROUTE=B64 SIZE=12 DISPLAY=1 python3 "$ROOT/tools/build_bus.py"
grep -h "tail clashes\|not covered\|test loop" m3.log || true
echo "== tests"
python3 "$ROOT/tests/check_tails.py"
python3 "$ROOT/tests/check_depot.py"
node "$ROOT/tests/engine_test.js"
node "$ROOT/tests/section_test.js"
node "$ROOT/tests/block_check.js"
node "$ROOT/tests/agents_check.js" 4
node "$ROOT/tests/timetable_check.js"
node "$ROOT/tests/headway_check.js" || echo "WARNING: trains closer than 2 minutes"
echo "== normal day for the page"
node "$ROOT/tools/precompute_live.js"
echo "== page"
python3 "$ROOT/tools/assemble.py"
