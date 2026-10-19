// score.js — calculs purs (aucun accès au DOM) : percentiles, indice composite, rangs, classes.
//
// Principe (voir « Méthode & sources ») :
//  1. score d'un indicateur = rang percentile du département parmi ceux qui ont une valeur,
//     entre 0 et 1 ; inversé (1 − p) si « plus bas = mieux » (direction = -1) ;
//  2. indice composite = Σ wᵢ·sᵢ / Σ wᵢ sur les indicateurs renseignés avec wᵢ > 0 ;
//  3. classes = quintiles du rang (la classe 1 regroupe les ≈ 20 % les mieux classés).

export const N_CLASSES = 5;
const EPS = 1e-9; // tolérance pour considérer deux flottants comme ex æquo

/**
 * Score favorable (0–1, 1 = le plus favorable) de chaque département pour un indicateur.
 * @param {Object<string, number|null>} values  code → valeur brute (absent/null = manquant)
 * @param {1|-1} direction  1 : plus haut = mieux ; -1 : plus bas = mieux
 * @param {Iterable<string>} [only]  restreint aux codes connus de la carte
 * @returns {Object<string, number>} code → score (seuls les départements renseignés)
 */
export function percentileScores(values, direction = 1, only) {
  const allowed = only ? new Set(only) : null;
  const entries = Object.entries(values).filter(
    ([code, v]) => Number.isFinite(v) && (!allowed || allowed.has(code)),
  );
  const n = entries.length;
  const out = {};
  entries.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && Math.abs(entries[j + 1][1] - entries[i][1]) < EPS) j++;
    // rang moyen (base 0) du groupe d'ex æquo, ramené à [0, 1]
    const p = n > 1 ? (i + j) / 2 / (n - 1) : 0.5;
    const s = direction < 0 ? 1 - p : p;
    for (let k = i; k <= j; k++) out[entries[k][0]] = s;
    i = j + 1;
  }
  return out;
}

/** Scores de tous les indicateurs : { idIndicateur: { code: score } }. Indépendant des poids. */
export function indicatorScores(indicators, codes) {
  const out = {};
  for (const ind of indicators) out[ind.id] = percentileScores(ind.values || {}, ind.direction, codes);
  return out;
}

/**
 * Indice composite par département.
 * @param {Object<string, Object<string, number>>} scores  sortie de indicatorScores
 * @param {Object<string, number>} weights  idIndicateur → poids (≤ 0 ou absent = ignoré)
 * @param {Iterable<string>} codes
 * @returns {Object<string, {score:number, used:number, weight:number}|null>}
 *   score dans [0, 1] ; used = nb d'indicateurs pris en compte ; null si aucun n'est utilisable
 */
export function composite(scores, weights, codes) {
  const out = {};
  for (const code of codes) {
    let sum = 0;
    let wsum = 0;
    let used = 0;
    for (const id in weights) {
      const w = weights[id];
      const s = scores[id]?.[code];
      if (!(w > 0) || s === undefined) continue;
      sum += w * s;
      wsum += w;
      used++;
    }
    out[code] = wsum > 0 ? { score: sum / wsum, used, weight: wsum } : null;
  }
  return out;
}

/**
 * Rang et classe (quintile) de chaque département.
 * Rang de compétition : les ex æquo partagent le meilleur rang (1, 2, 2, 4…).
 * @param {Object<string, number|null>} valueByCode  null/undefined = non classé
 * @param {{descending?: boolean, k?: number}} [opts]  descending : la plus grande valeur est rang 1
 * @returns {{n:number, byCode:Object<string,{rank:number, cls:number}>}}  cls dans 1..k
 */
export function rank(valueByCode, { descending = true, k = N_CLASSES } = {}) {
  const list = Object.entries(valueByCode).filter(([, v]) => Number.isFinite(v));
  const n = list.length;
  const dir = descending ? -1 : 1;
  list.sort((a, b) => dir * (a[1] - b[1]));
  const byCode = {};
  let r = 1;
  list.forEach(([code, v], i) => {
    if (i > 0 && Math.abs(v - list[i - 1][1]) >= EPS) r = i + 1;
    byCode[code] = { rank: r, cls: Math.min(k, Math.floor(((r - 1) * k) / n) + 1) };
  });
  return { n, byCode };
}
