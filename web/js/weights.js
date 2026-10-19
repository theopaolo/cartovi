// weights.js — un curseur par indicateur, regroupés par thème (0 = ignoré, 3 = très important).
import { h } from './dom.js';
import { fmtNumber, NBSP } from './format.js';
import { staleBadge } from './panel.js';

export function createWeights(root, { data, defaults, onChange, onReset, onCopy }) {
  if (!data) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Les curseurs apparaîtront dès que les indicateurs seront générés.'));
    return { sync() {}, flash() {} };
  }
  const inputs = new Map();
  const outputs = new Map();
  const shares = new Map();

  const row = (ind) => {
    const id = `w-${ind.id}`;
    const input = h('input', {
      type: 'range',
      id,
      min: 0,
      max: 3,
      step: 0.5,
      value: defaults[ind.id],
      oninput: (e) => onChange(ind.id, Number(e.target.value)),
    });
    const out = h('output', { class: 'wval', for: id });
    inputs.set(ind.id, input);
    outputs.set(ind.id, out);
    return h(
      'div',
      { class: 'wrow' },
      h('label', { for: id, class: 'wlabel', title: ind.description || null }, ind.label, ind.status === 'stale' ? staleBadge() : null),
      out,
      input,
      h('p', { class: 'wnote' }, `${ind.direction < 0 ? '↓ plus bas' : '↑ plus haut'} = plus favorable${ind.unit ? ` · ${ind.unit}` : ''}`),
    );
  };

  const themeBlocks = data.themes.map((theme, i) => {
    const share = h('span', { class: 'share' });
    shares.set(theme.id, share);
    return h(
      'details',
      { class: 'theme', open: data.indicators.length <= 12 || i === 0 },
      h('summary', {}, h('h3', {}, theme.label), share),
      data.indicators.filter((ind) => ind.theme === theme.id).map(row),
    );
  });

  const resetBtn = h('button', { type: 'button', class: 'btn', onclick: onReset }, 'Réinitialiser');
  const copyBtn = h('button', { type: 'button', class: 'btn ghost', onclick: onCopy }, 'Copier le lien');
  const status = h('span', { class: 'flash', role: 'status' });
  root.replaceChildren(
    h(
      'p',
      { class: 'muted small' },
      'Réglez l’importance de chaque indicateur : 0 = ignoré, 3 = très important. La carte se recalcule en direct. Ces poids sont des choix de valeur, pas des faits.',
    ),
    h('div', { class: 'actions' }, resetBtn, copyBtn, status),
    ...themeBlocks,
  );

  let timer;
  return {
    /** Aligne curseurs, valeurs et parts de thème sur l'état (sans déplacer le curseur en cours de glissement). */
    sync(weights) {
      let total = 0;
      for (const id of inputs.keys()) total += weights[id];
      const byTheme = {};
      for (const ind of data.indicators) {
        const w = weights[ind.id];
        if (document.activeElement !== inputs.get(ind.id)) inputs.get(ind.id).value = w;
        inputs.get(ind.id).setAttribute('aria-valuetext', w > 0 ? fmtNumber(w, 1) : 'ignoré');
        outputs.get(ind.id).textContent = w > 0 ? fmtNumber(w, w % 1 ? 1 : 0) : 'ignoré';
        outputs.get(ind.id).classList.toggle('off', !(w > 0));
        byTheme[ind.theme] = (byTheme[ind.theme] || 0) + w;
      }
      for (const [id, el] of shares) el.textContent = total > 0 ? `${Math.round(((byTheme[id] || 0) / total) * 100)}${NBSP}% du poids` : '—';
      resetBtn.disabled = data.indicators.every((i) => weights[i.id] === defaults[i.id]);
    },
    flash(text) {
      status.textContent = text;
      clearTimeout(timer);
      timer = setTimeout(() => (status.textContent = ''), 2500);
    },
  };
}
