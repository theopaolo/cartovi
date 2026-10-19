"""Restrictions d'eau sécheresse — VigiEau (ministère de la Transition écologique).

L'endpoint `/api/data/departement` (celui des pages « données » du site
vigieau.gouv.fr) donne, pour chaque jour et chaque département, le niveau de
gravité maximal parmi ses zones d'alerte. Il n'est pas documenté dans le
Swagger : s'il change, la source passe en erreur et la dernière valeur reste.
"""

from ..util import complete_years

SOURCE = {
    "id": "vigieau",
    "label": "VigiEau — historique des restrictions d'eau",
    "provider": "Ministère de la Transition écologique",
    "url": "https://vigieau.gouv.fr/donnees",
    "licence": "Licence Ouverte 2.0",
    "refresh": "quotidien (agrégé par année civile)",
    "max_age_days": 7,
}

YEARS = 5
SEVERE = {"alerte_renforcee", "crise"}

INDICATORS = [
    {
        "id": "secheresse_jours",
        "label": "Jours de restriction d'eau sévère",
        "unit": "jours/an",
        "theme": "eau",
        "direction": -1,
        "weight": 1.5,
        "decimals": 0,
        "description": (
            f"Nombre moyen de jours par an, sur les {YEARS} dernières années civiles, où au moins "
            "une zone du département était en « alerte renforcée » ou en « crise » sécheresse "
            "(eaux superficielles, souterraines ou potable). Reflète la tension observée sur la "
            "ressource ; une seule zone suffit, ce qui pénalise les grands départements hétérogènes."
        ),
    },
]

API = "https://api.vigieau.gouv.fr/api/data/departement"


def fetch(ctx):
    years = complete_years(ctx.today, YEARS)
    days = {}
    for y in years:
        series = ctx.http.json(API, {"dateDebut": f"{y}-01-01", "dateFin": f"{y}-12-31"}, timeout=180)
        if len(series) < 360:
            raise ValueError(f"{y} : {len(series)} jours seulement dans la réponse")
        for day in series:
            for d in day["departements"]:
                if d.get("niveauGravite") in SEVERE:
                    days[d["code"]] = days.get(d["code"], 0) + 1
                else:
                    days.setdefault(d["code"], 0)
    severe = sum(days.values()) / len(years)
    ctx.log(f"  {severe:.0f} jours·département de restriction sévère par an")
    if severe < 500:  # ~7 400 par an sur 2021-2025 ; un champ renommé donnerait 0
        raise ValueError(f"total invraisemblable : {severe:.0f} jours·département/an")
    for code, n in days.items():
        yield "secheresse_jours", code, f"{years[0]}–{years[-1]}", n / len(years)
