// main.js — page « Recherche » : relie le champ, les filtres, la liste, la fiche et la comparaison à l'URL.
// Flux : un changement d'état (requête, filtre, commune ouverte, comparaison) planifie render() ; l'état s'écrit dans le fragment.
// Les régions ne se chargent que pour les communes ouvertes ou comparées.
import { h, prefersReducedMotion, rafThrottle } from '../dom.js';
import { fmtDateTime, fmtNumber } from '../format.js';
import { renderCompare } from './compare.js';
import { loadContext, loadNames } from './data.js';
import { loadTracc } from '../climat.js';
import { loadEauDep, loadEauIndex } from '../eau.js';
import { createFiche } from './fiche.js';
import { MAX_COMPARE, hashFor, parseHash, writeHash } from './hash.js';
import { buildProfile } from './profile.js';
import { createResults } from './results.js';
import { SIZE_CHOICES, search } from './search.js';

const $ = (sel) => document.querySelector(sel);
const narrow = () => matchMedia('(max-width: 959px)').matches; // mise en page empilée

const EXAMPLES = ['Lyon', 'Angoulême', 'Die', 'Saint-Étienne', 'Tulle', 'Givors'];

const state = { q: '', c: null, cmp: [], region: '', sizes: [] };
const ui = {};
let names; // index de recherche (noms.json)
let ctx; // départements, indicateurs, couche communale (facultatifs)
const failed = new Set(); // régions dont le chargement a échoué
const pending = new Set(); // régions en cours de chargement

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
  ui.q = $('#q');
  try {
    [names, ctx] = await Promise.all([loadNames(), loadContext()]);
  } catch (e) {
    console.error(e);
    $('#load-error').hidden = false;
    ui.q.disabled = true;
    return;
  }
  const { territories } = ctx;
  const depLabel = (dep) => (territories.get(dep) ? `${territories.get(dep).name} (${dep})` : `Département ${dep}`);
  const regionName = (dep) => territories.get(dep)?.region || '';
  ui.count = $('#rech-count');
  ui.status = $('#rech-status');
  ui.results = createResults({ input: ui.q, list: $('#rech-list'), moreBtn: $('#rech-more'), names, depLabel, regionName, flush: () => searchQueued && doSearch(), onPick: (code, how) => open(code, how) });
  ui.fiche = createFiche($('#fiche'), { onClose: close, onToggleCompare: toggleCompare });
  buildFilters();
  buildEmpty();
  $('#compare-clear').addEventListener('click', () => {
    state.cmp = [];
    update();
    persist(false, true);
    ui.q.focus();
  });
  ui.q.addEventListener('input', () => {
    state.q = ui.q.value;
    scheduleSearch();
    persist(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.c && !e.defaultPrevented && $('#fiche').contains(document.activeElement)) close();
  });
  addEventListener('popstate', applyHash);
  addEventListener('hashchange', applyHash);
  if (ctx.index?.generated_at) $('#generated').textContent = `Couche communale générée le ${fmtDateTime(ctx.index.generated_at)}.`;
  applyHash();
}

// ---------- état ↔ URL ----------
/** Relit l'état depuis l'URL (chargement, retour arrière, fragment collé, recherche de l'en-tête). */
function applyHash() {
  if (!location.hash) {
    // sans fragment : une requête passée en ?q= (formulaire de l'en-tête sans JavaScript) est reprise
    const q = new URLSearchParams(location.search).get('q');
    if (q) location.replace(`${location.pathname}#q=${encodeURIComponent(q.slice(0, 100))}`);
  }
  if (location.hash && !location.hash.includes('=')) return; // ancre ordinaire (#methode)
  const regions = new Set(ctx.index?.regionByCode.keys() || []);
  Object.assign(state, parseHash(location.hash, names.byCode, ctx.index ? regions : undefined));
  ui.q.value = state.q;
  $('#top-q').value = state.q;
  ui.region.value = state.region;
  for (const [id, btn] of ui.sizes) btn.setAttribute('aria-pressed', String(state.sizes.includes(id)));
  update();
}

let hashTimer;
function persist(push, now = false) {
  clearTimeout(hashTimer);
  const write = () => writeHash(hashFor(state), { push });
  if (push || now) write();
  else hashTimer = setTimeout(write, 300); // frappe : un remplacement différé
}

// ---------- filtres ----------
function buildFilters() {
  ui.region = $('#f-region');
  ui.sizes = new Map();
  if (ctx.index) {
    ui.region.append(...ctx.index.regions.map((r) => h('option', { value: r.code }, r.name)));
    ui.region.addEventListener('change', () => {
      state.region = ui.region.value;
      scheduleSearch();
      persist(false, true);
    });
  } else {
    ui.region.closest('label').hidden = true; // sans l'index communal, pas de liste de régions
  }
  const box = $('#f-sizes');
  for (const s of SIZE_CHOICES) {
    const btn = h('button', { type: 'button', class: 'pill', 'aria-pressed': 'false', onclick: () => toggleSize(s.id) }, s.label);
    ui.sizes.set(s.id, btn);
    box.append(btn);
  }
  $('#filters').hidden = false;
}

function toggleSize(id) {
  state.sizes = state.sizes.includes(id) ? state.sizes.filter((x) => x !== id) : [...state.sizes, id];
  ui.sizes.get(id).setAttribute('aria-pressed', String(state.sizes.includes(id)));
  scheduleSearch();
  persist(false, true);
}

// ---------- état vide ----------
function buildEmpty() {
  const chip = (name) => h('button', { type: 'button', class: 'pill', onclick: () => run(name) }, name);
  ui.empty = $('#rech-empty');
  ui.empty.append(
    h('p', {}, h('strong', {}, 'Tapez le nom d’une commune'), ' pour la retrouver parmi les 34 746 communes de France métropolitaine, puis lisez ses valeurs dans toutes les catégories du projet.'),
    h('p', { class: 'muted small' }, 'Essayez : '),
    h('div', { class: 'pills' }, EXAMPLES.map(chip)),
  );
}

/** Lance une recherche depuis un exemple. */
function run(q) {
  state.q = q;
  ui.q.value = q;
  $('#top-q').value = q;
  scheduleSearch();
  persist(true);
  ui.q.focus();
}

// ---------- recherche ----------
let searchQueued = false;
let announceTimer = 0;

/** Une recherche par image au plus ; flush() la fait tout de suite (flèches ou Entrée tapées dans la foulée de la frappe). */
function scheduleSearch() {
  if (searchQueued) return;
  searchQueued = true;
  requestAnimationFrame(() => searchQueued && doSearch());
}

function doSearch() {
  searchQueued = false;
  const r = search(names, state.q, { region: state.region, sizes: state.sizes, depByName: ctx.depByName });
  ui.results.set(r.list);
  ui.results.setOpened(state.c);
  const n = r.list.length;
  ui.empty.hidden = r.active;
  $('#rech-body').hidden = !r.active;
  const tail = r.q.deps.length ? ` dans ${r.q.deps.map((d) => ctx.territories.get(d)?.name || d).join(', ')}` : '';
  const shown = Math.min(n, 50);
  ui.count.textContent = r.active ? (n ? `${fmtNumber(n)} commune${n > 1 ? 's' : ''}${tail}${n > shown ? ` · ${shown} affichées` : ''}` : '') : '';
  // résultats annoncés une fois la frappe terminée (pas à chaque lettre)
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    ui.status.textContent = !r.active ? '' : n ? `${fmtNumber(n)} commune${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''}${tail}.` : 'Aucune commune trouvée.';
  }, 500);
  const none = $('#rech-none');
  none.hidden = !(r.active && !n);
  if (!none.hidden) none.textContent = r.q.code ? 'Aucune commune avec ce code INSEE (ce n’est pas un code postal).' : 'Aucune commune ne correspond. Essayez moins de mots ou retirez un filtre.';
}

// ---------- fiche ----------
function open(code, how) {
  const first = state.c !== code;
  state.c = code;
  update();
  render(); // tout de suite : le focus a besoin d'une fiche visible
  persist(first);
  if (how === 'kbd') ui.fiche.focus();
  if (narrow()) $('#fiche').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function close() {
  state.c = null;
  update();
  persist(true);
  ui.q.focus();
}

function toggleCompare(code) {
  state.cmp = state.cmp.includes(code) ? state.cmp.filter((c) => c !== code) : state.cmp.length < MAX_COMPARE ? [...state.cmp, code] : state.cmp;
  update();
  persist(false, true);
}

// ---------- chargement des données d'une commune ----------
const regionOf = (code) => names.regionOf[code.slice(0, 2)];

function ensure(code) {
  const region = regionOf(code);
  if (ctx.store && region && !ctx.store.isLoaded(region) && !pending.has(region) && !failed.has(region)) {
    pending.add(region);
    ctx.store
      .load(region)
      .catch((e) => {
        failed.add(region);
        console.error(e);
      })
      .finally(() => {
        pending.delete(region);
        scheduleRender();
      });
  }
}

const profileOf = (code) => {
  const region = regionOf(code);
  return buildProfile(ctx, names.rows[names.byCode.get(code)], { regionCode: region, failed: failed.has(region) });
};

// ---------- rendu ----------
const scheduleRender = rafThrottle(render);

/** Après un changement d'état : recherche, puis fiche et comparaison. */
function update() {
  scheduleSearch();
  for (const code of new Set([state.c, ...state.cmp])) if (code) ensure(code);
  if (state.c || state.cmp.length) ensureTracc();
  if (state.c) ensureEau(state.c.slice(0, 2));
  scheduleRender();
}

// débits futurs (Explore2, données de test) : métadonnées puis fichier du département, seulement pour la fiche ouverte
function ensureEau(dep) {
  if (!ctx) return;
  ctx.eau ??= { index: null, indexState: 'idle', deps: new Map(), depState: new Map() };
  const E = ctx.eau;
  if (E.indexState === 'idle') {
    E.indexState = 'loading';
    loadEauIndex()
      .then((i) => {
        E.index = i;
        E.indexState = 'ok';
      })
      .catch((e) => {
        E.indexState = 'error';
        console.info(`débits futurs : ${e.message}`);
      })
      .finally(scheduleRender);
  }
  if (!E.depState.has(dep)) {
    E.depState.set(dep, 'loading');
    loadEauDep(dep)
      .then((d) => {
        E.deps.set(dep, d);
        E.depState.set(dep, 'ok');
      })
      .catch((e) => {
        E.depState.set(dep, 'error');
        console.info(`débits futurs (${dep}) : ${e.message}`);
      })
      .finally(scheduleRender);
  }
}

// trajectoire du climat futur (grille TRACC, ≈ 1,4 Mo) : chargée une fois, à la première fiche ouverte ;
// en attendant (ou en cas d'échec), la fiche affiche les valeurs à +2,7 °C de la couche communale
let traccState = 'idle';
function ensureTracc() {
  if (traccState !== 'idle' || !ctx) return;
  traccState = 'loading';
  loadTracc()
    .then((t) => {
      ctx.tracc = t;
      traccState = 'ok';
    })
    .catch((e) => {
      traccState = 'error';
      console.info(`climat futur : ${e.message}`);
    })
    .finally(scheduleRender);
}

function render() {
  ui.results.setOpened(state.c);
  const full = state.cmp.length >= MAX_COMPARE;
  if (state.c) {
    const p = profileOf(state.c);
    ui.fiche.show(p, { compared: state.cmp.includes(state.c), full });
  } else {
    ui.fiche.hide();
  }
  $('#fiche-ph').hidden = !!state.c;
  const cmp = $('#compare');
  cmp.hidden = !state.cmp.length;
  if (state.cmp.length) {
    $('#compare-count').textContent = `${state.cmp.length} sur ${MAX_COMPARE} communes`;
    renderCompare($('#compare-body'), state.cmp.map(profileOf), {
      onRemove: (code) => {
        toggleCompare(code);
        ui.q.focus();
      },
      onOpen: (code) => open(code, 'kbd'),
    });
  }
}
