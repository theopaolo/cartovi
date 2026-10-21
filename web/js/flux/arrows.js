// arrows.js — champ de flèches statiques sur un canvas 2D : vue de secours (pas de WebGL2) et vue figée
// quand l'utilisateur demande moins de mouvement (prefers-reduced-motion). Même champ, même interpolation que les particules.
import { SPEED_MAX } from './colors.js';

const SPACING = 30; // écart entre flèches, en pixels CSS
const MIN_SPACING = 22;

export function createArrows(canvas, flux, maille) {
  const ctx = canvas.getContext('2d');
  const out = [0, 0];
  let vecs = new Float32Array(0); // (vx, vy, nuance de distance) par flèche, rempli avant le tracé
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  function resize(w, h, ratio) {
    cssW = w;
    cssH = h;
    dpr = ratio;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }

  /**
   * @param {number} t position dans le temps, en images
   * @param {{bucketCss: string[], buckets: number}} theme
   * @param {boolean} dim estompe les flèches loin d'un nœud (couche « interpolation »)
   */
  function draw(t, theme, dim) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!cssW) return;
    const gap = cssW < 480 ? MIN_SPACING : SPACING;
    const cols = Math.floor(cssW / gap);
    const rows = Math.floor(cssH / gap);
    const n = cols * rows;
    if (vecs.length < n * 3) vecs = new Float32Array(n * 3);
    const ox = (cssW - (cols - 1) * gap) / 2;
    const oy = (cssH - (rows - 1) * gap) / 2;
    const sx = flux.W / cssW;
    const sy = flux.H / cssH;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3;
        const ux = (ox + i * gap) * sx;
        const uy = (oy + j * gap) * sy;
        flux.windAt(ux, uy, t, out);
        vecs[k] = out[0];
        vecs[k + 1] = out[1];
        vecs[k + 2] = dim && maille.nearest(ux, uy).units * flux.kmPerUnit > 18 ? 1 : 0;
      }
    }
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const maxLen = gap * 0.9;
    for (let b = 0; b < theme.buckets; b++) {
      for (let faint = 0; faint < (dim ? 2 : 1); faint++) {
        ctx.strokeStyle = theme.bucketCss[b];
        ctx.globalAlpha = faint ? 0.3 : 1;
        ctx.beginPath();
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const k = (j * cols + i) * 3;
            const sp = Math.hypot(vecs[k], vecs[k + 1]);
            if (sp < 0.05) continue; // vent nul : pas de direction à montrer
            if (Math.min(theme.buckets - 1, Math.floor((sp / SPEED_MAX) * theme.buckets)) !== b || vecs[k + 2] !== faint) continue;
            const len = Math.max(5, Math.min(1, sp / 10) * maxLen);
            const dx = vecs[k] / sp;
            const dy = vecs[k + 1] / sp;
            const cx = ox + i * gap;
            const cy = oy + j * gap;
            const x0 = cx - (dx * len) / 2;
            const y0 = cy - (dy * len) / 2;
            const x1 = cx + (dx * len) / 2;
            const y1 = cy + (dy * len) / 2;
            const head = Math.min(5, len * 0.4);
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            // pointe : deux traits à ±28° de l'axe
            ctx.moveTo(x1 - head * (dx * 0.883 - dy * 0.469), y1 - head * (dy * 0.883 + dx * 0.469));
            ctx.lineTo(x1, y1);
            ctx.lineTo(x1 - head * (dx * 0.883 + dy * 0.469), y1 - head * (dy * 0.883 - dx * 0.469));
          }
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize,
    draw,
    clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
