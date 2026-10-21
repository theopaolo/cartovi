// controls.js — panneaux de la page : temps (curseur, lecture, vitesse), lecture au pointeur, couches et légende.
// Chaque fabrique renvoie de petites fonctions de mise à jour ; l'état vit dans main.js.
import { h, s } from '../dom.js';
import { NBSP, fmtNumber } from '../format.js';
import { SPEED_MAX } from './colors.js';
import { DIST_MAX_KM } from './maille.js';
import { fmtDayTick, fmtDistance, fmtHour, fmtKmh, fmtMoment, fmtSpeed, midnights, windPhrase } from './text.js';

const icon = (d) => s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' }, s('path', { d, fill: 'currentColor' }));
const PLAY = 'M4 2.5v11l9-5.5z';
const PAUSE = 'M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z';

// ---------------------------------------------------------------- temps

/**
 * @param {HTMLElement} root
 * @param {{flux: object, rates: number[], onSeek: Function, onPlay: Function, onRate: Function, onLoop: Function}} o
 */
export function createTime(root, { flux, rates, onSeek, onPlay, onRate, onLoop }) {
  const generatedMs = Date.parse(flux.generatedAt);
  const t0 = flux.times[0];
  const span = flux.times[flux.last] - t0;

  // <output> est une zone « status » implicite : sans aria-live=off, la lecture annoncerait chaque changement d'heure
  const when = h('output', { class: 'flux-when', for: 'scrub', 'aria-live': 'off' });
  const forecast = h('span', { class: 'badge warn', hidden: true, title: 'Après la date de génération des données : sortie de prévision, pas encore un vent « passé »' }, 'prévision');
  const scrub = h('input', {
    type: 'range',
    id: 'scrub',
    min: 0,
    max: flux.spanHours,
    step: 1,
    value: 0,
    'aria-label': 'Date et heure du vent affiché',
    oninput: () => onSeek(Number(scrub.value), false),
    onchange: () => onSeek(Number(scrub.value), true),
  });

  // repères de jour : un trait à chaque minuit de Paris, le nom du jour centré sur son intervalle
  const bounds = [t0, ...midnights(t0, t0 + span), t0 + span];
  const days = h('div', { class: 'flux-days', 'aria-hidden': 'true' });
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = ((bounds[i] - t0) / span) * 100;
    const b = ((bounds[i + 1] - t0) / span) * 100;
    if (i > 0) days.append(h('i', { class: 'tick', style: `left:${a}%` }));
    if (b - a < 6) continue;
    const [name, num] = fmtDayTick((bounds[i] + bounds[i + 1]) / 2);
    days.append(h('span', { class: 'dlabel', style: `left:${(a + b) / 2}%` }, h('span', { class: 'dname' }, `${name}${NBSP}`), num));
  }

  const playIcon = icon(PLAY);
  const playLabel = h('span', {}, 'Lecture');
  const play = h('button', { type: 'button', class: 'btn flux-play', id: 'play', onclick: () => onPlay() }, playIcon, playLabel);
  const pills = rates.map((r) => h('button', { type: 'button', class: 'pill', 'aria-pressed': 'false', onclick: () => onRate(r) }, `${r}${NBSP}h/s`));
  const loop = h('input', { type: 'checkbox', id: 'loop', checked: true, onchange: () => onLoop(loop.checked) });

  root.replaceChildren(
    h('div', { class: 'card flux-card' },
      h('h2', { class: 'flux-h', id: 'time-title' }, 'Temps ', h('span', { class: 'muted small' }, '(heure de Paris)')),
      h('p', { class: 'flux-whenrow' }, when, forecast),
      h('div', { class: 'flux-scrub' }, scrub, days),
      h('div', { class: 'flux-transport' },
        play,
        h('div', { class: 'flux-rates', role: 'group', 'aria-label': 'Vitesse de lecture, en heures de vent par seconde' }, pills),
        h('label', { class: 'check', for: 'loop' }, loop, h('span', {}, 'Boucle')),
      ),
    ),
  );

  let shownText = '';
  return {
    /** hours : heures depuis la première image. */
    update(hours) {
      const ms = t0 + Math.round(hours * 6) * 600000; // affichage à 10 min près : pas de minutes qui défilent
      const text = fmtMoment(ms);
      if (text !== shownText) {
        shownText = text;
        when.textContent = text;
        scrub.setAttribute('aria-valuetext', text);
      }
      if (!scrub.matches(':active')) scrub.value = String(Math.round(hours)); // pas pendant que l'on tire le curseur
      forecast.hidden = !(ms > generatedMs);
      return text;
    },
    setPlaying(p) {
      playLabel.textContent = p ? 'Pause' : 'Lecture';
      playIcon.firstChild.setAttribute('d', p ? PAUSE : PLAY);
    },
    setRate(r) {
      rates.forEach((v, i) => pills[i].setAttribute('aria-pressed', String(v === r)));
    },
    setLoop(v) {
      loop.checked = v;
    },
  };
}

// ---------------------------------------------------------------- lecture au pointeur

export function createReadout(root) {
  const arrowPath = s('path', { d: 'M0 -11L6.5 5L0 1.5L-6.5 5Z' });
  const arrow = s('svg', { class: 'wind-arrow', viewBox: '-14 -14 28 28', 'aria-hidden': 'true', focusable: 'false' }, arrowPath);
  const speed = h('strong', { class: 'read-speed' });
  const kmh = h('span', { class: 'muted' });
  const dir = h('span', { class: 'read-dir' });
  const km = h('dd', { class: 'read-km' });
  const bar = h('i', {});
  const dep = h('dd', {});
  const ppi = h('dd', {});
  const when = h('dd', {});
  const body = h('div', { class: 'read-body', 'aria-hidden': 'true' },
    h('div', { class: 'read-main' }, arrow, h('div', {}, h('p', {}, speed, ' ', kmh), h('p', {}, dir))),
    h('div', { class: 'read-limit' },
      h('dl', { class: 'kv' }, h('dt', {}, 'Donnée réelle la plus proche'), km),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, bar),
      h('p', { class: 'wnote' }, `Barre pleine à ${DIST_MAX_KM}${NBSP}km : plus on s’éloigne d’un nœud, plus la valeur est calculée.`),
    ),
    h('dl', { class: 'kv' }, h('dt', {}, 'Département'), dep, h('dt', {}, 'Périmètre PPI'), ppi, h('dt', {}, 'Heure lue'), when),
  );
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  body.hidden = false;
  root.replaceChildren(h('div', { class: 'card flux-card' }, h('h2', { class: 'flux-h', id: 'readout-title' }, 'Lecture au pointeur'), body, live));

  return {
    /** Même structure à vide (« — ») : la hauteur de la carte ne bouge pas quand on survole la carte. */
    clear() {
      speed.textContent = '—';
      kmh.textContent = '';
      dir.textContent = 'Survolez ou touchez la carte.';
      arrowPath.style.visibility = 'hidden';
      km.textContent = '—';
      bar.style.width = '0';
      dep.textContent = ppi.textContent = when.textContent = '—';
    },
    /** info : { speed, fromDeg, nodeKm, dep, ppi, ms, before, after, exact } */
    show(i) {
      speed.textContent = fmtSpeed(i.speed);
      kmh.textContent = `· ${fmtKmh(i.speed)}`;
      if (i.speed < 0.3) {
        dir.textContent = 'vent quasi nul';
        arrowPath.style.visibility = 'hidden';
      } else {
        dir.textContent = `${windPhrase(i.fromDeg)} (${fmtNumber(Math.round(i.fromDeg))}°)`;
        arrowPath.style.visibility = '';
        arrow.style.transform = `rotate(${Math.round(i.fromDeg + 180)}deg)`; // la flèche montre où va le vent
      }
      km.textContent = fmtDistance(i.nodeKm);
      bar.style.width = `${Math.round(Math.min(1, i.nodeKm / DIST_MAX_KM) * 100)}%`;
      dep.textContent = i.dep ? `${i.dep.name} (${i.dep.code})` : 'hors des départements représentés';
      ppi.textContent = i.ppi ? `${i.ppi.site.name}, à ${fmtDistance(i.ppi.km)} du centre` : 'aucun';
      when.textContent = i.exact ? `${fmtHour(i.ms)} (sortie du modèle)` : `${fmtHour(i.ms)}, entre les sorties de ${fmtHour(i.before)} et ${fmtHour(i.after)}`;
    },
    /** Phrase lue par les lecteurs d'écran, mise à jour par main.js une fois le pointeur stabilisé. */
    announce(i) {
      const w = i.speed < 0.3 ? 'Vent quasi nul' : `${windPhrase(i.fromDeg).replace(/^v/, 'V')}`;
      const dist = `Donnée réelle la plus proche à ${fmtDistance(i.nodeKm).replace(NBSP, ' ')}.`;
      const place = i.dep ? ` Département : ${i.dep.name}.` : '';
      live.textContent = `${w}, ${fmtNumber(i.speed, 1)} mètres par seconde, soit ${Math.round(i.speed * 3.6)} kilomètres par heure. ${dist}${place}`;
    },
    announceText(t) {
      live.textContent = t;
    },
  };
}

// ---------------------------------------------------------------- couches et légende

const sw = (...kids) => s('svg', { class: 'layer-sw', viewBox: '0 0 28 16', width: 28, height: 16, 'aria-hidden': 'true', focusable: 'false' }, ...kids);
const LAYERS = [
  { id: 'particles', label: 'Particules', hint: 'vent à 10 m, vitesse en couleur', sw: () => sw(s('path', { class: 'sw-flow', d: 'M2 11C8 4 14 13 20 6L26 3' })) },
  { id: 'deps', label: 'Départements', hint: 'limites administratives', sw: () => sw(s('path', { class: 'sw-dep', d: 'M2 12L9 5L15 10L21 3L26 8' })) },
  { id: 'ppi', label: 'Cercles PPI', hint: 'périmètres de 20 km (centrales nucléaires)', sw: () => sw(s('circle', { class: 'sw-ppi', cx: 14, cy: 8, r: 6.5 }), s('circle', { class: 'sw-ppi-dot', cx: 14, cy: 8, r: 1.6 })) },
  { id: 'maille', label: 'La maille', hint: 'nœuds de données et aires d’influence', sw: () => sw(s('path', { class: 'sw-node', d: 'M9 8h10M14 3v10' })) },
  { id: 'interp', label: 'Montrer ce qui est interpolé', hint: 'hachure et atténue ce qui est loin d’un nœud', sw: () => h('span', { class: 'sw na layer-sw-box', 'aria-hidden': 'true' }) },
];

/**
 * @param {HTMLElement} root
 * @param {{state: Record<string, boolean>, onChange: (id: string, on: boolean) => void, ppiNames: string[]}} o
 */
export function createLayers(root, { state, onChange, ppiNames }) {
  const inputs = new Map();
  const rows = LAYERS.map((l) => {
    const input = h('input', { type: 'checkbox', id: `layer-${l.id}`, checked: !!state[l.id], onchange: () => onChange(l.id, input.checked) });
    inputs.set(l.id, input);
    return h('label', { class: 'check layer', for: `layer-${l.id}` }, input, l.sw(), h('span', { class: 'layer-txt' }, h('b', {}, l.label), h('small', {}, l.hint)));
  });

  const ramp = h('div', { class: 'ramp', 'aria-hidden': 'true' });
  const rampLabels = h('div', { class: 'ramp-lbl', 'aria-hidden': 'true' }, [0, 0.25, 0.5, 0.75, 1].map((f) => h('span', {}, f === 1 ? `${SPEED_MAX}+` : String(f * SPEED_MAX))));
  const names = ppiNames.length ? h('p', { class: 'sr-only' }, `Centrales représentées : ${ppiNames.join(', ')}.`) : null;

  root.replaceChildren(
    h('details', { class: 'card panel', open: true },
      h('summary', {}, h('h2', {}, 'Couches et légende')),
      h('div', { class: 'panel-body' },
        rows[0],
        h('div', { class: 'ramp-wrap' }, ramp, rampLabels, h('p', { class: 'wnote' }, 'Vitesse du vent à 10 m du sol, en m/s.')),
        rows.slice(1),
        h('p', { class: 'wnote' }, 'Le vent traverse les trois premières limites sans les voir. La dernière, la maille, est celle de la donnée : entre deux croix, tout est calculé.'),
        names,
      ),
    ),
  );

  return {
    set(id, on) {
      inputs.get(id).checked = on;
    },
    /** Dégradé de la légende de vitesse, aux couleurs du thème courant. */
    setRamp(cssStops) {
      ramp.style.background = `linear-gradient(90deg, ${cssStops.join(', ')})`;
    },
  };
}
