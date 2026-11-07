// score-panel.js — panneau « Score personnalisé » : un poids (0–3) par critère, un sens quand il n'est pas évident.
// Chaque contrôle appelle onChange({id, w}), onChange({id, o}) ou onChange({norm}) ; sync(settings) réaligne l'ensemble.
import { h } from '../dom.js';
import { NBSP, fmtNumber } from '../format.js';
import { createNormToggle } from '../norm-toggle.js';
import { CRITERIA, GROUPS, W_MAX, W_STEP } from './score-communes.js';

const LEVEL_TEXT = { commune: 'commune', departement: 'département', repli: 'département (repli)' };
const LEVEL_TIP = {
  commune: 'Valeur propre à la commune ; si elle manque, celle du département quand l’unité est la même.',
  departement: 'Valeur du département, appliquée à toutes ses communes.',
  repli: 'Pas de valeur communale dans les données : repli sur l’indicateur du département (unité différente).',
};

export function createScorePanel(root, { onChange, onReset }) {
  const rows = new Map();
  let settings = null;
  let levels = {};

  const makeRow = (k) => {
    const id = `sw-${k.id}`;
    const out = h('output', { class: 'wval', for: id });
    const input = h('input', { type: 'range', id, min: 0, max: W_MAX, step: W_STEP, oninput: () => onChange({ id: k.id, w: Number(input.value) }) });
    const badge = h('span', { class: 'badge gran' });
    const hint = h('p', { class: 'wnote', hidden: true });
    const pills = k.choice
      ? h(
          'div',
          { class: 'pills', role: 'group', 'aria-label': `Sens : ${k.label}` },
          k.choice.map((o) => h('button', { type: 'button', class: 'pill', 'aria-pressed': 'false', onclick: () => onChange({ id: k.id, o: o.id }) }, o.label)),
        )
      : null;
    const el = h('div', { class: 'wrow sc-row' }, h('label', { for: id, class: 'wlabel' }, k.label, badge), out, pills, input, hint);
    rows.set(k.id, { k, el, input, out, badge, hint, pills });
    return el;
  };

  const flash = h('span', { class: 'flash', role: 'status' });
  const norm = createNormToggle((n) => onChange({ norm: n }));
  root.replaceChildren(
    h(
      'p',
      { class: 'muted small' },
      'Classe de 0 à 100 les communes retenues ci-dessus, selon ce qui compte pour vous : le score est relatif à cette sélection, pas à la France. Poids 0 : critère ignoré.',
    ),
    h('div', { class: 'norm-field' }, h('span', { class: 'wlabel' }, 'Lecture'), norm.el),
    h('p', { class: 'wnote' }, 'Par rang : seul l’ordre des communes compte. Par écart : la distance réelle entre valeurs compte, mais une valeur extrême écrase les autres (voir « Méthode »).'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: onReset }, 'Réinitialiser'), flash),
    ...GROUPS.map((g) => h('fieldset', { class: 'fsec' }, h('legend', {}, g.label), CRITERIA.filter((k) => k.group === g.id).map(makeRow))),
  );

  function paint() {
    if (!settings) return;
    norm.set(settings.norm);
    for (const { k, el, input, out, badge, hint, pills } of rows.values()) {
      const w = settings.w[k.id];
      const level = levels[k.id] ?? null;
      el.hidden = !!k.legacy && !level; // repli sur d'anciennes données : masqué tant que le détail par aléa existe
      const needsDir = !!k.choice && !settings.o[k.id];
      if (document.activeElement !== input) input.value = w;
      input.disabled = !level || needsDir;
      out.textContent = w > 0 && !needsDir ? fmtNumber(w, 1) : 'désactivé';
      out.classList.toggle('off', !(w > 0) || needsDir);
      input.setAttribute('aria-valuetext', out.textContent);
      badge.textContent = level ? LEVEL_TEXT[level] : 'indisponible';
      badge.title = level ? LEVEL_TIP[level] : 'Aucune donnée pour ce critère.';
      badge.classList.toggle('warn', level === 'repli' || !level);
      pills?.childNodes.forEach((b, i) => b.setAttribute('aria-pressed', String(k.choice[i].id === settings.o[k.id])));
      hint.hidden = !(needsDir || !level);
      hint.textContent = !level ? `Donnée indisponible pour les régions cochées${NBSP}: critère ignoré.` : 'Choisissez un sens pour activer ce critère.';
    }
  }

  let flashTimer;
  return {
    sync(s) {
      settings = s;
      paint();
    },
    /** levels : { idCritère: 'commune' | 'departement' | 'repli' | null } (levelOf) */
    setLevels(l) {
      levels = l;
      paint();
    },
    flash(text) {
      flash.textContent = text;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (flash.textContent = ''), 2500);
    },
  };
}
