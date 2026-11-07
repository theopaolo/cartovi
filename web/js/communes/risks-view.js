// risks-view.js — bloc « Risques de la commune » partagé par la fiche de la page Communes et celle de la page Recherche.
// Les données restent celles de riskReading (risks.js) : « non renseigné » n'est jamais présenté comme « aucun risque ».
import { h } from '../dom.js';
import { fmtNumber } from '../format.js';
import { riskLabel, UNKNOWN_TEXT } from './risks.js';

const chips = (items) => h('ul', { class: 'chips' }, items.map((k) => h('li', {}, riskLabel(k))));

/** Liste de risques : pastilles, ou « aucun recensé », ou « non renseigné » (liste absente de la base). */
function listBlock(title, l, none) {
  return h(
    'div',
    { class: 'risk-group' },
    h('p', { class: 'risk-title' }, title),
    l.state === 'list' ? chips(l.items) : l.state === 'unknown' ? h('p', {}, h('span', { class: 'badge warn nr-badge' }, 'non renseigné'), h('span', { class: 'muted small' }, ` ${UNKNOWN_TEXT}`)) : h('p', { class: 'muted small' }, none),
  );
}

export const traitText = (t) => (t === true ? 'commune listée par le décret en vigueur' : t === false ? 'commune non listée par le décret en vigueur' : 'non renseigné');

/** @param {object} r  sortie de riskReading */
export function riskNodes(r) {
  return [
    h('p', { class: 'risk-title' }, 'Catastrophes naturelles reconnues, 20 dernières années'),
    h(
      'dl',
      { class: 'kv' },
      r.catnat.flatMap((k) => [h('dt', {}, k.label), h('dd', {}, k.n == null ? 'non disponible' : fmtNumber(k.n))]),
    ),
    listBlock('Risques recensés par la préfecture (DDRM)', r.risques, 'aucun risque recensé dans la base'),
    listBlock('Plans de prévention opposables (PPR)', r.ppr, 'aucun plan opposable dans la base'),
    h('div', { class: 'risk-group' }, h('p', { class: 'risk-title' }, 'Recul du trait de côte'), h('p', { class: r.trait == null ? 'muted small' : '' }, traitText(r.trait))),
  ];
}
