// data.js — couche communale : index.json au démarrage, puis un fichier par région chargé à la demande.
import { getJSON } from '../data.js';

const DIR = 'data/communes/';
const SAFE_FILE = /^[\w.-]+\.json$/;

const rad = (d) => (d * Math.PI) / 180;
/** Distance à vol d'oiseau en km (formule de haversine). */
function haversineKm(lon1, lat1, lon2, lat2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/**
 * Kilomètres par unité du viewBox, déduits de deux villes de référence éloignées (distance réelle ÷ distance sur la carte).
 * La projection est conforme : l'échelle varie peu (≈ 1,165 km/unité) sur la métropole.
 */
function kmPerUnit(hubs) {
  if (hubs.length < 2) return 1.165;
  const a = hubs[0];
  const b = hubs.reduce((far, h) => (Math.hypot(h.x - a.x, h.y - a.y) > Math.hypot(far.x - a.x, far.y - a.y) ? h : far), hubs[1]);
  return haversineKm(a.lon, a.lat, b.lon, b.lat) / Math.hypot(b.x - a.x, b.y - a.y);
}

/** Minuscules sans accents : clé de tri et de recherche. */
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** index.json : villes de référence, régions, rayons. Lève une erreur si la structure est inattendue. */
export async function loadIndex() {
  const raw = await getJSON(`${DIR}index.json`);
  if (![raw?.hubs, raw?.regions, raw?.columns].every(Array.isArray)) throw new Error('index.json : structure inattendue');
  const dup = new Map();
  for (const h of raw.hubs) dup.set(h.name, (dup.get(h.name) || 0) + 1);
  const hubs = raw.hubs.map((h, i) => ({
    ...h,
    i, // position dans index.json : c'est la clé de `villes` dans les fichiers régionaux
    label: dup.get(h.name) > 1 ? `${h.name} (${String(h.code).slice(0, 2)})` : h.name,
    key: fold(h.name),
  }));
  const scale = kmPerUnit(hubs);
  const regions = raw.regions
    .filter((r) => r && r.code && SAFE_FILE.test(r.file || ''))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return {
    generated_at: raw.generated_at,
    reference_day: raw.reference_day,
    viewBox: raw.viewBox || '0 0 1000 931',
    kmPerUnit: scale,
    radius: { gare: 6, vote: 10, culture: 15, ...raw.radius_km },
    columns: raw.columns,
    hubs,
    hubByCode: new Map(hubs.map((h) => [h.code, h])),
    regions,
    regionByCode: new Map(regions.map((r) => [r.code, r])),
  };
}

/** Ville de référence proposée par défaut : Lyon si elle existe, sinon la plus peuplée. */
export const defaultHub = (index) => index.hubs.find((h) => h.key === 'lyon') || index.hubs[0];

/** Une ligne du fichier régional → commune. Renvoie null si les champs indispensables manquent. */
function toCommune(row, cols, hubs, scale) {
  if (!Array.isArray(row)) return null;
  const c = {};
  for (let i = 0; i < cols.length; i++) c[cols[i]] = row[i];
  if (typeof c.code !== 'string' || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  c.nom = c.nom || c.code;
  c.key = fold(c.nom);
  c.pop = Number(c.pop) || 0;
  for (const k of ['cinemas', 'scenes', 'labels', 'musees', 'librairies', 'conservatoires']) c[k] = Number(c[k]) || 0;
  c.cult = c.cinemas + c.scenes + c.labels;
  // villes {hub: [minutes, trains/j, km]} → tableau plat [hub, minutes, trains, km, …] : on le parcourt à chaque filtrage
  c.reach = [];
  for (const [k, v] of Object.entries(c.villes || {})) if (Array.isArray(v)) c.reach.push(Number(k), v[0], v[1], v[2]);
  delete c.villes;
  // distance (km) à la ville de référence la plus proche, calculée une fois : sert au filtre « distance minimale au centre »
  c.dmin = Infinity;
  for (const hb of hubs) c.dmin = Math.min(c.dmin, Math.hypot(c.x - hb.x, c.y - hb.y) * scale);
  return c;
}

export function createStore(index) {
  const requests = new Map(); // code région → Promise<commune[]>
  const loaded = new Map(); // code région → commune[]
  const byCode = new Map();
  const lists = new Map(); // mémo des listes concaténées, vidé à chaque nouvelle région

  function load(code) {
    const region = index.regionByCode.get(code);
    if (!region) return Promise.reject(new Error(`région inconnue : ${code}`));
    if (!requests.has(code)) {
      requests.set(
        code,
        getJSON(DIR + region.file)
          .then((raw) => {
            const list = (raw?.rows || []).map((r) => toCommune(r, index.columns, index.hubs, index.kmPerUnit)).filter(Boolean);
            for (const c of list) {
              c.region = code;
              byCode.set(c.code, c);
            }
            loaded.set(code, list);
            lists.clear();
            return list;
          })
          .catch((e) => {
            requests.delete(code); // on pourra réessayer
            throw e;
          }),
      );
    }
    return requests.get(code);
  }

  return {
    load,
    isLoaded: (code) => loaded.has(code),
    commune: (code) => byCode.get(code),
    /** Communes des régions demandées déjà chargées (même tableau tant que rien ne change). */
    communesOf(codes) {
      const key = [...codes].sort().join(',');
      if (!lists.has(key)) lists.set(key, key ? [].concat(...[...codes].sort().map((c) => loaded.get(c) || [])) : []);
      return lists.get(key);
    },
  };
}
