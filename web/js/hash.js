// hash.js — état partageable dans le fragment d'URL :
//   #d=69&m=densite&n=minmax&w=eau_x:2,prix:0   (département, mode/indicateur, lecture par écart, poids différents du défaut)
import { DEFAULT_NORM } from './score.js';

export function parseHash(hash = location.hash) {
  const out = {};
  for (const part of hash.replace(/^#/, '').split('&')) {
    const [k, v = ''] = part.split('=');
    try {
      if (k === 'd') out.selected = decodeURIComponent(v);
      else if (k === 'm') out.mode = decodeURIComponent(v);
      else if (k === 'n') out.norm = decodeURIComponent(v);
      else if (k === 'w') {
        out.weights = {};
        for (const pair of v.split(',')) {
          const [id, w] = pair.split(':');
          const n = Number(w);
          if (id && w !== undefined && w !== '' && Number.isFinite(n)) out.weights[decodeURIComponent(id)] = n;
        }
      }
    } catch {
      /* fragment mal encodé : on l'ignore */
    }
  }
  return out;
}

export function hashFor(state, defaults) {
  const parts = [];
  if (state.selected) parts.push(`d=${encodeURIComponent(state.selected)}`);
  if (state.mode !== 'composite') parts.push(`m=${encodeURIComponent(state.mode)}`);
  if (state.norm && state.norm !== DEFAULT_NORM) parts.push(`n=${encodeURIComponent(state.norm)}`);
  const diff = Object.keys(state.weights)
    .filter((id) => state.weights[id] !== defaults[id])
    .map((id) => `${encodeURIComponent(id)}:${state.weights[id]}`);
  if (diff.length) parts.push(`w=${diff.join(',')}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

export function writeHash(state, defaults, { push = false } = {}) {
  const hash = hashFor(state, defaults);
  if (hash === location.hash || (!hash && !location.hash)) return;
  const url = location.pathname + location.search + hash;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
