"""Référentiel des 96 départements métropolitains : contours, aires, points.

Les contours (IGN Admin Express COG, simplifiés) sont statiques : les limites
départementales n'ont pas bougé depuis 2018. Tout le reste en est dérivé.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import geo

STATIC = Path(__file__).parent / "static"

# Codes région (COG) des départements, pour regrouper et afficher.
REGIONS = {
    "84": ("Auvergne-Rhône-Alpes", "01 03 07 15 26 38 42 43 63 69 73 74"),
    "27": ("Bourgogne-Franche-Comté", "21 25 39 58 70 71 89 90"),
    "53": ("Bretagne", "22 29 35 56"),
    "24": ("Centre-Val de Loire", "18 28 36 37 41 45"),
    "94": ("Corse", "2A 2B"),
    "44": ("Grand Est", "08 10 51 52 54 55 57 67 68 88"),
    "32": ("Hauts-de-France", "02 59 60 62 80"),
    "11": ("Île-de-France", "75 77 78 91 92 93 94 95"),
    "28": ("Normandie", "14 27 50 61 76"),
    "75": ("Nouvelle-Aquitaine", "16 17 19 23 24 33 40 47 64 79 86 87"),
    "76": ("Occitanie", "09 11 12 30 31 32 34 46 48 65 66 81 82"),
    "52": ("Pays de la Loire", "44 49 53 72 85"),
    "93": ("Provence-Alpes-Côte d'Azur", "04 05 06 13 83 84"),
}
REGION_OF = {d: name for _, (name, deps) in REGIONS.items() for d in deps.split()}


@dataclass
class Territory:
    code: str
    name: str
    region: str
    polys: list  # polygones en Lambert-93 (mètres)
    polys_wgs84: list
    area_km2: float
    centroid: tuple  # (lon, lat) d'un point intérieur
    sample_points: list = field(default_factory=list)  # [(lon, lat)]

    def contains_lonlat(self, lon, lat):
        return geo.contains(self.polys, *geo.lambert93(lon, lat))


def load(sample_step_m=30000.0):
    """Charge les départements et calcule une grille de points d'échantillonnage
    (pas `sample_step_m`) pour les sources maillées (climat). Chaque
    département reçoit au moins un point intérieur."""
    data = json.loads((STATIC / "departements.geojson").read_text(encoding="utf-8"))
    out = {}
    for feat in data["features"]:
        code = feat["properties"]["code"]
        polys_wgs = geo.polygons(feat["geometry"])
        polys = geo.project_polygons(polys_wgs)
        ix, iy = geo.interior_point(polys)
        t = Territory(
            code=code,
            name=feat["properties"]["nom"],
            region=REGION_OF[code],
            polys=polys,
            polys_wgs84=polys_wgs,
            area_km2=geo.area(polys) / 1e6,
            centroid=tuple(round(v, 4) for v in geo.wgs84(ix, iy)),
        )
        x0, y0, x1, y1 = geo.bbox(polys)
        # grille alignée globalement (multiples du pas) : pas de doublons aux frontières
        gx = (x0 // sample_step_m + 1) * sample_step_m
        while gx < x1:
            gy = (y0 // sample_step_m + 1) * sample_step_m
            while gy < y1:
                if geo.contains(polys, gx, gy):
                    t.sample_points.append(tuple(round(v, 4) for v in geo.wgs84(gx, gy)))
                gy += sample_step_m
            gx += sample_step_m
        if not t.sample_points:
            t.sample_points.append(t.centroid)
        out[code] = t
    return dict(sorted(out.items()))


def svg_transform(territories, width=1000.0, pad=10.0):
    """Lambert-93 -> coordonnées SVG (y vers le bas) d'un viewBox de largeur fixe.
    Renvoie (fonction, hauteur) ; partagé par les contours et les points communaux."""
    boxes = [geo.bbox(t.polys) for t in territories.values()]
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    s = (width - 2 * pad) / (x1 - x0)

    def tr(x, y):
        return (x - x0) * s + pad, (y1 - y) * s + pad

    return tr, (y1 - y0) * s + 2 * pad


def svg_layer(territories, width=1000.0, pad=10.0):
    """Contours départementaux en chemins SVG."""
    tr, height = svg_transform(territories, width, pad)
    items = []
    for t in territories.values():
        lx, ly = tr(*geo.lambert93(*t.centroid))
        items.append(
            {
                "code": t.code,
                "name": t.name,
                "region": t.region,
                "area_km2": round(t.area_km2, 1),
                "label": [round(lx, 1), round(ly, 1)],
                "path": geo.svg_path(t.polys, tr),
            }
        )
    return {"viewBox": f"0 0 {width:.0f} {height:.0f}", "territories": items}
