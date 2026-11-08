// score-communes.js — score personnalisé des communes retenues (calculs purs, aucun accès au DOM).
//
// Règles (voir « Méthode & limites » de communes.html) :
//  1. le score ne classe que les communes qui passent les filtres : les percentiles sont relatifs à la sélection ;
//  2. les critères sans « bon sens » universel (taille, climat politique) sont à 0 par défaut, le sens est choisi par l'utilisateur ;
//  3. granularité la plus fine : valeur de la commune si elle existe, sinon celle du département quand l'unité est la même.
//  4. la lecture (settings.norm) est celle de la carte des départements : par rang (centiles, défaut) ou par écart (min-max).
// Les calculs eux-mêmes (scores, indice composite, rangs) sont ceux de la carte des départements (score.js).
import { DEFAULT_NORM, composite, rank, scorerOf } from '../score.js';
import { NBSP, fmtNumber, fmtValue } from '../format.js';
import { fmtDuration, fmtKm, fmtPct, fmtPop, fmtPrice, trainsText } from './text.js';
import { FUTUR, fmtFutur } from '../climat.js';

export const NUC_CAP_KM = 40; // au-delà de deux fois le rayon PPI (20 km), la distance ne compte plus : ex æquo à 40
export const W_MAX = 3;
export const W_STEP = 0.5;

export const GROUPS = [
  { id: 'train', label: 'Train' },
  { id: 'culture', label: 'Culture' },
  { id: 'prix', label: 'Prix et taille' },
  { id: 'politique', label: 'Climat politique' },
  { id: 'terres', label: 'Terres' },
  { id: 'risques', label: 'Risques' },
  { id: 'eau', label: 'Eau et climat' },
  { id: 'futur', label: 'Climat futur (+2,7 °C, ≈ 2050)' },
  { id: 'mobilite', label: 'Vie sans voiture' },
  { id: 'locale', label: 'Vie locale et coopération' },
  { id: 'enfants', label: 'Enfants' },
];

const fmtRecognitions = (v) => `${fmtNumber(v)}${NBSP}reconnaissance${v > 1 ? 's' : ''}`;

const MOINS_PLUS = [
  { id: 'moins', label: 'moins cher', dir: -1 },
  { id: 'plus', label: 'plus cher', dir: 1 },
];

/**
 * Un critère :
 *  id (clé du fragment d'URL) · group · label · w (poids par défaut)
 *  dir (1 : plus haut = mieux, -1 : plus bas = mieux) ou choice (sens laissé à l'utilisateur, `choiceDefault` = null : à choisir)
 *  get(r) : valeur propre à la liaison retenue ou à la commune ; col : colonne communale ; dep : indicateur départemental
 *  fallback : 'cell' (une commune sans valeur prend celle de son département, même unité)
 *             'column' (repli sur le département seulement si TOUTE la colonne manque : unités différentes)
 *  cap : plafond de la valeur utilisée pour classer
 *  legacy : colonnes plus fines qui, dès que l'une est présente, rendent ce critère inutile (il ne sert que de repli sur d'anciennes données)
 *  repliDir : sens du repli départemental quand il diffère (distance en km : plus loin = mieux ; part du territoire en zone PPI : moins = mieux)
 */
export const CRITERIA = [
  { id: 'tps', group: 'train', label: 'Temps de train vers la ville de référence', w: 1.5, dir: -1, get: (r) => r.min, fmt: fmtDuration },
  { id: 'dir', group: 'train', label: 'Trains directs par jour', w: 1, dir: 1, get: (r) => r.trains, fmt: trainsText },
  { id: 'cul', group: 'culture', label: 'Offre culturelle à 15 km', w: 1, dir: 1, get: (r) => culture(r.c), fmt: (v) => `${fmtNumber(v)}${NBSP}lieu${v > 1 ? 'x' : ''}` },
  { id: 'prx', group: 'prix', label: 'Prix des maisons', w: 1.5, choice: MOINS_PLUS, choiceDefault: 'moins', col: 'prix', dep: 'prix_maison_m2', fallback: 'cell', fmt: fmtPrice },
  {
    id: 'tai',
    group: 'prix',
    label: 'Taille de la commune',
    w: 0,
    choice: [
      { id: 'petite', label: 'plus petite', dir: -1 },
      { id: 'grande', label: 'plus grande', dir: 1 },
    ],
    choiceDefault: null,
    get: (r) => r.c.pop,
    fmt: fmtPop,
  },
  {
    id: 'pol',
    group: 'politique',
    label: 'Part de gauche',
    w: 0,
    choice: [
      { id: 'gauche', label: 'plus à gauche', dir: 1 },
      { id: 'droite', label: 'plus à droite', dir: -1 },
    ],
    choiceDefault: null,
    get: (r) => r.left, // sur la base choisie par la page (commune ou rayon de 10 km)
    fmt: fmtPct,
  },
  { id: 'den', group: 'terres', label: 'Densité de population', w: 1, dir: -1, col: 'densite', dep: 'densite', fallback: 'cell', fmt: (v) => `${fmtNumber(v)}${NBSP}hab./km²` },
  { id: 'art', group: 'terres', label: 'Artificialisation récente', w: 1, dir: -1, col: 'artif', dep: 'conso_naf', fallback: 'cell', fmt: (v) => `${fmtNumber(v, 1)}${NBSP}ha/an pour 100${NBSP}km²` },
  // CatNat par aléa (20 ans) : valeur de la commune seulement, 0 est une vraie valeur (aucune reconnaissance)
  { id: 'cin', group: 'risques', label: 'Inondations reconnues (20 ans)', w: 1, dir: -1, col: 'catnat_inond', fmt: fmtRecognitions },
  { id: 'cse', group: 'risques', label: 'Sécheresse et argiles reconnues (20 ans)', w: 1, dir: -1, col: 'catnat_sech', fmt: fmtRecognitions },
  { id: 'cme', group: 'risques', label: 'Vagues et submersion reconnues (20 ans)', w: 1, dir: -1, col: 'catnat_mer', fmt: fmtRecognitions },
  { id: 'cmt', group: 'risques', label: 'Mouvements de terrain reconnus (20 ans)', w: 0.5, dir: -1, col: 'catnat_mvt', fmt: fmtRecognitions },
  // anciennes données (sans le détail par aléa) : total communal, puis total du département
  { id: 'cat', group: 'risques', label: 'Catastrophes naturelles (total)', w: 1, dir: -1, col: 'catnat', dep: 'catnat', fallback: 'cell', legacy: ['catnat_inond', 'catnat_sech', 'catnat_mer', 'catnat_mvt'], fmt: (v) => `${fmtNumber(v)}${NBSP}arrêté${v > 1 ? 's' : ''}` },
  { id: 'nuc', group: 'risques', label: 'Distance à une centrale nucléaire', w: 1, dir: 1, col: 'nucleaire_km', dep: 'nucleaire_ppi', fallback: 'column', repliDir: -1, cap: NUC_CAP_KM, fmt: (v) => (v >= NUC_CAP_KM ? `${NUC_CAP_KM}${NBSP}km ou plus` : fmtKm(v)) },
  { id: 'sev', group: 'risques', label: 'Sites Seveso proches', w: 1, dir: -1, col: 'seveso_10km', dep: 'seveso', fallback: 'column', fmt: (v) => `${fmtNumber(v)}${NBSP}site${v > 1 ? 's' : ''}` },
  { id: 'sol', group: 'risques', label: 'Sols pollués', w: 0.5, dir: -1, dep: 'sols_pollues' },
  { id: 'eau', group: 'eau', label: 'Restrictions d’eau', w: 1.5, dir: -1, dep: 'secheresse_jours' },
  { id: 'ass', group: 'eau', label: 'Cours d’eau à sec', w: 1, dir: -1, dep: 'assecs' },
  { id: 'bil', group: 'eau', label: 'Bilan hydrique', w: 1, dir: 1, dep: 'bilan_hydrique' },
  // climat futur TRACC (DRIAS) : valeur du point de grille de la commune, sinon celle du département (même unité)
  ...[
    ['f35', 'tx35_27', 1],
    ['ftr', 'tr_27', 0.5],
    ['fso', 'swi04_27', 1],
    ['ffe', 'ifm40_27', 0.5],
    ['fpl', 'rx1d_27', 0.5],
  ].map(([id, col, w]) => {
    const f = FUTUR.find((x) => x.col === col);
    return { id, group: 'futur', label: f.label, w, dir: -1, col, dep: col, fallback: 'cell', fmt: (v) => fmtFutur(v, f.unit, f.d) };
  }),
  // vie locale et mobilité (pipeline/locale.py) : à 0 par défaut, ce sont des préférences ; valeurs de la commune ou de son bassin de vie
  { id: 'nav', group: 'mobilite', label: 'Trajets domicile-travail sans voiture', w: 0, dir: 1, col: 'navette_douce', fmt: fmtPct },
  { id: 'svo', group: 'mobilite', label: 'Ménages sans voiture', w: 0, dir: 1, col: 'sans_voiture', fmt: fmtPct },
  { id: 'gar', group: 'mobilite', label: 'Trains au départ de la gare', w: 0, dir: 1, get: (r) => r.c.trains_jour ?? 0, fmt: trainsText },
  { id: 'ess', group: 'locale', label: 'Structures de l’ESS à 10 km (pour 1 000 hab.)', w: 0, dir: 1, col: 'ess_1000_10km', fmt: (v) => fmtNumber(v, 1) },
  { id: 'coo', group: 'locale', label: 'Coopératives à 10 km', w: 0, dir: 1, col: 'coop_10km', fmt: (v) => fmtNumber(v) },
  { id: 'aso', group: 'locale', label: 'Associations actives à 10 km (pour 1 000 hab.)', w: 0, dir: 1, col: 'assos_1000_10km', fmt: (v) => fmtNumber(v, 1) },
  { id: 'tli', group: 'locale', label: 'Tiers-lieux à 10 km', w: 0, dir: 1, col: 'tiers_lieux_10km', fmt: (v) => fmtNumber(v) },
  { id: 'ci5', group: 'culture', label: 'Cinémas à 5 km', w: 0, dir: 1, col: 'cinemas_5km', fmt: (v) => fmtNumber(v) },
  { id: 'sc5', group: 'culture', label: 'Scènes à 5 km', w: 0, dir: 1, col: 'scenes_5km', fmt: (v) => fmtNumber(v) },
  { id: 'fes', group: 'culture', label: 'Festivals à 15 km', w: 0, dir: 1, col: 'festivals_15km', fmt: (v) => fmtNumber(v) },
  { id: 'col', group: 'enfants', label: 'Collèges à 5 km', w: 0, dir: 1, col: 'college_5km', fmt: (v) => fmtNumber(v) },
  { id: 'lyc', group: 'enfants', label: 'Lycées à 5 km', w: 0, dir: 1, col: 'lycee_5km', fmt: (v) => fmtNumber(v) },
];

export const CRITERION = Object.fromEntries(CRITERIA.map((k) => [k.id, k]));

/** Offre culturelle à 15 km : les lieux labellisés comptent double. */
export const culture = (c) => c.cinemas + c.scenes + 2 * c.labels + c.musees + c.librairies + c.conservatoires;

/** Réglages par défaut : { w: {id: poids}, o: {id: sens choisi ou null} }. */
export function defaultSettings() {
  return {
    w: Object.fromEntries(CRITERIA.map((k) => [k.id, k.w])),
    o: Object.fromEntries(CRITERIA.filter((k) => k.choice).map((k) => [k.id, k.choiceDefault])),
    norm: DEFAULT_NORM,
  };
}

/** Poids et sens effectifs d'un critère, ou null s'il est inactif (poids nul, ou sens pas encore choisi). */
export function activeOf(k, settings) {
  const w = settings.w[k.id];
  if (!(w > 0)) return null;
  if (!k.choice) return { w, dir: k.dir };
  const opt = k.choice.find((o) => o.id === settings.o[k.id]);
  return opt ? { w, dir: opt.dir, opt } : null;
}

/**
 * Colonnes communales renseignées pour au moins une commune : { colonne: bool }.
 * Une colonne vide ou absente (source en échec, anciennes données) fait basculer le critère sur le département.
 */
export function columnsAvailable(communes) {
  const out = {};
  for (const k of CRITERIA) if (k.col) out[k.col] = communes.some((c) => Number.isFinite(c[k.col]));
  return out;
}

/**
 * Granularité d'un critère : 'commune' | 'departement' | 'repli' (département, faute de colonne communale) | null (indisponible).
 * @param {{colAvail:Object<string,boolean>, ind:(id:string)=>object|undefined}} env  ind : indicateur départemental par id
 */
export function levelOf(k, env) {
  if (k.legacy?.some((col) => env.colAvail[col])) return null; // le détail par aléa existe : le total n'est plus un critère
  const hasDep = !!(k.dep && env.ind(k.dep));
  if (k.get) return 'commune';
  if (!k.col) return hasDep ? 'departement' : null;
  if (env.colAvail[k.col]) return 'commune';
  if (!hasDep) return null;
  return k.fallback === 'column' ? 'repli' : 'departement';
}

/**
 * Valeur d'une commune pour un critère : { v (valeur classée), raw (valeur affichée), gran } ou null si absente.
 * `level` est celui de levelOf (calculé une fois par critère).
 */
export function resolve(k, r, env, level) {
  if (k.get) {
    const v = k.get(r);
    return Number.isFinite(v) ? { v, raw: v, gran: 'commune' } : null;
  }
  if (k.col && level === 'commune') {
    const raw = r.c[k.col];
    if (Number.isFinite(raw)) return { v: k.cap ? Math.min(raw, k.cap) : raw, raw, gran: 'commune' };
    if (k.fallback !== 'cell') return null; // nucléaire, Seveso : unités différentes du département, on ne mélange pas
  }
  const d = k.dep ? env.ind(k.dep)?.values?.[r.c.dep] : undefined;
  return Number.isFinite(d) ? { v: d, raw: d, gran: level === 'repli' ? 'repli' : 'departement' } : null;
}

/** Valeur affichée avec son unité (celle de l'indicateur départemental quand la valeur vient du département). */
export function fmtCriterion(k, x, env) {
  if (x.gran !== 'commune' || !k.fmt) {
    const ind = k.dep && env.ind(k.dep);
    return ind ? fmtValue(x.raw, ind) : k.fmt ? k.fmt(x.raw) : fmtNumber(x.raw);
  }
  return k.fmt(x.raw);
}

/**
 * Score des communes retenues.
 * @param {{c:object, min:number, trains:number, left:number|null}[]} results  sortie de applyFilters
 * @param {{w:Object<string,number>, o:Object<string,string|null>, norm?:string}} settings
 * @param {{colAvail:Object<string,boolean>, ind:(id:string)=>object|undefined}} env
 * @param {object} [memo]  mémo conservé tant que `results` est le même tableau : les curseurs de poids ne recalculent pas les scores
 * @returns {{n:number, active:object[], byCode:Map<string,{score:number,rank:number,cls:number,used:number,wsum:number}>,
 *            parts:(code:string)=>object[]}}  score dans [0, 100] ; n = communes classées
 */
export function scoreCommunes(results, settings, env, memo = {}) {
  if (memo.results !== results) Object.assign(memo, { results, cache: new Map() });
  const active = [];
  for (const k of CRITERIA) {
    const a = activeOf(k, settings);
    const level = a && levelOf(k, env);
    if (level) active.push({ k, w: a.w, dir: level === 'repli' && k.repliDir ? k.repliDir : a.dir, opt: a.opt, level });
  }
  const scores = {};
  const weights = {};
  const norm = settings.norm || DEFAULT_NORM;
  const scorer = scorerOf(norm);
  for (const a of active) {
    const key = `${a.k.id}|${a.dir}|${a.level}|${norm}`;
    let sc = memo.cache.get(key);
    if (!sc) {
      const values = {};
      for (const r of results) {
        const x = resolve(a.k, r, env, a.level);
        if (x) values[r.c.code] = x.v;
      }
      sc = scorer(values, a.dir);
      memo.cache.set(key, sc);
    }
    scores[a.k.id] = sc;
    weights[a.k.id] = a.w;
  }
  const comp = composite(scores, weights, results.map((r) => r.c.code));
  const valueByCode = {};
  for (const code in comp) if (comp[code]) valueByCode[code] = comp[code].score;
  const { n, byCode: ranks } = rank(valueByCode);
  const byCode = new Map();
  for (const code in ranks) byCode.set(code, { score: valueByCode[code] * 100, ...ranks[code], used: comp[code].used, wsum: comp[code].weight });
  const byResult = new Map(results.map((r) => [r.c.code, r]));

  /** Décomposition pour une commune : une ligne par critère actif. */
  function parts(code) {
    const r = byResult.get(code);
    const e = byCode.get(code);
    if (!r) return [];
    return active.map((a) => {
      const x = resolve(a.k, r, env, a.level);
      const s = scores[a.k.id][code];
      return {
        k: a.k,
        w: a.w,
        level: a.level,
        opt: a.opt,
        x, // null : valeur absente, critère ignoré pour cette commune
        better: s === undefined ? null : s, // part de la sélection (0–1) que la commune devance
        points: s === undefined || !e ? null : (a.w * s * 100) / e.wsum,
      };
    });
  }
  return { n, active, byCode, parts };
}
