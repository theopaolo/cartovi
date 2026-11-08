// eau.js — débits futurs des rivières (Explore2 au format TRACC, tables communales du RARE), pour la fiche Recherche.
//
// Données de test (voir README) : affichées avec leur réserve et leur source, jamais utilisées dans un score.
// index.json décrit les indicateurs ; un fichier par département donne, par commune :
// [provenance, puis indicateur × niveau (+2 / +2,7 / +4 °C) × statistique (q05, q50, q95)].
import { getJSON } from './data.js';
import { NBSP, fmtNumber } from './format.js';

const BASE = 'data/eau/explore2/';
let indexP = null;
const depP = new Map();

/** Métadonnées (indicateurs, niveaux, source, statut de test), chargées une fois. */
export function loadEauIndex() {
  indexP ??= getJSON(`${BASE}index.json`).catch((e) => {
    indexP = null;
    throw e;
  });
  return indexP;
}

/** Valeurs des communes d'un département. */
export function loadEauDep(dep) {
  if (!depP.has(dep)) {
    depP.set(
      dep,
      getJSON(`${BASE}${dep}.json`).catch((e) => {
        depP.delete(dep);
        throw e;
      }),
    );
  }
  return depP.get(dep);
}

/**
 * Lecture d'une commune : { prov (0 bassin de la commune, 1 proche, 2 éloigné), provText, rows: [{ key, label, unit,
 * definition, cells: [{ level, label, horizon, q05, q50, q95 }] }] }, ou null si la commune n'est pas dans le jeu.
 */
export function eauOf(index, depData, code) {
  const raw = depData?.c?.[code];
  if (!index || !raw) return null;
  const nL = index.levels.length;
  const nS = index.stats.length;
  const at = (ii, li, stat) => raw[1 + (ii * nL + li) * nS + index.stats.indexOf(stat)];
  return {
    prov: raw[0],
    provText: index.provenance[raw[0]] ?? '',
    rows: index.indicators.map((ind, ii) => ({
      ...ind,
      cells: index.levels.map((lv, li) => ({ level: lv.id, label: lv.label, horizon: lv.horizon, q05: at(ii, li, 'q05'), q50: at(ii, li, 'q50'), q95: at(ii, li, 'q95') })),
    })),
  };
}

/** Phrase sur l'origine des valeurs, d'après le classement du producteur (colonne « donnees_issues_territoire »). */
export function provenanceSentence(prov) {
  if (prov === 0) return 'Valeurs issues du bassin versant de la commune (classement du producteur).';
  const where = prov === 1 ? 'proche' : 'éloigné';
  return `Valeurs non issues du territoire de la commune : elles viennent d’un bassin versant ${where} (classement du producteur).`;
}

const MINUS = '−';
/** Écart signé : « +12 % », « −8 % », « +3 j » ; 0 sans signe. */
export function fmtDelta(v, unit) {
  if (!Number.isFinite(v)) return '—';
  const n = fmtNumber(Math.abs(v), Number.isInteger(v) ? 0 : 1);
  const sign = v > 0 ? '+' : v < 0 ? MINUS : '';
  return `${sign}${n}${NBSP}${unit === 'jours' ? 'j' : unit}`;
}

/** Cellule : médiane et intervalle des 90 % de simulations centrales, « −11 % [−30 ; +28] ». */
export function eauCellText(row, cell) {
  if (!Number.isFinite(cell.q50)) return '—';
  const mid = fmtDelta(cell.q50, row.unit);
  if (!Number.isFinite(cell.q05) || !Number.isFinite(cell.q95)) return mid;
  const bare = (v) => fmtDelta(v, row.unit).replace(/ .*$/, '');
  return `${mid} [${bare(cell.q05)}${NBSP};${NBSP}${bare(cell.q95)}]`;
}

export const EAU_CAVEAT =
  'Écart à la période 1976–2005, en % pour les débits et en jours pour les durées : médiane des simulations et, entre crochets, ' +
  'l’intervalle où se situent 90 % d’entre elles. Ces projections décrivent les cours d’eau, pas les nappes souterraines ni l’eau du robinet. ' +
  'Hors de tout score.';
