"""Couche communale : desserte ferroviaire, climat politique, offre culturelle, prix.

    python -m pipeline.communes            # si la dernière génération a plus de MAX_AGE_DAYS
    python -m pipeline.communes --force

Produit web/data/communes/<code région>.json (un fichier par région, chargé à la
demande par la page « Communes »). Les critères ne sont pas agrégés en score :
la page les expose comme des filtres, à régler selon ce que l'on cherche.

Sources :
- horaires SNCF (GTFS national, TER + Intercités + TGV), via transport.data.gouv.fr ;
- résultats des européennes 2024 par commune (ministère de l'Intérieur) ;
- base Basilic des lieux et équipements culturels (ministère de la Culture) ;
- statistiques DVF par commune (Etalab) ; communes et populations (geo.api.gouv.fr).
"""

import argparse
import csv
import datetime
import io
import json
import math
import sys
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

from . import datagouv, db, geo, territories
from .http import Http
from .util import communes as fetch_communes
from .util import dep_of_commune, norm_commune

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "communes"
MAX_AGE_DAYS = 28
VERSION = 2  # 2 : coût d'accès à la gare, prix agrégés pour Paris, Lyon, Marseille
ACCESS_MIN_PER_KM = 3  # pour départager deux gares : ~vélo ou voiture en ville

GTFS = "https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942"
EUROPEENNES = "resultats-des-elections-europeennes-du-9-juin-2024"
BASILIC = "base-des-lieux-et-equipements-culturels-basilic"

HUB_MIN_POP = 50_000  # villes de référence : communes d'au moins 50 000 habitants…
HUB_MIN_GAP_KM = 15  # … distantes d'au moins 15 km (Villeurbanne se confond avec Lyon)
HUB_RADIUS_KM = 5  # gares comptées comme « arrivée en ville »
STATION_RADIUS_KM = 6  # gares accessibles depuis le centre d'une commune
MAX_TRAIN_MIN = 150  # au-delà, le temps de trajet n'est pas conservé
VOTE_RADIUS_KM = 10
CULTURE_RADIUS_KM = 15

# Nuances ministérielles des listes de gauche aux européennes 2024.
LEFT = {"LEXG", "LCOM", "LFI", "LSOC", "LUG", "LVEC", "LDVG"}

SCENES = {"Théâtre", "Scène", "Opéra", "Centre de création artistique", "Centre de création musicale"}
LABELS = (
    "Scène nationale",
    "Scène conventionnée",
    "Scène de musiques actuelles",
    "Centre dramatique national",
    "Centre chorégraphique national",
    "Centre de développement chorégraphique",
    "Pôle national du cirque",
    "Centre national des arts de la rue",
    "Centre d’art contemporain d’intérêt national",
    "Fonds régional d'art contemporain",
    "Opéra national",
    "Orchestre national",
    "Théâtre national",
    "Théâtre lyrique",
    "Centre national de création musicale",
    "Centre national de la marionnette",
)
CULTURE = ("cinemas", "scenes", "labels", "musees", "librairies", "conservatoires")
ARRONDISSEMENTS = {"751": "75056", "6938": "69123", "132": "13055"}
REGION_CODE = {d: code for code, (_, deps) in territories.REGIONS.items() for d in deps.split()}


# --- index spatial minimal : grille de cellules carrées en Lambert-93 ------------------------


class Grid:
    def __init__(self, cell_km):
        self.cell = cell_km * 1000
        self.cells = {}

    def add(self, x, y, item):
        self.cells.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, item))

    def near(self, x, y, radius_km):
        r = radius_km * 1000
        n = int(r // self.cell) + 1
        i, j = int(x // self.cell), int(y // self.cell)
        for di in range(-n, n + 1):
            for dj in range(-n, n + 1):
                for px, py, item in self.cells.get((i + di, j + dj), ()):
                    d = math.hypot(px - x, py - y)
                    if d <= r:
                        yield d / 1000, item


# --- trains -------------------------------------------------------------------------------------


def _seconds(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _rows(zf, name):
    with zf.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def _reference_day(zf, today):
    """Mardi ou jeudi des 5 prochaines semaines où circulent le plus de services :
    évite les jours fériés et les week-ends de travaux."""
    count = {}
    lo, hi = (today + datetime.timedelta(days=d) for d in (7, 42))
    for r in _rows(zf, "calendar_dates.txt"):
        if r["exception_type"] == "1":
            d = datetime.date(int(r["date"][:4]), int(r["date"][4:6]), int(r["date"][6:]))
            if lo <= d <= hi and d.weekday() in (1, 3):
                count[r["date"]] = count.get(r["date"], 0) + 1
    if not count:
        raise ValueError("aucun mardi ou jeudi dans la période couverte par le GTFS")
    return max(count, key=count.get)


def trains(ctx, hubs):
    """Pour chaque gare : nombre de trains au départ et, pour chaque ville de
    référence, le trajet direct le plus court et le nombre de trains directs."""
    zf = zipfile.ZipFile(io.BytesIO(ctx.http.get(GTFS, timeout=600)))
    day = _reference_day(zf, ctx.today)
    services = {r["service_id"] for r in _rows(zf, "calendar_dates.txt") if r["date"] == day and r["exception_type"] == "1"}
    rail = {r["route_id"] for r in _rows(zf, "routes.txt") if r["route_type"] == "2"}
    trips = {r["trip_id"] for r in _rows(zf, "trips.txt") if r["service_id"] in services and r["route_id"] in rail}

    stations, parent = {}, {}
    for r in _rows(zf, "stops.txt"):
        if r["location_type"] == "1":
            stations[r["stop_id"]] = {"name": r["stop_name"], "lon": float(r["stop_lon"]), "lat": float(r["stop_lat"])}
        else:
            parent[r["stop_id"]] = r["parent_station"] or r["stop_id"]

    hub_of = {}  # gare -> index de la ville de référence qu'elle dessert
    for sid, s in stations.items():
        for k, h in enumerate(hubs):
            if geo.haversine_km(s["lon"], s["lat"], h["lon"], h["lat"]) <= HUB_RADIUS_KM:
                hub_of[sid] = k

    by_trip = {}
    for r in _rows(zf, "stop_times.txt"):
        if r["trip_id"] in trips:
            by_trip.setdefault(r["trip_id"], []).append(
                (
                    int(r["stop_sequence"]),
                    parent.get(r["stop_id"], r["stop_id"]),
                    _seconds(r["arrival_time"]),
                    _seconds(r["departure_time"]),
                    r.get("pickup_type") != "1",
                    r.get("drop_off_type") != "1",
                )
            )

    departures, best, count = {}, {}, {}
    for stops in by_trip.values():
        stops.sort()
        for i, (_, sid, _, dep, board, _) in enumerate(stops):
            if not board:
                continue
            departures[sid] = departures.get(sid, 0) + 1
            reached = set()
            for _, tid, arr, _, _, alight in stops[i + 1 :]:
                k = hub_of.get(tid)
                if k is None or k in reached or not alight or hub_of.get(sid) == k:
                    continue
                reached.add(k)
                minutes = (arr - dep) / 60
                if minutes <= MAX_TRAIN_MIN:
                    key = (sid, k)
                    best[key] = min(best.get(key, 1e9), minutes)
                    count[key] = count.get(key, 0) + 1
    for sid, k in hub_of.items():  # gare située dans la ville de référence elle-même
        if sid in departures:
            best[(sid, k)], count[(sid, k)] = 0, departures[sid]
    ctx.log(f"  GTFS du {day} : {len(by_trip)} trains, {len(departures)} gares desservies")
    if len(by_trip) < 3000 or len(departures) < 1500:
        raise ValueError("GTFS invraisemblablement maigre")
    served = {sid: {**stations[sid], "departures": n} for sid, n in departures.items() if sid in stations}
    return served, best, count, day


# --- élections ----------------------------------------------------------------------------------


def votes(ctx):
    """Voix de gauche et exprimés par commune (européennes 2024)."""
    res = datagouv.resource(ctx.http, EUROPEENNES, title="resultats-definitifs-par-commune.csv")
    text = ctx.http.get(res["url"], timeout=600).decode("utf-8-sig")
    rows = csv.reader(io.StringIO(text), delimiter=";")
    head = next(rows)
    col = {h: i for i, h in enumerate(head)}
    lists = sorted(int(h.rsplit(" ", 1)[1]) for h in head if h.startswith("Nuance liste "))
    out = {}
    left_total = expr_total = 0
    for r in rows:
        if len(r) <= col["Exprimés"]:
            continue
        code = norm_commune(r[col["Code commune"]])
        if not code:
            continue
        expr = int(r[col["Exprimés"]] or 0)
        left = sum(
            int(r[col[f"Voix {n}"]] or 0)
            for n in lists
            if col[f"Voix {n}"] < len(r) and r[col[f"Nuance liste {n}"]] in LEFT
        )
        out[code] = (left, expr)
        left_total += left
        expr_total += expr
    share = 100 * left_total / max(expr_total, 1)
    ctx.log(f"  européennes 2024 : {len(out)} communes, gauche {share:.1f} % des exprimés")
    if not 25 < share < 40 or len(out) < 30_000:  # ~32 % au niveau national
        raise ValueError(f"résultats invraisemblables : {len(out)} communes, gauche {share:.1f} %")
    return out


# --- culture -------------------------------------------------------------------------------------


def venues(ctx):
    res = datagouv.resource(ctx.http, BASILIC, fmt="csv")
    text = ctx.http.get(res["url"], timeout=600).decode("utf-8-sig")
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if (r.get("Demographie_AP") or "Actif") != "Actif":
            continue
        try:
            lat, lon = float(r["Latitude"]), float(r["Longitude"])
        except (TypeError, ValueError):
            continue
        kind = r.get("Type équipement ou lieu") or ""
        label = r.get("Label et appellation") or ""
        cats = []
        if kind == "Cinéma":
            cats.append("cinemas")
        if kind in SCENES:
            cats.append("scenes")
        if any(lbl in label for lbl in LABELS):
            cats.append("labels")
        if kind == "Musée":
            cats.append("musees")
        if kind == "Librairie":
            cats.append("librairies")
        if kind == "Conservatoire":
            cats.append("conservatoires")
        if cats:
            out.append((lon, lat, cats))
    ctx.log(f"  Basilic : {len(out)} lieux retenus")
    if len(out) < 5000:
        raise ValueError(f"trop peu de lieux culturels : {len(out)}")
    return out


# --- prix ----------------------------------------------------------------------------------------


def prices(ctx):
    res = datagouv.resource(ctx.http, "statistiques-dvf", title="Statistiques totales DVF")
    out = {}
    plm = {}  # Paris, Lyon, Marseille : publiés par arrondissement
    for r in ctx.http.csv(res["url"], timeout=300):
        if r.get("echelle_geo") == "commune":
            med, n = r.get("med_prix_m2_whole_maison"), r.get("nb_ventes_whole_maison")
            if med and n and float(n) >= 10:
                code = norm_commune(r["code_geo"])
                out[code] = round(float(med))
                city = ARRONDISSEMENTS.get(code[:3] if code.startswith(("751", "132")) else code[:4])
                if city:
                    plm.setdefault(city, []).append((float(n), float(med)))
    for city, parts in plm.items():
        # moyenne des médianes d'arrondissement pondérée par les ventes : approximation
        out[city] = round(sum(n * m for n, m in parts) / sum(n for n, _ in parts))
    ctx.log(f"  DVF : prix des maisons pour {len(out)} communes")
    return out


# --- assemblage ----------------------------------------------------------------------------------


def build(ctx):
    terrs = ctx.territories
    tr, height = territories.svg_transform(terrs)
    coms = []
    for c in fetch_communes(ctx):
        dep = dep_of_commune(c.get("code"))
        if dep in terrs and c.get("centre"):
            lon, lat = c["centre"]["coordinates"]
            x, y = geo.lambert93(lon, lat)
            coms.append(SimpleNamespace(code=c["code"], name=c.get("nom", ""), dep=dep,
                                        pop=c.get("population") or 0, lon=lon, lat=lat, x=x, y=y))
    ctx.log(f"  {len(coms)} communes")

    hubs = []
    for c in sorted(coms, key=lambda c: -c.pop):
        if c.pop < HUB_MIN_POP:
            break
        if all(geo.haversine_km(c.lon, c.lat, h["lon"], h["lat"]) >= HUB_MIN_GAP_KM for h in hubs):
            hubs.append({"code": c.code, "name": c.name, "lon": c.lon, "lat": c.lat, "pop": c.pop})
    ctx.log(f"  {len(hubs)} villes de référence")

    stations, best, count, day = trains(ctx, hubs)
    vote = votes(ctx)
    culture = venues(ctx)
    price = prices(ctx)

    by_station = {}
    for (sid, k), minutes in best.items():
        by_station.setdefault(sid, []).append((k, minutes, count[(sid, k)]))

    grid_st, grid_vote, grid_cult = Grid(STATION_RADIUS_KM), Grid(VOTE_RADIUS_KM), Grid(CULTURE_RADIUS_KM)
    for sid, s in stations.items():
        grid_st.add(*geo.lambert93(s["lon"], s["lat"]), sid)
    for c in coms:
        if c.code in vote:
            grid_vote.add(c.x, c.y, vote[c.code])
    for lon, lat, cats in culture:
        grid_cult.add(*geo.lambert93(lon, lat), cats)

    columns = ["code", "nom", "dep", "pop", "x", "y", "prix", "gauche_commune", "gauche_10km", *CULTURE,
               "gare", "gare_km", "trains_jour", "villes"]
    by_region = {}
    for c in coms:
        lv, ev = vote.get(c.code, (0, 0))
        nl = ne = 0
        for _, (l_, e_) in grid_vote.near(c.x, c.y, VOTE_RADIUS_KM):
            nl, ne = nl + l_, ne + e_
        cult = dict.fromkeys(CULTURE, 0)
        for _, cats in grid_cult.near(c.x, c.y, CULTURE_RADIUS_KM):
            for k in cats:
                cult[k] += 1
        near = sorted(grid_st.near(c.x, c.y, STATION_RADIUS_KM))
        reach = {}
        cost = {}
        for km, sid in near:
            for k, minutes, n in by_station.get(sid, ()):
                # la gare voisine plus rapide ne l'emporte que si elle compense le trajet pour s'y rendre
                c_ = minutes + ACCESS_MIN_PER_KM * km
                if k not in cost or c_ < cost[k]:
                    cost[k], reach[k] = c_, (round(minutes), n, round(km, 1))
        g = near[0] if near else None
        sx, sy = tr(c.x, c.y)
        row = [
            c.code, c.name, c.dep, c.pop, round(sx, 1), round(sy, 1), price.get(c.code),
            round(100 * lv / ev, 1) if ev else None, round(100 * nl / ne, 1) if ne else None,
            *(cult[k] for k in CULTURE),
            stations[g[1]]["name"] if g else None, round(g[0], 1) if g else None,
            stations[g[1]]["departures"] if g else None,
            {str(k): list(v) for k, v in sorted(reach.items())},
        ]
        by_region.setdefault(REGION_CODE[c.dep], []).append(row)

    meta = {
        "version": VERSION,
        "generated_at": db.now(),
        "reference_day": f"{day[:4]}-{day[4:6]}-{day[6:]}",
        "viewBox": f"0 0 1000 {height:.0f}",
        "radius_km": {"gare": STATION_RADIUS_KM, "vote": VOTE_RADIUS_KM, "culture": CULTURE_RADIUS_KM},
        "hubs": [{**h, "x": round(tr(*geo.lambert93(h["lon"], h["lat"]))[0], 1),
                  "y": round(tr(*geo.lambert93(h["lon"], h["lat"]))[1], 1)} for h in hubs],
        "columns": columns,
        "regions": [],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for code, rows in sorted(by_region.items()):
        name = territories.REGIONS[code][0]
        meta["regions"].append({"code": code, "name": name, "file": f"{code}.json", "communes": len(rows)})
        (OUT / f"{code}.json").write_text(json.dumps({"rows": rows}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "index.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return sum(len(r) for r in by_region.values())


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true")
    p.add_argument("--cache", action="store_true")
    p.add_argument("--db", default=ROOT / "data" / "cartovi.sqlite", type=Path)
    args = p.parse_args(argv)
    con = db.connect(args.db)
    last = con.execute("SELECT MAX(finished_at) t FROM run WHERE source_id='communes' AND status='ok'").fetchone()["t"]
    today = datetime.date.today()
    try:
        version = json.loads((OUT / "index.json").read_text("utf-8")).get("version")
    except (OSError, ValueError):
        version = None
    fresh = last and (today - datetime.date.fromisoformat(last[:10])).days < MAX_AGE_DAYS
    if not args.force and fresh and version == VERSION:
        print(f"couche communale à jour ({last[:10]}), rien à faire")
        return 0
    ctx = SimpleNamespace(http=Http(use_cache=args.cache), territories=territories.load(), log=print,
                          today=today, memo={})
    started, t0 = db.now(), time.time()
    try:
        n = build(ctx)
        db.log_run(con, "communes", started, "ok", n)
        print(f"{n} communes exportées en {time.time() - t0:.0f}s → {OUT}")
        code = 0
    except Exception as e:  # noqa: BLE001
        db.log_run(con, "communes", started, "error", 0, f"{type(e).__name__}: {e}")
        print(f"ERREUR : {type(e).__name__}: {e}")
        code = 1
    con.commit()
    con.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
