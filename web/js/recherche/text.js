// text.js — libellés français propres à la page Recherche : sources de la couche communale, vitesses, semaine de vent.
import { NBSP, fmtNumber } from '../format.js';
import { fmtDay } from '../communes/text.js';

export const NATIONAL_LEFT = 32.4; // part de gauche de la France entière aux européennes 2024 (% des exprimés)

// Sources de la couche communale (voir pipeline/communes.py) ; les départements portent les leurs dans indicators.json.
export const SOURCES = {
  train: { label: 'Horaires SNCF (GTFS national : TER, Intercités, TGV)', url: 'https://transport.data.gouv.fr/datasets/horaires-sncf' },
  vote: { label: 'Ministère de l’Intérieur — résultats des européennes 2024 par commune', url: 'https://www.data.gouv.fr/datasets/resultats-des-elections-europeennes-du-9-juin-2024' },
  culture: { label: 'Basilic — ministère de la Culture', url: 'https://www.data.gouv.fr/datasets/base-des-lieux-et-equipements-culturels-basilic' },
  prix: { label: 'DVF (statistiques) — Etalab', url: 'https://www.data.gouv.fr/datasets/statistiques-dvf' },
  pop: { label: 'geo.api.gouv.fr (INSEE)', url: 'https://geo.api.gouv.fr/' },
};

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const moment = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' });

/** « du 26 octobre au 2 novembre 2026 » (heure de Paris). */
export const fmtWeek = (from, to) => `du ${dayMonth.format(from)} au ${dayMonthYear.format(to)}`;
/** « lundi 27 octobre à 14 h ». */
export const fmtMoment = (ms) => moment.format(ms);

export const kmh = (ms) => `${fmtNumber(Math.round(ms * 3.6))}${NBSP}km/h`;
export const mps = (ms) => `${fmtNumber(ms, 1)}${NBSP}m/s`;
/** Distance en km arrondie : « 23 km », « moins de 1 km ». */
export const fmtDistance = (km) => (km < 1 ? `moins de 1${NBSP}km` : `${fmtNumber(Math.round(km))}${NBSP}km`);

export const trainNote = () => "Trajets directs uniquement : un trajet avec correspondance n’apparaît pas.";
