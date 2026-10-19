// sources.js — section « Méthode & sources » : liste des indicateurs, sources, licences, état.
import { h } from './dom.js';
import { NBSP, fmtDate, fmtDateTime, fmtNumber } from './format.js';

export function renderSources(root, data, nTerrs, codes) {
  if (!data) {
    root.replaceChildren(h('p', { class: 'muted' }, 'La liste des sources apparaîtra dès que les indicateurs seront générés (génération hebdomadaire automatique).'));
    return;
  }
  const known = new Set(codes);
  const block = (ind) => {
    const src = ind.source;
    const stale = ind.status === 'stale';
    const covered = Object.keys(ind.values).filter((c) => known.has(c) && Number.isFinite(ind.values[c])).length;
    const dd = (label, ...v) => h('div', {}, h('dt', {}, label), h('dd', {}, ...v));
    return h(
      'article',
      { class: `src${stale ? ' is-stale' : ''}` },
      h('h4', {}, ind.label, h('span', { class: `badge ${stale ? 'warn' : 'ok'}` }, stale ? 'périmé' : 'à jour')),
      ind.description ? h('p', { class: 'desc' }, ind.description) : null,
      stale
        ? h(
            'p',
            { class: 'stale-msg' },
            `Dernière collecte en échec${ind.last_run.finished_at ? ` le ${fmtDate(ind.last_run.finished_at)}` : ''}${ind.last_run.message ? ` : ${ind.last_run.message}` : ''}. Valeurs de la dernière collecte réussie${ind.last_ok ? ` (${fmtDate(ind.last_ok)})` : ''}.`,
          )
        : null,
      h(
        'dl',
        { class: 'meta' },
        dd('Sens retenu', ind.direction < 0 ? '↓ plus bas = plus favorable' : '↑ plus haut = plus favorable', ind.unit ? ` (${ind.unit})` : ''),
        dd('Poids par défaut', fmtNumber(ind.weight, ind.weight % 1 ? 1 : 0)),
        dd('Source', src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.label || src.provider || src.url) : src.label || src.provider || '—', src.provider && src.label ? ` · ${src.provider}` : ''),
        dd('Licence', src.licence || '—'),
        dd('Période', ind.period || '—'),
        dd('Actualisation', `${src.refresh || '—'} · données du ${fmtDate(ind.updated_at)}`),
        dd('Couverture', `${covered}${NBSP}/${NBSP}${nTerrs} départements`),
      ),
    );
  };
  root.replaceChildren(
    ...data.themes.map((t) => h('section', { class: 'src-theme' }, h('h3', {}, t.label), data.indicators.filter((i) => i.theme === t.id).map(block))),
  );
}

export function renderGenerated(el, data) {
  el.textContent = data?.generated_at ? `Données générées le ${fmtDateTime(data.generated_at)}.` : 'Données en cours de génération.';
}
