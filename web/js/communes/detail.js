// detail.js — fiche d'une commune : score, trajets, climat politique, culture, prix, contexte départemental.
import { CLASSES } from '../classes.js';
import { h } from '../dom.js';
import { NBSP, fmtNumber, fmtValue, ordinal, pct } from '../format.js';
import { RISK_CAVEAT, riskReading } from './risks.js';
import { riskNodes } from './risks-view.js';
import { fmtCriterion } from './score-communes.js';
import { fmtDay, fmtDuration, fmtKm, fmtPct, fmtPop, fmtPrice, trainsText } from './text.js';
import { FUTUR, TRACC_CAVEAT, fmtFutur, hasFutur, pointNote } from '../climat.js';

// indicateurs départementaux rappelés (ceux qui manquent sont simplement omis)
const DEP_INDICATORS = ['secheresse_jours', 'catnat'];

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
    /** ctx : { c, result (liaison retenue ou null), hubIdx (-1 = toutes), dep (territoire de map.json), payload (indicateurs), basis (base de la part de gauche),
     *          score ({ sc (score, rang, classe ou null), n (communes classées), parts (décomposition), env }) } */
    show({ c, result, hubIdx, dep, payload, basis, score }) {
      root.hidden = false;
      title.textContent = `${c.nom} (${c.dep})`;
      sub.textContent = [dep?.name, dep?.region, fmtPop(c.pop)].filter(Boolean).join(' · ');
      body.replaceChildren(
        h(
          'p',
          { class: result ? 'badge ok match' : 'badge match' },
          result ? 'Correspond aux critères' : 'Ne correspond pas aux critères actuels',
        ),
        scoreBlock(result, score),
        trains(c, hubIdx, result, index, R),
        politics(c, R, basis),
        h('section', {}, h('h3', {}, `Culture à moins de ${R.culture}${NBSP}km`), culture(c)),
        h(
          'section',
          {},
          h('h3', {}, 'Prix des maisons'),
          c.prix != null
            ? h('p', {}, h('strong', {}, fmtPrice(c.prix)), h('span', { class: 'muted small' }, ' · médiane DVF sur environ 5 ans'))
            : h('p', { class: 'muted' }, 'Non disponible : moins de 10 ventes de maisons.'),
        ),
        risks(c),
        futur(c),
        department(c, dep, payload),
        h('p', {}, h('a', { href: `recherche.html#c=${encodeURIComponent(c.code)}` }, 'Fiche complète')),
      );
    },
  };
}

/** Score, rang dans la sélection et décomposition critère par critère (valeur, granularité, percentile, poids, contribution). */
function scoreBlock(result, { sc, n, parts, env, norm }) {
  const sec = h('section', { class: 'sc-detail' }, h('h3', {}, 'Score personnalisé'));
  if (!result) return (sec.append(h('p', { class: 'muted' }, 'Hors de la sélection : le score ne classe que les communes qui respectent les critères.')), sec);
  if (!sc) return (sec.append(h('p', { class: 'muted' }, 'Pas de score : aucun critère actif ne s’applique à cette commune. Réglez le panneau « Score personnalisé ».')), sec);
  const name = CLASSES[sc.cls - 1].name;
  sec.append(
    h(
      'div',
      { class: 'detail-sum' },
      h('span', { class: 'chip', style: `background:var(--c${sc.cls});color:var(--c${sc.cls}-ink)` }, name),
      h('p', { class: 'detail-rank' }, h('strong', {}, `${fmtNumber(Math.round(sc.score))}${NBSP}/${NBSP}100`), h('span', {}, `${ordinal(sc.rank)} sur ${fmtNumber(n)} commune${n > 1 ? 's' : ''} retenue${n > 1 ? 's' : ''}`)),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'rank-table sc-table' },
        h('caption', { class: 'sr-only' }, 'Décomposition du score par critère'),
        h('thead', {}, h('tr', {}, ['Critère', 'Valeur', norm === 'minmax' ? 'Position' : 'Mieux que', 'Poids', 'Points'].map((t, i) => h('th', { scope: 'col', class: i ? 'c-val' : null, title: i === 2 ? (norm === 'minmax' ? 'Position entre la valeur la moins et la plus favorable de la sélection (min-max)' : 'Part des communes retenues que celle-ci devance') : i === 4 ? 'Poids × position ÷ somme des poids, sur 100' : null }, t)))),
        h(
          'tbody',
          {},
          parts.map((p) => {
            const gran = p.x ? p.x.gran : p.level;
            const label = gran === 'commune' ? 'commune' : gran === 'repli' ? 'département (repli)' : 'département';
            return h(
              'tr',
              { class: p.x ? null : 'skip' },
              h('td', {}, p.k.label, p.opt ? h('span', { class: 'sub' }, p.opt.label) : null, h('span', { class: 'sub' }, p.x ? label : 'valeur absente : ignoré')),
              h('td', { class: 'c-val' }, p.x ? fmtCriterion(p.k, p.x, env) : '—'),
              h('td', { class: 'c-val' }, p.better == null ? '—' : `${pct(p.better)}${NBSP}%`),
              h('td', { class: 'c-val' }, fmtNumber(p.w, 1)),
              h('td', { class: 'c-val' }, p.points == null ? '—' : fmtNumber(p.points, 1)),
            );
          }),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, norm === 'minmax' ? 'Un score est un angle de lecture sur cette sélection, pas un verdict. Lecture par écart : « Position » situe la valeur entre la moins et la plus favorable de la sélection.' : 'Un score est un angle de lecture sur cette sélection, pas un verdict. « Mieux que X\u00a0% » : part des communes retenues devancées pour ce critère.'),
  );
  return sec;
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

function politics(c, R, basis) {
  const line = (label, v, on) => [h('dt', {}, label, on ? h('span', { class: 'sub' }, 'base du filtre') : null), h('dd', {}, fmtPct(v), v == null ? null : bar(v))];
  return h(
    'section',
    {},
    h('h3', {}, 'Climat politique'),
    h('dl', { class: 'kv stack' }, ...line('Gauche, dans la commune', c.gauche_commune, basis !== 'zone'), ...line(`Gauche, dans un rayon de ${R.vote}${NBSP}km`, c.gauche_10km, basis === 'zone')),
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

function risks(c) {
  return h(
    'section',
    {},
    h('h3', {}, 'Risques — valeurs de la commune'),
    ...riskNodes(riskReading(c)),
    h('p', { class: 'muted small' }, RISK_CAVEAT, ' Sources : GASPAR (Géorisques), liste officielle du trait de côte.'),
  );
}

/** Climat futur à +2,7 °C (TRACC) au point de grille de la commune ; la trajectoire complète est dans la fiche Recherche. */
function futur(c) {
  return h(
    'section',
    {},
    h('h3', {}, 'Climat futur — +2,7\u00a0°C, vers 2050'),
    hasFutur(c)
      ? h('dl', { class: 'kv' }, ...FUTUR.filter((f) => Number.isFinite(c[f.col])).flatMap((f) => row(f.label, fmtFutur(c[f.col], f.unit, f.d))))
      : h('p', { class: 'muted' }, c.tracc_pt === 0 ? 'Aucun point de la grille climatique à moins de 8\u00a0km (île éloignée) : le score utilise la valeur du département.' : 'Non disponible dans ces données.'),
    h('p', { class: 'muted small' }, [pointNote(c), TRACC_CAVEAT, 'Source : DRIAS, données Météo-France.'].filter(Boolean).join(' ')),
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
