// Autotest : node web/js/climat.test.mjs — lecture de la grille TRACC publiée (web/data/climat/tracc.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUTUR, cellText, hasFutur, trajectory } from './climat.js';

const tracc = JSON.parse(readFileSync(new URL('../data/climat/tracc.json', import.meta.url), 'utf8'));
assert.deepEqual(tracc.levels.map((l) => l.id), ['REF', 'GWL15', 'GWL20', 'GWL30']);
assert.equal(Object.keys(tracc.values.Q50).length, 8981);

// Lyon (point 8529) : jours à 35 °C de la référence à +4 °C, valeurs du fichier DRIAS
const t = trajectory(tracc, 8529);
const tx35 = t.find((i) => i.key === 'tx35');
assert.deepEqual(tx35.cells.map((c) => c.q50), [1.5, 5.1, 7.8, 16.5]);
assert.deepEqual(t.find((i) => i.key === 'tr').cells.map((c) => c.q50), [14.3, 31.6, 42.7, 63.1]);
assert.equal(trajectory(tracc, 1), null); // point inconnu
assert.equal(trajectory(null, 8529), null);

// intervalle affiché seulement si Q05 et Q95 existent
const ind = { decimals: 1 };
assert.equal(cellText(ind, { q50: 7.8 }), '7,8');
assert.equal(cellText(ind, { q50: 7.8, q05: 4, q95: 12.25 }), '7,8 [4,0–12,3]');
assert.equal(cellText(ind, { q50: undefined }), '—');

// chaque colonne notée a son indice dans la grille
for (const f of FUTUR) assert.ok(tracc.indices.some((i) => i.key === f.key), f.key);
assert.equal(hasFutur({ tx35_27: 7.8 }), true);
assert.equal(hasFutur({ tracc_pt: 0 }), false);
assert.equal(trajectory(tracc, 0), null);
console.log('climat : ok');
