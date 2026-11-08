"""Îlots de chaleur : tissu urbain autour de la mairie, d'après les zones climatiques locales (LCZ) du Cerema.

    python -m pipeline.chaleur            # si les fichiers publiés ont changé
    python -m pipeline.chaleur --force

Le Cerema a cartographié en 2022 les « zones climatiques locales » (Stewart et Oke, 2012) des
88 aires urbaines de plus de 50 000 habitants de métropole (data.gouv.fr, Licence Ouverte) :
chaque îlot du tissu urbain reçoit une classe (1 à 10 : bâti, du plus compact au plus diffus ;
A à G : végétation, sol nu, eau) et les indicateurs qui la déterminent, mesurés sur images
satellite et BD TOPO : taux de surface bâtie (BuR), de surface imperméable hors bâti (RoR), de
végétation (VeR), part des arbres dans la végétation (VHR), hauteur et emprise moyennes du bâti.

Ce qui est calculé, pour chaque commune couverte, dans un disque de RADIUS_M autour de la
mairie (le centre que l'on pratique à pied), échantillonné tous les STEP_M mètres :
- `mineral_1km` : part minéralisée du sol (bâti + revêtements imperméables, BuR + RoR) ;
- `arbres_1km` : part couverte d'arbres (VeR × VHR) ;
- `dense_1km` : part du disque en tissu compact (LCZ 1, 2, 3 : plus de 40 % de surface bâtie),
  celui où la chaleur s'accumule le plus et se dissipe le moins la nuit ;
- `lcz_mairie` : la classe de l'îlot de la mairie ;
- `couvert_1km` : part du disque couverte par la cartographie (une commune en limite d'aire
  urbaine n'est que partiellement couverte ; sous la moitié, les parts ne sont pas publiées).

On n'utilise pas la « sensibilité aux fortes chaleurs » que le Cerema associe à chaque classe :
son guide précise qu'elle « n'a aucune valeur scientifique ». Les indicateurs physiques, eux,
sont mesurés. Ce n'est pas une mesure de température : une même part minéralisée chauffe plus
sous un climat chaud, et le relief, le vent ou un cours d'eau modulent l'effet.

Lecture : les archives (≈ 8,7 Go, dont une image raster de 1,5 m par territoire) ne sont pas
téléchargées entières. Le répertoire de chaque zip est lu par requêtes HTTP Range, puis seuls
le shapefile (.shp, ≈ 3,5 Go compressés en tout) et sa table (.dbf) sont téléchargés et lus en
flux. Le calcul n'est refait que si les fichiers publiés changent (ou VERSION).

Sortie : web/data/chaleur/communes.json, lue par la couche communale (pipeline.communes).
"""

import argparse
import array
import datetime
import json
import math
import struct
import sys
import tempfile
import time
import urllib.request
import zlib
from pathlib import Path
from types import SimpleNamespace

from . import datagouv, db, geo
from .http import USER_AGENT, Http
from .util import communes as fetch_communes, norm_commune, position

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "chaleur" / "communes.json"
VERSION = 1
DATASET = "6641c562e5acdb35c0e6051d"  # Cartographie des LCZ des 93 territoires de plus de 50 000 habitants
RADIUS_M = 1000
STEP_M = 100
MIN_COVER = 0.5
DENSE = {"1", "2", "3"}
COLUMNS = ["lcz_mairie", "dense_1km", "mineral_1km", "arbres_1km", "couvert_1km"]
LCZ_LABELS = {
    "1": "ensemble compact de tours", "2": "ensemble compact d'immeubles", "3": "ensemble compact de maisons",
    "4": "ensemble de tours espacées", "5": "ensemble d'immeubles espacés", "6": "ensemble de maisons espacées",
    "7": "constructions légères denses", "8": "bâtiments bas de grande emprise", "9": "bâti diffus",
    "10": "industrie lourde", "A": "végétation arborée dense", "B": "arbres épars", "C": "végétation arbustive",
    "D": "végétation basse", "E": "sol imperméable nu", "F": "sol nu perméable", "G": "eau",
}
_KEY = 100_000  # clé d'un nœud de la grille d'échantillonnage : i * _KEY + j


# --- archives zip lues par morceaux ------------------------------------------------------------


def _range(url, start, end, retries=4):
    """Octets [start, end] d'un fichier distant (requête Range, réponse 206 exigée)."""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}",
                                                       "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=300) as r:
                if r.status != 206:
                    raise RuntimeError(f"le serveur ignore la requête Range (HTTP {r.status})")
                return r.read()
        except OSError:
            if attempt == retries:
                raise
            time.sleep(2 ** (attempt + 1))


def _range_to_file(url, start, end, path, retries=4):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}",
                                                       "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
                if r.status != 206:
                    raise RuntimeError(f"le serveur ignore la requête Range (HTTP {r.status})")
                while chunk := r.read(1 << 22):
                    f.write(chunk)
            if path.stat().st_size != end - start + 1:
                raise OSError(f"réponse tronquée : {path.stat().st_size} octets sur {end - start + 1}")
            return path
        except OSError:
            if attempt == retries:
                raise
            time.sleep(2 ** (attempt + 1))


def zip_members(url, size):
    """{nom: (décalage de l'en-tête local, taille compressée, taille, méthode)} d'après le répertoire central."""
    tail = _range(url, max(0, size - 65_536), size - 1)
    i = tail.rfind(b"PK\x05\x06")
    if i < 0:
        raise ValueError("fin de répertoire zip introuvable")
    cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
    if cd_off == 0xFFFFFFFF:  # zip64
        j = tail.rfind(b"PK\x06\x06")
        cd_size, cd_off = struct.unpack("<QQ", tail[j + 40:j + 56])
    start = size - len(tail)
    cd = tail[cd_off - start:cd_off - start + cd_size] if cd_off >= start else _range(url, cd_off, cd_off + cd_size - 1)
    out, k = {}, 0
    while cd[k:k + 4] == b"PK\x01\x02":
        method, = struct.unpack("<H", cd[k + 10:k + 12])
        csize, usize = struct.unpack("<II", cd[k + 20:k + 28])
        nlen, elen, clen = struct.unpack("<HHH", cd[k + 28:k + 34])
        off, = struct.unpack("<I", cd[k + 42:k + 46])
        name = cd[k + 46:k + 46 + nlen].decode("utf-8", "replace")
        extra = cd[k + 46 + nlen:k + 46 + nlen + elen]
        if 0xFFFFFFFF in (csize, usize, off):  # champs zip64 dans l'extra 0x0001, dans cet ordre
            e = 0
            while e + 4 <= len(extra):
                tag, ln = struct.unpack("<HH", extra[e:e + 4])
                if tag == 1:
                    vals = list(struct.unpack(f"<{ln // 8}Q", extra[e + 4:e + 4 + ln - ln % 8]))
                    if usize == 0xFFFFFFFF:
                        usize = vals.pop(0)
                    if csize == 0xFFFFFFFF:
                        csize = vals.pop(0)
                    if off == 0xFFFFFFFF:
                        off = vals.pop(0)
                e += 4 + ln
        out[name] = (off, csize, usize, method)
        k += 46 + nlen + elen + clen
    return out


def fetch_member(url, member, path):
    """Télécharge les données compressées d'un membre ; renvoie un itérateur de morceaux décompressés."""
    off, csize, usize, method = member
    head = _range(url, off, off + 29)
    if head[:4] != b"PK\x03\x04":
        raise ValueError("en-tête local zip inattendu")
    nlen, elen = struct.unpack("<HH", head[26:30])
    data = off + 30 + nlen + elen
    _range_to_file(url, data, data + csize - 1, path)
    if method not in (0, 8):
        raise ValueError(f"compression zip {method} non prise en charge")

    def chunks():
        d = zlib.decompressobj(-15) if method == 8 else None
        with open(path, "rb") as f:
            while block := f.read(1 << 22):
                yield d.decompress(block) if d else block
            if d:
                yield d.flush()
    return chunks()


# --- shapefile ---------------------------------------------------------------------------------


def dbf_table(data, fields):
    """Valeurs des champs demandés pour chaque enregistrement (liste de tuples)."""
    nrec, hlen, rlen = struct.unpack("<IHH", data[4:12])
    spec, off = {}, 1
    for i in range(32, hlen - 1, 32):
        f = data[i:i + 32]
        name = f[:11].split(b"\0")[0].decode("latin-1").lower()
        spec[name] = (off, f[16], chr(f[11]))
        off += f[16]
    missing = [f for f in fields if f not in spec]
    if missing:
        raise ValueError(f"champs absents de la table : {missing} (présents : {list(spec)})")
    out = []
    for k in range(nrec):
        rec = data[hlen + k * rlen: hlen + (k + 1) * rlen]
        row = []
        for f in fields:
            o, ln, t = spec[f]
            v = rec[o:o + ln].decode("latin-1").strip()
            row.append(v if t == "C" else (float(v) if v not in ("", "*" * ln) else None))
        out.append(tuple(row))
    return out


def shp_records(chunks):
    """(indice, boîte englobante, contenu) pour chaque enregistrement d'un .shp lu en flux."""
    buf, pos, idx = bytearray(), 0, 0
    it = iter(chunks)
    header = None
    for chunk in it:
        buf += chunk
        if header is None:
            if len(buf) < 100:
                continue
            code, = struct.unpack(">i", buf[:4])
            if code != 9994:
                raise ValueError("ce n'est pas un shapefile")
            header = struct.unpack("<4d", buf[36:68])
            yield -1, header, None
            pos = 100
        while len(buf) - pos >= 8:
            _, words = struct.unpack(">ii", buf[pos:pos + 8])
            end = pos + 8 + 2 * words
            if end > len(buf):
                break
            content = bytes(buf[pos + 8:end])
            stype, = struct.unpack("<i", content[:4])
            bbox = struct.unpack("<4d", content[4:36]) if stype else None
            yield idx, bbox, content
            idx += 1
            pos = end
        if pos > 1 << 24:
            del buf[:pos]
            pos = 0


def rings(content):
    """Anneaux d'un polygone shapefile : [(xs, ys)]."""
    nparts, npts = struct.unpack("<ii", content[36:44])
    parts = struct.unpack(f"<{nparts}i", content[44:44 + 4 * nparts])
    pts = array.array("d")
    pts.frombytes(content[44 + 4 * nparts:44 + 4 * nparts + 16 * npts])
    if sys.byteorder != "little":
        pts.byteswap()
    xs, ys = pts[0::2], pts[1::2]
    bounds = [*parts, npts]
    return [(xs[bounds[p]:bounds[p + 1]], ys[bounds[p]:bounds[p + 1]]) for p in range(nparts)]


def scanline(polygon, step):
    """Nœuds (i, j) de la grille de pas `step` situés dans le polygone (règle pair-impair, trous compris)."""
    cross = {}
    for xs, ys in polygon:
        for q in range(len(xs) - 1):
            y1, y2 = ys[q], ys[q + 1]
            if y1 == y2:
                continue
            lo, hi = (y1, y2) if y1 < y2 else (y2, y1)
            jl, jh = lo // step, hi // step
            j0 = int(jl) if jl * step == lo else int(jl) + 1  # rangées y = j·step avec lo ≤ y < hi
            j1 = int(jh) - 1 if jh * step == hi else int(jh)
            if j0 > j1:
                continue
            x1, k = xs[q], (xs[q + 1] - xs[q]) / (y2 - y1)
            for j in range(j0, j1 + 1):
                cross.setdefault(j, []).append(x1 + (j * step - y1) * k)
    for j, xs_ in cross.items():
        xs_.sort()
        for a, b in zip(xs_[0::2], xs_[1::2]):
            # intervalle semi-ouvert [a, b[ comme les rangées : un nœud sur la limite commune de deux
            # îlots voisins n'est compté qu'une fois
            for i in range(math.ceil(a / step), math.ceil(b / step)):
                yield i, j


def inside(polygon, x, y):
    """Point dans le polygone (nombre de croisements, tous anneaux confondus)."""
    c = False
    for xs, ys in polygon:
        for q in range(len(xs) - 1):
            y1, y2 = ys[q], ys[q + 1]
            if (y1 > y) != (y2 > y) and x < xs[q] + (y - y1) * (xs[q + 1] - xs[q]) / (y2 - y1):
                c = not c
    return c


# --- calcul par territoire ---------------------------------------------------------------------


class Disc:
    """Accumulateurs d'une commune : nœuds du disque, nœuds couverts, sommes des indicateurs."""
    __slots__ = ("code", "x", "y", "total", "n", "dense", "mineral", "arbres", "lcz")

    def __init__(self, code, x, y):
        self.code, self.x, self.y = code, x, y
        self.total = self.n = 0
        self.dense = self.mineral = self.arbres = 0.0
        self.lcz = None


def territory(url, size, discs, workdir, log=print):
    """Ajoute aux disques des communes les nœuds couverts par le territoire de l'archive `url`."""
    members = zip_members(url, size)
    shp = next(n for n in members if n.lower().endswith(".shp"))
    dbf = next(n for n in members if n.lower().endswith(".dbf"))
    table = dbf_table(b"".join(fetch_member(url, members[dbf], workdir / "t.dbf")),
                      ["lcz", "bur", "ror", "ver", "vhr"])
    records = shp_records(fetch_member(url, members[shp], workdir / "t.shp"))
    _, (xmin, ymin, xmax, ymax), _ = next(records)
    R = RADIUS_M
    mine = [d for d in discs if xmin - R <= d.x <= xmax + R and ymin - R <= d.y <= ymax + R]
    nodes, coarse, town = {}, set(), {}
    for d in mine:
        town.setdefault((int(d.x // 1000), int(d.y // 1000)), []).append(d)
        for i in range(math.ceil((d.x - R) / STEP_M), math.floor((d.x + R) / STEP_M) + 1):
            for j in range(math.ceil((d.y - R) / STEP_M), math.floor((d.y + R) / STEP_M) + 1):
                if math.hypot(i * STEP_M - d.x, j * STEP_M - d.y) <= R:
                    nodes.setdefault(i * _KEY + j, []).append(d)
                    coarse.add((i * STEP_M // 1000, j * STEP_M // 1000))
    seen = 0
    for idx, bbox, content in records:
        seen += 1
        if bbox is None:  # forme nulle : une ligne de table sans géométrie
            continue
        bx0, by0, bx1, by1 = bbox
        cells = [(ci, cj) for ci in range(int(bx0 // 1000), int(bx1 // 1000) + 1)
                 for cj in range(int(by0 // 1000), int(by1 // 1000) + 1)]
        has_nodes = any(c in coarse for c in cells)
        towns = [d for c in cells for d in town.get(c, ()) if bx0 <= d.x <= bx1 and by0 <= d.y <= by1]
        if not has_nodes and not towns:
            continue
        lcz, bur, ror, ver, vhr = table[idx]
        poly = rings(content)
        if has_nodes:
            mineral = (bur or 0) + (ror or 0)
            arbres = (ver or 0) * (vhr or 0) / 100
            dense = lcz in DENSE
            for i, j in scanline(poly, STEP_M):
                for d in nodes.get(i * _KEY + j, ()):
                    d.n += 1
                    d.mineral += mineral
                    d.arbres += arbres
                    d.dense += dense
        for d in towns:
            if d.lcz is None and inside(poly, d.x, d.y):
                d.lcz = lcz
    if seen != len(table):
        raise ValueError(f"{seen} formes pour {len(table)} lignes de table")
    for f in workdir.glob("t.*"):
        f.unlink()
    return len(mine), seen


def build(ctx, workdir, force=False):
    ds = datagouv.dataset(ctx.http, DATASET)
    zips = sorted((r for r in ds["resources"] if r.get("format") == "zip" and r["title"].startswith("lcz-spot-")),
                  key=lambda r: r["title"])
    if len(zips) < 80:
        raise ValueError(f"{len(zips)} archives LCZ seulement")
    urls = {r["title"]: r["url"] for r in zips}
    try:
        old = json.loads(OUT.read_text("utf-8"))
    except (OSError, ValueError):
        old = {}
    if not force and old.get("version") == VERSION and old.get("urls") == urls:
        ctx.log("  archives LCZ inchangées depuis la dernière génération : rien à faire")
        return None
    # communes au moins en partie couvertes (fichier du Cerema) ; disque placé à la mairie
    cover = datagouv.resource(ctx.http, DATASET, url_pattern=r"couverture-lcz.*\.csv$")
    covered = {norm_commune(r["insee_commune"]) for r in ctx.http.csv(cover["url"], delimiter=";")
               if float(r.get("couverture_lcz") or 0) > 0}
    ctx.log(f"  {len(covered)} communes au moins en partie couvertes")
    discs = []
    for c in fetch_communes(ctx):
        pos = position(c)
        if c.get("code") in covered and pos:
            x, y = geo.lambert93(*pos)
            d = Disc(c["code"], x, y)
            d.total = sum(1 for i in range(math.ceil((x - RADIUS_M) / STEP_M), math.floor((x + RADIUS_M) / STEP_M) + 1)
                          for j in range(math.ceil((y - RADIUS_M) / STEP_M), math.floor((y + RADIUS_M) / STEP_M) + 1)
                          if math.hypot(i * STEP_M - x, j * STEP_M - y) <= RADIUS_M)
            discs.append(d)
    t_all = time.time()
    for r in zips:
        t0 = time.time()
        n, shapes = territory(r["url"], r["filesize"], discs, workdir, ctx.log)
        ctx.log(f"  {r['title']} : {shapes} îlots, {n} communes, {time.time() - t0:.0f}s")
    rows = {}
    for d in discs:
        share = d.n / d.total if d.total else 0
        vals = [d.lcz, None, None, None, round(100 * min(1.0, share), 1)]
        if share >= MIN_COVER:
            vals[1:4] = [round(100 * d.dense / d.n, 1), round(d.mineral / d.n, 1), round(d.arbres / d.n, 1)]
        if d.lcz is not None or share >= MIN_COVER:
            rows[d.code] = vals
    full = sum(1 for v in rows.values() if v[1] is not None)
    ctx.log(f"  {full} communes avec les parts à {RADIUS_M} m, {len(rows)} avec au moins la classe de la mairie, "
            f"{time.time() - t_all:.0f}s")
    if full < 5_000:
        raise ValueError(f"{full} communes seulement")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "version": VERSION,
        "generated_at": db.now(),
        "urls": urls,
        "dataset": {"title": ds["title"], "page": ds.get("page"), "last_modified": (ds.get("last_modified") or "")[:10]},
        "radius_m": RADIUS_M,
        "step_m": STEP_M,
        "labels": LCZ_LABELS,
        "columns": COLUMNS,
        "rows": rows,
    }, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return len(rows)


def load():
    """({commune: {colonne: valeur}}, méta) depuis la dernière génération, ou ({}, None)."""
    try:
        d = json.loads(OUT.read_text("utf-8"))
    except (OSError, ValueError):
        return {}, None
    cols = d.get("columns", COLUMNS)
    return {c: dict(zip(cols, v)) for c, v in d.get("rows", {}).items()}, d


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true")
    p.add_argument("--db", default=ROOT / "data" / "carteplan.sqlite", type=Path)
    args = p.parse_args(argv)
    ctx = SimpleNamespace(http=Http(), log=print, today=datetime.date.today(), memo={})
    con = db.connect(args.db)
    started = db.now()
    with tempfile.TemporaryDirectory(prefix="carteplan-lcz-") as tmp:
        try:
            n = build(ctx, Path(tmp), force=args.force)
            if n is not None:
                db.log_run(con, "chaleur", started, "ok", n)
                print(f"{n} communes → {OUT}")
            code = 0
        except Exception as e:  # noqa: BLE001
            db.log_run(con, "chaleur", started, "error", 0, f"{type(e).__name__}: {e}")
            print(f"ERREUR : {type(e).__name__}: {e}")
            code = 1
    con.commit()
    con.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
