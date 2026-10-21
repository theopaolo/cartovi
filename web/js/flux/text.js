// text.js — libellés français de la page Flux : date et heure de Paris, vitesse, direction, distance, source.
// Aucun accès au DOM, sauf fillMethod() qui complète le texte de méthode.
import { NBSP, fmtDateTime, fmtNumber } from '../format.js';
import { FLOW_HOURS_PER_SECOND } from './wind-gl.js';

const parts = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
});
const dayName = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'Europe/Paris' });
const dayNum = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'Europe/Paris' });

/** « 14 h » ou « 14 h 20 » (heure de Paris). */
export function fmtHour(ms) {
  let h = '';
  let m = '';
  for (const p of parts.formatToParts(ms)) {
    if (p.type === 'hour') h = String(Number(p.value));
    else if (p.type === 'minute') m = p.value;
  }
  return m === '00' ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${m}`;
}

/** « mercredi 15 octobre · 14 h 20 », heure de Paris. */
export function fmtMoment(ms) {
  let day = '';
  for (const p of parts.formatToParts(ms)) {
    if (p.type === 'weekday') day = p.value;
    else if (p.type === 'day') day += `${NBSP}${p.value}`;
    else if (p.type === 'month') day += `${NBSP}${p.value}`;
  }
  return `${day} · ${fmtHour(ms)}`;
}

/** « lun. » et « 13 » : repère de jour sous le curseur de temps. */
export const fmtDayTick = (ms) => [dayName.format(ms), dayNum.format(ms)];

/** Minuit de Paris dans [from, to] : ms et rang du jour, pour graduer le curseur de temps. */
export function midnights(from, to) {
  const hourOf = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' });
  const out = [];
  for (let t = Math.ceil(from / 600000) * 600000; t <= to; t += 600000) {
    if (hourOf.format(t) === '00:00') out.push(t);
  }
  return out;
}

const ROSE = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];

/** Direction d'où vient le vent, en degrés (0 = nord, sens horaire), lue sur la carte : le haut de l'écran est le nord. */
export function fromBearing(vx, vy) {
  const to = (Math.atan2(vx, -vy) * 180) / Math.PI; // cap vers lequel souffle le vent (y de l'écran vers le bas)
  return (to + 540) % 360;
}

/** « vent de sud-ouest », « vent d’ouest ». */
export function windPhrase(fromDeg) {
  const name = ROSE[Math.round(fromDeg / 45) % 8];
  return `vent ${/^[eo]/.test(name) ? 'd’' : 'de '}${name}`;
}

export const msToKmh = (v) => v * 3.6;
export const fmtSpeed = (v) => `${fmtNumber(v, 1)}${NBSP}m/s`;
export const fmtKmh = (v) => `${fmtNumber(Math.round(msToKmh(v)))}${NBSP}km/h`;

/** Distance en km, arrondie : « 23 km », « moins de 1 km ». */
export const fmtDistance = (km) => (km < 1 ? `moins de 1${NBSP}km` : `${fmtNumber(Math.round(km))}${NBSP}km`);

/** Texte de méthode : source, licence, date de génération et échelle d'affichage. flux peut être null (données absentes). */
export function fillMethod(flux) {
  const $ = (sel) => document.querySelector(sel);
  for (const el of document.querySelectorAll('[data-flow]')) el.textContent = String(FLOW_HOURS_PER_SECOND);
  if (!flux) {
    $('#generated').textContent = 'Données en cours de génération.';
    return;
  }
  const km = (flux.stepDeg || 0.5) * 111;
  $('#src-label').textContent = flux.source.label || 'Open-Meteo';
  const a = $('#src-link');
  if (flux.source.url) a.href = flux.source.url;
  else a.removeAttribute('href');
  $('#src-licence').textContent = flux.source.licence || '—';
  $('#frames-n').textContent = String(flux.frames);
  $('#grid-km').textContent = `${fmtNumber(Math.round(km * Math.cos((46 * Math.PI) / 180)))}${NBSP}km d’est en ouest et ${fmtNumber(Math.round(km))}${NBSP}km du nord au sud`;
  $('#generated').textContent = flux.generatedAt ? `Données générées le ${fmtDateTime(flux.generatedAt)}.` : '';
}
