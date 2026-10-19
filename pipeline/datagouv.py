"""Résolution des ressources data.gouv.fr.

Les URL directes des fichiers changent à chaque publication (horodatage dans le
chemin) : on passe par l'API catalogue pour retrouver la ressource voulue par
son titre ou son format, avec un permalien `datasets/r/<id>` en secours.
"""

import re

API = "https://www.data.gouv.fr/api/1"


def dataset(http, slug_or_id):
    return http.json(f"{API}/datasets/{slug_or_id}/")


def resource(http, slug_or_id, title=None, url_pattern=None, fmt=None):
    """Ressource la plus récente qui correspond aux critères (titre exact,
    regex sur l'URL, format). Renvoie le dict de la ressource."""
    ds = dataset(http, slug_or_id)
    res = ds["resources"]
    if isinstance(res, dict):  # pagination éventuelle de l'API
        res = http.json(f"{API}/datasets/{ds['id']}/resources/")["data"]
    found = [
        r
        for r in res
        if (title is None or r.get("title", "").strip().lower() == title.lower())
        and (url_pattern is None or re.search(url_pattern, r.get("url", "")))
        and (fmt is None or (r.get("format") or "").lower() == fmt)
    ]
    if not found:
        raise LookupError(f"aucune ressource {title or url_pattern or fmt} dans {slug_or_id}")
    return max(found, key=lambda r: r.get("last_modified") or "")


def search(http, query, sort="-created", page_size=20):
    return http.json(f"{API}/datasets/", {"q": query, "sort": sort, "page_size": page_size})["data"]
