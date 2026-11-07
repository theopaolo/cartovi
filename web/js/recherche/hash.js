// hash.js — état de la page Recherche dans le fragment d'URL (seules les valeurs non vides y figurent) :
//   #q=saint%20martin%2038&c=69123&cmp=69123,26113,16015&r=84&sz=village,bourg
// q requête · c commune ouverte · cmp communes comparées (4 au plus) · r région · sz tailles
import { MAX_QUERY, SIZE_CHOICES } from './search.js';

export const MAX_COMPARE = 4;
const RE_CODE = /^(?:\d{5}|2[AB]\d{3})$/;

/**
 * Lit le fragment. Tout ce qui est invalide ou inconnu est ignoré (jamais d'exception).
 * @param {string} hash
 * @param {{has:(code:string)=>boolean}} [known]  communes connues (Map de l'index) : sans lui, on ne vérifie que le format
 * @param {Set<string>} [regions]  codes de région valides
 */
export function parseHash(hash, known, regions) {
  const out = { q: '', c: null, cmp: [], region: '', sizes: [] };
  const ok = (code) => RE_CODE.test(code) && (!known || known.has(code));
  for (const part of String(hash).replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    let v;
    try {
      v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      continue; // fragment mal encodé
    }
    if (k === 'q') out.q = v.slice(0, MAX_QUERY);
    else if (k === 'c') out.c = ok(v.toUpperCase()) ? v.toUpperCase() : null;
    else if (k === 'cmp') out.cmp = [...new Set(v.toUpperCase().split(',').filter(ok))].slice(0, MAX_COMPARE);
    else if (k === 'r') out.region = !regions || regions.has(v) ? (/^\d{2}$/.test(v) ? v : '') : '';
    else if (k === 'sz') out.sizes = SIZE_CHOICES.map((s) => s.id).filter((id) => v.split(',').includes(id));
  }
  return out;
}

export function hashFor({ q, c, cmp, region, sizes }) {
  const parts = [];
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  if (c) parts.push(`c=${c}`);
  if (cmp.length) parts.push(`cmp=${cmp.join(',')}`);
  if (region) parts.push(`r=${region}`);
  if (sizes.length) parts.push(`sz=${sizes.join(',')}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

export function writeHash(hash, { push = false } = {}) {
  if (hash === location.hash || (!hash && !location.hash)) return;
  const url = location.pathname + location.search + hash;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
