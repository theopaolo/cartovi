// data.js — vent.json : chargement, décodage et lecture du champ côté CPU.
// Le GPU échantillonne le même champ pour les particules ; windAt() refait le même calcul (bilinéaire dans l'espace,
// linéaire dans le temps) pour la lecture au pointeur et les flèches statiques, afin que le chiffre affiché soit celui qu'on voit.
import { getJSON } from '../data.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function decodeBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** vent.json → champ prêt à l'emploi. Lève une erreur si la structure ne correspond pas au contrat. */
export async function loadFlux() {
  const raw = await getJSON('data/flux/vent.json');
  const g = raw?.grid;
  if (!g || !Array.isArray(raw.times) || typeof raw.data_b64 !== 'string' || !Array.isArray(raw.source_grid?.nodes)) {
    throw new Error('vent.json : structure inattendue');
  }
  const bytes = decodeBase64(raw.data_b64);
  const frames = raw.times.length;
  if (frames < 2 || bytes.length !== frames * g.nx * g.ny * 2) throw new Error('vent.json : taille du champ incohérente');
  const [, , W, H] = String(raw.viewBox || '0 0 1000 931').split(/\s+/).map(Number);
  return createField(raw, bytes, { W, H });
}

function createField(raw, bytes, { W, H }) {
  const { nx, ny, dx, dy, quant_ms: quant } = raw.grid;
  const frames = raw.times.length;
  const last = frames - 1;
  const every = raw.every_hours || 3;
  const v8 = new Int8Array(bytes.buffer); // composantes signées, quant_ms m/s par unité
  const times = raw.times.map((t) => Date.parse(t));

  /** Vent (m/s, axes de l'écran : x vers la droite, y vers le bas) en (x, y) à l'image fractionnaire t. Écrit dans out. */
  function windAt(x, y, t, out) {
    const fx = clamp(x / dx - 0.5, 0, nx - 1); // le centre de la cellule (i, j) est en ((i + 0.5)·dx, (j + 0.5)·dy)
    const fy = clamp(y / dy - 0.5, 0, ny - 1);
    const i0 = Math.min(Math.floor(fx), nx - 2);
    const j0 = Math.min(Math.floor(fy), ny - 2);
    const ax = fx - i0;
    const ay = fy - j0;
    const f0 = clamp(Math.floor(t), 0, last);
    const f1 = Math.min(f0 + 1, last);
    const k = clamp(t - f0, 0, 1);
    const w00 = (1 - ax) * (1 - ay);
    const w10 = ax * (1 - ay);
    const w01 = (1 - ax) * ay;
    const w11 = ax * ay;
    const o0 = (f0 * ny + j0) * nx + i0;
    const o1 = (f1 * ny + j0) * nx + i0;
    for (let c = 0; c < 2; c++) {
      const a = w00 * v8[o0 * 2 + c] + w10 * v8[(o0 + 1) * 2 + c] + w01 * v8[(o0 + nx) * 2 + c] + w11 * v8[(o0 + nx + 1) * 2 + c];
      const b = w00 * v8[o1 * 2 + c] + w10 * v8[(o1 + 1) * 2 + c] + w01 * v8[(o1 + nx) * 2 + c] + w11 * v8[(o1 + nx + 1) * 2 + c];
      out[c] = (a * (1 - k) + b * k) * quant;
    }
    return out;
  }

  // image la plus ventée (vitesse moyenne sur le champ) : point de départ de la vue figée quand l'animation est refusée
  let windiest = 0;
  let best = -1;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let k = 0; k < nx * ny; k++) sum += Math.hypot(v8[(f * nx * ny + k) * 2], v8[(f * nx * ny + k) * 2 + 1]);
    if (sum > best) {
      best = sum;
      windiest = f;
    }
  }

  return {
    W,
    H,
    nx,
    ny,
    dx,
    dy,
    quant,
    frames,
    last,
    everyHours: every,
    times, // ms depuis 1970, une valeur par image
    spanHours: last * every,
    windiest,
    kmPerUnit: raw.km_per_unit || 1.164,
    nodes: raw.source_grid.nodes,
    stepDeg: raw.source_grid.step_deg,
    ppi: raw.ppi || [],
    source: raw.source || {},
    variable: raw.variable || 'vent à 10 m',
    generatedAt: raw.generated_at,
    bytes,
    windAt,
  };
}
