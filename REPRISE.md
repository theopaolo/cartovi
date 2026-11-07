# Reprise du projet Carteplan — état au 7 novembre 2026

Note de passation entre sessions de travail (à lire en premier par une nouvelle session).

## Ce qui existe

- **Pipeline** (`pipeline/`, Python sans dépendance) lancé par `.github/workflows/update.yml`
  chaque lundi et à chaque push sur `pipeline/**` ou `web/**` : `build` (indicateurs
  départementaux → `data/carteplan.sqlite`, `web/data/indicators.json`), `communes`
  (couche communale → `web/data/communes/*.json`, index de recherche `noms.json`),
  `flux` (vent de la semaine → `web/data/flux/vent.json`). Le bot commite les données.
- **Site** (`web/`, JS sans framework) : `index.html` (départements, score pondérable),
  `communes.html` (filtres + score personnalisé relatif à la sélection), `recherche.html`
  (fiche d'une commune, comparaison), `flux.html` (expérimentation vent, en cours de retrait
  de la navigation).
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

## En cours au moment de la passation (commit « version de travail » 4902242)

Étape 1, interface : critères de risque par aléa dans le score des communes, filtres
« exclure les communes… » (submersion, trait de côte, feu, PPR inondation/argiles,
barrage, nucléaire < 20 km, Seveso < 10 km, non renseignées), section risques dans la
fiche et la comparaison, bascule centiles/min-max (`minmaxScores` dans `web/js/score.js`),
retrait du vent. **À vérifier** : `node web/js/communes/score-communes.test.mjs`,
`node web/js/recherche/search.test.mjs`, absence d'erreur console sur les 4 pages
(Playwright : `/opt/node-tools/node_modules/playwright`, Chromium `/opt/pw-browsers`),
puis commit final et republication de l'aperçu.

Données communales v7 en place : `catnat_inond/sech/mer/mvt`, `risques` (DDRM, null pour
la Drôme et le Puy-de-Dôme absents de GASPAR), `ppr`, `trait_cote` (320 communes).

## Prochaines étapes demandées

- **Étape 2 — climat et eau officiels** : TRACC/DRIAS par commune (compte DRIAS, NetCDF :
  décision utilisateur nécessaire) ; Explore2 par commune (jeu « test », ~150 Mo) ;
  LCZ Cerema (îlots de chaleur, calcul hors ligne à committer comme table statique) ;
  EAIP/argiles (polygones). Voir README, « Pistes non encore intégrées ».
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

> Lis REPRISE.md et README.md du dépôt cartovi (branche ccr-74119e54-gru9fv), vérifie
> l'état de l'étape 1 (commit « version de travail »), termine-la et republie l'aperçu,
> puis propose-moi le plan de l'étape 2.
