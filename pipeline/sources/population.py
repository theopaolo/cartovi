"""Densité de population — API Découpage administratif (geo.api.gouv.fr).

Un seul appel renvoie les ~35 000 communes avec leur population légale INSEE
(dernier millésime publié) et leur surface en hectares.
"""

from ..util import dep_of_commune

SOURCE = {
    "id": "population",
    "label": "API Découpage administratif (populations légales INSEE)",
    "provider": "DINUM / INSEE / IGN",
    "url": "https://geo.api.gouv.fr/decoupage-administratif",
    "licence": "Licence Ouverte 2.0",
    "refresh": "annuel (populations légales)",
}

INDICATORS = [
    {
        "id": "densite",
        "label": "Densité de population",
        "unit": "hab./km²",
        "theme": "foncier",
        "direction": -1,
        "weight": 1.0,
        "decimals": 0,
        "scale": "log",
        "description": (
            "Population municipale rapportée à la surface. Comptée comme défavorable : "
            "une faible densité laisse plus de terres par habitant et moins de pression "
            "foncière — c'est un choix de valeur propre à l'autonomie, pas une vérité générale "
            "(la densité facilite aussi l'accès aux services)."
        ),
    },
]


def fetch(ctx):
    communes = ctx.http.json(
        "https://geo.api.gouv.fr/communes",
        {"fields": "code,population,surface", "format": "json"},
        timeout=180,
    )
    pop, surf = {}, {}
    for c in communes:
        dep = dep_of_commune(c.get("code"))
        if dep is None or c.get("population") is None:
            continue
        pop[dep] = pop.get(dep, 0) + c["population"]
        surf[dep] = surf.get(dep, 0) + (c.get("surface") or 0) / 100  # ha -> km²
    period = ctx.today.year
    for dep, p in pop.items():
        t = ctx.territories.get(dep)
        if t is None:
            continue
        # surface communale si complète (±5 %), sinon aire géométrique du contour IGN
        km2 = surf[dep] if abs(surf[dep] - t.area_km2) < 0.05 * t.area_km2 else t.area_km2
        yield "densite", dep, period, p / km2
