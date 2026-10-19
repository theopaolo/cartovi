"""Stockage SQLite : séries d'observations horodatées + journal des collectes.

Une seule table de faits (`observation`) clé (indicateur, territoire, période) :
chaque collecte ajoute ou remplace des valeurs, rien n'est jamais effacé. Si
une source tombe, la dernière valeur connue reste disponible (marquée périmée).
"""

import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS territory (
    code      TEXT PRIMARY KEY,
    level     TEXT NOT NULL DEFAULT 'departement',
    name      TEXT NOT NULL,
    region    TEXT NOT NULL,
    area_km2  REAL NOT NULL,
    lon       REAL NOT NULL,
    lat       REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS source (
    id        TEXT PRIMARY KEY,
    label     TEXT NOT NULL,
    provider  TEXT NOT NULL,
    url       TEXT NOT NULL,
    licence   TEXT NOT NULL,
    refresh   TEXT NOT NULL,
    version   INTEGER NOT NULL DEFAULT 1  -- version de la méthode de calcul
);
CREATE TABLE IF NOT EXISTS indicator (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES source(id),
    label       TEXT NOT NULL,
    unit        TEXT NOT NULL,
    theme       TEXT NOT NULL,
    direction   INTEGER NOT NULL CHECK (direction IN (-1, 1)),
    weight      REAL NOT NULL,
    description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observation (
    indicator_id   TEXT NOT NULL REFERENCES indicator(id),
    territory_code TEXT NOT NULL REFERENCES territory(code),
    period         TEXT NOT NULL,
    value          REAL NOT NULL,
    fetched_at     TEXT NOT NULL,
    PRIMARY KEY (indicator_id, territory_code, period)
);
CREATE TABLE IF NOT EXISTS run (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok', 'error', 'rejected')),
    rows        INTEGER NOT NULL DEFAULT 0,
    message     TEXT NOT NULL DEFAULT ''
);
-- Dernière valeur connue par (indicateur, territoire) : période la plus récente,
-- puis collecte la plus récente.
CREATE VIEW IF NOT EXISTS latest AS
SELECT o.* FROM observation o
WHERE NOT EXISTS (
    SELECT 1 FROM observation n
    WHERE n.indicator_id = o.indicator_id AND n.territory_code = o.territory_code
      AND (n.period > o.period OR (n.period = o.period AND n.fetched_at > o.fetched_at))
);
"""


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(path):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    # migration : colonne ajoutée après la première mise en service
    if "version" not in {r["name"] for r in con.execute("PRAGMA table_info(source)")}:
        con.execute("ALTER TABLE source ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    return con


def upsert_territories(con, territories):
    con.executemany(
        """INSERT INTO territory (code, name, region, area_km2, lon, lat)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET name=excluded.name, region=excluded.region,
             area_km2=excluded.area_km2, lon=excluded.lon, lat=excluded.lat""",
        [(t.code, t.name, t.region, round(t.area_km2, 2), *t.centroid) for t in territories.values()],
    )


def upsert_source(con, source, indicators):
    con.execute(
        """INSERT INTO source (id, label, provider, url, licence, refresh, version)
           VALUES (:id, :label, :provider, :url, :licence, :refresh, 0)
           ON CONFLICT(id) DO UPDATE SET label=excluded.label, provider=excluded.provider,
             url=excluded.url, licence=excluded.licence, refresh=excluded.refresh""",
        source,
    )
    for ind in indicators:
        con.execute(
            """INSERT INTO indicator (id, source_id, label, unit, theme, direction, weight, description)
               VALUES (:id, :source_id, :label, :unit, :theme, :direction, :weight, :description)
               ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id, label=excluded.label,
                 unit=excluded.unit, theme=excluded.theme, direction=excluded.direction,
                 weight=excluded.weight, description=excluded.description""",
            {**ind, "source_id": source["id"]},
        )


def set_version(con, source):
    """À n'appeler qu'après une collecte réussie : la version enregistrée est celle
    de la méthode qui a produit les données en base."""
    con.execute("UPDATE source SET version=? WHERE id=?", (source.get("version", 1), source["id"]))


def insert_observations(con, rows, fetched_at):
    """rows : itérable de (indicator_id, territory_code, period, value).
    `fetched_at` n'est réécrit que si la valeur change : il date la donnée,
    pas la vérification (celle-ci est dans `run`). La base ne grossit donc pas
    quand une source republie des chiffres identiques."""
    rows = [(i, c, str(p), float(v), fetched_at) for i, c, p, v in rows]
    con.executemany(
        """INSERT INTO observation (indicator_id, territory_code, period, value, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(indicator_id, territory_code, period)
           DO UPDATE SET value=excluded.value, fetched_at=excluded.fetched_at
           WHERE abs(observation.value - excluded.value) > 1e-9""",
        rows,
    )
    return len(rows)


def log_run(con, source_id, started_at, status, rows=0, message=""):
    con.execute(
        "INSERT INTO run (source_id, started_at, finished_at, status, rows, message) VALUES (?, ?, ?, ?, ?, ?)",
        (source_id, started_at, now(), status, rows, message[:2000]),
    )
