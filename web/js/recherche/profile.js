// profile.js — « profil » d'une commune : toutes ses valeurs, regroupées par catégorie du projet.
// Aucun accès au DOM : la fiche et le tableau de comparaison lisent la même structure, donc les mêmes chiffres.
//
// Une section = { id, scope, title, state?, rows: [{id, label, text, sub?}], … }. scope : 'commune' (valeurs de la commune),
// 'departement' (valeurs du département, pas de la commune) ou 'point' (lecture du vent au point de la commune).
import { CLASSES } from '../classes.js';
import { NBSP, fmtDate, fmtNumber, fmtValue, pct, rankText } from '../format.js';
import { fmtDay, fmtDuration, fmtKm, fmtPct, fmtPop, fmtPrice, trainsText } from '../communes/text.js';
import { NATIONAL_LEFT, SOURCES, fmtDistance, fmtMoment, fmtWeek, kmh, mps, trainNote } from './text.js';
import { windPhrase } from './vent.js';

/**
 * @param {object} ctx  { territories, payload, scores, view, index, store } (data.js loadContext)
 * @param {[string,string,number]} row  ligne de noms.json
 * @param {{wind: object|null|'error', regionCode: string, failed?: boolean}} extra  wind : statistiques de vent (null = en chargement, 'error' = indisponible)
 */
export function buildProfile(ctx, row, { wind, regionCode, failed = false }) {
  const [code, nom, pop] = row;
  const dep = code.slice(0, 2);
  const terr = ctx.territories.get(dep);
  const c = ctx.store?.commune(code) || null;
  const regionName = terr?.region || '';
  return {
    code,
    nom,
    dep,
    depName: terr?.name || '',
    region: regionName,
    regionCode, // code de région (communes.html#r=…)
    pop,
    commune: c, // null tant que le fichier régional n'est pas chargé
    sections: [
      ...communeSections(ctx, c, failed),
      departmentSection(ctx, dep, terr),
      windSection(wind),
    ],
  };
}

function communeSections(ctx, c, failed) {
  const R = ctx.index?.radius || { gare: 6, vote: 10, culture: 15 };
  const pending = (id, title, source) => ({ id, scope: 'commune', title, state: ctx.store && !failed ? 'loading' : 'error', rows: [], source });
  if (!c) {
    return [
      pending('train', 'Train', SOURCES.train),
      pending('politique', 'Climat politique', SOURCES.vote),
      pending('culture', `Culture à moins de ${R.culture}${NBSP}km`, SOURCES.culture),
      pending('prix', 'Prix des maisons', SOURCES.prix),
    ];
  }
  // trajets directs vers les villes de référence, triés par durée
  const links = [];
  for (let i = 0; i < c.reach.length; i += 4) {
    const hub = ctx.index.hubs[c.reach[i]];
    if (hub) links.push({ id: `hub:${hub.code}`, label: hub.label, min: c.reach[i + 1], trains: c.reach[i + 2], km: c.reach[i + 3] });
  }
  links.sort((a, b) => a.min - b.min || b.trains - a.trains);
  for (const l of links) {
    l.text = fmtDuration(l.min);
    l.sub = `${trainsText(l.trains)} · gare à ${fmtKm(l.km)}`;
  }
  const hasStation = !!c.gare;
  return [
    {
      id: 'train',
      scope: 'commune',
      title: 'Train',
      rows: hasStation
        ? [
            { id: 'gare', label: 'Gare la plus proche', text: c.gare },
            { id: 'gare_km', label: 'Distance à la gare', text: fmtKm(c.gare_km) },
            { id: 'trains_jour', label: 'Départs par jour', text: trainsText(c.trains_jour) },
          ]
        : [{ id: 'gare', label: 'Gare la plus proche', text: `aucune à moins de ${R.gare}${NBSP}km`, sub: 'pas de train direct possible' }],
      links,
      linksLabel: links.length ? 'Villes de référence en train direct' : null,
      empty: hasStation && !links.length ? 'Aucune ville de référence atteignable en train direct.' : null,
      note: trainNote(ctx.index.reference_day),
      source: { ...SOURCES.train, period: `jour de référence : ${fmtDay(ctx.index.reference_day)}` },
    },
    {
      id: 'politique',
      scope: 'commune',
      title: 'Climat politique',
      rows: [
        { id: 'gauche_commune', label: 'Part de gauche, dans la commune', text: fmtPct(c.gauche_commune), value: c.gauche_commune },
        { id: 'gauche_10km', label: `Part de gauche, dans un rayon de ${R.vote}${NBSP}km`, text: fmtPct(c.gauche_10km), value: c.gauche_10km },
      ],
      reference: `Référence nationale : ${fmtPct(NATIONAL_LEFT)} (France entière).`,
      note: 'Part des listes de gauche aux européennes 2024 : un électorat, pas la politique municipale ni un jugement.',
      source: { ...SOURCES.vote, period: 'scrutin du 9 juin 2024, % des suffrages exprimés' },
    },
    {
      id: 'culture',
      scope: 'commune',
      title: `Culture à moins de ${R.culture}${NBSP}km`,
      rows: [
        ['cinemas', 'Cinémas'],
        ['scenes', 'Scènes'],
        ['labels', 'Lieux labellisés'],
        ['musees', 'Musées'],
        ['librairies', 'Librairies'],
        ['conservatoires', 'Conservatoires'],
      ].map(([k, label]) => ({ id: k, label, text: fmtNumber(c[k]) })),
      note: 'Comptage de lieux, pas une mesure de la qualité de la programmation.',
      source: { ...SOURCES.culture, period: ctx.index.generated_at ? `état de la base au ${fmtDate(ctx.index.generated_at)}` : 'dernier état connu' },
    },
    {
      id: 'prix',
      scope: 'commune',
      title: 'Prix des maisons',
      rows: [{ id: 'prix', label: 'Médiane du prix au m²', text: c.prix != null ? fmtPrice(c.prix) : 'moins de 10 ventes', sub: c.prix != null ? 'maisons, environ 5 ans' : 'valeur non publiée' }],
      source: { ...SOURCES.prix, period: 'ventes d’environ cinq ans' },
    },
  ];
}

function departmentSection(ctx, dep, terr) {
  const sec = { id: 'departement', scope: 'departement', title: `Valeurs du département${terr ? ` : ${terr.name} (${dep})` : ''}`, themes: [], composite: null, rows: [] };
  const data = ctx.payload;
  if (!data) return { ...sec, state: 'absent' };
  for (const theme of data.themes) {
    const rows = data.indicators
      .filter((i) => i.theme === theme.id)
      .map((ind) => {
        const v = ind.values[dep];
        const s = ctx.scores[ind.id]?.[dep];
        const ok = Number.isFinite(v);
        return {
          id: ind.id,
          label: ind.label,
          text: ok ? fmtValue(v, ind) : 'donnée manquante',
          pct: ok && s !== undefined ? pct(s) : null,
          period: ind.period || 'période inconnue',
          source: ind.source,
          stale: ind.status === 'stale',
        };
      });
    sec.themes.push({ id: theme.id, label: theme.label, rows });
  }
  const e = ctx.view?.byCode?.[dep];
  if (ctx.view && ctx.view.kind === 'composite' && e && !e.missing) {
    sec.composite = {
      cls: e.cls,
      name: CLASSES[e.cls - 1].name,
      rank: e.rank,
      n: ctx.view.n,
      rankText: rankText(e.rank, ctx.view.n),
      score: e.score,
      used: e.used,
      nWeighted: ctx.view.nWeighted,
    };
  }
  return sec;
}

function windSection(wind) {
  const sec = { id: 'vent', scope: 'point', title: 'Vent (semaine écoulée)', rows: [] };
  if (wind === 'error') return { ...sec, state: 'error' };
  if (!wind) return { ...sec, state: 'loading' };
  return {
    ...sec,
    rows: [
      { id: 'vent_moy', label: 'Vitesse moyenne', text: kmh(wind.mean), sub: mps(wind.mean) },
      { id: 'vent_max', label: 'Vitesse maximale', text: kmh(wind.max), sub: `${mps(wind.max)} · ${fmtMoment(wind.maxAt)}` },
      { id: 'vent_dir', label: 'Direction dominante', text: windPhrase(wind.sector), sub: `${fmtNumber(Math.round(wind.share * 100))}${NBSP}% du temps` },
      { id: 'vent_noeud', label: 'Donnée réelle la plus proche', text: fmtDistance(wind.nodeKm), sub: 'le reste est interpolé' },
    ],
    period: fmtWeek(wind.from, wind.to),
    note: 'Vent à 10 m sur une maille d’environ 50 km : une lecture régionale, pas celle du village (relief, vallée).',
    source: { label: wind.source?.label || 'Open-Meteo', url: wind.source?.url, period: fmtWeek(wind.from, wind.to), licence: wind.source?.licence },
  };
}

/** Sous-titre d'identité : « Drôme (26) · Auvergne-Rhône-Alpes · 4 844 hab. ». */
export const identityLine = (p) => [p.depName ? `${p.depName} (${p.dep})` : `Département ${p.dep}`, p.region, fmtPop(p.pop)].filter(Boolean).join(' · ');
