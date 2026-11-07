// data.js — chargement de la page Recherche : l'index des noms au démarrage, le reste (fiches) à la demande.
import { loadData, getJSON } from '../data.js';
import { createStore, loadIndex } from '../communes/data.js';
import { indicatorScores } from '../score.js';
import { computeViews } from '../view.js';
import { buildIndex, norm } from './search.js';

/** noms.json : indispensable à la recherche. */
export async function loadNames() {
  const raw = await getJSON('data/communes/noms.json');
  if (!Array.isArray(raw?.rows) || !raw.region_of_dep) throw new Error('noms.json : structure inattendue');
  return buildIndex(raw);
}

/**
 * Contexte des fiches : départements (map.json), indicateurs, couche communale. Chaque morceau est facultatif :
 * une fiche s'affiche avec ce qui est disponible et dit ce qui manque.
 */
export async function loadContext() {
  const [dep, index] = await Promise.all([loadData().catch(() => ({ map: null, payload: null })), loadIndex().catch((e) => (console.info(e.message), null))]);
  const { map, payload } = dep;
  const territories = new Map((map?.territories || []).map((t) => [t.code, t]));
  const codes = [...territories.keys()];
  const depByName = new Map([...territories].map(([code, t]) => [norm(t.name), code]));
  let view = null; // indice composite sous pondérations par défaut
  let scores = {};
  if (payload && codes.length) {
    scores = indicatorScores(payload.indicators, codes);
    const weights = Object.fromEntries(payload.indicators.map((i) => [i.id, i.weight]));
    view = computeViews({ indicators: payload.indicators, scores, weights, mode: 'composite', codes }).comp;
  }
  return { territories, depByName, payload, scores, view, index, store: index ? createStore(index) : null };
}
