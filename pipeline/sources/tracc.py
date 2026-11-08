"""Climat futur officiel : indicateurs TRACC-2023 de DRIAS (Météo-France).

La TRACC (trajectoire de réchauffement de référence pour l'adaptation) raisonne en
niveaux de réchauffement plutôt qu'en scénarios d'émissions : +2 °C en France vers
2030, +2,7 °C vers 2050, +4 °C vers 2100, par rapport à 1976–2005. Les indicateurs
sont calculés sur la grille SAFRAN de 8 km à partir de l'ensemble de simulations
régionales corrigées d'Explore2-Climat ; un fichier par quantile de l'ensemble
(Q50 : médiane) et par niveau.

Les fichiers ne s'obtiennent qu'avec un compte DRIAS (formulaire « sélection
personnalisée ») : ils sont extraits une fois, versionnés tels quels dans
`data/raw/drias/tracc2023/` (nommés `<quantile>_<niveau>.csv`, voir le LISEZMOI du
dossier) et lus ici sans réseau. L'empreinte des fichiers sert de version de méthode :
ajouter les quantiles Q05/Q95 ou une nouvelle extraction relance le calcul.

Rattachement : une commune prend la valeur du point de grille le plus proche de sa
mairie ; un département, la moyenne de ses communes pondérée par la population
(l'exposition de l'habitant moyen, pas celle de la surface).
"""

import hashlib
import json
import re
import sys
from pathlib import Path

from .. import geo
from ..util import communes, dep_of_commune, position

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "data" / "raw" / "drias" / "tracc2023"
WEB = ROOT / "web" / "data" / "climat" / "tracc.json"
FILE = re.compile(r"(Q\d\d)_(REF|GWL\d\d)\.csv$")
N_POINTS = 8981  # grille SAFRAN, France métropolitaine et Corse
MAX_KM = 8  # demi-diagonale d’une maille : 5,7 km ; au-delà (Ouessant, Sein), aucun point ne représente la commune

LEVELS = [  # ordre d'affichage
    {"id": "REF", "label": "1976–2005", "horizon": "référence", "france": None},
    {"id": "GWL15", "label": "+2 °C", "horizon": "≈ 2030", "france": 2.0},
    {"id": "GWL20", "label": "+2,7 °C", "horizon": "≈ 2050", "france": 2.7},
    {"id": "GWL30", "label": "+4 °C", "horizon": "≈ 2100", "france": 4.0},
]
LEVEL_IDS = [lv["id"] for lv in LEVELS]
SCORED_LEVEL = "GWL20"  # +2,7 °C : le niveau sur lequel la TRACC demande de s'adapter d'ici 2050

# Indices DRIAS (en-tête des fichiers) -> clé courte, libellé, unité, décimales, bornes plausibles.
INDICES = [
    ("NORTX35D_yr", "tx35", "Jours à 35 °C ou plus", "jours/an", 1, (0, 200)),
    ("NORTX30D_yr", "tx30", "Jours à 30 °C ou plus", "jours/an", 1, (0, 250)),
    ("NORTR_yr", "tr", "Nuits tropicales (minimale > 20 °C)", "nuits/an", 1, (0, 250)),
    ("NORRR_seas_JJA", "rr_ete", "Pluies d'été (juin–août)", "mm", 0, (0, 1500)),
    ("NORRx1d_yr", "rx1d", "Pluie maximale en un jour (moyenne annuelle)", "mm", 0, (0, 600)),
    ("NORIFM40_yr", "ifm40", "Jours de danger météorologique de feu (IFM > 40)", "jours/an", 0, (0, 366)),
    ("NORSWI04_yr", "swi04", "Jours de sol sec (indice d'humidité SWI < 0,4)", "jours/an", 0, (0, 366)),
]
KEYS = [k for _, k, *_ in INDICES]

SOURCE = {
    "id": "tracc",
    "label": "DRIAS — TRACC-2023, indicateurs par niveau de réchauffement",
    "provider": "Météo-France (DRIAS, les futurs du climat) — ensemble Explore2-Climat",
    "url": "https://www.drias-climat.fr/",
    "licence": "Réutilisation libre, mention obligatoire : « DRIAS, données Météo-France »",
    "refresh": "statique (extraction DRIAS versionnée dans le dépôt)",
    "max_age_days": 3650,
}

_DESC_TAIL = (
    " Niveau +2,7 °C en France (≈ 2050 selon la TRACC), médiane de l'ensemble de "
    "simulations Explore2-Climat sur la grille SAFRAN de 8 km ; moyenne des communes "
    "pondérée par la population. Une projection d'ensemble, pas une prévision ; la "
    "maille de 8 km lisse les reliefs et ignore les îlots de chaleur urbains."
)
INDICATORS = [
    {"id": "tx35_27", "key": "tx35", "label": "Jours à 35 °C ou plus (+2,7 °C)", "unit": "jours/an",
     "theme": "futur", "direction": -1, "weight": 1.0, "decimals": 1,
     "description": "Nombre moyen de jours par an où la température maximale atteint 35 °C." + _DESC_TAIL},
    {"id": "tr_27", "key": "tr", "label": "Nuits tropicales (+2,7 °C)", "unit": "nuits/an",
     "theme": "futur", "direction": -1, "weight": 0.5, "decimals": 1,
     "description": "Nombre moyen de nuits par an où la température minimale reste au-dessus de 20 °C : "
                    "le corps ne récupère plus de la chaleur du jour." + _DESC_TAIL},
    {"id": "swi04_27", "key": "swi04", "label": "Jours de sol sec (+2,7 °C)", "unit": "jours/an",
     "theme": "futur", "direction": -1, "weight": 1.0, "decimals": 0,
     "description": "Nombre moyen de jours par an où l'indice d'humidité des sols simulé (SWI) passe sous "
                    "0,4 : végétation et cultures en stress hydrique, retrait des argiles." + _DESC_TAIL},
    {"id": "ifm40_27", "key": "ifm40", "label": "Jours de danger météo de feu (+2,7 °C)", "unit": "jours/an",
     "theme": "futur", "direction": -1, "weight": 0.5, "decimals": 0,
     "description": "Nombre moyen de jours par an où l'indice forêt météo (IFM) dépasse 40. Il mesure un "
                    "danger météorologique (chaleur, sécheresse, vent), pas la présence de forêt ni le "
                    "risque d'incendie réel." + _DESC_TAIL},
    {"id": "rx1d_27", "key": "rx1d", "label": "Pluie maximale en un jour (+2,7 °C)", "unit": "mm",
     "theme": "futur", "direction": -1, "weight": 0.5, "decimals": 0,
     "description": "Moyenne du cumul de pluie le plus fort de l'année en une journée : l'intensité des "
                    "épisodes de pluie extrême. Un aléa, pas une zone inondable (voir CatNat et PPR)."
                    + _DESC_TAIL},
]
SCORED = {ind["key"]: ind["id"] for ind in INDICATORS}  # colonnes de la couche communale : mêmes ids


def _files():
    out = {}
    for f in sorted(RAW.glob("*.csv")):
        m = FILE.search(f.name)
        if m:
            out[(m.group(1), m.group(2))] = f
    return out


METHOD = 2  # 2 : communes placées à leur mairie (et non au centre géométrique)


def fingerprint():
    """Version de méthode dérivée des fichiers : toute nouvelle extraction relance le calcul."""
    h = hashlib.sha256(f"methode {METHOD}".encode())
    for (q, lv), f in sorted(_files().items()):
        h.update(f"{q}_{lv}".encode())
        h.update(f.read_bytes())
    return int(h.hexdigest()[:7], 16)


SOURCE["version"] = fingerprint() if RAW.exists() else 0


def _parse(path, quantile, level):
    """Un fichier DRIAS : en-têtes « # », ligne de format, puis Point;Latitude;Longitude;Niveau;indices…"""
    text = path.read_text("utf-8")
    header = [ln for ln in text.splitlines() if ln.startswith("#")]
    model = next((ln.split(":", 1)[1].strip() for ln in header if ln.startswith("# Modele")), None)
    if model != quantile:
        raise ValueError(f"{path.name} : quantile {model!r} dans l'en-tête, {quantile!r} attendu")
    fmt = next(i for i, ln in enumerate(header) if ln.startswith("# Format des enregistrements"))
    cols = [c for c in header[fmt + 1].lstrip("# ").split(";") if c]
    if cols[:4] != ["Point", "Latitude", "Longitude", "Niveau"]:
        raise ValueError(f"{path.name} : colonnes inattendues {cols[:4]}")
    missing = [code for code, *_ in INDICES if code not in cols]
    if missing:
        raise ValueError(f"{path.name} : indices absents {missing}")
    idx = {code: cols.index(code) for code, *_ in INDICES}
    points, values = {}, {}
    for ln in text.splitlines():
        if not ln or ln.startswith("#"):
            continue
        f = ln.rstrip(";").split(";")
        if f[3] != level:
            raise ValueError(f"{path.name} : niveau {f[3]!r} au point {f[0]}, {level!r} attendu")
        pt = int(f[0])
        points[pt] = (float(f[1]), float(f[2]))
        row = []
        for code, key, _, _, _, (lo, hi) in INDICES:
            v = float(f[idx[code]])
            if not lo <= v <= hi:
                raise ValueError(f"{path.name} : {key}={v} invraisemblable au point {pt}")
            row.append(v)
        values[pt] = row
    if len(values) != N_POINTS:
        raise ValueError(f"{path.name} : {len(values)} points, {N_POINTS} attendus")
    return points, values


def load():
    """{quantile: {niveau: {point: [valeurs dans l'ordre de INDICES]}}}, {point: (lat, lon)}.
    Exige les quatre niveaux pour chaque quantile et une grille identique d'un fichier à l'autre."""
    data, grid = {}, None
    for (q, lv), path in _files().items():
        points, values = _parse(path, q, lv)
        if grid is None:
            grid = points
        elif points != grid:
            raise ValueError(f"{path.name} : grille différente des autres fichiers")
        data.setdefault(q, {})[lv] = values
    if "Q50" not in data:
        raise ValueError(f"aucun fichier Q50 dans {RAW}")
    for q, levels in data.items():
        if set(levels) != set(LEVEL_IDS):
            raise ValueError(f"{q} : niveaux {sorted(levels)}, {LEVEL_IDS} attendus")
    # cohérence physique : la chaleur augmente avec le niveau de réchauffement (moyenne nationale)
    q50 = data["Q50"]
    mean = {lv: sum(v[0] + v[2] for v in q50[lv].values()) / N_POINTS for lv in LEVEL_IDS}
    if not mean["REF"] < mean["GWL15"] < mean["GWL20"] < mean["GWL30"]:
        raise ValueError(f"chaleur non croissante selon le niveau : {mean}")
    return data, grid


class Nearest:
    """Point de grille le plus proche (Lambert-93, cases de 10 km)."""

    def __init__(self, grid):
        self.index = geo_grid = {}
        self.cell = 10_000
        for pt, (lat, lon) in grid.items():
            x, y = geo.lambert93(lon, lat)
            geo_grid.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, pt))

    def __call__(self, x, y):
        i, j = int(x // self.cell), int(y // self.cell)
        best = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for px, py, pt in self.index.get((i + di, j + dj), ()):
                    d = ((px - x) ** 2 + (py - y) ** 2) ** 0.5
                    if best is None or d < best[0]:
                        best = (d, pt)
        return (best[1], best[0] / 1000) if best and best[0] <= MAX_KM * 1000 else (None, None)


def by_commune(coms, data=None, grid=None):
    """{commune: (point, distance en km)} pour des communes (attributs code, lon, lat)."""
    if data is None:
        data, grid = load()
    near = Nearest(grid)
    out = {}
    for c in coms:
        pt, km = near(*geo.lambert93(c.lon, c.lat))
        if pt is not None:
            out[c.code] = (pt, round(km, 1))
    return out


def scored_values(data, pt):
    """Valeurs Q50 au niveau +2,7 °C des indicateurs notés, par clé courte."""
    row = data["Q50"][SCORED_LEVEL][pt]
    return {key: row[KEYS.index(key)] for key in SCORED}


def write_web(data):
    """Table de la grille pour les fiches communales : {quantile: {point: [niveaux × indices]}}."""
    quantiles = sorted(data)
    payload = {
        "source": {
            "label": SOURCE["label"],
            "citation": "DRIAS, données Météo-France",
            "url": SOURCE["url"],
            "extraction": _extraction_date(),
        },
        "levels": LEVELS,
        "indices": [{"key": k, "label": lab, "unit": u, "decimals": d} for _, k, lab, u, d, _ in INDICES],
        "quantiles": quantiles,
        "values": {
            q: {str(pt): [v for lv in LEVEL_IDS for v in data[q][lv][pt]] for pt in sorted(data[q]["REF"])}
            for q in quantiles
        },
    }
    WEB.parent.mkdir(parents=True, exist_ok=True)
    WEB.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return WEB


def _extraction_date():
    for f in _files().values():
        for ln in f.read_text("utf-8").splitlines()[:5]:
            m = re.search(r"Date d'extraction : (\d\d)/(\d\d)/(\d{4})", ln)
            if m:
                return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def fetch(ctx):
    data, grid = load()
    write_web(data)  # sous-produit : la fiche d'une commune lit la trajectoire complète de son point
    coms = []
    for c in communes(ctx):
        dep = dep_of_commune(c.get("code"))
        pos = position(c)
        if dep in ctx.territories and pos:
            lon, lat = pos
            coms.append(_Com(c["code"], dep, c.get("population") or 0, lon, lat))
    assigned = by_commune(coms, data, grid)
    ctx.log(f"  {len(assigned)}/{len(coms)} communes rattachées à un point de grille ; "
            f"distance max {max(km for _, km in assigned.values())} km")
    if len(assigned) < 0.99 * len(coms):
        raise ValueError(f"{len(coms) - len(assigned)} communes sans point de grille à moins de {MAX_KM} km")
    sums = {}
    for c in coms:
        if c.code not in assigned or c.pop <= 0:
            continue
        vals = scored_values(data, assigned[c.code][0])
        s = sums.setdefault(c.dep, {"pop": 0, **dict.fromkeys(SCORED, 0.0)})
        s["pop"] += c.pop
        for key in SCORED:
            s[key] += c.pop * vals[key]
    period = "+2,7 °C (≈ 2050)"
    for dep, s in sums.items():
        for key, ind_id in SCORED.items():
            yield ind_id, dep, period, s[key] / s["pop"]


class _Com:
    __slots__ = ("code", "dep", "pop", "lon", "lat")

    def __init__(self, code, dep, pop, lon, lat):
        self.code, self.dep, self.pop, self.lon, self.lat = code, dep, pop, lon, lat


if __name__ == "__main__":
    # régénère la table web sans réseau : python -m pipeline.sources.tracc
    d, g = load()
    print(f"{len(g)} points, quantiles {sorted(d)} → {write_web(d)}")
    sys.exit(0)
