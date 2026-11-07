// text.js — libellés français propres à la page Recherche : sources de la couche communale.

export const NATIONAL_LEFT = 32.4; // part de gauche de la France entière aux européennes 2024 (% des exprimés)

// Sources de la couche communale (voir pipeline/communes.py) ; les départements portent les leurs dans indicators.json.
export const SOURCES = {
  train: { label: 'Horaires SNCF (GTFS national : TER, Intercités, TGV)', url: 'https://transport.data.gouv.fr/datasets/horaires-sncf' },
  vote: { label: 'Ministère de l’Intérieur — résultats des européennes 2024 par commune', url: 'https://www.data.gouv.fr/datasets/resultats-des-elections-europeennes-du-9-juin-2024' },
  culture: { label: 'Basilic — ministère de la Culture', url: 'https://www.data.gouv.fr/datasets/base-des-lieux-et-equipements-culturels-basilic' },
  prix: { label: 'DVF (statistiques) — Etalab', url: 'https://www.data.gouv.fr/datasets/statistiques-dvf' },
  terres: { label: 'Géorisques, Cerema, ASNR, INSEE', url: 'https://www.georisques.gouv.fr/' },
  gaspar: { label: 'GASPAR — Géorisques (arrêtés CatNat, risques recensés, plans de prévention)', url: 'https://www.georisques.gouv.fr/donnees/bases-de-donnees/base-gaspar' },
  traitcote: { label: 'Liste officielle des communes concernées par le recul du trait de côte (décret en vigueur)', url: 'https://www.data.gouv.fr/datasets/66f2b36b0ef156e735cbe74a' },
  pop: { label: 'geo.api.gouv.fr (INSEE)', url: 'https://geo.api.gouv.fr/' },
};

export const trainNote = () => "Trajets directs uniquement : un trajet avec correspondance n’apparaît pas.";
