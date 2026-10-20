// main.js — page « Communes » : relie critères, URL, carte, tableau et fiche.
// Flux : un changement de critère met à jour l'état puis planifie render() (une fois par frame) ;
// render() filtre, trie, puis redessine carte et tableau. Les régions se chargent à la demande.
import { loadData } from '../data.js';
import { prefersReducedMotion, rafThrottle } from '../dom.js';
import { fmtDateTime, fmtNumber } from '../format.js';
import { createControls } from './controls.js';
import { createStore, defaultHub, loadIndex } from './data.js';
import { createDetail } from './detail.js';
import { DEFAULTS, DEFAULT_SORT, applyFilters, fixPopulation, medianLeft, sortResults } from './filter.js';
import { hashFor, parseHash, writeHash } from './hash.js';
import { createMap } from './map.js';
import { createResults } from './table.js';
import { fmtDay, fmtDuration, fmtPop, trainsText } from './text.js';

const $ = (sel) => document.querySelector(sel);
const narrow = () => matchMedia('(max-width: 959px)').matches; // fiche en feuille basse

const state = { crit: null, sort: { ...DEFAULT_SORT }, selected: null };
const ui = {};
const pending = new Set(); // régions en cours de chargement
const failed = new Set(); // régions dont le chargement a échoué
let index;
let store;
let defaults;
let deps = new Map(); // code département → territoire de map.json
let payload = null; // indicators.json normalisé (facultatif)
let results = [];
let resultMap = null; // code commune → résultat, construit à la demande
let origin = 'map'; // d'où vient la sélection (pour rendre le focus à la fermeture)

init();

async function init() {
  const depData = loadData().catch(() => ({ map: null, payload: null })); // facultatif : fond de carte et noms de départements
  try {
    index = await loadIndex();
  } catch (e) {
    console.error(e);
    $('#notice').hidden = false;
    for (const sel of ['#filters-panel', '#map', '.results']) $(sel).hidden = true; // rien à filtrer tant que la couche n'est pas publiée
    return;
  }
  const { map, payload: p } = await depData;
  payload = p;
  deps = new Map((map?.territories || []).map((t) => [t.code, t]));
  store = createStore(index);
  const regions = DEFAULTS.regions.filter((c) => index.regionByCode.has(c));
  defaults = { ...DEFAULTS, hub: defaultHub(index).code, regions: regions.length ? regions : index.regions.slice(0, 1).map((r) => r.code) };

  ui.controls = createControls($('#filters'), { index, onChange, onReset, onCopy });
  ui.map = createMap($('#map'), {
    viewBox: index.viewBox,
    deps: map?.territories || [],
    hubs: index.hubs,
    onSelect: (c) => select(c.code, 'map'),
    tipLines,
  });
  ui.results = createResults($('#results'), { index, onSort, onSelect: select });
  ui.detail = createDetail($('#detail'), { index, onClose: closeDetail });
  fillMethod();
  measureHeader();
  addEventListener('resize', measureHeader);

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
  addEventListener('popstate', applyHash);
  addEventListener('hashchange', applyHash);
  applyHash();
}

/** Relit l'état depuis l'URL (chargement, retour arrière, fragment collé). */
function applyHash() {
  if (location.hash && !location.hash.includes('=')) return; // ancre ordinaire (#methode) : pas un état
  const known = { regions: new Set(index.regionByCode.keys()), hubs: new Set(index.hubByCode.keys()) };
  const hs = parseHash(location.hash, defaults, DEFAULT_SORT, known);
  fixPopulation(hs.crit, 'popMin');
  Object.assign(state, hs);
  ui.controls.sync(state.crit);
  update();
}

/** Lance le chargement des régions cochées, puis planifie le rendu. */
function update() {
  for (const code of state.crit.regions) {
    if (store.isLoaded(code) || pending.has(code)) continue;
    pending.add(code);
    failed.delete(code);
    ui.controls.setRegionState(code, 'loading');
    store
      .load(code)
      .catch((e) => {
        failed.add(code);
        console.error(e);
      })
      .finally(() => {
        pending.delete(code);
        ui.controls.setRegionState(code, failed.has(code) ? 'error' : null);
        showErrors();
        schedule();
      });
  }
  showErrors();
  schedule();
}

function showErrors() {
  const names = [...failed].filter((c) => state.crit.regions.includes(c)).map((c) => index.regionByCode.get(c).name);
  const el = $('#load-error');
  el.hidden = !names.length;
  el.textContent = names.length ? `Impossible de charger : ${names.join(', ')}. Décochez puis recochez la région pour réessayer.` : '';
}

let lastCommunes = null;
let lastRegions = '';
let shownDetail = '';
let shownCode = null;

function render() {
  const { crit } = state;
  const communes = store.communesOf(crit.regions);
  const regionsKey = [...crit.regions].sort().join(',');
  if (regionsKey !== lastRegions) {
    lastRegions = regionsKey;
    ui.map.setRegions(new Set(crit.regions.map((c) => index.regionByCode.get(c).name)));
  }
  const listChanged = communes !== lastCommunes;
  if (listChanged) {
    lastCommunes = communes;
    ui.map.setCommunes(communes);
    ui.controls.setMedian(medianLeft(communes));
  }

  const hubIdx = crit.hub ? index.hubByCode.get(crit.hub).i : -1;
  results = sortResults(applyFilters(communes, crit, hubIdx), state.sort);
  resultMap = null;
  ui.map.setHits(results);
  ui.map.setHub(hubIdx);
  renderSelection();
  if (listChanged) ui.map.fit(); // régions modifiées ou chargées : on cadre les communes retenues (et la sélection)
  paintResults();

  const n = results.length;
  $('#sum-count').textContent = crit.regions.length ? `${fmtNumber(n)} commune${n > 1 ? 's' : ''}` : 'aucune région';
  ui.map.setLabel(`Carte des communes : ${fmtNumber(n)} correspondent aux critères. Le tableau des résultats donne les mêmes informations.`);
}
const schedule = rafThrottle(render);

function paintResults() {
  const loading = state.crit.regions.some((c) => pending.has(c));
  ui.results.update(results, state.sort, {
    loaded: store.communesOf(state.crit.regions).length,
    loading,
    anyHub: !state.crit.hub,
    noRegion: !state.crit.regions.length,
  });
}

const resultOf = (code) => (resultMap ||= new Map(results.map((r) => [r.c.code, r]))).get(code);
const hubIdxOf = () => (state.crit.hub ? index.hubByCode.get(state.crit.hub).i : -1);

function tipLines(c) {
  const r = resultOf(c.code);
  return [`${c.nom} (${c.dep})`, fmtPop(c.pop), r ? `${fmtDuration(r.min)} · ${trainsText(r.trains)}` : 'Ne correspond pas aux critères'];
}

// ---------- sélection et fiche ----------
function renderSelection() {
  const c = state.selected && store.commune(state.selected);
  const shown = c && state.crit.regions.includes(c.region) ? c : null;
  // sélection devenue introuvable (région décochée, code inconnu) : on l'oublie, sauf si des régions chargent encore
  if (state.selected && !shown && !state.crit.regions.some((r) => pending.has(r))) {
    state.selected = null;
    persist(false);
  }
  ui.map.setSelected(shown);
  ui.results.setSelected(shown?.code ?? null);
  document.body.classList.toggle('sheet-open', !!shown);
  $('#app').classList.toggle('has-detail', !!shown);
  if (!shown) {
    shownCode = null;
    shownDetail = '';
    return ui.detail.hide();
  }
  if (shown.code !== shownCode) ui.map.reveal(shown); // nouvelle sélection (tableau, adresse, retour arrière) : la rendre visible sur la carte
  shownCode = shown.code;
  const r = resultOf(shown.code) || null;
  const sig = `${shown.code}|${r ? `${r.hub}.${r.min}.${r.trains}` : '-'}|${hubIdxOf()}`;
  if (sig === shownDetail) return; // inchangée : on ne reconstruit pas la fiche (elle garde son défilement)
  shownDetail = sig;
  ui.detail.show({ c: shown, result: r, hubIdx: hubIdxOf(), dep: deps.get(shown.dep), payload });
}

function select(code, how) {
  const c = code && store.commune(code);
  state.selected = c ? code : null;
  renderSelection();
  persist(true);
  if (!c) return;
  origin = how.startsWith('table') ? 'table' : 'map';
  if (how.endsWith('kbd')) ui.detail.focus();
  if (origin === 'map') ui.results.reveal(code);
  if (origin === 'map' && narrow()) revealAboveSheet();
}

function closeDetail() {
  const prev = state.selected;
  if (!prev) return;
  const hadFocus = $('#detail').contains(document.activeElement) || document.activeElement === document.body;
  select(null, 'close');
  if (hadFocus && origin === 'table') ui.results.focusRow(prev);
}

/** Mobile : la feuille de la fiche masque le bas de l'écran ; on remonte la carte dans la zone restée visible. */
function revealAboveSheet() {
  requestAnimationFrame(() => {
    const r = $('#map').getBoundingClientRect();
    const sheetTop = $('#detail').getBoundingClientRect().top;
    if (r.top >= 0 && r.bottom <= sheetTop - 8) return;
    scrollBy({ top: r.top - 8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

// ---------- critères, tri ----------
function onChange(patch) {
  Object.assign(state.crit, patch);
  if ('popMin' in patch) fixPopulation(state.crit, 'popMin');
  if ('popMax' in patch) fixPopulation(state.crit, 'popMax');
  ui.controls.sync(state.crit);
  update();
  persist(false);
}

function onReset() {
  state.crit = { ...defaults, regions: [...defaults.regions] };
  state.sort = { ...DEFAULT_SORT };
  ui.controls.sync(state.crit);
  update();
  persist(false, true);
}

function onSort(sort) {
  state.sort = sort;
  sortResults(results, sort); // même tableau : la pagination du tableau est conservée
  paintResults();
  persist(false);
}

async function onCopy() {
  persist(false, true);
  try {
    await navigator.clipboard.writeText(location.href);
    ui.controls.flash('Lien copié');
  } catch {
    ui.controls.flash('Copiez l’adresse depuis la barre du navigateur');
  }
}

// Écriture du fragment : entrée d'historique pour une sélection, remplacement (différé) pour les curseurs.
let hashTimer;
function persist(push, now = false) {
  clearTimeout(hashTimer);
  const write = () => writeHash(hashFor(state, defaults, DEFAULT_SORT), { push });
  if (push || now) write();
  else hashTimer = setTimeout(write, 300);
}

// ---------- divers ----------
/** Complète la section « Méthode » avec les valeurs de l'index (rayons, jour de référence, date de génération). */
function fillMethod() {
  for (const el of document.querySelectorAll('[data-radius]')) el.textContent = index.radius[el.dataset.radius] ?? el.textContent;
  if (index.reference_day) $('#ref-day').textContent = fmtDay(index.reference_day);
  $('#generated').textContent = index.generated_at ? `Données générées le ${fmtDateTime(index.generated_at)}.` : '';
}

/** Hauteur de l'en-tête : le tiroir de la fiche (écrans moyens) s'ouvre juste dessous. */
function measureHeader() {
  document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`);
}
