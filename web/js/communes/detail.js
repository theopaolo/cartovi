// detail.js — fiche d'une commune : trajets, climat politique, culture, prix, contexte départemental.
import { h } from '../dom.js';
import { NBSP, fmtNumber, fmtValue } from '../format.js';
import { fmtDay, fmtDuration, fmtKm, fmtPct, fmtPop, fmtPrice, trainsText } from './text.js';

// indicateurs départementaux rappelés (ceux qui manquent sont simplement omis)
const DEP_INDICATORS = ['secheresse_jours', 'jours_chauds_2050', 'catnat'];

const row = (label, value, note) => [h('dt', {}, label), h('dd', {}, value, note ? h('span', { class: 'sub' }, note) : null)];
const bar = (v) => h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }));

export function createDetail(root, { index, onClose }) {
  const title = h('h2', { id: 'detail-title', tabindex: '-1' });
  const sub = h('p', { class: 'detail-region' });
  const body = h('div', { class: 'detail-body' });
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer la fiche (Échap)', onclick: onClose }, '×');
  root.replaceChildren(h('div', { class: 'detail-head' }, h('div', {}, title, sub), close), body);
  root.setAttribute('aria-labelledby', 'detail-title');
  const R = index.radius;

  return {
    focus: () => title.focus({ preventScroll: true }),
    hide: () => {
      root.hidden = true;
    },
    /** ctx : { c, result (liaison retenue ou null), hubIdx (-1 = toutes), dep (territoire de map.json), payload (indicateurs) } */
    show({ c, result, hubIdx, dep, payload }) {
      root.hidden = false;
      title.textContent = `${c.nom} (${c.dep})`;
      sub.textContent = [dep?.name, dep?.region, fmtPop(c.pop)].filter(Boolean).join(' · ');
      body.replaceChildren(
        h(
          'p',
          { class: result ? 'badge ok match' : 'badge match' },
          result ? 'Correspond aux critères' : 'Ne correspond pas aux critères actuels',
        ),
        trains(c, hubIdx, result, index, R),
        politics(c, R),
        h('section', {}, h('h3', {}, `Culture à moins de ${R.culture}${NBSP}km`), culture(c)),
        h(
          'section',
          {},
          h('h3', {}, 'Prix des maisons'),
          c.prix != null
            ? h('p', {}, h('strong', {}, fmtPrice(c.prix)), h('span', { class: 'muted small' }, ' · médiane DVF sur environ 5 ans'))
            : h('p', { class: 'muted' }, 'Non disponible : moins de 10 ventes de maisons.'),
        ),
        department(c, dep, payload),
      );
    },
  };
}

function trains(c, hubIdx, result, index, R) {
  const links = [];
  for (let i = 0; i < c.reach.length; i += 4) links.push({ hub: index.hubs[c.reach[i]], min: c.reach[i + 1], trains: c.reach[i + 2], km: c.reach[i + 3] });
  links.sort((a, b) => a.min - b.min || b.trains - a.trains);
  return h(
    'section',
    {},
    h('h3', {}, 'Trains'),
    c.gare
      ? h('p', {}, `Gare la plus proche : ${c.gare}, à ${fmtKm(c.gare_km)} (${trainsText(c.trains_jour)} au départ).`)
      : h('p', { class: 'muted' }, `Aucune gare desservie à moins de ${R.gare}${NBSP}km : pas de train direct possible.`),
    links.length ? linkList(links, hubIdx, result) : c.gare ? h('p', { class: 'muted' }, 'Aucune ville de référence atteignable en train direct.') : null,
    links.length
      ? h(
          'p',
          { class: 'muted small' },
          `Trajets directs uniquement, ${fmtDay(index.reference_day)}. La gare utilisée n’est pas toujours la plus proche : une gare plus éloignée mais mieux reliée peut l’emporter.`,
        )
      : null,
  );
}

function linkList(links, hubIdx, result) {
  return h(
    'ul',
    { class: 'links' },
    links.map((l) =>
      h(
        'li',
        { class: l.hub && (l.hub.i === hubIdx || (hubIdx < 0 && result && l.hub.i === result.hub)) ? 'cur' : null },
        h('span', {}, l.hub?.label ?? '?'),
        h('span', { class: 'muted' }, `${fmtDuration(l.min)} · ${trainsText(l.trains)} · gare à ${fmtKm(l.km)}`),
      ),
    ),
  );
}

function politics(c, R) {
  const line = (label, v) => [h('dt', {}, label), h('dd', {}, fmtPct(v), v == null ? null : bar(v))];
  return h(
    'section',
    {},
    h('h3', {}, 'Climat politique'),
    h('dl', { class: 'kv stack' }, ...line('Gauche, dans la commune', c.gauche_commune), ...line(`Gauche, dans un rayon de ${R.vote}${NBSP}km`, c.gauche_10km)),
    h('p', { class: 'muted small' }, 'Part des listes de gauche aux européennes 2024 : un électorat, pas la politique municipale.'),
  );
}

function culture(c) {
  return h(
    'dl',
    { class: 'kv' },
    ...row('Cinémas', fmtNumber(c.cinemas)),
    ...row('Scènes', fmtNumber(c.scenes)),
    ...row('Lieux labellisés', fmtNumber(c.labels)),
    ...row('Musées', fmtNumber(c.musees)),
    ...row('Librairies', fmtNumber(c.librairies)),
    ...row('Conservatoires', fmtNumber(c.conservatoires)),
  );
}

function department(c, dep, payload) {
  const inds = payload ? DEP_INDICATORS.map((id) => payload.indicators.find((i) => i.id === id)).filter((i) => i && Number.isFinite(i.values[c.dep])) : [];
  return h(
    'section',
    {},
    h('h3', {}, `Département${dep ? ` : ${dep.name}` : ''}`),
    inds.length
      ? h('dl', { class: 'kv' }, ...inds.flatMap((i) => row(i.label, fmtValue(i.values[c.dep], i), i.period)))
      : null,
    h('p', {}, h('a', { href: `index.html#d=${encodeURIComponent(c.dep)}` }, 'Voir ce département sur la carte comparative')),
  );
}
