// Autotest : node web/js/eau.test.mjs — lecture d'une commune dans les fichiers Explore2 (structure de pipeline/explore2.py).
import assert from 'node:assert/strict';
import { eauCellText, eauOf, fmtDelta, provenanceSentence } from './eau.js';

const index = {
  indicators: [
    { key: 'etiage', label: 'Débit d’étiage d’été', unit: '%' },
    { key: 'duree_etiage', label: 'Durée des basses eaux d’été', unit: 'jours' },
  ],
  levels: [
    { id: 'GWL15', label: '+2 °C', horizon: '≈ 2030' },
    { id: 'GWL20', label: '+2,7 °C', horizon: '≈ 2050' },
    { id: 'GWL30', label: '+4 °C', horizon: '≈ 2100' },
  ],
  stats: ['q05', 'q50', 'q95'],
  provenance: ['bassin de la commune', 'bassin proche', 'bassin éloigné'],
};
// [provenance, étiage (3 niveaux × q05,q50,q95), durée (idem)]
const dep = { c: { 69123: [1, -30, -11, 28, -35, -15, 15, -50, -25, 0, 2, 6, 26, 3, 9, 34, 10, 20, 56] } };
const e = eauOf(index, dep, '69123');
assert.equal(e.prov, 1);
assert.equal(e.provText, 'bassin proche');
assert.deepEqual(e.rows[0].cells.map((c) => c.q50), [-11, -15, -25]);
assert.deepEqual(e.rows[1].cells[1], { level: 'GWL20', label: '+2,7 °C', horizon: '≈ 2050', q05: 3, q50: 9, q95: 34 });
assert.equal(eauOf(index, dep, '75056'), null);
assert.equal(eauOf(null, dep, '69123'), null);

assert.equal(fmtDelta(-11, '%'), '−11 %');
assert.equal(fmtDelta(9, 'jours'), '+9 j');
assert.equal(fmtDelta(0, '%'), '0 %');
assert.equal(eauCellText(e.rows[0], e.rows[0].cells[0]), '−11 % [−30 ; +28]');
assert.equal(eauCellText(e.rows[0], { q50: undefined }), '—');
assert.match(provenanceSentence(0), /^Valeurs issues du bassin versant de la commune/);
assert.match(provenanceSentence(2), /bassin versant éloigné/);
console.log('eau : ok');
