// vielocale.js — vie locale et mobilité sans voiture (pipeline/locale.py → colonnes de la couche communale).
// Partagé par le score (critères), la fiche Recherche, la comparaison et le détail de la page Communes.
import { NBSP, fmtNumber } from './format.js';
import { fmtPct, plural } from './communes/text.js';

export const VIE_SOURCES = [
  { label: 'SIRENE (INSEE) — établissements de l’économie sociale et solidaire', url: 'https://www.data.gouv.fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret' },
  { label: 'Répertoire national des associations (ministère de l’Intérieur)', url: 'https://www.data.gouv.fr/datasets/repertoire-national-des-associations' },
  { label: 'Recensement de la population (INSEE)', url: 'https://www.insee.fr/fr/information/2008354' },
  { label: 'Annuaire de l’éducation', url: 'https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/' },
  { label: 'Recensement des tiers-lieux 2026 (France Tiers-Lieux)', url: 'https://www.data.gouv.fr/datasets/6a97e79385c92876997291c8' },
  { label: 'Panorama des festivals (ministère de la Culture)', url: 'https://www.data.gouv.fr/datasets/5b51825fa3a72936dfe1c340' },
];

export const VIE_CAVEAT =
  'Des comptes de structures, pas une mesure de leur taille ni de leur ouverture : une association nationale compte pour un établissement là où elle en a un. ' +
  'La part des ménages sans voiture dit aussi la pauvreté, pas seulement la desserte ; la part des trajets domicile-travail à pied, à vélo ou en transports en commun est une mesure plus directe. ' +
  'Les festivals viennent du seul inventaire national ouvert (éditions 2018-2019).';

const per1000 = (v) => `${fmtNumber(v, 1)}${NBSP}pour 1${NBSP}000${NBSP}hab.`;
const n = (v, one, many) => (Number.isFinite(v) ? plural(v, one, many) : '—');

/** true si la couche communale porte la vie locale (données générées après l'ajout de pipeline/locale.py). */
export const hasVie = (c) => ['navette_douce', 'ess_1000_10km', 'college_5km'].some((k) => Number.isFinite(c[k]));

/** Lignes { id, label, text, sub } pour la fiche et la comparaison. R : rayons (index.json). */
export function vieRows(c, R = {}) {
  const local = R.local ?? 10;
  const proche = R.proche ?? 5;
  const fest = R.festival ?? 15;
  return [
    { id: 'navette_douce', label: 'Actifs allant travailler à pied, à vélo ou en transports en commun', text: fmtPct(c.navette_douce), sub: 'recensement 2023' },
    { id: 'sans_voiture', label: 'Ménages sans voiture', text: fmtPct(c.sans_voiture), sub: 'recensement 2023' },
    { id: 'ess', label: `Structures de l’ESS à ${local}${NBSP}km`, text: Number.isFinite(c.ess_1000_10km) ? per1000(c.ess_1000_10km) : '—', sub: Number.isFinite(c.ess) ? `dont ${n(c.ess, 'établissement')} dans la commune` : null },
    { id: 'coop', label: `Coopératives à ${local}${NBSP}km`, text: n(c.coop_10km, 'établissement'), sub: Number.isFinite(c.coop) ? `dont ${fmtNumber(c.coop)} dans la commune` : null },
    { id: 'assos', label: `Associations actives à ${local}${NBSP}km`, text: Number.isFinite(c.assos_1000_10km) ? per1000(c.assos_1000_10km) : '—', sub: 'ayant déclaré une création ou un changement depuis 5 ans' },
    { id: 'tiers_lieux', label: `Tiers-lieux à ${local}${NBSP}km`, text: n(c.tiers_lieux_10km, 'lieu', 'lieux') },
    { id: 'culture5', label: `Cinémas et scènes à ${proche}${NBSP}km`, text: Number.isFinite(c.cinemas_5km) ? `${plural(c.cinemas_5km, 'cinéma')} · ${plural(c.scenes_5km, 'scène')}` : '—', sub: 'à vélo ou en bus' },
    { id: 'festivals', label: `Festivals à ${fest}${NBSP}km`, text: n(c.festivals_15km, 'festival') },
    { id: 'ecoles', label: `Collèges et lycées à ${proche}${NBSP}km`, text: Number.isFinite(c.college_5km) ? `${plural(c.college_5km, 'collège')} · ${plural(c.lycee_5km, 'lycée')}` : '—' },
  ];
}
