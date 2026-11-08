"""Vie locale par commune : ESS, coopératives, associations, mobilité sans voiture, écoles,
tiers-lieux, festivals.

    python -m pipeline.locale            # si la dernière génération a plus de MAX_AGE_DAYS
    python -m pipeline.locale --force

Sources (Licence Ouverte) :
- SIRENE (INSEE), fichiers stock mensuels : unités légales (appartenance au champ de l'ESS,
  catégorie juridique) et établissements (commune, état actif, caractère employeur). Les
  ~4 Go de fichiers zip sont lus en flux depuis le disque, sans être chargés en mémoire.
- Répertoire national des associations (RNA, ministère de l'Intérieur), fichier mensuel.
- Recensement de la population (INSEE, Melodi) : équipement automobile des ménages et
  mode de transport domicile-travail des actifs occupés, par commune.
- Annuaire de l'éducation (ministère de l'Éducation nationale) : collèges et lycées ouverts.
- Recensement des tiers-lieux 2026 (France Tiers-Lieux) et Panorama des festivals
  (ministère de la Culture, éditions 2018-2019 : la seule liste nationale ouverte).

Ce qui est compté, par commune :
- `ess` : établissements actifs d'une structure de l'ESS (associations employeuses ou
  immatriculées, coopératives, mutuelles, fondations, sociétés commerciales de l'ESS) ;
- `ess_emp` : les mêmes, quand l'établissement emploie des salariés (activité économique) ;
- `coop` : établissements actifs d'une coopérative (SCOP, SCIC, coopératives d'artisans,
  de consommateurs, agricoles…), d'après la catégorie juridique ;
- `assos` : associations actives ayant fait une déclaration (création ou modification)
  dans les ASSOS_YEARS dernières années — une vie associative récente, pas un stock
  d'associations dormantes ;
- `sans_voiture` : part des ménages sans voiture (%) ;
- `navette_douce` : part des actifs occupés qui vont travailler à pied, à vélo ou en
  transports en commun (%), une mesure observée de la vie sans voiture ;
- points (longitude, latitude) des collèges, lycées, tiers-lieux et festivals, comptés
  ensuite dans un rayon autour de chaque commune par pipeline.communes.

Ce sont des comptes de structures, pas une mesure de leur taille ni de leur ouverture : une
grande association nationale compte pour un établissement là où elle en a un. La page les
rapporte à la population.

Sortie : web/data/locale/communes.json, lue par la couche communale (pipeline.communes).
"""

import argparse
import csv
import datetime
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from types import SimpleNamespace

from . import datagouv, db
from .http import USER_AGENT, Http
from .util import norm_commune

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "locale" / "communes.json"
MAX_AGE_DAYS = 28
VERSION = 1
SIRENE = "base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret"
RNA = "repertoire-national-des-associations"
ASSOS_YEARS = 5
COLUMNS = ["ess", "ess_emp", "coop", "assos", "sans_voiture", "navette_douce"]
MELODI = "https://api.insee.fr/melodi/file/{ds}/{ds}_{year}_CSV_FR"
RP_YEARS = (2024, 2023, 2022)  # millésime le plus récent publié
EDUCATION = ("https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/exports/csv"
             "?select=type_etablissement,etat,code_commune,latitude,longitude&limit=-1")
TIERS_LIEUX = "6a97e79385c92876997291c8"  # Recensement des Tiers-Lieux en France - 2026
FESTIVALS = "5b51825fa3a72936dfe1c340"  # Panorama des festivals

# Catégories juridiques coopératives (nomenclature INSEE des catégories juridiques, niveau III,
# cj_septembre_2022.xls, libellés « coopérative ») : SCOP (5458, 5558, 5658), « autres » SARL et
# SA coopératives (5460, 5560, 5660 : SCIC, coopératives d'activité et d'emploi…), coopératives de
# consommateurs, d'artisans, de commerçants, de transport, maritimes, de construction et d'HLM,
# agricoles (CUMA comprises), unions de coopératives, sociétés civiles coopératives.
# Exclues : banques et caisses de crédit coopératives ou mutuelles (une agence dans chaque bourg ne
# dit rien de la coopération locale) et SICA (sociétés d'intérêt collectif agricole, pas des
# coopératives). Limite : une SCIC ou une SCOP constituée en SAS n'a pas de catégorie propre ; elle
# n'est comptée que dans `ess`.
COOP_CJ = {
    "5195", "5203", "5307", "5309",
    "5443", "5451", "5453", "5454", "5455", "5458", "5459", "5460",
    "5543", "5547", "5551", "5552", "5553", "5554", "5555", "5558", "5559", "5560",
    "5643", "5647", "5651", "5652", "5653", "5654", "5655", "5658", "5659", "5660",
    "6316", "6317", "6318",
    "6543", "6551", "6554", "6558", "6560",
}


def commune_of(code):
    """Code commune normalisé ; un arrondissement de Paris, Lyon ou Marseille (SIRENE et RNA les
    utilisent) est rattaché à sa commune, seule unité de la carte."""
    code = norm_commune(code)
    if not code:
        return None
    if code.startswith("751") and code != "75056":
        return "75056"
    if code.startswith("6938"):
        return "69123"
    if code.startswith("132") and code != "13055":
        return "13055"
    return code


def download(url, path, log=print, retries=3):
    """Téléchargement en flux vers un fichier (les stocks SIRENE ne tiennent pas en mémoire)."""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 22)
            return path
        except OSError as e:
            if attempt == retries:
                raise RuntimeError(f"échec du téléchargement {url} : {e}") from e
            log(f"    réessai dans {2 ** (attempt + 1)}s ({type(e).__name__})")
            time.sleep(2 ** (attempt + 1))


def _rows(zpath, delimiter=",", encoding="utf-8"):
    """Lignes du premier CSV d'une archive, lues en flux : (en-tête, itérateur)."""
    z = zipfile.ZipFile(zpath)
    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    f = io.TextIOWrapper(z.open(name), encoding=encoding, errors="replace", newline="")
    rd = csv.reader(f, delimiter=delimiter)
    head = [h.lstrip("﻿") for h in next(rd)]
    return head, rd


def ess_units(zpath, log=print):
    """{siren: est_coop} des unités légales actives de l'ESS ou coopératives."""
    head, rd = _rows(zpath)
    i_siren, i_ess, i_cj, i_etat = (head.index(c) for c in (
        "siren", "economieSocialeSolidaireUniteLegale", "categorieJuridiqueUniteLegale", "etatAdministratifUniteLegale"))
    units, n = {}, 0
    for r in rd:
        n += 1
        if r[i_etat] != "A":
            continue
        coop = r[i_cj] in COOP_CJ
        if r[i_ess] == "O" or coop:
            units[r[i_siren]] = coop, r[i_ess] == "O"
    log(f"  unités légales : {n} lues, {len(units)} actives de l'ESS ou coopératives "
        f"({sum(1 for c, _ in units.values() if c)} coopératives)")
    if not 300_000 < len(units) < 5_000_000:
        raise ValueError(f"nombre d'unités ESS invraisemblable : {len(units)}")
    return units


def ess_by_commune(zpath, units, log=print):
    """Établissements actifs par commune : {commune: [ess, ess_emp, coop]}."""
    head, rd = _rows(zpath)
    i_siren, i_com, i_etat, i_emp = (head.index(c) for c in (
        "siren", "codeCommuneEtablissement", "etatAdministratifEtablissement", "caractereEmployeurEtablissement"))
    out, n = {}, 0
    for r in rd:
        n += 1
        u = units.get(r[i_siren])
        if u is None or r[i_etat] != "A":
            continue
        com = commune_of(r[i_com])
        if not com:
            continue
        coop, ess = u
        c = out.setdefault(com, [0, 0, 0])
        if ess:
            c[0] += 1
            c[1] += r[i_emp] == "O"
        c[2] += coop
    log(f"  établissements : {n} lus ; {sum(v[0] for v in out.values())} actifs de l'ESS dans {len(out)} communes")
    return out


def assos_by_commune(zpath, today, log=print):
    """Associations actives ayant déposé une déclaration depuis ASSOS_YEARS ans, par commune."""
    since = (today - datetime.timedelta(days=round(365.25 * ASSOS_YEARS))).isoformat()
    z = zipfile.ZipFile(zpath)
    out, n, kept = {}, 0, 0
    for name in z.namelist():
        if not name.lower().endswith(".csv"):
            continue
        f = io.TextIOWrapper(z.open(name), encoding="utf-8", errors="replace", newline="")
        rd = csv.reader(f, delimiter=";")
        head = [h.lstrip("﻿").lstrip("ï»¿") for h in next(rd)]
        i_pos, i_com, i_crea, i_decl = (head.index(c) for c in ("position", "adrs_codeinsee", "date_creat", "date_decla"))
        for r in rd:
            n += 1
            if len(r) <= max(i_pos, i_com, i_crea, i_decl) or r[i_pos] != "A":
                continue
            if max(r[i_crea][:10], r[i_decl][:10]) < since:
                continue
            com = commune_of(r[i_com])
            if com:
                out[com] = out.get(com, 0) + 1
                kept += 1
    log(f"  associations : {n} lues, {kept} actives avec une déclaration depuis {since}")
    if not 100_000 < kept < 2_000_000:
        raise ValueError(f"nombre d'associations récentes invraisemblable : {kept}")
    return out


def _melodi(ctx, ds, workdir):
    """Fichier national d'un jeu Melodi (zip : données + métadonnées), millésime le plus récent."""
    for year in RP_YEARS:
        path = workdir / f"{ds}.zip"
        try:
            download(MELODI.format(ds=ds, year=year), path, ctx.log, retries=1)
            return path, year
        except RuntimeError:
            continue
    raise LookupError(f"{ds} : aucun millésime parmi {RP_YEARS}")


def _melodi_rows(path):
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.endswith("_data.csv"))
    f = io.TextIOWrapper(z.open(name), encoding="utf-8-sig", errors="replace", newline="")
    rd = csv.reader(f, delimiter=";")
    head = next(rd)
    return {h: i for i, h in enumerate(head)}, rd


def navettes(path, year, log=print):
    """Part des actifs occupés allant travailler à pied (2), à vélo (3) ou en transports en
    commun (6), sur le total (_T, qui compte aussi ceux qui ne se déplacent pas)."""
    col, rd = _melodi_rows(path)
    acc = {}
    for r in rd:
        if (r[col["GEO_OBJECT"]] != "COM" or r[col["TIME_PERIOD"]] != str(year) or r[col["WORK_AREA"]] != "_T"
                or r[col["AGE"]] != "Y_GE15" or r[col["EMPSTA_ENQ"]] != "1"):
            continue
        t = r[col["TRANS"]]
        if t in ("2", "3", "6", "_T"):
            d = acc.setdefault(r[col["GEO"]], {})
            d[t] = d.get(t, 0) + float(r[col["OBS_VALUE"]] or 0)
    out = {com: round(100 * (d.get("2", 0) + d.get("3", 0) + d.get("6", 0)) / d["_T"], 1)
           for com, d in acc.items() if d.get("_T")}
    log(f"  navettes {year} : {len(out)} communes")
    if len(out) < 30_000:
        raise ValueError(f"navettes : {len(out)} communes seulement")
    return out


def sans_voiture(path, year, log=print):
    """Part des résidences principales (ménages) sans voiture : CARS = C0 sur CARS = _T, toutes
    les autres ventilations au total."""
    col, rd = _melodi_rows(path)
    fixed = {"GEO", "GEO_OBJECT", "CARS", "OCS", "RP_MEASURE", "FREQ", "OBS_STATUS", "TIME_PERIOD", "OBS_VALUE",
             "UNIT_MULT", "UNIT_MEASURE"}
    others = [i for h, i in col.items() if h not in fixed]
    acc = {}
    for r in rd:
        if (r[col["GEO_OBJECT"]] != "COM" or r[col["TIME_PERIOD"]] != str(year) or r[col["RP_MEASURE"]] != "DWELLINGS"
                or r[col["OCS"]] != "DW_MAIN" or r[col["CARS"]] not in ("C0", "_T")):
            continue
        if any(r[i] != "_T" for i in others):
            continue
        acc.setdefault(r[col["GEO"]], {})[r[col["CARS"]]] = float(r[col["OBS_VALUE"]] or 0)
    out = {com: round(100 * d["C0"] / d["_T"], 1) for com, d in acc.items() if d.get("_T") and "C0" in d}
    log(f"  ménages sans voiture {year} : {len(out)} communes")
    if len(out) < 30_000:
        raise ValueError(f"ménages sans voiture : {len(out)} communes seulement")
    return out


def _num(x):
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return None


def education(ctx):
    """Points des collèges et lycées ouverts : {"college": [[lon, lat], …], "lycee": […]}."""
    text = ctx.http.get(EDUCATION, timeout=300).decode("utf-8-sig", "replace")
    out = {"college": [], "lycee": []}
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if (r.get("etat") or "").upper() != "OUVERT":
            continue
        t = (r.get("type_etablissement") or "").lower()
        key = "college" if t.startswith("coll") else "lycee" if t.startswith("lyc") else None
        lon, lat = _num(r.get("longitude")), _num(r.get("latitude"))
        if key and lon is not None and lat is not None:
            out[key].append([round(lon, 5), round(lat, 5)])
    ctx.log(f"  éducation : {len(out['college'])} collèges, {len(out['lycee'])} lycées ouverts")
    if len(out["college"]) < 5_000 or len(out["lycee"]) < 2_500:
        raise ValueError(f"annuaire de l'éducation incomplet : {len(out['college'])} / {len(out['lycee'])}")
    return out


def tiers_lieux(ctx):
    """Tiers-lieux recensés en 2026, hors lieux itinérants : [[lon, lat], …]."""
    res = datagouv.resource(ctx.http, TIERS_LIEUX, url_pattern=r"fiche-identite\.csv$")
    text = ctx.http.get(res["url"], timeout=300).decode("utf-8-sig", "replace")
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if "itin" in (r.get("état du projet") or "").lower():
            continue
        lon, lat = _num(r.get("LONGITUDE")), _num(r.get("LATITUDE"))
        if lon is not None and lat is not None and -6 < lon < 10 and 41 < lat < 52:
            out.append([round(lon, 5), round(lat, 5)])
    ctx.log(f"  tiers-lieux : {len(out)} en métropole")
    if len(out) < 2_000:
        raise ValueError(f"tiers-lieux : {len(out)} seulement")
    return out


def festivals(ctx):
    """Festivals du Panorama (position de leur commune principale) : [[lon, lat], …]."""
    res = datagouv.resource(ctx.http, FESTIVALS, fmt="csv")
    text = ctx.http.get(res["url"], timeout=300).decode("utf-8-sig", "replace")
    out = []
    head = text[:3000].splitlines()[0]
    for r in csv.DictReader(io.StringIO(text), delimiter=";" if head.count(";") > head.count(",") else ","):
        parts = (r.get("coordonnees_insee") or "").split(",")
        if len(parts) == 2:
            lat, lon = _num(parts[0]), _num(parts[1])
            if lon is not None and lat is not None and -6 < lon < 10 and 41 < lat < 52:
                out.append([round(lon, 5), round(lat, 5)])
    ctx.log(f"  festivals : {len(out)} en métropole")
    if len(out) < 2_000:
        raise ValueError(f"festivals : {len(out)} seulement")
    return out


def build(ctx, workdir):
    sir = datagouv.dataset(ctx.http, SIRENE)["resources"]
    pick = lambda prefix: max((r for r in sir if r["title"].startswith(prefix) and (r.get("format") or "").lower() == "zip"),
                              key=lambda r: r.get("last_modified") or "")
    ul, et = pick("Sirene : Fichier StockUniteLegale"), pick("Sirene : Fichier StockEtablissement -")
    rna = max((r for r in datagouv.dataset(ctx.http, RNA)["resources"] if re.search(r"rna_waldec_\d{8}\.zip$", r["url"])),
              key=lambda r: r["url"])
    sources = {"sirene_ul": ul["title"], "sirene_etab": et["title"], "rna": rna["title"]}
    for key, r in (("ul", ul), ("et", et), ("rna", rna)):
        t0 = time.time()
        download(r["url"], workdir / f"{key}.zip", ctx.log)
        ctx.log(f"  {r['title']} : {os.path.getsize(workdir / f'{key}.zip') / 1e6:.0f} Mo en {time.time() - t0:.0f}s")
    units = ess_units(workdir / "ul.zip", ctx.log)
    (workdir / "ul.zip").unlink()
    ess = ess_by_commune(workdir / "et.zip", units, ctx.log)
    del units
    (workdir / "et.zip").unlink()
    assos = assos_by_commune(workdir / "rna.zip", ctx.today, ctx.log)
    (workdir / "rna.zip").unlink()
    nav_path, nav_year = _melodi(ctx, "DS_RP_NAVETTES_PRINC", workdir)
    douce = navettes(nav_path, nav_year, ctx.log)
    log_path, log_year = _melodi(ctx, "DS_RP_LOGEMENT_PRINC", workdir)
    sv = sans_voiture(log_path, log_year, ctx.log)
    sources.update(recensement=f"RP {log_year} (INSEE, Melodi)", education="Annuaire de l'éducation",
                   tiers_lieux="Recensement des tiers-lieux 2026 (France Tiers-Lieux)",
                   festivals="Panorama des festivals (ministère de la Culture)")
    points = {**education(ctx), "tiers_lieux": tiers_lieux(ctx), "festivals": festivals(ctx)}
    codes = sorted(set(ess) | set(assos) | set(douce) | set(sv))
    rows = {c: [*ess.get(c, [0, 0, 0]), assos.get(c, 0), sv.get(c), douce.get(c)] for c in codes}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "version": VERSION,
        "generated_at": db.now(),
        "sources": sources,
        "assos_years": ASSOS_YEARS,
        "columns": COLUMNS,
        "rows": rows,
        "points": points,
    }, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return len(rows)


def load():
    """{commune: {colonne: valeur}} depuis la dernière génération, ou {} si absente."""
    try:
        d = json.loads(OUT.read_text("utf-8"))
    except (OSError, ValueError):
        return {}, None
    cols = d.get("columns", COLUMNS)
    return {c: dict(zip(cols, v)) for c, v in d.get("rows", {}).items()}, d


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true")
    p.add_argument("--db", default=ROOT / "data" / "carteplan.sqlite", type=Path)
    args = p.parse_args(argv)
    today = datetime.date.today()
    try:
        old = json.loads(OUT.read_text("utf-8"))
        fresh = old.get("version") == VERSION and (today - datetime.date.fromisoformat(old["generated_at"][:10])).days < MAX_AGE_DAYS
    except (OSError, ValueError, KeyError):
        fresh = False
    if fresh and not args.force:
        print(f"vie locale à jour ({old['generated_at'][:10]}), rien à faire")
        return 0
    if not COOP_CJ:
        print("ERREUR : liste des catégories juridiques coopératives vide")
        return 1
    ctx = SimpleNamespace(http=Http(), log=print, today=today)
    con = db.connect(args.db)
    started = db.now()
    with tempfile.TemporaryDirectory(prefix="carteplan-locale-") as tmp:
        try:
            n = build(ctx, Path(tmp))
            db.log_run(con, "locale", started, "ok", n)
            print(f"{n} communes → {OUT}")
            code = 0
        except Exception as e:  # noqa: BLE001
            db.log_run(con, "locale", started, "error", 0, f"{type(e).__name__}: {e}")
            print(f"ERREUR : {type(e).__name__}: {e}")
            code = 1
    con.commit()
    con.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
