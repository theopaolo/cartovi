// controls.js — formulaire des critères. Chaque contrôle appelle onChange({champ: valeur}) ; sync(crit) réaligne l'ensemble.
import { h } from '../dom.js';
import { NBSP, fmtNumber } from '../format.js';
import { fold } from './data.js';
import { SIZES, STOPS } from './filter.js';
import { fmtDay, fmtDuration, fmtPct, plural } from './text.js';

const num = (n) => fmtNumber(n);
const NATIONAL_LEFT = 32.4; // part de gauche de la France entière aux européennes 2024 (% des exprimés)

export function createControls(root, { index, onChange, onReset, onCopy }) {
  const setters = []; // chaque contrôle y enregistre sa fonction de mise à jour
  const fieldset = (title, ...kids) => h('fieldset', { class: 'fsec' }, h('legend', {}, title), ...kids);

  function check(id, label, handler) {
    const input = h('input', { type: 'checkbox', id, onchange: () => handler(input.checked) });
    return { el: h('label', { class: 'check', for: id }, input, h('span', {}, label)), input };
  }

  /** Curseur à paliers (stops) ou continu (min/max/step) ; `text(v)` donne l'affichage, `off(v)` « critère inactif ». */
  function slider({ key, label, note, stops, min, max, step = 1, text, off }) {
    const id = `f-${key}`;
    const out = h('output', { class: 'wval', for: id });
    const input = h('input', {
      type: 'range',
      id,
      min: stops ? 0 : min,
      max: stops ? stops.length - 1 : max,
      step: stops ? 1 : step,
      oninput: () => onChange({ [key]: stops ? stops[Number(input.value)] : Number(input.value) }),
    });
    const noteEl = note ? h('p', { class: 'wnote' }, note) : null;
    setters.push((crit) => {
      const v = crit[key];
      if (document.activeElement !== input) {
        // ne pas bousculer le curseur pendant le glissement
        const i = stops ? stops.findIndex((s) => s >= v) : v;
        input.value = stops && i < 0 ? stops.length - 1 : i;
      }
      out.textContent = text(v);
      out.classList.toggle('off', off(v));
      input.setAttribute('aria-valuetext', text(v));
    });
    return { el: h('div', { class: 'wrow' }, h('label', { for: id, class: 'wlabel' }, label), out, input, noteEl), note: noteEl };
  }

  // ---------- régions ----------
  const regionBoxes = new Map();
  const emitRegions = () => onChange({ regions: [...regionBoxes].filter(([, r]) => r.input.checked).map(([code]) => code) });
  const setAll = (on) => {
    for (const r of regionBoxes.values()) r.input.checked = on;
    emitRegions();
  };
  const regionList = h(
    'div',
    { class: 'regions' },
    index.regions.map((r) => {
      const input = h('input', { type: 'checkbox', value: r.code, id: `reg-${r.code}`, onchange: emitRegions });
      const state = h('span', { class: 'rstate' });
      regionBoxes.set(r.code, { input, state });
      return h('label', { class: 'check', for: `reg-${r.code}`, title: `${num(r.communes)} communes` }, input, h('span', {}, r.name, state));
    }),
  );
  setters.push((crit) => {
    for (const [code, r] of regionBoxes) r.input.checked = crit.regions.includes(code);
  });

  // ---------- ville de référence : champ avec suggestions (datalist), ou « n'importe laquelle » ----------
  const hubs = [...index.hubs].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const byLabel = new Map(hubs.map((hb) => [fold(hb.label), hb]));
  let lastHub = null; // dernière ville choisie, pour y revenir en décochant « n'importe laquelle »
  const hubHint = h('p', { class: 'wnote', role: 'status' });
  const hubInput = h('input', {
    type: 'text',
    id: 'f-hub',
    class: 'text-in',
    list: 'hub-list',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Tapez une ville…',
    onfocus: () => hubInput.select(),
  });
  const pick = (hb) => {
    lastHub = hb.code;
    hubInput.value = hb.label;
    hubHint.textContent = '';
    onChange({ hub: hb.code });
  };
  // un choix dans la liste déclenche « input » avec le libellé exact ; « change » gère la saisie libre (préfixe unique accepté)
  hubInput.addEventListener('input', () => {
    const hb = byLabel.get(fold(hubInput.value.trim()));
    if (hb && hb.code !== lastHub) pick(hb);
  });
  hubInput.addEventListener('change', () => {
    const t = fold(hubInput.value.trim());
    const starts = hubs.filter((hb) => fold(hb.label).startsWith(t));
    const hb = byLabel.get(t) || (t && starts.length === 1 ? starts[0] : null);
    if (hb) return hb.code === lastHub ? (hubInput.value = hb.label) : pick(hb);
    hubInput.value = index.hubByCode.get(lastHub)?.label || '';
    hubHint.textContent = 'Ville inconnue : choisissez dans la liste.';
  });
  const any = check('f-any', 'ou n’importe quelle ville de référence', (on) => onChange({ hub: on ? null : lastHub }));
  setters.push((crit) => {
    if (crit.hub) lastHub = crit.hub;
    any.input.checked = crit.hub === null;
    hubInput.disabled = crit.hub === null;
    hubInput.value = index.hubByCode.get(lastHub)?.label || '';
  });

  // ---------- taille ----------
  const sizeButtons = SIZES.map((s) =>
    h('button', { type: 'button', class: 'pill', 'aria-pressed': 'false', onclick: () => onChange({ popMin: s.min, popMax: s.max }) }, s.label),
  );
  setters.push((crit) => {
    SIZES.forEach((s, i) => sizeButtons[i].setAttribute('aria-pressed', String(s.min === crit.popMin && s.max === crit.popMax)));
  });

  const R = index.radius;
  const sMin = slider({ key: 'popMin', label: 'Population minimale', stops: STOPS.popMin, text: (v) => (v ? `${num(v)}${NBSP}hab. ou plus` : 'aucun minimum'), off: (v) => !v });
  const sMax = slider({ key: 'popMax', label: 'Population maximale', stops: STOPS.popMax, text: (v) => (v < Infinity ? `moins de ${num(v)}${NBSP}hab.` : 'aucun maximum'), off: (v) => v === Infinity });
  const sTime = slider({ key: 'maxMin', label: 'Temps de trajet direct maximum', min: 15, max: 150, step: 5, text: fmtDuration, off: () => false });
  const sDist = slider({
    key: 'distMin',
    label: 'Distance minimale au centre de la ville',
    note: 'À vol d’oiseau : écarte la ville de référence et sa banlieue. En mode « n’importe quelle ville », vaut pour chacune d’elles.',
    min: 0,
    max: 60,
    step: 5,
    text: (v) => (v ? `${v}${NBSP}km minimum` : 'aucune'),
    off: (v) => !v,
  });
  const sTrains = slider({
    key: 'trainsMin',
    label: 'Trains par jour',
    note: 'Nombre minimal de trains directs par jour vers la ville de référence.',
    stops: STOPS.trainsMin,
    text: (v) => (v ? `${v}${NBSP}trains/j ou plus` : 'aucun minimum'),
    off: (v) => !v,
  });
  const sKm = slider({
    key: 'kmMax',
    label: 'Distance à la gare',
    note: `À vol d’oiseau, depuis le centre de la commune (gares à moins de ${R.gare}${NBSP}km).`,
    stops: STOPS.kmMax,
    text: (v) => (v < Infinity ? `${num(v)}${NBSP}km maximum` : `jusqu’à ${R.gare}${NBSP}km`),
    off: (v) => v === Infinity,
  });
  const sLeft = slider({
    key: 'leftMin',
    label: 'Part de gauche minimale',
    note: ' ',
    min: 0,
    max: 70,
    text: (v) => (v ? `${v}${NBSP}% ou plus` : 'aucun minimum'),
    off: (v) => !v,
  });
  const basisRadios = [
    ['commune', 'dans la commune'],
    ['zone', `dans un rayon de ${R.vote}${NBSP}km`],
  ].map(([value, text]) => {
    const input = h('input', { type: 'radio', name: 'left-basis', value, onchange: () => onChange({ leftBasis: value }) });
    return { value, input, el: h('label', { class: 'check' }, input, h('span', {}, text)) };
  });
  setters.push((crit) => {
    for (const r of basisRadios) r.input.checked = r.value === crit.leftBasis;
  });
  const sCine = slider({ key: 'cinemasMin', label: 'Cinémas', stops: STOPS.cinemasMin, text: (v) => (v ? `${plural(v, 'cinéma')} ou plus` : 'aucun minimum'), off: (v) => !v });
  const sScene = slider({ key: 'scenesMin', label: 'Scènes (théâtres, salles de spectacle)', stops: STOPS.scenesMin, text: (v) => (v ? `${plural(v, 'scène')} ou plus` : 'aucun minimum'), off: (v) => !v });
  const label = check('f-label', 'Au moins un lieu labellisé (scène nationale, SMAC, CDN…)', (on) => onChange({ label: on }));
  setters.push((crit) => {
    label.input.checked = crit.label;
  });
  const sPrice = slider({ key: 'priceMax', label: 'Prix médian des maisons', stops: STOPS.priceMax, text: (v) => (v < Infinity ? `${num(v)}${NBSP}€/m² maximum` : 'aucun plafond'), off: (v) => v === Infinity });
  const unknown = check('f-unknown', 'Garder les communes sans prix connu (moins de 10 ventes)', (on) => onChange({ priceUnknown: on }));
  setters.push((crit) => {
    unknown.input.checked = crit.priceUnknown;
  });

  // ---------- assemblage ----------
  const flashEl = h('span', { class: 'flash', role: 'status' });
  const resetBtn = h('button', { type: 'button', class: 'btn', onclick: onReset }, 'Réinitialiser');
  let flashTimer;
  root.replaceChildren(
    h('p', { class: 'muted small' }, 'Chaque critère est un filtre : une commune est retenue si elle les respecte tous. Laissez à « aucun » ce qui ne compte pas pour vous.'),
    h('div', { class: 'actions' }, resetBtn, h('button', { type: 'button', class: 'btn ghost', onclick: onCopy }, 'Copier le lien'), flashEl),
    fieldset(
      'Régions',
      h('div', { class: 'fsec-tools' }, h('button', { type: 'button', class: 'btn ghost tiny', onclick: () => setAll(true) }, 'Toutes'), h('button', { type: 'button', class: 'btn ghost tiny', onclick: () => setAll(false) }, 'Aucune')),
      regionList,
    ),
    fieldset(
      'Trajet en train direct',
      h('div', { class: 'wrow' }, h('label', { for: 'f-hub', class: 'wlabel' }, 'Ville de référence'), hubInput, hubHint),
      h('datalist', { id: 'hub-list' }, hubs.map((hb) => h('option', { value: hb.label }))),
      any.el,
      sTime.el,
      h('p', { class: 'wnote' }, `Trajet direct (sans correspondance) le plus court, ${fmtDay(index.reference_day)}.`),
      sDist.el,
      sTrains.el,
      sKm.el,
    ),
    fieldset('Taille de la commune', h('div', { class: 'pills' }, sizeButtons), sMin.el, sMax.el),
    fieldset(
      'Climat politique',
      h('div', { class: 'radios', role: 'radiogroup', 'aria-label': 'Base de la part de gauche' }, h('span', { class: 'wlabel' }, 'Mesurée'), basisRadios.map((r) => r.el)),
      sLeft.el,
    ),
    fieldset(`Culture à moins de ${R.culture}${NBSP}km`, sCine.el, sScene.el, label.el),
    fieldset('Prix', sPrice.el, unknown.el),
  );

  return {
    sync(crit) {
      for (const f of setters) f(crit);
    },
    /** state : 'loading' | 'error' | null */
    setRegionState(code, state) {
      const r = regionBoxes.get(code);
      if (!r) return;
      r.state.textContent = state === 'loading' ? ' (chargement…)' : state === 'error' ? ' (indisponible)' : '';
    },
    /** Repère sous le curseur : moyenne nationale et médiane des communes affichées, sur la base choisie. */
    setMedian(v) {
      sLeft.note.textContent = `Listes de gauche aux européennes 2024 : ${fmtPct(NATIONAL_LEFT)} des exprimés en France.${v == null ? '' : ` Médiane des communes affichées : ${fmtPct(v)}.`}`;
    },
    flash(text) {
      flashEl.textContent = text;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (flashEl.textContent = ''), 2500);
    },
  };
}
