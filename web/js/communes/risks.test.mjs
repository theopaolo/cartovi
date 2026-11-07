// risks.test.mjs — autotest de risks.js : node web/js/communes/risks.test.mjs
import assert from 'node:assert/strict';
import { EXCLUSION_IDS, activeRules, checkRisks, exclusionAvailability, normalizeRisks, riskReading, sortRisks } from './risks.js';

const com = (o) => normalizeRisks({ nucleaire_km: 80, seveso_10km: 0, ...o });
const run = (c, ex) => checkRisks(c, activeRules(ex));

const larochelle = com({ risques: ['inond', 'mvt', 'rga', 'sub'], ppr: ['cote', 'sub'], trait_cote: true });
const valence = com({ risques: [], ppr: ['inond'] });
const drome = com({ risques: null, ppr: null });
const ancien = com({}); // fichier sans les colonnes : même chose que « non renseigné »

// aucune case : rien n'est exclu, rien n'est marqué
for (const c of [larochelle, valence, drome]) assert.deepEqual(run(c, []), { nr: false });
// une case exclut la commune qui porte le risque
assert.equal(run(larochelle, ['sub']), null);
assert.equal(run(larochelle, ['cote']), null);
assert.equal(run(valence, ['inond']), null);
assert.equal(run(valence, ['sub']).nr, false);
// trait_cote seul suffit pour « recul du trait de côte », même sans liste GASPAR
assert.equal(run(com({ risques: null, ppr: null, trait_cote: true }), ['cote']), null);
assert.deepEqual(run(com({ risques: null, ppr: null, trait_cote: false }), ['cote']), { nr: true });
// colonne trait_cote absente : pas d'exclusion sur ce seul motif
assert.deepEqual(run(com({ risques: [], ppr: [] }), ['cote']), { nr: false });
// non renseigné : gardée mais marquée par les cases fondées sur GASPAR, et jamais prise pour « aucun risque »
for (const id of ['sub', 'cote', 'feu', 'inond', 'rga', 'barrage']) assert.deepEqual(run(drome, [id]), { nr: true }, id);
assert.deepEqual(run(ancien, ['feu']), { nr: true });
// les cases numériques ne dépendent pas de GASPAR
assert.deepEqual(run(drome, ['nuc', 'sev']), { nr: false });
assert.equal(run(com({ nucleaire_km: 19.9 }), ['nuc']), null);
assert.deepEqual(run(com({ nucleaire_km: 20 }), ['nuc']), { nr: false });
assert.equal(run(com({ seveso_10km: 1 }), ['sev']), null);
assert.deepEqual(run(com({ nucleaire_km: null, seveso_10km: null }), ['nuc', 'sev']), { nr: false });
// « exclure aussi les communes non renseignées »
assert.equal(run(drome, ['nr']), null);
assert.equal(run(ancien, ['nr']), null);
assert.deepEqual(run(valence, ['nr']), { nr: false });
assert.equal(run(com({ risques: [], ppr: null }), ['nr']), null);

// ordre canonique et disponibilité
assert.equal(EXCLUSION_IDS.at(-1), 'nr');
assert.deepEqual(sortRisks(['sub', 'inond', 'zzz', 'rga']), ['inond', 'sub', 'rga', 'zzz']);
assert.equal(exclusionAvailability([drome, ancien]).feu, false);
assert.equal(exclusionAvailability([drome, valence]).feu, true);
assert.equal(exclusionAvailability([ancien]).nuc, true);

// lecture : null reste « non renseigné », [] reste « aucun »
let r = riskReading(drome);
assert.equal(r.risques.state, 'unknown');
assert.equal(riskReading(valence).risques.state, 'none');
assert.equal(riskReading(larochelle).trait, true);
assert.equal(riskReading(valence).trait, null);
assert.deepEqual(r.catnat.map((k) => k.n), [null, null, null, null]);
r = riskReading(com({ catnat_inond: 2, catnat_sech: 0, catnat_mer: 1, catnat_mvt: 0 }));
assert.deepEqual(r.catnat.map((k) => k.n), [2, 0, 1, 0]);

console.log('risks : ok');
