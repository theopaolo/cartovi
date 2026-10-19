// format.js — formatage fr-FR (nombres, dates, rangs).
export const NBSP = ' ';

const nfCache = new Map();
function nf(decimals) {
  if (!nfCache.has(decimals)) {
    nfCache.set(
      decimals,
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    );
  }
  return nfCache.get(decimals);
}

export const fmtNumber = (v, decimals = 0) => nf(decimals).format(v);

/** Valeur + unité d'un indicateur : « 1 234 €/m² », « 12,5 % ». */
export function fmtValue(v, ind) {
  if (!Number.isFinite(v)) return '—';
  return fmtNumber(v, ind.decimals) + (ind.unit ? NBSP + ind.unit : '');
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});
function safeDate(fmt, iso) {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? fmt.format(d) : '—';
}
export const fmtDate = (iso) => safeDate(dateFmt, iso);
export const fmtDateTime = (iso) => safeDate(dateTimeFmt, iso);

/** « 12ᵉ / 96 » (affichage) et « 12e sur 96 » (lecteurs d'écran). */
export const ordinal = (n) => (n === 1 ? '1ᵉʳ' : `${n}ᵉ`);
export const rankText = (r, n) => `${ordinal(r)}${NBSP}/${NBSP}${n}`;
export const rankSpoken = (r, n) => `${r === 1 ? '1er' : `${r}e`} sur ${n}`;

/** Score 0–1 → pourcentage entier. */
export const pct = (s) => Math.round(s * 100);
