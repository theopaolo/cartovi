// maille.js — « la maille » : les nœuds où le modèle a réellement été interrogé (grille de 0,5°).
// Tout ce qui n'est pas un nœud est de l'interpolation. Ce module répond à trois questions :
// quel nœud est le plus proche ? (lecture au pointeur) ; à quelle distance, partout ? (carte de distance pour
// l'affichage de l'interpolation) ; quelle est l'aire d'influence de chaque nœud ? (cellules de Voronoï).
const CELL = 50; // côté des cases de la grille de recherche, en unités SVG (> écart entre nœuds)
export const DIST_MAX_KM = 35; // distance au-delà de laquelle l'interpolation est « à son maximum » (demi-diagonale d'une maille ≈ 34 km)

export function createMaille(nodes, { W, H, kmPerUnit }) {
  const n = nodes.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  nodes.forEach(([x, y], i) => {
    xs[i] = x;
    ys[i] = y;
  });

  // grille de recherche : de -2 à W/H + 2 cases, les nœuds de la marge y comptent aussi
  const ORIGIN = -2 * CELL;
  const cols = Math.ceil(W / CELL) + 5;
  const rows = Math.ceil(H / CELL) + 5;
  const buckets = Array.from({ length: cols * rows }, () => []);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((xs[i] - ORIGIN) / CELL);
    const cy = Math.floor((ys[i] - ORIGIN) / CELL);
    if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) buckets[cy * cols + cx].push(i);
  }

  const found = { index: -1, units: Infinity };

  /** Nœud le plus proche de (x, y). Résultat dans l'objet partagé `found` (pas d'allocation). */
  function nearest(x, y) {
    const cx = Math.floor((x - ORIGIN) / CELL);
    const cy = Math.floor((y - ORIGIN) / CELL);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r < 8; r++) {
      for (let j = cy - r; j <= cy + r; j++) {
        if (j < 0 || j >= rows) continue;
        for (let i = cx - r; i <= cx + r; i++) {
          if (i < 0 || i >= cols || (r > 0 && Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r)) continue;
          for (const k of buckets[j * cols + i]) {
            const d = (xs[k] - x) ** 2 + (ys[k] - y) ** 2;
            if (d < bd) {
              bd = d;
              best = k;
            }
          }
        }
      }
      if (best >= 0 && Math.sqrt(bd) <= r * CELL) break; // rien de plus proche dans les anneaux suivants
    }
    found.index = best;
    found.units = Math.sqrt(bd);
    return found;
  }

  /**
   * Carte de distance w×h (octets, rangée de haut en bas) : 0 sur un nœud, 255 à DIST_MAX_KM ou plus.
   * Sert au GPU (atténuation des particules) et au canvas 2D (hachures).
   */
  function distanceField(w, h) {
    const out = new Uint8Array(w * h);
    const maxUnits = DIST_MAX_KM / kmPerUnit;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        nearest(((i + 0.5) * W) / w, ((j + 0.5) * H) / h);
        out[j * w + i] = Math.round(255 * Math.min(1, found.units / maxUnits));
      }
    }
    return { w, h, data: out };
  }

  /** Coupe un polygone par le demi-plan des points plus proches de a que de b (Sutherland–Hodgman). */
  function clip(poly, ax, ay, bx, by) {
    const nx = bx - ax;
    const ny = by - ay;
    const c = (nx * (ax + bx) + ny * (ay + by)) / 2;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = nx * p[0] + ny * p[1] - c;
      const dq = nx * q[0] + ny * q[1] - c;
      if (dp <= 0) out.push(p);
      if (dp <= 0 !== dq <= 0) {
        const t = dp / (dp - dq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return out;
  }

  /** Contours des cellules de Voronoï (aire où chaque nœud est le plus proche), en un seul tracé SVG. */
  function cellsPath(margin = 30) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      if (xs[i] < -CELL || xs[i] > W + CELL || ys[i] < -CELL || ys[i] > H + CELL) continue;
      let poly = [
        [-margin, -margin],
        [W + margin, -margin],
        [W + margin, H + margin],
        [-margin, H + margin],
      ];
      const cx = Math.floor((xs[i] - ORIGIN) / CELL);
      const cy = Math.floor((ys[i] - ORIGIN) / CELL);
      for (let j = cy - 2; j <= cy + 2 && poly.length; j++) {
        for (let k = cx - 2; k <= cx + 2 && poly.length; k++) {
          if (j < 0 || j >= rows || k < 0 || k >= cols) continue;
          for (const o of buckets[j * cols + k]) if (o !== i) poly = clip(poly, xs[i], ys[i], xs[o], ys[o]);
        }
      }
      if (poly.length > 2) parts.push(`M${poly.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`);
    }
    return parts.join('');
  }

  return { count: n, xs, ys, nearest, distanceField, cellsPath, kmPerUnit };
}
