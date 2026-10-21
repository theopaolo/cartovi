// shaders.js — GLSL ES 3.00 écrit à la main. Quatre passes, toutes sans tampon de sommets (gl_VertexID suffit) :
//   1. UPDATE  : avance chaque particule dans le vent (état → état, rendu hors écran)
//   2. FADE    : estompe l'image précédente (les traînées)
//   3. POINTS  : dessine les particules par-dessus
//   4. PRESENT : recopie le résultat dans le canvas, en atténuant ce qui est loin d'un nœud si demandé
const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
`;

/** Triangle plein écran : trois sommets suffisent, moins de travail qu'un quad. */
export const VS_FULL = `${HEAD}
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Lecture du vent en un point (unités SVG) → m/s, dans les axes de l'écran (y vers le bas).
 * Le champ est une texture 2D en tableau (une couche par image, RG8 non signé : octet = valeur + 128).
 * Le filtrage LINEAR du matériel fait l'interpolation spatiale (bilinéaire) ; le mix() entre deux couches
 * fait l'interpolation temporelle. Les deux sont de l'interpolation : aucune mesure entre les nœuds.
 */
const WIND = `
uniform sampler2DArray uField;
uniform vec2 uFieldSize;   // étendue du champ, en unités SVG
uniform vec3 uTime;        // (couche n, couche n+1, fraction)
uniform float uQuant;      // m/s par unité d'octet
vec2 wind(vec2 p) {
  vec2 uv = p / uFieldSize;
  vec2 a = texture(uField, vec3(uv, uTime.x)).rg;
  vec2 b = texture(uField, vec3(uv, uTime.y)).rg;
  return (mix(a, b, uTime.z) * 255.0 - 128.0) * uQuant;
}`;

/** Passe 1. État d'une particule : (x, y, âge, durée de vie), une par pixel de la texture d'état. */
export const FS_UPDATE = `${HEAD}${WIND}
uniform sampler2D uState;
uniform vec2 uDomain;      // zone où naissent les particules (viewBox)
uniform float uStep;       // unités SVG parcourues par m/s et par seconde : échelle d'affichage, pas une vitesse réelle
uniform float uDt;
uniform uint uSeed;
uniform vec2 uDrop;        // (taux de base, taux supplémentaire quand le vent est faible), par seconde
uniform vec2 uLife;        // durée de vie min / max, en secondes
in vec2 vUv;
out vec4 outState;

// générateur PCG : un entier par pixel et par image, sans texture de bruit
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(inout uint s) {
  s = pcg(s);
  return float(s) * (1.0 / 4294967295.0);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 st = texelFetch(uState, ij, 0);
  uint seed = pcg(uint(ij.x) + uint(ij.y) * 8192u + uSeed);
  vec2 p = st.xy;
  vec2 w = wind(p);
  float sp = length(w);
  p += w * (uStep * uDt);   // Euler : le pas est court devant l'échelle du champ
  float age = st.z + uDt;
  float life = st.w;
  // Renaissance au hasard : les particules s'accumulent là où le vent converge ou tombe, on les y recycle plus vite
  float calm = 1.0 - smoothstep(1.0, 5.0, sp);
  float drop = (uDrop.x + uDrop.y * calm) * uDt;
  bool dead = age > life || any(lessThan(p, vec2(0.0))) || any(greaterThan(p, uDomain)) || rnd(seed) < drop;
  if (dead) {
    p = vec2(rnd(seed), rnd(seed)) * uDomain;
    age = 0.0;
    life = mix(uLife.x, uLife.y, rnd(seed));
  }
  outState = vec4(p, age, life);
}`;

/** Passe 2 : multiplie l'image précédente par uFade et retire un cran, sinon l'octet ne décroît plus (rémanence). */
export const FS_FADE = `${HEAD}
uniform sampler2D uScreen;
uniform float uFade;
in vec2 vUv;
out vec4 o;
void main() {
  o = max(texture(uScreen, vUv) * uFade - vec4(0.0021), 0.0);
}`;

/**
 * Passe 3 : deux points par particule (sa position et le milieu du pas précédent), de sorte que la traînée reste continue même
 * quand l'image dure longtemps ; couleur lue dans la rampe selon la vitesse du vent à cet endroit.
 */
export const VS_POINTS = `${HEAD}${WIND}
uniform sampler2D uState;
uniform vec2 uDomain;
uniform float uPoint;      // diamètre de base, en pixels du canvas
uniform float uSpeedMax;   // vitesse (m/s) au bout de la rampe
uniform float uMove;       // déplacement par m/s pendant cette image, en unités SVG
out float vSpeed;
out float vAlpha;
void main() {
  int side = textureSize(uState, 0).x;
  int id = gl_VertexID >> 1;
  vec4 st = texelFetch(uState, ivec2(id % side, id / side), 0);
  vec2 w = wind(st.xy);
  vec2 p = st.xy - w * (uMove * 0.5 * float(gl_VertexID & 1));
  vSpeed = clamp(length(w) / uSpeedMax, 0.0, 1.0);
  // fondu à la naissance et avant la mort : pas de point qui surgit ou disparaît d'un coup
  vAlpha = smoothstep(0.0, 0.35, st.z) * (1.0 - smoothstep(st.w - 1.0, st.w, st.z));
  gl_Position = vec4(p.x / uDomain.x * 2.0 - 1.0, 1.0 - p.y / uDomain.y * 2.0, 0.0, 1.0);
  gl_PointSize = uPoint * (0.85 + 0.5 * vSpeed);
}`;

export const FS_POINTS = `${HEAD}
uniform sampler2D uRamp;
uniform float uAlpha;
in float vSpeed;
in float vAlpha;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vAlpha * uAlpha * (1.0 - smoothstep(0.5, 1.0, d));
  vec3 c = texture(uRamp, vec2(vSpeed, 0.5)).rgb;
  o = vec4(c * a, a);       // alpha prémultiplié, comme le canvas
}`;

/**
 * Passe 4. uDist : distance au nœud de données le plus proche (0 = sur un nœud, 1 = 35 km ou plus).
 * Avec uInterp, ce qui est loin de toute donnée réelle est estompé : on ne « voit » plus que ce qui est mesuré de près.
 */
export const FS_PRESENT = `${HEAD}
uniform sampler2D uScreen;
uniform sampler2D uDist;
uniform float uInterp;
in vec2 vUv;
out vec4 o;
void main() {
  float d = texture(uDist, vec2(vUv.x, 1.0 - vUv.y)).r;   // la carte de distance est rangée de haut en bas
  float k = 1.0 - uInterp * 0.75 * smoothstep(0.15, 0.85, d);
  o = texture(uScreen, vUv) * k;
}`;
