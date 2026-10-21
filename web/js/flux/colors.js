// colors.js — jetons CSS → couleurs pour WebGL et canvas 2D. Relus à l'init et à chaque changement de thème,
// pour que les particules, les flèches et les hachures suivent le clair/sombre sans palette dupliquée en JS.
import { rafThrottle } from '../dom.js';

// Rampe de vitesse : la rampe séquentielle de la page Départements (--s3 → --s5, qui s'éclaircit en thème sombre),
// prolongée par --hub (terre brûlée / ambre) pour les vents de tempête. On part de --s3 et non de --s2 : le plus clair
// des bleus disparaîtrait sur le fond de carte en thème clair. Le calme reste discret, le fort ressort.
const RAMP_TOKENS = ['--s3', '--s4', '--s5', '--hub'];
export const SPEED_MAX = 16; // m/s au bout de la rampe
const BUCKETS = 8;

const probe = document.createElement('canvas');
probe.width = probe.height = 1;
const pctx = probe.getContext('2d', { willReadFrequently: true });

/** Valeur d'un jeton CSS (hex, rgb(), rgba()…) → [r, g, b, a] avec a dans 0–255. */
export function cssColor(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  pctx.clearRect(0, 0, 1, 1);
  pctx.fillStyle = '#808080'; // repli : une valeur invalide laisse celle-ci en place
  pctx.fillStyle = raw || '#808080';
  pctx.fillRect(0, 0, 1, 1);
  return [...pctx.getImageData(0, 0, 1, 1).data];
}

const rgb = (c) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** Rampe de 256 pixels RGBA (interpolation linéaire entre les jetons). */
function buildRamp(stops) {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (stops.length - 1);
    const k = Math.min(Math.floor(x), stops.length - 2);
    const f = x - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Tout ce que les canvas ont besoin de savoir du thème courant. */
export function readTheme() {
  const stops = RAMP_TOKENS.map(cssColor);
  const ramp = buildRamp(stops);
  const bucketCss = Array.from({ length: BUCKETS }, (_, b) => {
    const i = Math.round(((b + 0.5) / BUCKETS) * 255);
    return `rgb(${ramp[i * 4]} ${ramp[i * 4 + 1]} ${ramp[i * 4 + 2]})`;
  });
  return {
    ramp,
    rampCss: stops.map(rgb),
    bucketCss,
    hatch: cssColor('--hatch-line'),
    buckets: BUCKETS,
  };
}

/** Appelle cb à chaque changement de thème (réglage du système ou attribut data-theme). */
export function watchTheme(cb) {
  const run = rafThrottle(cb);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', run);
  new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
