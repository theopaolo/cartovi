"""Vie locale par commune : économie sociale et solidaire, coopératives, associations.

    python -m pipeline.locale            # si la dernière génération a plus de MAX_AGE_DAYS
    python -m pipeline.locale --force

Sources (Licence Ouverte) :
- SIRENE (INSEE), fichiers stock mensuels : unités légales (appartenance au champ de l'ESS,
  catégorie juridique) et établissements (commune, état actif, caractère employeur). Les
  ~4 Go de fichiers zip sont lus en flux depuis le disque, sans être chargés en mémoire.
- Répertoire national des associations (RNA, ministère de l'Intérieur), fichier mensuel.

Ce qui est compté, par commune :
- `ess` : établissements actifs d'une structure de l'ESS (associations employeuses ou
  immatriculées, coopératives, mutuelles, fondations, sociétés commerciales de l'ESS) ;
- `ess_emp` : les mêmes, quand l'établissement emploie des salariés (activité économique) ;
- `coop` : établissements actifs d'une coopérative (SCOP, SCIC, coopératives d'artisans,
  de consommateurs, agricoles…), d'après la catégorie juridique ;
- `assos` : associations actives ayant fait une déclaration (création ou modification)
  dans les ASSOS_YEARS dernières années — une vie associative récente, pas un stock
  d'associations dormantes.

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
COLUMNS = ["ess", "ess_emp", "coop", "assos"]

# Catégories juridiques coopératives (nomenclature INSEE des catégories juridiques, niveau III,
# libellés contenant « coopérative » ; SCIC et SCOP comprises). Voir cj_septembre_2022.xls.
COOP_CJ = set()


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
        com = norm_commune(r[i_com])
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
            com = norm_commune(r[i_com])
            if com:
                out[com] = out.get(com, 0) + 1
                kept += 1
    log(f"  associations : {n} lues, {kept} actives avec une déclaration depuis {since}")
    if not 100_000 < kept < 2_000_000:
        raise ValueError(f"nombre d'associations récentes invraisemblable : {kept}")
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
    codes = sorted(set(ess) | set(assos))
    rows = {c: [*ess.get(c, [0, 0, 0]), assos.get(c, 0)] for c in codes}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "version": VERSION,
        "generated_at": db.now(),
        "sources": sources,
        "assos_years": ASSOS_YEARS,
        "columns": COLUMNS,
        "rows": rows,
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
