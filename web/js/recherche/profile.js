// profile.js — « profil » d'une commune : toutes ses valeurs, regroupées par catégorie du projet.
// Aucun accès au DOM : la fiche et le tableau de comparaison lisent la même structure, donc les mêmes chiffres.
//
// Une section = { id, scope, title, state?, rows: [{id, label, text, sub?}], … }. scope : 'commune' (valeurs de la commune),
// ou 'departement' (valeurs du département, pas de la commune).
import { CLASSES } from '../classes.js';
import { NBSP, fmtDate, fmtNumber, fmtValue, pct, rankText } from '../format.js';
import { fmtDay, fmtDuration, fmtKm, fmtPct, fmtPop, fmtPrice, plural, trainsText } from '../communes/text.js';
import { CATNAT_KINDS, RISK_CAVEAT, riskLabel, riskReading } from '../communes/risks.js';
import { traitText } from '../communes/risks-view.js';
import { NATIONAL_LEFT, SOURCES, trainNote } from './text.js';
import { FUTUR, TRACC_CAVEAT, TRACC_LEVELS_NOTE, TRACC_SOURCE, cellText, fmtFutur, hasFutur, pointNote, trajectory } from '../climat.js';

/**
 * @param {object} ctx  { territories, payload, scores, view, index, store } (data.js loadContext)
 * @param {[string,string,number]} row  ligne de noms.json
 * @param {{regionCode: string, failed?: boolean}} extra
 */
export function buildProfile(ctx, row, { regionCode, failed = false }) {
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
    ],
  };
}

function communeSections(ctx, c, failed) {
  const R = ctx.index?.radius || { gare: 6, vote: 10, culture: 15, seveso: 10 };
  const pending = (id, title, source) => ({ id, scope: 'commune', title, state: ctx.store && !failed ? 'loading' : 'error', rows: [], source });
  if (!c) {
    return [
      pending('train', 'Train', SOURCES.train),
      pending('politique', 'Climat politique', SOURCES.vote),
      pending('culture', `Culture à moins de ${R.culture}${NBSP}km`, SOURCES.culture),
      pending('prix', 'Prix des maisons', SOURCES.prix),
      pending('terres', TERRES_TITLE, SOURCES.terres),
      pending('risques', RISQUES_TITLE, SOURCES.gaspar),
      pending('futur', FUTUR_TITLE, TRACC_SOURCE),
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
    terres(c, R),
    risques(c),
    futur(c, ctx.tracc),
  ];
}

const TERRES_TITLE = 'Terres et risques — valeurs de la commune';
const RISQUES_TITLE = 'Risques — valeurs de la commune';

/** Les cinq valeurs communales de la couche « terres et risques » ; une colonne vide ou absente des données donne « non disponible ». */
function terres(c, R) {
  const na = 'non disponible';
  const val = (v, text, sub) => (Number.isFinite(v) ? { text: text(v), sub } : { text: na });
  return {
    id: 'terres',
    scope: 'commune',
    title: TERRES_TITLE,
    rows: [
      { id: 'densite', label: 'Densité de population', ...val(c.densite, (v) => `${fmtNumber(v)}${NBSP}hab./km²`) },
      { id: 'artif', label: 'Artificialisation récente', ...val(c.artif, (v) => `${fmtNumber(v, 1)}${NBSP}ha/an pour 100${NBSP}km²`, 'moyenne sur 5 ans') },
      // le total n'est donné que sans le détail par aléa (anciennes données) : sinon la section « Risques » le remplace
      ...(CATNAT_KINDS.some((k) => Number.isFinite(c[k.col])) ? [] : [{ id: 'catnat', label: 'Catastrophes naturelles reconnues', ...val(c.catnat, (v) => plural(v, 'arrêté'), 'sur 20 ans') }]),
      { id: 'nucleaire_km', label: 'Centrale nucléaire la plus proche', ...val(c.nucleaire_km, fmtKm, 'à vol d’oiseau, depuis le centre de la commune') },
      { id: 'seveso_10km', label: `Sites Seveso à moins de ${R.seveso}${NBSP}km`, ...val(c.seveso_10km, (v) => plural(v, 'site')) },
    ],
    note: 'Valeurs de la commune, à ne pas confondre avec celles du département plus bas. Sources : Cerema (artificialisation), GASPAR (catastrophes naturelles), Géorisques (Seveso), ASNR (centrales), INSEE (population et surface).',
    source: { ...SOURCES.terres, period: 'dernières données publiées' },
  };
}

/** Risques de la commune : décomptes CatNat par aléa, risques recensés, plans opposables, trait de côte. `reading` sert à la fiche (pastilles), `rows` à la comparaison. */
function risques(c) {
  const r = riskReading(c);
  const list = (l, none) => (l.state === 'list' ? l.items.map(riskLabel).join(' · ') : l.state === 'none' ? none : 'non renseigné');
  return {
    id: 'risques',
    scope: 'commune',
    title: RISQUES_TITLE,
    reading: r,
    rows: [
      ...r.catnat.map((k, i) => ({ id: CATNAT_KINDS[i].col, label: k.label, text: k.n == null ? 'non disponible' : plural(k.n, 'reconnaissance'), sub: 'sur 20 ans' })),
      { id: 'risques', label: 'Risques recensés (DDRM)', text: list(r.risques, 'aucun recensé'), sub: r.risques.state === 'unknown' ? 'absent de la base GASPAR' : null },
      { id: 'ppr', label: 'Plans de prévention opposables', text: list(r.ppr, 'aucun'), sub: r.ppr.state === 'unknown' ? 'absent de la base GASPAR' : null },
      { id: 'trait', label: 'Recul du trait de côte', text: traitText(r.trait) },
    ],
    note: RISK_CAVEAT,
    sources: [
      { ...SOURCES.gaspar, period: '20 dernières années (CatNat) ; état actuel (risques, plans)' },
      { ...SOURCES.traitcote, period: 'décret en vigueur' },
    ],
  };
}

const FUTUR_TITLE = 'Climat futur — valeurs de la commune';

/**
 * Climat futur (TRACC, DRIAS) au point de grille de la commune. `rows` : valeurs à +2,7 °C (comparaison, et repli tant
 * que la grille n'est pas chargée) ; `trajectory` : les quatre niveaux de réchauffement pour la fiche.
 */
function futur(c, tracc) {
  const base = { id: 'futur', scope: 'commune', title: FUTUR_TITLE, source: { ...TRACC_SOURCE, period: 'niveau +2,7 °C (≈ 2050) ; référence 1976–2005' } };
  const traj = trajectory(tracc, c.tracc_pt);
  if (traj) {
    const at = (ind, level) => ind.cells.find((x) => x.level === level);
    return {
      ...base,
      trajectory: traj,
      rows: traj.map((ind) => {
        const ref = at(ind, 'REF');
        const v = at(ind, 'GWL20');
        return {
          id: `futur_${ind.key}`,
          label: ind.label,
          text: Number.isFinite(v.q50) ? fmtFutur(v.q50, ind.unit, ind.decimals) : 'non disponible',
          sub: Number.isFinite(ref.q50) ? `1976–2005 : ${cellText(ind, ref)}` : null,
        };
      }),
      note: [pointNote(c), TRACC_LEVELS_NOTE, TRACC_CAVEAT].filter(Boolean).join(' '),
    };
  }
  if (!hasFutur(c)) {
    const why = c.tracc_pt === 0 ? 'aucun point de la grille climatique à moins de 8 km (île éloignée)' : 'non disponible dans ces données';
    return { ...base, rows: [{ id: 'futur_tx35', label: 'Climat futur', text: why }], note: TRACC_CAVEAT };
  }
  return {
    ...base,
    rows: FUTUR.map((f) => ({ id: `futur_${f.key}`, label: f.label, text: Number.isFinite(c[f.col]) ? fmtFutur(c[f.col], f.unit, f.d) : 'non disponible', sub: 'à +2,7 °C' })),
    note: [pointNote(c), TRACC_CAVEAT].filter(Boolean).join(' '),
  };
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

/** Sous-titre d'identité : « Drôme (26) · Auvergne-Rhône-Alpes · 4 844 hab. ». */
export const identityLine = (p) => [p.depName ? `${p.depName} (${p.dep})` : `Département ${p.dep}`, p.region, fmtPop(p.pop)].filter(Boolean).join(' · ');
