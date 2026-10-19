// ranking.js — tableau triable des départements : alternative accessible à la carte.
import { h } from './dom.js';
import { CLASSES, VALUE_CLASSES } from './classes.js';
import { NBSP, fmtNumber, fmtValue, rankText } from './format.js';

const COLS = [
  { key: 'rank', label: 'Rang', first: 1 },
  { key: 'name', label: 'Département', first: 1 },
  { key: 'code', label: 'Code', first: 1 },
  { key: 'cls', label: 'Classe', first: 1 },
  { key: 'val', label: 'Score', first: -1 }, // 1er clic : du plus grand au plus petit
];

export function createRanking(root, terrs, { onSelect }) {
  let sort = { key: 'rank', dir: 1 };
  let view = null;
  const note = h('p', { class: 'muted small' });
  const heads = new Map();
  const rows = new Map();

  const headRow = h(
    'tr',
    {},
    COLS.map((c) => {
      const arrow = h('span', { class: 'arrow', 'aria-hidden': 'true' });
      const label = h('span', {}, c.label);
      const th = h(
        'th',
        { scope: 'col', 'aria-sort': 'none', class: `c-${c.key}` },
        h('button', { type: 'button', onclick: () => setSort(c) }, label, arrow),
      );
      heads.set(c.key, { th, arrow, label });
      return th;
    }),
  );

  const tbody = h('tbody', {
    onclick: (e) => {
      const tr = e.target.closest('tr');
      if (tr) onSelect(tr.dataset.code, e.detail === 0 ? 'table-kbd' : 'table');
    },
  });
  for (const t of terrs) {
    const cells = {
      rank: h('td', { class: 'c-rank' }),
      name: h('td', { class: 'c-name' }, h('button', { type: 'button', class: 'link', 'data-code': t.code }, t.name)),
      code: h('td', { class: 'c-code' }, t.code),
      cls: h('td', { class: 'c-cls' }),
      val: h('td', { class: 'c-val' }),
    };
    const tr = h('tr', { 'data-code': t.code }, Object.values(cells));
    rows.set(t.code, { tr, cells, t });
    tbody.append(tr);
  }

  const msg = h('p', { class: 'muted', hidden: true });
  const tableWrap = h(
    'div',
    { class: 'table-wrap' },
    h('table', { class: 'rank-table' }, h('caption', { class: 'sr-only' }, 'Classement des départements métropolitains'), h('thead', {}, headRow), tbody),
  );
  root.replaceChildren(msg, note, tableWrap);

  function setSort(c) {
    sort = sort.key === c.key ? { key: c.key, dir: -sort.dir } : { key: c.key, dir: c.first };
    render();
  }

  function sortValue(key, code, e) {
    if (key === 'name') return rows.get(code).t.name;
    if (key === 'code') return code;
    if (key === 'val') return view.kind === 'composite' ? e.score : e.value;
    return e[key];
  }

  function render() {
    if (!view || view.kind === 'none') return;
    const comp = view.kind === 'composite';
    heads.get('val').label.textContent = comp ? 'Score /100' : `Valeur${view.indicator.unit ? ` (${view.indicator.unit})` : ''}`;
    for (const c of COLS) {
      const { th, arrow } = heads.get(c.key);
      const active = sort.key === c.key;
      th.setAttribute('aria-sort', active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      arrow.textContent = active ? (sort.dir > 0 ? ' ▲' : ' ▼') : '';
    }
    const list = [];
    for (const [code, r] of rows) {
      const e = view.byCode[code];
      const ok = e && !e.missing;
      r.cells.rank.textContent = ok ? rankText(e.rank, view.n) : '—';
      r.cells.val.textContent = !ok ? '—' : comp ? fmtNumber(e.score * 100, 1) : fmtValue(e.value, view.indicator);
      if (ok) {
        const names = comp ? CLASSES.map((c) => c.name) : VALUE_CLASSES;
        const k = comp ? 'c' : 's';
        r.cells.cls.replaceChildren(h('i', { class: 'sw', style: `background:var(--${k}${e.cls})` }), names[e.cls - 1]);
      } else {
        r.cells.cls.replaceChildren(h('i', { class: 'sw na' }), 'Donnée manquante');
      }
      list.push({ code, tr: r.tr, e: ok ? e : null });
    }
    list.sort((a, b) => {
      if (!a.e || !b.e) return !a.e - !b.e || a.code.localeCompare(b.code); // manquants en dernier
      const va = sortValue(sort.key, a.code, a.e);
      const vb = sortValue(sort.key, b.code, b.e);
      const c = typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb;
      return sort.dir * c || a.e.rank - b.e.rank || a.code.localeCompare(b.code);
    });
    tbody.append(...list.map((x) => x.tr)); // simple réordonnancement des lignes existantes
  }

  return {
    update(v) {
      view = v;
      const none = v.kind === 'none';
      msg.hidden = !none;
      note.hidden = tableWrap.hidden = none;
      if (none) {
        msg.textContent = v.reason === 'zero' ? 'Tous les poids sont à 0 : aucun classement possible.' : 'Le classement apparaîtra dès que les indicateurs seront générés.';
        return;
      }
      note.textContent =
        v.kind === 'composite'
          ? `Classé selon l’indice composite (vos pondérations). Rang 1 = le mieux classé ; position relative entre les ${v.n} départements.`
          : `Classé selon « ${v.indicator.label} » : rang 1 = le plus favorable (${v.indicator.direction < 0 ? 'plus bas' : 'plus haut'} = mieux).`;
      render();
    },
    setSelected(code) {
      for (const [c, r] of rows) {
        r.tr.classList.toggle('sel', c === code);
        if (c === code) r.tr.setAttribute('aria-current', 'true');
        else r.tr.removeAttribute('aria-current');
      }
    },
    focusRow: (code) => rows.get(code)?.cells.name.firstChild.focus({ preventScroll: true }),
  };
}
