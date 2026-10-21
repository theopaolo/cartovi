// main.js — page « Flux & limites » : charge le vent, relie temps, couches, lecture au pointeur et rendu.
// Flux : une boucle requestAnimationFrame (arrêtée onglet caché, canvas hors écran, ou rien à animer) avance le temps,
// fait avancer les particules sur le GPU puis rafraîchit, à cadence réduite, le curseur et la lecture au pointeur.
import { getJSON } from '../data.js';
import { h, prefersReducedMotion, rafThrottle } from '../dom.js';
import { createArrows } from './arrows.js';
import { readTheme, watchTheme } from './colors.js';
import { createLayers, createReadout, createTime } from './controls.js';
import { loadFlux } from './data.js';
import { createMaille } from './maille.js';
import { createBase, createLimits } from './overlay.js';
import { fillMethod, fromBearing } from './text.js';
import { createVeil } from './veil.js';
import { createWindGL } from './wind-gl.js';

const $ = (sel) => document.querySelector(sel);

const RATES = [1, 4, 16]; // heures de vent par seconde de lecture
const DPR_MAX = 2;
const DIST_W = 250; // largeur de la carte de distance aux nœuds
const UI_MS = 125; // période de rafraîchissement du curseur et de la lecture pendant la lecture (8 Hz : le DOM n'a pas à suivre les 60 images/s)
const KEY_STEP = 10; // pas des flèches du clavier, en unités SVG (×4 avec Maj)

const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  hours: 0, // temps affiché, en heures depuis la première image
  playing: false,
  rate: 4,
  loop: true,
  // petit écran : 630 croix sur 360 px masquent le vent, la maille y est proposée mais pas imposée
  layers: { particles: true, deps: true, ppi: true, maille: !matchMedia('(max-width: 559px)').matches, interp: false },
  hover: null, // {x, y} sous la souris
  pinned: null, // {x, y} posé par un clic, un toucher ou le clavier
};
const ui = {};
let flux;
let maille;
let gl = null;
let theme;
let visible = true;
let raf = 0;
let lastTs = 0;
let lastUi = 0;
let lastLabel = 0;
let announceTimer = 0;
let shown = ''; // dernier libellé du temps, pour l'étiquette du canvas
let prevMode = '';
const out = [0, 0];
const info = { speed: 0, fromDeg: 0, nodeKm: 0, node: -1, dep: null, ppi: null, ms: 0, before: 0, after: 0, exact: false };

init();

async function init() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-jump]');
    if (!a) return;
    e.preventDefault();
    const target = $(a.getAttribute('href'));
    target.closest('details')?.setAttribute('open', '');
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  });

  let map = null;
  try {
    [flux, map] = await Promise.all([loadFlux(), getJSON('data/map.json').catch(() => null)]); // le fond de carte est facultatif
  } catch (e) {
    console.info(e.message);
    const missing = /HTTP 404/.test(e.message);
    $(missing ? '#notice' : '#load-error').hidden = false;
    for (const sel of ['.flux-box', '.flux-side']) $(sel).hidden = true;
    fillMethod(null);
    return;
  }
  fillMethod(flux);

  const deps = map?.territories || [];
  maille = createMaille(flux.nodes, { W: flux.W, H: flux.H, kmPerUnit: flux.kmPerUnit });
  const dist = maille.distanceField(DIST_W, Math.round((DIST_W * flux.H) / flux.W));
  buildStage($('#stage'), deps, dist);

  ui.time = createTime($('#time'), {
    flux,
    rates: RATES,
    onSeek: seek,
    onPlay: togglePlay,
    onRate: (r) => {
      state.rate = r;
      ui.time.setRate(r);
    },
    onLoop: (v) => {
      state.loop = v;
    },
  });
  ui.readout = createReadout($('#readout'));
  ui.layers = createLayers($('#layers'), { state: state.layers, onChange: setLayer, ppiNames: flux.ppi.map((p) => p.name) });
  if (!deps.length) $('#layer-deps').disabled = true;

  // mouvement réduit : on part en pause, sur l'image la plus ventée, avec des flèches plutôt que des particules
  if (reducedMq.matches) state.hours = flux.windiest * flux.everyHours;
  else state.playing = true;
  ui.time.setPlaying(state.playing);
  ui.time.setRate(state.rate);
  reducedMq.addEventListener('change', () => {
    if (reducedMq.matches) togglePlay(false);
    note();
    applyMode();
  });

  applyTheme();
  watchTheme(applyTheme);
  note();

  new ResizeObserver(debounce(resize, 100)).observe(ui.stage);
  new ResizeObserver(fitStage).observe($('.flux-box')); // hauteur disponible → largeur de la scène (CSS, écrans larges)
  fitStage();
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    lastTs = 0;
    wake();
  }).observe(ui.stage);
  document.addEventListener('visibilitychange', () => {
    lastTs = 0;
    wake();
  });
  resize();
  seek(state.hours, false);
  applyMode();
}

// ---------------------------------------------------------------- scène

function buildStage(stage, deps, dist) {
  stage.style.setProperty('--fw', flux.W); // le gabarit CSS de la scène suit le viewBox des données
  stage.style.setProperty('--fh', flux.H);
  const base = createBase(deps, `0 0 ${flux.W} ${flux.H}`);
  const glCanvas = h('canvas', { class: 'flux-layer flux-gl', role: 'img', 'aria-label': 'Particules animées : vent à 10 m sur la France' });
  const arrowCanvas = h('canvas', { class: 'flux-layer flux-arrows', 'aria-hidden': 'true', hidden: true });
  const veilCanvas = h('canvas', { class: 'flux-layer flux-veil', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'tip', 'aria-hidden': 'true', hidden: true });
  const limits = createLimits({ flux, deps, maille, tip, host: stage });
  stage.replaceChildren(base, glCanvas, arrowCanvas, veilCanvas, limits.svg, tip);
  Object.assign(ui, { stage, glCanvas, arrowCanvas, limits });

  ui.veil = createVeil(veilCanvas, dist);
  ui.arrows = createArrows(arrowCanvas, flux, maille);
  try {
    gl = createWindGL(glCanvas, flux, { dist, onLost: () => applyMode(), onRestored: () => restoreGL() });
  } catch (e) {
    console.info('Particules indisponibles :', e.message);
    gl = null;
  }
  if (!gl) {
    const n = $('#gl-notice');
    n.hidden = false;
    n.textContent = 'WebGL 2 n’est pas disponible sur ce navigateur ou cet appareil : la carte montre des flèches statiques à la place des particules. Le temps, les couches et la lecture au pointeur fonctionnent normalement.';
  }

  limits.onPointer({
    onHover: (x, y) => {
      state.hover = state.hover || { x: 0, y: 0 };
      state.hover.x = x;
      state.hover.y = y;
      probeSoon();
    },
    onLeave: () => {
      state.hover = null;
      probeSoon();
    },
    onPick: (x, y) => {
      // un second clic au même endroit retire le point
      const p = state.pinned;
      const same = p && Math.hypot(p.x - x, p.y - y) < 6;
      state.pinned = same ? null : { x, y };
      probeSoon();
    },
  });
  stage.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
  if (e.key === 'Escape' && (state.pinned || state.hover)) {
    state.pinned = state.hover = null;
    e.preventDefault();
    return probeSoon();
  }
  if (!dir && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const step = KEY_STEP * (e.shiftKey ? 4 : 1);
  const p = state.pinned || { x: flux.W / 2, y: flux.H / 2 };
  if (dir) {
    p.x = Math.min(flux.W, Math.max(0, p.x + dir[0] * step));
    p.y = Math.min(flux.H, Math.max(0, p.y + dir[1] * step));
  }
  state.pinned = p;
  probeSoon();
}

/** Hauteur laissée à la scène : celle de la boîte moins la ligne d'aide qui la suit. */
function fitStage() {
  ui.stage.style.setProperty('--box-h', `${Math.max(200, $('.flux-box').clientHeight - $('#stage-hint').offsetHeight - 12)}px`);
}

function resize() {
  const w = ui.stage.clientWidth;
  const hh = ui.stage.clientHeight;
  if (!w || !hh) return;
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  ui.veil.resize(w, hh, dpr);
  ui.arrows.resize(w, hh, dpr);
  ui.limits.resize(w);
  if (gl) {
    try {
      gl.resize(w, hh, dpr);
      gl.setRamp(theme.ramp);
      gl.setInterp(state.layers.interp);
    } catch (e) {
      console.info('Particules indisponibles :', e.message);
      gl = null;
    }
  }
  ui.limits.setLayers(state.layers);
  ui.veil.setVisible(state.layers.interp);
  applyMode();
}

function restoreGL() {
  resize();
}

function applyTheme() {
  theme = readTheme();
  gl?.setRamp(theme.ramp);
  ui.veil?.setColor(theme.hatch);
  ui.layers?.setRamp(theme.rampCss);
  if (prevMode === 'arrows') drawArrows();
}

// ---------------------------------------------------------------- modes d'affichage

const layerPos = () => state.hours / flux.everyHours;
const modeNow = () => (!state.layers.particles ? 'none' : gl && !gl.lost && (!reducedMq.matches || state.playing) ? 'gl' : 'arrows');

function applyMode() {
  const m = modeNow();
  ui.glCanvas.hidden = m !== 'gl';
  ui.arrowCanvas.hidden = m !== 'arrows';
  if (m === 'gl' && prevMode !== 'gl') gl.clear();
  prevMode = m;
  if (m === 'arrows') drawArrows();
  wake();
}

function drawArrows() {
  ui.arrows.draw(layerPos(), theme, state.layers.interp);
}

/** Message sous la carte quand l'animation est désactivée par les réglages du système. */
function note() {
  const n = $('#motion-note');
  n.hidden = !reducedMq.matches;
}

// ---------------------------------------------------------------- boucle

const shouldRun = () => !document.hidden && visible && (state.playing || modeNow() === 'gl');

function wake() {
  if (!raf && flux && shouldRun()) raf = requestAnimationFrame(frame);
}

function frame(ts) {
  raf = 0;
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
  lastTs = ts;
  if (state.playing) advance(dt * state.rate);
  if (gl && modeNow() === 'gl') gl.step(dt, layerPos());
  if (state.playing && ts - lastUi >= UI_MS) {
    lastUi = ts;
    syncTime();
    if (modeNow() === 'arrows') drawArrows();
    if (state.hover || state.pinned) refreshProbe();
  }
  if (!raf && shouldRun()) raf = requestAnimationFrame(frame); // wake() a pu replanifier pendant l'image
  else if (!raf) lastTs = 0;
}

function advance(dh) {
  const span = flux.spanHours;
  state.hours += dh;
  if (state.hours >= span) {
    if (state.loop) state.hours -= span;
    else {
      state.hours = span;
      togglePlay(false);
    }
  }
}

// ---------------------------------------------------------------- temps

function syncTime() {
  const text = ui.time.update(state.hours);
  if (text !== shown && (!state.playing || performance.now() - lastLabel > 1000)) {
    shown = text;
    lastLabel = performance.now();
    ui.glCanvas.setAttribute('aria-label', `Particules animées : vent à 10 m sur la France, ${text}`);
  }
}

function seek(hours, commit) {
  state.hours = Math.min(flux.spanHours, Math.max(0, hours));
  syncTime();
  if (modeNow() === 'arrows') drawArrows();
  refreshProbe();
  if (commit) scheduleAnnounce();
}

function togglePlay(force) {
  const next = typeof force === 'boolean' ? force : !state.playing;
  if (next && !state.loop && state.hours >= flux.spanHours) state.hours = 0;
  state.playing = next;
  ui.time.setPlaying(next);
  lastTs = 0;
  if (!next) {
    // à l'arrêt, frise et lecture au pointeur doivent montrer exactement le même instant
    syncTime();
    if (state.hover || state.pinned) refreshProbe();
  }
  applyMode();
}

function setLayer(id, on) {
  state.layers[id] = on;
  if (id === 'interp') {
    gl?.setInterp(on);
    ui.veil.setVisible(on);
    if (modeNow() === 'arrows') drawArrows();
  } else if (id === 'particles') {
    applyMode();
  } else {
    ui.limits.setLayers(state.layers);
  }
  wake();
}

// ---------------------------------------------------------------- lecture au pointeur

const probeSoon = rafThrottle(() => {
  syncTime(); // même instant affiché sur la frise et dans « Heure lue »
  refreshProbe();
  scheduleAnnounce();
});

function measure(p) {
  const f = layerPos();
  flux.windAt(p.x, p.y, f, out);
  info.speed = Math.hypot(out[0], out[1]);
  info.fromDeg = fromBearing(out[0], out[1]);
  const n = maille.nearest(p.x, p.y);
  info.node = n.index;
  info.nodeKm = n.units * flux.kmPerUnit;
  info.dep = ui.limits.departmentAt(p.x, p.y);
  const q = ui.limits.ppiAt(p.x, p.y);
  info.ppi = q ? { site: q.site, km: q.units * flux.kmPerUnit } : null;
  const f0 = Math.min(Math.floor(f), flux.last);
  info.ms = flux.times[0] + Math.round(state.hours * 6) * 600000; // arrondi à 10 min
  info.before = flux.times[f0];
  info.after = flux.times[Math.min(f0 + 1, flux.last)];
  info.exact = Math.abs(f - Math.round(f)) < 0.03;
  return info;
}

function refreshProbe() {
  const p = state.hover || state.pinned;
  if (!p) {
    ui.limits.setProbe(0, 0, null);
    ui.readout.clear();
    return;
  }
  const i = measure(p);
  ui.limits.setProbe(p.x, p.y, { x: maille.xs[i.node], y: maille.ys[i.node] });
  ui.readout.show(i);
}

/** La phrase lue par les lecteurs d'écran n'est écrite qu'une fois le pointeur immobile : pas de flot d'annonces. */
function scheduleAnnounce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const p = state.hover || state.pinned;
    if (p) ui.readout.announce(measure(p));
    else ui.readout.announceText('');
  }, 800);
}

function debounce(fn, ms) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
