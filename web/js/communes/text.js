// text.js — libellés partagés par le tableau, le détail et les résumés (aucun accès au DOM).
import { NBSP, fmtNumber } from '../format.js';

/** « 1 cinéma », « 3 cinémas » (0 reste au singulier en français). */
export const plural = (n, one, many = `${one}s`) => `${fmtNumber(n)}${NBSP}${n > 1 ? many : one}`;

export const fmtPct = (v) => (v == null ? '—' : `${fmtNumber(v, 1)}${NBSP}%`);
export const fmtPrice = (v) => (v == null ? '—' : `${fmtNumber(v)}${NBSP}€/m²`);
export const fmtKm = (v) => `${fmtNumber(v, 1)}${NBSP}km`;
export const fmtPop = (n) => `${fmtNumber(n)}${NBSP}hab.`;

/** Durée d'un trajet : « 34 min », « 1 h 05 ». 0 min : la gare utilisée est déjà dans la ville de référence. */
export function fmtDuration(min) {
  if (min < 60) return `${min}${NBSP}min`;
  return `${Math.floor(min / 60)}${NBSP}h${NBSP}${String(min % 60).padStart(2, '0')}`;
}

/** « 3 cinémas · 5 scènes · 2 labels » (les zéros sont omis). */
export function cultureText(c) {
  const parts = [];
  if (c.cinemas) parts.push(plural(c.cinemas, 'cinéma'));
  if (c.scenes) parts.push(plural(c.scenes, 'scène'));
  if (c.labels) parts.push(plural(c.labels, 'label'));
  return parts.length ? parts.join(' · ') : 'aucun';
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' });
/** « le jeudi 5 novembre 2026 » à partir de « 2026-11-05 ». */
export const fmtDay = (iso) => (iso && !Number.isNaN(new Date(iso).getTime()) ? `le ${dayFmt.format(new Date(iso))}` : 'un jour de semaine type');

export const trainsText = (n) => `${fmtNumber(n)}${NBSP}train${n > 1 ? 's' : ''}/j`;

/** Distance à la gare utilisée pour un trajet ; le nom n'est donné que si c'est la gare la plus proche. */
export function stationText(c, km) {
  if (c.gare && Math.abs(km - c.gare_km) < 0.15) return { name: c.gare, km: fmtKm(km) };
  return { name: null, km: fmtKm(km) };
}
