// results.js — liste des résultats : un listbox relié au champ (motif « combobox avec liste » de WAI-ARIA).
// Le focus reste dans le champ ; la flèche ↑/↓ déplace l'option active (aria-activedescendant), Entrée l'ouvre, Échap l'oublie.
// La liste est plafonnée à PAGE options (« Afficher plus ») : 35 000 lignes de DOM sinon.
import { h } from '../dom.js';
import { fmtNumber } from '../format.js';
import { fmtPop } from '../communes/text.js';

export const PAGE = 50;

export function createResults({ input, list, moreBtn, names, depLabel, regionName, flush, onPick }) {
  let found = []; // indices dans names.rows
  let shown = PAGE;
  let active = -1; // position dans la liste affichée
  let opened = null; // code de la commune dont la fiche est ouverte

  const optId = (code) => `opt-${code}`;

  function option(i, pos) {
    const [code, nom, pop] = names.rows[i];
    const dep = code.slice(0, 2);
    return h(
      'div',
      { role: 'option', id: optId(code), class: 'opt', 'aria-selected': 'false', 'data-pos': pos, 'data-code': code, ...(code === opened ? { 'aria-current': 'true' } : {}) },
      h('span', { class: 'opt-name' }, nom),
      h('span', { class: 'opt-pop' }, fmtPop(pop)),
      h('span', { class: 'opt-where' }, depLabel(dep), regionName(dep) ? ` · ${regionName(dep)}` : ''),
    );
  }

  function paint() {
    const n = Math.min(shown, found.length);
    list.replaceChildren(...found.slice(0, n).map((i, pos) => option(i, pos)));
    moreBtn.hidden = n >= found.length;
    if (!moreBtn.hidden) moreBtn.textContent = `Afficher plus (${fmtNumber(Math.min(PAGE, found.length - n))} sur ${fmtNumber(found.length - n)} restantes)`;
    input.setAttribute('aria-expanded', String(found.length > 0));
    setActive(-1);
  }

  function setActive(pos, scroll = false) {
    const prev = list.querySelector('[aria-selected="true"]');
    if (prev) prev.setAttribute('aria-selected', 'false');
    active = pos;
    const el = pos >= 0 ? list.children[pos] : null;
    if (el) {
      el.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  const pick = (pos, how) => {
    const i = found[pos];
    if (i !== undefined) onPick(names.rows[i][0], how);
  };

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key.startsWith('Arrow')) flush();
    const last = Math.min(shown, found.length) - 1;
    if (e.key === 'ArrowDown' && last >= 0) {
      e.preventDefault();
      setActive(active < last ? active + 1 : last, true);
    } else if (e.key === 'ArrowUp' && last >= 0) {
      e.preventDefault();
      setActive(active > 0 ? active - 1 : -1, true);
      if (active < 0) input.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (found.length) {
        e.preventDefault();
        pick(active >= 0 ? active : 0, 'kbd'); // sans option active : la mieux classée
      }
    } else if (e.key === 'Escape') {
      if (active >= 0) {
        e.preventDefault();
        setActive(-1);
      } else if (input.value) {
        e.preventDefault();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[role="option"]');
    if (el) pick(Number(el.dataset.pos), 'click');
  });
  moreBtn.addEventListener('click', () => {
    const from = Math.min(shown, found.length);
    shown += PAGE;
    paint();
    list.children[from]?.scrollIntoView({ block: 'nearest' });
    if (moreBtn.hidden) input.focus(); // le bouton disparaît : le focus revient au champ
  });

  return {
    /** Nouvelle liste (indices dans names.rows) : on repart de la première page. */
    set(indices) {
      found = indices;
      shown = PAGE;
      paint();
    },
    /** Marque la commune dont la fiche est ouverte. */
    setOpened(code) {
      opened = code;
      for (const el of list.children) {
        if (el.dataset.code === code) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      }
    },
    get total() {
      return found.length;
    },
  };
}
