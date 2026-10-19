// view.js — assemble les résultats de score.js en « vue » prête à afficher
// (carte, légende, classement) et décrit chaque département (infobulle, aria-label).
import { composite, rank, N_CLASSES } from './score.js';
import { CLASSES, VALUE_CLASSES } from './classes.js';
import { fmtNumber, fmtValue, rankSpoken, rankText } from './format.js';

export const emptyView = (reason) => ({ kind: 'none', reason, n: 0, byCode: {}, classes: [], missing: 0 });

/**
 * comp : vue « indice composite » (toujours calculée, sert au panneau détail) ;
 * cur  : vue affichée sur la carte (comp, ou un indicateur seul).
 */
export function computeViews({ indicators, scores, weights, mode, codes }) {
  if (!indicators.length) return { comp: emptyView('nodata'), cur: emptyView('nodata') };
  const comp = compositeView(indicators, scores, weights, codes);
  const ind = indicators.find((i) => i.id === mode);
  return { comp, cur: ind ? indicatorView(ind, scores[ind.id], codes) : comp };
}

const blankClasses = () => Array.from({ length: N_CLASSES }, () => ({ count: 0, min: Infinity, max: -Infinity }));
function accumulate(classes, cls, v) {
  const c = classes[cls - 1];
  c.count++;
  c.min = Math.min(c.min, v);
  c.max = Math.max(c.max, v);
}

function compositeView(indicators, scores, weights, codes) {
  const comp = composite(scores, weights, codes);
  const flat = {};
  for (const code of codes) flat[code] = comp[code]?.score ?? null;
  const { n, byCode: ranks } = rank(flat);
  if (!n) return emptyView('zero');
  const classes = blankClasses();
  const byCode = {};
  let missing = 0;
  for (const code of codes) {
    const r = ranks[code];
    if (!r) {
      byCode[code] = { missing: true };
      missing++;
      continue;
    }
    byCode[code] = { score: flat[code], rank: r.rank, cls: r.cls, used: comp[code].used };
    accumulate(classes, r.cls, flat[code] * 100);
  }
  const nWeighted = indicators.filter((i) => weights[i.id] > 0).length;
  return { kind: 'composite', n, byCode, classes, missing, nWeighted };
}

function indicatorView(ind, indScores, codes) {
  const raw = {};
  for (const code of codes) raw[code] = Number.isFinite(ind.values[code]) ? ind.values[code] : null;
  const byValue = rank(raw, { descending: false }); // classes : quintiles de valeurs brutes
  const byFavor = rank(indScores); // rang : du plus au moins favorable
  const classes = blankClasses();
  const byCode = {};
  let missing = 0;
  for (const code of codes) {
    const q = byValue.byCode[code];
    if (!q) {
      byCode[code] = { missing: true };
      missing++;
      continue;
    }
    byCode[code] = { value: raw[code], score: indScores[code], rank: byFavor.byCode[code].rank, cls: q.cls };
    accumulate(classes, q.cls, raw[code]);
  }
  return { kind: 'indicator', indicator: ind, n: byValue.n, byCode, classes, missing };
}

/** Texte pour un département : clé de remplissage CSS, aria-label et lignes d'infobulle. */
export function describe(view, terr) {
  const head = `${terr.name} (${terr.code})`;
  const e = view.byCode[terr.code];
  if (view.kind === 'none') return { fill: 'none', aria: head, tip: [head] };
  if (!e || e.missing) return { fill: 'na', aria: `${head}, donnée manquante`, tip: [head, 'Donnée manquante'] };
  if (view.kind === 'composite') {
    const cls = CLASSES[e.cls - 1].name;
    return {
      fill: `c${e.cls}`,
      aria: `${head}, ${cls}, ${rankSpoken(e.rank, view.n)}`,
      tip: [head, cls, `${rankText(e.rank, view.n)} · score ${fmtNumber(e.score * 100, 0)}/100`],
    };
  }
  const val = fmtValue(e.value, view.indicator);
  return {
    fill: `s${e.cls}`,
    aria: `${head}, ${view.indicator.label} : ${val}, ${VALUE_CLASSES[e.cls - 1].toLowerCase()}, ${rankSpoken(e.rank, view.n)} du plus favorable`,
    tip: [head, `${view.indicator.label} : ${val}`, `${rankText(e.rank, view.n)} (1ᵉʳ = plus favorable)`],
  };
}
