// The radio phrases (Giovanni, 2 Nov 2026: all the radio calls in a file of their own). They are written in the Radio
// sheet of the rules Excel (data/Regole_interlocking_M3.xlsx) -> tools/rules_from_excel.py -> data/radio_m3.json; the
// build puts them in the network (net.radio). The code only says which phrase: t('guasto.trazione.riarmato', { dove }).
//
// A phrase: { chi, quando, testi: [one or more variants] }. Placeholders in braces: {stazione}, {segnale}... filled from
// the values given; {T} and {R} (the train, the rescuing train) are left as they are and filled later with the train
// numbers (faults feed). More variants: one at random (with the given random function, so seeded days stay the same).
// Strict (the Node tests): a missing phrase or a placeholder left without a value is an error.
(function (root) {
  const LATER = new Set(['T', 'R']);
  function create(table, rng) {
    const T = table || {};
    function t(code, vars, r) {
      const e = T[code];
      if (!e || !e.testi || !e.testi.length) {
        if (api.strict) throw new Error('frase radio mancante: ' + code);
        return '[' + code + ']';
      }
      const L = e.testi, s = L.length > 1 ? L[Math.floor((r || rng || Math.random)() * L.length)] : L[0];
      return s.replace(/\{(\w+)\}/g, (m, k) => {
        if (vars && vars[k] != null) return String(vars[k]);
        if (!LATER.has(k) && api.strict) throw new Error('frase radio ' + code + ': manca il valore di {' + k + '}');
        return m;
      });
    }
    return { t, has: c => !!T[c], codes: () => Object.keys(T), who: c => T[c] && T[c].chi };
  }
  const api = { create, strict: typeof module !== 'undefined' && !!module.exports && !(typeof process !== 'undefined' && process.env.FRASI_LAX) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTLFrasi = api;
})(typeof window !== 'undefined' ? window : globalThis);
