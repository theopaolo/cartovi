// map.js — carte des communes : fond de départements, un point par commune, villes de référence.
//
// SVG plutôt que canvas : les points tiennent en deux <path> (un sous-chemin « M x y h0 » par commune, tracé
// avec des extrémités rondes et un trait de largeur fixe en pixels). Cela donne un seul nœud DOM par état,
// des couleurs pilotées par les variables CSS (thème clair/sombre sans code) et un rendu net à tout zoom.
// La couche « toutes les communes » n'est reconstruite que lorsque les régions changent ; seule la couche des
// communes retenues l'est à chaque filtrage. Comme les points ne sont pas des éléments cliquables, la
// sélection passe par une grille spatiale. Le tableau reste la vue accessible : la carte est décorative.
import { h, s } from '../dom.js';

const CELL = 10; // côté d'une case de la grille de recherche (unités du viewBox)
const PICK_PX = { mouse: 9, pen: 12, touch: 16 }; // rayon de capture d'un clic ou d'un toucher
const MIN_UPP = 0.05; // zoom maximal : ~20 px par unité du viewBox (≈ 1 km)
const LABEL_PX = 11; // taille des noms de villes, en pixels écran

const pt = (c) => `M${c.x} ${c.y}h0`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function boxOf(pts) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const c of pts) {
    if (c.x < b.x0) b.x0 = c.x;
    if (c.x > b.x1) b.x1 = c.x;
    if (c.y < b.y0) b.y0 = c.y;
    if (c.y > b.y1) b.y1 = c.y;
  }
  return b;
}
/** Marge de `m` unités, et étendue minimale de 30 unités pour ne pas zoomer sur un point isolé. */
const padBox = (b, m) => {
  const px = Math.max(m, (30 - (b.x1 - b.x0)) / 2);
  const py = Math.max(m, (30 - (b.y1 - b.y0)) / 2);
  return { x0: b.x0 - px, x1: b.x1 + px, y0: b.y0 - py, y1: b.y1 + py };
};

export function createMap(root, { viewBox, deps, hubs, onSelect, tipLines }) {
  const [, , fw, fh] = viewBox.split(/\s+/).map(Number);
  const svg = s('svg', { class: 'cmap', role: 'img', 'aria-label': 'Carte des communes', focusable: 'false' });

  // fond : départements, ceux des régions cochées teintés
  const byRegion = new Map();
  const gBase = s('g', { class: 'cmap-base' });
  for (const t of deps) {
    const p = s('path', { d: t.path, 'fill-rule': 'evenodd' });
    if (!byRegion.has(t.region)) byRegion.set(t.region, []);
    byRegion.get(t.region).push(p);
    gBase.append(p);
  }

  const dotsAll = s('path', { class: 'cmap-all' });
  const dotsHit = s('path', { class: 'cmap-hit' });
  const hubsD = hubs.map(pt).join('');
  const hubHalo = s('path', { class: 'cmap-hub-halo', d: hubsD });
  const hubMark = s('path', { class: 'cmap-hub', d: hubsD });
  const hubSel = [s('path', { class: 'cmap-hubsel-a' }), s('path', { class: 'cmap-hubsel-b' })];
  const labels = new Map(hubs.map((hb) => [hb.i, s('text', { class: 'cmap-lbl' }, hb.label)]));
  const gLabels = s('g', { class: 'cmap-lbls' }, [...labels.values()]);
  const hover = s('path', { class: 'cmap-hover' });
  const sel = [s('path', { class: 'cmap-sel-a' }), s('path', { class: 'cmap-sel-b' }), s('path', { class: 'cmap-sel-c' })];
  svg.append(gBase, dotsAll, dotsHit, hubHalo, hubMark, ...hubSel, gLabels, hover, ...sel);

  const tip = h('div', { class: 'tip', 'aria-hidden': 'true', hidden: true });
  const btn = (label, text, fn) => h('button', { type: 'button', class: 'map-btn', 'aria-label': label, title: label, onclick: fn }, text);
  const ctl = h(
    'div',
    { class: 'map-ctl' },
    btn('Zoom avant', '+', () => zoomAt(1.6)),
    btn('Zoom arrière', '−', () => zoomAt(1 / 1.6)),
    btn('Recadrer sur les communes retenues', '⤢', () => fit()),
  );
  const legend = h(
    'p',
    { class: 'map-legend', 'aria-hidden': 'true' },
    h('span', {}, h('i', { class: 'lg lg-hit' }), 'Correspond aux critères'),
    h('span', {}, h('i', { class: 'lg lg-all' }), 'Autre commune'),
    h('span', {}, h('i', { class: 'lg lg-hub' }), 'Ville de référence'),
  );
  root.replaceChildren(svg, tip, ctl, legend);

  // ---------- vue : centre + unités du viewBox par pixel ----------
  let W = 0;
  let H = 0;
  const view = { cx: fw / 2, cy: fh / 2, upp: 1 };
  let fitBox = { x0: 0, y0: 0, x1: fw, y1: fh };
  let regionBox = fitBox; // étendue des communes affichées
  let fitUpp = 1;
  let custom = false; // vue déplacée à la main : on ne recadre plus seul au redimensionnement
  let selHub = -1;
  let selected = null;
  const order = [...hubs].sort((a, b) => b.pop - a.pop);

  const uppFor = (b) => Math.max(((b.x1 - b.x0) * 1.12) / W, ((b.y1 - b.y0) * 1.12) / H);
  function refit() {
    if (!W || !H) return;
    fitUpp = uppFor(fitBox);
    Object.assign(view, { cx: (fitBox.x0 + fitBox.x1) / 2, cy: (fitBox.y0 + fitBox.y1) / 2, upp: fitUpp });
    custom = false;
    apply();
  }
  /** Recadre sur les communes retenues (et la ville de référence), sinon sur les régions cochées. */
  function fit() {
    const pts = hits.map((r) => r.c);
    if (selHub >= 0) pts.push(hubs[selHub]);
    if (selected) pts.push(selected);
    fitBox = pts.length ? padBox(boxOf(pts), 6) : regionBox;
    refit();
  }
  function apply() {
    if (!W || !H) return;
    const w = W * view.upp;
    const hh = H * view.upp;
    svg.setAttribute('viewBox', `${view.cx - w / 2} ${view.cy - hh / 2} ${w} ${hh}`);
    svg.style.touchAction = custom ? 'none' : 'auto'; // zoomée : le glissement déplace la carte ; sinon il fait défiler la page
    layoutHubs();
  }
  function zoomAt(factor, px = W / 2, py = H / 2) {
    if (!W) return;
    const ux = view.cx - (W * view.upp) / 2 + px * view.upp;
    const uy = view.cy - (H * view.upp) / 2 + py * view.upp;
    const maxUpp = Math.max(fitUpp, uppFor({ x0: 0, y0: 0, x1: fw, y1: fh }));
    const upp = clamp(view.upp / factor, MIN_UPP, maxUpp);
    view.cx = ux - px * upp + (W * upp) / 2;
    view.cy = uy - py * upp + (H * upp) / 2;
    view.upp = upp;
    custom = true;
    keepInside();
    apply();
  }
  function keepInside() {
    view.cx = clamp(view.cx, 0, fw);
    view.cy = clamp(view.cy, 0, fh);
  }
  const toUnits = (px, py) => [view.cx - (W * view.upp) / 2 + px * view.upp, view.cy - (H * view.upp) / 2 + py * view.upp];

  new ResizeObserver(() => {
    W = root.clientWidth;
    H = root.clientHeight;
    if (custom) apply();
    else refit();
  }).observe(root);

  // ---------- villes de référence : marqueurs fixes, noms posés selon la place disponible ----------
  function layoutHubs() {
    const u = view.upp;
    gLabels.style.fontSize = `${LABEL_PX * u}px`;
    gLabels.style.strokeWidth = `${3 * u}px`;
    const x0 = view.cx - (W * u) / 2;
    const y0 = view.cy - (H * u) / 2;
    const placed = [];
    for (const hb of selHub >= 0 ? [hubs[selHub], ...order.filter((o) => o.i !== selHub)] : order) {
      const t = labels.get(hb.i);
      const sx = (hb.x - x0) / u;
      const sy = (hb.y - y0) / u;
      const box = [sx + 8, sy - 9, sx + 8 + hb.label.length * 6.8, sy + 9];
      let show = sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10;
      if (show) {
        const clash = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        show = hb.i === selHub || !clash;
        if (show) placed.push(box);
      }
      t.style.display = show ? '' : 'none';
      if (show) {
        t.setAttribute('x', hb.x + 8 * u);
        t.setAttribute('y', hb.y + 4 * u);
      }
    }
  }

  // ---------- recherche du point le plus proche ----------
  let grid = new Map();
  let hits = [];
  let hitSet = null; // construit à la demande
  const key = (i, j) => i * 1024 + j;
  function nearest(ux, uy, rad) {
    hitSet ||= new Set(hits.map((r) => r.c));
    let bestHit = null;
    let bestAny = null;
    let dHit = rad * rad;
    let dAny = rad * rad;
    for (let i = Math.floor((ux - rad) / CELL); i <= Math.floor((ux + rad) / CELL); i++) {
      for (let j = Math.floor((uy - rad) / CELL); j <= Math.floor((uy + rad) / CELL); j++) {
        for (const c of grid.get(key(i, j)) || []) {
          const d = (c.x - ux) ** 2 + (c.y - uy) ** 2;
          if (d <= dAny) [dAny, bestAny] = [d, c];
          if (d <= dHit && hitSet.has(c)) [dHit, bestHit] = [d, c];
        }
      }
    }
    return bestHit || bestAny; // les communes retenues l'emportent sur les autres
  }
  function pick(e) {
    const r = svg.getBoundingClientRect();
    const [ux, uy] = toUnits(e.clientX - r.left, e.clientY - r.top);
    return nearest(ux, uy, (PICK_PX[e.pointerType] || PICK_PX.mouse) * view.upp);
  }

  // ---------- pointeur : glisser = déplacer, clic = sélectionner, survol = infobulle ----------
  let drag = null;
  let hovered = null;
  let moveEvt = null;
  let raf = 0;
  function hideTip() {
    tip.hidden = true;
    hovered = null;
    hover.removeAttribute('d');
  }
  function onHover() {
    raf = 0;
    const e = moveEvt;
    const c = e && pick(e);
    if (!c) return hideTip();
    if (c !== hovered) {
      hovered = c;
      hover.setAttribute('d', pt(c));
      const [title, ...rest] = tipLines(c);
      tip.replaceChildren(h('strong', {}, title), ...rest.map((l) => h('span', {}, l)));
      tip.hidden = false;
    }
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const left = x + 14 + tip.offsetWidth > W - 4 ? x - tip.offsetWidth - 14 : x + 14;
    const top = y + 16 + tip.offsetHeight > H - 4 ? y - tip.offsetHeight - 14 : y + 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 0) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (drag?.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        svg.setPointerCapture(e.pointerId);
        svg.classList.add('dragging');
        hideTip();
      }
      if (drag.moved) {
        view.cx = drag.cx - dx * view.upp;
        view.cy = drag.cy - dy * view.upp;
        custom = true;
        keepInside();
        apply();
      }
    } else if (e.pointerType === 'mouse') {
      moveEvt = e;
      raf ||= requestAnimationFrame(onHover);
    }
  });
  svg.addEventListener('pointerup', (e) => {
    if (drag?.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    svg.classList.remove('dragging');
    const c = moved ? null : pick(e);
    if (c) onSelect(c);
  });
  svg.addEventListener('pointercancel', () => {
    drag = null;
    svg.classList.remove('dragging');
  });
  svg.addEventListener('pointerleave', () => {
    moveEvt = null;
    hideTip();
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // sans Ctrl/⌘, la molette fait défiler la page
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  return {
    /** Teinte les départements des régions cochées (noms de régions de map.json). */
    setRegions(names) {
      for (const [name, paths] of byRegion) for (const p of paths) p.classList.toggle('on', names.has(name));
    },
    /** Toutes les communes affichées (couche pâle). */
    setCommunes(list) {
      grid = new Map();
      for (const c of list) {
        const k = key(Math.floor(c.x / CELL), Math.floor(c.y / CELL));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
      regionBox = list.length ? padBox(boxOf(list), 5) : { x0: 0, y0: 0, x1: fw, y1: fh };
      dotsAll.setAttribute('d', list.map(pt).join(''));
      hideTip();
    },
    /** Communes retenues (résultats de applyFilters). */
    setHits(results) {
      hits = results;
      hitSet = null;
      dotsHit.setAttribute('d', results.map((r) => pt(r.c)).join(''));
    },
    setHub(idx) {
      if (idx === selHub) return;
      selHub = idx;
      for (const [i, t] of labels) t.classList.toggle('sel', i === idx);
      const d = idx >= 0 ? pt(hubs[idx]) : '';
      for (const p of hubSel) p.setAttribute('d', d);
      layoutHubs();
    },
    setSelected(c) {
      selected = c;
      const d = c ? pt(c) : '';
      for (const p of sel) p.setAttribute('d', d);
    },
    fit,
    /** Recentre sur la commune si elle est hors de la zone visible. */
    reveal(c) {
      if (!W) return;
      const [x0, y0] = toUnits(0, 0);
      const [x1, y1] = toUnits(W, H);
      const m = 12 * view.upp;
      if (c.x > x0 + m && c.x < x1 - m && c.y > y0 + m && c.y < y1 - m) return;
      view.cx = c.x;
      view.cy = c.y;
      custom = true;
      keepInside();
      apply();
    },
    setLabel: (text) => svg.setAttribute('aria-label', text),
  };
}
