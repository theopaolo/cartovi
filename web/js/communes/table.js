// table.js — résultats : décompte, choix du tri et tableau des communes (vue principale, accessible au clavier).
// Le tableau est plafonné à PAGE lignes (« Afficher plus ») : 35 000 lignes de DOM sinon.
import { h } from '../dom.js';
import { NBSP, fmtNumber } from '../format.js';
import { SORTS } from './filter.js';
import { cultureText, fmtDuration, fmtPct, fmtPop, fmtPrice, plural, stationText, trainsText } from './text.js';

const PAGE = 200;

// colonne → clé de tri ; `val` : colonne numérique (alignée à droite)
const COLS = [
  { id: 'nom', sort: 'nom', label: 'Commune' },
  { id: 'pop', sort: 'pop', label: 'Population', val: true },
  { id: 'time', sort: 'time', label: 'Train direct' },
  { id: 'km', sort: 'km', label: 'Gare' },
  { id: 'gauche', sort: 'gauche', label: '% gauche', val: true },
  { id: 'culture', sort: 'culture', label: 'Culture à 15 km' },
  { id: 'prix', sort: 'prix', label: 'Prix maisons', val: true },
];

export function createResults(root, { index, onSort, onSelect }) {
  const R = index.radius.vote;
  const basisText = (b) => (b === 'zone' ? `${R}${NBSP}km` : 'commune');
  let list = [];
  let shown = PAGE;
  let sort = { key: 'time', dir: 1 };
  let ctx = { anyHub: false, basis: 'commune' };
  let selected = null;

  const count = h('p', { class: 'res-count', 'aria-hidden': 'true' });
  const countMain = h('strong', {});
  const countSub = h('span', { class: 'muted' });
  count.append(countMain, countSub);
  const live = h('p', { class: 'sr-only', role: 'status' });
  const select = h(
    'select',
    { id: 'sort-by', onchange: () => onSort({ key: select.value, dir: SORTS[select.value].first }) },
    Object.entries(SORTS).map(([k, s]) => h('option', { value: k }, s.label)),
  );
  const dirBtn = h('button', { type: 'button', class: 'btn ghost tiny', onclick: () => onSort({ key: sort.key, dir: -sort.dir }) });
  const msg = h('p', { class: 'res-msg', hidden: true });
  const status = h('p', { class: 'res-status muted small', hidden: true });

  const heads = new Map();
  const headRow = h(
    'tr',
    {},
    COLS.map((c) => {
      const arrow = h('span', { class: 'arrow', 'aria-hidden': 'true' });
      const label = h('span', {}, c.label);
      const th = h('th', { scope: 'col', 'aria-sort': 'none', class: `c-${c.id}${c.val ? ' c-val' : ''}` }, h('button', { type: 'button', onclick: () => clickHead(c) }, label, arrow));
      heads.set(c.sort, { th, arrow, label });
      return th;
    }),
  );
  const caption = h('caption', { class: 'sr-only' });
  const tbody = h('tbody', {
    onclick: (e) => {
      const tr = e.target.closest('tr');
      if (tr) onSelect(tr.dataset.code, e.detail === 0 ? 'table-kbd' : 'table');
    },
  });
  const more = h('button', { type: 'button', class: 'btn', onclick: () => ((shown += PAGE), renderRows()) });
  const moreBox = h('div', { class: 'res-more' }, more);
  const wrap = h('div', { class: 'table-wrap' }, h('table', { class: 'rank-table res-table' }, caption, h('thead', {}, headRow), tbody), moreBox);
  root.replaceChildren(
    h('div', { class: 'res-bar' }, count, h('label', { class: 'res-sort', for: 'sort-by' }, h('span', {}, 'Trier par'), select), dirBtn, live),
    msg,
    status,
    wrap,
  );

  function clickHead(c) {
    onSort(sort.key === c.sort ? { key: c.sort, dir: -sort.dir } : { key: c.sort, dir: SORTS[c.sort].first });
  }

  function row(r) {
    const c = r.c;
    const st = stationText(c, r.km);
    const hubName = ctx.anyHub ? index.hubs[r.hub]?.label : null;
    const tr = h(
      'tr',
      { 'data-code': c.code, class: c.code === selected ? 'sel' : null, 'aria-current': c.code === selected ? 'true' : null },
      h(
        'td',
        { class: 'c-nom' },
        h('button', { type: 'button', class: 'link' }, c.nom),
        h('span', { class: 'dep' }, ` (${c.dep})`),
        // colonnes masquées en vue étroite : on les rappelle sous le nom (copie décorative)
        h('span', { class: 'narrow-only', 'aria-hidden': 'true' }, `${fmtPop(c.pop)}${c.prix != null ? ` · ${fmtPrice(c.prix)}` : ''}`),
      ),
      h('td', { class: 'c-pop c-val' }, fmtNumber(c.pop)),
      h(
        'td',
        { class: 'c-time' },
        h('strong', {}, fmtDuration(r.min)),
        h('span', { class: 'sub' }, trainsText(r.trains) + (hubName ? ` · ${hubName}` : '')),
        h('span', { class: 'narrow-only', 'aria-hidden': 'true' }, st.name ? `${st.name} (${st.km})` : `gare à ${st.km}`),
      ),
      h('td', { class: 'c-km' }, st.name ? h('span', {}, st.name) : null, h('span', { class: 'sub' }, st.name ? st.km : `gare à ${st.km}`)),
      h(
        'td',
        { class: 'c-gauche c-val' },
        fmtPct(r.left),
        // l'autre base, pour comparer
        h('span', { class: 'sub' }, `${basisText(ctx.basis === 'zone' ? 'commune' : 'zone')} : ${fmtPct(ctx.basis === 'zone' ? c.gauche_commune : c.gauche_10km)}`),
      ),
      h('td', { class: 'c-culture' }, cultureText(c)),
      h('td', { class: 'c-prix c-val' }, fmtPrice(c.prix)),
    );
    return tr;
  }

  function renderRows() {
    const n = list.length;
    tbody.replaceChildren(...list.slice(0, shown).map(row));
    more.hidden = n <= shown;
    more.textContent = `Afficher ${Math.min(PAGE, n - shown)} communes de plus (${fmtNumber(n - shown)} restantes)`;
    status.hidden = n <= PAGE;
    status.textContent = `${fmtNumber(Math.min(shown, n))} lignes affichées sur ${fmtNumber(n)}.`;
  }

  function paintSort() {
    select.value = sort.key;
    dirBtn.textContent = sort.dir > 0 ? '▲ croissant' : '▼ décroissant';
    dirBtn.setAttribute('aria-label', `Ordre ${sort.dir > 0 ? 'croissant' : 'décroissant'} : inverser`);
    heads.get('gauche').label.textContent = `% gauche (${basisText(ctx.basis)})`;
    for (const [key, { th, arrow }] of heads) {
      th.setAttribute('aria-sort', key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      arrow.textContent = key === sort.key ? (sort.dir > 0 ? '\u00a0▲' : '\u00a0▼') : '';
    }
    caption.textContent = `Communes correspondant aux critères, triées par ${SORTS[sort.key].label.toLowerCase()}`;
  }

  let liveTimer;
  return {
    /** results : liste triée ; info : { loaded, loading, anyHub, noRegion } */
    update(results, sortState, info) {
      const changed = results !== list;
      list = results;
      sort = sortState;
      ctx = info;
      if (changed) shown = PAGE;
      paintSort();
      const n = list.length;
      const text = info.noRegion ? 'Aucune région cochée' : `${plural(n, 'commune')} ${n > 1 ? 'correspondent' : 'correspond'}`;
      countMain.textContent = text;
      countSub.textContent = info.noRegion ? '' : ` · sur ${fmtNumber(info.loaded)} dans les régions cochées${info.loading ? ' (chargement…)' : ''}`;
      wrap.hidden = moreBox.hidden = !n;
      msg.hidden = !!n || !!info.loading;
      msg.textContent = info.noRegion
        ? 'Cochez au moins une région pour lancer la recherche.'
        : 'Aucune commune ne correspond à ces critères. Assouplissez-en un : par exemple allongez le temps de trajet, ou abaissez la part de gauche minimale.';
      if (n) renderRows();
      root.setAttribute('aria-busy', String(!!info.loading));
      // annonce vocale différée : pas à chaque cran d'un curseur
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => (live.textContent = info.noRegion ? `${text}.` : `${text} aux critères.`), 500);
    },
    setSelected(code) {
      selected = code;
      for (const tr of tbody.rows) {
        const on = tr.dataset.code === code;
        tr.classList.toggle('sel', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
      }
    },
    /** Rend la ligne visible (élargit la page si besoin) sans voler le focus. */
    reveal(code) {
      const i = list.findIndex((r) => r.c.code === code);
      if (i < 0) return;
      if (i >= shown) {
        shown = Math.ceil((i + 1) / PAGE) * PAGE;
        renderRows();
      }
      tbody.querySelector(`tr[data-code="${code}"]`)?.scrollIntoView({ block: 'nearest' });
    },
    focusRow: (code) => tbody.querySelector(`tr[data-code="${code}"] .link`)?.focus({ preventScroll: true }),
  };
}
