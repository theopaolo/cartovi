"""Géométrie sans dépendance : projection Lambert-93, aires, point-dans-polygone, SVG.

Pourquoi pas SpatiaLite/GEOS : toutes les sources utilisées sont indexées par
code INSEE (jointure attributaire, pas spatiale). Les seuls calculs spatiaux
(couverture des zones PPI nucléaires, points d'échantillonnage climat) se
font sur ~15 000 sommets : quelques fonctions pures suffisent, et le pipeline
reste exécutable partout avec la seule bibliothèque standard Python.
"""

from math import atan, cos, degrees, log, pi, radians, sin, sqrt, tan

# EPSG:2154 — Lambert conique conforme 2SP sur l'ellipsoïde GRS80.
_A = 6378137.0
_E = 0.0818191910428158
_LON0 = radians(3.0)
_X0, _Y0 = 700000.0, 6600000.0


def _m(phi):
    return cos(phi) / sqrt(1 - (_E * sin(phi)) ** 2)


def _t(phi):
    es = _E * sin(phi)
    return tan(pi / 4 - phi / 2) / ((1 - es) / (1 + es)) ** (_E / 2)


_P1, _P2, _P0 = radians(49.0), radians(44.0), radians(46.5)
_N = (log(_m(_P1)) - log(_m(_P2))) / (log(_t(_P1)) - log(_t(_P2)))
_F = _m(_P1) / (_N * _t(_P1) ** _N)
_RHO0 = _A * _F * _t(_P0) ** _N


def lambert93(lon, lat):
    """WGS84 (degrés) -> Lambert-93 (mètres)."""
    rho = _A * _F * _t(radians(lat)) ** _N
    theta = _N * (radians(lon) - _LON0)
    return _X0 + rho * sin(theta), _Y0 + _RHO0 - rho * cos(theta)


def wgs84(x, y):
    """Lambert-93 (mètres) -> WGS84 (lon, lat en degrés), par itération."""
    dx, dy = x - _X0, _RHO0 - (y - _Y0)
    rho = sqrt(dx * dx + dy * dy)
    theta = atan(dx / dy)
    t = (rho / (_A * _F)) ** (1 / _N)
    phi = pi / 2 - 2 * atan(t)
    for _ in range(10):
        es = _E * sin(phi)
        phi = pi / 2 - 2 * atan(t * ((1 - es) / (1 + es)) ** (_E / 2))
    return degrees(theta / _N + _LON0), degrees(phi)


def polygons(geometry):
    """Normalise Polygon / MultiPolygon en liste de polygones (liste d'anneaux)."""
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"géométrie non gérée : {geometry['type']}")


def project_polygons(polys):
    return [[[lambert93(lon, lat) for lon, lat in ring] for ring in poly] for poly in polys]


def ring_area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2


def area(polys):
    """Aire (unité² de la projection) : extérieur moins trous."""
    total = 0.0
    for poly in polys:
        total += abs(ring_area(poly[0])) - sum(abs(ring_area(r)) for r in poly[1:])
    return total


def centroid(polys):
    """Centroïde surfacique du plus grand polygone (évite les îles)."""
    ring = max((p[0] for p in polys), key=lambda r: abs(ring_area(r)))
    a = ring_area(ring)
    cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        k = x1 * y2 - x2 * y1
        cx += (x1 + x2) * k
        cy += (y1 + y2) * k
    return cx / (6 * a), cy / (6 * a)


def bbox(polys):
    xs = [x for p in polys for x, _ in p[0]]
    ys = [y for p in polys for _, y in p[0]]
    return min(xs), min(ys), max(xs), max(ys)


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def contains(polys, x, y):
    for poly in polys:
        if _in_ring(x, y, poly[0]) and not any(_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


def interior_point(polys, step=2000.0):
    """Point garanti à l'intérieur : centroïde s'il convient, sinon le point
    de grille le plus proche du centroïde parmi ceux qui sont dedans."""
    cx, cy = centroid(polys)
    if contains(polys, cx, cy):
        return cx, cy
    x0, y0, x1, y1 = bbox(polys)
    best = None
    y = y0
    while y <= y1:
        x = x0
        while x <= x1:
            if contains(polys, x, y):
                d = (x - cx) ** 2 + (y - cy) ** 2
                if best is None or d < best[0]:
                    best = (d, x, y)
            x += step
        y += step
    return best[1], best[2]


def svg_path(polys, transform, precision=1):
    """Chemin SVG (anneaux fermés, règle evenodd côté client pour les trous)."""
    out = []
    for poly in polys:
        for ring in poly:
            pts = [transform(x, y) for x, y in ring]
            # supprime les doublons consécutifs créés par l'arrondi
            dedup = [pts[0]]
            for p in pts[1:]:
                if (round(p[0], precision), round(p[1], precision)) != (
                    round(dedup[-1][0], precision),
                    round(dedup[-1][1], precision),
                ):
                    dedup.append(p)
            if len(dedup) < 3:
                continue
            fmt = f"{{:.{precision}f}}"
            out.append(
                "M" + "L".join(f"{fmt.format(x)},{fmt.format(y)}" for x, y in dedup) + "Z"
            )
    return "".join(out)


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = p2 - p1, radians(lon2 - lon1)
    h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371.0088 * atan(sqrt(h) / sqrt(1 - h)) if h < 1 else pi * 6371.0088
