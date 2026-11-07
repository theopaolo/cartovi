// risks.js — risques détaillés d'une commune : libellés, filtres d'exclusion et lecture des colonnes (calculs purs, aucun accès au DOM).
//
// Deux familles de données, à ne pas confondre :
//  - catnat_* : nombre de reconnaissances de catastrophe naturelle (CatNat) pour des événements des 20 dernières années ;
//  - risques / ppr : risques recensés par la préfecture (DDRM) et plans de prévention opposables, base GASPAR. Une connaissance
//    réglementaire du risque, pas une mesure de son intensité. null = commune absente de la base (départements entiers,
//    ex. Drôme, Puy-de-Dôme) : « non renseigné », jamais « aucun risque ».
export const RISK_LABELS = {
  inond: 'Inondation',
  sub: 'Submersion marine',
  cote: 'Recul du trait de côte',
  rga: 'Retrait-gonflement des argiles',
  mvt: 'Mouvements de terrain',
  feu: 'Feu de forêt',
  avalanche: 'Avalanche',
  barrage: 'Rupture de barrage',
  industriel: 'Risque industriel',
  nucleaire: 'Risque nucléaire',
};
const ORDER = Object.keys(RISK_LABELS);
export const riskLabel = (k) => RISK_LABELS[k] || k;
/** Clés dans l'ordre des libellés ci-dessus (clés inconnues à la fin). */
export const sortRisks = (list) => [...list].sort((a, b) => (ORDER.includes(a) ? ORDER.indexOf(a) : 99) - (ORDER.includes(b) ? ORDER.indexOf(b) : 99));

/** Les quatre décomptes CatNat par aléa (colonne communale → libellé). */
export const CATNAT_KINDS = [
  { col: 'catnat_inond', label: 'Inondations reconnues' },
  { col: 'catnat_sech', label: 'Sécheresse et argiles reconnues' },
  { col: 'catnat_mer', label: 'Vagues et submersion reconnues' },
  { col: 'catnat_mvt', label: 'Mouvements de terrain reconnus' },
];

/** Normalise une ligne de fichier régional : listes ou null (colonne absente = non renseigné). */
export function normalizeRisks(c) {
  c.risques = Array.isArray(c.risques) ? c.risques : null;
  c.ppr = Array.isArray(c.ppr) ? c.ppr : null;
  return c;
}

/** Risques ou plans non renseignés dans la base GASPAR (liste absente). */
export const isUnknown = (c) => !Array.isArray(c.risques) || !Array.isArray(c.ppr);

const has = (list, k) => Array.isArray(list) && list.includes(k);

export const NUC_EXCLUDE_KM = 20; // rayon des plans particuliers d'intervention
export const UNKNOWN_ID = 'nr';

/**
 * Cases « exclure les communes… ». Chaque règle : hit(c) = vrai si la commune porte le risque (d'après les données connues) ;
 * needs = listes GASPAR nécessaires pour pouvoir le dire (liste absente et rien de trouvé : « non renseigné », la commune est gardée).
 * `{R}` dans un libellé : rayon Seveso de l'index.
 */
export const EXCLUSIONS = [
  { id: 'sub', label: 'exposées à la submersion marine', needs: ['risques', 'ppr'], hit: (c) => has(c.risques, 'sub') || has(c.ppr, 'sub') },
  { id: 'cote', label: 'concernées par le recul du trait de côte', needs: ['risques', 'ppr'], hit: (c) => c.trait_cote === true || has(c.risques, 'cote') || has(c.ppr, 'cote') },
  { id: 'feu', label: 'en zone de risque feu de forêt', needs: ['risques'], hit: (c) => has(c.risques, 'feu') },
  { id: 'inond', label: 'avec un plan de prévention inondation opposable', needs: ['ppr'], hit: (c) => has(c.ppr, 'inond') },
  { id: 'rga', label: 'avec un plan de prévention argiles', needs: ['ppr'], hit: (c) => has(c.ppr, 'rga') },
  { id: 'barrage', label: 'exposées à une rupture de barrage', needs: ['risques'], hit: (c) => has(c.risques, 'barrage') },
  { id: 'nuc', label: `à moins de ${NUC_EXCLUDE_KM} km d’une centrale`, needs: [], hit: (c) => Number.isFinite(c.nucleaire_km) && c.nucleaire_km < NUC_EXCLUDE_KM },
  { id: 'sev', label: 'avec un site Seveso à moins de {R} km', needs: [], hit: (c) => c.seveso_10km > 0 },
];
/** Identifiants valides d'un fragment « x= », dans l'ordre canonique. */
export const EXCLUSION_IDS = [...EXCLUSIONS.map((e) => e.id), UNKNOWN_ID];

/** Colonnes communales dont une au moins doit être renseignée pour qu'une case ait un effet (sinon on la désactive). */
const EXCLUSION_COLUMNS = {
  sub: ['risques', 'ppr'],
  cote: ['risques', 'ppr', 'trait_cote'],
  feu: ['risques'],
  inond: ['ppr'],
  rga: ['ppr'],
  barrage: ['risques'],
  nuc: ['nucleaire_km'],
  sev: ['seveso_10km'],
  [UNKNOWN_ID]: ['risques', 'ppr'],
};

/** { idCase: bool } : la case a-t-elle des données à exploiter parmi ces communes ? */
export function exclusionAvailability(communes) {
  const filled = (c, col) => Array.isArray(c[col]) || Number.isFinite(c[col]) || typeof c[col] === 'boolean';
  const out = {};
  for (const [id, cols] of Object.entries(EXCLUSION_COLUMNS)) out[id] = communes.some((c) => cols.some((col) => filled(c, col)));
  return out;
}

/** Règles actives d'une liste d'identifiants, et indicateur « exclure aussi les non renseignées ». */
export function activeRules(ex) {
  return { rules: EXCLUSIONS.filter((e) => ex.includes(e.id)), dropUnknown: ex.includes(UNKNOWN_ID) };
}

/**
 * @returns {null|{nr:boolean}}  null : la commune est exclue ; sinon nr = vrai si une règle active n'a pas pu être vérifiée (données non renseignées)
 */
export function checkRisks(c, { rules, dropUnknown }) {
  if (dropUnknown && isUnknown(c)) return null;
  let nr = false;
  for (const r of rules) {
    if (r.hit(c)) return null;
    if (r.needs.some((k) => !Array.isArray(c[k]))) nr = true;
  }
  return { nr };
}

/**
 * Lecture des risques d'une commune pour l'affichage (fiche, comparaison) : une seule structure, donc les mêmes chiffres partout.
 * catnat : { label, n (nombre ou null = non disponible) }[] ; risques / ppr : { state: 'unknown'|'none'|'list', items } ;
 * trait : true | false | null (null = colonne absente des données).
 */
export function riskReading(c) {
  const list = (v) => (Array.isArray(v) ? { state: v.length ? 'list' : 'none', items: sortRisks(v) } : { state: 'unknown', items: [] });
  return {
    catnat: CATNAT_KINDS.map((k) => ({ label: k.label, n: Number.isFinite(c[k.col]) ? c[k.col] : null })),
    risques: list(c.risques),
    ppr: list(c.ppr),
    trait: typeof c.trait_cote === 'boolean' ? c.trait_cote : null,
  };
}

export const RISK_CAVEAT = 'Une connaissance réglementaire du risque, pas une mesure de son intensité ; l’absence d’un risque dans la base n’en prouve pas l’absence.';
export const UNKNOWN_TEXT = 'non renseigné dans la base GASPAR';
