"""Prix médian des maisons — Statistiques DVF (Etalab, d'après la DGFiP).

Fichier « Statistiques totales DVF » : une ligne par territoire, agrégée sur la
fenêtre glissante des 10 derniers semestres publiés. L'Alsace-Moselle (57, 67,
68) relève du livre foncier et n'est pas couverte par DVF : ces départements
restent sans valeur, ce que l'interface signale.
"""

from .. import datagouv

SOURCE = {
    "id": "dvf",
    "label": "Statistiques DVF — demandes de valeurs foncières",
    "provider": "DGFiP / Etalab",
    "url": "https://www.data.gouv.fr/fr/datasets/statistiques-dvf/",
    "licence": "Licence Ouverte 2.0",
    "refresh": "semestriel (avril, octobre)",
    "max_age_days": 6,
}

INDICATORS = [
    {
        "id": "prix_maison_m2",
        "label": "Prix médian des maisons",
        "unit": "€/m²",
        "theme": "foncier",
        "direction": -1,
        "weight": 1.5,
        "decimals": 0,
        "min_coverage": 0.96,  # 93/96 : Alsace-Moselle hors DVF
        "description": (
            "Médiane du prix au m² des ventes de maisons sur les 10 derniers semestres publiés "
            "(ventes d'un seul bien). Proxy de l'accessibilité du foncier bâti ; ne reflète pas "
            "le prix des terres agricoles. Absent pour la Moselle, le Bas-Rhin et le Haut-Rhin "
            "(régime du livre foncier, hors DVF)."
        ),
    },
]

PERMALINK = "https://www.data.gouv.fr/fr/datasets/r/851d342f-9c96-41c1-924a-11a7a7aae8a6"
MIN_SALES = 30


def fetch(ctx):
    try:
        res = datagouv.resource(ctx.http, "statistiques-dvf", title="Statistiques totales DVF")
        url, period = res["url"], (res.get("last_modified") or "")[:7]
    except Exception as e:  # noqa: BLE001
        ctx.log(f"  catalogue indisponible ({e}), permalien utilisé")
        url, period = PERMALINK, ctx.today.strftime("%Y-%m")
    for row in ctx.http.csv(url, timeout=300):
        if row.get("echelle_geo") != "departement":
            continue
        med, n = row.get("med_prix_m2_whole_maison"), row.get("nb_ventes_whole_maison")
        if not med or not n or float(n) < MIN_SALES:
            continue
        yield "prix_maison_m2", row["code_geo"], f"10 semestres, publ. {period}", float(med)
