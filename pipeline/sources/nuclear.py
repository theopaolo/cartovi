"""Part de la surface départementale située dans un périmètre PPI nucléaire.

Liste statique des sites (static/nuclear_sites.json) : elle ne change qu'à la
mise en service ou à l'arrêt définitif d'un site, événements rares et publics.
Le calcul est géométrique : grille de 1 km² en Lambert-93, chaque maille à
moins de `ppi_km` d'un site est attribuée au département qui la contient.
Les mailles couvertes par deux sites ne sont comptées qu'une fois.
"""

import json
from pathlib import Path

from .. import geo

SOURCE = {
    "id": "nucleaire",
    "label": "Sites nucléaires dotés d'un Plan particulier d'intervention",
    "provider": "ASNR / EDF / Orano (liste statique, vérifiée manuellement)",
    "url": "https://www.asnr.fr",
    "licence": "Données publiques",
    "refresh": "à chaque mise en service ou arrêt définitif",
    "max_age_days": 6,
}

INDICATORS = [
    {
        "id": "nucleaire_ppi",
        "label": "Surface en zone PPI nucléaire",
        "unit": "% du territoire",
        "theme": "risques",
        "direction": -1,
        "weight": 1.0,
        "decimals": 1,
        "min_coverage": 1.0,
        "description": (
            "Part du département à moins de 20 km d'un site nucléaire doté d'un Plan "
            "particulier d'intervention (rayon étendu de 10 à 20 km en 2019 pour les "
            "centrales). Mesure une exposition réglementaire, pas un niveau de risque."
        ),
    },
]

STATIC = Path(__file__).resolve().parent.parent / "static" / "nuclear_sites.json"
CELL_M = 1000.0


def coverage(sites, territories):
    cells = set()
    for s in sites:
        cx, cy = geo.lambert93(s["lon"], s["lat"])
        r = s["ppi_km"] * 1000
        i0, i1 = int((cx - r) // CELL_M), int((cx + r) // CELL_M) + 1
        j0, j1 = int((cy - r) // CELL_M), int((cy + r) // CELL_M) + 1
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                x, y = (i + 0.5) * CELL_M, (j + 0.5) * CELL_M
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    cells.add((i, j))
    boxes = {c: geo.bbox(t.polys) for c, t in territories.items()}
    covered = {c: 0 for c in territories}
    for i, j in cells:
        x, y = (i + 0.5) * CELL_M, (j + 0.5) * CELL_M
        for c, (x0, y0, x1, y1) in boxes.items():
            if x0 <= x <= x1 and y0 <= y <= y1 and geo.contains(territories[c].polys, x, y):
                covered[c] += 1
                break
    # mailles de 1 km² ; on rapporte à l'aire géométrique (même projection)
    return {c: min(100.0, 100 * n * (CELL_M / 1000) ** 2 / territories[c].area_km2) for c, n in covered.items()}


def fetch(ctx):
    data = json.loads(STATIC.read_text(encoding="utf-8"))
    sites = [s for s in data["sites"] if s.get("ppi_km")]
    for code, pct in coverage(sites, ctx.territories).items():
        yield "nucleaire_ppi", code, data["as_of"], pct
