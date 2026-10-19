"""Climat récent et projeté — Open-Meteo (réanalyse ERA5 et modèles CMIP6 HighResMIP).

Quota gratuit : 10 000 « appels » pondérés par jour et par IP, une requête
pesant nb_points × nb_variables/10 × nb_jours/14. On échantillonne donc chaque
département en deux points seulement, choisis là où vivent les habitants (une
grille régulière tombait sur les sommets : 0 jour chaud projeté dans les
Alpes-de-Haute-Provence), et on ne rafraîchit que rarement (`max_age_days`) :
ces moyennes pluriannuelles bougent peu. Usage non commercial, attribution
requise (CC BY 4.0).
"""

import time

from .. import territories as terr
from ..util import communes, complete_years, dep_of_commune

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
CLIMATE = "https://climate-api.open-meteo.com/v1/climate"
CHUNK = 60  # points par requête : reste sous la limite de 5 000 par requête


def _points(ctx):
    """Deux points par département : les centres des communes qui portent le 1er et
    le 3e quartile de la population cumulée (communes triées par taille). On
    obtient une commune « typique » de la moitié rurale et une de la moitié
    urbaine. Repli sur une grille de 60 km si geo.api est indisponible."""
    if "points" in ctx.memo:
        return ctx.memo["points"]
    pts = []
    try:
        by_dep = {}
        for c in communes(ctx):
            dep = dep_of_commune(c.get("code"))
            if dep in ctx.territories and c.get("population") and c.get("centre"):
                by_dep.setdefault(dep, []).append((c["population"], *c["centre"]["coordinates"]))
        for dep, items in by_dep.items():
            items.sort()
            total, acc, picked = sum(i[0] for i in items), 0, []
            targets = [0.25, 0.75]
            for pop, lon, lat in items:
                acc += pop
                while targets and acc >= targets[0] * total:
                    targets.pop(0)
                    if (lon, lat) not in picked:
                        picked.append((lon, lat))
            pts += [(dep, lon, lat) for lon, lat in picked]
        if len(by_dep) < len(ctx.territories):
            raise ValueError(f"{len(by_dep)} départements seulement")
    except Exception as e:  # noqa: BLE001
        ctx.log(f"  points de population indisponibles ({e}), grille de 60 km")
        pts = [(code, lon, lat) for code, t in terr.load(60000).items() for lon, lat in t.sample_points]
    ctx.memo["points"] = pts
    return pts


def _daily(ctx, url, points, params):
    """Itère (code_département, dict daily) sur tous les points, par paquets."""
    for i in range(0, len(points), CHUNK):
        if i:
            time.sleep(61)  # limite de 600 appels pondérés par minute
        chunk = points[i : i + CHUNK]
        res = ctx.http.json(
            url,
            {
                **params,
                "latitude": ",".join(f"{lat:.4f}" for _, _, lat in chunk),
                "longitude": ",".join(f"{lon:.4f}" for _, lon, _ in chunk),
                "timezone": "UTC",
            },
            timeout=300,
        )
        if isinstance(res, dict):  # un seul point : objet nu au lieu d'une liste
            res = [res]
        if len(res) != len(chunk):
            raise ValueError(f"{len(res)} réponses pour {len(chunk)} points")
        for (code, _, _), r in zip(chunk, res):
            yield code, r["daily"]


def _mean_by_dep(pairs):
    acc = {}
    for code, v in pairs:
        if v is not None:
            acc.setdefault(code, []).append(v)
    return {c: sum(v) / len(v) for c, v in acc.items()}


class Recent:
    SOURCE = {
        "id": "climat_recent",
        "label": "Open-Meteo Historical Weather API (réanalyse ERA5)",
        "provider": "Open-Meteo / Copernicus ECMWF",
        "url": "https://open-meteo.com/en/docs/historical-weather-api",
        "licence": "CC BY 4.0",
        "refresh": "mensuel",
        "max_age_days": 30,
        "version": 3,  # 2-3 : points de population au lieu d'une grille
    }
    YEARS = 5
    INDICATORS = [
        {
            "id": "bilan_hydrique",
            "label": "Bilan hydrique climatique",
            "unit": "mm/an",
            "theme": "eau",
            "direction": 1,
            "weight": 1.0,
            "decimals": 0,
            "description": (
                "Précipitations moins évapotranspiration de référence (FAO-56), moyenne annuelle sur "
                "les 5 dernières années civiles (réanalyse ERA5), moyenne de deux communes "
                "représentatives de la répartition de la population. Positif : le climat apporte plus "
                "d'eau que la végétation n'en demande. Ne tient compte ni des nappes ni de l'irrigation."
            ),
        },
    ]

    @classmethod
    def fetch(cls, ctx):
        years = complete_years(ctx.today, cls.YEARS)
        params = {
            "start_date": f"{years[0]}-01-01",
            "end_date": f"{years[-1]}-12-31",
            "daily": "precipitation_sum,et0_fao_evapotranspiration",
        }
        pairs = []
        for code, d in _daily(ctx, ARCHIVE, _points(ctx), params):
            p = [v for v in d["precipitation_sum"] if v is not None]
            e = [v for v in d["et0_fao_evapotranspiration"] if v is not None]
            n = len(d["time"])
            if len(p) > 0.95 * n and len(e) > 0.95 * n:
                pairs.append((code, (sum(p) / len(p) - sum(e) / len(e)) * 365.25))
        for code, v in _mean_by_dep(pairs).items():
            yield "bilan_hydrique", code, f"{years[0]}–{years[-1]}", v


class Future:
    SOURCE = {
        "id": "climat_futur",
        "label": "Open-Meteo Climate Change API (CMIP6 HighResMIP)",
        "provider": "Open-Meteo / MRI (Japon)",
        "url": "https://open-meteo.com/en/docs/climate-api",
        "licence": "CC BY 4.0",
        "refresh": "annuel (projections figées)",
        "max_age_days": 365,
        "version": 2,  # 2 : points de population au lieu d'une grille
    }
    MODEL = "MRI_AGCM3_2_S"
    PERIOD = (2041, 2050)
    THRESHOLD = 30.0
    INDICATORS = [
        {
            "id": "jours_chauds_2050",
            "label": "Jours chauds projetés (2041–2050)",
            "unit": "jours/an",
            "theme": "eau",
            "direction": -1,
            "weight": 1.0,
            "decimals": 0,
            "description": (
                "Nombre moyen de jours par an où la température maximale atteint 30 °C sur la "
                "décennie 2041–2050, selon un seul modèle (MRI-AGCM3-2-S, 20 km, corrigé sur "
                "ERA5-Land, forçage HighResMIP proche d'un scénario d'émissions élevées), moyenne "
                "de deux communes représentatives de la répartition de la population. Un "
                "ordre de grandeur pour comparer les départements, pas une prévision."
            ),
        },
    ]

    @classmethod
    def fetch(cls, ctx):
        a, b = cls.PERIOD
        params = {
            "start_date": f"{a}-01-01",
            "end_date": f"{b}-12-31",
            "models": cls.MODEL,
            "daily": "temperature_2m_max",
        }
        pairs = []
        for code, d in _daily(ctx, CLIMATE, _points(ctx), params):
            tx = [v for v in d["temperature_2m_max"] if v is not None]
            if len(tx) > 0.95 * len(d["time"]):
                pairs.append((code, sum(v >= cls.THRESHOLD for v in tx) / (b - a + 1)))
        for code, v in _mean_by_dep(pairs).items():
            yield "jours_chauds_2050", code, f"{a}–{b}", v
