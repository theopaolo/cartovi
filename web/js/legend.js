// legend.js — légende de la carte (reconstruite à chaque recalcul : ~20 éléments).
import { h } from './dom.js';
import { CLASSES, VALUE_CLASSES } from './classes.js';
import { NBSP, fmtNumber } from './format.js';

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function renderLegend(root, view, { staleCount = 0 } = {}) {
  if (view.kind === 'none') {
    root.replaceChildren(
      h(
        'p',
        { class: 'legend-msg' },
        view.reason === 'zero'
          ? 'Tous les poids sont à 0 : aucun indice n’est calculable. Augmentez au moins un poids.'
          : 'Aucune donnée à afficher pour le moment : la carte reste grise en attendant les indicateurs.',
      ),
    );
    return;
  }
  const comp = view.kind === 'composite';
  const ind = view.indicator;
  const items = view.classes.map((c, i) => {
    const sw = h('i', { class: 'sw', style: `background:var(--${comp ? 'c' : 's'}${i + 1})` });
    if (comp) {
      const ct = c.count ? `${c.count} dép. · score ${fmtNumber(c.min, 0)}–${fmtNumber(c.max, 0)}` : 'aucun département';
      return h('li', {}, sw, h('div', {}, h('div', { class: 'row' }, h('b', {}, CLASSES[i].name), h('span', { class: 'ct' }, ct)), h('span', { class: 'ds' }, CLASSES[i].desc)));
    }
    const f = (v) => fmtNumber(v, ind.decimals);
    const range = !c.count ? 'aucun département' : c.min === c.max ? f(c.min) : `${f(c.min)} – ${f(c.max)}`;
    const name = `${range}${c.count && ind.unit ? NBSP + ind.unit : ''}`;
    return h('li', {}, sw, h('div', {}, h('div', { class: 'row' }, h('b', {}, name), h('span', { class: 'ct' }, c.count ? `${c.count} dép.` : '')), h('span', { class: 'ds' }, VALUE_CLASSES[i])));
  });

  const foot = [];
  if (view.missing) foot.push(h('span', { class: 'legend-na' }, h('i', { class: 'sw na' }), `Donnée manquante (${plural(view.missing, 'département')})`));
  if (staleCount) foot.push(h('span', { class: 'legend-warn' }, `⚠ ${plural(staleCount, 'indicateur')} périmé${staleCount > 1 ? 's' : ''} : voir « Méthode & sources »`));

  root.replaceChildren(
    h(
      'div',
      { class: 'legend-head' },
      h('strong', {}, comp ? 'Indice composite' : `${ind.label}${ind.unit ? ` (${ind.unit})` : ''}`),
      h(
        'span',
        { class: 'muted' },
        comp
          ? 'Classement relatif entre départements selon vos pondérations, pas un jugement absolu.'
          : `${ind.direction < 0 ? '↓ plus bas' : '↑ plus haut'} = plus favorable. Classes = quintiles de valeurs.`,
      ),
    ),
    h('ol', { class: `legend-list ${comp ? 'is-comp' : 'is-ind'}` }, items),
    ...(foot.length ? [h('p', { class: 'legend-foot' }, foot)] : []), // pas de null : replaceChildren l'écrirait en texte
  );
}
