"""Consommation d'espaces naturels, agricoles et forestiers (Cerema, fichiers fonciers).

Chaque millésime est publié comme un nouveau jeu de données : on cherche le plus
récent dans le catalogue, puis le fichier communal (`*-com.csv`). Les colonnes
annuelles `nafYYartZZ` sont en m² (vérifié sur les totaux nationaux ci-dessous).
"""

import re

from .. import datagouv
from ..util import dep_of_commune

SOURCE = {
    "id": "consoenaf",
    "label": "Consommation d'espaces NAF (fichiers fonciers)",
    "provider": "Cerema",
    "url": "https://www.data.gouv.fr/fr/datasets/?q=consommation%20d%27espaces%20naturels%20agricoles%20et%20forestiers",
    "licence": "Licence Ouverte 2.0",
    "refresh": "annuel",
    "max_age_days": 6,
}

YEARS = 5

INDICATORS = [
    {
        "id": "conso_naf",
        "label": "Artificialisation récente des sols",
        "unit": "ha/an pour 100 km²",
        "theme": "nature",
        "direction": -1,
        "weight": 1.0,
        "decimals": 1,
        "description": (
            f"Surface naturelle, agricole ou forestière consommée (urbanisée) par an, moyenne des "
            f"{YEARS} dernières années, rapportée à la surface du département. Mesure la pression "
            "d'urbanisation sur les terres, pas leur qualité agronomique."
        ),
    },
]

COL = re.compile(r"^naf(\d\d)art(\d\d)$")


def _latest_dataset(http):
    best = None
    for ds in datagouv.search(http, "consommation d'espaces naturels agricoles et forestiers"):
        if ds.get("organization") and "cerema" not in (ds["organization"].get("name") or "").lower():
            continue
        m = re.search(r"au 1er janvier (\d{4})", ds.get("title", ""))
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), ds["id"])
    if best is None:
        raise LookupError("aucun millésime CONSOENAF trouvé dans le catalogue")
    return best[1]


def fetch(ctx):
    ds_id = _latest_dataset(ctx.http)
    res = datagouv.resource(ctx.http, ds_id, url_pattern=r"-com\.csv$")
    ctx.log(f"  fichier : {res['url']}")
    rows = ctx.http.csv(res["url"], timeout=600)
    yearly = sorted(
        (c for c in rows.fieldnames if (m := COL.match(c)) and int(m.group(2)) == int(m.group(1)) + 1),
        key=lambda c: int(COL.match(c).group(1)),
    )[-YEARS:]
    surf_col = next((c for c in rows.fieldnames if c.startswith("surfcom")), None)
    if len(yearly) < YEARS or surf_col is None or "idcom" not in rows.fieldnames:
        raise ValueError(f"colonnes inattendues : {rows.fieldnames[:20]}")
    conso, surf, national = {}, {}, 0.0
    for r in rows:
        dep = dep_of_commune(r.get("idcom"))
        vals = [float(r[c] or 0) for c in yearly]
        national += sum(vals)
        if dep is None:
            continue
        conso[dep] = conso.get(dep, 0.0) + sum(vals)
        surf[dep] = surf.get(dep, 0.0) + float(r[surf_col] or 0)
    # Garde-fou d'unité : la France consomme ~15 000 à 30 000 ha/an.
    ha_per_year = national / 1e4 / YEARS
    if not 5_000 < ha_per_year < 60_000:
        raise ValueError(f"total national invraisemblable : {ha_per_year:.0f} ha/an (unité changée ?)")
    first, last = 2000 + int(COL.match(yearly[0]).group(1)), 2000 + int(COL.match(yearly[-1]).group(2))
    ctx.log(f"  {yearly[0]}…{yearly[-1]}, France : {ha_per_year:.0f} ha/an")
    for dep, m2 in conso.items():
        km2 = surf[dep] / 1e6 if surf[dep] > 1e6 else ctx.territories[dep].area_km2 if dep in ctx.territories else None
        if km2:
            yield "conso_naf", dep, f"{first}–{last}", (m2 / 1e4 / YEARS) / (km2 / 100)
