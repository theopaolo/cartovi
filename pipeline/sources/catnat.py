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


# Types d'arrêtés CatNat regroupés par aléa (libellés de la base GASPAR).
CATNAT_TYPES = {
    "inond": ("Inondations et/ou Coulées de Boue", "Inondations Remontée Nappe", "Coulée de Boue", "Lave Torrentielle"),
    "sech": ("Sécheresse",),  # en pratique : retrait-gonflement des argiles
    "mer": ("Chocs Mécaniques liés à l'action des Vagues", "Raz de Marée"),
    "mvt": ("Mouvement de Terrain", "Glissement de Terrain", "Effondrement et/ou Affaisement",
            "Eboulement et/ou Chute de Blocs", "Glissement et Effondrement de Terrain", "Glissement et Eboulement Rocheux"),
}
TYPE_OF = {lib.lower(): k for k, libs in CATNAT_TYPES.items() for lib in libs}

# Risques recensés (DDRM) et plans de prévention, par code GASPAR : clés courtes stables.
RISK_CODES = {
    "inond": {"11", "112", "113", "114", "115", "116"},
    "sub": {"117"},
    "cote": {"125", "126"},
    "rga": {"127"},
    "mvt": {"12", "121", "122", "123", "124"},
    "feu": {"16"},
    "avalanche": {"14"},
    "barrage": {"23"},
    "industriel": {"21"},
    "nucleaire": {"22"},
}
KEY_OF = {code: k for k, codes in RISK_CODES.items() for code in codes}


def gaspar(ctx):
    """Archive GASPAR, téléchargée une fois par exécution (CatNat, DDRM et PPR y sont)."""
    memo = getattr(ctx, "memo", None)
    if memo is not None and "gaspar" in memo:
        return memo["gaspar"]
    archive = zipfile.ZipFile(io.BytesIO(ctx.http.get(URL, timeout=300)))
    if memo is not None:
        memo["gaspar"] = archive
    return archive


def _member(ctx, pattern):
    archive = gaspar(ctx)
    name = next(n for n in archive.namelist() if re.search(pattern, n))
    ctx.log(f"  {name}")
    return csv.DictReader(io.StringIO(archive.read(name).decode("utf-8-sig", "replace")), delimiter=";")


def by_commune_type(ctx):
    """Reconnaissances CatNat par commune et par aléa : {commune: {type: n}} (types de
    CATNAT_TYPES, plus « autre »), événements des YEARS dernières années, dédoublonnées."""
    rows = _member(ctx, r"catnat_gaspar.*\.csv$")
    c_id, c_com, c_risk, c_start = (_col(rows.fieldnames, k) for k in ("id", "commune", "risk", "start"))
    # le libellé (pour l'aléa) quand il existe, sinon le champ risque retenu ci-dessus
    c_lib = next((f for f in rows.fieldnames if f.lower().strip() in ("lib_risque_jo", "libelle_risque_jo")), c_risk)
    since = (ctx.today - datetime.timedelta(days=365.25 * YEARS)).isoformat()
    seen = set()
    for r in rows:
        start = (r.get(c_start) or "")[:10]
        if re.fullmatch(r"\d\d/\d\d/\d{4}", start):  # ancien format jj/mm/aaaa
            start = f"{start[6:]}-{start[3:5]}-{start[:2]}"
        com = norm_commune(r.get(c_com))
        if start >= since and com:
            seen.add((r.get(c_id), com, r.get(c_risk), start, r.get(c_lib)))  # code et libellé vont de pair
    ctx.log(f"  {len(seen)} reconnaissances depuis {since}")
    if not 20_000 < len(seen) < 300_000:  # ~68 000 sur 2006-2026
        raise ValueError(f"nombre de reconnaissances invraisemblable : {len(seen)}")
    out = {}
    for _, com, _, _, lib in seen:
        t = TYPE_OF.get((lib or "").strip().lower(), "autre")
        d = out.setdefault(com, {})
        d[t] = d.get(t, 0) + 1
    return out


def by_commune(ctx):
    """Total des reconnaissances CatNat par commune ; partagé avec la couche communale."""
    return {com: sum(d.values()) for com, d in by_commune_type(ctx).items()}


def risks_by_commune(ctx):
    """Risques recensés par la préfecture (DDRM) et plans de prévention opposables, par
    commune : ({commune: {clé}}, {commune: {clé}}). Une connaissance réglementaire du
    risque, pas une mesure de son intensité."""
    ddrm = {}
    for r in _member(ctx, r"ddrm_risq_gaspar.*\.csv$"):
        com, key = norm_commune(r.get("cod_commune")), KEY_OF.get((r.get("num_risque") or "").strip())
        if com and key:
            ddrm.setdefault(com, set()).add(key)
    ppr = {}
    for r in _member(ctx, r"pprn_gaspar.*\.csv$"):
        if (r.get("LIBELLE ETAT") or "").strip() != "Opposable":
            continue
        com = norm_commune(r.get("CODE INSEE COMMUNE"))
        key = KEY_OF.get((r.get("CODE RISQUE 3") or "").strip()) or KEY_OF.get((r.get("CODE RISQUE 2") or "").strip())
        if com and key:
            ppr.setdefault(com, set()).add(key)
    ctx.log(f"  DDRM : {len(ddrm)} communes ; PPR opposables : {len(ppr)} communes")
    if len(ddrm) < 10_000 or len(ppr) < 5_000:
        raise ValueError(f"DDRM/PPR invraisemblables : {len(ddrm)} / {len(ppr)} communes")
    return ddrm, ppr


def fetch(ctx):
    counts = {}
    for com, n in by_commune(ctx).items():
        dep = dep_of_commune(com)
        counts[dep] = counts.get(dep, 0) + n
    n_communes = {}
    for c in communes(ctx):
        dep = dep_of_commune(c.get("code"))
        n_communes[dep] = n_communes.get(dep, 0) + 1
    period = f"{ctx.today.year - YEARS}–{ctx.today.year}"
    for dep in ctx.territories:
        if n_communes.get(dep):
            yield "catnat", dep, period, counts.get(dep, 0) / n_communes[dep]
