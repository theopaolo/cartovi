// wind-gl.js — particules de vent sur le GPU, WebGL2 brut (technique de V. Agafonkin, 2017).
//
// Principe : la position de chaque particule vit dans une texture flottante (un pixel = une particule).
// Chaque image, un fragment shader lit le vent au point où se trouve la particule et écrit la position suivante
// dans une seconde texture (ping-pong). Les points sont ensuite dessinés dans une texture d'écran, que l'on
// estompe à chaque image pour laisser des traînées (ping-pong aussi), puis recopiée dans le canvas.
// Rien n'est alloué dans la boucle de rendu : uniquement des appels gl.* avec des nombres.
import { SPEED_MAX } from './colors.js';
import * as SH from './shaders.js';

/** Échelle d'affichage : environ 4 h de vent réel par seconde de film (un vent de 2 m/s, fréquent, reste visible). Plus vite, les traînées se brouillent. */
export const FLOW_HOURS_PER_SECOND = 4;
const FADE = 0.945; // part de l'image conservée à 60 images/s
const LIFE = [3.5, 9]; // durée de vie des particules (s)
const DROP = [0.12, 0.3]; // renaissance au hasard par seconde : base, supplément quand le vent est faible
const MAX_DT = 0.05;

/**
 * Côté de la texture d'état. Densité visée : une particule pour ~70 px² de scène (× densité de pixels), entre 16 384 et 65 536 :
 * assez pour lire l'écoulement, pas assez pour le noyer. Multiple de 16 pour des textures « rondes ».
 */
function particleSide(area, dpr) {
  const count = Math.min(65536, Math.max(16384, (area * dpr) / 70));
  return Math.min(256, Math.max(128, Math.ceil(Math.sqrt(count) / 16) * 16));
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader : ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

function program(gl, vs, fs, uniforms) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`programme : ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
  return { p, u };
}

function texture2D(gl, internal, w, h, format, type, data, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function framebuffer(gl, tex) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplet');
  return fb;
}

/**
 * Renvoie null si WebGL2 ou le rendu en texture flottante manquent : l'appelant bascule alors sur les flèches statiques.
 * @param {HTMLCanvasElement} canvas
 * @param {object} flux champ chargé par data.js
 * @param {{dist: {w, h, data}, onLost?: Function, onRestored?: Function}} opts
 */
export function createWindGL(canvas, flux, { dist, onLost, onRestored }) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  // rendre dans une texture RGBA32F demande cette extension (quasi universelle en WebGL2, mais pas garantie)
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;

  const { nx, ny, frames, last } = flux;
  const fieldW = nx * flux.dx;
  const fieldH = ny * flux.dy;
  const stepUnits = (FLOW_HOURS_PER_SECOND * 3.6) / flux.kmPerUnit; // unités SVG par (m/s) et par seconde de film
  const biased = new Uint8Array(flux.bytes.length);
  for (let i = 0; i < biased.length; i++) biased[i] = flux.bytes[i] ^ 0x80; // int8 → octet décalé de 128 (RG8 est filtrable partout)

  let P; // programmes
  let tex; // textures statiques : champ, rampe, distance
  let vao;
  let side = 0;
  let stateTex = [];
  let stateFbo = [];
  let screenTex = [];
  let screenFbo = [];
  let cur = 0; // indice de l'état courant
  let scr = 0; // indice de l'écran courant
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cssArea = 0;
  let interp = 0;
  let ramp = null;
  let lost = false;

  function setup() {
    // après une perte de contexte, les extensions sont à réactiver : sans elles, la texture flottante n'est plus un rendu valide
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('rendu en texture flottante indisponible');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const windU = ['uField', 'uFieldSize', 'uTime', 'uQuant'];
    P = {
      update: program(gl, SH.VS_FULL, SH.FS_UPDATE, [...windU, 'uState', 'uDomain', 'uStep', 'uDt', 'uSeed', 'uDrop', 'uLife']),
      fade: program(gl, SH.VS_FULL, SH.FS_FADE, ['uScreen', 'uFade']),
      points: program(gl, SH.VS_POINTS, SH.FS_POINTS, [...windU, 'uState', 'uDomain', 'uPoint', 'uSpeedMax', 'uMove', 'uRamp', 'uAlpha']),
      present: program(gl, SH.VS_FULL, SH.FS_PRESENT, ['uScreen', 'uDist', 'uInterp']),
    };
    vao = gl.createVertexArray(); // aucun attribut : les shaders s'appuient sur gl_VertexID
    gl.bindVertexArray(vao);

    // unités de texture : 0 = état ou écran (change à chaque passe), 1 = champ de vent, 2 = rampe, 3 = distance
    const field = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, field);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, nx, ny, frames);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, nx, ny, frames, gl.RG, gl.UNSIGNED_BYTE, biased);
    // LINEAR : c'est ici que l'interpolation spatiale a lieu, sur le matériel, pour chaque lecture
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE2);
    const rampTex = texture2D(gl, gl.RGBA8, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, ramp || new Uint8Array(256 * 4), gl.LINEAR);
    gl.activeTexture(gl.TEXTURE3);
    const distTex = texture2D(gl, gl.R8, dist.w, dist.h, gl.RED, gl.UNSIGNED_BYTE, dist.data, gl.LINEAR);
    tex = { field, rampTex, distTex };

    // uniformes constants, une fois pour toutes
    for (const name of ['update', 'points']) {
      gl.useProgram(P[name].p);
      gl.uniform1i(P[name].u.uField, 1);
      gl.uniform2f(P[name].u.uFieldSize, fieldW, fieldH);
      gl.uniform1f(P[name].u.uQuant, flux.quant);
      gl.uniform1i(P[name].u.uState, 0);
      gl.uniform2f(P[name].u.uDomain, flux.W, flux.H);
    }
    gl.useProgram(P.points.p);
    gl.uniform1i(P.points.u.uRamp, 2);
    gl.uniform1f(P.points.u.uSpeedMax, SPEED_MAX);
    gl.useProgram(P.update.p);
    gl.uniform1f(P.update.u.uStep, stepUnits);
    gl.uniform2f(P.update.u.uDrop, DROP[0], DROP[1]);
    gl.uniform2f(P.update.u.uLife, LIFE[0], LIFE[1]);
    gl.useProgram(P.fade.p);
    gl.uniform1i(P.fade.u.uScreen, 0);
    gl.useProgram(P.present.p);
    gl.uniform1i(P.present.u.uScreen, 0);
    gl.uniform1i(P.present.u.uDist, 3);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    side = 0; // les anciens objets appartenaient au contexte perdu : on les oublie sans les supprimer
    stateTex = [];
    stateFbo = [];
    screenTex = [];
    screenFbo = [];
    if (W) allocate();
  }

  /** (Ré)alloue les textures dépendant de la taille : état des particules et écrans de traînées. */
  function allocate() {
    for (const t of [...stateTex, ...screenTex]) gl.deleteTexture(t);
    for (const f of [...stateFbo, ...screenFbo]) gl.deleteFramebuffer(f);
    side = particleSide(cssArea, dpr);
    const init = new Float32Array(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      const life = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
      init[i * 4] = Math.random() * flux.W;
      init[i * 4 + 1] = Math.random() * flux.H;
      init[i * 4 + 2] = Math.random() * life; // âges décalés : pas de vague de renaissances simultanées
      init[i * 4 + 3] = life;
    }
    gl.activeTexture(gl.TEXTURE0);
    stateTex = [0, 1].map(() => texture2D(gl, gl.RGBA32F, side, side, gl.RGBA, gl.FLOAT, init, gl.NEAREST));
    screenTex = [0, 1].map(() => texture2D(gl, gl.RGBA8, W, H, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST));
    stateFbo = stateTex.map((t) => framebuffer(gl, t));
    screenFbo = screenTex.map((t) => framebuffer(gl, t));
    cur = 0;
    scr = 0;
    clear();
  }

  function clear() {
    gl.clearColor(0, 0, 0, 0);
    for (const f of screenFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function setTime(program, layer) {
    const l0 = Math.min(Math.floor(layer), last);
    const l1 = Math.min(l0 + 1, last);
    gl.uniform3f(program.u.uTime, l0, l1, Math.min(layer - l0, 1));
  }

  /**
   * Une image : avance les particules de dt secondes, trace, présente.
   * @param {number} dt secondes réelles écoulées
   * @param {number} layer position dans le temps, en images (fractionnaire)
   */
  function step(dt, layer) {
    if (lost || !side) return;
    dt = Math.min(dt, MAX_DT);
    const next = 1 - cur;

    // 1. mise à jour des positions : état[cur] → état[next]
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[next]);
    gl.viewport(0, 0, side, side);
    gl.useProgram(P.update.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
    setTime(P.update, layer);
    gl.uniform1f(P.update.u.uDt, dt);
    gl.uniform1ui(P.update.u.uSeed, (Math.random() * 4294967295) >>> 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = next;

    // 2. traînées : image précédente estompée → écran[ns]
    const ns = 1 - scr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, screenFbo[ns]);
    gl.viewport(0, 0, W, H);
    gl.useProgram(P.fade.p);
    gl.bindTexture(gl.TEXTURE_2D, screenTex[scr]);
    gl.uniform1f(P.fade.u.uFade, Math.pow(FADE, dt * 60)); // la longueur des traînées ne dépend pas du débit d'images
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. points par-dessus (alpha prémultiplié)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.points.p);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
    setTime(P.points, layer);
    gl.uniform1f(P.points.u.uMove, stepUnits * dt);
    gl.drawArrays(gl.POINTS, 0, side * side * 2); // deux points par particule
    gl.disable(gl.BLEND);
    scr = ns;

    // 4. présentation
    present();
  }

  function present() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(P.present.p);
    gl.uniform1f(P.present.u.uInterp, interp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, screenTex[scr]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // la perte de contexte (GPU réinitialisé, onglet en arrière-plan sur mobile) est normale : on reconstruit tout
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    onLost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      setup();
      lost = false;
      onRestored?.();
    } catch (err) {
      console.error(err);
      onLost?.();
    }
  });

  try {
    setup();
  } catch (err) {
    console.info('WebGL2 inutilisable :', err.message);
    return null;
  }

  return {
    step,
    clear,
    /** Redimensionne le canvas (pixels CSS × densité) ; réalloue particules et traînées. */
    resize(cssW, cssH, ratio) {
      dpr = ratio;
      cssArea = cssW * cssH;
      W = Math.max(1, Math.round(cssW * ratio));
      H = Math.max(1, Math.round(cssH * ratio));
      canvas.width = W;
      canvas.height = H;
      if (lost) return;
      allocate();
      gl.useProgram(P.points.p);
      gl.uniform1f(P.points.u.uPoint, (cssW < 480 ? 1.3 : 1.5) * ratio);
      // plus la scène est dense en particules, moins chacune doit peser
      gl.uniform1f(P.points.u.uAlpha, Math.min(0.9, Math.max(0.3, 0.15 + cssArea / (side * side) / 100)));
    },
    setRamp(bytes) {
      ramp = bytes;
      if (lost) return;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex.rampTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    },
    setInterp(on) {
      interp = on ? 1 : 0;
    },
    get count() {
      return side * side;
    },
    get lost() {
      return lost;
    },
  };
}
