// dom.js — petits utilitaires DOM (on évite innerHTML pour les données).
const SVG_NS = 'http://www.w3.org/2000/svg';

function build(el, props, kids) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/** h('div', {class:'x'}, 'texte', enfant…) */
export const h = (tag, props, ...kids) => build(document.createElement(tag), props, kids);
/** Idem pour les éléments SVG. */
export const s = (tag, props, ...kids) => build(document.createElementNS(SVG_NS, tag), props, kids);

/** Regroupe les appels dans un même frame : le dernier état lu gagne. */
export function rafThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
