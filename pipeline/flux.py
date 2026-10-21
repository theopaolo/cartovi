"""Flux et limites : le vent de la semaine écoulée, avec la maille qui le porte.

    python -m pipeline.flux            # si le dernier export a plus de MAX_AGE_DAYS
    python -m pipeline.flux --force

Produit web/data/flux/vent.json pour la page « Flux & limites ». Le champ est
téléchargé sur une grille régulière de 0,5° (~40-55 km) : ces nœuds sont la
seule information réelle, exportés tels quels pour pouvoir les montrer. Le
champ animé en est une interpolation, rééchantillonnée en coordonnées SVG
(celles de map.json) et tournée dans le repère de la projection Lambert-93,
dont le nord s'écarte du nord géographique de ±5° aux marges de la France.
"""

import argparse
import base64
import datetime
import json
import math
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from . import db, geo, territories
from .http import Http

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "flux"
MAX_AGE_DAYS = 6
VERSION = 1

API = "https://api.open-meteo.com/v1/forecast"
LON = (-6.0, 10.5)  # emprise de la grille source, un peu au-delà de la France
LAT = (41.0, 51.5)
STEP = 0.5  # degrés
DAYS = 7
EVERY_H = 3  # une image toutes les 3 h ; la page interpole entre deux images
FIELD = (50, 47)  # grille rééchantillonnée en SVG (~23 km par cellule)
QUANT = 0.25  # m/s par unité, int8 : ±31,75 m/s
CHUNK = 100


def _grid():
    lons = [LON[0] + i * STEP for i in range(int(round((LON[1] - LON[0]) / STEP)) + 1)]
    lats = [LAT[0] + j * STEP for j in range(int(round((LAT[1] - LAT[0]) / STEP)) + 1)]
    return lons, lats


def fetch(ctx, lons, lats):
    """u, v (m/s, est et nord) par heure et par nœud : {(i, j): [(u, v), …]} et la liste des heures."""
    nodes = [(i, j) for j in range(len(lats)) for i in range(len(lons))]
    field, hours = {}, None
    for k in range(0, len(nodes), CHUNK):
        if k:
            time.sleep(11)  # ~600 appels pondérés par minute : CHUNK points toutes les 10 s
        chunk = nodes[k : k + CHUNK]
        res = ctx.http.json(
            API,
            {
                "latitude": ",".join(f"{lats[j]:.2f}" for _, j in chunk),
                "longitude": ",".join(f"{lons[i]:.2f}" for i, _ in chunk),
                "hourly": "wind_speed_10m,wind_direction_10m",
                "wind_speed_unit": "ms",
                "past_days": DAYS,
                "forecast_days": 1,
                "timezone": "UTC",
            },
            timeout=300,
        )
        res = res if isinstance(res, list) else [res]
        if len(res) != len(chunk):
            raise ValueError(f"{len(res)} réponses pour {len(chunk)} points")
        for (i, j), r in zip(chunk, res):
            h = r["hourly"]
            hours = hours or h["time"]
            uv = []
            for s, d in zip(h["wind_speed_10m"], h["wind_direction_10m"]):
                if s is None or d is None:
                    uv.append(None)
                else:  # la direction est celle d'où vient le vent
                    a = math.radians(d)
                    uv.append((-s * math.sin(a), -s * math.cos(a)))
            field[(i, j)] = uv
    return field, hours


def _bilinear(field, lons, lats, lon, lat, t):
    fi = (lon - lons[0]) / STEP
    fj = (lat - lats[0]) / STEP
    i0 = min(max(int(math.floor(fi)), 0), len(lons) - 2)
    j0 = min(max(int(math.floor(fj)), 0), len(lats) - 2)
    a, b = min(max(fi - i0, 0), 1), min(max(fj - j0, 0), 1)
    acc, wsum = [0.0, 0.0], 0.0
    for di, dj, w in ((0, 0, (1 - a) * (1 - b)), (1, 0, a * (1 - b)), (0, 1, (1 - a) * b), (1, 1, a * b)):
        v = field[(i0 + di, j0 + dj)][t]
        if v is not None and w > 0:
            acc[0] += w * v[0]
            acc[1] += w * v[1]
            wsum += w
    return (acc[0] / wsum, acc[1] / wsum) if wsum else (0.0, 0.0)


def build(ctx):
    terrs = ctx.territories
    tr, height = territories.svg_transform(terrs)
    lons, lats = _grid()
    field, hours = fetch(ctx, lons, lats)
    frames = list(range(0, len(hours), EVERY_H))
    nx, ny = FIELD
    dx, dy = 1000 / nx, height / ny

    # inverse SVG -> Lambert-93 : la transformation est affine, on la déduit de deux points
    (ax, ay), (bx, by) = tr(0, 0), tr(1000, 1000)
    sx, sy = (bx - ax) / 1000, (by - ay) / 1000

    def to_l93(x, y):
        return (x - ax) / sx, (y - ay) / sy

    cells = []  # pour chaque cellule : lon, lat et la base locale (est, nord) en unités SVG
    for j in range(ny):
        for i in range(nx):
            x, y = (i + 0.5) * dx, (j + 0.5) * dy
            lon, lat = geo.wgs84(*to_l93(x, y))
            p0 = tr(*geo.lambert93(lon, lat))
            pe = tr(*geo.lambert93(lon + 0.01, lat))
            pn = tr(*geo.lambert93(lon, lat + 0.01))
            ex, ey = pe[0] - p0[0], pe[1] - p0[1]
            nxv, nyv = pn[0] - p0[0], pn[1] - p0[1]
            ne, nn = math.hypot(ex, ey), math.hypot(nxv, nyv)
            cells.append((lon, lat, ex / ne, ey / ne, nxv / nn, nyv / nn))

    data = bytearray()
    peak = 0.0
    for t in frames:
        for lon, lat, ex, ey, nxv, nyv in cells:
            u, v = _bilinear(field, lons, lats, lon, lat, t)
            px, py = u * ex + v * nxv, u * ey + v * nyv  # composantes en repère SVG (y vers le bas)
            peak = max(peak, math.hypot(u, v))
            for c in (px, py):
                data.append(max(-127, min(127, round(c / QUANT))) & 0xFF)
    if peak < 1:
        raise ValueError("champ de vent nul : réponse invraisemblable")

    nodes = []
    for i, lon in enumerate(lons):
        for j, lat in enumerate(lats):
            x, y = tr(*geo.lambert93(lon, lat))
            if -20 <= x <= 1020 and -20 <= y <= height + 20:
                nodes.append([round(x, 1), round(y, 1)])

    sites = json.loads((Path(__file__).parent / "static" / "nuclear_sites.json").read_text("utf-8"))["sites"]
    ppi = []
    for s in sites:
        x, y = tr(*geo.lambert93(s["lon"], s["lat"]))
        ppi.append({"name": s["name"], "x": round(x, 1), "y": round(y, 1), "r": round(s["ppi_km"] * 1000 * abs(sx), 2)})

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": VERSION,
        "generated_at": db.now(),
        "source": {
            "label": "Open-Meteo Forecast API (modèles AROME / ARPEGE de Météo-France et ECMWF, « best match »)",
            "url": "https://open-meteo.com/en/docs",
            "licence": "CC BY 4.0, usage non commercial",
        },
        "variable": "vent à 10 m",
        "times": [hours[t] + "Z" for t in frames],
        "every_hours": EVERY_H,
        "viewBox": f"0 0 1000 {height:.0f}",
        "grid": {"nx": nx, "ny": ny, "dx": round(dx, 4), "dy": round(dy, 4), "quant_ms": QUANT},
        "source_grid": {"step_deg": STEP, "nodes": nodes},
        "km_per_unit": round(abs(1 / sx) / 1000, 4),
        "ppi": ppi,
        "data_b64": base64.b64encode(bytes(data)).decode("ascii"),
    }
    (OUT / "vent.json").write_text(json.dumps(payload, separators=(",", ":")), "utf-8")
    ctx.log(f"  {len(frames)} images de {nx}×{ny}, {len(nodes)} nœuds source, pic {peak:.1f} m/s, "
            f"{len(data) // 1024} Ko")
    return len(frames)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true")
    p.add_argument("--cache", action="store_true")
    p.add_argument("--db", default=ROOT / "data" / "cartovi.sqlite", type=Path)
    args = p.parse_args(argv)
    con = db.connect(args.db)
    last = con.execute("SELECT MAX(finished_at) t FROM run WHERE source_id='flux' AND status='ok'").fetchone()["t"]
    today = datetime.date.today()
    try:
        version = json.loads((OUT / "vent.json").read_text("utf-8")).get("version")
    except (OSError, ValueError):
        version = None
    fresh = last and (today - datetime.date.fromisoformat(last[:10])).days < MAX_AGE_DAYS
    if not args.force and fresh and version == VERSION:
        print(f"flux à jour ({last[:10]}), rien à faire")
        return 0
    ctx = SimpleNamespace(http=Http(use_cache=args.cache), territories=territories.load(), log=print, today=today)
    started = db.now()
    try:
        n = build(ctx)
        db.log_run(con, "flux", started, "ok", n)
        code = 0
    except Exception as e:  # noqa: BLE001
        db.log_run(con, "flux", started, "error", 0, f"{type(e).__name__}: {e}")
        print(f"ERREUR : {type(e).__name__}: {e}")
        code = 1
    con.commit()
    con.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
