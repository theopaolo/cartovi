// vent.js — le vent d'une commune sur la semaine disponible : échantillonne chaque image du champ au point (x, y)
// (même lecture bilinéaire que la page Flux) et résume. Les noms de direction sont ceux de la page Flux (flux/text.js n'est pas importé :
// il tire avec lui le moteur WebGL).
const ROSE = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];

/** Direction d'où vient le vent (degrés, 0 = nord, sens horaire) ; le haut de la carte est le nord. */
export function fromBearing(vx, vy) {
  const to = (Math.atan2(vx, -vy) * 180) / Math.PI;
  return (to + 540) % 360;
}

/** Secteur de la rose des vents (0–7) d'où vient le vent. */
export const sectorOf = (deg) => Math.round(deg / 45) % 8;
/** « vent de sud-ouest », « vent d’ouest ». */
export function windPhrase(sector) {
  const name = ROSE[sector];
  return `vent ${/^[eo]/.test(name) ? 'd’' : 'de '}${name}`;
}

/**
 * @param {{flux:object, maille:object}} wind  sortie de loadWind
 * @returns {{mean:number, max:number, maxAt:number, sector:number, share:number, nodeKm:number, from:number, to:number, frames:number, source:object}}
 *   vitesses en m/s ; share : part des images où le vent vient du secteur dominant ; nodeKm : distance au nœud réel le plus proche
 */
export function windStats({ flux, maille }, x, y) {
  const out = [0, 0];
  const count = new Array(8).fill(0);
  const weight = new Array(8).fill(0);
  let sum = 0;
  let max = -1;
  let maxAt = 0;
  for (let f = 0; f < flux.frames; f++) {
    flux.windAt(x, y, f, out);
    const sp = Math.hypot(out[0], out[1]);
    sum += sp;
    if (sp > max) {
      max = sp;
      maxAt = f;
    }
    if (sp > 0.05) {
      const s = sectorOf(fromBearing(out[0], out[1]));
      count[s]++;
      weight[s] += sp;
    }
  }
  let sector = 0;
  for (let s = 1; s < 8; s++) if (count[s] > count[sector] || (count[s] === count[sector] && weight[s] > weight[sector])) sector = s;
  const near = maille.nearest(x, y);
  return {
    mean: sum / flux.frames,
    max,
    maxAt: flux.times[maxAt],
    sector,
    share: count[sector] / flux.frames,
    nodeKm: near.units * maille.kmPerUnit,
    from: flux.times[0],
    to: flux.times[flux.frames - 1],
    frames: flux.frames,
    source: flux.source,
  };
}
