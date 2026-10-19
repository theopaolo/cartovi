"""Résumé Markdown de la dernière collecte (pour $GITHUB_STEP_SUMMARY)."""

import sys
from pathlib import Path

from . import db

ROOT = Path(__file__).resolve().parent.parent


def main(path=ROOT / "data" / "cartovi.sqlite"):
    if not Path(path).exists():
        print("Aucune base générée.")
        return
    con = db.connect(path)
    print("## Collecte Cartovi\n")
    print("| Source | Statut | Valeurs | Fin | Message |\n|---|---|---|---|---|")
    for r in con.execute(
        """SELECT * FROM run WHERE id IN (SELECT MAX(id) FROM run GROUP BY source_id) ORDER BY source_id"""
    ):
        icon = {"ok": "✅", "error": "❌", "rejected": "⚠️"}[r["status"]]
        msg = r["message"].replace("|", "\\|").replace("\n", " ")[:300]
        print(f"| {r['source_id']} | {icon} {r['status']} | {r['rows']} | {r['finished_at']} | {msg} |")
    print("\n| Indicateur | Départements | Période | Min | Médiane | Max |\n|---|---|---|---|---|---|")
    for ind in con.execute("SELECT id FROM indicator ORDER BY theme, id"):
        vals = con.execute(
            "SELECT value, period FROM latest WHERE indicator_id=? ORDER BY value", (ind["id"],)
        ).fetchall()
        if not vals:
            print(f"| {ind['id']} | 0 | | | | |")
            continue
        v = [r["value"] for r in vals]
        periods = sorted({r["period"] for r in vals})
        print(
            f"| {ind['id']} | {len(v)} | {' / '.join(periods)} | {v[0]:.4g} | {v[len(v) // 2]:.4g} | {v[-1]:.4g} |"
        )


if __name__ == "__main__":
    main(*sys.argv[1:])
