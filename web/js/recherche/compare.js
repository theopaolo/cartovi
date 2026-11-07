// compare.js — tableau de comparaison : une colonne par commune, les lignes sont celles des fiches (mêmes profils, mêmes chiffres).
// Aucune mise en valeur d'une « meilleure » colonne. Pour les départements, le percentile est donné tel quel.
import { h } from '../dom.js';
import { NBSP } from '../format.js';
import { identityLine } from './profile.js';

const SCOPE_LABEL = { commune: 'valeurs de la commune', departement: 'valeurs du département', point: 'lecture au point de la commune' };

/** Cellule : valeur + précision, ou tiret. */
function cell(r, placeholder = '—') {
  if (!r) return h('td', { class: 'na' }, placeholder);
  return h('td', {}, h('span', { class: 'cv' }, r.text), r.sub ? h('span', { class: 'sub' }, r.sub) : null);
}

const secOf = (p, id) => p.sections.find((s) => s.id === id);

/**
 * @param {HTMLElement} root
 * @param {object[]} profiles  profils (profile.js), dans l'ordre des colonnes
 * @param {{onRemove:(code:string)=>void, onOpen:(code:string)=>void}} on
 */
export function renderCompare(root, profiles, { onRemove, onOpen }) {
  const n = profiles.length;
  const thead = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { scope: 'col', class: 'cmp-corner' }, h('span', { class: 'sr-only' }, 'Valeur')),
      profiles.map((p) =>
        h(
          'th',
          { scope: 'col', class: 'cmp-col' },
          h('div', { class: 'cmp-name' }, h('button', { type: 'button', class: 'link', title: 'Ouvrir la fiche', onclick: () => onOpen(p.code) }, p.nom), h('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': `Retirer ${p.nom} (${p.dep}) de la comparaison`, onclick: () => onRemove(p.code) }, '×')),
          h('span', { class: 'sub' }, identityLine(p)),
        ),
      ),
    ),
  );

  const body = [];
  const group = (sec) => {
    const dep = sec.id === 'departement';
    const scope = dep ? 'valeurs du département, pas celles de la commune' : SCOPE_LABEL[sec.scope];
    body.push(h('tbody', { class: 'cmp-group-body' }, h('tr', { class: 'cmp-group' }, h('th', { colspan: n + 1, scope: 'colgroup' }, h('span', {}, dep ? 'Département' : sec.title, ' ', h('small', {}, `(${scope})`))))));
  };
  const rowsOf = [];
  const flush = () => {
    if (rowsOf.length) body.push(h('tbody', {}, rowsOf.splice(0)));
  };
  const add = (label, cells, cls) => rowsOf.push(h('tr', { class: cls }, h('th', { scope: 'row' }, label), cells));
  const sub = (label) => rowsOf.push(h('tr', { class: 'cmp-sub' }, h('th', { scope: 'rowgroup', colspan: n + 1 }, h('span', {}, label))));

  // sections de la commune et du vent : lignes alignées par identifiant
  for (const id of ['train', 'politique', 'culture', 'prix', 'terres', 'departement', 'vent']) {
    const secs = profiles.map((p) => secOf(p, id));
    const ref = secs.find(Boolean);
    if (!ref) continue;
    flush();
    group(ref);
    if (id === 'departement') {
      dept(secs, add, sub, n);
    } else {
      const ids = [];
      for (const s of secs) for (const r of s?.rows || []) if (!ids.includes(r.id)) ids.push(r.id);
      const label = (rid) => secs.flatMap((s) => s?.rows || []).find((r) => r.id === rid).label;
      if (!ids.length) add('État', secs.map((s) => h('td', { class: 'na' }, s?.state === 'error' ? 'indisponible' : 'chargement…')));
      for (const rid of ids) add(label(rid), secs.map((s) => cell(s?.rows.find((r) => r.id === rid), s?.state ? '…' : '—')));
      if (id === 'train') trainLinks(secs, add, sub);
    }
    flush();
  }

  const table = h('table', { class: 'cmp-table' }, h('caption', { class: 'sr-only' }, `Comparaison de ${n} commune${n > 1 ? 's' : ''}, valeurs regroupées par catégorie`), thead, body);
  root.replaceChildren(
    h('div', { class: 'cmp-wrap', tabindex: '0', role: 'region', 'aria-label': 'Tableau de comparaison (défile horizontalement)' }, table),
    h('p', { class: 'muted small cmp-foot' }, 'Aucune colonne n’est « la meilleure » : les chiffres décrivent, ils ne jugent pas. Pour le département, « mieux que X', NBSP, '% » situe la valeur parmi les 96 départements.'),
  );
}

/** Trains directs : les villes de référence de l'une ou l'autre des communes, la plus rapide en premier. */
function trainLinks(secs, add, sub) {
  const all = new Map();
  for (const s of secs) {
    for (const l of s?.links || []) {
      const cur = all.get(l.id);
      all.set(l.id, { label: l.label, min: Math.min(l.min, cur?.min ?? Infinity) });
    }
  }
  if (!all.size) return;
  sub('Trains directs vers les villes de référence (durée · trains par jour · gare)');
  for (const [id, v] of [...all].sort((a, b) => a[1].min - b[1].min || a[1].label.localeCompare(b[1].label, 'fr'))) {
    add(v.label, secs.map((s) => cell(s?.links?.find((l) => l.id === id))));
  }
}

function dept(secs, add, sub) {
  if (secs.every((s) => s?.state === 'absent')) return add('État', secs.map(() => h('td', { class: 'na' }, 'indicateurs indisponibles')));
  add(
    'Classe composite (pondérations par défaut)',
    secs.map((s) => (s?.composite ? h('td', {}, h('span', { class: 'cv' }, s.composite.name), h('span', { class: 'sub' }, `${s.composite.rankText} · relatif`)) : h('td', { class: 'na' }, '—'))),
  );
  const themes = secs.find((s) => s?.themes?.length)?.themes || [];
  for (const t of themes) {
    sub(t.label);
    for (const r of t.rows) {
      add(
        r.label,
        secs.map((s) => {
          const x = s?.themes.find((u) => u.id === t.id)?.rows.find((u) => u.id === r.id);
          return x ? h('td', {}, h('span', { class: 'cv' }, x.text), x.pct != null ? h('span', { class: 'sub' }, `mieux que ${x.pct}${NBSP}%`) : null) : h('td', { class: 'na' }, '—');
        }),
      );
    }
  }
}
