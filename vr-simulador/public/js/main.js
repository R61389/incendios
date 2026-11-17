import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Simulador VR de incendios — Parque Nacional Tunari, sector Cercado
 *  Usa los datos reales del proyecto SIM-522 (Grupo 3): la grilla de
 *  elevación/vegetación y una corrida calibrada del autómata celular
 *  (p_h = 0,072, viento del "peor día"), exportadas por export_data.py.
 * ------------------------------------------------------------------ */

const COLORES_CLASE = {
  10: 0x3a5e32, // arbórea (eucalipto/pino) — verde oliva oscuro, real
  20: 0x87954a, // matorral — verde seco
  30: 0xc6a052, // pastizal (pajonal) — dorado seco de época seca
  40: 0xad8550, // cultivo — pardo tierra
  50: 0x8d8579, // zona construida — gris cálido (techos/calles)
  60: 0xa89d89, // roca / suelo desnudo — beige grisáceo
  80: 0x3f7096, // agua — azul profundo
};

/* ---------------------- ruido simple (sin dependencias) ------------------- */
function hashRuido(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function ruidoSuave(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h00 = hashRuido(xi, yi), h10 = hashRuido(xi + 1, yi);
  const h01 = hashRuido(xi, yi + 1), h11 = hashRuido(xi + 1, yi + 1);
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}
function ruidoFBM(x, y) {
  return ruidoSuave(x, y) * 0.55 + ruidoSuave(x * 2.6, y * 2.6) * 0.3 + ruidoSuave(x * 7.1, y * 7.1) * 0.15;
}
const COLOR_EN_LLAMAS = new THREE.Color(0xff6a1a);
const COLOR_QUEMADA = new THREE.Color(0x2a1812);
const COLOR_CORTAFUEGOS = new THREE.Color(0x3a3a3a);

const WORLD_SIZE = 60;      // tamaño del terreno en unidades Three.js (metros "escénicos")
const ALTURA_EXAGERA = 1.8; // exageración vertical para que el relieve se note en VR

const state = {
  terreno: null,
  escenarios: {},
  escenarioActual: 'base',
  frameIdx: 0,
  playing: true,
  playSpeed: 2.2, // frames por segundo de animación
  acumulador: 0,
  modoRiesgo: false,
};

const $ = (id) => document.getElementById(id);

async function cargarDatos() {
  const [terreno, base, corta, riesgo] = await Promise.all([
    fetch('./data/terreno.json').then((r) => r.json()),
    fetch('./data/fuego_base.json').then((r) => r.json()),
    fetch('./data/fuego_cortafuegos250.json').then((r) => r.json()),
    fetch('./data/riesgo.json').then((r) => r.json()),
  ]);
  state.terreno = terreno;
  state.escenarios.base = base;
  state.escenarios.cortafuegos250 = corta;
  state.riesgo = riesgo;
}

/* ---------------------- construcción de la escena ------------------- */

let renderer, scene, camera, controls;
let fireMesh, smokeSystem;
let combustibleIdx = []; // [{i,j,x,y,z}]
let heightAt; // función (i,j)->altura escénica

let nubes = [];

function crearCieloYLuces() {
  // Cúpula de cielo con degradado (cenit azul pálido -> horizonte cálido de tarde)
  const radioCielo = WORLD_SIZE * 4;
  const geoCielo = new THREE.SphereGeometry(radioCielo, 32, 20);
  const posC = geoCielo.attributes.position;
  const coloresCielo = new Float32Array(posC.count * 3);
  const cZenit = new THREE.Color(0x5f8fc4);
  const cHorizonte = new THREE.Color(0xf6c89a);
  const cBajoHorizonte = new THREE.Color(0xcf9f6e);
  const tmp = new THREE.Color();
  for (let k = 0; k < posC.count; k++) {
    const y = posC.getY(k) / radioCielo; // -1..1
    let t;
    if (y >= 0) { t = Math.pow(1 - y, 1.6); tmp.copy(cZenit).lerp(cHorizonte, t); }
    else { t = Math.pow(1 + y * 3, 1.2); tmp.copy(cBajoHorizonte).lerp(cHorizonte, Math.max(0, t)); }
    coloresCielo[k * 3] = tmp.r; coloresCielo[k * 3 + 1] = tmp.g; coloresCielo[k * 3 + 2] = tmp.b;
  }
  geoCielo.setAttribute('color', new THREE.BufferAttribute(coloresCielo, 3));
  const matCielo = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(geoCielo, matCielo));

  scene.background = new THREE.Color(0xdcb98e);
  scene.fog = new THREE.FogExp2(0xe4c9a3, 0.0115);

  const hemi = new THREE.HemisphereLight(0xfff0dd, 0x4a4433, 1.15);
  scene.add(hemi);

  const sol = new THREE.DirectionalLight(0xffecc8, 2.3);
  sol.position.set(-WORLD_SIZE * 0.5, WORLD_SIZE * 0.6, WORLD_SIZE * 0.2); // tarde, sol bajo
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.camera.left = -WORLD_SIZE; sol.shadow.camera.right = WORLD_SIZE;
  sol.shadow.camera.top = WORLD_SIZE; sol.shadow.camera.bottom = -WORLD_SIZE;
  scene.add(sol);

  // resplandor del sol (sprite con degradado radial, sin textura externa)
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,244,214,0.95)');
  g.addColorStop(0.35, 'rgba(255,220,160,0.45)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const solSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false,
  }));
  solSprite.scale.set(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1, 1);
  solSprite.position.copy(sol.position).multiplyScalar(3);
  scene.add(solSprite);

  // nubes simples (sprites con degradado suave), derivando lentamente
  const cNube = document.createElement('canvas'); cNube.width = cNube.height = 128;
  const ctxN = cNube.getContext('2d');
  const gN = ctxN.createRadialGradient(64, 64, 10, 64, 64, 64);
  gN.addColorStop(0, 'rgba(255,250,245,0.85)');
  gN.addColorStop(0.6, 'rgba(255,245,235,0.4)');
  gN.addColorStop(1, 'rgba(255,245,235,0)');
  ctxN.fillStyle = gN; ctxN.fillRect(0, 0, 128, 128);
  const texNube = new THREE.CanvasTexture(cNube);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texNube, transparent: true, depthWrite: false, opacity: 0.8 }));
    const escala = WORLD_SIZE * (0.5 + Math.random() * 0.6);
    s.scale.set(escala * 1.6, escala * 0.7, 1);
    s.position.set((Math.random() - 0.5) * WORLD_SIZE * 3.5, WORLD_SIZE * (0.55 + Math.random() * 0.35), (Math.random() - 0.5) * WORLD_SIZE * 3.5);
    scene.add(s);
    nubes.push({ sprite: s, vel: 0.15 + Math.random() * 0.25 });
  }
}

function actualizarNubes(dt) {
  for (const n of nubes) {
    n.sprite.position.x += n.vel * dt;
    if (n.sprite.position.x > WORLD_SIZE * 2) n.sprite.position.x = -WORLD_SIZE * 2;
  }
}

function construirTerreno() {
  const t = state.terreno;
  const n = t.n;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colores = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const elevRango = Math.max(1, t.elevMax - t.elevMin);

  heightAt = (i, j) => {
    const e = t.elevacion[i][j];
    return ((e - t.elevMin) / elevRango) * (WORLD_SIZE * 0.22) * ALTURA_EXAGERA;
  };

  // La grilla fila=i (norte->sur), col=j (oeste->este); PlaneGeometry recorre
  // filas de -Z a +Z y columnas de -X a +X en el mismo orden de creación.
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      pos.setY(k, heightAt(i, j));
      let clase = t.clase[i][j];
      if (t.lineaCortafuegos250[i][j]) {
        color.copy(COLOR_CORTAFUEGOS);
      } else {
        color.set(COLORES_CLASE[clase] ?? 0x999999);
        // Variación natural tipo "parches" (más real que un color plano por celda)
        const ruido = ruidoFBM(i * 0.14, j * 0.14);
        color.getHSL(hsl);
        hsl.l = Math.min(0.92, Math.max(0.05, hsl.l + (ruido - 0.5) * 0.22));
        hsl.s = Math.min(1, Math.max(0, hsl.s * (0.85 + ruido * 0.3)));
        color.setHSL(hsl.h, hsl.s, hsl.l);
      }
      colores[k * 3] = color.r; colores[k * 3 + 1] = color.g; colores[k * 3 + 2] = color.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  // marcador de viviendas (zona urbana) con un leve relieve para que se note desde VR
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (t.clase[i][j] === 10 || t.clase[i][j] === 20 || t.clase[i][j] === 30 || t.clase[i][j] === 40) {
        combustibleIdx.push({ i, j });
      }
    }
  }
}

function xzDe(i, j) {
  const n = state.terreno.n;
  const x = (j / (n - 1) - 0.5) * WORLD_SIZE;
  const z = (i / (n - 1) - 0.5) * WORLD_SIZE;
  return [x, z];
}

function construirOverlayDeFuego() {
  const n = state.terreno.n;
  const tileSize = (WORLD_SIZE / n) * 1.02;
  const geo = new THREE.BoxGeometry(tileSize, 1, tileSize);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: false, emissive: 0x000000, roughness: 0.85, transparent: true,
  });
  fireMesh = new THREE.InstancedMesh(geo, mat, combustibleIdx.length);
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireMesh.castShadow = false;
  const m = new THREE.Matrix4();
  for (let k = 0; k < combustibleIdx.length; k++) {
    m.makeScale(0.0001, 0.0001, 0.0001);
    fireMesh.setMatrixAt(k, m);
  }
  scene.add(fireMesh);
}

/* -------------------------- humo (partículas) ------------------------ */

function texturaHumo() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(200,200,200,0.55)');
  g.addColorStop(0.5, 'rgba(160,160,160,0.25)');
  g.addColorStop(1, 'rgba(160,160,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function construirHumo() {
  const MAX = 400;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const alphas = new Float32Array(MAX).fill(0);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const mat = new THREE.PointsMaterial({
    size: 2.6, map: texturaHumo(), transparent: true, depthWrite: false,
    color: 0xcfcfcf, opacity: 0.9, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  smokeSystem = {
    points, geo, max: MAX, next: 0,
    vel: new Array(MAX).fill(null).map(() => new THREE.Vector3()),
    life: new Float32Array(MAX),
    age: new Float32Array(MAX),
  };
}

function emitirHumo(x, y, z) {
  const s = smokeSystem;
  const k = s.next; s.next = (s.next + 1) % s.max;
  const pos = s.geo.attributes.position;
  pos.setXYZ(k, x + (Math.random() - 0.5) * 0.6, y + 0.4, z + (Math.random() - 0.5) * 0.6);
  s.vel[k].set((Math.random() - 0.5) * 0.15, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.15 - 0.3);
  s.life[k] = 2.5 + Math.random() * 1.5;
  s.age[k] = 0;
}

function actualizarHumo(dt) {
  const s = smokeSystem;
  const pos = s.geo.attributes.position;
  const alpha = s.geo.attributes.alpha;
  for (let k = 0; k < s.max; k++) {
    if (s.age[k] >= s.life[k]) continue;
    s.age[k] += dt;
    const x = pos.getX(k) + s.vel[k].x * dt;
    const y = pos.getY(k) + s.vel[k].y * dt;
    const z = pos.getZ(k) + s.vel[k].z * dt;
    pos.setXYZ(k, x, y, z);
    const t = s.age[k] / s.life[k];
    alpha.setX(k, Math.max(0, 1 - t));
    if (t >= 1) pos.setXYZ(k, 0, -9999, 0);
  }
  pos.needsUpdate = true;
  s.points.material.opacity = 0.9;
}

/* ------------------------- animación del fuego ------------------------ */

function colorRiesgo(p) {
  // mapa de calor simple amarillo->rojo (0..1)
  const c = new THREE.Color();
  c.setHSL(0.14 - 0.14 * Math.min(1, p * 2.2), 0.95, 0.5);
  return c;
}

function aplicarFrame() {
  const esc = state.escenarios[state.escenarioActual];
  const frame = esc.frames[Math.min(state.frameIdx, esc.frames.length - 1)];
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let haQuemadas = 0;
  let llegaBorde = false;
  const n = state.terreno.n;
  const borde = state.terreno.urbano;

  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    const v = frame[i][j];
    const [x, z] = xzDe(i, j);
    const y = heightAt(i, j);
    if (v === 2 || v === 3) {
      if (v === 2) { color.copy(COLOR_EN_LLAMAS); haQuemadas++; if (Math.random() < 0.02) emitirHumo(x, y + 0.3, z); }
      else { color.copy(COLOR_QUEMADA); haQuemadas++; }
      m.compose(
        new THREE.Vector3(x, y + 0.35, z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1),
      );
      fireMesh.setMatrixAt(k, m);
      fireMesh.setColorAt(k, color);
    } else {
      m.makeScale(0.0001, 0.0001, 0.0001);
      fireMesh.setMatrixAt(k, m);
    }
  }
  fireMesh.instanceMatrix.needsUpdate = true;
  if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

  // ¿llegó a una celda vecina de zona urbana?
  for (let k = 0; k < combustibleIdx.length && !llegaBorde; k++) {
    const { i, j } = combustibleIdx[k];
    if (frame[i][j] >= 2) {
      for (let di = -1; di <= 1 && !llegaBorde; di++) {
        for (let dj = -1; dj <= 1 && !llegaBorde; dj++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < n && borde[ii][jj]) llegaBorde = true;
        }
      }
    }
  }

  const ha = haQuemadas * (state.terreno.celda_m ** 2 / 10000);
  const minutos = Math.round(state.frameIdx * (esc.dtMin * esc.pasosGuardadosCada));
  $('statEscenario').textContent = state.escenarioActual === 'base' ? 'Sin intervención' : 'Con cortafuegos (250 m)';
  $('statHa').textContent = `${ha.toFixed(1)} ha`;
  $('statLlega').textContent = llegaBorde ? 'Sí' : 'No';
  $('statLlega').classList.toggle('on', llegaBorde);
  $('statTiempo').textContent = `${minutos} min`;
  $('timeClock').textContent = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  $('scrub').max = String(esc.frames.length - 1);
  $('scrub').value = String(state.frameIdx);
}

function aplicarMapaDeRiesgo(activar) {
  state.modoRiesgo = activar;
  if (!activar) { aplicarFrame(); return; }
  // Mapa de riesgo real: probabilidad de quema por celda, de 150 corridas de
  // Monte Carlo (mismo criterio que la Figura 8 del informe, cap. 6.1).
  const mapa = state.riesgo.mapa;
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let pmax = 0;
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    if (mapa[i][j] > pmax) pmax = mapa[i][j];
  }
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    const p = mapa[i][j];
    const [x, z] = xzDe(i, j);
    const y = heightAt(i, j);
    if (p > 0.02) {
      color.copy(colorRiesgo(p / pmax));
      const alto = 0.3 + 2.2 * (p / pmax);
      m.compose(new THREE.Vector3(x, y + alto / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.85, alto, 0.85));
      fireMesh.setMatrixAt(k, m);
      fireMesh.setColorAt(k, color);
    } else {
      m.makeScale(0.0001, 0.0001, 0.0001);
      fireMesh.setMatrixAt(k, m);
    }
  }
  fireMesh.instanceMatrix.needsUpdate = true;
  if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

  $('statEscenario').textContent = 'Mapa de riesgo (Monte Carlo)';
  $('statHa').textContent = `máx. ${(pmax * 100).toFixed(0)} % de probabilidad`;
  $('statLlega').textContent = `${state.riesgo.nCorridas} corridas`;
  $('statLlega').classList.remove('on');
  $('statTiempo').textContent = '8 h sin control';
}

/* ------------------------------- UI ----------------------------------- */

function wireUI() {
  $('btnBase').addEventListener('click', () => {
    state.escenarioActual = 'base'; state.frameIdx = 0; state.modoRiesgo = false;
    $('btnBase').classList.add('active'); $('btnCortafuegos').classList.remove('active'); $('btnRiesgo').classList.remove('active');
    aplicarFrame();
  });
  $('btnCortafuegos').addEventListener('click', () => {
    state.escenarioActual = 'cortafuegos250'; state.frameIdx = 0; state.modoRiesgo = false;
    $('btnCortafuegos').classList.add('active'); $('btnBase').classList.remove('active'); $('btnRiesgo').classList.remove('active');
    aplicarFrame();
  });
  $('btnRiesgo').addEventListener('click', () => {
    const activar = !state.modoRiesgo;
    $('btnRiesgo').classList.toggle('active', activar);
    aplicarMapaDeRiesgo(activar);
  });
  const setIconoPlay = (reproduciendo) => {
    $('iconPlay').querySelector('use').setAttribute('href', reproduciendo ? '#i-pause' : '#i-play');
  };
  $('btnPlay').addEventListener('click', () => {
    state.playing = !state.playing;
    setIconoPlay(state.playing);
  });
  $('scrub').addEventListener('input', (e) => {
    state.playing = false; setIconoPlay(false);
    state.frameIdx = Number(e.target.value);
    aplicarFrame();
  });
}

/* --------------------------- VR / Cardboard ---------------------------- */

let xrSession = null;

function setTextoVR(texto) {
  const span = $('btnVR').querySelector('span');
  if (span) span.textContent = texto; else $('btnVR').textContent = texto;
  $('btnVR').title = texto;
}

async function entrarEnVR() {
  if (!navigator.xr) return;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    xrSession = session;
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    setTextoVR('Salir de VR');
    session.addEventListener('end', () => {
      xrSession = null;
      setTextoVR('Entrar en VR');
    });
  } catch (err) {
    console.error('No se pudo iniciar la sesión VR:', err);
    setTextoVR('VR no disponible');
    $('btnVR').disabled = true;
  }
}

function setupVR() {
  renderer.xr.enabled = true;
  if (!navigator.xr) {
    setTextoVR('Usa Cardboard manual');
    $('btnVR').disabled = true;
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) { setTextoVR('VR no disponible aquí'); $('btnVR').disabled = true; }
  });
  $('btnVR').addEventListener('click', () => {
    if (xrSession) xrSession.end(); else entrarEnVR();
  });
}

/* --- Modo Cardboard manual (sin WebXR): estéreo + giroscopio del teléfono --- */
let stereoActivo = false;
let orientacion = { alpha: 0, beta: 0, gamma: 0 };

function quaternionDeOrientacion(alpha, beta, gamma, orient) {
  const degtorad = Math.PI / 180;
  const _x = beta ? beta * degtorad : 0;
  const _y = alpha ? alpha * degtorad : 0;
  const _z = gamma ? gamma * degtorad : 0;
  const cX = Math.cos(_x / 2), cY = Math.cos(_y / 2), cZ = Math.cos(_z / 2);
  const sX = Math.sin(_x / 2), sY = Math.sin(_y / 2), sZ = Math.sin(_z / 2);
  const q = new THREE.Quaternion(
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  );
  q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // ejes del mundo
  const orientRad = (orient || 0) * degtorad;
  q.multiply(new THREE.Quaternion(0, 0, -Math.sin(orientRad / 2), Math.cos(orientRad / 2)));
  return q;
}

function onDeviceOrientation(e) {
  orientacion.alpha = e.alpha || 0;
  orientacion.beta = e.beta || 0;
  orientacion.gamma = e.gamma || 0;
}

async function activarStereoManual() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (_) { /* ignorar */ }
  }
  window.addEventListener('deviceorientation', onDeviceOrientation);
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  stereoActivo = true;
  $('fallbackNotice').style.display = 'block';
  document.body.addEventListener('click', salirStereoManual, { once: true });
}

function salirStereoManual() {
  stereoActivo = false;
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  $('fallbackNotice').style.display = 'none';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/* --------------------------------- main ---------------------------------- */

/* ------------------------------- dron térmico (intro) ---------------------------- */

let drone, helices = [], anilloEscaneo;
const introState = {
  activo: true, t: 0,
  padPos: null, destino: null,
  camInicio: null, camFinal: null, targetFinal: null,
};

function facilitarSuave(t) { return t * t * (3 - 2 * t); } // smootherstep simple

function encontrarPadCercaDeUrbano() {
  const t = state.terreno; const n = t.n; const [ii, jj] = t.ignicion;
  let mejor = [ii, jj], mejorD = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (t.urbano[i][j]) {
        const d = (i - ii) ** 2 + (j - jj) ** 2;
        if (d < mejorD) { mejorD = d; mejor = [i, j]; }
      }
    }
  }
  return mejor;
}

function construirDron() {
  drone = new THREE.Group();
  const matCuerpo = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.35, metalness: 0.65 });
  const matHelice = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.25, metalness: 0.3 });

  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), matCuerpo);
  cuerpo.castShadow = true;
  drone.add(cuerpo);

  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.2 }));
  gimbal.position.set(0, -0.15, 0.05);
  drone.add(gimbal);
  const lenteTermico = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
  lenteTermico.position.set(0, -0.2, 0.1);
  lenteTermico.rotation.x = -Math.PI / 2.3;
  drone.add(lenteTermico);

  const luz = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2b2b }));
  luz.position.set(0, 0.1, -0.23);
  drone.add(luz);
  drone.userData.luz = luz;

  const esquinas = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sx, sz] of esquinas) {
    const ox = sx * 0.42, oz = sz * 0.42;
    const brazo = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6), matCuerpo);
    brazo.position.set(ox / 2, 0.02, oz / 2);
    brazo.rotation.z = Math.PI / 2;
    brazo.rotation.y = -Math.atan2(oz, ox);
    drone.add(brazo);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 8), matCuerpo);
    motor.position.set(ox, 0.05, oz);
    drone.add(motor);
    const helice = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.01, 0.04), matHelice);
    helice.position.set(ox, 0.095, oz);
    drone.add(helice);
    helices.push(helice);
  }
  drone.scale.setScalar(1.7);
  drone.castShadow = true;
  scene.add(drone);

  // anillo de "escaneo térmico" que se usa al llegar a destino
  anilloEscaneo = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  anilloEscaneo.rotation.x = -Math.PI / 2;
  scene.add(anilloEscaneo);
}

function construirPad(pos) {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.2, 0.12, 20),
    new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.8 }),
  );
  base.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
  base.receiveShadow = true;
  scene.add(base);
  const marca = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb04d }),
  );
  marca.rotation.x = -Math.PI / 2;
  marca.position.copy(pos).add(new THREE.Vector3(0, 0.13, 0));
  scene.add(marca);
}

function iniciarIntro(camInicioSugerida, camFinal, targetFinal) {
  const [pi, pj] = encontrarPadCercaDeUrbano();
  const [px, pz] = xzDe(pi, pj);
  const py = heightAt(pi, pj);
  introState.padPos = new THREE.Vector3(px, py, pz);

  const [ix, iz] = xzDe(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  const iy = heightAt(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  introState.destino = new THREE.Vector3(ix, iy + WORLD_SIZE * 0.1, iz);

  introState.camFinal = camFinal.clone();
  introState.targetFinal = targetFinal.clone();

  construirDron();
  construirPad(introState.padPos);
  drone.position.copy(introState.padPos).add(new THREE.Vector3(0, 0.08, 0));

  const dirPad = introState.padPos.clone().sub(introState.destino).setY(0).normalize();
  camera.position.copy(introState.padPos).add(dirPad.multiplyScalar(3.2)).add(new THREE.Vector3(0, 1.6, 0));
  camera.lookAt(introState.padPos.clone().add(new THREE.Vector3(0, 0.5, 0)));

  $('introCaption').style.display = 'flex';
  $('btnSkipIntro').style.display = 'block';
}

function finalizarIntro() {
  introState.activo = false;
  camera.position.copy(introState.camFinal);
  controls.target.copy(introState.targetFinal);
  controls.enabled = true;
  controls.update();
  $('introCaption').style.display = 'none';
  $('btnSkipIntro').style.display = 'none';
  document.getElementById('hud').classList.add('visible');
  $('stats').classList.add('visible');
  $('brand').classList.add('visible');
  aplicarFrame();
}

function saltarIntro() {
  introState.t = 999;
  if (drone) { drone.position.copy(introState.destino); }
  finalizarIntro();
}

function actualizarIntro(dt) {
  if (!introState.activo) return;
  introState.t += dt;
  const t = introState.t;
  const girarHelices = (vel) => { for (const h of helices) h.rotation.y += vel * dt; };

  if (t < 1.1) {
    // despegando: hélices acelerando, cámara fija mirando el dron
    girarHelices(THREE.MathUtils.lerp(2, 55, Math.min(1, t / 1.1)));
    $('introCaption').querySelector('.capTxt').textContent = 'Preparando el dron térmico…';
  } else if (t < 2.0) {
    girarHelices(55);
    const u = facilitarSuave((t - 1.1) / 0.9);
    drone.position.y = introState.padPos.y + 0.08 + u * 1.6;
    $('introCaption').querySelector('.capTxt').textContent = 'Despegando…';
  } else if (t < 6.2) {
    girarHelices(55);
    const u = facilitarSuave((t - 2.0) / 4.2);
    const p = new THREE.Vector3().lerpVectors(
      introState.padPos.clone().add(new THREE.Vector3(0, 1.68, 0)),
      introState.destino, u,
    );
    p.y += Math.sin(u * Math.PI) * (WORLD_SIZE * 0.07); // arco de vuelo
    const anterior = drone.position.clone();
    drone.position.copy(p);
    const avance = p.clone().sub(anterior);
    if (avance.lengthSq() > 1e-6) drone.rotation.y = Math.atan2(avance.x, avance.z);
    drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, -Math.min(0.18, avance.length() * 2), 0.2);

    const detras = p.clone().sub(introState.destino).setY(0);
    if (detras.lengthSq() < 0.01) detras.set(0, 0, 1);
    detras.normalize().multiplyScalar(4.2);
    camera.position.lerp(p.clone().add(detras).add(new THREE.Vector3(0, 2.1, 0)), 0.12);
    camera.lookAt(p);
    $('introCaption').querySelector('.capTxt').textContent = 'Volando hacia la zona del incendio…';
  } else if (t < 7.8) {
    girarHelices(38);
    drone.position.copy(introState.destino);
    drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, 0, 0.1);
    const u = (t - 6.2) / 1.6;
    anilloEscaneo.position.set(introState.destino.x, introState.destino.y - WORLD_SIZE * 0.095, introState.destino.z);
    const esc = 1 + u * 2.5;
    anilloEscaneo.scale.set(esc, esc, esc);
    anilloEscaneo.material.opacity = Math.sin(Math.min(1, u) * Math.PI) * 0.8;
    camera.position.lerp(introState.destino.clone().add(new THREE.Vector3(2.6, 2.0, 3.4)), 0.07);
    camera.lookAt(introState.destino);
    $('introCaption').querySelector('.capTxt').textContent = 'Escaneando el foco con la cámara térmica…';
  } else if (t < 9.4) {
    girarHelices(30);
    const u = facilitarSuave((t - 7.8) / 1.6);
    camera.position.lerp(introState.camFinal, 0.09);
    const miraActual = introState.destino.clone().lerp(introState.targetFinal, u);
    camera.lookAt(miraActual);
    anilloEscaneo.material.opacity *= 0.9;
    $('introCaption').style.opacity = String(1 - u);
  } else {
    finalizarIntro();
  }
}

/* --------------------------------------------------------------------------------- */

async function main() {
  await cargarDatos();

  const app = $('app');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);

  crearCieloYLuces();
  construirTerreno();
  construirOverlayDeFuego();
  construirHumo();
  wireUI();
  setupVR();

  // Encuadre inicial: mirando hacia el punto de ignición, desde una posición elevada.
  const [ix, iz] = xzDe(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  const iy = heightAt(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  camera.position.set(ix + WORLD_SIZE * 0.28, iy + WORLD_SIZE * 0.22, iz + WORLD_SIZE * 0.34);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(ix, iy + 1, iz);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = WORLD_SIZE * 1.3;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  controls.enabled = false; // se habilita cuando termina la intro del dron

  const camFinalIntro = camera.position.clone();
  const targetFinalIntro = controls.target.clone();
  iniciarIntro(null, camFinalIntro, targetFinalIntro);
  $('btnSkipIntro').addEventListener('click', saltarIntro);

  $('btnStereo').addEventListener('click', () => { if (!stereoActivo) activarStereoManual(); });

  aplicarFrame();
  $('loading').style.display = 'none';

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.1, clock.getDelta());

    if (introState.activo) {
      actualizarIntro(dt);
    } else if (state.playing && !state.modoRiesgo) {
      state.acumulador += dt;
      const esc = state.escenarios[state.escenarioActual];
      if (state.acumulador > 1 / state.playSpeed) {
        state.acumulador = 0;
        state.frameIdx = (state.frameIdx + 1) % esc.frames.length;
        aplicarFrame();
      }
    }
    actualizarHumo(dt);
    actualizarNubes(dt);

    if (!renderer.xr.isPresenting) {
      if (!introState.activo) controls.update();
      if (stereoActivo) {
        camera.quaternion.copy(quaternionDeOrientacion(orientacion.alpha, orientacion.beta, orientacion.gamma, window.orientation || 0));
        const w = window.innerWidth / 2, h = window.innerHeight;
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        renderer.setViewport(w, 0, w, h); renderer.setScissor(w, 0, w, h);
        renderer.render(scene, camera);
        renderer.setScissorTest(false);
        return;
      }
    }
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error(err);
  $('loading').innerHTML = `<div style="color:#ff8a8a">Error cargando el simulador: ${err.message}</div>`;
});
