// hash.js — état de la page « Communes » dans le fragment d'URL (seules les valeurs ≠ défaut y figurent) :
//   #r=84,75&v=69123&t=60&g=40&gb=zone&dm=20&px=2500&s=-pop&c=69381
// r régions · v ville de référence (code, ou « tous ») · t minutes max · dm distance min au centre (km)
// pmin/pmax population · g % gauche min · gb base de la part de gauche (« zone » = rayon de 10 km)
// tr trains/j min · km distance gare max · ci/sc cinémas/scènes min · lb lieu labellisé · px prix max
// pu 0 = écarter les prix inconnus · s tri (« - » devant = décroissant) · c commune sélectionnée
// w poids du score ≠ défaut (w=tps:2,pol:1.5) · o sens choisi ≠ défaut (o=prx:plus,pol:gauche) — ids : score-communes.js
import { SORTS } from './filter.js';
import { CRITERION, W_MAX, W_STEP, defaultSettings } from './score-communes.js';

// clé du fragment → [champ des critères, minimum, maximum]
const NUM = {
  t: ['maxMin', 15, 150],
  dm: ['distMin', 0, 500],
  pmin: ['popMin', 0, 1e7],
  pmax: ['popMax', 1, 1e7],
  g: ['leftMin', 0, 100],
  tr: ['trainsMin', 0, 1000],
  km: ['kmMax', 0, 100],
  ci: ['cinemasMin', 0, 1000],
  sc: ['scenesMin', 0, 1000],
  px: ['priceMax', 0, 1e6],
};

/**
 * Lit le fragment. Les clés inconnues et les valeurs invalides sont ignorées (le défaut s'applique).
 * @param {{regions:Set<string>, hubs:Set<string>}} known  codes valides
 * @returns {{crit:object, sort:object, selected:string|null, score:object}}
 */
export function parseHash(hash, defaults, defaultSort, known) {
  const crit = { ...defaults };
  const sort = { ...defaultSort };
  let selected = null;
  const score = defaultSettings();
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    let v;
    try {
      v = decodeURIComponent(part.slice(eq + 1));
    } catch {
      continue; // fragment mal encodé
    }
    if (Object.hasOwn(NUM, k)) {
      const [field, lo, hi] = NUM[k];
      const n = Number(v);
      if (v !== '' && Number.isFinite(n)) crit[field] = Math.min(hi, Math.max(lo, n));
    } else if (k === 'r') {
      crit.regions = [...new Set(v.split(',').filter((c) => known.regions.has(c)))];
    } else if (k === 'v') {
      if (v === 'tous') crit.hub = null;
      else if (known.hubs.has(v)) crit.hub = v;
    } else if (k === 'gb') {
      if (v === 'zone' || v === 'commune') crit.leftBasis = v;
    } else if (k === 'lb') crit.label = v === '1';
    else if (k === 'pu') crit.priceUnknown = v !== '0';
    else if (k === 's') {
      const key = v.replace(/^-/, '');
      if (Object.hasOwn(SORTS, key)) Object.assign(sort, { key, dir: v.startsWith('-') ? -1 : 1 });
    } else if (k === 'w' || k === 'o') {
      for (const pair of v.split(',')) {
        const [id, val = ''] = pair.split(':');
        const cr = Object.hasOwn(CRITERION, id) ? CRITERION[id] : null;
        if (!cr) continue;
        if (k === 'w') {
          const n = Number(val);
          if (val !== '' && Number.isFinite(n)) score.w[id] = Math.round(Math.min(W_MAX, Math.max(0, n)) / W_STEP) * W_STEP;
        } else if (cr.choice?.some((o) => o.id === val)) score.o[id] = val;
      }
    } else if (k === 'c' && /^[0-9AB]{5}$/.test(v)) selected = v;
  }
  return { crit, sort, selected, score };
}

/** Fragment correspondant à l'état (chaîne vide si tout est par défaut). */
export function hashFor({ crit, sort, selected, score }, defaults, defaultSort) {
  const parts = [];
  const sameRegions = crit.regions.length === defaults.regions.length && crit.regions.every((c) => defaults.regions.includes(c));
  if (!sameRegions) parts.push(`r=${[...crit.regions].sort().join(',')}`);
  if (crit.hub !== defaults.hub) parts.push(`v=${crit.hub ? encodeURIComponent(crit.hub) : 'tous'}`);
  for (const [k, [field]] of Object.entries(NUM)) if (crit[field] !== defaults[field]) parts.push(`${k}=${crit[field]}`);
  if (crit.leftBasis !== defaults.leftBasis) parts.push(`gb=${crit.leftBasis}`);
  if (crit.label !== defaults.label) parts.push(`lb=${crit.label ? 1 : 0}`);
  if (crit.priceUnknown !== defaults.priceUnknown) parts.push(`pu=${crit.priceUnknown ? 1 : 0}`);
  if (sort.key !== defaultSort.key || sort.dir !== defaultSort.dir) {
    parts.push(`s=${sort.dir < 0 ? '-' : ''}${sort.key}`);
  }
  const def = defaultSettings();
  const w = Object.keys(def.w).filter((id) => score.w[id] !== def.w[id]).map((id) => `${id}:${score.w[id]}`);
  const o = Object.keys(def.o).filter((id) => score.o[id] !== def.o[id] && score.o[id]).map((id) => `${id}:${score.o[id]}`);
  if (w.length) parts.push(`w=${w.join(',')}`);
  if (o.length) parts.push(`o=${o.join(',')}`);
  if (selected) parts.push(`c=${encodeURIComponent(selected)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

export function writeHash(hash, { push = false } = {}) {
  if (hash === location.hash || (!hash && !location.hash)) return;
  const url = location.pathname + location.search + hash;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
