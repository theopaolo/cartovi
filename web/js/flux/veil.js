// veil.js — « ce qui est interpolé », en hachures. Un canvas 2D posé sur les particules : des hachures à 45°
// (le même motif que « donnée manquante » sur la page Départements) dont l'opacité croît avec la distance au
// nœud de données le plus proche. Autour d'un nœud, la carte reste nette : c'est là que l'information est réelle.
// Le motif est tracé une fois, puis multiplié par la carte de distance (destination-in) : aucun calcul par pixel en JS.
const PERIOD = 7; // pas des hachures, en pixels CSS
const MAX_ALPHA = 0.5;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createVeil(canvas, dist) {
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');

  // carte de distance → canal alpha d'une petite image, agrandie ensuite avec lissage bilinéaire
  const field = document.createElement('canvas');
  field.width = dist.w;
  field.height = dist.h;
  const img = new ImageData(dist.w, dist.h);
  for (let i = 0; i < dist.data.length; i++) img.data[i * 4 + 3] = Math.round(255 * MAX_ALPHA * smoothstep(0.12, 0.85, dist.data[i] / 255));
  field.getContext('2d').putImageData(img, 0, 0);

  let on = false;
  let color = [128, 128, 128];
  let w = 0;
  let h = 0;
  let dpr = 1;

  function tile() {
    const p = Math.round(PERIOD * dpr);
    const t = document.createElement('canvas');
    t.width = t.height = p;
    const c = t.getContext('2d');
    c.strokeStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
    c.lineWidth = Math.max(1, dpr * 1.1);
    c.beginPath();
    // trois segments : la diagonale et ses deux voisines coupées, pour que le motif se raccorde d'une tuile à l'autre
    c.moveTo(0, p);
    c.lineTo(p, 0);
    c.moveTo(-p / 2, p / 2);
    c.lineTo(p / 2, -p / 2);
    c.moveTo(p / 2, (3 * p) / 2);
    c.lineTo((3 * p) / 2, p / 2);
    c.stroke();
    return t;
  }

  function render() {
    ctx.clearRect(0, 0, w, h);
    if (!on || !w) return;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, w, h);
    lctx.fillStyle = lctx.createPattern(tile(), 'repeat');
    lctx.fillRect(0, 0, w, h);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = 'high';
    lctx.drawImage(field, 0, 0, w, h);
    ctx.drawImage(layer, 0, 0);
  }

  return {
    resize(cssW, cssH, ratio) {
      dpr = ratio;
      w = canvas.width = layer.width = Math.round(cssW * ratio);
      h = canvas.height = layer.height = Math.round(cssH * ratio);
      render();
    },
    setColor(rgba) {
      color = rgba;
      render();
    },
    setVisible(v) {
      on = v;
      render();
    },
  };
}
