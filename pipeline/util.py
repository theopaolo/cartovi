"""Petits utilitaires partagés par les sources."""

import re


class Deferred(Exception):
    """Levée par une source qui choisit de passer son tour (quota partagé déjà
    consommé dans cette exécution) : ni erreur ni collecte, elle sera retentée
    à la prochaine exécution."""


def norm_commune(code):
    """Normalise un code commune INSEE : '1004' -> '01004', '2a004' -> '2A004'.
    Renvoie None si le code est inexploitable."""
    if code is None:
        return None
    code = str(code).strip().upper()
    if re.fullmatch(r"\d{4}", code):
        code = "0" + code
    return code if re.fullmatch(r"(\d{5}|2[AB]\d{3})", code) else None


def dep_of_commune(code):
    """Département d'une commune métropolitaine, None pour les DROM/COM."""
    code = norm_commune(code)
    if code is None or code.startswith("97") or code.startswith("98"):
        return None
    return code[:2]


def norm_dep(code):
    """'1' -> '01', '2a' -> '2A' ; '20' (Corse avant 1976) -> None car ambigu."""
    if code is None:
        return None
    code = str(code).strip().upper()
    if re.fullmatch(r"\d", code):
        code = "0" + code
    if code == "20" or not re.fullmatch(r"(\d{2}|2[AB])", code):
        return None
    return code


def per_1000km2(counts, territories):
    """Convertit des effectifs par département en densité pour 1 000 km²,
    en émettant 0 pour les départements sans occurrence."""
    return {c: 1000 * counts.get(c, 0) / t.area_km2 for c, t in territories.items()}


def position(c):
    """(lon, lat) d'une commune de geo.api : sa mairie, c'est-à-dire le bourg habité. Le
    « centre » de geo.api est le centre géométrique du territoire : pour une très grande
    commune il tombe loin de la ville (Arles : en Camargue, à 15 km de la mairie), ce qui
    faussait la gare la plus proche, le climat, les distances. Repli sur le centre si la
    mairie manque."""
    p = c.get("mairie") or c.get("centre")
    return tuple(p["coordinates"][:2]) if p and p.get("coordinates") else None


def communes(ctx):
    """Liste des communes (geo.api.gouv.fr) avec population, surface et position de la
    mairie, téléchargée une seule fois par exécution et partagée entre les sources."""
    if "communes" not in ctx.memo:
        ctx.memo["communes"] = ctx.http.json(
            "https://geo.api.gouv.fr/communes",
            {"fields": "code,nom,population,surface,centre,mairie", "format": "json"},
            timeout=180,
        )
    return ctx.memo["communes"]


def complete_years(today, n):
    """Les `n` dernières années civiles achevées."""
    return list(range(today.year - n, today.year))
