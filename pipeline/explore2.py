"""Débits futurs des rivières par commune — Explore2 au format TRACC (données de test).

    python -m pipeline.explore2            # si les fichiers publiés ont changé
    python -m pipeline.explore2 --force

Le projet Explore2 (INRAE, 2025) simule l'hydrologie future de la France ; le réseau des
agences régionales de l'environnement (RARE) en a tiré des tables par commune, aux
niveaux de réchauffement de la TRACC, publiées sur data.gouv.fr en Licence Ouverte.
Pour chaque commune et chaque niveau : écart à 1976–2005 (en % pour les débits, en jours
pour les durées), résumé sur l'ensemble des simulations (q05, médiane, q95 retenus ici).

Statut : les fichiers ont été déposés (février 2026) sous une adresse marquée
« attention-test » ; la page du jeu a été renommée depuis sans cette mention, mais les
fichiers n'ont pas été republiés et portent encore des erreurs d'étiquetage. Ces valeurs
sont donc affichées dans la fiche d'une commune, avec cette réserve, et n'entrent dans
aucun score.

Sortie : web/data/eau/explore2/index.json (métadonnées) et un fichier par département
(<dep>.json), chargé par la fiche à la demande. La collecte hebdomadaire ne fait qu'un
appel à l'API data.gouv : les ~700 Mo de CSV ne sont retéléchargés que si les adresses
des fichiers changent (republication) ou si VERSION change.
"""

import argparse
import csv
import datetime
import io
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from . import datagouv, db
from .http import Http
from .util import dep_of_commune

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "eau" / "explore2"
VERSION = 1
DATASET = "69848339e734f1ba1e7f3217"  # « Indicateurs de débits futurs Explore2 TRACC agrégés par territoire »
TEST_MARK = "attention-test"

# (fragment du titre de la ressource, code dans le fichier, clé, libellé, unité, définition)
INDICATORS = [
    ("debit_etiage_VCN10", "VCN10_été", "etiage", "Débit d'étiage d'été", "%",
     "Plus bas débit moyen sur 10 jours consécutifs de mai à novembre : jusqu'où les rivières descendent."),
    ("duree_etiages_dtBE", "dtBE_été", "duree_etiage", "Durée des basses eaux d'été", "jours",
     "Nombre de jours de basses eaux de mai à novembre."),
    ("debit_moyen_annuel_QA", "QA_yr", "module", "Débit moyen annuel", "%",
     "Moyenne annuelle du débit journalier : la ressource en eau de surface sur l'année."),
    ("debit_crue_QJXA", "QJXA_yr", "crue", "Débit de crue", "%",
     "Débit journalier le plus fort de l'année."),
    ("duree_crues_dtCrues", "dtCrue_yr", "duree_crue", "Durée des crues", "jours",
     "Nombre de jours de crue dans l'année."),
]
REF = "1976-2005"
LEVELS = [("+2°C France", "GWL15", "+2 °C", "≈ 2030"), ("+2.7°C France", "GWL20", "+2,7 °C", "≈ 2050"),
          ("+4°C France", "GWL30", "+4 °C", "≈ 2100")]
STATS = ("q05", "q50", "q95")
PROVENANCE = {
    "Oui (bassin versant du territoire)": 0,
    "Non (bassin versant proche)": 1,
    "Non (bassin versant éloigné)": 2,
}
PROVENANCE_TEXT = [
    "points de simulation du bassin versant de la commune",
    "aucun point dans la commune : bassin versant proche",
    "aucun point dans la commune ni à proximité : bassin versant éloigné",
]
MIN_COMMUNES = 30_000  # ~34 400 en février 2026


def resources(http):
    """Le jeu et ses cinq fichiers communaux « statistiques multimodèles, agrégation spatiale »."""
    ds = datagouv.dataset(http, DATASET)
    found = {}
    for key_frag, *_ in INDICATORS:
        cands = [r for r in ds["resources"]
                 if r["title"].startswith("STATISTIQUES_MULTIMODELES_agregation_spatiale_OUI_territoire_COMMUNE_")
                 and key_frag in r["title"]]
        if not cands:
            raise LookupError(f"fichier communal {key_frag} introuvable dans le jeu {DATASET}")
        found[key_frag] = max(cands, key=lambda r: r.get("last_modified") or "")
    return ds, found


def parse(text, code_ind):
    """{commune: (provenance, {niveau: {stat: valeur}})} pour un fichier ; contrôles de cohérence."""
    rows = csv.DictReader(io.StringIO(text))
    out, ref_nonzero, n = {}, 0, 0
    levels = {lv for lv, *_ in LEVELS}
    for r in rows:
        n += 1
        if r["code_indicateur"] != code_ind or r["type_territoire"] != "commune":
            raise ValueError(f"ligne inattendue : {r['code_indicateur']} / {r['type_territoire']}")
        stat, level = r["statistique"], r["rechauffement_france"]
        v = float(r["resultat"]) or 0.0  # « -0 » -> 0
        if level == REF:
            ref_nonzero += v != 0
            continue
        if level not in levels:
            raise ValueError(f"niveau inconnu : {level!r}")
        if stat not in STATS:
            continue  # min et max : extrêmes d'une seule simulation, non affichés
        prov = PROVENANCE.get(r["donnees_issues_territoire"])
        if prov is None:
            raise ValueError(f"provenance inconnue : {r['donnees_issues_territoire']!r}")
        code = r["code_territoire"].strip().zfill(5)
        p, vals = out.setdefault(code, (prov, {}))
        vals.setdefault(level, {})[stat] = v
    # la référence vaut 0 par construction (écart à 1976–2005) : sinon le fichier ne dit pas ce qu'on croit
    if ref_nonzero:
        raise ValueError(f"{code_ind} : {ref_nonzero} valeurs non nulles à la référence")
    disorder = sum(1 for _, vals in out.values() for s in vals.values()
                   if len(s) == 3 and not s["q05"] <= s["q50"] <= s["q95"])
    if disorder > 0.005 * max(1, len(out) * len(LEVELS)):
        raise ValueError(f"{code_ind} : {disorder} intervalles q05 ≤ q50 ≤ q95 non respectés")
    if len(out) < MIN_COMMUNES:
        raise ValueError(f"{code_ind} : {len(out)} communes seulement")
    return out, n, disorder


def _num(v):
    if v is None:
        return None
    return int(v) if float(v).is_integer() else round(v, 1)


def build(ctx, force=False):
    ds, found = resources(ctx.http)
    urls = {k: r["url"] for k, r in found.items()}
    try:
        old = json.loads((OUT / "index.json").read_text("utf-8"))
    except (OSError, ValueError):
        old = {}
    if not force and old.get("version") == VERSION and old.get("urls") == urls:
        ctx.log("  fichiers Explore2 inchangés depuis la dernière génération : rien à faire")
        return None
    per_ind = {}
    for key_frag, code_ind, key, *_ in INDICATORS:
        r = found[key_frag]
        t0 = time.time()
        text = ctx.http.get(r["url"], timeout=900).decode("utf-8-sig")
        per_ind[key], n, disorder = parse(text, code_ind)
        del text
        ctx.log(f"  {key} : {len(per_ind[key])} communes, {n} lignes, {disorder} intervalles désordonnés, "
                f"{time.time() - t0:.0f}s")
    codes = sorted(set().union(*per_ind.values()))
    by_dep, mixed = {}, 0
    for code in codes:
        provs = {per_ind[k][code][0] for k in per_ind if code in per_ind[k]}
        mixed += len(provs) > 1
        flat = []
        for _, _, key, *_ in INDICATORS:
            vals = per_ind[key].get(code, (None, {}))[1]
            for lv, *_ in LEVELS:
                s = vals.get(lv, {})
                flat.extend(_num(s.get(st)) for st in STATS)
        by_dep.setdefault(dep_of_commune(code), {})[code] = [max(provs), *flat]
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"):
        if f.name != "index.json" and f.stem not in by_dep:
            f.unlink()
    for dep, rows in by_dep.items():
        (OUT / f"{dep}.json").write_text(json.dumps({"c": rows}, separators=(",", ":")), "utf-8")
    sample = next((r for r in found.values() if TEST_MARK in r["url"]), next(iter(found.values())))
    meta = {
        "version": VERSION,
        "generated_at": db.now(),
        "urls": urls,
        "dataset": {
            "title": ds["title"],
            "page": ds.get("page"),
            "organization": (ds.get("organization") or {}).get("name"),
            "licence": "Licence Ouverte 2.0" if ds.get("license") in ("lov2", "fr-lo") else ds.get("license"),
            "last_modified": (ds.get("last_modified") or "")[:10],
            "files_published": sorted({(r.get("last_modified") or "")[:10] for r in found.values()}),
            "sample_file": sample["url"],
            "sample_size": sample.get("filesize"),
        },
        # statut constaté, pas déclaré par une API : à revoir si les fichiers sont republiés
        "test": {
            "marked": any(TEST_MARK in r["url"] for r in found.values()),
            "page_marked": TEST_MARK in (ds.get("slug") or "") or "test" in (ds.get("title") or "").lower(),
        },
        "indicators": [{"key": k, "code": c, "label": lab, "unit": u, "definition": d}
                       for _, c, k, lab, u, d in INDICATORS],
        "levels": [{"id": i, "label": lab, "horizon": hz} for _, i, lab, hz in LEVELS],
        "stats": list(STATS),
        "provenance": PROVENANCE_TEXT,
        "communes": len(codes),
        "deps": sorted(by_dep),
    }
    (OUT / "index.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), "utf-8")
    ctx.log(f"  {len(codes)} communes, {len(by_dep)} départements ; provenances différentes selon "
            f"l'indicateur : {mixed} communes (la plus éloignée est retenue)")
    return len(codes)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true")
    p.add_argument("--cache", action="store_true")
    p.add_argument("--db", default=ROOT / "data" / "carteplan.sqlite", type=Path)
    args = p.parse_args(argv)
    ctx = SimpleNamespace(http=Http(use_cache=args.cache), log=print, today=datetime.date.today())
    con = db.connect(args.db)
    started = db.now()
    try:
        n = build(ctx, force=args.force)
        if n is not None:
            db.log_run(con, "explore2", started, "ok", n)
            print(f"{n} communes → {OUT}")
        code = 0
    except Exception as e:  # noqa: BLE001
        db.log_run(con, "explore2", started, "error", 0, f"{type(e).__name__}: {e}")
        print(f"ERREUR : {type(e).__name__}: {e}")
        code = 1
    con.commit()
    con.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
