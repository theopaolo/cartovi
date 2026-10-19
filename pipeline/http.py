"""Client HTTP minimal (urllib) : délais, réessais exponentiels, gzip, cache disque.

Le cache (répertoire `.cache/`, ignoré par git) sert au développement :
`python -m pipeline.build --cache` évite de retélécharger à chaque essai.
"""

import csv
import gzip
import hashlib
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "cartovi/1.0 (+https://github.com/theopaolo/cartovi)"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def short(url, n=160):
    return url if len(url) <= n else url[: n - 1] + "…"


class Http:
    def __init__(self, use_cache=False, retries=4, timeout=60, log=print):
        self.use_cache = use_cache
        self.retries = retries
        self.timeout = timeout
        self.log = log
        self.requests = 0

    def get(self, url, params=None, headers=None, timeout=None):
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
        cache = CACHE_DIR / hashlib.sha1(url.encode()).hexdigest()
        if self.use_cache and cache.exists():
            return cache.read_bytes()
        req = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip", **(headers or {})}
        )
        delay = 2
        for attempt in range(self.retries + 1):
            try:
                self.requests += 1
                with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                    body = r.read()
                    if r.headers.get("Content-Encoding") == "gzip" or body[:2] == b"\x1f\x8b":
                        body = gzip.decompress(body)
                break
            except urllib.error.HTTPError as e:
                detail = e.read()
                if detail[:2] == b"\x1f\x8b":
                    detail = gzip.decompress(detail)
                detail = detail[:300].decode("utf-8", "replace")
                # 4xx (hors 429) : inutile d'insister, l'URL ou les paramètres sont faux.
                # 429 sur un quota horaire ou journalier : attendre ne servirait à rien.
                exhausted = e.code == 429 and any(w in detail.lower() for w in ("hourly", "daily", "monthly"))
                if (e.code < 500 and e.code != 429) or exhausted or attempt == self.retries:
                    raise RuntimeError(f"HTTP {e.code} sur {short(url)} : {detail}") from e
                wait = int(e.headers.get("Retry-After") or (61 if e.code == 429 else delay))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == self.retries:
                    raise RuntimeError(f"échec réseau sur {short(url)} : {e}") from e
                wait = delay
            self.log(f"    réessai dans {wait}s ({url[:90]})")
            time.sleep(wait)
            delay *= 2
        if self.use_cache:
            CACHE_DIR.mkdir(exist_ok=True)
            cache.write_bytes(body)
        return body

    def json(self, url, params=None, **kw):
        return json.loads(self.get(url, params, headers={"Accept": "application/json"}, **kw))

    def csv(self, url, params=None, delimiter=None, encoding="utf-8", **kw):
        """Retourne un itérateur de dict. Détecte le séparateur si non fourni."""
        text = self.get(url, params, **kw).decode(encoding, "replace").lstrip("﻿")
        if delimiter is None:
            head = text[:2000].splitlines()[0] if text else ""
            delimiter = max(",;\t|", key=head.count)
        return csv.DictReader(io.StringIO(text), delimiter=delimiter)
