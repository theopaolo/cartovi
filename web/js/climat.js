// climat.js — climat futur officiel (TRACC-2023, DRIAS / Météo-France), partagé par les pages Communes et Recherche.
//
// Deux usages, deux sources :
//  - le score et la fiche courte lisent les colonnes de la couche communale (valeurs à +2,7 °C, point de grille le plus proche) ;
//  - la fiche complète charge data/climat/tracc.json pour la trajectoire du point (référence, +2 °C, +2,7 °C, +4 °C).
import { getJSON } from './data.js';
import { NBSP, fmtNumber } from './format.js';

export const TRACC_URL = 'data/climat/tracc.json';
export const SCORED_LEVEL = 'GWL20';

/** Colonnes communales notées (+2,7 °C) ; mêmes identifiants que les indicateurs du département. */
export const FUTUR = [
  { col: 'tx30_27', key: 'tx30', label: 'Jours à 30 °C ou plus', unit: 'jours/an', d: 1 },
  { col: 'tx35_27', key: 'tx35', label: 'Jours à 35 °C ou plus', unit: 'jours/an', d: 1 },
  { col: 'tr_27', key: 'tr', label: 'Nuits tropicales', unit: 'nuits/an', d: 1 },
  { col: 'swi04_27', key: 'swi04', label: 'Jours de sol sec', unit: 'jours/an', d: 0 },
  { col: 'ifm40_27', key: 'ifm40', label: 'Jours de danger météo de feu', unit: 'jours/an', d: 0 },
  { col: 'rx1d_27', key: 'rx1d', label: 'Pluie maximale en un jour', unit: 'mm', d: 0 },
];

export const TRACC_SOURCE = { label: 'DRIAS — TRACC-2023, données Météo-France', url: 'https://www.drias-climat.fr/' };
export const TRACC_CAVEAT =
  'Médiane d’un ensemble de simulations climatiques régionales sur une grille de 8 km : une projection, pas une prévision. ' +
  'La maille lisse le relief (un fond de vallée est plus chaud que sa maille) et ignore les îlots de chaleur urbains.';
export const TRACC_LEVELS_NOTE =
  'Niveaux de réchauffement de la TRACC, par rapport à 1976–2005 : +2 °C en France vers 2030, +2,7 °C vers 2050, +4 °C vers 2100.';

export const fmtFutur = (v, unit, d = 0) => `${fmtNumber(v, d)}${NBSP}${unit}`;

let pending = null;
/** Table de la grille (≈ 1,4 Mo), chargée une fois et seulement par la fiche complète. */
export function loadTracc() {
  pending ??= getJSON(TRACC_URL).catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}

/**
 * Trajectoire d'un point de grille : [{ key, label, unit, decimals, cells: [{ level, label, horizon, q50, q05?, q95? }] }],
 * ou null si le point est inconnu. Les quantiles Q05/Q95 n'apparaissent que si le fichier les contient.
 */
export function trajectory(tracc, pt) {
  if (!tracc || !pt) return null;
  const q50 = tracc.values?.Q50?.[String(pt)];
  if (!q50) return null;
  const n = tracc.indices.length;
  const at = (q, li, ii) => tracc.values?.[q]?.[String(pt)]?.[li * n + ii];
  return tracc.indices.map((ind, ii) => ({
    ...ind,
    cells: tracc.levels.map((lv, li) => ({
      level: lv.id,
      label: lv.label,
      horizon: lv.horizon,
      q50: at('Q50', li, ii),
      q05: at('Q05', li, ii),
      q95: at('Q95', li, ii),
    })),
  }));
}

/** Valeur d'une cellule, avec l'intervalle entre simulations s'il est connu. */
export function cellText(ind, cell) {
  if (!Number.isFinite(cell.q50)) return '—';
  const v = fmtNumber(cell.q50, ind.decimals);
  return Number.isFinite(cell.q05) && Number.isFinite(cell.q95)
    ? `${v} [${fmtNumber(cell.q05, ind.decimals)}–${fmtNumber(cell.q95, ind.decimals)}]`
    : v;
}

/** Note sur le point de grille utilisé pour une commune. */
export function pointNote(c) {
  if (!c.tracc_pt) return null; // null : donnée absente ; 0 : aucun point de grille à moins de 8 km
  return `Point de grille à ${fmtNumber(c.tracc_km, 1)}${NBSP}km de la mairie.`;
}

/** true si la couche communale porte le climat futur (sinon : données d'avant la TRACC, ou commune sans point de grille). */
export const hasFutur = (c) => FUTUR.some((f) => Number.isFinite(c[f.col]));
