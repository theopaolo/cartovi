"""Risques industriels et sols pollués — API Géorisques v1 (BRGM / ministère).

Deux sources distinctes pour qu'une panne de l'une n'emporte pas l'autre.
Le filtre `statutSeveso` de l'API ne renvoie rien sans critère communal : on
parcourt donc toutes les installations de chaque département (≈140 pages de
1 000) et on filtre ici. Rafraîchissement mensuel : ces inventaires bougent peu.
"""

from ..util import per_1000km2

API = "https://georisques.gouv.fr/api/v1"


def _pages(ctx, path, params):
    page = 1
    while True:
        res = ctx.http.json(f"{API}/{path}", {**params, "page": page, "page_size": 1000}, timeout=180)
        data = res.get("data") or []
        yield from data
        total = res.get("total_pages")
        if (total is not None and page >= total) or (total is None and len(data) < 1000):
            return
        page += 1


class Seveso:
    SOURCE = {
        "id": "seveso",
        "label": "Géorisques — installations classées (ICPE)",
        "provider": "Ministère de la Transition écologique / BRGM",
        "url": "https://www.georisques.gouv.fr/doc-api",
        "licence": "Licence Ouverte 2.0",
        "refresh": "mensuel",
        "max_age_days": 28,
    }
    INDICATORS = [
        {
            "id": "seveso",
            "label": "Sites Seveso",
            "unit": "sites/1 000 km²",
            "theme": "risques",
            "direction": -1,
            "weight": 1.0,
            "decimals": 2,
            "min_coverage": 1.0,
            "description": (
                "Établissements Seveso (seuils haut et bas) en activité, rapportés à la surface. "
                "Mesure la densité d'installations à risque d'accident majeur, sans pondération "
                "par la population exposée ni par la nature du danger."
            ),
        },
    ]

    @classmethod
    def fetch(cls, ctx):
        counts = {}
        for code in ctx.territories:
            seen = set()
            for inst in _pages(ctx, "installations_classees", {"departement": code}):
                if (inst.get("statutSeveso") or "").startswith("Seveso seuil") and not (
                    inst.get("etatActivite") or ""
                ).startswith("Cess"):
                    seen.add(inst.get("codeAIOT") or inst.get("siret") or inst.get("raisonSociale"))
            counts[code] = len(seen)
        total = sum(counts.values())
        ctx.log(f"  {total} établissements Seveso")
        if not 800 < total < 2000:  # ~1 300 en France métropolitaine
            raise ValueError(f"total Seveso invraisemblable : {total}")
        for code, v in per_1000km2(counts, ctx.territories).items():
            yield "seveso", code, ctx.today.strftime("%Y-%m"), v


class SolsPollues:
    SOURCE = {
        "id": "ssp",
        "label": "Géorisques — sites et sols pollués (instructions, ex-BASOL)",
        "provider": "Ministère de la Transition écologique / BRGM",
        "url": "https://www.georisques.gouv.fr/risques/sites-et-sols-pollues",
        "licence": "Licence Ouverte 2.0",
        "refresh": "mensuel",
        "max_age_days": 28,
    }
    INDICATORS = [
        {
            "id": "sols_pollues",
            "label": "Sites et sols pollués",
            "unit": "sites/1 000 km²",
            "theme": "risques",
            "direction": -1,
            "weight": 0.5,
            "decimals": 1,
            "min_coverage": 1.0,
            "description": (
                "Sites dont la pollution (avérée ou suspectée) a appelé une action des pouvoirs "
                "publics, en cours ou close, rapportés à la surface. Reflète surtout le passé "
                "industriel ; un site clos peut rester grevé de restrictions d'usage."
            ),
        },
    ]

    @classmethod
    def fetch(cls, ctx):
        counts = {}
        for code in ctx.territories:
            counts[code] = len(
                {s["identifiant_ssp"] for s in _pages(ctx, "ssp/instructions", {"code_departement": code})}
            )
        total = sum(counts.values())
        ctx.log(f"  {total} sites")
        if not 5_000 < total < 30_000:  # ~12 000 en 2026
            raise ValueError(f"total de sites pollués invraisemblable : {total}")
        for code, v in per_1000km2(counts, ctx.territories).items():
            yield "sols_pollues", code, ctx.today.strftime("%Y-%m"), v
