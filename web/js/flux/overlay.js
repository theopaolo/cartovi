// overlay.js — les limites tracées en SVG, par-dessus ou sous les particules :
//   createBase    : fond de carte (silhouette des départements), sous les particules
//   createLimits  : contours de départements, cercles PPI, cellules et croix de la maille, point de lecture
// Les couleurs viennent des classes CSS (jetons du thème) : rien n'est repeint au changement de thème.
// SVG plutôt que canvas : peu d'éléments (96 + 19 + 3 tracés), contours nets à toute taille, pas de calcul à chaque image.
import { s } from '../dom.js';

const crossArm = (cssW) => Math.min(3, Math.max(1.8, cssW * 0.0065)); // demi-longueur des croix, en pixels écran : plus petites sur petit écran

/** M x,y L … Z (coordonnées absolues seulement, comme map.json) → anneaux [x0, y0, x1, y1, …] et boîte englobante. */
function parseRings(d) {
  const rings = [];
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const sub of d.split('M').slice(1)) {
    const nums = sub.replace(/[LZ]/g, ' ').trim().split(/[\s,]+/).map(Number);
    rings.push(nums);
    for (let i = 0; i < nums.length; i += 2) {
      box[0] = Math.min(box[0], nums[i]);
      box[1] = Math.min(box[1], nums[i + 1]);
      box[2] = Math.max(box[2], nums[i]);
      box[3] = Math.max(box[3], nums[i + 1]);
    }
  }
  return { rings, box };
}

/** Point dans un polygone à anneaux multiples, règle pair-impair (comme fill-rule: evenodd). */
function inside(rings, x, y) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    }
  }
  return c;
}

const dot = (x, y) => `M${x} ${y}h0`; // point rond de largeur fixe en pixels (trait non mis à l'échelle)

/** Silhouette des départements : le sol, sous les particules. Trait de la même couleur que le fond pour fermer les joints. */
export function createBase(deps, viewBox) {
  const svg = s('svg', { class: 'flux-layer flux-base', viewBox, 'aria-hidden': 'true', focusable: 'false' });
  const g = s('g', {});
  for (const t of deps) g.append(s('path', { d: t.path, 'fill-rule': 'evenodd' }));
  svg.append(g);
  return svg;
}

/**
 * @param {{flux: object, deps: object[], maille: object, tip: HTMLElement, host: HTMLElement}} o
 *   host : le conteneur positionné où s'affiche l'infobulle des cercles PPI
 */
export function createLimits({ flux, deps, maille, tip, host }) {
  const { W, H } = flux;
  const svg = s('svg', { class: 'flux-layer flux-limits', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });

  // départements : contours seulement ; la recherche « dans quel département ? » se fait sur les coordonnées
  const parsed = deps.map((t) => ({ t, ...parseRings(t.path) }));
  const gDeps = s('g', { class: 'lim-deps' }, deps.map((t) => s('path', { d: t.path, 'fill-rule': 'evenodd' })));

  const cells = s('path', { class: 'lim-cells', d: maille.cellsPath() });
  const nodes = s('path', { class: 'lim-nodes' });

  // cercles PPI : rayon exact en unités SVG (20 km) ; un repère au centre, avec une zone de toucher plus large que le dessin
  const gPpi = s('g', { class: 'lim-ppi' });
  const marks = flux.ppi.map((p, i) => {
    gPpi.append(s('circle', { class: 'lim-ring', cx: p.x, cy: p.y, r: p.r }), s('path', { class: 'lim-mark', d: dot(p.x, p.y) }));
    return s('path', { class: 'lim-hit', d: dot(p.x, p.y), 'data-i': i });
  });
  gPpi.append(...marks);

  // point de lecture : trait vers le nœud le plus proche, anneau sur ce nœud, puis le point lui-même
  const pLine = s('line', { class: 'pr-line' });
  const pNode = s('circle', { class: 'pr-node' });
  const pHalo = s('path', { class: 'pr-halo' });
  const pDot = s('path', { class: 'pr-dot' });
  const gProbe = s('g', { class: 'lim-probe', hidden: true }, pLine, pNode, pHalo, pDot);

  svg.append(gDeps, cells, gPpi, nodes, gProbe);

  // ---------- coordonnées : pixels écran ↔ unités SVG ----------
  let scale = 1; // pixels CSS par unité SVG
  const toUnits = (e) => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  // ---------- infobulle des cercles PPI ----------
  function showTip(i) {
    const p = flux.ppi[i];
    tip.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = p.name;
    const sub = document.createElement('span');
    sub.textContent = `Périmètre PPI de ${Math.round(p.r * flux.kmPerUnit)} km`;
    tip.append(name, sub);
    tip.hidden = false;
    const x = p.x * scale + 12;
    const y = p.y * scale + 12;
    tip.style.left = `${Math.max(4, Math.min(x, host.clientWidth - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(y, host.clientHeight - tip.offsetHeight - 4))}px`;
    svg.querySelectorAll('.lim-ring')[i].classList.add('on');
  }
  function hideTip() {
    tip.hidden = true;
    for (const r of svg.querySelectorAll('.lim-ring.on')) r.classList.remove('on');
  }
  for (const m of marks) {
    const i = Number(m.dataset.i);
    m.addEventListener('pointerenter', () => showTip(i));
    m.addEventListener('pointerleave', hideTip);
    m.addEventListener('click', () => showTip(i)); // toucher : l'infobulle reste jusqu'au prochain geste
  }

  return {
    svg,
    onPointer({ onHover, onLeave, onPick }) {
      svg.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'touch') onHover(...toUnits(e));
      });
      svg.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'touch') onLeave();
      });
      svg.addEventListener('click', (e) => {
        if (!e.target.closest('.lim-hit')) hideTip();
        onPick(...toUnits(e));
      });
    },
    /** Couches visibles : { deps, ppi, maille }. Les repères PPI restent actifs seulement si leur couche l'est. */
    setLayers(l) {
      svg.classList.toggle('no-deps', !l.deps);
      svg.classList.toggle('no-ppi', !l.ppi);
      svg.classList.toggle('no-maille', !l.maille);
      if (!l.ppi) hideTip();
    },
    /** Reconstruit ce qui dépend de l'échelle (taille fixe en pixels des croix). */
    resize(cssW) {
      scale = cssW / W;
      pNode.setAttribute('r', (9 / scale).toFixed(2)); // anneau de 9 px autour du nœud
      const a = (crossArm(cssW) / scale).toFixed(2);
      const parts = [];
      for (let i = 0; i < maille.count; i++) {
        const x = maille.xs[i];
        const y = maille.ys[i];
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
        parts.push(`M${(x - a).toFixed(1)} ${y.toFixed(1)}h${(2 * a).toFixed(2)}M${x.toFixed(1)} ${(y - a).toFixed(1)}v${(2 * a).toFixed(2)}`);
      }
      nodes.setAttribute('d', parts.join(''));
    },
    /** Point de lecture en (x, y) ; node = nœud le plus proche ({x, y}) ou null pour effacer. */
    setProbe(x, y, node) {
      gProbe.toggleAttribute('hidden', !node);
      if (!node) return;
      pLine.setAttribute('x1', x);
      pLine.setAttribute('y1', y);
      pLine.setAttribute('x2', node.x);
      pLine.setAttribute('y2', node.y);
      pNode.setAttribute('cx', node.x);
      pNode.setAttribute('cy', node.y);
      pHalo.setAttribute('d', dot(x, y));
      pDot.setAttribute('d', dot(x, y));
    },
    /** Département contenant (x, y), ou null (mer, étranger). */
    departmentAt(x, y) {
      for (const p of parsed) {
        if (x < p.box[0] || x > p.box[2] || y < p.box[1] || y > p.box[3]) continue;
        if (inside(p.rings, x, y)) return p.t;
      }
      return null;
    },
    /** Périmètre PPI contenant (x, y) le plus proche de son centre, ou null. Distance au centre en unités. */
    ppiAt(x, y) {
      let best = null;
      let bd = Infinity;
      for (const p of flux.ppi) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= p.r && d < bd) {
          bd = d;
          best = p;
        }
      }
      return best ? { site: best, units: bd } : null;
    },
  };
}
