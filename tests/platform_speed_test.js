// Empty trains pass station platforms at 40 km/h.
const assert = require('node:assert/strict');
const E = require('../web/engine.js');

const zones = E.platformZones({ platforms: { '7': [[100, 140, 3], [250, 290, 4]] } });
assert.deepEqual(zones['7'], [[100, 140, 40 / 3.6, 3], [250, 290, 40 / 3.6, 4]]);
console.log('empty-train platform zones: 40 km/h');
