// score.test.mjs — autotest de score.js : node web/js/score.test.mjs
import assert from 'node:assert/strict';
import { composite, indicatorScores, minmaxScores, percentileScores } from './score.js';

const near = (a, b) => Math.abs(a - b) < 1e-12;

// min-max : (v − min) / (max − min), manquants ignorés
const v = { A: 10, B: 20, C: 40, D: null, E: 110 };
let s = minmaxScores(v, 1);
assert.deepEqual(Object.keys(s).sort(), ['A', 'B', 'C', 'E']);
assert.ok(near(s.A, 0) && near(s.B, 0.1) && near(s.C, 0.3) && near(s.E, 1));
// plus bas = mieux : 1 − p
s = minmaxScores(v, -1);
assert.ok(near(s.A, 1) && near(s.B, 0.9) && near(s.C, 0.7) && near(s.E, 0));
// restriction aux codes connus (min et max recalculés sur eux)
s = minmaxScores(v, 1, ['A', 'B', 'C']);
assert.deepEqual(Object.keys(s).sort(), ['A', 'B', 'C']);
assert.ok(near(s.C, 1) && near(s.B, 1 / 3));
// valeurs toutes égales, ou une seule : 0,5 (quel que soit le sens)
assert.deepEqual(minmaxScores({ A: 3, B: 3, C: 3 }, 1), { A: 0.5, B: 0.5, C: 0.5 });
assert.deepEqual(minmaxScores({ A: 3, B: 3 }, -1), { A: 0.5, B: 0.5 });
assert.deepEqual(minmaxScores({ A: 7 }, 1), { A: 0.5 });
assert.deepEqual(minmaxScores({}, 1), {});

// les deux lectures divergent quand une valeur extrême écrase les autres : 1, 2, 3 et 1000
const x = { A: 1, B: 2, C: 3, D: 1000 };
const rank = percentileScores(x, 1);
const mm = minmaxScores(x, 1);
assert.ok(near(rank.B, 1 / 3) && mm.B < 0.002);
// à l'inverse, l'ordre est le même
assert.deepEqual(Object.keys(rank).sort((a, b) => rank[a] - rank[b]), Object.keys(mm).sort((a, b) => mm[a] - mm[b]));

// indicatorScores et composite suivent le mode
const inds = [
  { id: 'p', direction: -1, values: { A: 1, B: 2, C: 3, D: 1000 } },
  { id: 'q', direction: 1, values: { A: 5, B: 5, C: 5, D: 5 } },
];
const codes = ['A', 'B', 'C', 'D'];
const sr = indicatorScores(inds, codes);
const sm = indicatorScores(inds, codes, 'minmax');
assert.ok(near(sr.p.A, 1) && near(sm.p.A, 1) && near(sr.p.B, 2 / 3) && sm.p.B > 0.99);
assert.ok(near(sm.q.A, 0.5) && near(sr.q.A, 0.5));
const w = { p: 1, q: 1 };
assert.ok(near(composite(sm, w, codes).D.score, (0 + 0.5) / 2));
assert.ok(near(composite(sr, w, codes).B.score, (2 / 3 + 0.5) / 2));

console.log('score : ok');
