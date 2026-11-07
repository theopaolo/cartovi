// header-search.js — champ de recherche de l'en-tête, commun à toutes les pages.
// Envoie vers recherche.html#q=… ; sur recherche.html (formulaire marqué data-here), il pilote directement le champ principal.
// Sur petit écran le champ se replie derrière un bouton loupe.
const form = document.getElementById('top-search');
const input = document.getElementById('top-q');

if (form && input) {
  const here = form.hasAttribute('data-here');
  const narrow = matchMedia('(max-width: 719px)');

  // ---------- repli sur petit écran ----------
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'top-search-toggle';
  toggle.setAttribute('aria-controls', form.id);
  toggle.setAttribute('aria-label', 'Rechercher une commune');
  toggle.innerHTML =
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  form.closest('.top')?.querySelector('h1')?.after(toggle);

  const setOpen = (open, focus = false) => {
    form.classList.toggle('collapsed', narrow.matches && !open);
    toggle.setAttribute('aria-expanded', String(open || !narrow.matches));
    if (open && focus) input.focus();
  };
  setOpen(false);
  toggle.addEventListener('click', () => setOpen(form.classList.contains('collapsed'), true));
  narrow.addEventListener('change', () => setOpen(false));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && narrow.matches && !form.classList.contains('collapsed')) {
      setOpen(false);
      toggle.focus();
    }
  });

  // ---------- envoi ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim().slice(0, 100);
    if (!here) {
      location.href = `recherche.html${q ? `#q=${encodeURIComponent(q)}` : ''}`;
      return;
    }
    // sur la page : on remplace la requête et on referme la fiche ; filtres et comparaison restent
    const keep = location.hash.replace(/^#/, '').split('&').filter((p) => p && !/^(q|c)=/.test(p));
    location.hash = [q ? `q=${encodeURIComponent(q)}` : '', ...keep].filter(Boolean).join('&');
    document.getElementById('q')?.focus();
  });
}
