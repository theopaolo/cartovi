// panel.js — panneau détail d'un département : classe, rang, score et indicateurs par thème.
import { h } from './dom.js';
import { CLASSES } from './classes.js';
import { composite } from './score.js';
import { NBSP, fmtNumber, fmtValue, pct, rankText } from './format.js';

export const staleBadge = () => h('span', { class: 'badge warn', title: 'Dernière collecte en échec' }, 'périmé');

export function createDetail(root, { onClose }) {
  const title = h('h2', { id: 'detail-title', tabindex: '-1' });
  const sub = h('p', { class: 'detail-region' });
  const body = h('div', { class: 'detail-body' });
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer le détail (Échap)', onclick: onClose }, '×');
  root.replaceChildren(h('div', { class: 'detail-head' }, h('div', {}, title, sub), close), body);
  root.setAttribute('aria-labelledby', 'detail-title');

  return {
    focus: () => title.focus({ preventScroll: true }),
    hide: () => {
      root.hidden = true;
    },
    /** ctx : { terr, comp (vue composite), data, scores, weights, activeId } */
    show({ terr, comp, data, scores, weights, activeId }) {
      root.hidden = false;
      title.textContent = `${terr.name} (${terr.code})`;
      sub.textContent = `${terr.region} · ${fmtNumber(terr.area_km2, 0)}${NBSP}km²`;
      const e = comp.byCode[terr.code];
      body.replaceChildren(
        summary(comp, e),
        ...(data ? data.themes.map((t) => themeBlock(t, terr.code, data, scores, weights, activeId)) : []),
      );
    },
  };
}

function summary(comp, e) {
  if (comp.kind === 'none') {
    return h('p', { class: 'muted' }, comp.reason === 'zero' ? 'Tous les poids sont à 0 : aucun indice n’est calculable.' : 'Les indicateurs sont en cours de génération : pas encore de classement pour ce département.');
  }
  if (e.missing) return h('p', { class: 'muted' }, 'Donnée manquante : aucun indicateur pondéré n’est renseigné pour ce département.');
  const c = e.cls;
  return h(
    'div',
    { class: 'detail-sum' },
    h('span', { class: 'chip', style: `background:var(--c${c});color:var(--c${c}-ink)` }, CLASSES[c - 1].name),
    h('p', { class: 'detail-rank' }, h('strong', {}, rankText(e.rank, comp.n)), h('span', {}, `Score ${fmtNumber(e.score * 100, 1)}${NBSP}/${NBSP}100`)),
    h(
      'p',
      { class: 'muted small' },
      'Classement relatif entre départements, pas un jugement absolu.',
      e.used < comp.nWeighted ? ` Calculé sur ${e.used} indicateur${e.used > 1 ? 's' : ''} sur ${comp.nWeighted} (valeurs manquantes ignorées).` : '',
    ),
  );
}

function themeBlock(theme, code, data, scores, weights, activeId) {
  const inds = data.indicators.filter((i) => i.theme === theme.id);
  const w = Object.fromEntries(inds.map((i) => [i.id, weights[i.id]]));
  const sub = composite(scores, w, [code])[code];
  return h(
    'section',
    { class: 'theme-block' },
    h('h3', {}, theme.label, h('span', { class: 'theme-score' }, sub ? `${fmtNumber(sub.score * 100, 0)}${NBSP}/${NBSP}100` : 'ignoré')),
    h('ul', { class: 'ind-list' }, inds.map((i) => indicatorRow(i, code, scores, weights, activeId))),
  );
}

function indicatorRow(ind, code, scores, weights, activeId) {
  const v = ind.values[code];
  const sc = scores[ind.id]?.[code];
  const missing = !Number.isFinite(v) || sc === undefined;
  const ignored = !(weights[ind.id] > 0);
  const src = ind.source;
  const srcName = src.label || src.provider || 'Source';
  return h(
    'li',
    { class: `ind${ignored ? ' off' : ''}${activeId === ind.id ? ' active' : ''}` },
    h(
      'div',
      { class: 'ind-head' },
      h('span', { class: 'ind-label' }, ind.label, ind.status === 'stale' ? staleBadge() : null, ignored ? h('span', { class: 'badge' }, 'ignoré') : null),
      h('span', { class: 'ind-val' }, missing ? 'donnée manquante' : fmtValue(v, ind)),
    ),
    h('div', { class: `bar${missing ? ' na' : ''}`, 'aria-hidden': 'true' }, missing ? null : h('i', { style: `width:${pct(sc)}%` })),
    h(
      'p',
      { class: 'ind-meta' },
      missing ? 'Pas de valeur pour ce département' : `mieux que ${pct(sc)}${NBSP}% des départements`,
      ' · ',
      ind.period || 'période inconnue',
      ' · ',
      src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, srcName) : srcName,
    ),
  );
}
