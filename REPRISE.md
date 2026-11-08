# Reprise du projet Carteplan — état au 8 novembre 2026

Note de passation entre sessions de travail (à lire en premier par une nouvelle session).

## Ce qui existe

- **Pipeline** (`pipeline/`, Python sans dépendance) lancé par `.github/workflows/update.yml`
  chaque lundi et à chaque push sur `pipeline/**` ou `web/**` : `build` (indicateurs
  départementaux → `data/carteplan.sqlite`, `web/data/indicators.json`), `communes`
  (couche communale → `web/data/communes/*.json`, index de recherche `noms.json`),
  `flux` (vent de la semaine → `web/data/flux/vent.json`). Le bot commite les données.
- **Site** (`web/`, JS sans framework) : `index.html` (départements, score pondérable),
  `communes.html` (filtres + score personnalisé relatif à la sélection), `recherche.html`
  (fiche d'une commune, comparaison), `flux.html` (expérimentation vent,
  hors navigation).
- **README.md** : architecture, sources, méthode, limites, pistes non intégrées.
- **Aperçu en ligne** (figé, privé) : https://claude.ai/artifact/HvxFH3te6DJNNrY6HSzgEW —
  republier depuis une copie de `web/` où les liens `download` sont remplacés par un lien
  vers le dépôt (voir l'historique des sessions).

## Décisions de l'utilisateur (à respecter)

1. Rigueur et précision avant tout ; dire ce que chaque donnée mesure et ne mesure pas.
2. Score des communes **relatif aux communes retenues par les filtres**.
3. Critères de préférence (climat politique, taille) **à zéro par défaut**, sens choisi par l'utilisateur.
4. **Maille la plus fine disponible** : valeur communale si elle existe, sinon héritage du
   département, repli signalé et seulement à unité identique.
5. Le vent n'est pas utile au choix d'un lieu : retiré de la navigation et des fiches,
   page gardée comme expérimentation.
6. Bascule de lecture du score : centiles / min-max.

## Étape 1 terminée (7 novembre 2026)

- Critères de risque par aléa dans le score des communes (inondations, sécheresse-argiles,
  vagues-submersion, mouvements de terrain), filtres « exclure les communes… » (submersion,
  trait de côte, feu, PPR inondation/argiles, barrage, nucléaire < 20 km, Seveso < 10 km,
  non renseignées), section risques dans la fiche Recherche et la comparaison.
- Bascule de lecture centiles / min-max (`minmaxScores`, `scorerOf` dans `web/js/score.js`)
  sur la carte des départements et le score des communes (hash `n=minmax`).
- Vent retiré de la navigation et des fiches ; `flux.html` gardée comme expérimentation,
  liée depuis la section Méthode de la page principale.
- Autotests : `node web/js/score.test.mjs`, `web/js/communes/score-communes.test.mjs`,
  `web/js/communes/risks.test.mjs`, `web/js/recherche/search.test.mjs`.
- Données communales v7 : `catnat_inond/sech/mer/mvt`, `risques` (DDRM, null pour la Drôme
  et le Puy-de-Dôme absents de GASPAR), `ppr`, `trait_cote` (320 communes).

## Étape 2 (en cours) — climat futur officiel (8 novembre 2026)

- **Fait** : TRACC-2023 de DRIAS (compte DRIAS de l'utilisateur, extraction du 08/11/2026)
  versionnée dans `data/raw/drias/tracc2023/` (médiane Q50, référence + 3 niveaux,
  7 indices : jours ≥ 35 °C et ≥ 30 °C, nuits tropicales, pluies d'été, pluie max en un
  jour, danger météo de feu IFM > 40, sol sec SWI < 0,4). Source `tracc`
  (`pipeline/sources/tracc.py`) : 5 indicateurs départementaux à +2,7 °C, moyenne des
  communes pondérée par la population ; remplace Open-Meteo « jours chauds 2050 ».
  Couche communale v8 : point de grille le plus proche (`tracc_pt`, 0 = hors grille,
  Ouessant), valeurs à +2,7 °C ; groupe « Climat futur » du score ; trajectoire complète
  dans la fiche Recherche (`web/data/climat/tracc.json`). Autotest `web/js/climat.test.mjs`.
- **À demander à l'utilisateur** : extraire aussi les quantiles Q05 et Q95 (mêmes indices,
  mêmes niveaux) et les déposer sous `Q05_<niveau>.csv` / `Q95_<niveau>.csv` : la fiche
  affichera l'intervalle entre simulations (consigne des producteurs : jamais la médiane
  seule). Vérifier aussi les conditions d'utilisation DRIAS (redistribution des fichiers bruts).
- **Décision en attente** : Explore2 (débits futurs par commune, RARE, data.gouv) est marqué
  « attention test » avec des défauts visibles ; recommandation : fiche seulement, hors score.
- **Reste de l'étape 2** : LCZ Cerema (îlots de chaleur), EAIP/argiles (polygones).

## Prochaines étapes demandées

- **Étape 2 — suite** : voir ci-dessus (Q05/Q95, Explore2, LCZ, EAIP/argiles).
- **Étape 3 — axe « bien-être présent »** façon IBV (Alternatives Économiques, juin 2026,
  approche par les capacités) reconstruit sur données ouvertes : Filosofi 2021, chômage et
  moins de 25 ans (RP 2022), APL médecins (DREES), loyers (carte des loyers 2025), logement
  social (RPLS), équipements (BPE), délinquance (SSMSI). Puis vue à deux axes « bien-être
  présent × exposition future » avec horizon 10–20 ans (TRACC +2 °C / +2,7 °C).
  Ne pas reprendre les scores de l'IBV (droits d'auteur).

## Outils et contraintes de l'environnement

- Le conteneur cloud **n'accède pas** aux API publiques françaises : tout test réel passe
  par GitHub Actions. La sonde temporaire `.github/workflows/probe.yml` (déclenchée par
  un push de `.github/probe.txt` : une ligne = URL, tabulation, filtre `jq` ou `sh …`)
  sert à inspecter une API ; **à supprimer** une fois les étapes 2–3 finies.
- Lire les journaux CI : outils GitHub MCP (`actions_list`, `get_job_logs`).
- Avant de pousser du code de pipeline : tester hors ligne avec un faux client HTTP
  (sous-classe de `pipeline.http.Http` qui renvoie des réponses au format réel).
- Le bot pousse des commits de données : toujours `git pull --rebase` avant de pousser.
- Le dépôt GitHub s'appelle encore `theopaolo/cartovi` (projet renommé Carteplan).

## Message pour démarrer une nouvelle session

> Lis REPRISE.md et README.md du dépôt cartovi (branche ccr-74119e54-gru9fv), puis
> poursuis l'étape 2 (Q05/Q95 TRACC, Explore2, îlots de chaleur) ou l'étape 3 (axe
> « bien-être présent »), en signalant les décisions qui m'appartiennent.
