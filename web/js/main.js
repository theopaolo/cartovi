// main.js — point d'entrée : charge les données, relie l'état (URL, poids, mode, sélection) aux vues.
import { loadData } from './data.js';
import { indicatorScores } from './score.js';
import { computeViews, describe } from './view.js';
import { createMap } from './map.js';
import { createDetail } from './panel.js';
import { createWeights } from './weights.js';
import { createRanking } from './ranking.js';
import { renderLegend } from './legend.js';
import { renderSources, renderGenerated } from './sources.js';
import { parseHash, writeHash } from './hash.js';
import { h, rafThrottle, prefersReducedMotion } from './dom.js';

const $ = (sel) => document.querySelector(sel);
const narrow = () => matchMedia('(max-width: 959px)').matches; // mise en page empilée (panneau détail en feuille basse)

const state = { mode: 'composite', selected: null, weights: {} };
let data = null; // indicators.json normalisé, ou null s'il n'est pas (encore) disponible
let byCode;
let codes;
let scores = {}; // { idIndicateur: { code: score } } : ne dépend pas des poids, calculé une fois
let defaults = {};
let views;
let origin = 'map'; // d'où vient la sélection (pour rendre le focus à la fermeture)
const ui = {};

init();

async function init() {
  let loaded;
  try {
    loaded = await loadData();
  } catch (e) {
    $('#map').replaceChildren(h('p', { class: 'fatal' }, 'Impossible de charger la carte (data/map.json).'));
    console.error(e);
    return;
  }
  const { map, payload } = loaded;
  data = payload;
  codes = map.territories.map((t) => t.code);
  byCode = new Map(map.territories.map((t) => [t.code, t]));
  if (data) {
    scores = indicatorScores(data.indicators, codes);
    for (const ind of data.indicators) defaults[ind.id] = ind.weight;
  }
  state.weights = { ...defaults };

  $('#notice').hidden = !!data;
  fillModeSelect();
  ui.map = createMap($('#map'), map, { onSelect: select });
  ui.detail = createDetail($('#detail'), { onClose: closeDetail });
  ui.weights = createWeights($('#weights'), { data, defaults, onChange, onReset, onCopy });
  ui.ranking = createRanking($('#ranking'), map.territories, { onSelect: select });
  renderSources($('#sources'), data, codes.length, codes);
  renderGenerated($('#generated'), data);

  $('#mode').addEventListener('change', (e) => {
    state.mode = e.target.value;
    schedule();
    persist(true);
  });
  $('#labels').addEventListener('change', (e) => ui.map.setLabels(e.target.checked));
  ui.map.setLabels($('#labels').checked);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected && !e.defaultPrevented) closeDetail();
  });
  // liens internes : on défile sans toucher au fragment (qui porte l'état partageable)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-jump]');
    if (!a) return;
    e.preventDefault();
    const target = $(a.getAttribute('href'));
    target.closest('details')?.setAttribute('open', '');
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  });
  window.addEventListener('popstate', applyHash);
  window.addEventListener('hashchange', applyHash);
  applyHash();
}

function fillModeSelect() {
  const sel = $('#mode');
  sel.replaceChildren(h('option', { value: 'composite' }, 'Indice composite (vos pondérations)'));
  sel.disabled = !data;
  if (!data) return;
  for (const t of data.themes) {
    sel.append(h('optgroup', { label: t.label }, data.indicators.filter((i) => i.theme === t.id).map((i) => h('option', { value: i.id }, i.label))));
  }
}

/** Relit l'état depuis l'URL (chargement, retour arrière, fragment collé). */
function applyHash() {
  if (location.hash && !location.hash.includes('=')) return; // ancre ordinaire (#methode) : pas un état
  const hs = parseHash();
  state.weights = { ...defaults };
  for (const [id, w] of Object.entries(hs.weights || {})) if (id in defaults) state.weights[id] = Math.min(3, Math.max(0, w));
  state.mode = data?.indicators.some((i) => i.id === hs.mode) ? hs.mode : 'composite';
  state.selected = byCode.has(hs.selected) ? hs.selected : null;
  $('#mode').value = state.mode;
  refresh();
}

/** Recalcule tout (rapide : 96 départements × quelques dizaines d'indicateurs). */
function refresh() {
  views = computeViews({ indicators: data?.indicators || [], scores, weights: state.weights, mode: state.mode, codes });
  ui.map.paint((code) => describe(views.cur, byCode.get(code))); // uniquement des attributs : pas de reconstruction du DOM
  renderLegend($('#legend'), views.cur, { staleCount: data?.indicators.filter((i) => i.status === 'stale').length || 0 });
  ui.ranking.update(views.cur);
  ui.weights.sync(state.weights);
  renderSelection();
}
const schedule = rafThrottle(refresh);

function renderSelection() {
  const code = state.selected;
  ui.map.setSelected(code);
  ui.ranking.setSelected(code);
  document.body.classList.toggle('sheet-open', !!code);
  if (!code) return ui.detail.hide();
  ui.detail.show({
    terr: byCode.get(code),
    comp: views.comp,
    data,
    scores,
    weights: state.weights,
    activeId: state.mode === 'composite' ? null : state.mode,
  });
}

function select(code, how) {
  state.selected = byCode.has(code) ? code : null;
  renderSelection();
  persist(true);
  if (!state.selected) return;
  origin = how.startsWith('table') ? 'table' : 'map';
  if (how.endsWith('kbd')) ui.detail.focus();
  $('#side').scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  if (how === 'map' && narrow()) revealAboveSheet(code);
}

function closeDetail() {
  const prev = state.selected;
  if (!prev) return;
  const hadFocus = $('#detail').contains(document.activeElement) || document.activeElement === document.body;
  select(null, 'close');
  if (hadFocus) (origin === 'table' ? ui.ranking.focusRow(prev) : ui.map.focusDept(prev));
}

/** Mobile : la feuille du détail masque le bas de l'écran ; on fait défiler pour garder le département visible. */
function revealAboveSheet(code) {
  requestAnimationFrame(() => {
    const r = ui.map.rectOf(code);
    const sheetTop = $('#detail').getBoundingClientRect().top;
    const delta = Math.min(r.bottom - (sheetTop - 12), r.top - 8);
    if (delta > 0) window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

function onChange(id, value) {
  state.weights[id] = value;
  schedule();
  persist(false);
}
function onReset() {
  state.weights = { ...defaults };
  schedule();
  persist(false);
}
async function onCopy() {
  persist(false, true);
  try {
    await navigator.clipboard.writeText(location.href);
    ui.weights.flash('Lien copié');
  } catch {
    ui.weights.flash('Copiez l’adresse depuis la barre du navigateur');
  }
}

// Écriture du fragment : entrée d'historique pour sélection/mode, remplacement (différé) pour les curseurs.
let hashTimer;
function persist(push, now = false) {
  clearTimeout(hashTimer);
  const write = () => writeHash(state, defaults, { push });
  if (push || now) write();
  else hashTimer = setTimeout(write, 300);
}
