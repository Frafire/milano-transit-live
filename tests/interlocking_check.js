// Interlocking (web/interlocking.js) over a normal day driven by the agents:
// - in every group (San Donato: depot exit and tails; Comasina: tails; San Donato departures) never two signals at
//   via libera at once;
// - no train's front passes a controlled signal without via libera for that train.
// Usage (from build/): node ../tests/interlocking_check.js [from hour] [to hour]
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/day_agents_check.js', 'utf8');
src = src.replace("require('./lib.js')", "require('../tests/lib.js')").replace("require('../web/agents.js')", "require('../web/agents.js')");
src = src.replace("  ag.step(t);\n", "  ag.step(t); IL_CHECK(ag, M.half);\n").replace("if (overlap || stuck", "IL_PRINT(); if (twoGreen || noGreen) process.exit(1); if (overlap || stuck");
let twoGreen = 0, noGreen = 0, passes = 0; const prev = new Map();
function IL_CHECK(ag, half) {
  const st = ag.il(), IL = ag.IL; if (!IL) return;
  const g = {}; for (const [s, k] of Object.entries(st.grant)) { const gi = IL.groupOf(+s); if (gi != null) (g[gi] = g[gi] || new Set()).add(k); }
  for (const n of Object.values(g)) if (n.size > 1) twoGreen++;     // two trains with via libera in one group
  passes = st.passed || 0; noGreen = st.viol || 0;
}
function IL_PRINT() { console.log(`interlocking: controlled signals passed ${passes} | passed without via libera: ${noGreen} | two signals of one group at via libera: ${twoGreen}`); }

eval(src);
