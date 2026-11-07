// norm-toggle.js — bascule « Lecture : par rang (centiles) | par écart (min-max) », partagée par les pages Départements et Communes.
import { h } from './dom.js';
import { NORMS } from './score.js';

/**
 * @param {(norm:string)=>void} onChange
 * @returns {{el:HTMLElement, set:(norm:string)=>void}}
 */
export function createNormToggle(onChange) {
  const buttons = NORMS.map((n) => h('button', { type: 'button', class: 'pill', 'aria-pressed': 'false', onclick: () => onChange(n.id) }, n.label));
  const el = h('div', { class: 'pills norm-toggle', role: 'group', 'aria-label': 'Lecture des écarts entre valeurs' }, buttons);
  return {
    el,
    set: (norm) => NORMS.forEach((n, i) => buttons[i].setAttribute('aria-pressed', String(n.id === norm))),
  };
}
