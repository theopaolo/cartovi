# TRACC-2023 — extraction DRIAS

Fichiers bruts, non modifiés (seulement renommés), lus par `pipeline/sources/tracc.py`.

- **Source** : DRIAS, les futurs du climat (https://www.drias-climat.fr/), Météo-France,
  expérience `TRACC2023_DISTRIBUTION`, producteur `MF_DCSC`.
- **Chemin** : Données et produits → Simulations climatiques atmosphériques → Métropole →
  TRACC-2023 → indicateurs annuels, format CSV, domaine France métropolitaine.
- **Extraction** : 8 novembre 2026, par le porteur du projet (compte DRIAS personnel).
- **Grille** : SAFRAN, 8 981 points de 8 km (France métropolitaine et Corse).
- **Indices** : `NORTX35D_yr`, `NORTX30D_yr`, `NORTR_yr`, `NORRR_seas_JJA`, `NORRx1d_yr`,
  `NORIFM40_yr`, `NORSWI04_yr` (définitions dans l'en-tête de chaque fichier).
- **Mention obligatoire** : « DRIAS, données Météo-France ».

## Nommage

`<quantile>_<niveau>.csv`, par exemple `Q50_GWL20.csv`.

| Niveau | Réchauffement monde | Réchauffement France | Horizon TRACC |
|---|---|---|---|
| `REF` | — | référence 1976–2005 | — |
| `GWL15` | +1,5 °C | +2 °C | 2030 |
| `GWL20` | +2 °C | +2,7 °C | 2050 |
| `GWL30` | +3 °C | +4 °C | 2100 |

Le quantile est celui de l'ensemble de simulations (`Q50` : médiane). Pour afficher
l'intervalle entre simulations, extraire aussi `Q05` et `Q95` (mêmes indices, mêmes
niveaux) et les déposer ici sous le même nommage : le pipeline les détecte, et
l'empreinte des fichiers relance le calcul au passage suivant du CI.

| Fichier d'origine | Fichier ici |
|---|---|
| `reference_1976-2005_Q50.csv` | `Q50_REF.csv` |
| `2030_plus2C_Q50.csv` | `Q50_GWL15.csv` |
| `2050_plus2-7C_Q50.csv` | `Q50_GWL20.csv` |
| `2100_plus4C_Q50.csv` | `Q50_GWL30.csv` |
