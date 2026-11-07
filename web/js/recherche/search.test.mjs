// search.test.mjs — autotest de search.js sur les vraies données : node web/js/recherche/search.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndex, norm, parseQuery, search } from './search.js';

const data = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${p}`, import.meta.url)), 'utf8'));
const index = buildIndex(data('communes/noms.json'));
const depByName = new Map(data('map.json').territories.map((t) => [norm(t.name), t.code]));
const run = (q, o = {}) => search(index, q, { depByName, ...o });
const names = (r, n = 5) => r.list.slice(0, n).map((i) => `${index.rows[i][1]} (${index.rows[i][0].slice(0, 2)})`);

// normalisation
assert.equal(norm('Saint-Étienne'), 'saint etienne');
assert.equal(norm("L’Abergement-Clémenciat"), 'l abergement clemenciat');
assert.equal(norm('St-Étienne'), 'saint etienne');
assert.equal(norm('Ste Foy'), 'sainte foy');
assert.equal(norm('Cœur  d’Œuvre'), 'coeur d oeuvre');

// requêtes types
assert.deepEqual(names(run('st etienne'), 1), ['Saint-Étienne (42)']);
assert.deepEqual(names(run('Saint Étienne'), 1), ['Saint-Étienne (42)']);
assert.deepEqual(names(run('lyon'), 1), ['Lyon (69)']);
assert.deepEqual(names(run('saillans')), ['Saillans (26)', 'Saillans (33)']); // plus peuplée d'abord
assert.deepEqual(names(run('COEUR')).length > 0, true);
assert.ok(run('2a').list.length > 100 && run('2a').list.every((i) => index.deps[i] === '2A'));
{
  const r = run('saint martin 38');
  assert.ok(r.list.length > 3 && r.list.every((i) => index.deps[i] === '38'));
  assert.ok(index.rows[r.list[0]][1].toLowerCase().startsWith('saint-martin'));
}
{
  const r = run('saint martin isère'); // nom de département
  assert.deepEqual(r.q.byName, ['38']);
  assert.ok(r.list.every((i) => index.deps[i] === '38'));
}
assert.deepEqual(parseQuery('vienne', depByName).byName, []); // un nom de département seul reste une recherche de nom
assert.deepEqual(parseQuery('x alpes de haute provence', depByName).byName, ['04']);
assert.equal(run('69123').list.length, 1);
assert.equal(index.rows[run('26113').list[0]][1], 'Die');
assert.equal(run('6912').list.length, 0); // début de code : ignoré, donc requête vide
assert.equal(run('').active, false);

// classement : exact > début > début de mot > sous-chaîne
{
  const r = run('die');
  const kinds = r.list.map((i) => (index.keys[i] === 'die' ? 0 : index.keys[i].startsWith('die') ? 1 : (` ${index.keys[i]}`).includes(' die') ? 2 : 3));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
  assert.equal(index.rows[r.list[0]][1], 'Die');
}
// filtres
assert.ok(run('', { region: '94' }).list.every((i) => index.regions[i] === '94'));
assert.ok(run('saint', { sizes: ['ville'] }).list.every((i) => index.rows[i][2] >= 50000));
assert.ok(run('', { sizes: ['village', 'bourg'] }).list.every((i) => index.rows[i][2] < 10000));
// débit : 35 000 noms
const t0 = performance.now();
for (let n = 0; n < 50; n++) run('saint martin');
console.log(`ok · ${((performance.now() - t0) / 50).toFixed(1)} ms par recherche (${index.rows.length} communes)`);
