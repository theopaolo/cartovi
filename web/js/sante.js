// sante.js — accès aux soins (pipeline/sante.py) et îlots de chaleur (pipeline/chaleur.py), colonnes de la couche communale.
// Partagé par le score (critères), la fiche Recherche, la comparaison et le détail de la page Communes.
import { NBSP, fmtNumber } from './format.js';
import { fmtPct } from './communes/text.js';

export const SANTE_SOURCES = [
  { label: 'DREES — accessibilité potentielle localisée (APL) aux médecins généralistes et aux sages-femmes', url: 'https://www.data.gouv.fr/datasets/laccessibilite-potentielle-localisee-apl' },
  { label: 'DREES — liste des maternités au 31 décembre (SAE)', url: 'https://www.data.gouv.fr/datasets/6226330f072c63d4d53e0c49' },
  { label: 'FINESS géolocalisé (ARS, Atlasanté)', url: 'https://www.data.gouv.fr/datasets/finess-extraction-du-fichier-des-etablissements' },
];

export const SANTE_CAVEAT =
  'L’APL de la DREES compte l’offre accessible depuis la commune, communes voisines comprises, rapportée aux besoins de ses habitants selon leur âge ; ' +
  'pour les généralistes, seuls ceux de 65 ans ou moins sont comptés : c’est l’offre qui restera dans les années qui viennent. ' +
  'La distance à la maternité est à vol d’oiseau depuis la mairie, pas un temps de route.';

/** Type de maternité (DREES) : niveau de prise en charge des nouveau-nés. */
export const MATERNITE_TYPES = {
  1: 'type 1 (grossesses sans risque identifié)',
  '2a': 'type 2a (avec néonatologie)',
  '2b': 'type 2b (néonatologie et soins intensifs)',
  3: 'type 3 (réanimation néonatale)',
};

export const CHALEUR_SOURCE = { label: 'Cerema — zones climatiques locales (LCZ) 2022 des 88 aires urbaines de métropole', url: 'https://www.data.gouv.fr/datasets/6641c562e5acdb35c0e6051d' };

export const CHALEUR_CAVEAT =
  'Mesures du tissu urbain dans un rayon de 1 km autour de la mairie (le centre que l’on pratique à pied), d’après la cartographie satellite du Cerema (2022) : ' +
  'sol minéralisé (bâti et revêtements imperméables), couvert d’arbres, part du tissu compact (plus de 40 % de surface bâtie), où la chaleur s’accumule le jour et se dissipe mal la nuit. ' +
  'Ce n’est pas une température : relief, vent et cours d’eau modulent l’effet. Seules les 88 aires urbaines de plus de 50 000 habitants sont cartographiées.';

export const fmtApl = (v) => `${fmtNumber(v, 1)}${NBSP}consultations par an et par habitant`;
export const fmtAplSf = (v) => `${fmtNumber(v, 0)}${NBSP}ETP pour 100${NBSP}000${NBSP}femmes`;
export const fmtKmRound = (v) => `${fmtNumber(v, v < 10 ? 1 : 0)}${NBSP}km`;

/** true si la couche communale porte l'accès aux soins. */
export const hasSante = (c) => ['apl_mg', 'apl_sf', 'maternite_km'].some((k) => Number.isFinite(c[k]));
/** true si la commune est dans une aire urbaine cartographiée par le Cerema (au moins la classe de la mairie). */
export const hasChaleur = (c) => c.lcz_mairie != null || Number.isFinite(c.mineral_1km);

/** Lignes { id, label, text, sub } pour la fiche et la comparaison. */
export function santeRows(c) {
  return [
    { id: 'apl_mg', label: 'Médecins généralistes accessibles', text: Number.isFinite(c.apl_mg) ? fmtApl(c.apl_mg) : '—', sub: 'APL de la DREES, généralistes de 65 ans ou moins' },
    { id: 'apl_sf', label: 'Sages-femmes accessibles', text: Number.isFinite(c.apl_sf) ? fmtAplSf(c.apl_sf) : '—', sub: 'APL de la DREES (suivi de grossesse, post-partum)' },
    {
      id: 'maternite',
      label: 'Maternité la plus proche',
      text: Number.isFinite(c.maternite_km) ? fmtKmRound(c.maternite_km) : '—',
      sub: Number.isFinite(c.maternite_km) ? [MATERNITE_TYPES[c.maternite_type], 'à vol d’oiseau'].filter(Boolean).join(', ') : null,
    },
  ];
}

/** La classe de l'îlot de la mairie (lcz_mairie) n'est pas affichée : c'est souvent l'hôtel de ville lui-même, grand bâtiment public, pas le quartier. */
export function chaleurRows(c) {
  const partial = Number.isFinite(c.lcz_couvert) && c.lcz_couvert < 99 ? `${fmtNumber(c.lcz_couvert, 0)}${NBSP}% du disque cartographié` : null;
  const none = 'moins de la moitié du disque cartographié';
  return [
    { id: 'mineral', label: 'Sol minéralisé à 1 km de la mairie', text: Number.isFinite(c.mineral_1km) ? fmtPct(c.mineral_1km) : none, sub: partial || 'bâti et revêtements imperméables' },
    { id: 'arbres', label: 'Couvert d’arbres à 1 km de la mairie', text: Number.isFinite(c.arbres_1km) ? fmtPct(c.arbres_1km) : none },
    { id: 'dense', label: 'Tissu compact à 1 km de la mairie', text: Number.isFinite(c.dense_1km) ? fmtPct(c.dense_1km) : none, sub: 'classes LCZ 1 à 3 : plus de 40 % de surface bâtie' },
  ];
}
