"""Assecs des petits cours d'eau — réseau ONDE (OFB), via l'API Hub'Eau Écoulement.

Chaque été, les agents de l'OFB notent l'état d'écoulement de ~3 300 stations
en tête de bassin. Un indicateur observé, direct, de la disponibilité en eau
de surface en période sèche.
"""

from ..util import complete_years

SOURCE = {
    "id": "onde",
    "label": "Observatoire national des étiages (ONDE) — Hub'Eau",
    "provider": "OFB / BRGM (Hub'Eau)",
    "url": "https://hubeau.eaufrance.fr/page/api-ecoulement",
    "licence": "Licence Ouverte 2.0",
    "refresh": "campagnes mensuelles de mai à septembre",
    "max_age_days": 7,
}

YEARS = 5
DRY = {"2", "3"}  # écoulement non visible, assec

INDICATORS = [
    {
        "id": "assecs",
        "label": "Cours d'eau à sec en été",
        "unit": "% des observations",
        "theme": "eau",
        "direction": -1,
        "weight": 1.0,
        "decimals": 1,
        "min_coverage": 0.9,  # Paris et petite couronne n'ont pas de station ONDE
        "description": (
            f"Part des observations estivales (mai–septembre, {YEARS} dernières années) où le "
            "cours d'eau était sans écoulement visible ou à sec, sur les stations ONDE du "
            "département. Les stations sont en tête de bassin : l'indicateur décrit les petits "
            "cours d'eau, pas les grands fleuves."
        ),
    },
]

API = "https://hubeau.eaufrance.fr/api/v1/ecoulement/observations"


def fetch(ctx):
    years = complete_years(ctx.today, YEARS)
    for code in ctx.territories:
        url = API
        params = {
            "code_departement": code,
            "date_observation_min": f"{years[0]}-05-01",
            "date_observation_max": f"{years[-1]}-09-30",
            "fields": "date_observation,code_ecoulement",
            "size": 5000,
        }
        total = dry = 0
        while url:
            page = ctx.http.json(url, params, timeout=120)
            for o in page.get("data", []):
                if 5 <= int(o["date_observation"][5:7]) <= 9 and o.get("code_ecoulement"):
                    total += 1
                    dry += o["code_ecoulement"] in DRY
            url, params = page.get("next"), None  # `next` contient déjà les paramètres
        if total >= 20:  # en dessous, la proportion n'a pas de sens
            yield "assecs", code, f"{years[0]}–{years[-1]}", 100 * dry / total
