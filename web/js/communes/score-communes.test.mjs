// score-communes.test.mjs — autotest de score-communes.js : node web/js/communes/score-communes.test.mjs
import assert from 'node:assert/strict';
import { CRITERIA, NUC_CAP_KM, columnsAvailable, defaultSettings, levelOf, scoreCommunes } from './score-communes.js';

const com = (code, dep, o = {}) => ({ code, dep, pop: 1000, cinemas: 0, scenes: 0, labels: 0, musees: 0, librairies: 0, conservatoires: 0, prix: 2000, ...o });
const res = (c, o = {}) => ({ c, min: 60, trains: 5, left: 40, ...o });
const ind = (values) => ({ values, unit: '', decimals: 0 });
const inds = { prix_maison_m2: ind({ '01': 3000, '02': 1000 }), densite: ind({ '01': 50, '02': 500 }), nucleaire_ppi: ind({ '01': 0, '02': 80 }) };
const envFor = (communes) => ({ colAvail: columnsAvailable(communes), ind: (id) => inds[id] });
const only = (w, o = {}) => ({ w: Object.fromEntries(CRITERIA.map((k) => [k.id, 0])), o: { ...defaultSettings().o, ...o } });
const withW = (w, o) => Object.assign(only(), { w: { ...only().w, ...w }, o: { ...only().o, ...o } });

// valeurs par défaut : taille et politique à 0, prix « moins cher » à 1,5
const d = defaultSettings();
assert.equal(d.w.tai, 0);
assert.equal(d.w.pol, 0);
assert.equal(d.w.prx, 1.5);
assert.equal(d.o.prx, 'moins');
assert.equal(d.o.pol, null);

// temps de train : plus court = mieux ; classement relatif à la sélection (3 communes → 1, 0,5, 0)
const a = res(com('A', '01'), { min: 20 });
const b = res(com('B', '01'), { min: 40 });
const c = res(com('C', '02'), { min: 90 });
let s = scoreCommunes([a, b, c], withW({ tps: 1 }), envFor([a.c, b.c, c.c]));
assert.deepEqual([...s.byCode.values()].map((e) => e.score), [100, 50, 0]);
assert.deepEqual([...s.byCode.values()].map((e) => e.rank), [1, 2, 3]);
// la même commune, dans une sélection réduite, change de score (relatif à la sélection)
s = scoreCommunes([b, c], withW({ tps: 1 }), envFor([b.c, c.c]));
assert.equal(s.byCode.get('B').score, 100);

// critère à sens choisi : sans sens, inactif ; « plus à gauche » favorise la gauche, « plus à droite » l'inverse
const l1 = res(com('L1', '01'), { left: 60 });
const l2 = res(com('L2', '01'), { left: 20 });
const env2 = envFor([l1.c, l2.c]);
assert.equal(scoreCommunes([l1, l2], withW({ pol: 2 }), env2).active.length, 0);
assert.equal(scoreCommunes([l1, l2], withW({ pol: 2 }, { pol: 'gauche' }), env2).byCode.get('L1').rank, 1);
assert.equal(scoreCommunes([l1, l2], withW({ pol: 2 }, { pol: 'droite' }), env2).byCode.get('L2').rank, 1);

// ex æquo : rang moyen (deux communes identiques → 50 chacune sur 2… ici 3 communes, 2 ex æquo)
const t = [res(com('T1', '01'), { trains: 10 }), res(com('T2', '01'), { trains: 10 }), res(com('T3', '01'), { trains: 2 })];
s = scoreCommunes(t, withW({ dir: 1 }), envFor(t.map((r) => r.c)));
assert.deepEqual([s.byCode.get('T1').score, s.byCode.get('T2').score, s.byCode.get('T3').score], [75, 75, 0]);

// repli « cellule » : une commune sans prix prend le prix de son département (même unité)
const p1 = res(com('P1', '01', { prix: 1500 }));
const p2 = res(com('P2', '02', { prix: null })); // dép. 02 : 1000 €/m² → moins cher que P1
s = scoreCommunes([p1, p2], withW({ prx: 1 }, { prx: 'moins' }), envFor([p1.c, p2.c]));
assert.equal(s.byCode.get('P2').rank, 1);
assert.equal(s.parts('P2')[0].x.gran, 'departement');
assert.equal(s.parts('P1')[0].x.gran, 'commune');
// sens « plus cher » inverse
s = scoreCommunes([p1, p2], withW({ prx: 1 }, { prx: 'plus' }), envFor([p1.c, p2.c]));
assert.equal(s.byCode.get('P1').rank, 1);

// nucléaire : plafonné à 40 km (ex æquo au-delà) ; commune sans valeur ignorée quand la colonne existe ailleurs
const n1 = res(com('N1', '01', { nucleaire_km: 10 }));
const n2 = res(com('N2', '01', { nucleaire_km: 45 }));
const n3 = res(com('N3', '01', { nucleaire_km: 150 }));
const n4 = res(com('N4', '01', { nucleaire_km: null }));
const nenv = envFor([n1.c, n2.c, n3.c, n4.c]);
assert.equal(levelOf(CRITERIA.find((k) => k.id === 'nuc'), nenv), 'commune');
s = scoreCommunes([n1, n2, n3, n4], withW({ nuc: 1 }), nenv);
assert.equal(s.byCode.get('N2').score, s.byCode.get('N3').score);
assert.equal(s.byCode.get('N4'), undefined);
assert.equal(NUC_CAP_KM, 40);

// nucléaire : colonne entièrement absente → repli sur l'indicateur départemental, étiqueté « repli »
const m1 = res(com('M1', '01'));
const m2 = res(com('M2', '02'));
const menv = envFor([m1.c, m2.c]);
assert.equal(levelOf(CRITERIA.find((k) => k.id === 'nuc'), menv), 'repli');
s = scoreCommunes([m1, m2], withW({ nuc: 1 }), menv);
assert.equal(s.byCode.get('M1').rank, 1); // repli : part du territoire en zone PPI, moins = mieux (01 : 0 %, 02 : 80 %)
assert.equal(s.parts('M1')[0].x.gran, 'repli');

// critère sans aucune source (ni colonne, ni indicateur) : indisponible, jamais compté
assert.equal(levelOf(CRITERIA.find((k) => k.id === 'sev'), menv), null);
s = scoreCommunes([m1, m2], withW({ sev: 3 }), menv);
assert.equal(s.active.length, 0);
assert.equal(s.byCode.size, 0);

// composite : moyenne pondérée renormalisée sur les critères renseignés
const q1 = res(com('Q1', '01', { densite: 10 }), { min: 10 });
const q2 = res(com('Q2', '01', { densite: null }), { min: 50 });
const q3 = res(com('Q3', '01', { densite: 900 }), { min: 30 });
s = scoreCommunes([q1, q2, q3], withW({ tps: 2, den: 1 }), envFor([q1.c, q2.c, q3.c]));
// Q2 n'a pas de densité propre mais son département en a une (50) : fallback ; tps : Q1 1, Q3 0,5, Q2 0
assert.ok(s.byCode.get('Q1').score > s.byCode.get('Q3').score && s.byCode.get('Q3').score > s.byCode.get('Q2').score);
const sum = s.parts('Q1').reduce((acc, p) => acc + p.points, 0);
assert.ok(Math.abs(sum - s.byCode.get('Q1').score) < 1e-9, 'la somme des contributions est le score');

// risques CatNat par aléa : quatre critères, 0 est une vraie valeur, le total n'est plus un critère
const byId = (id) => CRITERIA.find((k) => k.id === id);
assert.deepEqual(['cin', 'cse', 'cme', 'cmt'].map((id) => byId(id).w), [1, 1, 1, 0.5]);
assert.deepEqual(['cin', 'cse', 'cme', 'cmt'].map((id) => byId(id).col), ['catnat_inond', 'catnat_sech', 'catnat_mer', 'catnat_mvt']);
const r1 = res(com('R1', '01', { catnat_inond: 0, catnat_sech: 0, catnat_mer: 0, catnat_mvt: 0, catnat: 0 }));
const r2 = res(com('R2', '01', { catnat_inond: 5, catnat_sech: 0, catnat_mer: 0, catnat_mvt: 0, catnat: 5 }));
const r3 = res(com('R3', '01', { catnat_inond: 1, catnat_sech: 9, catnat_mer: 0, catnat_mvt: 2, catnat: 12 }));
const renv = envFor([r1.c, r2.c, r3.c]);
assert.equal(levelOf(byId('cin'), renv), 'commune');
assert.equal(levelOf(byId('cat'), renv), null, 'le total est un repli, pas un critère, quand le détail existe');
s = scoreCommunes([r1, r2, r3], withW({ cin: 1 }), renv);
assert.deepEqual([s.byCode.get('R1').rank, s.byCode.get('R3').rank, s.byCode.get('R2').rank], [1, 2, 3]);
s = scoreCommunes([r1, r2, r3], withW({ cin: 1, cse: 1, cme: 1, cmt: 0.5 }), renv);
assert.equal(s.active.length, 4);
assert.equal(s.byCode.get('R1').rank, 1);
// anciennes données (colonnes par aléa absentes) : repli sur le total communal, puis sur le département
const o1 = res(com('O1', '01', { catnat: 2 }));
const o2 = res(com('O2', '02', { catnat: null }));
const oenv = { colAvail: columnsAvailable([o1.c, o2.c]), ind: (id) => (id === 'catnat' ? ind({ '01': 1, '02': 9 }) : inds[id]) };
assert.equal(levelOf(byId('cin'), oenv), null);
assert.equal(levelOf(byId('cat'), oenv), 'commune');
s = scoreCommunes([o1, o2], withW({ cat: 1, cin: 3 }), oenv);
assert.deepEqual(s.active.map((a) => a.k.id), ['cat']);
assert.equal(s.parts('O2')[0].x.gran, 'departement'); // O2 n'a pas de total communal : celui de son département
assert.equal(s.byCode.get('O1').rank, 1);
const oenv2 = { colAvail: columnsAvailable([com('Z', '01')]), ind: (id) => (id === 'catnat' ? ind({ '01': 1 }) : undefined) };
assert.equal(levelOf(byId('cat'), oenv2), 'departement');

// lecture par écart (min-max) : les ordres de grandeur comptent ; le même ordre, mais pas les mêmes scores
const m = [res(com('M1', '01'), { min: 10 }), res(com('M2', '01'), { min: 20 }), res(com('M3', '01'), { min: 30 }), res(com('M4', '01'), { min: 1010 })];
const menv2 = envFor(m.map((r) => r.c));
assert.equal(defaultSettings().norm, 'rank');
const sr = scoreCommunes(m, withW({ tps: 1 }), menv2);
const sm = scoreCommunes(m, { ...withW({ tps: 1 }), norm: 'minmax' }, menv2);
assert.ok(Math.abs(sr.byCode.get('M2').score - (200 / 3)) < 1e-9);
assert.ok(Math.abs(sm.byCode.get('M2').score - 100 * (1 - 10 / 1000)) < 1e-9);
assert.ok(Math.abs(sm.byCode.get('M4').score) < 1e-9);
assert.deepEqual([...sm.byCode.keys()].map((k) => sm.byCode.get(k).rank), [1, 2, 3, 4]);
// la mémoïsation tient compte du mode (même tableau de résultats, autre lecture)
const memo = {};
const a1 = scoreCommunes(m, withW({ tps: 1 }), menv2, memo).byCode.get('M2').score;
const a2 = scoreCommunes(m, { ...withW({ tps: 1 }), norm: 'minmax' }, menv2, memo).byCode.get('M2').score;
assert.notEqual(a1, a2);

console.log('score-communes : ok');
