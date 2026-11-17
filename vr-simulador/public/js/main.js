import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Simulador VR de incendios — Parque Nacional Tunari, sector Cercado
 *  Usa los datos reales del proyecto SIM-522 (Grupo 3): la grilla de
 *  elevación/vegetación y una corrida calibrada del autómata celular
 *  (p_h = 0,072, viento del "peor día"), exportadas por export_data.py.
 * ------------------------------------------------------------------ */

const COLORES_CLASE = {
  10: 0x1e6b30, // arbórea (eucalipto/pino)
  20: 0x8fb339, // matorral
  30: 0xe3c567, // pastizal (pajonal)
  40: 0xc99b5f, // cultivo
  50: 0x7f7f7f, // zona construida
  60: 0xb9b0a3, // roca / suelo desnudo
  80: 0x3b83c4, // agua
};
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

function crearCieloYLuces() {
  scene.background = new THREE.Color(0xbfd9ea);
  scene.fog = new THREE.Fog(0xcfe3ee, WORLD_SIZE * 0.6, WORLD_SIZE * 2.4);

  const hemi = new THREE.HemisphereLight(0xffeedd, 0x3a3f33, 1.1);
  scene.add(hemi);

  const sol = new THREE.DirectionalLight(0xfff1dd, 2.1);
  sol.position.set(-WORLD_SIZE * 0.5, WORLD_SIZE * 0.6, WORLD_SIZE * 0.2); // tarde, sol bajo
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.camera.left = -WORLD_SIZE; sol.shadow.camera.right = WORLD_SIZE;
  sol.shadow.camera.top = WORLD_SIZE; sol.shadow.camera.bottom = -WORLD_SIZE;
  scene.add(sol);
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
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      pos.setY(k, heightAt(i, j));
      let clase = t.clase[i][j];
      if (t.lineaCortafuegos250[i][j]) {
        color.copy(COLOR_CORTAFUEGOS);
      } else {
        color.set(COLORES_CLASE[clase] ?? 0x999999);
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
  $('btnPlay').addEventListener('click', () => {
    state.playing = !state.playing;
    $('btnPlay').textContent = state.playing ? '⏸' : '▶';
  });
  $('scrub').addEventListener('input', (e) => {
    state.playing = false; $('btnPlay').textContent = '▶';
    state.frameIdx = Number(e.target.value);
    aplicarFrame();
  });
}

/* --------------------------- VR / Cardboard ---------------------------- */

let xrSession = null;

async function entrarEnVR() {
  if (!navigator.xr) return;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    xrSession = session;
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    $('btnVR').textContent = 'Salir de VR';
    session.addEventListener('end', () => {
      xrSession = null;
      $('btnVR').textContent = 'Entrar en VR 🥽';
    });
  } catch (err) {
    console.error('No se pudo iniciar la sesión VR:', err);
    $('btnVR').textContent = 'VR no disponible';
    $('btnVR').disabled = true;
  }
}

function setupVR() {
  renderer.xr.enabled = true;
  if (!navigator.xr) {
    $('btnVR').textContent = 'WebXR no disponible — usa Cardboard manual';
    $('btnVR').disabled = true;
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) { $('btnVR').textContent = 'VR no disponible en este navegador'; $('btnVR').disabled = true; }
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

    if (state.playing && !state.modoRiesgo) {
      state.acumulador += dt;
      const esc = state.escenarios[state.escenarioActual];
      if (state.acumulador > 1 / state.playSpeed) {
        state.acumulador = 0;
        state.frameIdx = (state.frameIdx + 1) % esc.frames.length;
        aplicarFrame();
      }
    }
    actualizarHumo(dt);

    if (!renderer.xr.isPresenting) {
      controls.update();
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
