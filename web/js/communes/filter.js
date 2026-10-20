// filter.js — critères, filtrage et tri (calculs purs, aucun accès au DOM).
//
// Aucun score : une commune correspond ou non. Pour le trajet, l'unité est la « liaison » :
// un trajet direct vers une ville de référence, avec sa durée, son nombre de trains par jour et
// la distance à la gare utilisée. Une commune correspond s'il existe UNE liaison qui respecte
// ensemble le temps maximal, le nombre minimal de trains et la distance maximale à la gare ;
// on retient alors la plus rapide (à durée égale, la plus fréquente).

// Crans des curseurs « à paliers » (population, trains, culture, prix…). Infinity = pas de limite.
export const STOPS = {
  popMin: [0, 100, 200, 500, 1000, 1500, 2000, 5000, 10000, 20000, 50000, 100000],
  popMax: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, Infinity],
  trainsMin: [0, 1, 2, 3, 5, 8, 10, 15, 20, 30, 50],
  kmMax: [0.5, 1, 2, 3, 4, 5, Infinity],
  cinemasMin: [0, 1, 2, 3, 5, 10],
  scenesMin: [0, 1, 2, 3, 5, 10, 20],
  priceMax: [1000, 1500, 2000, 2500, 3000, 4000, 5000, Infinity],
};

// Tailles usuelles : population ≥ min et < max.
export const SIZES = [
  { id: 'toutes', label: 'Toutes tailles', min: 0, max: Infinity },
  { id: 'village', label: 'Village < 2 000', min: 0, max: 2000 },
  { id: 'bourg', label: 'Bourg 2 000–10 000', min: 2000, max: 10000 },
  { id: 'petite', label: 'Petite ville 10 000–50 000', min: 10000, max: 50000 },
  { id: 'ville', label: 'Ville > 50 000', min: 50000, max: Infinity },
];

export const DEFAULTS = {
  regions: ['84', '75'], // Auvergne-Rhône-Alpes, Nouvelle-Aquitaine
  hub: null, // code INSEE de la ville de référence, ou null = n'importe laquelle (rempli au chargement)
  maxMin: 60,
  popMin: 0,
  popMax: Infinity,
  leftBasis: 'commune', // base de la part de gauche : 'commune' ou 'zone' (rayon de 10 km)
  leftMin: 38,
  distMin: 15, // km minimum entre la commune et le centre de la ville de référence
  trainsMin: 0,
  kmMax: Infinity,
  cinemasMin: 0,
  scenesMin: 0,
  label: false,
  priceMax: Infinity,
  priceUnknown: true, // garder les communes sans prix connu (moins de 10 ventes) quand un plafond est fixé
};

export const DEFAULT_SORT = { key: 'time', dir: 1 };

/**
 * Communes correspondant aux critères, avec leur meilleure liaison.
 * @param {object[]} communes  communes normalisées (data.js)
 * @param {object} crit  critères (DEFAULTS)
 * @param {number} hubIdx  indice de la ville de référence dans index.json, ou -1 pour n'importe laquelle
 * @param {{x:number,y:number}|null} hub  centre de la ville de référence choisie (null si hubIdx = -1)
 * @param {number} kmPerUnit  kilomètres par unité du viewBox
 * @returns {{c:object, hub:number, min:number, trains:number, km:number, left:number|null}[]}
 */
export function applyFilters(communes, crit, hubIdx, hub, kmPerUnit) {
  const { maxMin, popMin, popMax, leftBasis, leftMin, distMin, trainsMin, kmMax, cinemasMin, scenesMin, label, priceMax, priceUnknown } = crit;
  const key = leftBasis === 'zone' ? 'gauche_10km' : 'gauche_commune';
  const out = [];
  for (const c of communes) {
    // critères propres à la commune d'abord (peu coûteux), trajet ensuite
    if (c.pop < popMin || c.pop >= popMax) continue;
    const left = c[key];
    if (leftMin > 0 && !(left >= leftMin)) continue; // sans donnée : écartée dès qu'un minimum est fixé
    if (c.cinemas < cinemasMin || c.scenes < scenesMin) continue;
    if (label && !(c.labels > 0)) continue;
    if (priceMax < Infinity && (c.prix == null ? !priceUnknown : c.prix > priceMax)) continue;
    // à distance minimale du centre : de la ville choisie, ou de toutes les villes de référence en mode « n'importe laquelle »
    if (distMin > 0 && (hub ? Math.hypot(c.x - hub.x, c.y - hub.y) * kmPerUnit : c.dmin) < distMin) continue;

    const r = c.reach;
    let best = -1;
    let min = Infinity;
    let trains = 0;
    let km = 0;
    for (let i = 0; i < r.length; i += 4) {
      if (hubIdx >= 0 && r[i] !== hubIdx) continue;
      if (distMin > 0 && r[i + 1] === 0) continue; // gare dans la ville de référence : liaison intra-urbaine
      if (r[i + 1] > maxMin || r[i + 2] < trainsMin || r[i + 3] > kmMax) continue;
      if (r[i + 1] < min || (r[i + 1] === min && r[i + 2] > trains)) {
        best = r[i];
        min = r[i + 1];
        trains = r[i + 2];
        km = r[i + 3];
      }
    }
    if (best >= 0) out.push({ c, hub: best, min, trains, km, left: left ?? null });
  }
  return out;
}

// Colonnes triables. `first` : sens du premier clic (1 = croissant) ; `val` : valeur comparée (null = en dernier).
export const SORTS = {
  time: { label: 'Temps de trajet', first: 1, val: (r) => r.min },
  trains: { label: 'Trains par jour', first: -1, val: (r) => r.trains },
  nom: { label: 'Nom', first: 1, val: (r) => r.c.key },
  pop: { label: 'Population', first: -1, val: (r) => r.c.pop },
  km: { label: 'Distance à la gare', first: 1, val: (r) => r.km },
  gauche: { label: 'Part de gauche', first: -1, val: (r) => r.left },
  culture: { label: 'Offre culturelle', first: -1, val: (r) => r.c.cult },
  prix: { label: 'Prix des maisons', first: 1, val: (r) => r.c.prix },
};

/** Tri en place. Départage toujours par temps de trajet, puis nombre de trains (décroissant), puis nom. */
export function sortResults(list, { key, dir }) {
  const val = (SORTS[key] || SORTS.time).val;
  return list.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va == null || vb == null) return (va == null) - (vb == null);
    if (va !== vb) return dir * (va < vb ? -1 : 1);
    return a.min - b.min || b.trains - a.trains || (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0);
  });
}

/** Garde popMin < popMax après un réglage : l'autre borne suit au cran voisin. */
export function fixPopulation(crit, changed) {
  if (crit.popMin < crit.popMax) return;
  if (changed === 'popMin') crit.popMax = STOPS.popMax.find((v) => v > crit.popMin) ?? Infinity;
  else crit.popMin = [...STOPS.popMin].reverse().find((v) => v < crit.popMax) ?? 0;
}

/** Médiane de la part de gauche sur la base choisie (repère affiché sous le curseur). */
export function medianLeft(communes, basis) {
  const key = basis === 'zone' ? 'gauche_10km' : 'gauche_commune';
  const v = communes.map((c) => c[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}
