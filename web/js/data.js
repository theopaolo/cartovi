// data.js — chargement et normalisation des deux fichiers de données.
export async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' }); // revalidation : le CI régénère les données chaque semaine
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.json();
}

/** map.json est indispensable ; indicators.json peut manquer (renvoie alors payload = null). */
export async function loadData() {
  const map = await getJSON('data/map.json');
  let payload = null;
  try {
    payload = normalize(await getJSON('data/indicators.json'));
  } catch (e) {
    console.info('indicators.json indisponible :', e.message);
  }
  return { map, payload };
}

// Valeurs par défaut défensives : le front reste générique face aux évolutions du pipeline.
function normalize(raw) {
  const indicators = (raw?.indicators || [])
    .filter((i) => i && i.id && i.values && typeof i.values === 'object')
    .map((i) => ({
      ...i,
      theme: i.theme || 'autres',
      direction: i.direction === -1 ? -1 : 1,
      weight: Number.isFinite(i.weight) ? Math.max(0, i.weight) : 1,
      decimals: Number.isInteger(i.decimals) ? i.decimals : 0,
      unit: i.unit || '',
      source: i.source || {},
      last_run: i.last_run || {},
    }));
  if (!indicators.length) return null;
  const themes = [...(raw.themes || [])];
  for (const i of indicators) {
    if (!themes.some((t) => t.id === i.theme)) themes.push({ id: i.theme, label: 'Autres' });
  }
  return {
    generated_at: raw.generated_at,
    themes: themes.filter((t) => indicators.some((i) => i.theme === t.id)),
    indicators,
  };
}
