// map.js — carte SVG : construite une seule fois, ensuite seuls les attributs data-f / aria-label changent.
import { s, h } from './dom.js';

const LABEL_MIN_AREA = 4000; // km² : seuil d'affichage des noms
const LABEL_SIZE = 10; // taille du texte, en unités du viewBox

export function createMap(wrap, mapData, { onSelect }) {
  const svg = s('svg', {
    class: 'map-svg',
    viewBox: mapData.viewBox,
    role: 'group',
    'aria-label': 'Carte des départements métropolitains : un bouton par département',
    focusable: 'false',
  });
  svg.append(
    s(
      'defs',
      {},
      // hachures « donnée manquante » (couleurs pilotées par le CSS, donc par le thème)
      s(
        'pattern',
        { id: 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { class: 'hatch-bg', width: 7, height: 7 }),
        s('line', { class: 'hatch-line', x1: 0, y1: 0, x2: 0, y2: 7 }),
      ),
    ),
  );

  const paths = new Map();
  const centers = new Map();
  const gDeps = s('g', { class: 'deps' });
  for (const t of mapData.territories) {
    const p = s('path', {
      class: 'dep',
      d: t.path,
      'fill-rule': 'evenodd',
      'data-code': t.code,
      tabindex: 0,
      role: 'button',
      'aria-pressed': 'false',
      'aria-controls': 'detail',
      'aria-label': t.name,
    });
    paths.set(t.code, p);
    centers.set(t.code, t.label);
    gDeps.append(p);
  }

  // Contours de survol / sélection / focus : tracés par-dessus, sans toucher aux départements.
  const ring = (cls) => s('path', { class: cls, d: '' });
  const oHover = ring('o-hover');
  const oSelHalo = ring('o-halo');
  const oSel = ring('o-sel');
  const oFocusHalo = ring('o-halo');
  const oFocus = ring('o-focus');
  const gOver = s('g', { class: 'overlay', 'aria-hidden': 'true' }, oHover, oSelHalo, oSel, oFocusHalo, oFocus);
  const setRing = (rings, code) => {
    const d = code ? paths.get(code).getAttribute('d') : '';
    for (const r of rings) r.setAttribute('d', d);
  };

  // Noms : les plus grands départements d'abord, on saute ceux qui chevaucheraient un nom déjà posé.
  const gLabels = s('g', { class: 'labels', 'aria-hidden': 'true' });
  const placed = [];
  for (const t of [...mapData.territories].sort((a, b) => b.area_km2 - a.area_km2)) {
    if (t.area_km2 < LABEL_MIN_AREA) break;
    const w = t.name.length * LABEL_SIZE * 0.52 + 6;
    const hh = LABEL_SIZE + 4;
    const [x, y] = t.label;
    const box = [x - w / 2, y - hh / 2, x + w / 2, y + hh / 2];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    gLabels.append(s('text', { class: 'lbl', x, y, dy: '.35em', 'text-anchor': 'middle' }, t.name));
  }

  svg.append(gDeps, gOver, gLabels);
  const tip = h('div', { class: 'tip', 'aria-hidden': 'true', hidden: true });
  wrap.replaceChildren(svg, tip);

  // --- infobulle ---
  const descs = new Map();
  let hovered = null;
  function showTip(code, x, y) {
    const [title, ...rest] = descs.get(code)?.tip || [code];
    tip.replaceChildren(h('strong', {}, title), ...rest.map((l) => h('span', {}, l)));
    tip.hidden = false;
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    let left = x + 14;
    let top = y + 16;
    if (left + w > wrap.clientWidth - 4) left = x - w - 14;
    if (top + hh > wrap.clientHeight - 4) top = y - hh - 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }
  function hideTip() {
    tip.hidden = true;
    hovered = null;
    setRing([oHover], null);
  }
  const depOf = (e) => e.target.closest?.('.dep');

  svg.addEventListener('pointermove', (e) => {
    const p = depOf(e);
    if (!p || e.pointerType === 'touch') return hideTip();
    const code = p.dataset.code;
    if (code !== hovered) {
      hovered = code;
      setRing([oHover], code);
    }
    const r = wrap.getBoundingClientRect();
    showTip(code, e.clientX - r.left, e.clientY - r.top);
  });
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('click', (e) => {
    const p = depOf(e);
    if (p) onSelect(p.dataset.code, 'map');
  });

  // --- clavier : Entrée/Espace sélectionne, les flèches vont au département voisin ---
  const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  function neighbour(code, [dx, dy]) {
    const [x0, y0] = centers.get(code);
    let best = null;
    let bestScore = Infinity;
    for (const [c, [x, y]] of centers) {
      if (c === code) continue;
      const along = (x - x0) * dx + (y - y0) * dy;
      const across = Math.abs((x - x0) * dy + (y - y0) * dx);
      if (along <= 0 || across > along * 1.5) continue;
      if (along + 2 * across < bestScore) {
        bestScore = along + 2 * across;
        best = c;
      }
    }
    return best;
  }
  svg.addEventListener('keydown', (e) => {
    const p = depOf(e);
    if (!p || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(p.dataset.code, 'map-kbd');
    } else if (DIRS[e.key]) {
      const next = neighbour(p.dataset.code, DIRS[e.key]);
      if (next) {
        e.preventDefault();
        paths.get(next).focus();
      }
    }
  });
  svg.addEventListener('focusin', (e) => {
    const p = depOf(e);
    if (!p) return;
    if (!p.matches(':focus-visible')) return; // clic souris : le contour de sélection suffit
    setRing([oFocusHalo, oFocus], p.dataset.code);
    const r = p.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    showTip(p.dataset.code, r.left - w.left + r.width / 2, r.top - w.top + r.height / 2);
  });
  svg.addEventListener('focusout', () => {
    setRing([oFocusHalo, oFocus], null);
    tip.hidden = true;
  });

  return {
    /** describeFn(code) → {fill, aria, tip} ; ne modifie que des attributs. */
    paint(describeFn) {
      for (const [code, p] of paths) {
        const d = describeFn(code);
        p.dataset.f = d.fill;
        p.setAttribute('aria-label', d.aria);
        descs.set(code, d);
      }
    },
    setSelected(code) {
      for (const [c, p] of paths) p.setAttribute('aria-pressed', String(c === code));
      setRing([oSelHalo, oSel], code);
    },
    setLabels(on) {
      svg.classList.toggle('no-labels', !on);
    },
    focusDept: (code) => paths.get(code)?.focus({ preventScroll: true }),
    rectOf: (code) => paths.get(code)?.getBoundingClientRect(),
  };
}
