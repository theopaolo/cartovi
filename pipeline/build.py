"""Point d'entrée : collecte toutes les sources, historise dans SQLite, exporte le JSON du site.

    python -m pipeline.build                 # tout
    python -m pipeline.build --only dvf,geo  # certaines sources
    python -m pipeline.build --cache         # réutilise les téléchargements (.cache/)
    python -m pipeline.build --export-only   # régénère le JSON depuis la base

Chaque source est isolée : une API en panne ou dont le format a changé produit
une ligne `error`/`rejected` dans la table `run`, et le site continue d'afficher
la dernière valeur valide (signalée comme périmée).
"""

import argparse
import datetime
import json
import math
import sys
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

from . import db, territories
from .http import Http
from .sources import SOURCES

ROOT = Path(__file__).resolve().parent.parent
THEMES = [
    {"id": "eau", "label": "Eau & climat"},
    {"id": "foncier", "label": "Foncier & densité"},
    {"id": "nature", "label": "Terres & nature"},
    {"id": "risques", "label": "Risques & pollution"},
]


def validate(rows, indicators, codes):
    """Rejette une collecte incomplète ou aberrante plutôt que d'écraser de bonnes données."""
    by_ind = {}
    for ind_id, code, period, value in rows:
        if code not in codes:
            continue  # DROM, codes historiques… hors périmètre
        if value is None or not math.isfinite(float(value)):
            continue
        by_ind.setdefault(ind_id, []).append((ind_id, code, period, value))
    clean, problems = [], []
    for ind in indicators:
        got = by_ind.get(ind["id"], [])
        covered = {c for _, c, _, _ in got}
        need = ind.get("min_coverage", 0.95)
        if len(covered) < need * len(codes):
            problems.append(f"{ind['id']} : {len(covered)}/{len(codes)} départements")
        else:
            clean.extend(got)
    unknown = set(by_ind) - {i["id"] for i in indicators}
    if unknown:
        problems.append(f"indicateurs non déclarés : {sorted(unknown)}")
    return clean, problems


def is_fresh(con, src, today):
    """Vrai si la dernière collecte réussie date de moins de `max_age_days`.
    Évite de retélécharger chaque semaine des données qui changent une fois
    par an, et ménage les quotas des API (Open-Meteo, Géorisques)."""
    known = con.execute("SELECT version FROM source WHERE id=?", (src["id"],)).fetchone()
    if known is None or known["version"] != src.get("version", 1):
        return False  # méthode de calcul modifiée : on recollecte
    row = con.execute(
        "SELECT MAX(finished_at) t FROM run WHERE source_id=? AND status='ok'", (src["id"],)
    ).fetchone()
    if not row["t"]:
        return False
    age = (today - datetime.date.fromisoformat(row["t"][:10])).days
    return age < src.get("max_age_days", 0)


def collect(con, sources, ctx, force=False):
    for mod in sources:
        src = mod.SOURCE
        if not force and is_fresh(con, src, ctx.today):
            ctx.log(f"→ {src['id']} : à jour (< {src['max_age_days']} j), ignorée")
            continue
        started = db.now()
        t0 = time.time()
        ctx.log(f"→ {src['id']} ({src['provider']})")
        db.upsert_source(con, src, mod.INDICATORS)
        try:
            rows = list(mod.fetch(ctx))
            clean, problems = validate(rows, mod.INDICATORS, set(ctx.territories))
            n = db.insert_observations(con, clean, started)
            status = "rejected" if problems else "ok"
            msg = "; ".join(problems)
            ctx.log(f"  {status} : {n} valeurs en {time.time() - t0:.0f}s {msg}")
        except Exception as e:  # noqa: BLE001 — une source ne doit jamais faire tomber les autres
            n, status = 0, "error"
            msg = f"{type(e).__name__}: {e}"
            ctx.log(f"  ERREUR : {msg}")
            traceback.print_exc(limit=3, file=sys.stdout, chain=False)
        db.log_run(con, src["id"], started, status, n, msg)
        con.commit()


def export(con, out_dir, terrs):
    out_dir.mkdir(parents=True, exist_ok=True)
    layer = territories.svg_layer(terrs)
    (out_dir / "map.json").write_text(json.dumps(layer, ensure_ascii=False, separators=(",", ":")), "utf-8")

    sources = {r["id"]: dict(r) for r in con.execute("SELECT * FROM source")}
    last_run = {}
    for r in con.execute("SELECT * FROM run ORDER BY id"):
        last_run[r["source_id"]] = dict(r)
    last_ok = {
        r["source_id"]: r["t"]
        for r in con.execute("SELECT source_id, MAX(finished_at) t FROM run WHERE status='ok' GROUP BY source_id")
    }
    active = {m.SOURCE["id"]: m for m in SOURCES}
    indicators = []
    for ind in con.execute("SELECT * FROM indicator ORDER BY theme, id"):
        meta = next((i for i in getattr(active.get(ind["source_id"]), "INDICATORS", []) if i["id"] == ind["id"]), None)
        if meta is None:
            continue  # indicateur retiré du code : historique conservé en base, absent du site
        rows = con.execute(
            "SELECT territory_code, value, period, fetched_at FROM latest WHERE indicator_id=?", (ind["id"],)
        ).fetchall()
        if not rows:
            continue
        run = last_run.get(ind["source_id"], {})
        periods = sorted({r["period"] for r in rows})
        indicators.append(
            {
                **{k: ind[k] for k in ("id", "label", "unit", "theme", "direction", "weight", "description")},
                "decimals": meta.get("decimals", 0),
                "scale": meta.get("scale", "linear"),
                "source": sources[ind["source_id"]],
                "period": periods[-1] if len(periods) == 1 else f"{periods[0]} – {periods[-1]}",
                "updated_at": max(r["fetched_at"] for r in rows),
                "status": "ok" if run.get("status") == "ok" else "stale",
                "last_run": {k: run.get(k) for k in ("status", "finished_at", "message")},
                "last_ok": last_ok.get(ind["source_id"]),
                "values": {r["territory_code"]: round(r["value"], 4) for r in rows},
            }
        )
    payload = {
        "generated_at": db.now(),
        "themes": THEMES,
        "indicators": indicators,
    }
    (out_dir / "indicators.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8"
    )
    return len(indicators)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=ROOT / "data" / "cartovi.sqlite", type=Path)
    p.add_argument("--out", default=ROOT / "web" / "data", type=Path)
    p.add_argument("--only", help="identifiants de sources, séparés par des virgules")
    p.add_argument("--cache", action="store_true", help="cache disque des requêtes HTTP")
    p.add_argument("--export-only", action="store_true")
    p.add_argument("--force", action="store_true", help="ignore max_age_days des sources")
    args = p.parse_args(argv)

    terrs = territories.load()
    args.db.parent.mkdir(parents=True, exist_ok=True)
    con = db.connect(args.db)
    db.upsert_territories(con, terrs)
    con.commit()

    if not args.export_only:
        wanted = set(args.only.split(",")) if args.only else None
        chosen = [m for m in SOURCES if wanted is None or m.SOURCE["id"] in wanted]
        if wanted and len(chosen) != len(wanted):
            p.error(f"sources inconnues : {wanted - {m.SOURCE['id'] for m in chosen}}")
        ctx = SimpleNamespace(
            http=Http(use_cache=args.cache),
            territories=terrs,
            log=print,
            today=datetime.date.today(),
            memo={},  # partage de téléchargements entre sources d'une même exécution
        )
        collect(con, chosen, ctx, force=args.force or bool(wanted))
        print(f"{ctx.http.requests} requêtes HTTP")

    n = export(con, args.out, terrs)
    con.execute("VACUUM")
    con.close()
    print(f"export : {n} indicateurs → {args.out}")
    # Code de sortie non nul seulement si *aucune* source n'a de donnée exploitable.
    return 0 if n else 1


if __name__ == "__main__":
    sys.exit(main())
