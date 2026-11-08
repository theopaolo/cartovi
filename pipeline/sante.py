"""Accès aux soins par commune : médecins généralistes, sages-femmes, maternités.

Sources (Licence Ouverte), lues par la couche communale (pipeline.communes) à chaque génération :
- DREES, accessibilité potentielle localisée (APL), millésime le plus récent du classeur publié
  sur data.gouv.fr. L'APL compte l'offre de soins accessible depuis une commune, en tenant
  compte des communes voisines (jusqu'à environ 20 minutes de route pour les
  généralistes), de l'activité réelle des
  praticiens et de l'âge des habitants (une population âgée consomme plus de soins) :
  * médecins généralistes de 65 ans ou moins, en consultations accessibles par an et par
    habitant standardisé. On retient cette variante plutôt que l'offre totale : les médecins
    plus âgés partiront à la retraite dans les années qui viennent, et c'est l'offre durable
    qui compte pour s'installer ;
  * sages-femmes (suivi de grossesse, post-partum, gynécologie de prévention), en équivalents
    temps plein accessibles pour 100 000 femmes standardisées.
- DREES, liste des maternités au 31 décembre (statistique annuelle des établissements, SAE) :
  type (1 : grossesses sans risque identifié ; 2a et 2b : avec néonatologie, et soins intensifs
  pour la 2b ; 3 : réanimation néonatale), nombre d'accouchements. Les maternités sont placées
  à l'adresse géocodée de leur établissement dans le fichier FINESS géolocalisé (ARS, Atlasanté),
  à défaut à la mairie de leur commune.

La distance à la maternité est à vol d'oiseau depuis la mairie : elle ne dit pas le temps de
route (relief, routes de montagne) que la DREES calcule ailleurs avec un distancier.
"""

import csv
import io
import re

from . import datagouv, xlsx
from .util import norm_commune

APL = "62263314072c63d4d53e0c50"  # Accessibilité potentielle localisée (APL) aux professionnels de santé
MATERNITES = "6226330f072c63d4d53e0c49"  # Liste des maternités de France depuis 2000
FINESS = "53699569a3a729239d2046eb"  # FINESS Extraction du Fichier des établissements
APL_KINDS = {
    # clé : (début du titre de la ressource, colonne de la valeur, colonne de la population standardisée)
    "mg": ("Indicateur d'APL aux médecins généralistes", "APL aux médecins généralistes de 65 ans ou moins",
           "Population standardisée"),
    "sf": ("Indicateur d'APL aux sages-femmes", "APL aux sages-femmes", "Population féminine standardisée"),
}
TYPES = ("1", "2a", "2b", "3")
CITY = {"751": "75056", "6938": "69123", "132": "13055"}  # arrondissements de Paris, Lyon, Marseille


def _city(code):
    for prefix, city in CITY.items():
        if code.startswith(prefix) and code != city and len(code) == 5:
            return city
    return None


def _latest_sheet(wb, pattern):
    """Feuille du millésime le plus récent : « APL 2024 », « Maternités_2024 »…"""
    found = [(int(m.group(1)), name) for name in wb.sheets if (m := re.fullmatch(pattern, name))]
    if not found:
        raise LookupError(f"aucune feuille {pattern} parmi {list(wb.sheets)}")
    return max(found)


def _xlsx_resource(http, dataset, title_prefix):
    res = [r for r in datagouv.dataset(http, dataset)["resources"]
           if r.get("title", "").startswith(title_prefix) and r.get("title", "").endswith(".xlsx")]
    if not res:
        raise LookupError(f"aucun classeur « {title_prefix} » dans {dataset}")
    return max(res, key=lambda r: r.get("last_modified") or "")


def apl(ctx, kind):
    """{commune: valeur} pour un indicateur APL ; renvoie aussi le millésime."""
    prefix, value_col, pop_col = APL_KINDS[kind]
    r = _xlsx_resource(ctx.http, APL, prefix)
    wb = xlsx.Workbook(ctx.http.get(r["url"], timeout=300))
    year, sheet = _latest_sheet(wb, r"APL (\d{4})")
    head, rows = xlsx.table(wb.rows(sheet), "Code commune INSEE")
    iv = head.index(value_col)
    ip = next(i for i, h in enumerate(head) if h.startswith(pop_col))
    out, plm = {}, {}
    for row in rows:
        if len(row) <= max(iv, ip) or not isinstance(row[iv], (int, float)):
            continue  # lignes d'unité (« En nombre de consultations… »), notes de bas de tableau
        code = norm_commune(str(row[0]))
        if not code:
            continue
        out[code] = round(row[iv], 2 if kind == "mg" else 1)
        city = _city(code)
        if city and isinstance(row[ip], (int, float)):
            plm.setdefault(city, []).append((row[ip], row[iv]))
    for city, parts in plm.items():
        # la DREES le précise : un APL agrégé est une moyenne pondérée par la population standardisée
        if city not in out and sum(p for p, _ in parts) > 0:
            out[city] = round(sum(p * v for p, v in parts) / sum(p for p, _ in parts), 2 if kind == "mg" else 1)
    ctx.log(f"  APL {kind} {year} : {len(out)} communes ({r['title']})")
    if len(out) < 30_000:
        raise ValueError(f"APL {kind} : {len(out)} communes seulement")
    return out, year


def maternites(ctx):
    """Maternités du dernier 31 décembre publié : [{finess, com, type, nom, acc}], et l'année."""
    r = _xlsx_resource(ctx.http, MATERNITES, "Fichier_Maternites_")
    wb = xlsx.Workbook(ctx.http.get(r["url"], timeout=300))
    year, sheet = _latest_sheet(wb, r"Maternités_(\d{4})")
    head, rows = xlsx.table(wb.rows(sheet), "ID_MAT")
    col = {k: head.index(k) for k in ("NOM_MAT", "TYPE", "FI_ET", "COM", "ACCTOT")}
    out = []
    for row in rows:
        if len(row) <= max(col.values()) or not row[col["COM"]]:
            continue
        t = str(row[col["TYPE"]] or "").strip().lower()
        out.append({"finess": str(row[col["FI_ET"]] or "").strip().zfill(9), "com": norm_commune(str(row[col["COM"]])),
                    "type": t if t in TYPES else None, "nom": str(row[col["NOM_MAT"]] or "").strip(),
                    "acc": row[col["ACCTOT"]] if isinstance(row[col["ACCTOT"]], (int, float)) else None})
    ctx.log(f"  maternités au 31 décembre {year} : {len(out)}")
    if len(out) < 350:
        raise ValueError(f"maternités : {len(out)} seulement")
    return out, year


def finess_lambert93(ctx, wanted):
    """{n° FINESS : (x, y)} en Lambert-93 pour les établissements demandés (métropole)."""
    r = datagouv.resource(ctx.http, FINESS, url_pattern=r"cs1100507")
    text = ctx.http.get(r["url"], timeout=600).decode("utf-8", "replace")
    out = {}
    for row in csv.reader(io.StringIO(text), delimiter=";"):
        if row and row[0] == "geolocalisation" and len(row) >= 5 and row[1] in wanted and "2154" in row[4]:
            try:
                out[row[1]] = (float(row[2]), float(row[3]))
            except ValueError:
                continue
    return out


def maternity_points(ctx, positions):
    """[(x, y, maternité)] en Lambert-93 ; positions : {commune: (x, y)} des mairies, en secours."""
    mats, year = maternites(ctx)
    try:
        coords = finess_lambert93(ctx, {m["finess"] for m in mats})
    except Exception as e:  # noqa: BLE001 — le fichier FINESS en panne : on retombe sur la mairie
        ctx.log(f"  FINESS géolocalisé indisponible ({type(e).__name__}: {e}) : maternités placées à leur mairie")
        coords = {}
    pts, at_mairie = [], 0
    for m in mats:
        xy = coords.get(m["finess"])
        if xy is None:
            xy = positions.get(m["com"])
            at_mairie += xy is not None
        if xy is not None:
            pts.append((*xy, m))
    ctx.log(f"  {len(pts)} maternités placées ({len(pts) - at_mairie} à leur adresse, {at_mairie} à leur mairie)")
    return pts, year


def nearest(pts, x, y):
    """(distance en km, maternité) de la plus proche ; recherche exhaustive (moins de 500 points)."""
    best = min(pts, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)
    return round(((best[0] - x) ** 2 + (best[1] - y) ** 2) ** 0.5 / 1000, 1), best[2]

