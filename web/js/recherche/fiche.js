// fiche.js — fiche d'une commune : les sections du profil (profile.js), chacune avec unité, période et source.
import { SCORED_LEVEL, cellText } from '../climat.js';
import { eauCellText, provenanceSentence } from '../eau.js';
import { h } from '../dom.js';
import { NBSP, fmtDate, fmtNumber } from '../format.js';
import { staleBadge } from '../panel.js';
import { NATIONAL_LEFT } from './text.js';
import { MAX_COMPARE } from './hash.js';
import { identityLine } from './profile.js';
import { riskNodes } from '../communes/risks-view.js';

const SCOPE = { commune: 'valeurs de la commune', departement: 'valeurs du département' };

export const sourceLink = (src) =>
  src?.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.label || src.provider || 'Source') : src?.label || src?.provider || 'Source';

/** Ligne « période · source » d'une section ou d'un indicateur. */
export const meta = (period, src, extra) => h('p', { class: 'ind-meta' }, period, ' · ', sourceLink(src), extra ? ` · ${extra}` : '');

export function createFiche(root, { onClose, onToggleCompare }) {
  const title = h('h2', { id: 'fiche-title', tabindex: '-1' });
  const sub = h('p', { class: 'detail-region' });
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer la fiche (Échap)', onclick: onClose }, '×');
  const actions = h('div', { class: 'rech-actions' });
  const body = h('div', { class: 'detail-body' });
  root.replaceChildren(h('div', { class: 'detail-head' }, h('div', {}, title, sub), close), body);
  let shownCode = null;

  return {
    focus: () => title.focus({ preventScroll: true }),
    hide() {
      root.hidden = true;
      shownCode = null;
    },
    get code() {
      return shownCode;
    },
    /** p : profil (profile.js) ; compared : la commune est dans la comparaison ; full : la comparaison est pleine. */
    show(p, { compared, full }) {
      const same = shownCode === p.code;
      shownCode = p.code;
      root.hidden = false;
      title.textContent = `${p.nom} (${p.code})`;
      sub.textContent = identityLine(p);
      const top = same ? root.scrollTop : 0;
      const toggle = h(
        'button',
        { type: 'button', class: `btn${compared ? '' : ' primary'}`, 'aria-pressed': String(compared), disabled: !compared && full, onclick: () => onToggleCompare(p.code) },
        compared ? 'Retirer de la comparaison' : 'Ajouter à la comparaison',
      );
      actions.replaceChildren(
        ...[
          toggle,
          !compared && full ? h('span', { class: 'muted small' }, `${MAX_COMPARE} communes au maximum`) : null,
          h('a', { class: 'btn', href: `index.html#d=${encodeURIComponent(p.dep)}` }, 'Voir le département sur la carte'),
          h('a', { class: 'btn', href: `communes.html#${p.regionCode ? `r=${p.regionCode}&` : ''}c=${p.code}` }, 'Ouvrir dans Communes'),
        ].filter(Boolean),
      );
      body.replaceChildren(
        actions,
        h('p', { class: 'rech-back' }, h('a', { href: '#q', 'data-jump': '' }, '↑ Retour à la recherche')),
        ...p.sections.map(section),
        h('p', { class: 'muted small' }, 'Population : ', sourceLink({ label: 'geo.api.gouv.fr (INSEE)', url: 'https://geo.api.gouv.fr/' }), '.'),
      );
      root.scrollTop = top;
    },
  };
}

const bar = (v) => h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }));
const rows = (list) => h('dl', { class: 'kv' }, list.flatMap((r) => [h('dt', {}, r.label), h('dd', {}, r.text, r.sub ? h('span', { class: 'sub' }, r.sub) : null)]));
const head = (s) => h('h3', {}, s.title, h('span', { class: `badge scope-${s.scope}` }, SCOPE[s.scope]), s.test?.marked || s.test?.page_marked ? h('span', { class: 'badge warn' }, 'données de test') : null);

function section(s) {
  if (s.id === 'departement') return departement(s);
  const out = h('section', { class: 'rech-sec', 'data-sec': s.id }, head(s));
  if (s.state) {
    out.append(h('p', { class: 'muted' }, s.state === 'loading' ? 'Chargement…' : 'Données indisponibles pour le moment.'));
    return out;
  }
  if (s.id === 'politique') {
    out.append(...s.rows.map(share), h('p', { class: 'muted small' }, s.reference));
  } else if (s.id === 'risques') {
    out.append(...riskNodes(s.reading));
  } else if (s.id === 'futur' && s.trajectory) {
    out.append(trajectoryTable(s.trajectory));
  } else if (s.id === 'eau' && s.eau) {
    out.append(testNote(s.test), eauTable(s.eau), h('p', { class: 'muted small' }, provenanceSentence(s.eau.prov)));
  } else if (s.id === 'eau') {
    out.append(testNote(s.test), rows(s.rows));
  } else {
    out.append(rows(s.rows));
  }
  if (s.links?.length) {
    out.append(
      h('p', { class: 'rech-sub' }, s.linksLabel),
      h('ul', { class: 'links' }, s.links.map((l) => h('li', {}, h('span', {}, l.label), h('span', { class: 'muted' }, `${l.text} · ${l.sub}`)))),
    );
  }
  if (s.empty) out.append(h('p', { class: 'muted' }, s.empty));
  if (s.note) out.append(h('p', { class: 'muted small' }, s.note));
  if (s.source) out.append(meta(s.source.period, s.source, s.source.licence));
  for (const src of s.sources || []) out.append(meta(src.period, src));
  return out;
}

/** Climat futur : un indicateur par ligne, un niveau de réchauffement par colonne (celui du score mis en avant). */
function trajectoryTable(traj) {
  const levels = traj[0].cells;
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'rank-table traj-table' },
      h('caption', { class: 'sr-only' }, 'Climat futur au point de grille de la commune, par niveau de réchauffement'),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Indicateur'),
          levels.map((l) => h('th', { scope: 'col', class: `c-val${l.level === SCORED_LEVEL ? ' cur' : ''}` }, l.label, h('span', { class: 'sub' }, l.horizon))),
        ),
      ),
      h(
        'tbody',
        {},
        traj.map((ind) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, ind.label, h('span', { class: 'sub' }, ind.unit)),
            ind.cells.map((cell) => h('td', { class: `c-val${cell.level === SCORED_LEVEL ? ' cur' : ''}` }, cellText(ind, cell))),
          ),
        ),
      ),
    ),
  );
}

/** Statut de test des débits futurs, tel que constaté sur la source, avec les liens qui permettent de le vérifier. */
function testNote(t) {
  if (!t) return null;
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const pub = t.published || [];
  const when = pub.length > 1 ? `entre le ${fmtDate(pub[0])} et le ${fmtDate(pub[pub.length - 1])}` : pub.length ? `le ${fmtDate(pub[0])}` : '';
  if (!t.marked && !t.page_marked) {
    return h('p', { class: 'stale-msg' }, 'Ces fichiers ont été republiés sans la mention « test » : leur statut est à revérifier. ', link(t.page, 'Page du jeu de données'), '.');
  }
  return h(
    'p',
    { class: 'stale-msg' },
    h('strong', {}, 'Données de test. '),
    `Les fichiers ont été publiés ${when} sous une adresse marquée « attention-test » par leur producteur. `,
    t.page_marked
      ? 'La page du jeu porte la même mention. '
      : 'La page du jeu ne porte plus cette mention, mais les fichiers n’ont pas été republiés et contiennent encore des erreurs d’étiquetage (la période de calcul des crues y est décrite comme « mois du minimum des débits »). ',
    'Vérifier : ',
    link(t.file, `un des fichiers (adresse « attention-test »${t.fileSize ? `, CSV de ${fmtNumber(t.fileSize / 1e6)}${NBSP}Mo` : ''})`),
    ' · ',
    link(t.page, 'page du jeu de données'),
    '.',
  );
}

/** Débits futurs : un indicateur par ligne, un niveau de réchauffement par colonne (écarts à 1976–2005). */
function eauTable(e) {
  const levels = e.rows[0].cells;
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'rank-table traj-table' },
      h('caption', { class: 'sr-only' }, 'Débits futurs des rivières, écart à 1976–2005 par niveau de réchauffement'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Indicateur'), levels.map((l) => h('th', { scope: 'col', class: `c-val${l.level === SCORED_LEVEL ? ' cur' : ''}` }, l.label, h('span', { class: 'sub' }, l.horizon))))),
      h(
        'tbody',
        {},
        e.rows.map((row) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row', title: row.definition }, row.label, h('span', { class: 'sub' }, row.definition)),
            row.cells.map((cell) => h('td', { class: `c-val${cell.level === SCORED_LEVEL ? ' cur' : ''}` }, eauCellText(row, cell))),
          ),
        ),
      ),
    ),
  );
}

/** Part de gauche : valeur, barre neutre (gris, pas de bon ni de mauvais) et repère de la référence nationale. */
function share(r) {
  const v = r.value;
  return h(
    'div',
    { class: 'rech-share' },
    h('div', { class: 'ind-head' }, h('span', { class: 'ind-label' }, r.label), h('span', { class: 'ind-val' }, r.text)),
    v == null
      ? h('div', { class: 'bar na', 'aria-hidden': 'true' })
      : h('div', { class: 'bar share', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }), h('b', { style: `left:${NATIONAL_LEFT}%`, title: `France entière : ${fmtNumber(NATIONAL_LEFT, 1)}${NBSP}%` })),
  );
}

function departement(s) {
  const out = h('section', { class: 'rech-sec rech-dep', 'data-sec': 'departement' }, h('h3', {}, s.title, h('span', { class: 'badge scope-departement' }, SCOPE.departement)));
  out.append(h('p', { class: 'muted small' }, 'Ces valeurs décrivent le département entier, pas la commune : un même département regroupe des communes très différentes.'));
  if (s.state === 'absent') {
    out.append(h('p', { class: 'muted' }, 'Indicateurs en cours de génération.'));
    return out;
  }
  const comp = s.composite;
  if (comp) {
    out.append(
      h(
        'div',
        { class: 'detail-sum' },
        h('span', { class: 'chip', style: `background:var(--c${comp.cls});color:var(--c${comp.cls}-ink)` }, comp.name),
        h('p', { class: 'detail-rank' }, h('strong', {}, comp.rankText), h('span', {}, `Score ${fmtNumber(comp.score * 100, 1)}${NBSP}/${NBSP}100`)),
        h('p', { class: 'muted small' }, 'Indice composite sous les pondérations par défaut ; classement relatif entre départements, pas un jugement absolu.', comp.used < comp.nWeighted ? ` Calculé sur ${comp.used} indicateurs sur ${comp.nWeighted}.` : ''),
      ),
    );
  }
  for (const t of s.themes) {
    out.append(h('div', { class: 'theme-block' }, h('h4', { class: 'rech-theme' }, t.label), h('ul', { class: 'ind-list' }, t.rows.map(indicator))));
  }
  return out;
}

function indicator(r) {
  const missing = r.pct == null;
  return h(
    'li',
    { class: 'ind' },
    h('div', { class: 'ind-head' }, h('span', { class: 'ind-label' }, r.label, r.stale ? staleBadge() : null), h('span', { class: 'ind-val' }, r.text)),
    h('div', { class: `bar${missing ? ' na' : ''}`, 'aria-hidden': 'true' }, missing ? null : h('i', { style: `width:${r.pct}%` })),
    h('p', { class: 'ind-meta' }, missing ? 'Pas de valeur pour ce département' : `mieux que ${r.pct}${NBSP}% des départements`, ' · ', r.period, ' · ', sourceLink(r.source)),
  );
}
