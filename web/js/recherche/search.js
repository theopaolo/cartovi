// search.js — recherche de communes dans noms.json. Fonctions pures (aucun accès au DOM) : normalisation, lecture de la requête, classement.
//
// Normalisation : minuscules, sans accents, « œ » → « oe », « æ » → « ae », ponctuation (tiret, apostrophe, point…) → espace,
// « st » → « saint » et « ste » → « sainte ». Elle s'applique à la requête comme aux noms.
// Classement : nom exact, début du nom, début d'un mot, sous-chaîne ; à rang égal, la plus peuplée d'abord (noms.json est déjà trié par population).
import { SIZES } from '../communes/filter.js';

export const SIZE_CHOICES = SIZES.filter((s) => s.id !== 'toutes');
const ABBREV = { st: 'saint', ste: 'sainte' };
const RE_DEP = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[ab]|\d\d)$/; // code à 2 caractères (01–95, 2A, 2B), ou 2 chiffres quelconques (aucun résultat plutôt qu'un mot de nom)
const RE_CODE = /^(?:\d{5}|2[ab]\d{3})$/; // code INSEE
const RE_NUM = /^\d+$/;
export const MAX_QUERY = 100;

/** Clé de recherche : « Saint-Étienne » → « saint etienne » (mots séparés par une espace). */
export function norm(s) {
  const t = String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return t
    .split(' ')
    .map((w) => ABBREV[w] || w)
    .join(' ');
}

/**
 * Prépare l'index à partir de noms.json.
 * @param {{rows:[string,string,number][], region_of_dep:Object<string,string>}} raw
 * @returns index utilisable par search()
 */
export function buildIndex(raw) {
  const rows = (raw?.rows || []).filter((r) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string');
  const regionOf = raw?.region_of_dep || {};
  return {
    rows,
    keys: rows.map((r) => norm(r[1])),
    deps: rows.map((r) => r[0].slice(0, 2)),
    regions: rows.map((r) => regionOf[r[0].slice(0, 2)] || ''),
    byCode: new Map(rows.map((r, i) => [r[0], i])),
    regionOf,
  };
}

/**
 * Découpe la requête en : codes de département (2 caractères), code INSEE (5 caractères), nom de département, mots du nom.
 * @param {string} q
 * @param {Map<string,string>} [depByName]  nom de département normalisé → code
 * @returns {{words:string[], deps:string[], code:string|null, byName:string[], text:string}}
 */
export function parseQuery(q, depByName = new Map()) {
  const toks = norm(String(q).slice(0, MAX_QUERY)).split(' ').filter(Boolean);
  const deps = [];
  let code = null;
  const rest = [];
  for (const t of toks) {
    if (RE_CODE.test(t)) code = t.toUpperCase();
    else if (RE_DEP.test(t)) deps.push(t.toUpperCase());
    else if (RE_NUM.test(t)) continue; // début de code en cours de frappe : on n'élimine pas tout pour autant
    else rest.push(t);
  }
  // nom de département : plus longue suite de mots (jusqu'à 5), à condition qu'il reste d'autres mots (« saint martin isère »)
  const byName = [];
  let words = rest;
  for (let len = Math.min(5, rest.length - 1); len >= 1 && depByName.size; len--) {
    for (let i = 0; i + len <= rest.length; i++) {
      const name = rest.slice(i, i + len).join(' ');
      if (depByName.has(name)) {
        byName.push(depByName.get(name));
        words = [...rest.slice(0, i), ...rest.slice(i + len)];
        len = 0; // une seule suite reconnue
        break;
      }
    }
  }
  return { words, deps: [...new Set([...deps, ...byName])], code, byName, text: words.join(' ') };
}

const inSize = (pop, sizes) => sizes.some((s) => pop >= s.min && pop < s.max);

/**
 * Indices (dans index.rows) des communes retenues, du mieux au moins bien classé.
 * @param {object} index  sortie de buildIndex
 * @param {string} q
 * @param {{region?:string, sizes?:string[], depByName?:Map<string,string>}} [opts]
 * @returns {{list:number[], q:ReturnType<typeof parseQuery>, active:boolean}}  active : la requête ou un filtre restreint la liste
 */
export function search(index, q, { region = '', sizes = [], depByName } = {}) {
  const pq = parseQuery(q, depByName);
  const sz = SIZE_CHOICES.filter((s) => sizes.includes(s.id));
  const active = !!(pq.words.length || pq.deps.length || pq.code || region || sz.length);
  if (!active) return { list: [], q: pq, active };
  const depSet = pq.deps.length ? new Set(pq.deps) : null;
  const text = pq.text;
  const words = pq.words;
  const buckets = [[], [], [], [], []]; // exact, début du nom, début d'un mot, sous-chaîne, sans texte
  const { rows, keys } = index;
  for (let i = 0; i < rows.length; i++) {
    if (depSet && !depSet.has(index.deps[i])) continue;
    if (region && index.regions[i] !== region) continue;
    if (pq.code && rows[i][0] !== pq.code) continue;
    if (sz.length && !inSize(rows[i][2], sz)) continue;
    if (!words.length) {
      buckets[4].push(i);
      continue;
    }
    const k = keys[i];
    let b = -1;
    if (k === text) b = 0;
    else if (k.startsWith(text)) b = 1;
    else {
      const padded = ` ${k}`;
      if (words.every((w) => padded.includes(` ${w}`))) b = 2;
      else if (words.every((w) => k.includes(w))) b = 3;
    }
    if (b >= 0) buckets[b].push(i);
  }
  return { list: [].concat(...buckets), q: pq, active };
}
