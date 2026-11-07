# Carteplan — où s'installer en autonomie ?

> Anciennement *Cartovi*. Le dépôt GitHub porte encore ce nom (`theopaolo/cartovi`) tant qu'il n'est pas renommé dans ses réglages ; GitHub redirige les anciennes adresses.

Carte des 96 départements métropolitains classés selon des critères d'habitabilité
« autonome » : eau, climat, prix du foncier, densité, artificialisation, risques
industriels et naturels. Elle se met à jour seule chaque semaine à partir de données
publiques ouvertes.

Le projet part d'une carte virale (« Carte de l'autosuffisance en France ») générée
par IA : aucune source, des étiquettes fausses (deux « Corrèze », « Bannsois »…), des
classes posées à l'œil. Carteplan reprend l'idée en la rendant **vérifiable** (chaque
valeur a une source, une période et une date de collecte) et **discutable** (les
pondérations sont des curseurs, pas des vérités).

## Architecture

```
GitHub Actions (lundi 04:23 UTC)
  └─ python -m pipeline.build          Python 3, bibliothèque standard uniquement
       ├─ sources/*.py                 une source = un module : SOURCE, INDICATORS, fetch(ctx)
       │     └─ API publiques          geo.api, data.gouv, Géorisques, VigiEau, Hub'Eau, Open-Meteo
       ├─ validate()                   couverture ≥ 95 %, garde-fous de vraisemblance
       ├─ data/carteplan.sqlite          historique de toutes les observations + journal des collectes
       └─ web/data/*.json              export pour le site (dernière valeur par indicateur)
  └─ commit des données, puis déploiement GitHub Pages (optionnel)

web/                                   HTML + CSS + JS (modules ES), sans framework ni build
  ├─ data/map.json                     contours pré-projetés en Lambert-93 → chemins SVG
  └─ data/indicators.json              valeurs, métadonnées, statut de fraîcheur
```

**Choix techniques, et pourquoi :**

- **Python sans dépendance.** `urllib`, `csv`, `json`, `sqlite3`, `zipfile` suffisent. Le
  pipeline tourne partout, sans `pip install`, et ne casse pas à la mise à jour d'une
  bibliothèque. On ne s'expose pas non plus à la chaîne d'approvisionnement.
- **SQLite, mais pas SpatiaLite.** Toutes les sources françaises sont indexées par code
  INSEE : les jointures sont attributaires, pas spatiales. Les deux seuls calculs
  géométriques (couverture des zones PPI nucléaires, points d'échantillonnage du climat)
  tiennent en quelques fonctions pures (`pipeline/geo.py`, projection Lambert-93
  vérifiée au centimètre contre `pyproj`). SpatiaLite ajouterait une extension native à
  installer, pour un gain nul à cette échelle.
- **Historisation plutôt qu'écrasement.** La table `observation` est indexée par
  (indicateur, territoire, période). Chaque collecte ajoute une ligne quand la période
  est nouvelle et réécrit la valeur quand elle a changé. Une source en panne ou dont le
  format a changé produit une ligne `error` ou `rejected` dans `run`. Le site affiche
  alors la dernière valeur valide, signalée comme périmée.
- **Rythme propre à chaque source** (`max_age_days`). Les prix DVF changent deux fois par
  an et les projections climatiques jamais : inutile de les retélécharger chaque semaine.
  Ça ménage aussi les quotas (Open-Meteo : 10 000 appels pondérés par jour et par IP).
  Un champ `version` par source force la recollecte quand la méthode de calcul change.
- **Front sans framework.** 96 chemins SVG pré-projetés par le pipeline, donc aucune
  bibliothèque cartographique côté client. Le score est calculé dans le navigateur pour
  que les pondérations soient réglables.

## Indicateurs

| Thème | Indicateur | Source | Rythme | Sens |
|---|---|---|---|---|
| Eau & climat | Jours de restriction d'eau sévère (alerte renforcée ou crise), moyenne 5 ans | VigiEau (MTE) | 7 j | ↓ |
| | Cours d'eau sans écoulement ou à sec en été, % des observations sur 5 ans | ONDE / Hub'Eau (OFB) | 7 j | ↓ |
| | Bilan hydrique climatique P − ETP, mm/an sur 5 ans, aux communes représentatives de la population | Open-Meteo (ERA5) | 30 j | ↑ |
| | Jours ≥ 30 °C projetés en 2041–2050 | Open-Meteo (CMIP6 MRI-AGCM3-2-S) | 365 j | ↓ |
| Foncier & densité | Prix médian des maisons, €/m² | Statistiques DVF (DGFiP / Etalab) | 6 j | ↓ |
| | Densité de population | geo.api.gouv.fr (INSEE) | 28 j | ↓ |
| Terres & nature | Consommation d'espaces naturels, agricoles et forestiers, ha/an pour 100 km² | Cerema (fichiers fonciers) | 6 j | ↓ |
| Risques & pollution | Sites Seveso (seuils haut et bas) pour 1 000 km² | Géorisques (ICPE) | 28 j | ↓ |
| | Part du territoire à moins de 20 km d'un site nucléaire (PPI) | liste statique ASNR / EDF / Orano + calcul géométrique | 6 j | ↓ |
| | Arrêtés de catastrophe naturelle par commune sur 20 ans | GASPAR (Géorisques) | 7 j | ↓ |
| | Sites et sols pollués (instructions) pour 1 000 km² | Géorisques (SSP) | 28 j | ↓ |

Chaque indicateur est décrit en détail, limites comprises, dans son module
(`pipeline/sources/`) et dans la section « Méthode & sources » du site.

## Couche communale : chercher une commune

`python -m pipeline.communes` (mensuel, dans le même workflow) produit
`web/data/communes/<code région>.json`, exploité par la page `communes.html`. Les
critères y sont des **filtres réglables**, pas un score.

| Critère | Calcul | Source |
|---|---|---|
| Train vers une ville | trajet **direct** le plus court et nombre de trains directs, un mardi ou jeudi type, vers chaque commune de ≥ 50 000 habitants (gares à moins de 5 km de son centre) ; gare choisie dans un rayon de 6 km, chaque km d'accès coûtant 3 min | GTFS national SNCF (TER, Intercités, TGV ; cars exclus) |
| Climat politique | part des voix des listes de gauche (LFI, PS-Place publique, Écologistes, PCF, extrême et divers gauche) aux européennes 2024, dans la commune et dans un rayon de 10 km | ministère de l'Intérieur |
| Offre culturelle | cinémas, scènes, lieux labellisés (scène nationale, SMAC, CDN…), musées, librairies, conservatoires à moins de 15 km | Basilic, ministère de la Culture |
| Prix | médiane du prix au m² des maisons (≥ 10 ventes ; Paris, Lyon, Marseille agrégés depuis leurs arrondissements) | Statistiques DVF |

Limites : pas de correspondances (un trajet avec changement n'apparaît pas) ; cars
TER ignorés ; les européennes (51 % de participation) décrivent un électorat, pas une
politique municipale ; un rayon de 10 km autour d'une banlieue mesure surtout la ville
voisine.

## Score personnalisé des communes

Sur la page Communes, les communes **retenues par les filtres** sont classées entre elles
par un score réglable. Ce n'est pas un classement de la France. Quatre règles :

1. **Relatif à la sélection** : chaque critère est converti en rang centile parmi les
   communes retenues, puis les rangs sont moyennés selon les poids. Le résultat est
   recalculé à chaque changement de filtre.
2. **Les préférences sans bon sens universel sont désactivées par défaut** : climat
   politique et taille de la commune sont à zéro, et c'est l'utilisateur qui en choisit
   le sens (plus à gauche ou plus à droite, plus petite ou plus grande). Le prix a lui
   aussi un sens réglable.
3. **La maille la plus fine disponible** : un critère de la carte des départements est
   pris à la commune quand une source le permet (densité, artificialisation, CatNat,
   distance à la centrale la plus proche, sites Seveso à moins de 10 km). Sinon la
   commune hérite de la valeur de son département (restrictions d'eau, assecs, bilan
   hydrique, chaleur 2050, sols pollués). Le repli sur le département ne se fait qu'à
   unité identique, et il est signalé.
4. **La distance nucléaire est plafonnée à 40 km**, deux fois le rayon PPI : au-delà,
   elle ne départage plus.

## Risques à la commune : ce qui est mesuré, et ce qui ne l'est pas

| Donnée | Ce qu'elle dit | Ce qu'elle ne dit pas | Source |
|---|---|---|---|
| Arrêtés CatNat par aléa, 20 ans (inondation, sécheresse-argiles, vagues-submersion, mouvements de terrain) | des sinistres **reconnus** par l'État | l'intensité, ni les sinistres non déclarés ; une commune fusionnée perd les arrêtés pris sous son ancien code | GASPAR (Géorisques) |
| Risques recensés (DDRM) | la préfecture **identifie** le risque sur la commune | son intensité ni la part du territoire exposée. Drôme et Puy-de-Dôme sont absents de l'export 2026 : « non renseigné », jamais « aucun risque » | GASPAR |
| Plans de prévention opposables (PPR) | un zonage **réglementaire** existe (inondation, littoral, argiles…) | la part de la commune en zone rouge ou bleue | GASPAR |
| Recul du trait de côte | la commune est listée par le décret en vigueur (2026-95) | la vitesse d'érosion locale | liste officielle, data.gouv.fr |
| Distance à la centrale, sites Seveso à 10 km | une proximité | une exposition dosée | ASNR, Géorisques |

Dans la page Communes, ces risques servent de deux façons. Les **filtres** excluent une
commune sans compensation possible. Le **score** les pondère avec les autres critères :
une bonne offre culturelle peut alors compenser un risque d'inondation, et c'est un
choix qu'on assume.

**Deux modes de lecture du score.** Par rang (centiles) : résistant aux valeurs extrêmes,
mais 1 et 20 sinistres ne sont plus que deux rangs voisins. Par écart (min-max, la
méthode de l'IDH du PNUD et de l'IBV d'Alternatives Économiques) : les écarts sont
conservés, mais une seule valeur extrême écrase toutes les autres. Que le classement
change d'un mode à l'autre est en soi une information.

### Pistes non encore intégrées (et pourquoi)

- **Projections climatiques officielles par commune (TRACC, +2 °C en 2030, +2,7 °C en
  2050)** : les indicateurs DRIAS et Climadiag Commune de Météo-France ne sont pas
  publiés en table communale ouverte. Il faut un compte DRIAS et des fichiers NetCDF.
  Le jeu de l'ADEME à +2,7 °C ne couvre que 8 zones climatiques du bâtiment. Le
  climat futur reste donc l'approximation Open-Meteo (un seul modèle), affichée comme
  telle.
- **Débits futurs (Explore2)** : tables par commune publiées en 2026 mais marquées
  « test » par leur producteur, environ 150 Mo par indicateur.
- **Îlots de chaleur (LCZ du Cerema)** : 88 archives de 100 à 200 Mo à intersecter.
  C'est un calcul à faire une fois, hors ligne.
- **Zones inondables chiffrées (EAIP) et exposition aux argiles** : uniquement des
  polygones, sans table communale nationale.
- **Axe « bien-être présent »** façon IBV : faisable à la commune avec des sources
  ouvertes (Filosofi 2021, recensement 2022, accès aux médecins, loyers, logement
  social, équipements). C'est l'étape suivante, pour une vue à deux axes : bien-être
  présent et exposition future.

## Recherche : la fiche d'une commune

`recherche.html` (et le champ de recherche présent dans l'en-tête de chaque page)
retrouve une commune par son nom, et affiche ses valeurs dans toutes les catégories du
projet :

- **commune** : train direct vers les villes de référence, climat politique, culture à
  15 km, prix des maisons ;
- **département** : les indicateurs de la carte principale, avec le rang centile et la
  classe du département. Ce sont des valeurs départementales, signalées comme telles ;
- **flux** : vent moyen et maximal de la semaine au point de la commune, et la distance
  à la donnée réelle la plus proche.

La recherche ignore les accents, la casse et la ponctuation, et accepte « st » pour
« saint ». Un code de département (« saint martin 38 ») ou un code INSEE restreint les
résultats. On peut comparer jusqu'à quatre communes côte à côte.
L'index `web/data/communes/noms.json` (~1 Mo, code, nom et population) est produit par
`python -m pipeline.communes` ; `--index-only` le régénère sans rien télécharger.

## Flux & limites : le vent et la maille

`python -m pipeline.flux` (hebdomadaire) produit `web/data/flux/vent.json`, animé par
la page `flux.html` en WebGL2 (shaders écrits à la main, sans bibliothèque).

- **Donnée** : vent à 10 m des 7 derniers jours, toutes les 3 h, sur une grille de 0,5°
  (~630 nœuds, Open-Meteo, modèles de Météo-France et du CEPMMT). Les nœuds sont exportés
  tels quels : c'est la seule information réelle, le reste est interpolé (dans
  l'espace par le GPU, dans le temps entre deux images).
- **Projection** : les vecteurs sont tournés dans le repère Lambert-93, dont le nord
  s'écarte du nord géographique de ±4° aux marges de la France.
- **Limites superposées** : départements, cercles PPI de 20 km, et la maille elle-même.
  Le propos est de montrer ce que la carte ne sait pas : rafales, effets de vallée,
  tout ce qui est plus fin que la grille.

## Méthode de score

1. **Normalisation par rang centile.** Pour chaque indicateur, un département reçoit la
   part des départements qu'il devance (de 0 à 1, inversée quand « moins » vaut
   « mieux »). Cette normalisation résiste aux valeurs extrêmes (Paris, 20 000 hab./km²)
   et se lit directement : « mieux que 80 % des départements ».
2. **Moyenne pondérée** des centiles disponibles. Un indicateur manquant pour un
   département est ignoré, et les poids restants sont renormalisés.
3. **Cinq classes par quintiles** : les 20 % les mieux classés sont « très favorables »,
   etc.

C'est un **classement relatif** entre départements, pas un jugement absolu. Le dernier
quintile n'est pas « inhabitable ». Il est seulement moins bien placé que les autres
selon les critères et les poids choisis.

**Choix de valeur assumés, et réglables :** une faible densité compte comme favorable (plus de
terres par habitant), même si elle éloigne des services. Le nucléaire est mesuré par
l'exposition réglementaire (PPI), pas par un niveau de risque. L'échelle départementale
masque de fortes disparités internes (le littoral varois et le Haut-Var, par exemple).

## Lancer en local

```sh
python3 -m pipeline.build              # collecte tout (selon max_age_days) puis exporte
python3 -m pipeline.build --only dvf   # une seule source (force la collecte)
python3 -m pipeline.build --cache      # réutilise les téléchargements (.cache/), pour développer
python3 -m pipeline.build --export-only
python3 -m pipeline.report             # résumé Markdown de la dernière collecte
python3 -m http.server -d web 8000     # puis http://localhost:8000
```

Python ≥ 3.10, aucune dépendance.

## Mise à jour automatique et publication

`.github/workflows/update.yml` tourne chaque lundi, sur `workflow_dispatch` et à chaque
modification du pipeline. Il collecte, écrit un résumé dans l'onglet Actions, puis
commite `data/carteplan.sqlite` et `web/data/` quand quelque chose a changé.

Pour publier le site sur GitHub Pages :

1. *Settings → Pages → Build and deployment → Source : GitHub Actions*
2. *Settings → Secrets and variables → Actions → Variables* : `PAGES` = `true`

## Interroger la base

```sh
sqlite3 data/carteplan.sqlite "
  SELECT t.name, round(l.value) FROM latest l JOIN territory t ON t.code = l.territory_code
  WHERE l.indicator_id = 'secheresse_jours' ORDER BY l.value DESC LIMIT 10;"

sqlite3 data/carteplan.sqlite "SELECT source_id, status, finished_at, message FROM run ORDER BY id DESC LIMIT 20;"
```

## Ajouter une source

Créer `pipeline/sources/ma_source.py` avec :

```python
SOURCE = {"id": ..., "label": ..., "provider": ..., "url": ..., "licence": ..., "refresh": ..., "max_age_days": 7}
INDICATORS = [{"id": ..., "label": ..., "unit": ..., "theme": "eau|foncier|nature|risques",
               "direction": 1 | -1, "weight": 1.0, "decimals": 0, "description": ...}]

def fetch(ctx):  # ctx.http, ctx.territories, ctx.today, ctx.log, ctx.memo
    yield indicator_id, code_departement, periode, valeur
```

Puis l'ajouter à `SOURCES` dans `pipeline/sources/__init__.py`. Le front l'affiche sans
autre modification.

## Limites connues

- **Échelle départementale.** C'est la plus fine qui reste lisible avec 96 entités et des
  sources homogènes. Le schéma (`territory.level`) prévoit l'EPCI ou la commune.
- **DVF** ne couvre pas l'Alsace-Moselle (livre foncier) : prix absent pour 57, 67 et 68.
- **Géorisques** a filtré par moments des IP étrangères, dont celles des runners
  GitHub. En cas de blocage, les valeurs précédentes restent affichées comme périmées.
- **Climat futur** : un seul modèle, au forçage d'émissions élevées. C'est un ordre de
  grandeur comparatif, pas une prévision.
- **Open-Meteo** : son quota est partagé par IP, et les runners GitHub partagent leurs IP.
  Une collecte coûte environ un quota horaire. Une seule des deux sources climat est donc
  collectée par exécution, l'autre est reportée à la suivante. Le climat est échantillonné
  en deux communes par département (celles des 1er et 3e quartiles de population), pas
  sur tout le territoire.
- Les points d'accès VigiEau (`/api/data/departement`) et Géorisques v1 ne sont pas
  versionnés comme des API stables. Un changement de format est détecté (rejet), mais
  pas corrigé automatiquement.
- Non retenus faute de source ouverte stable et lisible par machine : la qualité de
  l'air par département, le prix des terres agricoles, le taux de boisement.

## Licences et attributions

Code : pas encore de licence (à choisir). Données : Licence Ouverte 2.0 (Etalab) pour les sources publiques françaises,
CC BY 4.0 pour Open-Meteo (« Weather data by Open-Meteo.com », ERA5 / Copernicus, CMIP6).
Contours : IGN Admin Express COG 2018 simplifié, via
[gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson).
