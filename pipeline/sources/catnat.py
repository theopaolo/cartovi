"""Catastrophes naturelles reconnues — base GASPAR (export complet Géorisques).

Un arrêté CatNat reconnaît qu'une commune a subi un événement naturel
d'intensité anormale (inondation, sécheresse-argiles, mouvement de terrain…).
Le fichier national (~8 Mo zippés) évite 35 000 appels à l'API.
"""

import csv
import datetime
import io
import re
import zipfile

from ..util import communes, dep_of_commune, norm_commune

SOURCE = {
    "id": "catnat",
    "label": "GASPAR — arrêtés de catastrophe naturelle",
    "provider": "Ministère de la Transition écologique (Géorisques)",
    "url": "https://www.georisques.gouv.fr/donnees/bases-de-donnees/base-gaspar",
    "licence": "Licence Ouverte 2.0",
    "refresh": "hebdomadaire",
    "max_age_days": 7,
}

YEARS = 20

INDICATORS = [
    {
        "id": "catnat",
        "label": "Catastrophes naturelles reconnues",
        "unit": "arrêtés/commune",
        "theme": "risques",
        "direction": -1,
        "weight": 1.0,
        "decimals": 1,
        "description": (
            f"Nombre moyen de reconnaissances de catastrophe naturelle par commune pour des "
            f"événements des {YEARS} dernières années (inondations, coulées de boue, sécheresse et "
            "retrait-gonflement des argiles, mouvements de terrain…). Mesure la sinistralité "
            "reconnue, qui dépend aussi des demandes déposées par les communes."
        ),
    },
]

URL = "https://files.georisques.fr/GASPAR/gaspar.zip"
# L'export a renommé ses colonnes en 2026 : on accepte les deux nomenclatures.
COLUMNS = {
    "id": ("id_gaspar", "cod_nat_catnat"),
    "commune": ("cod_commune", "code_commune", "code_insee"),
    "risk": ("num_risque_jo", "lib_risque_jo"),
    "start": ("dat_deb", "date_debut", "date_debut_evt"),
}


def _col(fields, key):
    low = {f.lower().strip(): f for f in fields}
    for name in COLUMNS[key]:
        if name in low:
            return low[name]
    raise KeyError(f"colonne {key} introuvable parmi {fields}")


def fetch(ctx):
    archive = zipfile.ZipFile(io.BytesIO(ctx.http.get(URL, timeout=300)))
    member = next(n for n in archive.namelist() if re.search(r"catnat_gaspar.*\.csv$", n))
    ctx.log(f"  {member}")
    text = archive.read(member).decode("utf-8-sig", "replace")
    rows = csv.DictReader(io.StringIO(text), delimiter=";")
    c_id, c_com, c_risk, c_start = (_col(rows.fieldnames, k) for k in ("id", "commune", "risk", "start"))
    since = (ctx.today - datetime.timedelta(days=365.25 * YEARS)).isoformat()
    seen = set()
    for r in rows:
        start = (r.get(c_start) or "")[:10]
        if re.fullmatch(r"\d\d/\d\d/\d{4}", start):  # ancien format jj/mm/aaaa
            start = f"{start[6:]}-{start[3:5]}-{start[:2]}"
        com = norm_commune(r.get(c_com))
        if start >= since and com:
            seen.add((r.get(c_id), com, r.get(c_risk), start))
    counts = {}
    for _, com, _, _ in seen:
        dep = dep_of_commune(com)
        counts[dep] = counts.get(dep, 0) + 1
    n_communes = {}
    for c in communes(ctx):
        dep = dep_of_commune(c.get("code"))
        n_communes[dep] = n_communes.get(dep, 0) + 1
    ctx.log(f"  {len(seen)} reconnaissances depuis {since}")
    if not 20_000 < len(seen) < 300_000:  # ~68 000 sur 2006-2026
        raise ValueError(f"nombre de reconnaissances invraisemblable : {len(seen)}")
    period = f"{ctx.today.year - YEARS}–{ctx.today.year}"
    for dep in ctx.territories:
        if n_communes.get(dep):
            yield "catnat", dep, period, counts.get(dep, 0) / n_communes[dep]
